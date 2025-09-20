/* PV6 M2.4 — Pastoreo con manejo (PV6) con trazas Dbr/Dfdn/φ/Daj.
   - Origen: solo ocupados a la fecha-hasta.
   - Destino: “salida de finca” + todos los potreros (con estado).
   - Tabla ordenada, cabeceras alineadas y estilos mínimos.
   - Recalcula usando PV6.computeDays (provisto por el parche M3).
*/
(function(){
  "use strict";

  // -------------------- atajos y utils --------------------
  const PV6 = (window.PV6 = window.PV6 || {});
  const ST  = (PV6.state = PV6.state || {});
  const $   = (s, r=document)=>r.querySelector(s);
  const $$  = (s, r=document)=>Array.from(r.querySelectorAll(s));
  const fmt1= v=> (v==null||!isFinite(v))? "–": Number(v).toFixed(1);
  const fmt2= v=> (v==null||!isFinite(v))? "–": Number(v).toFixed(2);
  const fmt3= v=> (v==null||!isFinite(v))? "–": Number(v).toFixed(3);

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
    `;
    document.head.appendChild(st);
  }

  // -------------------- UI principal --------------------
  function ensureCard(){
    let card = $('#pv6-m2-card');
    if (card) return card;
    card = document.createElement('div');
    card.id = 'pv6-m2-card';
    card.innerHTML = `
      <div class="row" style="align-items:center; gap:8px;">
        <h3 class="title">Pastoreo con manejo (PV6)</h3>
        <span class="badge">M2.4</span>
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
    // Inserta el card justo debajo del mapa (o del contenedor donde lo uses)
    const anchor = document.querySelector('#map') || document.querySelector('#mapa') || document.body;
    anchor.parentNode.insertBefore(card, anchor.nextSibling);
    return card;
  }

  // -------------------- data helpers --------------------
  function classify(kg, dateISO){
    try{
      if (PV6.ui && typeof PV6.ui.stateForKg === "function") return PV6.ui.stateForKg(kg, dateISO);
      if (typeof window.stateForKg === "function") return window.stateForKg(kg, dateISO);
    }catch(e){}
    return "";
  }

  function ocupadosAFecha(endISO){
    // Preferir un helper de PV6 si existe
    if (PV6.ocupadosNow && typeof PV6.ocupadosNow === "function"){
      const r = PV6.ocupadosNow(endISO);
      return Array.isArray(r)? r.slice() : [];
    }
    // Fallback: a partir de MOV (si PV6.exposeMov existe) o del último flag/UA>0
    try{
      const M = PV6.mov || PV6.data?.movRows || [];
      const acc = new Map(); // pot -> {date, ua}
      const cutoff = endISO ? new Date(endISO) : null;
      for(const row of M){
        const nm = row.name_canon || row.padre || row.potrero || row.name;
        if(!nm) continue;
        const d  = row.date ? new Date(row.date) : null;
        if(cutoff && d && d>cutoff) continue;
        const ua = Number(row.UA_total||row.UA||row.ua||row.ua_total||0)||0;
        const prev = acc.get(nm);
        if(!prev || (d && prev.date && d>prev.date) || (d && !prev.date)){
          acc.set(nm, {date:d, ua});
        }
      }
      const out=[];
      acc.forEach((v,k)=>{ if(v.ua>0) out.push(k); });
      return out;
    }catch(e){ return []; }
  }

  function allPots(){
    if (PV6.allPots && typeof PV6.allPots==="function") return PV6.allPots();
    const byArea = PV6.data?.areaHaByPot || {};
    return Object.keys(byArea).sort();
  }

  // -------------------- selectores --------------------
  function fillSelectors(){
    const selO = $('#pv6-m2-origen'), selD = $('#pv6-m2-dest');
    if(!selO || !selD) return;
    selO.innerHTML=""; selD.innerHTML="";

    const endISO = PV6.state?.end;
    const origenes = ocupadosAFecha(endISO).sort();
    if(!origenes.length){
      const op = document.createElement('option');
      op.value=""; op.textContent="(no hay ocupados a la fecha)";
      selO.appendChild(op);
    }else{
      origenes.forEach(nm=>{
        const op=document.createElement('option');
        op.value=nm; op.textContent=nm;
        selO.appendChild(op);
      });
    }

    const op0=document.createElement('option');
    op0.value="__NONE__"; op0.textContent="— Ningún potrero (salida de finca) —";
    selD.appendChild(op0);

    const todos = allPots();
    todos.forEach(nm=>{
      const kg = PV6.kgForPotNow ? PV6.kgForPotNow(nm, endISO) : null;
      const st = classify(kg, endISO);
      const op = document.createElement('option');
      op.value=nm; op.textContent = st ? `${nm} (${st})` : nm;
      selD.appendChild(op);
    });
  }

  // -------------------- tabla --------------------
  function renderTable(uaOverride){
    const tb = $('#pv6-m2-tab tbody');
    if(!tb) return;
    tb.innerHTML="";

    const endISO = PV6.state?.end;
    const pots = allPots();

    for(const nm of pots){
      const kg = PV6.kgForPotNow ? PV6.kgForPotNow(nm, endISO) : null;
      const st = classify(kg, endISO);
      let d = {d0:0, dfdn:0, phi:1, dadj:0};
      try{
        if (typeof PV6.computeDays === "function"){
          d = PV6.computeDays(nm, endISO, uaOverride||0);
        }
      }catch(e){ /*noop*/ }

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

  // -------------------- eventos --------------------
  function wire(){
    $('#pv6-m2-btn-recalc')?.addEventListener('click', ()=>{
      const inpUA = document.getElementById('pv6-ua-input'); // si existe en tu app
      const UA = inpUA ? Number(inpUA.value||0) : 0;
      renderTable(UA);
    });

    $('#pv6-m2-btn-clear')?.addEventListener('click', ()=>{
      renderTable(0);
    });
  }

  // -------------------- init --------------------
  function init(){
    ensureStyles();
    ensureCard();
    fillSelectors();
    renderTable(0);
    wire();
    console.log("[M2.4] UI con trazas Dbr/Dfdn/φ/Daj lista.");
  }

  // arrancar cuando haya datos
  if (PV6.onDataReady && typeof PV6.onDataReady === "function"){
    const prev = PV6.onDataReady.bind(PV6);
    PV6.onDataReady = function(){
      try{ prev(); }catch(e){}
      try{ init(); }catch(e){ console.warn("[M2.4] init warn:", e); }
    };
  }else{
    document.addEventListener('DOMContentLoaded', ()=>setTimeout(init, 400), {once:true});
  }
})();
