/* PV6 M2.10 — Pastoreo con manejo (PV6)
   - Espera a que areaHaByPot y movRows estén listos (parche remoto).
   - Origen (ocupados): movRows a la fecha (UA>0 u ocupado=1). Fallback: chips DOM “Ocupados (X)”.
   - Destino: todos los potreros (sin filtro "Z" por ahora).
   - Tabla: Días br./FDN/φ/Días aj. enganchando PV6.computeDays o PV6.M3.computeDays
     con claves alternativas (dfdn|fdnDays|daysFdn, phi|phiD|wastePhi, dadj|daysAdj).
*/
(function(){
  "use strict";

  const PV6 = (window.PV6 = window.PV6 || {});
  const ST  = (PV6.state = PV6.state || {});
  const $   = (s, r=document)=>r.querySelector(s);
  const $$  = (s, r=document)=>Array.from(r.querySelectorAll(s));
  const fmt1= v=> (v==null||!isFinite(v))? "–": Number(v).toFixed(1);
  const fmt2= v=> (v==null||!isFinite(v))? "–": Number(v).toFixed(2);
  const fmt3= v=> (v==null||!isFinite(v))? "–": Number(v).toFixed(3);

  // --- utils ---
  function toISO(s){
    if (!s) return null; const str=String(s).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const m=str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m){ const d=m[1].padStart(2,"0"), M=m[2].padStart(2,"0"), y=m[3]; return `${y}-${M}-${d}`; }
    const dt=new Date(str); return isNaN(dt)?str:dt.toISOString().slice(0,10);
  }
  function ensureStyles(){
    if ($('#pv6-m2-styles')) return;
    const st=document.createElement('style'); st.id='pv6-m2-styles';
    st.textContent=`
      #pv6-m2-card{background:#fff;border:1px solid #eee;border-radius:12px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,.06);margin-top:12px}
      #pv6-m2-card .row{display:flex;gap:10px;flex-wrap:wrap}
      #pv6-m2-card .col{flex:1 1 240px;min-width:220px}
      #pv6-m2-card .title{font-size:16px;margin:0;font-weight:600}
      #pv6-m2-card .badge{font-size:12px;background:#eef3ff;color:#335;padding:2px 6px;border-radius:8px}
      #pv6-m2-card .btn{padding:6px 10px;border-radius:8px;border:1px solid #ddd;background:#f7f7f7;cursor:pointer}
      #pv6-m2-card .btn:hover{background:#f0f0f0}
      #pv6-m2-card .btn-light{background:#fff}
      #pv6-m2-card .inp{width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:8px}
      #pv6-m2-card .tbl{width:100%;border-collapse:separate;border-spacing:0}
      #pv6-m2-card .tbl thead th{position:sticky;top:0;background:#fafafa;z-index:1;text-align:right;padding:8px;font-weight:600;border-bottom:1px solid #eee}
      #pv6-m2-card .tbl thead th:first-child,#pv6-m2-card .tbl tbody td:first-child{text-align:left}
      #pv6-m2-card .tbl tbody td{padding:6px 8px;text-align:right;border-bottom:1px solid #f2f2f2}
      #pv6-m2-tip{color:#666;font-size:12px} #pv6-m2-note{font-size:12px;color:#555;margin-left:8px}
      #pv6-m2-grid{display:grid;grid-template-columns:repeat(3,minmax(110px,1fr));gap:8px} #pv6-m2-grid label{font-size:12px;color:#444}
    `;
    document.head.appendChild(st);
  }
  function resolveAnchor(){
    const sim = [...document.querySelectorAll("h1,h2,h3,h4,strong")]
      .find(h=>/Simular pastoreo\s*\(sin manejo\)/i.test(h.textContent||""));
    if (sim && sim.parentNode) return {node: sim.parentNode, mode:"before"};
    const right = $('#pv6-m2-slot') || $('#panel-derecho') || $('#right-panel') || $('.col-right') || $('#sidebar');
    if (right) return {node:right, mode:"append"};
    const mapW = $('#map')?.parentNode || document.body;
    return {node:mapW, mode:"afterMap"};
  }
  function ensureCard(){
    let card=$('#pv6-m2-card'); if (card) return card;
    const {node,mode}=resolveAnchor();
    card=document.createElement('div'); card.id='pv6-m2-card';
    card.innerHTML=`
      <div class="row" style="align-items:center;gap:8px">
        <h3 class="title">Pastoreo con manejo (PV6)</h3><span class="badge">M2.10</span><span id="pv6-m2-note"></span>
        <div style="flex:1"></div>
        <button id="pv6-m2-btn-recalc" class="btn">Recalcular sugeridos</button>
        <button id="pv6-m2-btn-clear" class="btn btn-light">Limpiar</button>
      </div>
      <div class="row" style="margin-top:10px">
        <div class="col"><label>Origen (ocupados)</label><select id="pv6-m2-origen" class="inp"></select></div>
        <div class="col"><label>Destino</label><select id="pv6-m2-dest" class="inp"></select></div>
        <div class="col"><label>Modo manejo</label>
          <select id="pv6-m2-mode" class="inp">
            <option value="eq">Equilibrado</option><option value="gain">Ganar peso</option><option value="etico">Ético</option>
          </select>
        </div>
      </div>
      <div class="row" style="margin-top:8px">
        <div class="col">
          <div id="pv6-m2-grid">
            <div><label>UA</label><input id="pv6-ua" class="inp" type="number" step="1" min="0" placeholder="p.ej. 180"></div>
            <div><label>PV total (kg)</label><input id="pv6-pvkg" class="inp" type="number" step="1" min="0" placeholder="p.ej. 81000"></div>
            <div><label>N total</label><input id="pv6-n" class="inp" type="number" step="1" min="0" placeholder="p.ej. 300"></div>
          </div>
          <div id="pv6-m2-tip" style="margin-top:6px">Tip: UA ↔ PV/N son excluyentes. Si escribes UA se bloquean PV/N; si PV ⇒ UA con auKg; si N ⇒ UA con N.</div>
        </div>
      </div>
      <div style="overflow:auto;margin-top:10px;max-height:360px">
        <table id="pv6-m2-tab" class="tbl">
          <thead><tr>
            <th style="min-width:180px">Potrero</th><th style="min-width:90px">Kg MS/ha</th><th style="min-width:80px">Días br.</th>
            <th style="min-width:90px">Días FDN</th><th style="min-width:70px">φ(D)</th><th style="min-width:90px">Días aj.</th><th style="min-width:90px">Estado</th>
          </tr></thead><tbody></tbody>
        </table>
      </div>`;
    if (mode==="before") node.parentNode.insertBefore(card,node);
    else if (mode==="append") node.appendChild(card);
    else { const map=$('#map'); if(map&&map.parentNode) map.parentNode.insertBefore(card,map.nextSibling); else node.appendChild(card); }
    return card;
  }

  // --- data helpers ---
  function allPots(){
    const byArea = PV6.data?.areaHaByPot || {};
    return Object.keys(byArea).sort();
  }
  function classify(kg, dateISO){
    try{
      if (PV6.ui && typeof PV6.ui.stateForKg==="function") return PV6.ui.stateForKg(kg,dateISO);
      if (typeof window.stateForKg==="function") return window.stateForKg(kg,dateISO);
    }catch(e){}
    return "";
  }
  function kgForPotNow(pot, dateISO){
    try{
      if (typeof PV6.kgForPot==="function") return PV6.kgForPot(pot,dateISO);
      if (PV6.ui && typeof PV6.ui.kgForPot==="function") return PV6.ui.kgForPot(pot,dateISO);
    }catch(e){}
    const raw = (PV6.state?.fuente||"kgms_7d").toLowerCase().includes("raw");
    const D = PV6.data||{};
    const map = raw ? (D.kgmsRawByPot || D.kg_by_pot) : (D.kgms7dByPot || D.kgms_by_pot);
    const s = map?.[pot]; if(!s) return null;
    const ks = Object.keys(s).filter(k=>/^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
    if(!ks.length) return Number(s)||null;
    const end=toISO(PV6.state?.end || $('#date-end')?.value || ks[ks.length-1]);
    const i=ks.findIndex(k=>k>=end);
    const pick=(i<0)?ks[ks.length-1]:(ks[i]===end?end:ks[Math.max(0,i-1)]);
    return Number(s[pick])||null;
  }

  // --- MOV / índices ---
  function buildIndexesFromMov(rows){
    const uaIdx={}, occIdx={}, datesSet=new Set();
    const sorted=[...rows].map(r=>({
      date: toISO(r.date),
      pot : String(r.name_canon??"").trim(),
      ua  : Number(r.UA_total ?? 0) || 0,
      occ : (r.ocupado==null || r.ocupado==="") ? null : (Number(r.ocupado)>0?1:0)
    })).filter(r=>r.pot && r.date).sort((a,b)=>a.date.localeCompare(b.date));
    for(const r of sorted){
      (uaIdx [r.pot] ||= {})[r.date]=r.ua;
      (occIdx[r.pot] ||= {})[r.date]=r.occ;
      datesSet.add(r.date);
    }
    return {uaIdx, occIdx, dates: Array.from(datesSet).sort()};
  }
  function lastOnOrBefore(idx,pot,dateISO,def=null){
    const rec=idx?.[pot]; if(!rec) return def; let best=def, bd="";
    for(const d in rec){ const iso=toISO(d); if(iso && iso<=dateISO && iso>=bd){ best=rec[d]; bd=iso; } }
    return best;
  }

  // --- DOM chips fallback ---
  function domOcupados(){
    const blocks=[...document.querySelectorAll("body *")]
      .filter(el=>/\bOcupados\s*\(\d+\)/i.test(el.textContent||""));
    const set=new Set();
    blocks.forEach(b=>{
      b.querySelectorAll("a,button,span,div").forEach(e=>{
        const t=(e.textContent||"").trim();
        const m=/^([A-Za-z0-9_]+)\b/.exec(t);
        if(m) set.add(m[1]);
      });
    });
    return Array.from(set).sort();
  }

  // --- ocupados a la fecha ---
  function ocupadosAFecha(endISO, idx){
    const tryFns=[PV6.ui?.ocupadosAt,PV6.ocupadosAt,PV6.ui?.ocupadosNow,PV6.ocupadosNow,
                  PV6.ui?.listOcupados,PV6.listOcupados,PV6.ui?.getOcupados,PV6.getOcupados]
                  .filter(fn=>typeof fn==="function");
    for(const fn of tryFns){
      try{ const r=fn.call(PV6.ui||PV6,endISO); if(Array.isArray(r)&&r.length) return r.slice().map(String).sort(); }catch(e){}
    }
    const out=[];
    const pots=allPots();
    // usar occIdx/uaIdx correctos
    for(const p of pots){
      const occ=lastOnOrBefore(idx.occIdx,p,endISO,null);
      if(occ!=null){ if(Number(occ)>0) out.push(p); continue; }
      const ua =lastOnOrBefore(idx.uaIdx ,p,endISO,0);
      if(ua>0) out.push(p);
    }
    if(out.length) return out.sort();
    const chips=domOcupados(); if(chips.length) return chips;
    return [];
  }

  // --- inputs UA/PV/N ---
  function currentUAOverride(){
    const auKg = Number(PV6.defaults?.auKg ?? PV6.state?.auKg ?? 450) || 450;
    const UA   = Number($('#pv6-ua')?.value || 0);
    const PVkg = Number($('#pv6-pvkg')?.value || 0);
    const N    = Number($('#pv6-n')?.value || 0);
    if (UA>0)  return {UA, lock:"ua"};
    if (PVkg>0)return {UA: PVkg/auKg, lock:"pv"};
    if (N>0)  return {UA: N, lock:"n"};
    return {UA:0, lock:null};
  }
  function wireInputs(){
    const ua=$('#pv6-ua'), pv=$('#pv6-pvkg'), n=$('#pv6-n');
    function sync(){ const {lock}=currentUAOverride();
      ua.disabled=(lock&&lock!=="ua"); pv.disabled=(lock&&lock!=="pv"); n.disabled=(lock&&lock!=="n");
    }
    [ua,pv,n].forEach(el=> el && el.addEventListener('input', sync)); sync();
  }

  // --- tabla días ---
  function daysFromM3(pot, endISO, UAovr){
    const fn = (typeof PV6.computeDays==="function") ? PV6.computeDays
             : (PV6.M3 && typeof PV6.M3.computeDays==="function") ? PV6.M3.computeDays
             : null;
    if (!fn) return null;
    try{ return fn(pot, endISO, UAovr||0); }catch(e){ return null; }
  }
  function mapDaysObj(obj, fallbackD0){
    const d0   = (obj?.d0 ?? obj?.d_bruto ?? obj?.days ?? fallbackD0 ?? 0);
    const dfdn = (obj?.dfdn ?? obj?.fdnDays ?? obj?.daysFdn ?? d0);
    const phi  = (obj?.phi  ?? obj?.phiD    ?? obj?.wastePhi ?? 1);
    const dadj = (obj?.dadj ?? obj?.daysAdj ?? obj?.d_aj ?? (dfdn*phi));
    return {d0, dfdn, phi, dadj};
  }
  function renderTable(ctx, UAovr){
    const tb=$('#pv6-m2-tab tbody'); if(!tb) return; tb.innerHTML="";
    const endISO=ctx.dateEnd; const pots=allPots();

    for(const nm of pots){
      const kg=kgForPotNow(nm,endISO);
      const st=(kg!=null)? classify(kg,endISO):"";
      // D0 de respaldo
      const area=Number(PV6.data?.areaHaByPot?.[nm]||0);
      const uso =(PV6.state?.coefUso??60)/100;
      const cons=Number(PV6.state?.consumo??10);
      const dem =(UAovr||0)*cons;
      const D0  =(kg&&area&&dem)? (kg*area*uso/dem):0;

      const m3 = daysFromM3(nm,endISO,UAovr);
      const d  = mapDaysObj(m3, D0);

      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td style="text-align:left">${nm}</td>
        <td>${fmt3(kg)}</td>
        <td>${fmt1(d.d0)}</td>
        <td>${fmt1(d.dfdn)}</td>
        <td>${fmt2(d.phi)}</td>
        <td>${fmt1(d.dadj)}</td>
        <td>${st||"—"}</td>`;
      tb.appendChild(tr);
    }
  }

  // --- selects origen/destino ---
  function fillSelectors(ctx){
    const selO=$('#pv6-m2-origen'), selD=$('#pv6-m2-dest'), note=$('#pv6-m2-note');
    if(!selO||!selD) return;
    selO.innerHTML=""; selD.innerHTML=""; note.textContent="";

    // origen
    let origenes=ocupadosAFecha(ctx.dateEnd, ctx.idx);
    if(!origenes.length && ctx.idx.dates.length){
      for(let i=ctx.idx.dates.length-1;i>=0;i--){
        const dd=ctx.idx.dates[i], o2=ocupadosAFecha(dd, ctx.idx);
        if(o2.length){ ctx.dateEnd=dd; const inp=$('#date-end'); if(inp) inp.value=dd;
          origenes=o2; note.textContent=`Fecha ajustada a ${dd} para mostrar “ocupados”.`; break; }
      }
    }
    if(!origenes.length){ const op=document.createElement('option'); op.value=""; op.textContent="(no hay ocupados a la fecha)"; selO.appendChild(op); }
    else origenes.forEach(nm=>{ const op=document.createElement('option'); op.value=nm; op.textContent=nm; selO.appendChild(op); });

    // destino (todos)
    const op0=document.createElement('option'); op0.value="__NONE__"; op0.textContent="— Ningún potrero (salida de finca) —"; selD.appendChild(op0);
    allPots().forEach(nm=>{
      const kg=kgForPotNow(nm,ctx.dateEnd); const st=(kg!=null)? classify(kg,ctx.dateEnd):"";
      const op=document.createElement('option'); op.value=nm; op.textContent= st? `${nm} (${st})` : nm; selD.appendChild(op);
    });
  }

  // --- eventos ---
  function wire(ctx){
    $('#pv6-m2-btn-recalc')?.addEventListener('click', ()=>{ const {UA}=currentUAOverride(); renderTable(ctx, UA); });
    $('#pv6-m2-btn-clear')?.addEventListener('click', ()=>{
      ['#pv6-ua','#pv6-pvkg','#pv6-n'].forEach(id=>{ const el=$(id); if(el) el.value=""; });
      renderTable(ctx, 0);
    });
    const end=$('#date-end');
    if(end) end.addEventListener('change', ()=>{ ctx.dateEnd=toISO(end.value); fillSelectors(ctx); renderTable(ctx, currentUAOverride().UA); });
    ["fuente","source","sel-fuente","select-fuente"].forEach(id=>{
      const el=document.getElementById(id);
      if(el && el.tagName==="SELECT") el.addEventListener('change', ()=>{ fillSelectors(ctx); renderTable(ctx, currentUAOverride().UA); });
    });
  }

  // --- esperar datos (parche remoto) ---
  function waitForData(maxMs=5000, step=150){
    return new Promise(resolve=>{
      const t0=Date.now();
      (function tick(){
        const byArea = PV6.data?.areaHaByPot;
        const mov    = PV6.data?.movRows;
        if (byArea && Object.keys(byArea).length>0 && Array.isArray(mov) && mov.length>0){
          resolve(true); return;
        }
        if (Date.now()-t0>maxMs){ resolve(false); return; }
        setTimeout(tick, step);
      })();
    });
  }

  // --- init ---
  async function init(){
    ensureStyles(); ensureCard();

    const ok = await waitForData();
    const rows = Array.isArray(PV6.data?.movRows)? PV6.data.movRows: [];
    const idx  = buildIndexesFromMov(rows);

    const ctx = {
      dateEnd: toISO(PV6.state?.end || $('#date-end')?.value || (idx.dates[idx.dates.length-1] || "2025-12-31")),
      idx
    };

    fillSelectors(ctx);
    wireInputs();
    renderTable(ctx, 0);
    wire(ctx);

    console.log("[M2.10] listo — areaHa:", Object.keys(PV6.data?.areaHaByPot||{}).length, "movRows:", rows.length, "esperaOK:", ok);
  }

  // arranque
  if (PV6.onDataReady && typeof PV6.onDataReady==="function"){
    const prev = PV6.onDataReady.bind(PV6);
    PV6.onDataReady = function(){ try{ prev(); }catch(e){} init(); };
  }else{
    document.addEventListener('DOMContentLoaded', ()=>init(), {once:true});
  }
})();
