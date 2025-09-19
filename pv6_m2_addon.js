/* pv6_m2_addon.js — M2.2 hotfix estable (FIX padres+ocupados+sugeridos UA)
   - Origen: SOLO padres ocupados a la fecha (sin hijos “_z_”); autocorrección de fecha si no hay ocupados
   - Destino: “— Ningún potrero (salida de finca) —”, luego “Destinos sugeridos” (reordenados por UA/PV/N ingresada),
              y “Todos los potreros” (solo padres). Ocupados marcados correctamente.
   - Recalcular sugeridos: usa UA/PV/N para D0/Dadj y reordenar
   - Formulario UA↔PV/N mutuamente excluyentes + “Limpiar”
   - KPI & mapa/ranking se refrescan tras cada operación
*/
(function () {
  const M2 = {
    MOV_COLS: {
      date: ["fecha", "date", "dia"],
      pot:  ["name_canon", "potrero", "name", "padre"],
      ua:   ["ua","ua_total","UA","UA_total"],
      n:    ["n","N","n_total","N_total"],
      pv:   ["pv","pv_total_kg","PV_total_kg","pv_kg"]
    },
    state: {
      dateStart:null, dateEnd:null,
      uso:60, auKg:10,
      overrideUA:null, overridePV:null, overrideN:null,
      uaIndex:null, allParents:[],   // <— solo PADRES
    },

    /* ========== UI: crear si falta ========== */
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
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button id="btn-recalc" class="btn">Recalcular sugeridos</button>
            <button id="btn-enter" class="btn">Ingresar</button>
            <button id="btn-move" class="btn">Mover</button>
            <button id="btn-clear" class="btn secondary">Limpiar</button>
          </div>
          <div style="margin-top:8px;font-size:12px;color:#475569">
            <span id="m2-hint">Tip: si escribes UA se bloquean PV/N; si escribes PV convertimos a UA con auKg; si escribes N usamos N como UA.</span>
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

    /* ========== Utils ========== */
    norm(s){ return String(s??"").trim().toLowerCase(); },
    toISO(d){ return d instanceof Date ? d.toISOString().slice(0,10) : String(d??"").slice(0,10); },
    num(x){ if(typeof x==="number") return x; if(x==null) return 0; const s=String(x).replace(/\./g,"").replace(/,/g,"."); const v=parseFloat(s); return isFinite(v)?v:0; },
    isParentName(nm){ return !!nm && !String(nm).toLowerCase().includes('_z_'); },
    findCol(row, names){ for(const k of Object.keys(row)){ if(names.includes(this.norm(k))) return k; } return null; },

    /* ========== Índice UA (por potrero/fecha) ========== */
    buildUAIndex(mrows){
      const out={}; if(!Array.isArray(mrows)||!mrows.length) return out;
      const sample=mrows.find(r=>r&&Object.keys(r).length); if(!sample) return out;
      const kDate=this.findCol(sample,this.MOV_COLS.date)||"date";
      const kPot =this.findCol(sample,this.MOV_COLS.pot)||"name_canon";
      const kUA  =this.findCol(sample,this.MOV_COLS.ua)||"UA_total";
      const kN   =this.findCol(sample,this.MOV_COLS.n)||"N_total";

      const rows=[...mrows].map(r=>({date:this.toISO(r[kDate]), pot:String(r[kPot]??"").trim(), ua:this.num(r[kUA]??r[kN]??0)}))
                           .filter(r=>r.pot&&r.date).sort((a,b)=>a.date.localeCompare(b.date));
      for(const r of rows){ (out[r.pot] ||= {})[r.date] = r.ua; }
      return out;
    },
    lastUAonOrBefore(idx,pot,dateISO){
      const recs=idx?.[pot]; if(!recs) return 0;
      let best=0, bd=""; for(const d in recs){ if(d<=dateISO && d>=bd){ best=recs[d]; bd=d; } }
      return best;
    },

    /* ========== Padres & ocupados ========== */
    buildParentsFromGeo(){
      const feat = window.PV6?.data?.geojson?.features || [];
      const S = new Set();
      for (const f of feat){
        const nm = f?.properties?.name_canon || f?.properties?.__canon || f?.properties?.name || f?.properties?.padre;
        if (this.isParentName(nm)) S.add(String(nm).trim());
      }
      // (fallback) si no hay geo, mirar claves de biomasa y filtrar _z_
      if (!S.size && window.PV6?.data?.kgms7dByPot){
        for (const k of Object.keys(window.PV6.data.kgms7dByPot)){ if (this.isParentName(k)) S.add(k); }
      }
      this.state.allParents = Array.from(S).sort((a,b)=>a.localeCompare(b));
    },
    computeOccParents(dateISO){
      const occ = new Set();
      for (const p of this.state.allParents){
        const u = this.lastUAonOrBefore(this.state.uaIndex, p, dateISO);
        if (u > 0) occ.add(p);
      }
      return occ;
    },
    collectAllMoveDates(){
      const S=new Set(); const idx=this.state.uaIndex||{};
      for(const p in idx) for(const d in idx[p]) S.add(d);
      return Array.from(S).sort();
    },

    /* ========== Días con override UA ========== */
    computeDaysSafe(pot, uaOverride){
      try{
        if (window.PV6 && typeof PV6.computeDays==="function"){
          return PV6.computeDays(pot, this.state.dateEnd, uaOverride);
        }
      }catch{}
      // fallback simple
      const kgms = (window.PV6?.data?.kgms7dByPot?.[pot]?.[this.state.dateEnd]) ?? 2000;
      const area = (window.PV6?.data?.areaHaByPot?.[pot]) ?? 1;
      const of = kgms * area * (this.state.uso/100);
      const dem = (uaOverride>0?uaOverride:1)*this.state.auKg;
      const d = dem>0 ? of/dem : 0;
      return { d0:d, dadj: Math.max(0, d*0.85) };
    },

    /* ========== Sugeridos (ordenados por UA override si la hay) ========== */
    getSuggestedParents(uaOverride){
      // base: ranking actual (si está disponible), limitado a padres
      let base = [];
      try{ base = (typeof window.computeRanking==="function" ? window.computeRanking(this.state.dateEnd) : []); }catch{}
      const namesRanked = base.map(r=>r?.nm).filter(n=>this.isParentName(n));

      // si no hay ranking, usar todos los padres
      let cand = namesRanked.length ? namesRanked : [...this.state.allParents];

      // reordenar por Dadj con UA override si está definida
      if (uaOverride && uaOverride>0){
        const scored = cand.map(p=>{
          const d = this.computeDaysSafe(p, uaOverride);
          return { p, score: (d?.dadj ?? 0) };
        }).sort((a,b)=> (b.score - a.score));
        cand = scored.map(x=>x.p);
      }
      return cand.slice(0, 10);
    },

    /* ========== Formulario + acciones ========== */
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
        if (ua>0){ if(elPV){elPV.value=""; elPV.disabled=true;} if(elN){elN.value=""; elN.disabled=true;} this.state.overrideUA=ua; this.state.overridePV=null; this.state.overrideN=null; return; }
        if (pv>0){ const ua2=pv/this.state.auKg; if(elUA) elUA.value=String(ua2.toFixed(2)); if(elN){elN.value=""; elN.disabled=true;} if(elPV) elPV.disabled=false; this.state.overrideUA=ua2; this.state.overridePV=pv; this.state.overrideN=null; return; }
        if (n>0){ if(elUA) elUA.value=String(n); if(elPV){elPV.value=""; elPV.disabled=true;} this.state.overrideUA=n; this.state.overridePV=null; this.state.overrideN=n; return; }
        if(elPV) elPV.disabled=false; if(elN) elN.disabled=false; this.state.overrideUA=this.state.overridePV=this.state.overrideN=null;
      };
      ["input","change"].forEach(evt=>{ elUA?.addEventListener(evt,lock); elPV?.addEventListener(evt,lock); elN?.addEventListener(evt,lock); });

      elClr?.addEventListener("click", ()=>{ if(elUA) elUA.value=""; if(elPV){elPV.value=""; elPV.disabled=false;} if(elN){elN.value=""; elN.disabled=false;} this.state.overrideUA=this.state.overridePV=this.state.overrideN=null; this.refreshDestSelector(); });

      elRec?.addEventListener("click", ()=>{ this.refreshDestSelector(); console.log("[M2.2] sugeridos recalculados con UA=", this.state.overrideUA??0); });

      elDo?.addEventListener("click", ()=> this.applyMoveOrEnter("move"));
      elIn?.addEventListener("click", ()=> this.applyMoveOrEnter("enter"));
    },

    refreshOriginSelector(){
      const selOri=document.getElementById("mov-origin");
      if (!selOri) return;

      selOri.innerHTML = "";
      const dateISO = this.state.dateEnd;
      const occ = this.computeOccParents(dateISO);
      const occList = Array.from(occ).sort((a,b)=>a.localeCompare(b));

      if (!occList.length){
        // autocorrección de fecha hacia atrás
        const allDates=this.collectAllMoveDates();
        for(let i=allDates.length-1;i>=0;i--){
          const d=allDates[i];
          const occ2=this.computeOccParents(d);
          if (occ2.size>0){
            this.state.dateEnd = d;
            const el=document.getElementById("date-end"); if(el) el.value = d;
            console.log("[M2.2] Ajuste de fecha (sin ocupados) →", d);
            return this.refreshOriginSelector();
          }
        }
      } else {
        for (const p of occList){
          const opt=document.createElement("option");
          opt.value=p; opt.textContent=p;
          selOri.appendChild(opt);
        }
      }
    },

    refreshDestSelector(){
      const selDes=document.getElementById("mov-dest");
      if (!selDes) return;

      selDes.innerHTML = "";

      // Salida de finca
      const opt0=document.createElement("option");
      opt0.value="__OUT__";
      opt0.textContent="— Ningún potrero (salida de finca) —";
      selDes.appendChild(opt0);

      // Sugeridos (ordenados, usando UA override si la hay)
      const ua = this.state.overrideUA ?? 0;
      const sug = this.getSuggestedParents(ua);
      if (sug.length){
        const grp=document.createElement("optgroup");
        grp.label="Destinos sugeridos";
        sug.forEach(p=>{ const op=document.createElement("option"); op.value=p; op.textContent=p; grp.appendChild(op); });
        selDes.appendChild(grp);
      }

      // Todos los padres, marcando ocupados
      const grp2=document.createElement("optgroup");
      grp2.label="Todos los potreros";
      const occ = this.computeOccParents(this.state.dateEnd);
      for (const p of this.state.allParents){
        const op=document.createElement("option");
        op.value=p;
        op.textContent = occ.has(p) ? `${p} (ocupado)` : p;
        grp2.appendChild(op);
      }
      selDes.appendChild(grp2);
    },

    applyMoveOrEnter(kind){
      const selOri=document.getElementById("mov-origin");
      const selDes=document.getElementById("mov-dest");
      const elUA =document.getElementById("mov-ua");
      const ua=this.num(elUA?.value);

      if (kind==="enter"){
        const dst=selDes?.value;
        if(!dst || dst==="__OUT__") return alert("Elige un destino válido para Ingresar.");
        this.applyIngress(dst, ua);
        return;
      }

      const src=selOri?.value, dst=selDes?.value;
      if (!src) return alert("Selecciona un origen.");
      if (!dst) return alert("Selecciona un destino (o salida de finca).");
      if (ua<=0) return alert("Indica la UA a mover.");

      if (dst==="__OUT__") this.applyExit(src, ua); else this.applyMove(src,dst,ua);
    },

    addMovRow(dateISO, pot, deltaUA){
      this.state.uaIndex[pot] ||= {};
      const prev=this.lastUAonOrBefore(this.state.uaIndex,pot,dateISO);
      this.state.uaIndex[pot][dateISO] = Math.max(0, prev + deltaUA);
      if (window.PV6?.data?.movRows){
        window.PV6.data.movRows.push({ date:dateISO, name_canon:pot, UA_total:Math.max(0, prev + deltaUA) });
      }
    },
    applyIngress(dst, ua){
      const d=this.state.dateEnd; this.addMovRow(d,dst, Math.max(0,ua)); this.afterChange(); console.log(`[M2.2] Ingresar → ${ua} UA a ${dst} (${d})`);
    },
    applyExit(src, ua){
      const d=this.state.dateEnd; const cur=this.lastUAonOrBefore(this.state.uaIndex,src,d); const take=Math.min(cur, ua);
      this.addMovRow(d,src, -take); this.afterChange(); console.log(`[M2.2] Salida de finca ← ${take} UA desde ${src} (${d})`);
    },
    applyMove(src,dst,ua){
      const d=this.state.dateEnd; const cur=this.lastUAonOrBefore(this.state.uaIndex,src,d); const take=Math.min(cur, ua);
      if (take<=0) return alert("No hay UA suficientes en el origen para mover.");
      this.addMovRow(d,src,-take); this.addMovRow(d,dst,+take); this.afterChange();
      console.log(`[M2.2] Mover ${take} UA: ${src} → ${dst} (${d})`);
    },

    recalcKPI(){
      const d=this.state.dateEnd; let uaTot=0;
      for (const p of this.state.allParents){ const u=this.lastUAonOrBefore(this.state.uaIndex,p,d); if(u>0) uaTot+=u; }
      const el=document.getElementById("kpi-ua-finca"); if (el) el.textContent = new Intl.NumberFormat("es-CO",{maximumFractionDigits:1}).format(uaTot);
      if (window.PV6?.ui?.onKpiChange) window.PV6.ui.onKpiChange({ uaTot });
    },
    afterChange(){
      this.refreshOriginSelector();
      this.refreshDestSelector();
      this.recalcKPI();
      if (window.PV6?.ui?.refreshMap) window.PV6.ui.refreshMap();
      if (window.PV6?.ui?.refreshRanking) window.PV6.ui.refreshRanking(this.state.overrideUA ?? null);
    },

    /* ========== Inicio ========== */
    init(){
      this.ensureUI();

      // tomar estado base
      this.state.dateStart = (window.PV6?.state?.start) || document.getElementById("date-start")?.value || "2025-01-01";
      this.state.dateEnd   = (window.PV6?.state?.end)   || document.getElementById("date-end")?.value   || "2025-12-31";
      this.state.uso       = +((window.PV6?.state?.coefUso) ?? this.state.uso);
      this.state.auKg      = +((window.PV6?.state?.auKg) ?? this.state.auKg);

      // construir lista de PADRES desde geojson (sin _z_)
      this.buildParentsFromGeo();

      // índice UA
      const movRows = window.PV6?.data?.movRows || [];
      this.state.uaIndex = this.buildUAIndex(movRows);

      // auto-extender end con última fecha de MOV
      const allDates=this.collectAllMoveDates();
      if (allDates.length){
        const maxD = allDates[allDates.length-1];
        if (maxD > this.state.dateEnd){
          this.state.dateEnd = maxD;
          const el=document.getElementById("date-end"); if (el) el.value = maxD;
          console.log("[M2.2] end auto-extend →", maxD);
        }
      }

      // armar selects + form
      this.refreshOriginSelector();
      this.refreshDestSelector();
      this.wireForm();

      console.log("[M2.2] inicializado");
    }
  };

  // Boot cuando esté listo el DOM y por si el app no invoca onDataReady
  const boot = () => {
    if (document.readyState === "loading"){
      document.addEventListener("DOMContentLoaded", boot, {once:true}); return;
    }
    if (window.PV6 && typeof PV6.onDataReady === "function"){
      return; // el app llamará a __PV6_M2_INIT__()
    }
    setTimeout(()=>M2.init(), 400);
  };
  boot();

  // Entrada pública (llamada desde app.v6.js bridge)
  window.__PV6_M2_INIT__ = () => M2.init();
})();
