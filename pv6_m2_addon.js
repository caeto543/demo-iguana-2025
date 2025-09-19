/* pv6_m2_addon.js — M2.2 (padres ocupados + sugeridos con tabla y UA/PV/N)
   - Origen: SOLO padres ocupados (occ explícito si existe, si no UA>0). Autocorrección de fecha si no hay.
   - Destino: salida de finca + sugeridos (tabla y <select>) + todos los padres; ocupados marcados correctamente.
   - “Recalcular sugeridos”: usa UA/PV/N -> UA_override para ordenar por Dadj y actualizar tabla.
*/
(function () {
  const M2 = {
    MOV_COLS: {
      date: ["fecha", "date", "dia"],
      pot:  ["name_canon", "potrero", "name", "padre"],
      ua:   ["ua","ua_total","UA","UA_total"],
      n:    ["n","N","n_total","N_total"],
      pv:   ["pv","pv_total_kg","PV_total_kg","pv_kg"],
      occ:  ["ocupado","occ","occupied"]
    },
    state: {
      dateStart:null, dateEnd:null,
      uso:60, auKg:10,
      overrideUA:null, overridePV:null, overrideN:null,
      uaIndex:null, occIndex:null, allParents:[]
    },

    /* ---------- UI (autoinyectada) ---------- */
    ensureUI() {
      if (document.getElementById("pv6-manejo")) return;
      const sim = document.getElementById("sim-card");
      const side = document.querySelector(".side") || document.body;
      const card = document.createElement("div");
      card.className = "card";
      card.id = "pv6-manejo";
      card.innerHTML = `
        <div class="card-header">
          <h4>Pastoreo con manejo (PV6)</h4>
          <div style="font-size:12px;color:#64748b">M2.2</div>
        </div>
        <div style="padding:8px">
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">
            <label>UA <input id="mov-ua" type="number" min="0" step="0.1" /></label>
            <label>PV total (kg) <input id="mov-pv" type="number" min="0" step="1" /></label>
            <label>N total <input id="mov-n" type="number" min="0" step="1" /></label>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
            <label>Origen (ocupados)<select id="mov-origin"></select></label>
            <label>Destino<select id="mov-dest"></select></label>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
            <button id="btn-recalc" class="btn">Recalcular sugeridos</button>
            <button id="btn-enter" class="btn">Ingresar</button>
            <button id="btn-move" class="btn">Mover</button>
            <button id="btn-clear" class="btn secondary">Limpiar</button>
          </div>
          <div class="table-wrap" style="max-height:28vh;overflow:auto;border:1px solid #e5e7eb;border-radius:10px">
            <table class="rank" style="width:100%">
              <thead>
                <tr>
                  <th style="text-align:left">Potrero</th>
                  <th>Kg MS/ha</th>
                  <th>Días br. (est)</th>
                  <th>Días aj. (est)</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody id="m2-sugg-body"></tbody>
            </table>
          </div>
          <div style="margin-top:8px;font-size:12px;color:#475569">
            <span>Tip: si escribes <b>UA</b> se bloquean PV/N; si escribes <b>PV</b> convertimos a UA con auKg; si escribes <b>N</b> usamos N como UA.</span>
          </div>
        </div>
      `;
      if (sim && sim.parentNode) sim.parentNode.insertBefore(card, sim.nextSibling);
      else side.appendChild(card);

      if (!document.getElementById("pv6-manejo-css")) {
        const st = document.createElement("style");
        st.id = "pv6-manejo-css";
        st.textContent = `#pv6-manejo label{display:flex;flex-direction:column;font-size:12px;color:#475569}
                           #pv6-manejo input,#pv6-manejo select{padding:6px 8px;border:1px solid #d0d7e2;border-radius:8px}`;
        document.head.appendChild(st);
      }
    },

    /* ---------- Utils ---------- */
    norm(s){ return String(s??"").trim().toLowerCase(); },
    toISO(d){ return d instanceof Date ? d.toISOString().slice(0,10) : String(d??"").slice(0,10); },
    num(x){ if(typeof x==="number") return x; if(x==null) return 0; const s=String(x).replace(/\./g,"").replace(/,/g,"."); const v=parseFloat(s); return isFinite(v)?v:0; },
    isParentName(nm){ return !!nm && !String(nm).toLowerCase().includes('_z_'); },
    findCol(row, names){ const want=new Set(names.map(this.norm)); for(const k of Object.keys(row)){ if(want.has(this.norm(k))) return k; } return null; },

    /* ---------- Índices UA & OCC ---------- */
    buildIndexes(mrows){
      const uaIdx={}, occIdx={}; if(!Array.isArray(mrows)||!mrows.length) return {uaIdx,occIdx};
      const sample=mrows.find(r=>r&&Object.keys(r).length); if(!sample) return {uaIdx,occIdx};
      const kDate=this.findCol(sample,this.MOV_COLS.date)||"date";
      const kPot =this.findCol(sample,this.MOV_COLS.pot)||"name_canon";
      const kUA  =this.findCol(sample,this.MOV_COLS.ua)||"UA_total";
      const kN   =this.findCol(sample,this.MOV_COLS.n)||"N_total";
      const kOcc =this.findCol(sample,this.MOV_COLS.occ)||"ocupado";

      const rows=[...mrows].map(r=>({
        date:this.toISO(r[kDate]),
        pot:String(r[kPot]??"").trim(),
        ua:this.num(r[kUA]??r[kN]??0),
        occ: (r[kOcc]===undefined||r[kOcc]===null||r[kOcc]==="") ? null : (Number(r[kOcc])>0 ? 1 : 0)
      })).filter(r=>r.pot&&r.date).sort((a,b)=>a.date.localeCompare(b.date));

      for(const r of rows){
        (uaIdx[r.pot]  ||= {})[r.date] = r.ua;
        (occIdx[r.pot] ||= {})[r.date] = r.occ;
      }
      return {uaIdx,occIdx};
    },
    lastOnOrBefore(idx,pot,dateISO,def=0){
      const recs=idx?.[pot]; if(!recs) return def;
      let best=def, bd=""; for(const d in recs){ if(d<=dateISO && d>=bd){ best=recs[d]; bd=d; } }
      return best;
    },
    // ocupación estricta: si occ explícito existe en la última fila <= fecha → úsalo; si no, UA>0
    isOccupied(pot, dateISO){
      const occFlag = this.lastOnOrBefore(this.state.occIndex, pot, dateISO, null);
      if (occFlag!==null) return Number(occFlag)>0;
      const ua = this.lastOnOrBefore(this.state.uaIndex, pot, dateISO, 0);
      return ua>0;
    },

    /* ---------- Padres (desde geo o series) ---------- */
    buildParents(){
      const feat = window.PV6?.data?.geojson?.features || [];
      const S = new Set();
      for (const f of feat){
        const nm = f?.properties?.name_canon || f?.properties?.__canon || f?.properties?.name || f?.properties?.padre;
        if (this.isParentName(nm)) S.add(String(nm).trim());
      }
      if (!S.size && window.PV6?.data?.kgms7dByPot){
        for (const k of Object.keys(window.PV6.data.kgms7dByPot)){ if (this.isParentName(k)) S.add(k); }
      }
      this.state.allParents = Array.from(S).sort((a,b)=>a.localeCompare(b));
    },

    /* ---------- Días con override ---------- */
    computeDaysSafe(pot, uaOverride){
      try{
        if (window.PV6 && typeof PV6.computeDays==="function"){
          return PV6.computeDays(pot, this.state.dateEnd, uaOverride);
        }
      }catch{}
      const kgms = (window.PV6?.data?.kgms7dByPot?.[pot]?.[this.state.dateEnd]) ?? 2000;
      const area = (window.PV6?.data?.areaHaByPot?.[pot]) ?? 1;
      const of = kgms * area * (this.state.uso/100);
      const dem = (uaOverride>0?uaOverride:1)*this.state.auKg;
      const d = dem>0 ? of/dem : 0;
      return { d0:d, dadj: Math.max(0, d*0.85) };
    },

    /* ---------- Sugeridos (lista + tabla) ---------- */
    getSuggestedParents(uaOverride){
      let base = [];
      try{ base = (typeof window.computeRanking==="function" ? window.computeRanking(this.state.dateEnd) : []); }catch{}
      let cand = base.length ? base.map(r=>r.nm).filter(n=>this.isParentName(n)) : [...this.state.allParents];

      if (uaOverride && uaOverride>0){
        const scored = cand.map(p=>{
          const {dadj} = this.computeDaysSafe(p, uaOverride);
          return {p, score: (dadj ?? 0)};
        }).sort((a,b)=> (b.score - a.score));
        cand = scored.map(x=>x.p);
      }
      return cand.slice(0, 12);
    },

    renderSuggestedTable(uaOverride){
      const body = document.getElementById("m2-sugg-body");
      if (!body) return;
      body.innerHTML = "";

      const names = this.getSuggestedParents(uaOverride);
      const fmt1 = (n)=> new Intl.NumberFormat("es-CO",{maximumFractionDigits:1}).format(n);
      const fmt0 = (n)=> new Intl.NumberFormat("es-CO",{maximumFractionDigits:0}).format(n);

      for (const p of names){
        const kg = (window.PV6?.data?.kgms7dByPot?.[p]?.[this.state.dateEnd]) ?? null;
        const { d0, dadj } = this.computeDaysSafe(p, uaOverride||0);
        // estado aproximado: dadj>0 → OK (verde) si kg en ventana; si no, simple semáforo por kg
        const est = (kg!=null && kg>= (window.PV6?.state?.params?.Emin ?? 2600) && kg<= (window.PV6?.state?.params?.Emax ?? 3200)) ? 1 : 0;
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td style="text-align:left">${p}</td>
          <td>${kg!=null? fmt0(kg) : '–'}</td>
          <td>${d0!=null? fmt1(Math.max(0,d0)) : '–'}</td>
          <td>${dadj!=null? fmt1(Math.max(0,dadj)) : '–'}</td>
          <td>${est===1? '<span class="state green">Verde</span>' : '<span class="state yellow">Ajuste</span>'}</td>
        `;
        body.appendChild(tr);
      }
    },

    /* ---------- Form + acciones ---------- */
    wireForm(){
      const elUA = document.getElementById("mov-ua");
      const elPV = document.getElementById("mov-pv");
      const elN  = document.getElementById("mov-n");
      const elRec= document.getElementById("btn-recalc");
      const elClr= document.getElementById("btn-clear");
      const elDo = document.getElementById("btn-move");
      const elIn = document.getElementById("btn-enter");

      const lock = ()=>{
        const ua=this.num(elUA?.value), pv=this.num(elPV?.value), n=this.num(elN?.value);
        if (ua>0){ if(elPV){elPV.value=""; elPV.disabled=true;} if(elN){elN.value=""; elN.disabled=true;} this.state.overrideUA=ua; this.state.overridePV=null; this.state.overrideN=null; }
        else if (pv>0){ const ua2=pv/this.state.auKg; if(elUA) elUA.value=String(ua2.toFixed(2)); if(elN){elN.value=""; elN.disabled=true;} if(elPV) elPV.disabled=false; this.state.overrideUA=ua2; this.state.overridePV=pv; this.state.overrideN=null; }
        else if (n>0){ if(elUA) elUA.value=String(n); if(elPV){elPV.value=""; elPV.disabled=true;} this.state.overrideUA=n; this.state.overridePV=null; this.state.overrideN=n; }
        else { if(elPV) elPV.disabled=false; if(elN) elN.disabled=false; this.state.overrideUA=this.state.overridePV=this.state.overrideN=null; }
      };
      ["input","change"].forEach(evt=>{ elUA?.addEventListener(evt,lock); elPV?.addEventListener(evt,lock); elN?.addEventListener(evt,lock); });

      elClr?.addEventListener("click", ()=>{
        if(elUA) elUA.value=""; if(elPV){elPV.value=""; elPV.disabled=false;} if(elN){elN.value=""; elN.disabled=false;}
        this.state.overrideUA=this.state.overridePV=this.state.overrideN=null;
        this.refreshDestSelector(); this.renderSuggestedTable(0);
      });

      elRec?.addEventListener("click", ()=>{
        const ua = this.state.overrideUA ?? 0;
        this.refreshDestSelector();
        this.renderSuggestedTable(ua);
        console.log("[M2.2] sugeridos recalculados con UA=", ua);
      });

      elDo?.addEventListener("click", ()=> this.applyMoveOrEnter("move"));
      elIn?.addEventListener("click", ()=> this.applyMoveOrEnter("enter"));
    },

    refreshOriginSelector(){
      const selOri=document.getElementById("mov-origin");
      if (!selOri) return;
      selOri.innerHTML = "";

      const dateISO = this.state.dateEnd;
      const occParents = this.state.allParents.filter(p => this.isOccupied(p, dateISO)).sort((a,b)=>a.localeCompare(b));

      if (!occParents.length){
        // autocorrección hacia atrás
        const allDates = this.collectAllDates();
        for (let i=allDates.length-1;i>=0;i--){
          const d = allDates[i];
          const occ2 = this.state.allParents.filter(p => this.isOccupied(p, d));
          if (occ2.length){
            this.state.dateEnd = d;
            const el=document.getElementById("date-end"); if(el) el.value=d;
            console.log("[M2.2] Ajuste de fecha (sin ocupados) →", d);
            return this.refreshOriginSelector();
          }
        }
      } else {
        for (const p of occParents){
          const opt=document.createElement("option"); opt.value=p; opt.textContent=p; selOri.appendChild(opt);
        }
      }
    },

    refreshDestSelector(){
      const selDes=document.getElementById("mov-dest");
      if (!selDes) return;
      selDes.innerHTML = "";

      // salida de finca
      const opt0=document.createElement("option");
      opt0.value="__OUT__";
      opt0.textContent="— Ningún potrero (salida de finca) —";
      selDes.appendChild(opt0);

      // sugeridos ordenados
      const ua = this.state.overrideUA ?? 0;
      const sug = this.getSuggestedParents(ua);
      if (sug.length){
        const grp=document.createElement("optgroup"); grp.label="Destinos sugeridos";
        sug.forEach(p=>{ const op=document.createElement("option"); op.value=p; op.textContent=p; grp.appendChild(op); });
        selDes.appendChild(grp);
      }

      // todos los padres, marcando ocupación real
      const grp2=document.createElement("optgroup"); grp2.label="Todos los potreros";
      for (const p of this.state.allParents){
        const op=document.createElement("option");
        op.value=p;
        const occ = this.isOccupied(p, this.state.dateEnd);
        op.textContent = occ ? `${p} (ocupado)` : p;
        grp2.appendChild(op);
      }
      selDes.appendChild(grp2);
    },

    collectAllDates(){
      const S=new Set(); const idx=this.state.uaIndex||{};
      for(const p in idx) for(const d in idx[p]) S.add(d);
      const occ=this.state.occIndex||{};
      for(const p in occ) for(const d in occ[p]) S.add(d);
      return Array.from(S).sort();
    },

    /* ---------- Movimientos ---------- */
    addMovRow(dateISO, pot, deltaUA){
      this.state.uaIndex[pot] ||= {};
      const prev = this.lastOnOrBefore(this.state.uaIndex, pot, dateISO, 0);
      this.state.uaIndex[pot][dateISO] = Math.max(0, prev + deltaUA);
      // si llega a 0, y no hay occ explícito, quedará libre por UA==0
      if (window.PV6?.data?.movRows){
        window.PV6.data.movRows.push({ date:dateISO, name_canon:pot, UA_total:Math.max(0, prev + deltaUA) });
      }
    },
    applyIngress(dst, ua){
      const d=this.state.dateEnd; this.addMovRow(d,dst, Math.max(0,ua)); this.afterChange(); console.log(`[M2.2] Ingresar → ${ua} UA a ${dst} (${d})`);
    },
    applyExit(src, ua){
      const d=this.state.dateEnd; const cur=this.lastOnOrBefore(this.state.uaIndex,src,d,0); const take=Math.min(cur, ua);
      this.addMovRow(d,src, -take); this.afterChange(); console.log(`[M2.2] Salida de finca ← ${take} UA desde ${src} (${d})`);
    },
    applyMove(src,dst,ua){
      const d=this.state.dateEnd; const cur=this.lastOnOrBefore(this.state.uaIndex,src,d,0); const take=Math.min(cur, ua);
      if (take<=0) return alert("No hay UA suficientes en el origen para mover.");
      this.addMovRow(d,src,-take); this.addMovRow(d,dst,+take); this.afterChange();
      console.log(`[M2.2] Mover ${take} UA: ${src} → ${dst} (${d})`);
    },
    applyMoveOrEnter(kind){
      const selOri=document.getElementById("mov-origin");
      const selDes=document.getElementById("mov-dest");
      const elUA =document.getElementById("mov-ua");
      const ua=this.num(elUA?.value);

      if (kind==="enter"){
        const dst=selDes?.value;
        if(!dst || dst==="__OUT__") return alert("Elige un destino válido para Ingresar.");
        this.applyIngress(dst, ua); return;
      }
      const src=selOri?.value, dst=selDes?.value;
      if (!src) return alert("Selecciona un origen.");
      if (!dst) return alert("Selecciona un destino (o salida de finca).");
      if (ua<=0) return alert("Indica la UA a mover.");
      if (dst==="__OUT__") this.applyExit(src, ua); else this.applyMove(src,dst,ua);
    },

    recalcKPI(){
      const d=this.state.dateEnd; let tot=0;
      for (const p of this.state.allParents){
        const occ = this.isOccupied(p, d);
        if (occ){
          const ua = this.lastOnOrBefore(this.state.uaIndex, p, d, 0);
          tot += ua;
        }
      }
      const el=document.getElementById("kpi-ua-finca");
      if (el) el.textContent = new Intl.NumberFormat("es-CO",{maximumFractionDigits:1}).format(tot);
      if (window.PV6?.ui?.onKpiChange) window.PV6.ui.onKpiChange({ uaTot: tot });
    },
    afterChange(){
      this.refreshOriginSelector();
      this.refreshDestSelector();
      this.recalcKPI();
      const ua = this.state.overrideUA ?? 0;
      this.renderSuggestedTable(ua);
      if (window.PV6?.ui?.refreshMap) window.PV6.ui.refreshMap();
      if (window.PV6?.ui?.refreshRanking) window.PV6.ui.refreshRanking(ua || null);
    },

    /* ---------- Init ---------- */
    init(){
      this.ensureUI();

      this.state.dateStart = (window.PV6?.state?.start) || document.getElementById("date-start")?.value || "2025-01-01";
      this.state.dateEnd   = (window.PV6?.state?.end)   || document.getElementById("date-end")?.value   || "2025-12-31";
      this.state.uso       = +((window.PV6?.state?.coefUso) ?? this.state.uso);
      this.state.auKg      = +((window.PV6?.state?.auKg) ?? this.state.auKg);

      this.buildParents();

      const movRows = window.PV6?.data?.movRows || [];
      const {uaIdx,occIdx} = this.buildIndexes(movRows);
      this.state.uaIndex = uaIdx;
      this.state.occIndex= occIdx;

      // extender end si hay movimientos más nuevos
      const allDates = this.collectAllDates();
      if (allDates.length){
        const maxD = allDates[allDates.length-1];
        if (maxD > this.state.dateEnd){
          this.state.dateEnd = maxD;
          const el=document.getElementById("date-end"); if (el) el.value = maxD;
          console.log("[M2.2] end auto-extend →", maxD);
        }
      }

      this.refreshOriginSelector();
      this.refreshDestSelector();
      this.wireForm();
      this.renderSuggestedTable(this.state.overrideUA ?? 0);

      console.log("[M2.2] inicializado");
    }
  };

  // Boot fallback si el app no llama onDataReady
  const boot = () => {
    if (document.readyState === "loading"){
      document.addEventListener("DOMContentLoaded", boot, {once:true}); return;
    }
    if (window.PV6 && typeof PV6.onDataReady === "function") return;
    setTimeout(()=>M2.init(), 400);
  };
  boot();

  // Entrada pública
  window.__PV6_M2_INIT__ = () => M2.init();
})();
