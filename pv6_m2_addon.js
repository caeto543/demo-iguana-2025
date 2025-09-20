/* PV6 M2.12 — Pastoreo con manejo (PV6)
   Destino sin Z, D0 sin uso, DFDN (120/FDN), φ=1−min(wmax,β·D), Daj=DFDN·φ
*/
(function(){
  "use strict";

  const PV6 = (window.PV6 = window.PV6 || {});
  PV6.state = PV6.state || {};
  const $ = (s, r=document)=>r.querySelector(s);
  const fmt1=v=> (v==null||!isFinite(v))? "–": Number(v).toFixed(1);
  const fmt2=v=> (v==null||!isFinite(v))? "–": Number(v).toFixed(2);
  const fmt3=v=> (v==null||!isFinite(v))? "–": Number(v).toFixed(3);

  // ---------- utils ----------
  function toISO(s){
    if(!s) return null; const t=String(s).trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m=t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if(m){const d=m[1].padStart(2,"0"),M=m[2].padStart(2,"0"),y=m[3];return `${y}-${M}-${d}`;}
    const dt=new Date(t); return isNaN(dt)?t:dt.toISOString().slice(0,10);
  }
  function ensureStyles(){
    if($('#pv6-m2-styles')) return;
    const st=document.createElement('style'); st.id='pv6-m2-styles';
    st.textContent=`
      #pv6-m2-card{background:#fff;border:1px solid #eee;border-radius:12px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,.06);margin-top:12px}
      #pv6-m2-card .row{display:flex;gap:10px;flex-wrap:wrap}
      #pv6-m2-card .col{flex:1 1 240px;min-width:220px}
      #pv6-m2-card .title{font-size:16px;margin:0;font-weight:600}
      #pv6-m2-card .badge{font-size:12px;background:#eef3ff;color:#335;padding:2px 6px;border-radius:8px}
      #pv6-m2-card .btn{padding:6px 10px;border-radius:8px;border:1px solid #ddd;background:#f7f7f7;cursor:pointer}
      #pv6-m2-card .btn:hover{background:#f0f0f0}
      #pv6-m2-card .inp{width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:8px}
      #pv6-m2-card .tbl{width:100%;border-collapse:separate;border-spacing:0}
      #pv6-m2-card .tbl thead th{position:sticky;top:0;background:#fafafa;z-index:1;text-align:right;padding:8px;font-weight:600;border-bottom:1px solid #eee}
      #pv6-m2-card .tbl thead th:first-child,#pv6-m2-card .tbl tbody td:first-child{text-align:left}
      #pv6-m2-card .tbl tbody td{padding:6px 8px;text-align:right;border-bottom:1px solid #f2f2f2}
      #pv6-m2-tip{color:#666;font-size:12px} #pv6-m2-note{font-size:12px;color:#555;margin-left:8px}
      #pv6-m2-grid{display:grid;grid-template-columns:repeat(3,minmax(110px,1fr));gap:8px}
      #pv6-m2-grid label{font-size:12px;color:#444}
    `;
    document.head.appendChild(st);
  }
  function resolveAnchor(){
    const sim=[...document.querySelectorAll("h1,h2,h3,h4,strong")]
      .find(h=>/Simular pastoreo\s*\(sin manejo\)/i.test(h.textContent||""));
    if(sim && sim.parentNode) return {node:sim.parentNode,mode:"before"};
    const right = $('#pv6-m2-slot') || $('#panel-derecho') || $('#right-panel') || $('.col-right') || $('#sidebar');
    if(right) return {node:right,mode:"append"};
    const mapW = $('#map')?.parentNode || document.body;
    return {node:mapW,mode:"afterMap"};
  }
  function ensureCard(){
    let card=$('#pv6-m2-card'); if(card) return card;
    const {node,mode}=resolveAnchor();
    card=document.createElement('div'); card.id='pv6-m2-card';
    card.innerHTML=`
      <div class="row" style="align-items:center;gap:8px">
        <h3 class="title">Pastoreo con manejo (PV6)</h3><span class="badge">M2.12</span><span id="pv6-m2-note"></span>
        <div style="flex:1"></div>
        <button id="pv6-m2-btn-recalc" class="btn">Recalcular sugeridos</button>
        <button id="pv6-m2-btn-clear" class="btn">Limpiar</button>
      </div>
      <div class="row" style="margin-top:10px">
        <div class="col"><label>Origen (ocupados)</label><select id="pv6-m2-origen" class="inp"></select></div>
        <div class="col"><label>Destino</label><select id="pv6-m2-dest" class="inp"></select></div>
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
            <th>Potrero</th><th>Kg MS/ha</th><th>Días br.</th><th>Días FDN</th><th>φ(D)</th><th>Días aj.</th><th>Estado</th>
          </tr></thead><tbody></tbody>
        </table>
      </div>`;
    if(mode==="before") node.parentNode.insertBefore(card,node);
    else if(mode==="append") node.appendChild(card);
    else { const map=$('#map'); if(map&&map.parentNode) map.parentNode.insertBefore(card,map.nextSibling); else node.appendChild(card); }
    return card;
  }

  // ---------- filtros / datos ----------
  const isZ = nm => nm.split(/[_-]/).some(seg=>/^z(\d+)?$/i.test(seg));
  function allPots(){
    const byArea = PV6.data?.areaHaByPot || {};
    return Object.keys(byArea).filter(nm=>!isZ(nm)).sort();
  }
  function kgForPot(pot, endISO){
    try{
      if(typeof PV6.kgForPot==="function") return PV6.kgForPot(pot,endISO);
      if(PV6.ui && typeof PV6.ui.kgForPot==="function") return PV6.ui.kgForPot(pot,endISO);
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
  function classify(kg, dateISO){
    try{
      if (PV6.ui && typeof PV6.ui.stateForKg==="function") return PV6.ui.stateForKg(kg,dateISO);
      if (typeof window.stateForKg==="function") return window.stateForKg(kg,dateISO);
    }catch(e){} return "";
  }

  // ---------- MOV índices ----------
  function buildIdx(rows){
    const uaIdx={}, occIdx={}, dates=new Set();
    const arr=[...rows].map(r=>({
      date: toISO(r.date), pot:String(r.name_canon??"").trim(),
      ua:Number(r.UA_total??0)||0,
      occ:(r.ocupado==null||r.ocupado==="")?null:(Number(r.ocupado)>0?1:0)
    })).filter(r=>r.pot&&r.date).sort((a,b)=>a.date.localeCompare(b.date));
    for(const r of arr){
      (uaIdx [r.pot] ||= {})[r.date]=r.ua;
      (occIdx[r.pot] ||= {})[r.date]=r.occ;
      dates.add(r.date);
    }
    return {uaIdx,occIdx,dates:[...dates].sort()};
  }
  function lastOnOrBefore(idx,pot,iso,def=null){
    const rec=idx?.[pot]; if(!rec) return def; let best=def,bd="";
    for(const d in rec){ const k=toISO(d); if(k && k<=iso && k>=bd){ best=rec[d]; bd=k; } }
    return best;
  }
  function ocupadosAFecha(endISO, idx){
    const out=[]; for(const p of allPots()){
      const occ=lastOnOrBefore(idx.occIdx,p,endISO,null);
      if(occ!=null){ if(Number(occ)>0) out.push(p); continue; }
      const ua =lastOnOrBefore(idx.uaIdx ,p,endISO,0);
      if(ua>0) out.push(p);
    }
    if(out.length) return out.sort();
    // Fallback DOM chips
    const blocks=[...document.querySelectorAll("body *")].filter(el=>/\bOcupados\s*\(\d+\)/i.test(el.textContent||""));
    const set=new Set(); blocks.forEach(b=>{
      b.querySelectorAll("a,button,span,div").forEach(e=>{
        const t=(e.textContent||"").trim(); const m=/^([A-Za-z0-9_]+)\b/.exec(t); if(m) set.add(m[1]);
      });
    });
    return [...set].filter(n=>!isZ(n)).sort();
  }

  // ---------- inputs ----------
  function currentUA(){
    const auKg = Number(PV6.defaults?.auKg ?? PV6.state?.auKg ?? 450) || 450;
    const UA   = Number($('#pv6-ua')?.value || 0);
    const PVkg = Number($('#pv6-pvkg')?.value || 0);
    const N    = Number($('#pv6-n')?.value || 0);
    if(UA>0) return {UA,lock:"ua"};
    if(PVkg>0) return {UA:PVkg/auKg,lock:"pv"};
    if(N>0) return {UA:N,lock:"n"};
    return {UA:0,lock:null};
  }
  function wireInputs(onChange){
    const ua=$('#pv6-ua'), pv=$('#pv6-pvkg'), n=$('#pv6-n');
    function sync(){ const {lock}=currentUA();
      ua.disabled=(lock&&lock!=="ua"); pv.disabled=(lock&&lock!=="pv"); n.disabled=(lock&&lock!=="n");
      onChange();
    }
    [ua,pv,n].forEach(el=>el&&el.addEventListener('input',sync)); sync();
  }

  // ---------- DÍAS ----------
  function getFDN(p){
    const D=PV6.data||{};
    let v = (D.fdnByPot?.[p] ?? D.FNDByPot?.[p] ?? D.fdn_by_pot?.[p] ?? null);
    if(v==null) v = PV6.defaults?.fdn_default ?? 0.6; // 0.6 ≈ 60%
    v = Number(v);
    if(!isFinite(v)) v = 0.6;
    if(v>1.5) v = v/100; // si viene 69 -> 0.69
    return Math.min(Math.max(v,0.3),0.9); // clamp
  }
  function daysFromM3(pot,endISO,UAovr){
    const fn = (typeof PV6.computeDays==="function") ? PV6.computeDays
             : (PV6.M3 && typeof PV6.M3.computeDays==="function") ? PV6.M3.computeDays
             : null;
    if(!fn) return null;
    try{ return fn(pot,endISO,UAovr||0); }catch(e){ return null; }
  }
  function calcDaysFallback(pot,endISO,UAovr){
    const kg   = kgForPot(pot,endISO)||0;
    const area = Number(PV6.data?.areaHaByPot?.[pot]||0);
    const cons = Number(PV6.state?.consumo ?? 10);           // kg/UA/d
    const auKg = Number(PV6.defaults?.auKg ?? PV6.state?.auKg ?? 450);
    const ua   = Math.max(UAovr||0, 0.0001);

    // D0 (sin uso)
    const d0 = (kg*area) / (ua*cons);

    // FDN -> consumo real por UA según 120/FDN%
    const fdn = getFDN(pot);                 // 0..1
    const pct = (120/(fdn*100));             // ej 120/70 = 1.714% PV
    const cons_fdn = auKg * (pct/100);       // kg/UA/d
    const dfdn = (kg*area) / (ua*cons_fdn);

    // desperdicio φ(D) = 1 − min(wmax, β·D_fdn)
    const beta = Number(PV6.defaults?.params?.beta ?? PV6.defaults?.beta ?? 0.05);
    const wmax = Number(PV6.defaults?.params?.wmax ?? PV6.defaults?.wmax ?? 0.3);
    const phi  = Math.max(0, 1 - Math.min(wmax, beta * dfdn));

    const dadj = dfdn * phi;
    return {d0, dfdn, phi, dadj};
  }
  function mapDays(obj, pot,endISO,UAovr){
    if(obj){
      const d0   = (obj.d0   ?? obj.d_bruto ?? obj.days ?? null);
      const dfdn = (obj.dfdn ?? obj.fdnDays ?? obj.daysFdn ?? null);
      const phi  = (obj.phi  ?? obj.phiD    ?? obj.wastePhi ?? null);
      const dadj = (obj.dadj ?? obj.daysAdj ?? obj.d_aj ?? null);
      if([d0,dfdn,phi,dadj].every(v=>v!=null && isFinite(v))) return {d0,dfdn,phi,dadj};
    }
    return calcDaysFallback(pot,endISO,UAovr);
  }

  // ---------- render ----------
  function renderTable(ctx, UAovr){
    const tb=$('#pv6-m2-tab tbody'); if(!tb) return; tb.innerHTML="";
    const endISO=ctx.dateEnd;
    const pots=allPots();
    for(const nm of pots){
      const kg = kgForPot(nm,endISO);
      const st = (kg!=null)? classify(kg,endISO):"";
      const d  = mapDays(daysFromM3(nm,endISO,UAovr), nm,endISO,UAovr);
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

  function fillSelectors(ctx){
    const selO=$('#pv6-m2-origen'), selD=$('#pv6-m2-dest'), note=$('#pv6-m2-note');
    if(!selO||!selD) return; selO.innerHTML=""; selD.innerHTML=""; note.textContent="";

    // origen (ocupados)
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

    // destino (todos sin Z)
    const op0=document.createElement('option'); op0.value="__NONE__"; op0.textContent="— Ningún potrero (salida de finca) —"; selD.appendChild(op0);
    allPots().forEach(nm=>{
      const kg=kgForPot(nm,ctx.dateEnd); const st=(kg!=null)? classify(kg,ctx.dateEnd):"";
      const op=document.createElement('option'); op.value=nm; op.textContent= st? `${nm} (${st})` : nm; selD.appendChild(op);
    });
  }

  // ---------- wait & init ----------
  function waitForData(maxMs=7000, step=150){
    return new Promise(res=>{
      const t0=Date.now(); (function tick(){
        const ok = (PV6.data?.areaHaByPot && Object.keys(PV6.data.areaHaByPot).length>0 &&
                    Array.isArray(PV6.data?.movRows) && PV6.data.movRows.length>0);
        if(ok) return res(true);
        if(Date.now()-t0>maxMs) return res(false);
        setTimeout(tick, step);
      })();
    });
  }

  async function init(){
    ensureStyles(); ensureCard();
    await waitForData();

    const rows = Array.isArray(PV6.data?.movRows)? PV6.data.movRows: [];
    const idx  = buildIdx(rows);

    const ctx = {
      dateEnd: toISO(PV6.state?.end || $('#date-end')?.value || (idx.dates[idx.dates.length-1] || "2025-12-31")),
      idx
    };

    fillSelectors(ctx);
    const recalc = ()=> renderTable(ctx, currentUA().UA);

    // eventos
    $('#pv6-m2-btn-recalc')?.addEventListener('click', recalc);
    $('#pv6-m2-btn-clear')?.addEventListener('click', ()=>{ ['#pv6-ua','#pv6-pvkg','#pv6-n'].forEach(id=>{ const el=$(id); if(el) el.value=""; }); renderTable(ctx, 0); });
    const end=$('#date-end'); if(end) end.addEventListener('change', ()=>{ ctx.dateEnd=toISO(end.value); fillSelectors(ctx); recalc(); });
    ["fuente","source","sel-fuente","select-fuente"].forEach(id=>{
      const el=document.getElementById(id); if(el && el.tagName==="SELECT") el.addEventListener('change', ()=>{ fillSelectors(ctx); recalc(); });
    });
    wireInputs(recalc);

    // primer render
    renderTable(ctx, 0);
    console.log("[M2.12] listo — movRows:", rows.length);
  }

  if(PV6.onDataReady && typeof PV6.onDataReady==="function"){
    const prev=PV6.onDataReady.bind(PV6);
    PV6.onDataReady=function(){ try{prev();}catch(e){} init(); };
  }else{
    document.addEventListener('DOMContentLoaded', ()=>init(), {once:true});
  }
})();
