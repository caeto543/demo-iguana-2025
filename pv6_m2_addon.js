/* pv6_m2_addon.js — M2.2 (FIX Kg en sugeridos + estado correcto + padres/ocupados)
   - Origen: padres ocupados reales (occ explícito si existe; si no UA>0). Autocorrección de fecha si no hay.
   - Destino: salida de finca + sugeridos (ordenados por UA/PV/N) + todos los padres, marcando “(ocupado)” real.
   - Sugeridos: tabla con Kg (last ≤ fecha), D0, Dadj y estado según Emin/Emax.
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
      dateEnd:null,
      uso:60, auKg:10,
      overrideUA:null,
      uaIndex:null, occIndex:null,
      parents:[]
    },

    /* ========== UI ========== */
    ensureUI() {
      if (document.getElementById("pv6-manejo")) return;
      const anchor = document.getElementById("sim-card") || document.querySelector(".side") || document.body;
      const card = document.createElement("div");
      card.className = "card"; card.id = "pv6-manejo";
      card.innerHTML = `
        <div class="card-header">
          <h4>Pastoreo con manejo (PV6)</h4><div style="font-size:12px;color:#64748b">M2.2</div>
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
            <button id="btn-enter"  class="btn">Ingresar</button>
            <button id="btn-move"   class="btn">Mover</button>
            <button id="btn-clear"  class="btn secondary">Limpiar</button>
          </div>
          <div class="table-wrap" style="max-height:28vh;overflow:auto;border:1px solid #e5e7eb;border-radius:10px">
            <table class="rank" style="width:100%">
              <thead><tr>
                <th style="text-align:left">Potrero</th><th>Kg MS/ha</th>
                <th>Días br. (est)</th><th>Días aj. (est)</th><th>Estado</th>
              </tr></thead>
              <tbody id="m2-sugg-body"></tbody>
            </table>
          </div>
          <div style="margin-top:8px;font-size:12px;color:#475569">
            Tip: si escribes <b>UA</b> se bloquean PV/N; si escribes <b>PV</b> convertimos a UA con auKg; si escribes <b>N</b> usamos N como UA.
          </div>
        </div>`;
      if (anchor.id === "sim-card" && anchor.parentNode) anchor.parentNode.insertBefore(card, anchor.nextSibling);
      else anchor.appendChild(card);
      if (!document.getElementById("pv6-manejo-css")) {
        const st = document.createElement("style"); st.id="pv6-manejo-css";
        st.textContent = `#pv6-manejo label{display:flex;flex-direction:column;font-size:12px;color:#475569}
                          #pv6-manejo input,#pv6-manejo select{padding:6px 8px;border:1px solid #d0d7e2;border-radius:8px}`;
        document.head.appendChild(st);
      }
    },

    /* ========== Utils ========== */
    norm(s){ return String(s??"").trim().toLowerCase(); },
    toISO(d){ return d instanceof Date ? d.toISOString().slice(0,10) : String(d??"").slice(0,10); },
    num(x){ if(typeof x==="number") return x; if(x==null) return 0; const s=String(x).replace(/\./g,"").replace(/,/g,"."); const v=parseFloat(s); return isFinite(v)?v:0; },
    isParentName(nm){ return !!nm && !String(nm).toLowerCase().includes('_z_'); },
    findCol(row, names){ const want=new Set(names.map(this.norm)); for(const k of Object.keys(row)){ if(want.has(this.norm(k))) return k; } return null; },

    /* ========== Kg MS/ha last ≤ fecha (desde PV6.data.kgms7dByPot) ========== */
    kgOnOrBefore(pot, dateISO){
      try{
        const m = window.PV6?.data?.kgms7dByPot?.[pot]; if (!m) return null;
        let bestDate=null, bestVal=null;
        for (const k in m){
          if (k<=dateISO && (bestDate===null || k>bestDate)){ bestDate=k; bestVal=m[k]; }
        }
        return (bestVal==null || Number.isNaN(bestVal)) ? null : Number(bestVal);
      }catch{ return null; }
    },

    /* ========== Índices desde MOV ========== */
    buildIndexes(rows){
      const uaIdx={}, occIdx={};
      if(!Array.isArray(rows) || !rows.length) return {uaIdx,occIdx};
      const sample=rows.find(r=>r && Object.keys(r).length); if(!sample) return {uaIdx,occIdx};
      const kDate=this.findCol(sample,this.MOV_COLS.date)||"date";
      const kPot =this.findCol(sample,this.MOV_COLS.pot)||"name_canon";
      const kUA  =this.findCol(sample,this.MOV_COLS.ua)||"UA_total";
      const kN   =this.findCol(sample,this.MOV_COLS.n)||"N_total";
      const kOcc =this.findCol(sample,this.MOV_COLS.occ)||"ocupado";

      const sorted=[...rows].map(r=>({
        date:this.toISO(r[kDate]),
        pot:String(r[kPot]??"").trim(),
        ua:this.num(r[kUA]??r[kN]??0),
        occ:(r[kOcc]===undefined||r[kOcc]===null||r[kOcc]==="") ? null : (Number(r[kOcc])>0?1:0)
      })).filter(r=>r.pot && r.date).sort((a,b)=>a.date.localeCompare(b.date));

      for(const r of sorted){
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
    isOccupied(pot, dateISO){
      const occ = this.lastOnOrBefore(this.state.occIndex, pot, dateISO, null);
      if (occ!==null) return Number(occ)>0;
      const ua = this.lastOnOrBefore(this.state.uaIndex, pot, dateISO, 0);
      return ua>0;
    },

    /* ========== Padres ========== */
    buildParents(){
      const S=new Set();
      try{
        for (const f of (window.PV6?.data?.geojson?.features||[])){
          const nm=f?.properties?.name_canon || f?.properties?.__canon || f?.properties?.name || f?.properties?.padre;
          if (this.isParentName(nm)) S.add(String(nm).trim());
        }
      }catch{}
      try{
        for (const r of (window.PV6?.data?.movRows||[])){
          const nm=r?.name_canon || r?.potrero || r?.name || r?.padre;
          if (this.isParentName(nm)) S.add(String(nm).trim());
        }
      }catch{}
      try{
        for (const k of Object.keys(window.PV6?.data?.kgms7dByPot||{})){
          if (this.isParentName(k)) S.add(k);
        }
      }catch{}
      this.state.parents = Array.from(S).sort((a,b)=>a.localeCompare(b));
    },

    /* ========== Días con override ========== */
    computeDaysSafe(pot, uaOverride){
      try{
        if (window.PV6 && typeof PV6.computeDays==="function"){
          return PV6.computeDays(pot, this.state.dateEnd, uaOverride);
        }
      }catch{}
      const kgms = this.kgOnOrBefore(pot, this.state.dateEnd) ?? 2000;
      const area = (window.PV6?.data?.areaHaByPot?.[pot]) ?? 1;
      const of = kgms * area * (this.state.uso/100);
      const dem = (uaOverride>0?uaOverride:1)*this.state.auKg;
      const d = dem>0 ? of/dem : 0;
      return { d0:d, dadj: Math.max(0, d*0.85) };
    },

    /* ========== Sugeridos (lista + tabla) ========== */
    getSuggestedParents(uaOverride){
      let base=[];
      try{ base = (typeof window.computeRanking==="function" ? window.computeRanking(this.state.dateEnd) : []); }catch{}
      let names = (base.length ? base.map(r=>r.nm) : this.state.parents).filter(n=>this.state.parents.includes(n));
      if (uaOverride && uaOverride>0){
        const scored = names.map(p=>({p, s:(this.computeDaysSafe(p,uaOverride).dadj ?? 0)})).sort((a,b)=> b.s - a.s);
        names = scored.map(x=>x.p);
      }
      return names.slice(0,12);
    },
    renderSuggestedTable(uaOverride){
      const body=document.getElementById("m2-sugg-body"); if(!body) return;
      body.innerHTML="";
      const fmt1=n=>new Intl.NumberFormat("es-CO",{maximumFractionDigits:1}).format(n);
      const fmt0=n=>new Intl.NumberFormat("es-CO",{maximumFractionDigits:0}).format(n);

      const Emin = window.PV6?.state?.params?.Emin ?? 2600;
      const Emax = window.PV6?.state?.params?.Emax ?? 3200;

      for(const p of this.getSuggestedParents(uaOverride||0)){
        const kg = this.kgOnOrBefore(p, this.state.dateEnd);
        const {d0,dadj} = this.computeDaysSafe(p, uaOverride||0);
        const ok = (kg!=null && kg>=Emin && kg<=Emax);
        const tr=document.createElement("tr");
        tr.innerHTML = `
          <td style="text-align:left">${p}</td>
          <td>${kg!=null?fmt0(kg):"–"}</td>
          <td>${d0!=null?fmt1(Math.max(0,d0)):"–"}</td>
          <td>${dadj!=null?fmt1(Math.max(0,dadj)):"–"}</td>
          <td>${ok?'<span class="state green">Verde</span>':'<span class="state yellow">Ajuste</span>'}</td>`;
        body.appendChild(tr);
      }
    },

    /* ========== Selectores ========== */
    refreshOrigin(){
      const sel=document.getElementById("mov-origin"); if(!sel) return;
      sel.innerHTML="";
      const d=this.state.dateEnd;

      const occParents = this.state.parents.filter(p=>this.isOccupied(p,d));
      if (!occParents.length){
        const dates=this.allMoveDates();
        for(let i=dates.length-1;i>=0;i--){
          const dd=dates[i];
          if (this.state.parents.some(p=>this.isOccupied(p,dd))){
            this.state.dateEnd = dd; const el=document.getElementById("date-end"); if(el) el.value=dd;
            console.log("[M2.2] Ajuste de fecha (sin ocupados) →", dd);
            return this.refreshOrigin();
          }
        }
      }
      const list = this.state.parents.filter(p=>this.isOccupied(p,this.state.dateEnd)).sort((a,b)=>a.localeCompare(b));
      for(const p of list){ const opt=document.createElement("option"); opt.value=p; opt.textContent=p; sel.appendChild(opt); }
    },
    refreshDest(){
      const sel=document.getElementById("mov-dest"); if(!sel) return;
      sel.innerHTML="";
      const opt0=document.createElement("option"); opt0.value="__OUT__"; opt0.textContent="— Ningún potrero (salida de finca) —";
      sel.appendChild(opt0);

      const ua = this.state.overrideUA ?? 0;
      const sug = this.getSuggestedParents(ua);
      if (sug.length){
        const grp=document.createElement("optgroup"); grp.label="Destinos sugeridos";
        for(const p of sug){ const op=document.createElement("option"); op.value=p; op.textContent=p; grp.appendChild(op); }
        sel.appendChild(grp);
      }

      const grp2=document.createElement("optgroup"); grp2.label="Todos los potreros";
      for(const p of this.state.parents){
        const op=document.createElement("option"); op.value=p;
        op.textContent = this.isOccupied(p,this.state.dateEnd) ? `${p} (ocupado)` : p;
        grp2.appendChild(op);
      }
      sel.appendChild(grp2);
    },
    allMoveDates(){
      const S=new Set(); const ui=this.state.uaIndex||{}; const oi=this.state.occIndex||{};
      for(const p in ui) for(const d in ui[p]) S.add(d);
      for(const p in oi) for(const d in oi[p]) S.add(d);
      return Array.from(S).sort();
    },

    /* ========== Acciones ========== */
    addMovRow(dateISO, pot, deltaUA){
      this.state.uaIndex[pot] ||= {};
      const prev = this.lastOnOrBefore(this.state.uaIndex, pot, dateISO, 0);
      this.state.uaIndex[pot][dateISO] = Math.max(0, prev + deltaUA);
      if (window.PV6?.data?.movRows){
        window.PV6.data.movRows.push({ date:dateISO, name_canon:pot, UA_total:Math.max(0, prev + deltaUA) });
      }
    },
    applyIngress(dst, ua){ const d=this.state.dateEnd; this.addMovRow(d,dst, Math.max(0,ua)); this.afterChange(); console.log(`[M2.2] Ingresar → ${ua} UA a ${dst} (${d})`); },
    applyExit(src, ua){ const d=this.state.dateEnd; const cur=this.lastOnOrBefore(this.state.uaIndex,src,d,0); const take=Math.min(cur, ua); this.addMovRow(d,src,-take); this.afterChange(); console.log(`[M2.2] Salida de finca ← ${take} UA desde ${src} (${d})`); },
    applyMove(src,dst,ua){ const d=this.state.dateEnd; const cur=this.lastOnOrBefore(this.state.uaIndex,src,d,0); const take=Math.min(cur, ua); if(take<=0) return alert("No hay UA suficientes en el origen para mover."); this.addMovRow(d,src,-take); this.addMovRow(d,dst,+take); this.afterChange(); console.log(`[M2.2] Mover ${take} UA: ${src} → ${dst} (${d})`); },
    apply(kind){
      const selO=document.getElementById("mov-origin"); const selD=document.getElementById("mov-dest"); const uaV=this.num(document.getElementById("mov-ua")?.value);
      if (kind==="enter"){ const dst=selD?.value; if(!dst||dst==="__OUT__") return alert("Elige un destino válido para Ingresar."); return this.applyIngress(dst, uaV); }
      const src=selO?.value, dst=selD?.value; if(!src) return alert("Selecciona un origen."); if(!dst) return alert("Selecciona un destino (o salida de finca)."); if(uaV<=0) return alert("Indica la UA a mover."); if(dst==="__OUT__") this.applyExit(src, uaV); else this.applyMove(src,dst,uaV);
    },
    afterChange(){
      this.refreshOrigin(); this.refreshDest(); this.recalcKPI();
      const ua=this.state.overrideUA??0; this.renderSuggestedTable(ua);
      if (window.PV6?.ui?.refreshMap) window.PV6.ui.refreshMap();
      if (window.PV6?.ui?.refreshRanking) window.PV6.ui.refreshRanking(ua||null);
    },
    recalcKPI(){
      const d=this.state.dateEnd; let tot=0;
      for(const p of this.state.parents){ if(this.isOccupied(p,d)){ const u=this.lastOnOrBefore(this.state.uaIndex,p,d,0); tot+=u; } }
      const el=document.getElementById("kpi-ua-finca"); if(el) el.textContent=new Intl.NumberFormat("es-CO",{maximumFractionDigits:1}).format(tot);
      if (window.PV6?.ui?.onKpiChange) window.PV6.ui.onKpiChange({uaTot:tot});
    },

    /* ========== Form ========== */
    wireForm(){
      const elUA=document.getElementById("mov-ua"); const elPV=document.getElementById("mov-pv"); const elN=document.getElementById("mov-n");
      const lock=()=>{
        const ua=this.num(elUA?.value), pv=this.num(elPV?.value), n=this.num(elN?.value);
        if (ua>0){ if(elPV){elPV.value=""; elPV.disabled=true;} if(elN){elN.value=""; elN.disabled=true;} this.state.overrideUA=ua; }
        else if (pv>0){ const ua2=pv/this.state.auKg; if(elUA) elUA.value=String(ua2.toFixed(2)); if(elN){elN.value=""; elN.disabled=true;} if(elPV) elPV.disabled=false; this.state.overrideUA=ua2; }
        else if (n>0){ if(elUA) elUA.value=String(n); if(elPV){elPV.value=""; elPV.disabled=true;} this.state.overrideUA=n; }
        else { if(elPV) elPV.disabled=false; if(elN) elN.disabled=false; this.state.overrideUA=null; }
      };
      ["input","change"].forEach(e=>{ elUA?.addEventListener(e,lock); elPV?.addEventListener(e,lock); elN?.addEventListener(e,lock); });

      document.getElementById("btn-clear") ?.addEventListener("click", ()=>{ if(elUA) elUA.value=""; if(elPV){elPV.value=""; elPV.disabled=false;} if(elN){elN.value=""; elN.disabled=false;} this.state.overrideUA=null; this.refreshDest(); this.renderSuggestedTable(0); });
      document.getElementById("btn-recalc")?.addEventListener("click", ()=>{ const ua=this.state.overrideUA??0; this.refreshDest(); this.renderSuggestedTable(ua); console.log("[M2.2] sugeridos (UA override) =", ua); });
      document.getElementById("btn-move")   ?.addEventListener("click", ()=> this.apply("move"));
      document.getElementById("btn-enter")  ?.addEventListener("click", ()=> this.apply("enter"));
    },

    /* ========== Init ========== */
    init(){
      this.ensureUI();

      this.state.dateEnd = (window.PV6?.state?.end) || document.getElementById("date-end")?.value || "2025-12-31";
      this.state.uso     = +((window.PV6?.state?.coefUso) ?? this.state.uso);
      this.state.auKg    = +((window.PV6?.state?.auKg)    ?? this.state.auKg);

      this.buildParents();

      const movRows = window.PV6?.data?.movRows || [];
      const {uaIdx,occIdx} = this.buildIndexes(movRows);
      this.state.uaIndex = uaIdx; this.state.occIndex = occIdx;

      const allDates = this.allMoveDates();
      if (allDates.length){
        const maxD = allDates[allDates.length-1];
        if (maxD > this.state.dateEnd){ this.state.dateEnd=maxD; const el=document.getElementById("date-end"); if(el) el.value=maxD; }
      }

      this.refreshOrigin();
      this.refreshDest();
      this.wireForm();
      this.renderSuggestedTable(this.state.overrideUA ?? 0);

      console.log("[M2.2] inicializado");
    },

    allMoveDates(){
      const S=new Set(); const ui=this.state.uaIndex||{}; const oi=this.state.occIndex||{};
      for(const p in ui) for(const d in ui[p]) S.add(d);
      for(const p in oi) for(const d in oi[p]) S.add(d);
      return Array.from(S).sort();
    }
  };

  const boot = () => {
    if (document.readyState === "loading"){ document.addEventListener("DOMContentLoaded", boot, {once:true}); return; }
    if (window.PV6 && typeof PV6.onDataReady === "function") return;
    setTimeout(()=>M2.init(), 400);
  };
  boot();

  window.__PV6_M2_INIT__ = () => M2.init();
})();
