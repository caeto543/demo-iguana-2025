/* PV6 M3 — FDN (120/FDN) + desperdicio por curva — parche autónomo
   Requiere que 'aplicación.v6.js' haya cargado antes.
   No toca tu app original: extiende/monkey-patch sobre window.PV6 de forma segura.
*/
(function(){
  const PV6 = (window.PV6 = window.PV6 || {});
  const state = (PV6.state = PV6.state || {});
  const params = (PV6.params = PV6.params || {});

  // --------- Defaults robustos ----------
  function getNum(v, def){ const x = Number(v); return isFinite(x) ? x : def; }
  state.coefUso = getNum(state.coefUso, 60);
  state.consumo = getNum(state.consumo, 10);
  params.auKg    = getNum(params.auKg, 450);

  // switches (opt-in)
  params.use_fdn_120_over = (params.use_fdn_120_over ?? 1) ? 1 : 0;
  params.waste_mode = (params.waste_mode || "curve");

  // curva de aprovechamiento (φ) si está disponible
  const CURVE = Array.isArray(params.waste_curve_table) && params.waste_curve_table.length
    ? params.waste_curve_table.slice().sort((a,b)=>a.d-b.d)
    : [
        {d:0.5,u:1.00},{d:1.0,u:1.00},{d:2.0,u:0.80},{d:3.0,u:0.64},
        {d:4.0,u:0.51},{d:5.0,u:0.41},{d:6.0,u:0.33},{d:7.0,u:0.26},{d:9.0,u:0.19}
      ];

  params.beta = getNum(params.beta, 0.05);
  params.wmax = getNum(params.wmax, 0.30);

  // --------- Utilidades ----------
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function toPct(v){ return (v<=1) ? v*100 : v; }

  // Consumo por FDN (regla 120/FDN), acotado 6–14 kg/UA/d.
  function consumoDesdeFDN(fnd){
    if (!params.use_fdn_120_over) return state.consumo;
    if (fnd == null || isNaN(fnd)) return state.consumo;
    const fdnPct = toPct(Number(fnd));
    const pctPV  = 120 / Math.max(1, fdnPct);     // %PV/día
    const cons   = (pctPV/100) * (params.auKg || 450);
    return clamp(cons, 6, 14);
  }

  // φ(D) desde curva (interpolación lineal). φ=1 si D<=1.
  function phiFromCurve(D){
    if (D == null || !isFinite(D)) return 1;
    if (D <= 1) return 1;
    for (let i=1;i<CURVE.length;i++){
      const A = CURVE[i-1], B = CURVE[i];
      if (D <= B.d){
        const t = (D - A.d)/(B.d - A.d);
        return A.u + t*(B.u - A.u);
      }
    }
    return CURVE[CURVE.length-1].u; // cola
  }

  // φ(D) lineal β/Wmax (compatibilidad)
  function phiFromLinear(D){
    if (D == null || !isFinite(D)) return 1;
    const beta = params.beta, wmax = params.wmax;
    const w = Math.min(beta * Math.max(D-1,0), wmax);
    return 1 - w;
  }

  // Obtiene kg/ha actuales según fuente y fecha (con fallback)
  // Requiere que PV6 ya haya cargado datos (PV6.data.*)
  function kgForPotNow(pot, dateISO){
    try{
      if (typeof PV6.kgForPot === "function") return PV6.kgForPot(pot, dateISO);
      if (PV6.ui && typeof PV6.ui.kgForPot === "function") return PV6.ui.kgForPot(pot, dateISO);
      // Fallback: mapas precomputados en PV6.data
      const D = PV6.data || {};
      const src = (PV6.state?.fuente||"kgms_7d").toLowerCase().includes("raw") ? "kgms_raw" : "kgms_7d";
      const map = D[src+"ByPot"] || D[src] || {};
      const series = map[pot];
      if (!series) return null;
      const keys = Object.keys(series).filter(k=>/^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
      if (!keys.length) return Number(series) || null;
      const d0 = dateISO || PV6.state?.end || keys[keys.length-1];
      const idx = keys.findIndex(k=>k>=(d0));
      const pick = (idx<0) ? keys[keys.length-1] : (keys[idx]===d0 ? d0 : keys[Math.max(0,idx-1)]);
      return Number(series[pick]) || null;
    }catch(e){ return null; }
  }

  // Área por potrero
  function areaHa(pot){
    if (PV6.areas && typeof PV6.areas.get === "function") return PV6.areas.get(pot) || 0;
    if (PV6.data?.areaHaByPot && pot in PV6.data.areaHaByPot) return PV6.data.areaHaByPot[pot]||0;
    return 0;
  }

  // FDN por potrero (puede venir 0–1 o 0–100)
  function fndFor(pot){
    const F = PV6.fndByPot || PV6.data?.fndByPot || {};
    if (pot in F) return Number(F[pot]);
    return null;
  }

  // --------- Núcleo: computeDays (split + trazas) ----------
  function computeDaysCore(kg, area, UA, fnd){
    const uso     = (state.coefUso/100);
    const cons0   = state.consumo;
    const oferta  = (kg||0) * (area||0) * uso;

    // Días brutos
    const dem0 = (UA||0) * cons0;
    const Dbr  = (oferta>0 && dem0>0) ? (oferta/dem0) : null;

    // FDN (120/FDN si está activo)
    const consFDN = params.use_fdn_120_over ? consumoDesdeFDN(fnd) : cons0;
    const demF    = (UA||0) * consFDN;
    const Dfdn    = (oferta>0 && demF>0) ? (oferta/demF) : null;

    // Desperdicio
    let phi = 1;
    if (Dfdn!=null){
      if (params.waste_mode === "curve") phi = phiFromCurve(Dfdn);
      else phi = phiFromLinear(Dfdn);
    }
    const Daj = (Dfdn==null) ? null : (Dfdn * phi);

    return { Dbr, Dfdn, phi, Daj, oferta, dem0, demF, cons0, consFDN };
  }

  // API pública nueva/estable
  PV6.computeDays = function(pot, dateISO, uaOverride){
    const area = areaHa(pot);
    const kg   = kgForPotNow(pot, dateISO);
    const fnd  = fndFor(pot);
    const UA   = Number(uaOverride||0);
    const r = computeDaysCore(kg, area, UA, fnd);
    return { d0: r.Dbr||0, dfdn: r.Dfdn||0, phi: r.phi||1, dadj: r.Daj||0, area, kg, fnd };
  };

  // Para la UI (trazas completas por potrero)
  PV6.traceForPot = function(pot, dateISO, uaOverride){
    const area = areaHa(pot);
    const kg   = kgForPotNow(pot, dateISO);
    const fnd  = fndFor(pot);
    const UA   = Number(uaOverride||0);
    return computeDaysCore(kg, area, UA, fnd);
  };

  // Helper para otros módulos
  PV6.kgForPotNow = kgForPotNow;

  console.log("[M3] FDN(120/FDN) + desperdicio", { use_fdn_120_over: !!params.use_fdn_120_over, waste_mode: params.waste_mode });
})();
