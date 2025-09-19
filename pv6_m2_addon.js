/* pv6_m2_addon.js — M2.2 (alineado 1:1 con mapa/encabezado)
   - Kg MS/ha: primero llamo a los helpers internos de la app (mismo dato que el mapa).
   - Si no existen, caigo a mapas RAW/7d detectados automáticamente (con fecha normalizada).
   - Fecha “hasta”: dd/mm/aaaa → aaaa-mm-dd.
   - Días: brutos = oferta/ingesta; ajustados = brutos * coef_uso * factor_FDN.
   - Estado: igual a ranking/libres.
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
      dateEnd:null, uso:60, auKg:10,
      overrideUA:null,
      uaIndex:null, occIndex:null,
      parents:[],
      fuente:"kgms_7d",
      maps:{raw:null,s7d:null}
    },

    /* ---------- utils ---------- */
    norm(s){ return String(s??"").trim().toLowerCase(); },
    nf1(n){ return new Intl.NumberFormat("es-CO",{maximumFractionDigits:1}).format(n); },
    nf0(n){ return new Intl.NumberFormat("es-CO",{maximumFractionDigits:0}).format(n); },
    isParentName(nm){ return !!nm && !String(nm).toLowerCase().includes('_z_'); },
    findCol(row, names){ const want=new Set(names.map(this.norm)); for (const k of Object.keys(row)) if (want.has(this.norm(k))) return k; return null; },
    toISO(s){
      if (!s) return null; const str=String(s).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
      const m=str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m){ const d=m[1].padStart(2,"0"), M=m[2].padStart(2,"0"), y=m[3]; return `${y}-${M}-${d}`; }
      const dt=new Date(str); return isNaN(dt)?str:dt.toISOString().slice(0,10);
    },

    /* ---------- UI ---------- */
    ensureUI(){
      if (document.getElementById("pv6-manejo")) return;
      const anchor=document.getElementById("sim-card")||document.querySelector(".side")||document.body;
      const el=document.createElement("div"); el.className="card"; el.id="pv6-manejo";
      el.innerHTML=`
        <div class="card-header"><h4>Pastoreo con manejo (PV6)</h4><div style="font-size:12px;color:#64748b">M2.2</div></div>
        <div style="padding:8px">
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">
            <label>UA <input id="mov-ua" type="number" step="0.1" min="0"></label>
            <label>PV total (kg) <input id="mov-pv" type="number" step="1" min="0"></label>
            <label>N total <input id="mov-n" type="number" step="1" min="0"></label>
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
          <div style="margin-top:8px;font-size:12px;color:#475569">Tip: UA bloquea PV/N; PV→UA con auKg; N como UA.</div>
        </div>`;
      if (anchor.id==="sim-card" && anchor.parentNode) anchor.parentNode.insertBefore(el, anchor.nextSibling);
      else anchor.appendChild(el);
    },

    /* ---------- fuente Kg = EXACTA a la UI ---------- */
    syncFuenteFromUI(){
      const ids=["fuente","source","sel-fuente","select-fuente"];
      for (const id of ids){
        const el=document.getElementById(id);
        if (el && el.tagName==="SELECT"){
          const v=String(el.value||"").toLowerCase();
          this.state.fuente = (v.includes("raw")||v.includes("dia")) ? "kgms_raw" : "kgms_7d";
          el.addEventListener("change", ()=>{ this.syncFuenteFromUI(); this.renderAll(); });
          break;
        }
      }
      if (window.PV6?.state?.fuente) this.state.fuente = window.PV6.state.fuente;
      this.detectKgMaps(); // rellena this.state.maps
    },
    detectKgMaps(){
      const d=window.PV6?.data||{};
      const keys=Object.keys(d);
      const looksLikeMap = k => {
        const v=d[k]; if (!v || typeof v!=="object") return false;
        const first=v[Object.keys(v)[0]]; return first && typeof first==="object";
      };
      const prefer7 = ["kgms7dByPot","kgms_by_pot_7d","kg_7d_by_pot"];
      const preferR = ["kgmsRawByPot","kgmsDiaByPot","kgms_by_pot_raw","kg_raw_by_pot","kgms_by_pot","kg_by_pot"];
      const pick=(pref, alt)=> pref.find(k=>d[k]) || alt.find(k=>looksLikeMap(k)) || null;

      const cand = keys.filter(looksLikeMap);
      const k7 = pick(prefer7, cand.filter(k=>/7d/i.test(k)));
      const kR = pick(preferR, cand.filter(k=>!/_7d|7d/i.test(k)));

      this.state.maps.s7d = k7 ? d[k7] : null;
      this.state.maps.raw = kR ? d[kR] : null;
    },

    // === Kg EXACTO que usa el mapa/encabezado ===
    kgFromApp(pot, dateISO){
      const A = window.PV6 || {};
      // funciones directas típicas
      const fns = [
        A.kgForPot, A.getKgForPot, A.kgmsForPot, A.getKgMsHaForPot,
        A.ui?.kgForPot, A.ui?.getKgForPot, A.ui?.kgMsForPot
      ].filter(fn=>typeof fn==="function");
      for (const fn of fns){
        try { const v = fn.call(A.ui||A, pot, dateISO, this.state.fuente); if (v!=null) return Number(v); } catch(_){}
      }
      // overlay/tabla actual que usa la UI
      const candidates = [
        A.ui?.currentKgByPot,
        A.state?.overlayByPot,
        A.data?.currentKgByPot,
      ];
      for (const m of candidates){ if (m && m[pot]!=null) return Number(m[pot]); }
      return null;
    },

    // === Kg por fecha usando mapas (fallback robusto) ===
    currentKgMap(){ return this.state.fuente==="kgms_raw" ? (this.state.maps.raw||{}) : (this.state.maps.s7d||{}); },
    kgOnOrBeforeFallback(pot, dateISO){
      try{
        const m=this.currentKgMap()?.[pot]; if(!m) return null;
        let bestD=null, best=null;
        for (const k in m){ const iso=this.toISO(k); if (iso && iso<=dateISO && (bestD===null || iso>bestD)){ bestD=iso; best=m[k]; } }
        return (best==null || Number.isNaN(best)) ? null : Number(best);
      }catch{ return null; }
    },
    kg(pot, dateISO){
      const v = this.kgFromApp(pot, dateISO);
      return (v!=null && !Number.isNaN(v)) ? v : this.kgOnOrBeforeFallback(pot, dateISO);
    },

    /* ---------- FDN ---------- */
    getFDN(pot){
      const d=window.PV6?.data||{};
      for (const k of Object.keys(d)){ if (/fdn|fnd/i.test(k)){ const v=d[k]?.[pot]; if (v!=null) return Number(v); } }
      return null;
    },
    factorFDN(pot){ const fdn=this.getFDN(pot); if (fdn==null) return 1; const pen=Math.max(0,fdn-0.68); return Math.max(0,1-pen); },

    /* ---------- MOV ---------- */
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
        ua:Number(r[kUA]??r[kN]??0)||0,
        occ:(r[kOcc]===undefined||r[kOcc]===null||r[kOcc]==="")?null:(Number(r[kOcc])>0?1:0)
      })).filter(r=>r.pot && r.date).sort((a,b)=>a.date.localeCompare(b.date));
      for(const r of sorted){ (uaIdx[r.pot] ||= {})[r.date]=r.ua; (occIdx[r.pot] ||= {})[r.date]=r.occ; }
      return {uaIdx,occIdx};
    },
    lastOnOrBefore(idx,pot,dateISO,def=0){
      const recs=idx?.[pot]; if(!recs) return def; let best=def, bd="";
      for(const d in recs){ const iso=this.toISO(d); if(iso && iso<=dateISO && iso>=bd){ best=recs[d]; bd=iso; } }
      return best;
    },
    isOccupied(pot,dateISO){
      const occ=this.lastOnOrBefore(this.state.occIndex,pot,dateISO,null);
      if (occ!==null) return Number(occ)>0;
      const ua=this.lastOnOrBefore(this.state.uaIndex,pot,dateISO,0);
      return ua>0;
    },

    /* ---------- padres ---------- */
    buildParents(){
      const S=new Set();
      try{ for(const f of (window.PV6?.data?.geojson?.features||[])){ const nm=f?.properties?.name_canon||f?.properties?.__canon||f?.properties?.name||f?.properties?.padre; if(this.isParentName(nm)) S.add(String(nm).trim()); }}catch{}
      try{ for(const r of (window.PV6?.data?.movRows||[])){ const nm=r?.name_canon||r?.potrero||r?.name||r?.padre; if(this.isParentName(nm)) S.add(String(nm).trim()); }}catch{}
      try{ for(const k of Object.keys(this.currentKgMap()||{})){ if(this.isParentName(k)) S.add(k); }}catch{}
      this.state.parents=Array.from(S).sort((a,b)=>a.localeCompare(b));
    },

    /* ---------- días/estado ---------- */
    computeDays(pot, uaOverride){
      if (window.PV6 && typeof window.PV6.computeDays==="function"){
        return window.PV6.computeDays(pot, this.state.dateEnd, uaOverride, this.state.fuente);
      }
      const kg = this.kg(pot, this.state.dateEnd) ?? 0;
      const area=(window.PV6?.data?.areaHaByPot?.[pot]) ?? 1;
      const ua=Math.max(uaOverride||0, 1e-9);
      const d0=(kg*area)/(ua*this.state.auKg);
      const dadj=d0*(this.state.uso/100)*this.factorFDN(pot);
      return {d0, dadj};
    },
    classifyKg(kg){
      const ui=window.PV6?.ui;
      if (ui && typeof ui.stateForKg==="function") return ui.stateForKg(kg, this.state.dateEnd);
      if (typeof window.stateForKg==="function") return window.stateForKg(kg, this.state.dateEnd);
      if (typeof window.PV6?.classifyKg==="function") return window.PV6.classifyKg(kg, this.state.dateEnd);
      const Emin=window.PV6?.state?.params?.Emin ?? 2600, Emax=window.PV6?.state?.params?.Emax ?? 3200;
      if (kg==null) return {label:"Ajuste", cls:"yellow"};
      return (kg>=Emin && kg<=Emax) ? {label:"Verde", cls:"green"} : {label:"Ajuste", cls:"yellow"};
    },

    /* ---------- sugeridos ---------- */
    getSuggestedParents(uaOverride){
      let base=[];
      try{ base=(typeof window.computeRanking==="function"?window.computeRanking(this.state.dateEnd,this.state.fuente):[]);}catch{}
      let names=(base.length?base.map(r=>r.nm):this.state.parents).filter(n=>this.state.parents.includes(n));
      if (uaOverride && uaOverride>0){
        const scored=names.map(p=>({p, s:(this.computeDays(p,uaOverride).dadj||0)})).sort((a,b)=>b.s-a.s);
        names=scored.map(x=>x.p);
      }
      return names.slice(0,12);
    },
    renderSuggestedTable(uaOverride){
      const body=document.getElementById("m2-sugg-body"); if(!body) return; body.innerHTML="";
      for(const p of this.getSuggestedParents(uaOverride||0)){
        const kg=this.kg(p,this.state.dateEnd);
        const {d0,dadj}=this.computeDays(p,uaOverride||0);
        const st=this.classifyKg(kg);
        const tr=document.createElement("tr");
        tr.innerHTML=`
          <td style="text-align:left">${p}</td>
          <td>${kg!=null?this.nf0(kg):"—"}</td>
          <td>${d0!=null?this.nf1(Math.max(0,d0)):"—"}</td>
          <td>${dadj!=null?this.nf1(Math.max(0,dadj)):"—"}</td>
          <td><span class="state ${st.cls}">${st.label}</span></td>`;
        body.appendChild(tr);
      }
    },

    /* ---------- selects / acciones ---------- */
    refreshOrigin(){
      const sel=document.getElementById("mov-origin"); if(!sel) return; sel.innerHTML="";
      const d=this.state.dateEnd;
      const occParents=this.state.parents.filter(p=>this.isOccupied(p,d));
      if (!occParents.length){
        const dates=this.allMoveDates();
        for(let i=dates.length-1;i>=0;i--){
          const dd=this.toISO(dates[i]); if (this.state.parents.some(p=>this.isOccupied(p,dd))){
            this.state.dateEnd=dd; const el=document.getElementById("date-end"); if(el) el.value=dd; return this.refreshOrigin();
          }
        }
      }
      const list=this.state.parents.filter(p=>this.isOccupied(p,this.state.dateEnd)).sort((a,b)=>a.localeCompare(b));
      for(const p of list){ const opt=document.createElement("option"); opt.value=p; opt.textContent=p; sel.appendChild(opt); }
    },
    refreshDest(){
      const sel=document.getElementById("mov-dest"); if(!sel) return; sel.innerHTML="";
      const none=document.createElement("option"); none.value="__OUT__"; none.textContent="— Ningún potrero (salida de finca) —"; sel.appendChild(none);
      const ua=this.state.overrideUA ?? 0;
      const sug=this.getSuggestedParents(ua);
      if (sug.length){ const g=document.createElement("optgroup"); g.label="Destinos sugeridos"; for(const p of sug){ const o=document.createElement("option"); o.value=p; o.textContent=p; g.appendChild(o);} sel.appendChild(g); }
      const g2=document.createElement("optgroup"); g2.label="Todos los potreros";
      for(const p of this.state.parents){ const o=document.createElement("option"); o.value=p; o.textContent=this.isOccupied(p,this.state.dateEnd)?`${p} (ocupado)`:p; g2.appendChild(o); }
      sel.appendChild(g2);
    },
    allMoveDates(){
      const S=new Set(); const ui=this.state.uaIndex||{}, oi=this.state.occIndex||{};
      for(const p in ui) for(const d in ui[p]) S.add(this.toISO(d));
      for(const p in oi) for(const d in oi[p]) S.add(this.toISO(d));
      return Array.from(S).filter(Boolean).sort();
    },
    addMovRow(dateISO,pot,deltaUA){
      this.state.uaIndex[pot] ||= {};
      const prev=this.lastOnOrBefore(this.state.uaIndex,pot,dateISO,0);
      this.state.uaIndex[pot][dateISO]=Math.max(0,prev+deltaUA);
      if (window.PV6?.data?.movRows) window.PV6.data.movRows.push({date:dateISO,name_canon:pot,UA_total:Math.max(0,prev+deltaUA)});
    },
    applyIngress(dst,ua){ const d=this.state.dateEnd; this.addMovRow(d,dst,Math.max(0,ua)); this.afterChange(); },
    applyExit(src,ua){ const d=this.state.dateEnd; const cur=this.lastOnOrBefore(this.state.uaIndex,src,d,0); const take=Math.min(cur,ua); this.addMovRow(d,src,-take); this.afterChange(); },
    applyMove(src,dst,ua){ const d=this.state.dateEnd; const cur=this.lastOnOrBefore(this.state.uaIndex,src,d,0); const take=Math.min(cur,ua); if(take<=0){alert("No hay UA suficientes en el origen para mover."); return;} this.addMovRow(d,src,-take); this.addMovRow(d,dst,+take); this.afterChange(); },
    apply(kind){
      const o=document.getElementById("mov-origin"); const d=document.getElementById("mov-dest"); const ua=Number(document.getElementById("mov-ua")?.value)||0;
      if (kind==="enter"){ const dst=d?.value; if(!dst||dst==="__OUT__") return alert("Elige un destino válido para Ingresar."); return this.applyIngress(dst,ua); }
      const src=o?.value, dst=d?.value; if(!src) return alert("Selecciona un origen."); if(!dst) return alert("Selecciona un destino (o salida de finca)."); if(ua<=0) return alert("Indica la UA a mover."); if(dst==="__OUT__") this.applyExit(src,ua); else this.applyMove(src,dst,ua);
    },
    afterChange(){ this.renderAll(); },

    /* ---------- render/KPI ---------- */
    renderAll(){
      this.syncFuenteFromUI(); // también detecta mapas
      const de=document.getElementById("date-end")?.value || this.state.dateEnd;
      const iso=this.toISO(de); if (iso && iso!==this.state.dateEnd) this.state.dateEnd=iso;

      this.buildParents();
      this.refreshOrigin(); this.refreshDest(); this.recalcKPI();

      const ua=this.state.overrideUA??0;
      this.renderSuggestedTable(ua);

      if (window.PV6?.ui?.refreshMap) window.PV6.ui.refreshMap();
      if (window.PV6?.ui?.refreshRanking) window.PV6.ui.refreshRanking(ua||null);
    },
    recalcKPI(){
      const d=this.state.dateEnd; let tot=0; for(const p of this.state.parents){ if(this.isOccupied(p,d)){ const u=this.lastOnOrBefore(this.state.uaIndex,p,d,0); tot+=u; } }
      const el=document.getElementById("kpi-ua-finca"); if(el) el.textContent=this.nf1(tot);
      if (window.PV6?.ui?.onKpiChange) window.PV6.ui.onKpiChange({uaTot:tot});
    },

    /* ---------- form ---------- */
    wireForm(){
      const ua=document.getElementById("mov-ua"), pv=document.getElementById("mov-pv"), n=document.getElementById("mov-n");
      const lock=()=>{
        const vUA=Number(ua?.value)||0, vPV=Number(pv?.value)||0, vN=Number(n?.value)||0;
        if (vUA>0){ if(pv){pv.value=""; pv.disabled=true;} if(n){n.value=""; n.disabled=true;} this.state.overrideUA=vUA; }
        else if (vPV>0){ const u=vPV/this.state.auKg; if(ua) ua.value=String(u.toFixed(2)); if(n){n.value=""; n.disabled=true;} if(pv) pv.disabled=false; this.state.overrideUA=u; }
        else if (vN>0){ if(ua) ua.value=String(vN); if(pv){pv.value=""; pv.disabled=true;} this.state.overrideUA=vN; }
        else { if(pv) pv.disabled=false; if(n) n.disabled=false; this.state.overrideUA=null; }
      };
      ["input","change"].forEach(ev=>{ ua?.addEventListener(ev,lock); pv?.addEventListener(ev,lock); n?.addEventListener(ev,lock); });
      document.getElementById("btn-clear") ?.addEventListener("click", ()=>{ if(ua) ua.value=""; if(pv){pv.value=""; pv.disabled=false;} if(n){n.value=""; n.disabled=false;} this.state.overrideUA=null; this.renderAll(); });
      document.getElementById("btn-recalc")?.addEventListener("click", ()=> this.renderAll());
      document.getElementById("btn-move")   ?.addEventListener("click", ()=> this.apply("move"));
      document.getElementById("btn-enter")  ?.addEventListener("click", ()=> this.apply("enter"));
      const end=document.getElementById("date-end"); if (end) end.addEventListener("change", ()=> this.renderAll());
      ["fuente","source","sel-fuente","select-fuente"].forEach(id=>{ const el=document.getElementById(id); if(el && el.tagName==="SELECT") el.addEventListener("change", ()=> this.renderAll()); });
    },

    /* ---------- init ---------- */
    init(){
      this.ensureUI();

      const rawEnd=(window.PV6?.state?.end)||document.getElementById("date-end")?.value||"2025-12-31";
      this.state.dateEnd=this.toISO(rawEnd);
      this.state.uso = +((window.PV6?.state?.coefUso) ?? this.state.uso);
      this.state.auKg= +((window.PV6?.state?.auKg)    ?? this.state.auKg);

      this.syncFuenteFromUI(); // también detecta mapas
      this.buildParents();

      const movRows=window.PV6?.data?.movRows||[];
      const {uaIdx,occIdx}=this.buildIndexes(movRows);
      this.state.uaIndex=uaIdx; this.state.occIndex=occIdx;

      const dates=this.allMoveDates();
      if (dates.length){ const maxD=dates[dates.length-1]; if (maxD>this.state.dateEnd){ this.state.dateEnd=maxD; const el=document.getElementById("date-end"); if(el) el.value=maxD; } }

      this.wireForm();
      this.renderAll();
      console.log("[M2.2] inicializado");
    }
  };

  /* boot + hook */
  const boot=()=>{ if (document.readyState==="loading"){ document.addEventListener("DOMContentLoaded", boot, {once:true}); return; } if (window.PV6 && typeof PV6.onDataReady==="function") return; setTimeout(()=>M2.init(),400); };
  boot();
  window.__PV6_M2_INIT__ = () => M2.init();
})();
