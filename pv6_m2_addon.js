/* pv6_m2_addon.js — M2.2 hotfix estable
   - Origen: estrictamente ocupados; autocorrección de fecha si no hay ocupados.
   - Destino: “— Ningún potrero (salida de finca) —” + poder elegir cualquier potrero (ocupado o libre).
   - “Recalcular sugeridos”: D0/Dadj en función de UA/PV/N ingresada (override).
   - Formulario inteligente: UA ↔ PV/N mutuamente excluyentes + botón “Limpiar”.
   - UA finca: suma/ resta correctas; KPI finca recalculado después de cada operación.
   - Auto-extiende fecha “hasta” si hay movimientos más recientes que la última biomasa.
   - Robusto con MOV remoto (commas, _ts, mapeo columnas flexible).
*/
(function () {
  const M2 = {
    // === Config: nombres de columnas esperadas en MOV ===
    MOV_COLS: {
      date: ["fecha", "date", "dia"],
      pot: ["name_canon", "potrero", "name", "padre"],
      ua: ["ua", "UA", "UA_total", "ua_total"],
      n: ["n", "N", "N_total", "n_total"],
      pv: ["pv", "PV_total_kg", "pv_total_kg", "pv_kg"]
    },

    state: {
      dateStart: null,
      dateEnd: null,
      auKg: 10,     // kg MS/d por UA (para UA<->PV)
      uso: 60,      // %
      overrideUA: null,
      overridePV: null,
      overrideN: null,
      potSel: null,
      uaIndex: null,     // { potrero: { dateISO: UA } ultimo válido <= fecha }
      occToday: null,    // Set de ocupados a la fechaEnd
      allPots: [],       // lista de potreros conocidos (del geojson o biomasa)
    },

    // ===== Util =====
    norm(s) { return String(s ?? "").trim().toLowerCase(); },
    findCol(row, names) {
      for (const k of Object.keys(row)) {
        const nk = k.trim().toLowerCase();
        if (names.includes(nk)) return k;
      }
      return null;
    },
    toISO(d) {
      if (d instanceof Date) return d.toISOString().slice(0,10);
      return String(d ?? "").slice(0,10);
    },
    num(x) {
      if (typeof x === "number") return x;
      if (x == null) return 0;
      const s = String(x).replace(/\./g, "").replace(/,/g, "."); // “1.234,56” → “1234.56”
      const v = parseFloat(s);
      return isFinite(v) ? v : 0;
    },

    // ===== Carga / índices UA =====
    buildUAIndex(movRows) {
      const C = this.MOV_COLS;
      const out = {}; // pot → { dateISO: lastUA }
      if (!Array.isArray(movRows)) return out;

      // detectar columnas una vez
      const sample = movRows.find(r => r && Object.keys(r).length);
      if (!sample) return out;
      const kDate = this.findCol(sample, C.date) || "date";
      const kPot  = this.findCol(sample, C.pot)  || "name_canon";
      const kUA   = this.findCol(sample, C.ua)   || "UA";
      // (si no existe UA, usamos N como proxy con 1 UA = 1 N)
      const kN    = this.findCol(sample, C.n)    || "N";

      const sorted = [...movRows].map(r => ({
        date: this.toISO(r[kDate]),
        pot:  String(r[kPot] ?? "").trim(),
        ua:   this.num(r[kUA] ?? r[kN] ?? 0)
      })).filter(r => r.pot && r.date)
        .sort((a,b) => a.date.localeCompare(b.date));

      for (const r of sorted) {
        out[r.pot] ||= {};
        out[r.pot][r.date] = r.ua;
      }
      return out;
    },

    lastUAonOrBefore(uaIndex, pot, dateISO) {
      const recs = uaIndex?.[pot];
      if (!recs) return 0;
      let best = 0, bestDate = "";
      for (const d in recs) {
        if (d <= dateISO && d >= bestDate) { best = recs[d]; bestDate = d; }
      }
      return best;
    },

    setAllPots(list) {
      // Mantener únicos y ordenar alfabético
      const S = new Set(list.filter(Boolean).map(s => String(s).trim()));
      this.state.allPots = Array.from(S).sort((a,b)=>a.localeCompare(b));
    },

    // ===== Ocupados estrictos =====
    computeOccForDate(dateISO) {
      const occ = new Set();
      for (const p of this.state.allPots) {
        const ua = this.lastUAonOrBefore(this.state.uaIndex, p, dateISO);
        if (ua > 0) occ.add(p);
      }
      return occ;
    },

    // ===== Auto-extensión de fecha hasta =====
    autoExtendEndIfNeeded(maxMovDateISO) {
      try {
        const end = this.state.dateEnd;
        if (maxMovDateISO && maxMovDateISO > end) {
          this.state.dateEnd = maxMovDateISO;
          // reflejar en UI si existe input
          const el = document.getElementById("date-end");
          if (el) el.value = maxMovDateISO;
          console.log("[M2.2] end auto-extend →", maxMovDateISO);
        }
      } catch {}
    },

    // ===== Destinos sugeridos y días (con override) =====
    // computeDays debe existir en app principal; si no, hacemos un estimado simple
    computeDaysSafe(pot, uaOverride) {
      try {
        if (window.PV6 && typeof PV6.computeDays === "function") {
          return PV6.computeDays(pot, this.state.dateEnd, uaOverride);
        }
      } catch {}
      // Fallback simple: días = (kgMS_ha * ha * uso%) / (ua * auKg)
      const kgms = (window.PV6?.data?.kgms7dByPot?.[pot]?.[this.state.dateEnd]) ?? 2000;
      const area = (window.PV6?.data?.areaHaByPot?.[pot]) ?? 1;
      const oferta = kgms * area * (this.state.uso / 100); // kg MS util
      const demDia = (uaOverride>0 ? uaOverride : 1) * this.state.auKg; // kg/d
      const d = demDia>0 ? oferta / demDia : 0;
      return { d0: d, dadj: Math.max(0, d*0.85) };
    },

    // ===== Formulario inteligente =====
    wireForm() {
      const elUA = document.getElementById("mov-ua");
      const elPV = document.getElementById("mov-pv");
      const elN  = document.getElementById("mov-n");
      const elRec= document.getElementById("btn-recalc");
      const elClr= document.getElementById("btn-clear");
      const elDo = document.getElementById("btn-move");
      const elIn = document.getElementById("btn-enter");

      const lock = () => {
        const ua = this.num(elUA?.value);
        const pv = this.num(elPV?.value);
        const n  = this.num(elN?.value);
        // prioridades: UA → PV → N
        if (ua>0) {
          if (elPV) { elPV.value = ""; elPV.disabled = true; }
          if (elN)  { elN.value  = ""; elN.disabled  = true; }
          this.state.overrideUA = ua;
          this.state.overridePV = null;
          this.state.overrideN  = null;
        } else if (pv>0) {
          const ua2 = pv / this.state.auKg;
          if (elUA) { elUA.value = String(ua2.toFixed(2)); }
          if (elN)  { elN.value  = ""; elN.disabled  = true; }
          if (elPV) elPV.disabled = false;
          if (elN)  elN.disabled  = true;
          this.state.overrideUA = ua2;
          this.state.overridePV = pv;
          this.state.overrideN  = null;
        } else if (n>0) {
          if (elUA) { elUA.value = String(n); }
          if (elPV) { elPV.value = ""; elPV.disabled = true; }
          this.state.overrideUA = n;
          this.state.overridePV = null;
          this.state.overrideN  = n;
        } else {
          // limpiar bloqueos
          if (elPV) elPV.disabled = false;
          if (elN)  elN.disabled  = false;
          this.state.overrideUA = null;
          this.state.overridePV = null;
          this.state.overrideN  = null;
        }
      };

      const clear = () => {
        if (elUA) elUA.value = "";
        if (elPV) { elPV.value = ""; elPV.disabled = false; }
        if (elN)  { elN.value  = ""; elN.disabled  = false; }
        this.state.overrideUA = this.state.overridePV = this.state.overrideN = null;
      };

      ["input","change"].forEach(evt=>{
        elUA && elUA.addEventListener(evt, lock);
        elPV && elPV.addEventListener(evt, lock);
        elN  && elN.addEventListener(evt, lock);
      });

      elClr && elClr.addEventListener("click", clear);

      elRec && elRec.addEventListener("click", () => {
        try {
          const ua = this.state.overrideUA ?? 0;
          if (window.PV6?.ui?.recalcSuggestions) {
            window.PV6.ui.recalcSuggestions(ua, (pot) => this.computeDaysSafe(pot, ua));
          }
          console.log("[M2.2] sugeridos recalculados con UA=", ua);
        } catch (e) { console.warn("[M2.2] recalc error", e); }
      });

      // Acciones: mover e ingresar
      elDo && elDo.addEventListener("click", () => this.applyMoveOrEnter("move"));
      elIn && elIn.addEventListener("click", () => this.applyMoveOrEnter("enter"));
    },

    // ===== Origen/Destino =====
    refreshOriginDestSelectors() {
      const dateISO = this.state.dateEnd;
      // origen = solo ocupados a esa fecha
      const selOri = document.getElementById("mov-origin");
      const selDes = document.getElementById("mov-dest");
      if (selOri) {
        selOri.innerHTML = "";
        const occ = this.computeOccForDate(dateISO);
        const occList = Array.from(occ).sort((a,b)=>a.localeCompare(b));
        if (occList.length === 0) {
          // autocorrección de fecha: buscar fecha anterior con ocupados
          const allDates = this.collectAllDates();
          for (let i=allDates.length-1;i>=0;i--) {
            const d = allDates[i];
            const occ2 = this.computeOccForDate(d);
            if (occ2.size>0) {
              this.state.dateEnd = d;
              const el = document.getElementById("date-end");
              if (el) el.value = d;
              console.log("[M2.2] Ajuste de fecha (no había ocupados) →", d);
              return this.refreshOriginDestSelectors(); // rehacer con nueva fecha
            }
          }
        } else {
          for (const p of occList) {
            const opt = document.createElement("option");
            opt.value = p; opt.textContent = p;
            selOri.appendChild(opt);
          }
        }
      }

      if (selDes) {
        selDes.innerHTML = "";
        // Opción salida de finca (solo habilitada en “Mover”)
        const opt0 = document.createElement("option");
        opt0.value = "__OUT__";
        opt0.textContent = "— Ningún potrero (salida de finca) —";
        selDes.appendChild(opt0);

        // Sugeridos primero (si la app los provee)
        const sugg = (window.PV6?.ui?.getSuggestedDests ?
          window.PV6.ui.getSuggestedDests(this.state.dateEnd) : []);
        if (sugg && sugg.length) {
          const grp = document.createElement("optgroup");
          grp.label = "Destinos sugeridos";
          for (const p of sugg) {
            const op = document.createElement("option");
            op.value = p; op.textContent = p;
            grp.appendChild(op);
          }
          selDes.appendChild(grp);
        }

        // Todos los potreros (incluyendo ocupados)
        const grp2 = document.createElement("optgroup");
        grp2.label = "Todos los potreros";
        const occ = this.computeOccForDate(this.state.dateEnd);
        for (const p of this.state.allPots) {
          const op = document.createElement("option");
          op.value = p; 
          op.textContent = occ.has(p) ? `${p} (ocupado)` : p;
          grp2.appendChild(op);
        }
        selDes.appendChild(grp2);
      }
    },

    collectAllDates() {
      const S = new Set();
      const idx = this.state.uaIndex || {};
      for (const p in idx) for (const d in idx[p]) S.add(d);
      return Array.from(S).sort((a,b)=>a.localeCompare(b));
    },

    // ===== Aplicar movimientos =====
    applyMoveOrEnter(kind) {
      // Inputs
      const selOri = document.getElementById("mov-origin");
      const selDes = document.getElementById("mov-dest");
      const elUA = document.getElementById("mov-ua");
      const ua = this.num(elUA?.value);

      if (kind === "enter") {
        // ingresar: destino requerido y distinto a __OUT__
        const dst = selDes?.value;
        if (!dst || dst === "__OUT__") return alert("Elige un destino válido para Ingresar.");
        this.applyIngress(dst, ua);
        return;
      }

      // move
      const src = selOri?.value;
      const dst = selDes?.value;
      if (!src) return alert("Selecciona un origen.");
      if (!dst) return alert("Selecciona un destino (o salida de finca).");
      if (ua <= 0) return alert("Indica la UA a mover.");

      if (dst === "__OUT__") {
        this.applyExit(src, ua);
      } else {
        this.applyMove(src, dst, ua);
      }
    },

    applyIngress(dst, ua) {
      const d = this.state.dateEnd;
      // Suma al destino
      this.addMovRow(d, dst, +ua);
      this.recalcAfterChange();
      console.log(`[M2.2] Ingresar → ${ua} UA a ${dst} (${d})`);
    },

    applyExit(src, ua) {
      const d = this.state.dateEnd;
      const cur = this.lastUAonOrBefore(this.state.uaIndex, src, d);
      const take = Math.min(cur, ua);
      // Resta al origen
      this.addMovRow(d, src, -take);
      this.recalcAfterChange();
      console.log(`[M2.2] Salida de finca ← ${take} UA desde ${src} (${d})`);
    },

    applyMove(src, dst, ua) {
      const d = this.state.dateEnd;
      const cur = this.lastUAonOrBefore(this.state.uaIndex, src, d);
      const take = Math.min(cur, ua);
      if (take <= 0) return alert("No hay UA suficientes en el origen para mover.");
      // Resta origen / Suma destino
      this.addMovRow(d, src, -take);
      this.addMovRow(d, dst, +take);
      this.recalcAfterChange();
      console.log(`[M2.2] Mover ${take} UA: ${src} → ${dst} (${d})`);
    },

    addMovRow(dateISO, pot, deltaUA) {
      // Append lógico al índice (y si la app expone “pushRow”, úsalo también)
      this.state.uaIndex[pot] ||= {};
      const prev = this.lastUAonOrBefore(this.state.uaIndex, pot, dateISO);
      this.state.uaIndex[pot][dateISO] = Math.max(0, prev + deltaUA);

      if (window.PV6?.data?.movRows) {
        // reflejar en dataset original (para exportes / persistencias si existieran)
        window.PV6.data.movRows.push({
          date: dateISO, name_canon: pot, UA: Math.max(0, prev + deltaUA)
        });
      }
    },

    recalcKPI() {
      // UA finca = suma de UA>0 por potrero a la fechaEnd
      const d = this.state.dateEnd;
      let uaTot = 0;
      for (const p of this.state.allPots) {
        const ua = this.lastUAonOrBefore(this.state.uaIndex, p, d);
        if (ua > 0) uaTot += ua;
      }
      // Pintar si existen elementos
      const el = document.getElementById("kpi-ua-finca");
      if (el) el.textContent = uaTot.toLocaleString("es-CO");
      if (window.PV6?.ui?.onKpiChange) window.PV6.ui.onKpiChange({ uaTot });
    },

    recalcAfterChange() {
      this.refreshOriginDestSelectors();
      this.recalcKPI();
      if (window.PV6?.ui?.refreshMap) window.PV6.ui.refreshMap();
      if (window.PV6?.ui?.refreshRanking) window.PV6.ui.refreshRanking(this.state.overrideUA ?? null);
    },

    // ===== Inicialización =====
    init() {
      if (!window.PV6) window.PV6 = {};
      window.PV6.M2 = this;

      // Tomar parámetros básicos del app si existen:
      try {
        const st = window.PV6?.state;
        if (st) {
          this.state.dateStart = this.toISO(st.dateStart || document.getElementById("date-start")?.value || "2025-01-01");
          this.state.dateEnd   = this.toISO(st.dateEnd   || document.getElementById("date-end")?.value   || "2025-12-31");
          this.state.uso       = +st.coefUso || this.state.uso;
          this.state.auKg      = +st.auKg    || this.state.auKg;
        } else {
          this.state.dateStart = this.toISO(document.getElementById("date-start")?.value || "2025-01-01");
          this.state.dateEnd   = this.toISO(document.getElementById("date-end")?.value   || "2025-12-31");
        }
      } catch {}

      // armar lista de potreros desde fuentes disponibles
      const pots = new Set();
      try {
        const geo = window.PV6?.data?.geojson?.features || [];
        geo.forEach(f => pots.add(f?.properties?.name_canon || f?.properties?.name || f?.properties?.padre));
      } catch {}
      try {
        const bpad = window.PV6?.data?.biomasaPadres || {};
        Object.keys(bpad).forEach(p => pots.add(p));
      } catch {}
      try {
        const bhij = window.PV6?.data?.biomasaHijos || {};
        Object.keys(bhij).forEach(p => pots.add(p));
      } catch {}
      this.setAllPots(Array.from(pots));

      // índice UA desde MOV
      const movRows = window.PV6?.data?.movRows || window.PV6?.data?.MOV || [];
      this.state.uaIndex = this.buildUAIndex(movRows);

      // auto-extender end si hay movimientos más nuevos que la biomasa
      const allDates = this.collectAllDates();
      if (allDates.length) this.autoExtendEndIfNeeded(allDates[allDates.length - 1]);

      // Wire UI si existen elementos
      this.wireForm();
      this.refreshOriginDestSelectors();

      console.log("[M2.2] inicializado");
    }
  };

  // Esperar DOM listo y datos del app
  const boot = () => {
    if (document.readyState !== "complete" && document.readyState !== "interactive") {
      document.addEventListener("DOMContentLoaded", boot, { once:true });
      return;
    }
    // si app principal publica “onDataReady” llamaremos ahí; si no, intentamos en 500ms
    if (window.PV6 && typeof PV6.onDataReady === "function") {
      // el hook del app llamará a init()
      return;
    }
    setTimeout(()=>M2.init(), 500);
  };
  boot();

  // Exponer para que el app lo invoque cuando tenga datos
  window.__PV6_M2_INIT__ = () => M2.init();

})();
