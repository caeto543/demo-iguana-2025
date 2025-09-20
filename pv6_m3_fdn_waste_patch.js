/* PV6 M3 — FDN + desperdicio (estables)
   - Fija PV6.data.fdnByPot si existe Iguana_FND_por_potrero.
   - Expone computeDays(pot, endISO, UAoverride) para M2.
   - φ(D) = max(0, 1 - min(wmax, beta * DFDN)), con beta y wmax desde defaults.
*/
(function(){
  "use strict";
  const PV6 = (window.PV6 = window.PV6 || {});
  PV6.defaults = PV6.defaults || {};
  PV6.state    = PV6.state    || {};
  PV6.data     = PV6.data     || {};

  // Amarre explícito al mapa correcto si existe:
  if (!PV6.data.fdnByPot) {
    if (PV6.data.Iguana_FND_por_potrero && typeof PV6.data.Iguana_FND_por_potrero === "object") {
      PV6.data.fdnByPot = PV6.data.Iguana_FND_por_potrero;
    }
  }

  function toISO(s){
    if(!s) return null; const t=String(s).trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m=t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if(m){const d=m[1].padStart(2,"0"),M=m[2].padStart(2,"0"),y=m[3];return `${y}-${M}-${d}`;}
    const dt=new Date(t); return isNaN(dt)?t:dt.toISOString().slice(0,10);
  }

  function kgForPot(pot, endISO){
    const raw = (PV6.state?.fuente||"kgms_7d").toLowerCase().includes("raw");
    const D = PV6.data||{};
    const map = raw ? (D.kgmsRawByPot || D.kg_by_pot) : (D.kgms7dByPot || D.kgms_by_pot);
    const s = map?.[pot]; if(!s) return null;
    const ks = Object.keys(s).filter(k=>/^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
    if(!ks.length) return Number(s)||null;
    const end = toISO(endISO) || ks[ks.length-1];
    const i   = ks.findIndex(k=>k>=end);
    const pick=(i<0)?ks[ks.length-1]:(ks[i]===end?end:ks[Math.max(0,i-1)]);
    return Number(s[pick])||null;
  }

  function getFDN(p){
    let v = PV6.data?.fdnByPot?.[p];
    if (v == null) v = PV6.defaults?.fdn_default ?? 0.6;
    v = Number(v);
    if (!isFinite(v)) v = 0.6;
    if (v > 1.5) v = v/100;            // 69 -> 0.69
    return Math.min(Math.max(v,0.3),0.9);
  }

  function computeDays(pot, endISO, UAoverride=0){
    const kg   = Number(kgForPot(pot, endISO) || 0);
    const area = Number(PV6.data?.areaHaByPot?.[pot] || 0);
    const cons = Number(PV6.state?.consumo ?? 10);              // kg/UA/d (base UI)
    const auKg = Number(PV6.defaults?.auKg ?? 450);             // kg/UA
    const ua   = Math.max(Number(UAoverride)||0, 0.0001);

    // Días “brutos” con consumo base (no usa FDN ni φ)
    const d0 = (kg*area) / (ua*cons);

    // FDN → consumo teórico por UA
    const fdn = getFDN(pot);              // 0..1
    const pct = 120/(fdn*100);            // %
    const cons_fdn = auKg*(pct/100);      // kg/UA/d
    const dfdn = (kg*area) / (ua*cons_fdn);

    // φ(D) por desperdicio (curva simple)
    const beta = Number(PV6.defaults?.params?.beta ?? PV6.defaults?.beta ?? 0.05);
    const wmax = Number(PV6.defaults?.params?.wmax ?? PV6.defaults?.wmax ?? 0.30);
    const phi  = Math.max(0, 1 - Math.min(wmax, beta * dfdn));
    const dadj = dfdn * phi;

    return { d0, dfdn, phi, dadj };
  }

  PV6.M3 = PV6.M3 || {};
  PV6.M3.computeDays = computeDays;

  console.log("[M3] FDN(120/FDN) + desperdicio", {
    use_fdn_120_over: true,
    waste_mode: 'curve'
  });
})();
