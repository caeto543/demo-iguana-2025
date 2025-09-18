/* PV6 M2 Addon — servicio CON manejo
   v1.7 — compatibilidad global (state/moves/funciones declaradas con const/let)
   - No depende de window.state ni window.moves: usa typeof para detectar bindings globales.
   - Hook a renderAll, watcher y autocorrecciones igual a v1.6.
*/
(function(){
  const urlParams = new URLSearchParams(location.search);
  const SERVICE = (urlParams.get('service')||'con').toLowerCase();
  if (SERVICE === 'sin') return;

  const nf0 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });
  const $ = (s)=> document.querySelector(s);
  const parseDate = s => new Date(s + 'T00:00:00');
  const toISO = d => new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);

  // Helpers para acceder a bindings globales aunque no estén en window
  const getState = () => (typeof state !== 'undefined' ? state : (window.state||{}));
  const getMoves = () => (typeof moves !== 'undefined' ? moves : (window.moves||new Map()));
  const hasFn = (name) => (typeof window[name] === 'function' || (function(){ try { return typeof eval(name) === 'function'; } catch(e){ return false; }})());

  const MOV_NEW = [];

  // ---------- Core readiness ----------
  function coreReady(){
    try{
      const st = getState();
      const mv = getMoves();
      const parentsFn = (typeof selectedParents === 'function') || (typeof window.selectedParents === 'function');
      const inferFn   = (typeof inferUAandOcc === 'function')   || (typeof window.inferUAandOcc === 'function');
      const rankFn    = (typeof computeRanking === 'function')  || (typeof window.computeRanking === 'function')
                        || (typeof computeRankingWithLoad === 'function') || (typeof window.computeRankingWithLoad === 'function');
      return !!(st && mv && parentsFn && inferFn && rankFn);
    }catch(e){ return false; }
  }
  function whenReady(fn, maxTries=120, delay=250){ // hasta ~30s
    let t=0; (function tick(){ if (coreReady()) fn(false); else if (++t>=maxTries){ console.warn('[M2] core no listo; sigo con fallback'); fn(true);} else setTimeout(tick,delay); })();
  }

  function selectedDateISO(){ const v=$('#mov-date')?.value; return v || (getState()?.end) || toISO(new Date()); }

  function getUAFromInputs(prefix){
    const st = getState();
    const pv = Number($(prefix+'-pv')?.value||0);
    const uaIn = Number($(prefix+'-ua')?.value||0);
    const nIn  = Number($(prefix+'-n')?.value||0);
    let ua = uaIn;
    if (!ua && pv>0 && (st?.auKg>0)) ua = pv/st.auKg;
    if (!ua && nIn>0) ua = nIn;
    return { ua: ua||0, pv, n: nIn||0 };
  }

  function inferInfo(nm, d){
    try{
      const mv = getMoves();
      const arr = mv.get(nm) || [];
      const st = getState();
      const f = (typeof inferUAandOcc === 'function') ? inferUAandOcc : window.inferUAandOcc;
      const info = f(arr, d, st?.auKg);
      return info || {UA:0, occ:false};
    }catch(e){ return {UA:0, occ:false}; }
  }
  function currentUA(nm, d){ const i = inferInfo(nm,d); return Number(i.UA)||0; }

  function selectedParentsSafe(){ try{ return (typeof selectedParents==='function'? selectedParents() : window.selectedParents()) || []; }catch(e){ return []; } }

  function listOccupied(dISO){
    const d = parseDate(dISO);
    const out = [];
    const parents = selectedParentsSafe();
    for (const nm of parents){
      const info = inferInfo(nm, d);
      if (info.occ || Number(info.UA)>0) out.push(nm);
    }
    return out;
  }
  function listOccupiedByUA(dISO){
    const d = parseDate(dISO);
    const out = []; const parents = selectedParentsSafe();
    for (const nm of parents){ if (currentUA(nm, d)>0) out.push(nm); }
    return out;
  }
  function listFree(dISO){
    const occ = new Set(listOccupied(dISO)); const parents=selectedParentsSafe();
    return parents.filter(nm=>!occ.has(nm));
  }

  function suggestDestinations(dISO, UA_override, originOpt){
    let rows=[]; try{
      const withLoad = (typeof computeRankingWithLoad==='function') ? computeRankingWithLoad : window.computeRankingWithLoad;
      const rank = (typeof computeRanking==='function') ? computeRanking : window.computeRanking;
      if (typeof withLoad==='function' && UA_override>0){ rows=withLoad(dISO, UA_override); }
      else if (typeof rank==='function'){ rows=rank(dISO); }
    }catch(e){ rows=[]; }
    if (!rows || !rows.length){
      rows = listFree(dISO).filter(nm=> nm!==originOpt).sort((a,b)=> a.localeCompare(b)).map(nm=>({nm,kg:null,D0:null,Dadj:null,estado:0}));
    }else{
      rows = rows.filter(r=> !originOpt || r.nm!==originOpt);
    }
    return rows;
  }

  function ensureMovesArray(nm){ const mv=getMoves(); if (!mv.has(nm)) mv.set(nm,[]); return mv.get(nm); }
  function pushMovement(row){
    MOV_NEW.push(row); const arr=ensureMovesArray(row.name_canon);
    arr.push({date:row.date,name_canon:row.name_canon,peso_vivo_total_kg:row.peso_vivo_total_kg||'',UA:row.UA||'',N_total:row.N_total||'',ocupado:row.ocupado,nota:row.nota||'ui'});
    arr.sort((a,b)=> (a.date<b.date?-1:a.date>b.date?1:0));
  }

  function applyMovement({dateISO, action, origen, destino, ua, pv, n, nota}){
    const dISO = dateISO || selectedDateISO(); const d = parseDate(dISO);
    if (!destino){ alert('Selecciona un destino.'); return; }
    if (action==='mover' && !origen){ alert('Selecciona el potrero de origen.'); return; }
    if (action==='mover' && origen===destino){ alert('El origen y el destino no pueden ser el mismo potrero.'); return; }
    if (!ua && !pv && !n){ alert('Ingresa UA, o PV, o N para el movimiento.'); return; }
    let uaMove = ua || 0;

    if (action==='mover'){
      const uaOrigPrev = currentUA(origen, d);
      if (uaOrigPrev<=0){ alert(`El origen "${origen}" no tiene UA a ${dISO}.`); return; }
      if (uaMove>uaOrigPrev){ alert(`Pediste mover ${uaMove} UA y el origen tiene ${uaOrigPrev}. Se ajusta al máximo disponible.`); uaMove=uaOrigPrev; }
      const uaOrigNew = Math.max(0, uaOrigPrev-uaMove);
      pushMovement({date:dISO,name_canon:origen,UA:uaOrigNew,ocupado:uaOrigNew>0?1:0,nota:'mover→actualiza origen UI'});
    }
    if (destino !== '__NONE__') {
      const uaDestPrev = currentUA(destino, d);
      const uaDestNew  = (uaDestPrev||0)+(uaMove||0);
      pushMovement({date:dISO,name_canon:destino,UA:uaDestNew,ocupado:uaDestNew>0?1:0,nota:(action==='ingresar'?'ingreso UI':'mover→actualiza destino UI')+(nota?` — ${nota}`:'')});
    }

    if (typeof renderAll==='function') renderAll(); else if (typeof window.renderAll==='function') window.renderAll();
    refreshCombos();
  }

  function exportMovCSV(){
    const out=[['date','name_canon','peso_vivo_total_kg','UA','N_total','ocupado','nota']];
    MOV_NEW.forEach(r=> out.push([r.date,r.name_canon,r.peso_vivo_total_kg||'',r.UA||'',r.N_total||'',r.ocupado,r.nota||'ui']));
    const csv=out.map(r=>r.join(',')).join('\n'); const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`MOV_GANADO_CARGA_MIX_new_${selectedDateISO()}.csv`; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 800);
  }

  function buildPanel(coreNotReady){
    const side = document.querySelector('aside.side'); if (!side) return;
    if (document.getElementById('m2-card')) return;

    const card=document.createElement('div'); card.className='card'; card.id='m2-card';
    card.innerHTML=`
      <div class="card-header">
        <h4>Registrar movimiento (con manejo)</h4>
        <button id="btn-mov-export" class="btn secondary">Descargar CSV movimientos</button>
      </div>
      <div style="padding:8px 10px">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">
          <label>Fecha <input type="date" id="mov-date"></label>
          <label>Acción
            <select id="mov-action">
              <option value="mover">Mover</option>
              <option value="ingresar">Ingresar</option>
            </select>
          </label>
          <label>UA (o PV/N) <input type="number" id="mov-ua" min="0" step="0.1" placeholder="UA"></label>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">
          <label>PV total (kg) <input type="number" id="mov-pv" min="0" step="1" placeholder="Ej: 1500"></label>
          <label>N total <input type="number" id="mov-n" min="0" step="1" placeholder="Ej: 120"></label>
          <label>Nota <input type="text" id="mov-nota" placeholder="opcional"></label>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <label>Origen (si mueves) <select id="mov-origen"><option value="">—</option></select></label>
          <label>Destino sugerido <select id="mov-destino"></select></label>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
          <button id="btn-mov-recom" class="btn">Recalcular sugeridos</button>
          <button id="btn-mov-apply" class="btn">Registrar</button>
        </div>
        <div class="table-wrap" style="max-height:24vh;overflow:auto;border:1px solid var(--line);border-radius:8px">
          <table class="rank">
            <thead><tr><th>Potrero</th><th>Kg MS/ha</th><th>Días br. (est)</th><th>Días aj. (est)</th><th>Estado</th></tr></thead>
            <tbody id="mov-sug-body"></tbody>
          </table>
        </div>
      </div>`;
    const dynamic=document.querySelector('.pastoreo-dynamic');
    if (dynamic && dynamic.parentNode){ dynamic.parentNode.insertBefore(card, dynamic.nextSibling); 
// Mutual exclusividad de entradas (UA vs PV vs N)
const uaInp = document.querySelector('#mov-ua');
const pvInp = document.querySelector('#mov-pv');
const nInp  = document.querySelector('#mov-n');
function syncInputsLock(){
  const hasUA = !!(Number(uaInp?.value||0));
  const hasPV = !!(Number(pvInp?.value||0));
  const hasN  = !!(Number(nInp?.value||0));
  if (uaInp){ uaInp.disabled = false; }
  if (pvInp){ pvInp.disabled = hasUA; }
  if (nInp){  nInp.disabled  = hasUA || hasPV; }
}
['input','change'].forEach(ev=>{
  uaInp?.addEventListener(ev, syncInputsLock);
  pvInp?.addEventListener(ev, syncInputsLock);
  nInp?.addEventListener(ev, syncInputsLock);
});
setTimeout(syncInputsLock, 50);
} else { side.insertBefore(card, side.firstChild); }

    // Fecha inicial
    const st = getState();
    const dEl = $('#mov-date'); dEl.value = (st && st.end) ? st.end : toISO(new Date());

    // Hook a renderAll para refrescar combos cuando el core termine sus cargas/render
    try{
      const r = (typeof renderAll==='function') ? renderAll : window.renderAll;
      if (typeof r==='function' && !window.__m2_hooked){
        const orig = r;
        const bound = function(){ const ret = orig.apply(this, arguments); try { refreshCombos(); } catch(e){} return ret; };
        if (typeof renderAll==='function') { renderAll = bound; } else { window.renderAll = bound; }
        window.__m2_hooked = true;
      }
    }catch(e){}

    // Watcher de datos (hasta 60s)
    let ticks = 0;
    const watch = setInterval(()=>{
      ticks++;
      const parentsReady = selectedParentsSafe().length>0;
      const mv = getMoves(); const movesReady = !!(mv && typeof mv.size==='number');
      if (parentsReady && movesReady){
        refreshCombos();
        const sel = $('#mov-origen');
        if (sel && sel.options && sel.options.length>1){ clearInterval(watch); }
      }
      // Autocorregir fecha si en la fecha actual no hay ocupados pero en end sí
      const st = getState();
      if (st?.end){
        const cur = $('#mov-date')?.value;
        const occCur = listOccupied(cur);
        const occEnd = listOccupied(st.end);
        if ((!occCur.length && occEnd.length) || (cur!==st.end && occEnd.length)){
          $('#mov-date').value = st.end;
          refreshCombos();
        }
      }
      if (ticks>=60) clearInterval(watch);
    }, 1000);

    refreshCombos();
    bindHandlers();
  }

  function refreshCombos(){ fillOrigen(); recomendar(); }

  function fillOrigen(){
    const sel = $('#mov-origen'); if (!sel) return;
    sel.innerHTML = '<option value="">—</option>';
    let dISO = selectedDateISO();
    let occ = listOccupied(dISO);
    const st = getState();
    if ((!occ || !occ.length) && st?.end && dISO !== st.end){
      const occEnd = listOccupied(st.end);
      if (occEnd.length){
        $('#mov-date').value = st.end; dISO = st.end; occ = occEnd;
      }
    }
    if (!occ.length){
      const uaOcc = listOccupiedByUA(dISO);
      if (uaOcc.length) occ = uaOcc;
    }
    occ.forEach(nm=>{ const opt=document.createElement('option'); opt.value=nm; opt.textContent=nm; sel.appendChild(opt); });
  }

  function recomendar(){
    const {ua} = getUAFromInputs('#mov');
    const origin = $('#mov-origen')?.value || '';
    const rows = suggestDestinations(selectedDateISO(), ua, origin).slice(0,8);

    const destSel = $('#mov-destino');
    if (destSel){
      destSel.innerHTML='';
      rows.forEach(r=>{ const opt=document.createElement('option'); opt.value=r.nm; opt.textContent=`${r.nm} — ${r.kg!=null?nf0.format(Math.round(r.kg)):'s/ dato'} kg/ha`; destSel.appendChild(opt); });
    }

    const tbody = $('#mov-sug-body');
    if (tbody){
      tbody.innerHTML='';
      rows.forEach(r=>{
        const tr=document.createElement('tr');
        tr.innerHTML = `<td style="text-align:left">${r.nm}</td>
                        <td>${r.kg!=null?nf0.format(Math.round(r.kg)):'–'}</td>
                        <td>${r.D0!=null?nf1.format(r.D0):'–'}</td>
                        <td>${r.Dadj!=null?nf1.format(r.Dadj):'–'}</td>
                        <td>${r.estado===1?'<span class="state green">Verde</span>':(r.estado===0?'<span class="state yellow">Amarillo</span>':'<span class="state red">Rojo</span>')}</td>`;
        tr.addEventListener('click', ()=>{ if ($('#mov-destino')) $('#mov-destino').value=r.nm; });
        tbody.appendChild(tr);
      });
    }
  }

  function bindHandlers(){
    const recompute = ()=>{ refreshCombos(); };
    const recomputeNoFill = ()=> recomendar();
    ['#mov-ua','#mov-pv','#mov-n'].forEach(id=>{ const el=$(id); if (el) el.addEventListener('input', recomputeNoFill); });
    const selAction = $('#mov-action'); if (selAction) selAction.addEventListener('change', recompute);
    const dateEl = $('#mov-date'); if (dateEl) dateEl.addEventListener('change', recompute);
    const selOrig = $('#mov-origen'); if (selOrig) selOrig.addEventListener('change', recomputeNoFill);
    const btnRe = $('#btn-mov-recom'); if (btnRe) btnRe.addEventListener('click', recomputeNoFill);
    const btnAp = $('#btn-mov-apply'); if (btnAp){ btnAp.addEventListener('click', ()=>{
      const action=$('#mov-action')?.value||'mover'; const dateISO=selectedDateISO();
      const origen=$('#mov-origen')?.value||''; const destino=$('#mov-destino')?.value||'';
      const {ua,pv,n}=getUAFromInputs('#mov'); const nota=$('#mov-nota')?.value||'';
      applyMovement({dateISO, action, origen, destino, ua, pv, n, nota});
    }); }
    const btnExp=$('#btn-mov-export'); if (btnExp) btnExp.addEventListener('click', exportMovCSV);
  }

  whenReady(buildPanel);
})();
