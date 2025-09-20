/* PV6 M2.6 — Pastoreo con manejo (PV6)
   - MOV explícito: PV6.data.movRows con keys: name_canon, date, UA_total, PV_total_kg, N_total, DSL, ocupado
   - Si no hay ocupados a la fecha, retrocede a última fecha con ocupados y actualiza #date-end visible.
   - Anclaje: antes de “Simular pastoreo (sin manejo)”; si no existe, usa #pv6-m2-slot / panel derecho / debajo del mapa.
   - Tabla: Kg, Días br., Días FDN, φ(D), Días aj., Estado. Usa PV6.computeDays si está (parche M3).
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

  // ---------- utils ----------
  function toISO(s){
    if (!s) return null;
    const str=String(s).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const m=str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m){ const d=m[1].padStart(2,"0"), M=m[2].padStart(2,"0"), y=m[3]; return `${y}-${M}-${d}`; }
    const dt=new Date(str); return isNaN(dt)?str:dt.toISOString().slice(0,10);
  }
  function ensureStyles(){
    if ($('#pv6-m2-styles')) return;
    const st = document.createElement('style');
    st.id = 'pv6-m2-styles';
    st.textContent = `
      #pv6-m2-card{ background:#fff; border:1px solid #eee; border-radius:12px; padding:12px; box-shadow:0 1px 3px rgba(0,0,0,.06); margin-top:12px;}
      #pv6-m2-card .row{ display:flex; gap:10px; flex-wrap:wrap;}
      #pv6-m2-card .col{ flex:1 1 240px; min-width:240px;}
      #pv6-m2-card .title{ font-size:16px; margin:0; font-weight:600;}
      #pv6-m2-card .badge{ font-size:12px; background:#eef3ff; color:#335; padding:2px 6px; border-radius:8px;}
      #pv6-m2-card .btn{ padding:6px 10px; border-radius:8px; border:1px solid #ddd; background:#f7f7f7; cursor:pointer;}
      #pv6-m2-card .btn:hover{ background:#f0f0f0;}
      #pv6-m2-card .btn-light{ background:#fff;}
      #pv6-m2-card .inp{ width:100%; padding:6px 8px; border:1px solid #ddd; border-radius:8px;}
      #pv6-m2-card .tbl{ width:100%; border-collapse:separate; border-spacing:0;}
      #pv6-m2-card .tbl thead th{ position:sticky; top:0; background:#fafafa; z-index:1; text-align:right; padding:8px; font-weight:600; border-bottom:1px solid #eee;}
      #pv6-m2-card .tbl thead th:first-child, #pv6-m2-card .tbl tbody td:first-child{ text-align:left;}
      #pv6-m2-card .tbl tbody td{ padding:6px 8px; text-align:right; border-bottom:1px solid #f2f2f2;}
      #pv6-m2-tip{ color:#666; font-size:12px;}
      #pv6-m2-note{ font-size:12px; color:#555; margin-left:8px;}
    `;
    document.head.appendChild(st);
  }

  // ---------- anclaje controlado ----------
  function resolveAnchor(){
    // 1) Antes de “Simular pastoreo (sin manejo)”
    const sim = [...document.querySelectorAll("h1,h2,h3,h4,strong")]
      .find(h => /Simular pastoreo\s*\(sin manejo\)/i.test(h.textContent||""));
    if (sim && sim.parentNode) return {node: sim.parentNode, mode: "before"};
    // 2) slot / panel derecho
    const right = $('#pv6-m2-slot') || $('#panel-derecho') || $('#right-panel') || $('.col-right') || $('#sidebar');
    if (right) return {node: right, mode: "append"};
    // 3) debajo del mapa (fallback)
    const mapWrapper = $('#map')?.parentNode || document.body;
    return {node: mapWrapper, mode: "afterMap"};
  }
  function ensureCard(){
    let card = $('#pv6-m2-card');
    if (card) return card;
    const {node, mode} = resolveAnchor();
    card = document.createElement('div');
    card.id = 'pv6-m2-card';
    card.innerHTML = `
      <div class="row" style="align-items:center; gap:8px;">
        <h3 class="title">Pastoreo con manejo (PV6)</h3>
        <span class="badge">M2.6</span>
        <span id="pv6-m2-note"></span>
        <div style="flex:1 1 auto;"></div>
        <button id="pv6-m2-btn-recalc" class="btn">Recalcular sugeridos</button>
        <button id="pv6-m2-btn-clear" class="btn btn-light">Limpiar</button>
      </div>
      <div class="row" style="margin-top:10px;">
        <div class="col">
          <label>Origen (ocupados)</label>
          <select id="pv6-m2-origen" class="inp"></select>
        </div>
        <div class="col">
          <label>Destino</label>
          <select id="pv6-m2-dest" class="inp"></select>
        </div>
      </div>
      <div style="overflow:auto; margin-top:10px; max-height:360px;">
        <table id="pv6-m2-tab" class="tbl">
          <thead>
            <tr>
              <th style="min-width:180px">Potrero</th>
              <th style="min-width:90px">Kg MS/ha</th>
              <th style="min-width:80px">Días br.</th>
              <th style="min-width:90px">Días FDN</th>
              <th style="min-width:70px">φ(D)</th>
              <th style="min-width:90px">Días aj.</th>
              <th style="min-width:90px">Estado</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <div id="pv6-m2-tip" style="margin-top:6px">
        Tip: Si escribes UA se bloquean PV/N; si PV ⇒ UA con auKg; si N ⇒ UA con N.
      </div>
    `;
    if (mode==="before") node.parentNode.insertBefore(card, node);
    else if (mode==="append") node.appendChild(card);
    else {
      const map = $('#map'); if (map && map.parentNode) map.parentNode.insertBefore(card, map.nextSibling);
      else node.appendChild(card);
    }
    return card;
  }

  // ---------- helpers data ----------
  function classify(kg, dateISO){
    try{
      if (PV6.ui && typeof PV6.ui.stateForKg === "function") return PV6.ui.stateForKg(kg, dateISO);
      if (typeof window.stateForKg === "function") return window.stateForKg(kg, dateISO);
    }catch(e){}
    return "";
  }
  function allPots(){
    if (PV6.allPots && typeof PV6.allPots==="function") return PV6.allPots();
    const byArea = PV6.data?.areaHaByPot || {};
    return Object.keys(byArea).sort();
  }
  function kgForPotNow(pot, dateISO){
    try{
      if (typeof PV6.kgForPot === "function") return PV6.kgForPot(pot, dateISO);
      if (PV6.ui && typeof PV6.ui.kgForPot === "function") return PV6.ui.kgForPot(pot, dateISO);
    }catch(e){}
    try{
      const D = PV6.data || {};
      const src = (PV6.state?.fuente||"kgms_7d").toLowerCase().includes("raw") ? "kgmsRaw" : "kgms7d";
      const map = D[src+"ByPot"] || D[src] || D[(src==="kgmsRaw"?"kg_by_pot":"kgms_by_pot")] || {};
      const series = map[pot];
      if (!series) return null;
      const keys = Object.keys(series).filter(k=>/^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
      if (!keys.length) return Number(series) || null;
      const d0 = dateISO || PV6.state?.end || keys[keys.length-1];
      const idx = keys.findIndex(k=>k>=d0);
      const pick = (idx<0) ? keys[keys.length-1] : (keys[idx]===d0 ? d0 : keys[Math.max(0,idx-1)]);
      return Number(series[pick]) || null;
    }catch(e){ return null; }
  }

  // ---------- MOV explícito (según tu consola) ----------
  function getMovRows(){
    const D = PV6.data || {};
    const arr = Array.isArray(D.movRows) ? D.movRows : [];
    return arr;
  }
  function buildIndexesFromMov(rows){
    const uaIdx={}, occIdx={};
    const sorted=[...rows].map(r=>({
      date: toISO(r.date),
      pot : String(r.name_canon??"").trim(),
      ua  : Number(r.UA_total ?? 0) || 0,
      occ : (r.ocupado===undefined || r.ocupado===null || r.ocupado==="") ? null : (Number(r.ocupado)>0?1:0)
    })).filter(r=>r.pot && r.date).sort((a,b)=>a.date.localeCompare(b.date));
    for(const r of sorted){
      (uaIdx [r.pot] ||= {})[r.date]=r.ua;
      (occIdx[r.pot] ||= {})[r.date]=r.occ;
    }
    const dates = Array.from(new Set(sorted.map(r=>r.date))).sort();
    return {uaIdx, occIdx, dates};
  }
  function lastOnOrBefore(idx,pot,dateISO,def=0){
    const recs=idx?.[pot]; if(!recs) return def; let best=def, bd="";
    for(const d in recs){ const iso=toISO(d); if(iso && iso<=dateISO && iso>=bd){ best=recs[d]; bd=iso; } }
    return best;
  }

  // ---------- ocupados ----------
  function ocupadosAFecha(endISO, idxes){
    // helpers app primero
    const tryFns = [
      PV6.ui?.ocupadosAt, PV6.ocupadosAt,
      PV6.ui?.ocupadosNow, PV6.ocupadosNow,
      PV6.ui?.listOcupados, PV6.listOcupados,
      PV6.ui?.getOcupados, PV6.getOcupados
    ].filter(fn=>typeof fn==="function");
    for (const fn of tryFns){
      try{
        const r = fn.call(PV6.ui||PV6, endISO);
        if (Array.isArray(r) && r.length) return r.slice().map(String);
      }catch(e){}
    }
    // occByPot
    const occMap = PV6.state?.occByPot || PV6.ui?.occByPot || null;
    if (occMap){
      const out = []; for (const k in occMap){ if (occMap[k]) out.push(k); }
      if (out.length) return out.sort();
    }
    // MOV explícito
    const out=[];
    const pots = allPots();
    for (const p of pots){
      const occ = lastOnOrBefore(idxes.occIndex, p, endISO, null);
      if (occ!==null){ if (Number(occ)>0) out.push(p); continue; }
      const ua  = lastOnOrBefore(idxes.uaIndex , p, endISO, 0);
      if (ua>0) out.push(p);
    }
    return out.sort();
  }

  // ---------- selectores ----------
  function fillSelectors(ctx){
    const selO = $('#pv6-m2-origen'), selD = $('#pv6-m2-dest');
    const note = $('#pv6-m2-note');
    if(!selO || !selD) return;
    selO.innerHTML=""; selD.innerHTML="";
    note.textContent = "";

    let origenes = ocupadosAFecha(ctx.dateEnd, ctx.idx);
    if (!origenes.length){
      // retroceder a última fecha con ocupados Y reflejarlo en UI
      for(let i=ctx.idx.dates.length-1;i>=0;i--){
        const dd = ctx.idx.dates[i];
        const o2 = ocupadosAFecha(dd, ctx.idx);
        if (o2.length){
          ctx.dateEnd = dd;
          const inp=$('#date-end'); if(inp) inp.value=dd;
          origenes = o2;
          note.textContent = `Fecha ajustada a ${dd} para mostrar “ocupados”.`;
          break;
        }
      }
    }
    if(!origenes.length){
      const op = document.createElement('option');
      op.value=""; op.textContent="(no hay ocupados a la fecha)";
      selO.appendChild(op);
    }else{
      origenes.forEach(nm=>{
        const op=document.createElement('option'); op.value=nm; op.textContent=nm; selO.appendChild(op);
      });
    }

    const op0=document.createElement('option');
    op0.value="__NONE__"; op0.textContent="— Ningún potrero (salida de finca) —";
    selD.appendChild(op0);

    const endISO = ctx.dateEnd;
    const pots = allPots();
    pots.forEach(nm=>{
      const kg = kgForPotNow(nm, endISO);
      const st = (kg!=null) ? classify(kg, endISO) : "";
      const op = document.createElement('option');
      op.value=nm; op.textContent = st ? `${nm} (${st})` : nm;
      selD.appendChild(op);
    });
  }

  // ---------- tabla ----------
  function renderTable(ctx, uaOverride){
    const tb = $('#pv6-m2-tab tbody');
    if(!tb) return;
    tb.innerHTML="";

    const endISO = ctx.dateEnd;
    const pots = allPots();

    for(const nm of pots){
      const kg = kgForPotNow(nm, endISO);
      const st = (kg!=null) ? classify(kg, endISO) : "";

      let d = {d0:0, dfdn:0, phi:1, dadj:0};
      try{
        if (typeof PV6.computeDays === "function"){
          d = PV6.computeDays(nm, endISO, uaOverride||0);
        }else{
          const area = PV6.data?.areaHaByPot?.[nm] || 0;
          const uso  = (PV6.state?.coefUso ?? 60)/100;
          const cons = PV6.state?.consumo ?? 10;
          const dem  = (uaOverride||0)*cons;
          const D0   = (kg && area && dem) ? (kg*area*uso/dem) : 0;
          d = {d0:D0, dfdn:D0, phi:1, dadj:D0};
        }
      }catch(e){ /* noop */ }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="text-align:left">${nm}</td>
        <td>${fmt3(kg)}</td>
        <td>${fmt1(d.d0)}</td>
        <td>${fmt1(d.dfdn)}</td>
        <td>${fmt2(d.phi)}</td>
        <td>${fmt1(d.dadj)}</td>
        <td>${st||"—"}</td>
      `;
      tb.appendChild(tr);
    }
  }

  // ---------- eventos ----------
  function wire(ctx){
    $('#pv6-m2-btn-recalc')?.addEventListener('click', ()=>{
      const inpUA = document.getElementById('pv6-ua-input'); // si existe en tu app
      const UA = inpUA ? Number(inpUA.value||0) : 0;
      renderTable(ctx, UA);
    });
    $('#pv6-m2-btn-clear')?.addEventListener('click', ()=> renderTable(ctx, 0));

    const end=document.getElementById("date-end");
    if (end) end.addEventListener("change", ()=>{
      ctx.dateEnd = toISO(end.value);
      fillSelectors(ctx); renderTable(ctx, ctx.uaOverride||0);
    });
    ["fuente","source","sel-fuente","select-fuente"].forEach(id=>{
      const el=document.getElementById(id);
      if(el && el.tagName==="SELECT")
        el.addEventListener("change", ()=>{ fillSelectors(ctx); renderTable(ctx, ctx.uaOverride||0); });
    });
  }

  // ---------- init ----------
  function init(){
    ensureStyles(); ensureCard();

    const rows = getMovRows();                     // <- movRows explícito
    const idx  = buildIndexesFromMov(rows);        // {uaIndex, occIndex, dates}

    const ctx = {
      dateEnd: toISO(PV6.state?.end || $('#date-end')?.value || (idx.dates[idx.dates.length-1] || "2025-12-31")),
      uaOverride: 0,
      idx
    };

    fillSelectors(ctx);
    renderTable(ctx, 0);
    wire(ctx);

    console.log("[M2.6] UI con trazas Dbr/Dfdn/φ/Daj lista (MOV explícito + anclaje controlado).");
  }

  if (PV6.onDataReady && typeof PV6.onDataReady === "function"){
    const prev = PV6.onDataReady.bind(PV6);
    PV6.onDataReady = function(){
      try{ prev(); }catch(e){}
      try{ init(); }catch(e){ console.warn("[M2.6] init warn:", e); }
    };
  }else{
    document.addEventListener('DOMContentLoaded', ()=>setTimeout(init, 400), {once:true});
  }
})();
