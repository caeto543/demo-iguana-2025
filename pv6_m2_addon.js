/* PV6 M2.4 — “Pastoreo con manejo (PV6)” con trazas Dbr/Dfdn/φ/Daj */
(function(){
  const A = window.PV6 || (window.PV6 = {});
  const ST = (A.state = A.state || {});

  // ---- helpers UI ----
  const $ = (sel,root=document)=>root.querySelector(sel);
  const $$= (sel,root=document)=>Array.from(root.querySelectorAll(sel));
  const fmt1 = v => (v==null || !isFinite(v)) ? "–" : Number(v).toFixed(1);
  const fmt2 = v => (v==null || !isFinite(v)) ? "–" : Number(v).toFixed(2);

  // monta (o reutiliza) el card “Con manejo”
  function ensureCard(){
    let card = $('#pv6-m2-card');
    if (card) return card;
    card = document.createElement('div');
    card.id = 'pv6-m2-card';
    card.className = 'card card-shadow';
    card.style.padding = '8px';
    card.innerHTML = `
      <div class="flex items-center gap-2">
        <h3 class="title">Pastoreo con manejo (PV6)</h3>
        <span class="badge">M2.4</span>
        <div style="margin-left:auto"></div>
        <button id="pv6-m2-btn-recalc" class="btn">Recalcular sugeridos</button>
        <button id="pv6-m2-btn-clear" class="btn btn-light">Limpiar</button>
      </div>
      <div class="row" style="margin-top:8px">
        <div class="col">
          <label>Origen (ocupados)</label>
          <select id="pv6-m2-origen" class="inp"></select>
        </div>
        <div class="col">
          <label>Destino</label>
          <select id="pv6-m2-dest" class="inp"></select>
        </div>
      </div>
      <div style="overflow:auto; margin-top:8px">
        <table id="pv6-m2-tab" class="tbl">
          <thead>
            <tr>
              <th>Potrero</th>
              <th>Kg MS/ha</th>
              <th>Días br.</th>
              <th>Días FDN</th>
              <th>φ(D)</th>
              <th>Días aj.</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
        <div class="muted" id="pv6-m2-tip" style="margin-top:6px">
          Tip: Si escribes UA se bloquean PV/N; si PV ⇒ UA con auKg; si N ⇒ UA con N.
        </div>
      </div>
    `;
    // Inserta debajo del mapa (o donde prefieras)
    const anchor = document.querySelector('#map') || document.body;
    anchor.parentNode.insertBefore(card, anchor.nextSibling);
    return card;
  }

  // estados/colores reutilizando tu clasificación si existe
  function classify(kg, dateISO){
    try{
      if (A.ui && typeof A.ui.stateForKg === "function") return A.ui.stateForKg(kg, dateISO);
      if (typeof window.stateForKg === "function") return window.stateForKg(kg, dateISO);
    }catch(e){}
    return null;
  }

  // llena combos
  function fillSelectors(){
    const selO = $('#pv6-m2-origen'), selD = $('#pv6-m2-dest');
    if (!selO || !selD) return;
    selO.innerHTML = ""; selD.innerHTML = "";

    // Origen: estrictamente ocupados a la fecha hasta
    const endISO = A.state?.end;
    const occs = (A.ocupadosNow && typeof A.ocupadosNow === "function")
      ? A.ocupadosNow(endISO) : (A.listOcupados ? A.listOcupados(endISO) : []);
    const origenes = Array.isArray(occs) ? occs : [];
    origenes.forEach(nm=>{
      const op = document.createElement('option');
      op.value = nm; op.textContent = nm;
      selO.appendChild(op);
    });

    // Destino: opción de salida + todos los potreros
    const op0 = document.createElement('option');
    op0.value = "__NONE__"; op0.textContent = "— Ningún potrero (salida de finca) —";
    selD.appendChild(op0);

    const todos = (A.allPots && typeof A.allPots === "function") ? A.allPots() : Object.keys(A.data?.areaHaByPot||{});
    todos.sort().forEach(nm=>{
      const kg = A.kgForPotNow ? A.kgForPotNow(nm, endISO) : null;
      const st = classify(kg, endISO);
      const op = document.createElement('option');
      op.value = nm; op.textContent = nm + (st ? ` (${st})` : "");
      selD.appendChild(op);
    });
  }

  // render tabla (usa PV6.computeDays del parche M3)
  function renderTable(uaOverride){
    const tb = $('#pv6-m2-tab tbody');
    if (!tb) return;
    tb.innerHTML = "";

    const endISO = A.state?.end;
    const pots = (A.allPots && A.allPots()) || Object.keys(A.data?.areaHaByPot||{});
    pots.sort().forEach(nm=>{
      const Kg = A.kgForPotNow ? A.kgForPotNow(nm, endISO) : null;
      const st = classify(Kg, endISO);
      const d = (typeof A.computeDays === "function") ? A.computeDays(nm, endISO, uaOverride||0) : {d0:0,dfdn:0,phi:1,dadj:0};
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="text-align:left">${nm}</td>
        <td>${Kg==null?"–":fmt3(Kg)}</td>
        <td>${fmt1(d.d0)}</td>
        <td>${fmt1(d.dfdn)}</td>
        <td>${fmt2(d.phi)}</td>
        <td>${fmt1(d.dadj)}</td>
        <td>${st||"—"}</td>`;
      tb.appendChild(tr);
    });
  }

  const fmt3 = v => (v==null || !isFinite(v)) ? "–" : Number(v).toFixed(3);

  // eventos
  function wire(){
    $('#pv6-m2-btn-recalc')?.addEventListener('click', ()=>{
      // lee UA escrita por el usuario si tu formulario la tiene; si no, usa 0
      const inpUA = document.getElementById('pv6-ua-input');
      const UA = inpUA ? Number(inpUA.value||0) : 0;
      renderTable(UA);
    });
    $('#pv6-m2-btn-clear')?.addEventListener('click', ()=>{
      renderTable(0);
    });
  }

  function init(){
    ensureCard();
    fillSelectors();
    renderTable(0);
    wire();
    console.log("[M2.4] UI con trazas Dbr/Dfdn/φ/Daj lista.");
  }

  // esperar a que PV6 tenga datos
  if (A.onDataReady && typeof A.onDataReady === "function"){
    const prev = A.onDataReady.bind(A);
    A.onDataReady = function(){
      prev(); try{ init(); }catch(e){ console.warn("[M2.4]init warn", e); }
    };
  }else{
    // fallback por si no hay evento
    document.addEventListener('DOMContentLoaded', ()=>setTimeout(init, 400), {once:true});
  }
})();
