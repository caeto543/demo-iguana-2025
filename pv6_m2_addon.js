/* pv6_m2_addon.js — M2.2 hotfix estable (con UI autoinyectada)
   - Crea la sección “Pastoreo con manejo” si no existe
   - Origen: estrictamente ocupados (autocorrige fecha si no hay)
   - Destino: “— Ningún potrero (salida de finca) —” + todos los potreros (ocupados marcados)
   - Recalcular sugeridos usa UA/PV/N ingresada (override) y calcula D0/Dadj
   - Formulario inteligente: UA ↔ PV/N mutuamente excluyentes + “Limpiar”
   - UA finca/KPIs refrescados tras cada operación
   - Autoextiende end si hay MOV más nuevo que biomasa
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
      uaIndex:null, allPots:[], occToday:null
    },

    /* ========== UI: crear si falta ========== */
    ensureUI() {
      if (document.getElementById("pv6-manejo")) return;
      // dónde insertarlo: debajo del card de simulación si existe; si no, al final de .side
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

      // estilos mínimos si no existen
      if (!document.getElementById("pv6-manejo-css")) {
        const st = document.createElement("style");
        st.id = "pv6-manejo-css";
        st.textContent = `
          #pv6-manejo label{display:flex;flex-direction:column;font-size:12px;color:#475569}
          #pv6-manejo input, #pv6-manejo select{padding:6px 8px;border:1px solid #d0d7e2;border-radius:8px}
        `;
        document.head.appendChild(st);
      }
    },

    /* ========== Utils ========== */
    norm(s){ return String(s??"").trim().toLowerCase(); },
    toISO(d){ return d instanceof Date ? d.toISOString().slice(0,10) : String(d??"").slice(0,10); },
    num(x){ if(typeof x==="number") return x; if(x==null) return 0; const s=String(x).replace(/\./g,"").replace(/,/g,"."); const v=parseFloat(s); return isFinite(v)?v:0; },
    findCol(row, names){ for(const k of Object.keys(row)){ if(names.includes(this.norm(k))) return k; } return null; },

    /* ========== Índice UA por potrero/fecha ========== */
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

    /* ========== Ocupados estrictos y listas ========== */
    setAllPots(list){ this.state.allPots = Array.from(new Set(list.filter(Boolean))).sort((a,b)=>a.localeCompare(b)); },
    computeOccForDate(dateISO){ const occ=new Set(); for(const p of this.state.allPots){ const ua=this.lastUAonOrBefore(this.state.uaIndex,p,dateISO); if(ua>0) occ.add(p); } return occ; },
    collectAllDates(){ const S=new Set(); const idx=this.state.uaIndex||{}; for(const p in idx) for(const d in idx[p]) S.add(d); return Array.from(S).sort(); },

    /* ========== Auto-extender end si hay MOV + nuevos ========== */
    autoExtendEndIfNeeded(maxMovDateISO){
      try{
        if(maxMovDateISO && maxMovDateISO>this.state.dateEnd){
          this.state.dateEnd = maxMovDateISO;
          const el=document.getElementById("date-end"); if(el) el.value=maxMovDateISO;
          console.log("[M2.2] end auto-extend →", maxMovDateISO);
        }
      }catch{}
    },

    /* ========== Días con override UA ========== */
    computeDaysSafe(pot, uaOverride){
      try{
        if (window.PV6 && typeof PV6.computeDays==="function"){
          return PV6.computeDays(pot, this.state.dateEnd, uaOverride);
        }
      }catch{}
      // fallback
      const kgms = (window.PV6?.data?.kgms7dByPot?.[pot]?.[this.state.dateEnd]) ?? 2000;
      const area = (window.PV6?.data?.areaHaByPot?.[pot]) ?? 1;
      const of = kgms * area * (this.state.uso/100);
      const dem = (uaOverride>0?uaOverride:1)*this.state.auKg;
      const d = dem>0 ? of/dem : 0;
      return { d0:d, dadj: Math.max(0, d*0.85) };
    },

    /* ========== Formulario inteligente + acciones ========== */
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

      elClr?.addEventListener("click", ()=>{ if(elUA) elUA.value=""; if(elPV){elPV.value=""; elPV.disabled=false;} if(elN){elN.value=""; elN.disabled=false;} this.state.overrideUA=this.state.overridePV=this.state.overrideN=null; });

      elRec?.addEventListener("click", ()=>{
        const ua = this.state.overrideUA ?? 0;
        if (window.PV6?.ui?.recalcSuggestions) {
          window.PV6.ui.recalcSuggestions(ua, (pot)=> this.computeDaysSafe(pot, ua));
        }
        console.log("[M2.2] sugeridos recalculados con UA=", ua);
      });

      elDo?.addEventListener("click", ()=> this.applyMoveOrEnter("move"));
      elIn?.addEventListener("click", ()=> this.applyMoveOrEnter("enter"));
    },

    refreshOriginDestSelectors(){
      const dateISO=this.state.dateEnd;
      const selOri=document.getElementById("mov-origin");
      const selDes=document.getElementById("mov-dest");

      // ORIGEN: solo ocupados (autocorrección si no hay)
      if (selOri){
        selOri.innerHTML="";
        const occ=this.computeOccForDate(dateISO);
        const occList=Array.from(occ).sort((a,b)=>a.localeCompare(b));
        if (!occList.length){
          const allDates=this.collectAllDates();
          for(let i=allDates.length-1;i>=0;i--){
            const d=allDates[i], occ2=this.computeOccForDate(d);
            if (occ2.size>0){ this.state.dateEnd=d; const el=document.getElementById("date-end"); if(el) el.value=d; console.log("[M2.2] Ajuste de fecha (sin ocupados) →", d); return this.refreshOriginDestSelectors(); }
          }
        } else {
          for(const p of occList){ const opt=document.createElement("option"); opt.value=p; opt.textContent=p; selOri.appendChild(opt); }
        }
      }

      // DESTINO: salida de finca + sugeridos + todos
      if (selDes){
        selDes.innerHTML="";
        const opt0=document.createElement("option"); opt0.value="__OUT__"; opt0.textContent="— Ningún potrero (salida de finca) —"; selDes.appendChild(opt0);

        const sugg = (window.PV6?.ui?.getSuggestedDests ? window.PV6.ui.getSuggestedDests(this.state.dateEnd) : []);
        if (sugg && sugg.length){
          const grp=document.createElement("optgroup"); grp.label="Destinos sugeridos";
          for(const p of sugg){ const op=document.createElement("option"); op.value=p; op.textContent=p; grp.appendChild(op); }
          selDes.appendChild(grp);
        }
        const grp2=document.createElement("optgroup"); grp2.label="Todos los potreros";
        const occ = this.computeOccForDate(this.state.dateEnd);
        for (const p of this.state.allPots){ const op=document.createElement("option"); op.value=p; op.textContent=occ.has(p)?`${p} (ocupado)`:p; grp2.appendChild(op); }
        selDes.appendChild(grp2);
      }
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
      const d=this.state.dateEnd; this.addMovRow(d,dst, Math.max(0,ua)); this.recalcAfterChange(); console.log(`[M2.2] Ingresar → ${ua} UA a ${dst} (${d})`);
    },
    applyExit(src, ua){
      const d=this.state.dateEnd; const cur=this.lastUAonOrBefore(this.state.uaIndex,src,d); const take=Math.min(cur, ua);
      this.addMovRow(d,src, -take); this.recalcAfterChange(); console.log(`[M2.2] Salida de finca ← ${take} UA desde ${src} (${d})`);
    },
    applyMove(src,dst,ua){
      const d=this.state.dateEnd; const cur=this.lastUAonOrBefore(this.state.uaIndex,src,d); const take=Math.min(cur, ua);
      if (take<=0) return alert("No hay UA suficientes en el origen para mover.");
      this.addMovRow(d,src,-take); this.addMovRow(d,dst,+take); this.recalcAfterChange();
      console.log(`[M2.2] Mover ${take} UA: ${src} → ${dst} (${d})`);
    },

    recalcKPI(){
      const d=this.state.dateEnd; let uaTot=0;
      for (const p of this.state.allPots){ const u=this.lastUAonOrBefore(this.state.uaIndex,p,d); if(u>0) uaTot+=u; }
      const el=document.getElementById("kpi-ua-finca"); if (el) el.textContent = new Intl.NumberFormat("es-CO",{maximumFractionDigits:1}).format(uaTot);
      if (window.PV6?.ui?.onKpiChange) window.PV6.ui.onKpiChange({ uaTot });
    },
    recalcAfterChange(){
      this.refreshOriginDestSelectors();
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
      // auKg para convertir PV→UA (usa PV6.state.consumo? No: PV6.state.auKg si existe, si no default 10)
      this.state.auKg      = +((window.PV6?.state?.auKg) ?? this.state.auKg);

      // fuentes para listas
      const pots = new Set();
      try{ (window.PV6?.data?.geojson?.features||[]).forEach(f=>pots.add(f?.properties?.name_canon||f?.properties?.name||f?.properties?.padre)); }catch{}
      try{ Object.keys(window.PV6?.data?.kgms7dByPot||{}).forEach(p=>pots.add(p)); }catch{}
      this.setAllPots(Array.from(pots));

      // índice UA
      const movRows = window.PV6?.data?.movRows || [];
      this.state.uaIndex = this.buildUAIndex(movRows);

      // auto-extender end con última fecha de MOV
      const allDates=this.collectAllDates();
      if (allDates.length) this.autoExtendEndIfNeeded(allDates[allDates.length-1]);

      // armar selects + form
      this.refreshOriginDestSelectors();
      this.wireForm();

      console.log("[M2.2] inicializado");
    }
  };

  // Boot cuando esté listo el DOM y los datos
  const boot = () => {
    if (document.readyState === "loading"){
      document.addEventListener("DOMContentLoaded", boot, {once:true}); return;
    }
    if (window.PV6 && typeof PV6.onDataReady === "function"){
      // el app ya llama a onDataReady → no hacemos nada aquí
      return;
    }
    // en caso de que no haya hook, intentar tras breve espera
    setTimeout(()=>M2.init(), 400);
  };
  boot();

  // Exponer entrada pública
  window.__PV6_M2_INIT__ = () => M2.init();
})();
