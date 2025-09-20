/* PV6 M3 — FDN (120/FDN) + desperdicio por curva — parche autónomo */
(function(){
  const PV6 = (window.PV6 = window.PV6 || {});
  const state = (PV6.state = PV6.state || {});
  const params = (PV6.params = PV6.params || {});

  function n(v,d){ v=Number(v); return Number.isFinite(v)?v:d; }
  state.coefUso = n(state.coefUso, 60);
  state.consumo = n(state.consumo, 10);
  params.auKg    = n(params.auKg, 450);

  params.use_fdn_120_over = (params.use_fdn_120_over ?? 1) ? 1 : 0;
  params.waste_mode = (params.waste_mode || "curve");

  const CURVE = Array.isArray(params.waste_curve_table) && params.waste_curve_table.length
    ? params.waste_curve_table.slice().sort((a,b)=>a.d-b.d)
    : [
        {d:0.5,u:1.00},{d:1.0,u:1.00},{d:2.0,u:0.80},{d:3.0,u:0.64},
        {d:4.0,u:0.51},{d:5.0,u:0.41},{d:6.0,u:0.33},{d:7.0,u:0.26},{d:9.0,u:0.19}
      ];

  params.beta = n(params.beta, 0.05);
  params.wmax = n(params.wmax, 0.30);

  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function toPct(v){ v=Number(v); return (v<=1)? v*100 : v; }

  function consumoDesdeFDN(fnd){
    if (!params.use_fdn_120_over) return state.consumo;
    if (fnd == null || isNaN(fnd)) return state.consumo;
    const fdnPct = toPct(fnd);
    const pctPV  = 120 / Math.max(1, fdnPct);
    const cons   = (pctPV/100) * (params.auKg || 450);
    return clamp(cons, 6, 14);
  }

  function phiFromCurve(D){
    if (D == null || !isFinite(D)) return 1;
    if (D <= 1) return 1;
    for (let i=1;i<CURVE.length;i++){
      const A=CURVE[i-1], B=CURVE[i];
      if (D <= B.d){
        const t=(D-A.d)/(B.d-A.d);
        return A.u + t*(B.u-A.u);
      }
    }
    return CURVE[CURVE.length-1].u;
  }

  function phiFromLinear(D){
    if (D == null || !isFinite(D)) return 1;
    const w = Math.min(params.beta * Math.max(D-1,0), params.wmax);
    return 1 - w;
  }

  function kgForPotNow(pot, dateISO){
    try{
      if (typeof PV6.kgForPot === "function") return PV6.kgForPot(pot, dateISO);
      if (PV6.ui && typeof PV6.ui.kgForPot === "function") return PV6.ui.kgForPot(pot, dateISO);
      const D = PV6.data || {};
      const src = (PV6.state?.fuente||"kgms_7d").toLowerCase().includes("raw") ? "kgms_raw" : "kgms_7d";
      const map = D[src+"ByPot"] || D[src] || {};
      const series = map[pot];
      if (!series) return null;
      const keys = Object.keys(series).filter(k=>/^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
      if (!keys.length) return Number(series) || null;
      const d0 = dateISO || PV6.state?.end || keys[keys.length-1];
      const idx = keys.findIndex(k=>k>=d0);
      const pick = (idx<0) ? keys[keys.length-1] : (keys[idx]===d0 ? d0 : keys[Math.max(0,idx-1)]);
      return Number(series[pick]) || null;
    }catch(e){ return null; }
  }

  function areaHa(pot){
    if (PV6.areas && typeof PV6.areas.get === "function") return PV6.areas.get(pot) || 0;
    if (PV6.data?.areaHaByPot && pot in PV6.data.areaHaByPot) return PV6.data.areaHaByPot[pot]||0;
    return 0;
  }

  function fndFor(pot){
    const F = PV6.fndByPot || PV6.data?.fndByPot || {};
    if (pot in F) return Number(F[pot]);
    return null;
  }

  function computeDaysCore(kg, area, UA, fnd){
    const uso     = (state.coefUso/100);
    const cons0   = state.consumo;
    const oferta  = (kg||0)*(area||0)*uso;

    const dem0 = (UA||0)*cons0;
    const Dbr  = (oferta>0 && dem0>0) ? (oferta/dem0) : null;

    const consFDN = params.use_fdn_120_over ? consumoDesdeFDN(fnd) : cons0;
    const demF = (UA||0)*consFDN;
    const Dfdn = (oferta>0 && demF>0) ? (oferta/demF) : null;

    let phi = 1;
    if (Dfdn!=null){
      phi = (params.waste_mode==="curve") ? phiFromCurve(Dfdn) : phiFromLinear(Dfdn);
    }
    const Daj = (Dfdn==null) ? null : (Dfdn*phi);

    return { Dbr, Dfdn, phi, Daj, oferta, dem0, demF, cons0, consFDN };
  }

  PV6.computeDays = function(pot, dateISO, uaOverride){
    const area=areaHa(pot), kg=kgForPotNow(pot, dateISO), fnd=fndFor(pot);
    const UA=Number(uaOverride||0);
    const r=computeDaysCore(kg, area, UA, fnd);
    return { d0:r.Dbr||0, dfdn:r.Dfdn||0, phi:r.phi||1, dadj:r.Daj||0, area, kg, fnd };
  };

  PV6.traceForPot = function(pot, dateISO, uaOverride){
    const area=areaHa(pot), kg=kgForPotNow(pot, dateISO), fnd=fndFor(pot);
    const UA=Number(uaOverride||0);
    return computeDaysCore(kg, area, UA, fnd);
  };

  PV6.kgForPotNow = kgForPotNow;

  console.log("[M3] FDN(120/FDN) + desperdicio", { use_fdn_120_over: !!params.use_fdn_120_over, waste_mode: params.waste_mode });
})();
