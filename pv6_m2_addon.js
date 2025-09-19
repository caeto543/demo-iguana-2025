/* pv6_m2_addon.js — M2.2 (alineado 1:1 con ranking/libres y “Fuente” RAW/7d)
   FIX: normalización de “fecha hasta” (dd/mm/aaaa → aaaa-mm-dd) para que Kg y estados coincidan.
*/
(function () {
  const M2 = {
    MOV_COLS: {
      date: ["fecha","date","dia"],
      pot:  ["name_canon","potrero","name","padre"],
      ua:   ["ua","ua_total","UA","UA_total"],
      n:    ["n","N","n_total","N_total"],
      pv:   ["pv","pv_total_kg","PV_total_kg","pv_kg"],
      occ:  ["ocupado","occ","occupied"],
    },
    state: {
      dateEnd:null,     // SIEMPRE en ISO (aaaa-mm-dd)
      uso:60, auKg:10,
      overrideUA:null,
      uaIndex:null, occIndex:null,
      parents:[],
      fuente:"kgms_7d"
    },

    /* ================= Utils ================= */
    norm(s){ return String(s??"").trim().toLowerCase(); },
    nf1(n){ return new Intl.NumberFormat("es-CO",{maximumFractionDigits:1}).format(n); },
    nf0(n){ return new Intl.NumberFormat("es-CO",{maximumFractionDigits:0}).format(n); },
    isParentName(nm){ return !!nm && !String(nm).toLowerCase().includes('_z_'); },
    findCol(row, names){ const want=new Set(names.map(this.norm)); for (const k of Object.keys(row)) if (want.has(this.norm(k))) return k; return null; },

    // --- Fecha: acepta ISO o dd/mm/aaaa, devuelve ISO ---
    toISO(dstr){
      if (!dstr) return null;
      const s = String(dstr).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;                    // ya ISO
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);           // dd/mm/aaaa
      if (m){
        const dd = m[1].padStart(2,"0"), mm = m[2].padStart(2,"0"), aa = m[3];
        return `${aa}-${mm}-${dd}`;
      }
      // fallback: Date.parse y a ISO
      const dt = new Date(s); if (!isNaN(dt)) return dt.toISOString().slice(0,10);
      return s;
    },

    /* ========== Fuente Kg (RAW/7d) igual a la UI ========== */
    syncFuenteFromUI(){
      const ids = ["fuente","source","sel-fuente","select-fuente"];
      for (const id of ids){
        const el = document.getElementById(id);
        if (el && el.tagName==="SELECT"){
          const v = String(el.value||"").toLowerCase();
          this.state.fuente = (v.includes("raw")||v.includes("dia")) ? "kgms_raw" : "kgms_7d";
          el.addEventListener("change", ()=>{ this.syncFuenteFromUI(); this.renderAll(); });
          return;
        }
      }
      if (window.PV6?.state?.fuente) this.state.fuente = window.PV6.state.fuente;
    },
    currentKgMap(){
      const d = window.PV6?.data || {};
      const m7 = d.kgms7dByPot || d.kgms_by_pot_7d || d.kg_7d_by_pot;
      const mr = d.kgmsRawByPot || d.kgmsDiaByPot || d.kgms_by_pot_raw || d.kg_raw_by_pot;
      return this.state.fuente==="kgms_raw" ? (mr||m7||{}) : (m7||mr||{});
    },
    kgOnOrBefore(pot, dateISO){
      try{
        const m = this.currentKgMap()?.[pot]; if (!m) return null;
        let bestD=null, best=null;
        for(const k in m){ const iso = this.toISO(k); if(iso && iso<=dateISO && (bestD===null || iso>bestD)){ bestD=iso; best=m[k]; } }
        return (best==null || Number.isNaN(best)) ? null : Number(best);
      }catch{ return null; }
    },

    /* =============== FDN =============== */
    getFDN(pot){
      const d = window.PV6?.data || {};
      for (const k of Object.keys(d)){
        if (/fdn|fnd/i.test(k)){ const map=d[k]; const v=map?.[pot]; if (v!=null) return Number(v); }
      }
      return null;
    },
    factorFDN(pot){
      const fdn = this.getFDN(pot);
      if (fdn==null) return 1;
      const pen = Math.max(0, fdn - 0.68);         // penaliza por encima de 0.68
      return Math.max(0, 1 - pen);
    },

    /* ========== Índices desde MOV ========== */
    buildIndexes(rows){
      const uaIdx={}, occIdx={};
      if(!Array.isArray(rows)||!rows.length) return {uaIdx,occIdx};
      const sample=rows.find(r=>r && Object.keys(r).length); if(!sample) return {uaIdx,occIdx};
      const kDate=this.findCol(sample,this.MOV_COLS.date)||"date";
      const kPot =this.findCol(sample,this.MOV_COLS.pot)||"name_canon";
      const kUA  =this.findCol(sample,this.MOV_COLS.ua)||"UA_total";
      const kN   =this.findCol(sample,this.MOV_COLS.n)||"N_total";
      const kOcc =this.findCol(sample,this.MOV_COLS.occ)||"ocupado";

      const sorted=[...rows].map(r=>({
        date:this.toISO(r[kDate]),
        pot:String(r[kPot]??"").trim(),
        ua:Number(r[kUA]??r[kN]??0) || 0,
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
      let best=def, bd=""; for(const d in recs){ const iso=this.toISO(d); if(iso && iso<=dateISO && iso>=bd){ best=recs[d]; bd=iso; } }
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
      try{ for (const f of (window.PV6?.data?.geojson?.features||[])){
        const nm=f?.properties?.name_canon || f?.properties?.__canon || f?.properties?.name || f?.properties?.padre;
        if (this.isParentName(nm)) S.add(String(nm).trim());
      }}catch{}
      try{ for (const r of (window.PV6?.data?.movRows||[])){
        const nm=r?.name_canon || r?.potrero || r?.name || r?.padre;
        if (this.isParentName(nm)) S.add(String(nm).trim());
      }}catch{}
      try{ for (const k of Object.keys(this.currentKgMap()||{})){ if (this.isParentName(k)) S.add(k); } }catch{}
      this.state.parents = Array.from(S).sort((a,b)=>a.localeCompare(b));
    },

    /* ========== DÍAS (idéntico a ranking/libres) ========== */
    computeDays(pot, uaOverride){
      if (window.PV6 && typeof window.PV6.computeDays === "function"){
        return window.PV6.computeDays(pot, this.state.dateEnd, uaOverride, this.state.fuente);
      }
      const kg = this.kgOnOrBefore(pot, this.state.dateEnd) ?? 0;
      const area = (window.PV6?.data?.areaHaByPot?.[pot]) ?? 1;
      const ua = Math.max(uaOverride||0, 1e-9);
      const oferta = kg * area;
      const demandaDia = ua * this.state.auKg;
      const d0 = demandaDia>0 ? (oferta/demandaDia) : 0;              // brutos
      const dadj = d0 * (this.state.uso/100) * this.factorFDN(pot);   // ajustados
      return { d0, dadj };
    },

    /* ========== Estado (mismo que ranking/libres) ========== */
    classifyKg(kg){
      const ui = window.PV6?.ui;
      if (ui && typeof ui.stateForKg === "function") return ui.stateForKg(kg, this.state.dateEnd);
      if (typeof window.stateForKg === "function") return window.stateForKg(kg, this.state.dateEnd);
      if (typeof window.PV6?.classifyKg === "function") return window.PV6.classifyKg(kg, this.state.dateEnd);
      const Emin = window.PV6?.state?.params?.Emin ?? 2600;
      const Emax = window.PV6?.state?.params?.Emax ?? 3200;
      if (kg==null) return {label:"Ajuste", cls:"yellow"};
      if (kg>=Emin && kg<=Emax) return {label:"Verde", cls:"green"};
      return {label:"Ajuste", cls:"yellow"};
    },

    /* ========== Sugeridos (lista + tabla) ========== */
    getSuggestedParents(uaOverride){
      let base=[];
      try{ base = (typeof window.computeRanking==="function" ? window.computeRanking(this.state.dateEnd, this.state.fuente) : []); }catch{}
      let names = (base.length ? base.map(r=>r.nm) : this.state.parents).filter(n=>this.state.parents.includes(n));
      if (uaOverride && uaOverride>0){
        const scored = names.map(p=>({p, s:(this.computeDays(p,uaOverride).dadj ?? 0)})).sort((a,b)=> b.s - a.s);
        names = scored.map(x=>x.p);
      }
      return names.slice(0,12);
    },
    renderSuggestedTable(uaOverride){
      const body=document.getElementById("m2-sugg-body"); if(!body) return;
      body.innerHTML="";
      for (const p of this.getSuggestedParents(uaOverride||0)){
        const kg = this.kgOnOrBefore(p, this.state.dateEnd);
        const {d0,dadj} = this.computeDays(p, uaOverride||0);
        const st = this.classifyKg(kg);
        const tr=document.createElement("tr");
        tr.innerHTML = `
          <td style="text-align:left">${p}</td>
          <td>${kg!=null?this.nf0(kg):"–"}</td>
          <td>${d0!=null?this.nf1(Math.max(0,d0)):"–"}</td>
          <td>${dadj!=null?this.nf1(Math.max(0,dadj)):"–"}</td>
          <td><span class="state ${st.cls}">${st.label}</span></td>`;
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
          const dd=this.toISO(dates[i]);
          if (this.state.parents.some(p=>this.isOccupied(p,dd))){
            this.state.dateEnd = dd; const el=document.getElementById("date-end"); if(el) el.value=dd;
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
      for(const p in ui) for(const d in ui[p]) S.add(this.toISO(d));
      for(const p in oi) for(const d in oi[p]) S.add(this.toISO(d));
      return Array.from(S).filter(Boolean).sort();
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
    applyIngress(dst, ua){ const d=this.state.dateEnd; this.addMovRow(d,dst, Math.max(0,ua)); this.afterChange(); },
    applyExit(src, ua){ const d=this.state.dateEnd; const cur=this.lastOnOrBefore(this.state.uaIndex,src,d,0); const take=Math.min(cur, ua); this.addMovRow(d,src,-take); this.afterChange(); },
    applyMove(src,dst,ua){ const d=this.state.dateEnd; const cur=this.lastOnOrBefore(this.state.uaIndex,src,d,0); const take=Math.min(cur, ua); if(take<=0){alert("No hay UA suficientes en el origen para mover."); return;} this.addMovRow(d,src,-take); this.addMovRow(d,dst,+take); this.afterChange(); },
    apply(kind){
      const selO=document.getElementById("mov-origin"); const selD=document.getElementById("mov-dest"); const uaV=Number(document.getElementById("mov-ua")?.value)||0;
      if (kind==="enter"){ const dst=selD?.value; if(!dst||dst==="__OUT__") return alert("Elige un destino válido para Ingresar."); return this.applyIngress(dst, uaV); }
      const src=selO?.value, dst=selD?.value; if(!src) return alert("Selecciona un origen."); if(!dst) return alert("Selecciona un destino (o salida de finca)."); if(uaV<=0) return alert("Indica la UA a mover."); if(dst==="__OUT__") this.applyExit(src, uaV); else this.applyMove(src,dst,uaV);
    },
    afterChange(){ this.renderAll(); },

    /* ========== Render central (sincroniza con UI) ========== */
    renderAll(){
      this.syncFuenteFromUI();

      // Normalizar “hasta” a ISO
      const rawEnd = document.getElementById("date-end")?.value || this.state.dateEnd;
      const isoEnd = this.toISO(rawEnd);
      if (isoEnd && isoEnd !== this.state.dateEnd) this.state.dateEnd = isoEnd;

      this.refreshOrigin();
      this.refreshDest();
      this.recalcKPI();

      const ua=this.state.overrideUA??0;
      this.renderSuggestedTable(ua);

      if (window.PV6?.ui?.refreshMap) window.PV6.ui.refreshMap();
      if (window.PV6?.ui?.refreshRanking) window.PV6.ui.refreshRanking(ua||null);
    },
    recalcKPI(){
      const d=this.state.dateEnd; let tot=0;
      for(const p of this.state.parents){ if(this.isOccupied(p,d)){ const u=this.lastOnOrBefore(this.state.uaIndex,p,d,0); tot+=u; } }
      const el=document.getElementById("kpi-ua-finca"); if(el) el.textContent=this.nf1(tot);
      if (window.PV6?.ui?.onKpiChange) window.PV6.ui.onKpiChange({uaTot:tot});
    },

    /* ========== Form ========== */
    wireForm(){
      const elUA=document.getElementById("mov-ua");
      const elPV=document.getElementById("mov-pv");
      const elN =document.getElementById("mov-n");
      const lock=()=>{
        const ua=Number(elUA?.value)||0, pv=Number(elPV?.value)||0, n=Number(elN?.value)||0;
        if (ua>0){ if(elPV){elPV.value=""; elPV.disabled=true;} if(elN){elN.value=""; elN.disabled=true;} this.state.overrideUA=ua; }
        else if (pv>0){ const ua2=pv/this.state.auKg; if(elUA) elUA.value=String(ua2.toFixed(2)); if(elN){elN.value=""; elN.disabled=true;} if(elPV) elPV.disabled=false; this.state.overrideUA=ua2; }
        else if (n>0){ if(elUA) elUA.value=String(n); if(elPV){elPV.value=""; elPV.disabled=true;} this.state.overrideUA=n; }
        else { if(elPV) elPV.disabled=false; if(elN) elN.disabled=false; this.state.overrideUA=null; }
      };
      ["input","change"].forEach(e=>{ elUA?.addEventListener(e,lock); elPV?.addEventListener(e,lock); elN?.addEventListener(e,lock); });

      document.getElementById("btn-clear") ?.addEventListener("click", ()=>{ if(elUA) elUA.value=""; if(elPV){elPV.value=""; elPV.disabled=false;} if(elN){elN.value=""; elN.disabled=false;} this.state.overrideUA=null; this.renderAll(); });
      document.getElementById("btn-recalc")?.addEventListener("click", ()=> this.renderAll());
      document.getElementById("btn-move")   ?.addEventListener("click", ()=> this.apply("move"));
      document.getElementById("btn-enter")  ?.addEventListener("click", ()=> this.apply("enter"));

      const dateEndEl = document.getElementById("date-end");
      if (dateEndEl) dateEndEl.addEventListener("change", ()=> this.renderAll());
      const fuenteIds = ["fuente","source","sel-fuente","select-fuente"];
      for (const id of fuenteIds){
        const el = document.getElementById(id);
        if (el && el.tagName==="SELECT"){ el.addEventListener("change", ()=> this.renderAll()); }
      }
    },

    /* ========== Init ========== */
    init(){
      // UI
      if (!document.getElementById("pv6-manejo")) this.ensureUI();

      // estado base (fecha → ISO)
      const endRaw = (window.PV6?.state?.end) || document.getElementById("date-end")?.value || "2025-12-31";
      this.state.dateEnd = this.toISO(endRaw);
      this.state.uso     = +((window.PV6?.state?.coefUso) ?? this.state.uso);
      this.state.auKg    = +((window.PV6?.state?.auKg)    ?? this.state.auKg);
      this.syncFuenteFromUI();

      this.buildParents();

      const movRows = window.PV6?.data?.movRows || [];
      const {uaIdx,occIdx} = this.buildIndexes(movRows);
      this.state.uaIndex = uaIdx; this.state.occIndex = occIdx;

      // extender “hasta” si hay MOV más nuevo
      const dates = this.allMoveDates();
      if (dates.length){
        const maxD = dates[dates.length-1];
        if (maxD > this.state.dateEnd){ this.state.dateEnd=maxD; const el=document.getElementById("date-end"); if(el) el.value=maxD; }
      }

      this.wireForm();
      this.renderAll();
      console.log("[M2.2] inicializado");
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
