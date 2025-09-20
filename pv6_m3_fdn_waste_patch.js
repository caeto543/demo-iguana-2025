/* =========================================================================
   PV6 M3 — FDN (120/FDN) + Desperdicio (β, wmax)  — v3.1 estable
   - Autocarga FDN desde Iguana_FND_por_potrero.csv -> PV6.data.fdnByPot
   - Expone PV6.M3.computeDays(pot, endISO, UA) y helpers
   ======================================================================== */
(function(){
  const M3 = {};
  (window.PV6 ||= {}); (PV6.data ||= {}); PV6.M3 = M3;

  // --------- utilidades fecha / fuente ----------
  function toISO(s){
    if(!s) return null; const t=String(s).trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m=t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if(m){ return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`; }
    const d=new Date(t); return isNaN(d)? t : d.toISOString().slice(0,10);
  }
  function fuenteMode(){
    const f=(PV6.state?.fuente||"kgms_7d").toLowerCase();
    return (f.includes("raw")||f.includes("día")||f.includes("dia"))?"raw":"7d";
  }

  // --------- lectura Kg/ha por potrero y fecha ----------
  function kgFor(pot, endISO){
    const D=PV6.data||{};
    const mode = fuenteMode();
    const map = (mode==="raw")
      ? (D.kgmsRawByPot || D.kg_by_pot)
      : (D.kgms7dByPot  || D.kgms_by_pot);
    const s = map?.[pot];
    if(!s) return null;

    if(typeof s === "number") return s;
    const ks = Object.keys(s).filter(k=>/^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
    if(!ks.length) return Number(s) || null;

    const end = endISO || ks[ks.length-1];
    let pick = ks[0];
    for(const k of ks){ if(k<=end) pick=k; else break; }
    return Number(s[pick])||null;
  }

  // --------- FDN map: precarga desde CSV ----------
  async function loadFDN() {
    const tries = [
      "./Iguana_FND_por_potrero.csv",
      "Iguana_FND_por_potrero.csv",
      "./Iguana_FND_por_potrero.csv?nocache="+Date.now()
    ];
    for(const url of tries){
      try{
        const txt = await fetch(url, {cache:"no-store"}).then(r=>r.ok?r.text():Promise.reject(r.status));
        const map={};
        txt.trim().split(/\r?\n/).forEach((line,i)=>{
          if(!line.trim()) return;
          const parts=line.split(/,|;|\t/);
          if(i===0 && /pot/i.test(parts[0]||"")) return;
          const name=String(parts[0]||"").trim();
          let v=Number(String(parts[1]||"").replace(",",".")); // 69,1 -> 69.1
          if(!name || !isFinite(v)) return;
          if(v>1.5) v=v/100; // 69 -> 0.69
          v=Math.min(Math.max(v,0.30),0.90);
          map[name]=v;
        });
        PV6.data.fdnByPot = map;
        console.log("[M3][FDN] precargado:", Object.keys(map).length, "potreros");
        return;
      }catch(e){/* sigue intentando */}
    }
    console.warn("[M3][FDN] no se pudo cargar Iguana_FND_por_potrero.csv");
  }
  function ensureFDN(){
    if(PV6.data.fdnByPot && Object.keys(PV6.data.fdnByPot).length) return true;
    return false;
  }
  function whenCoreReady(cb){
    if(PV6.data && PV6.data.areaHaByPot){ cb(); return; }
    const iv=setInterval(()=>{ if(PV6.data && PV6.data.areaHaByPot){ clearInterval(iv); cb(); } }, 150);
    document.addEventListener("DOMContentLoaded", ()=>{ if(PV6.data && PV6.data.areaHaByPot){ cb(); } }, {once:true});
  }
  whenCoreReady(()=>{ if(!ensureFDN()) loadFDN(); });

  // --------- parámetros ----------
  function params(){
    const P = (PV6.defaults?.params)||{};
    const auKg = Number(PV6.defaults?.auKg ?? 450);
    return {
      auKg,
      consumoBase: Number(document.getElementById("consumo-base")?.value || P.consumo_base || 10) || 10,
      beta:  Number(P.beta ?? PV6.defaults?.params?.beta ?? 0.05),
      wmax:  Number(P.wmax ?? PV6.defaults?.params?.wmax ?? 0.30),
      fdnDefault: Number(PV6.defaults?.fdn_default ?? 0.60)
    };
  }

  // --------- ocupados MOV ----------
  function buildMovIndex(){
    const idxUA={}, idxOcc={};
    const rows = Array.isArray(PV6.data?.movRows)? PV6.data.movRows : [];
    for(const r of rows){
      const pot = String(r.name_canon||"").trim();
      const d   = toISO(r.date);
      if(!pot || !d) continue;
      (idxUA [pot] ||= {})[d] = Number(r.UA_total||0);
      (idxOcc[pot] ||= {})[d] = (r.ocupado==null||r.ocupado==="")? null : (Number(r.ocupado)>0?1:0);
    }
    return {idxUA, idxOcc};
  }
  function lastOnOrBefore(idx,pot,endISO,def=null){
    const rec=idx[pot]; if(!rec) return def; let best=def, bd="";
    for(const k in rec){ const iso=toISO(k); if(iso && iso<=endISO && iso>=bd){ best=rec[k]; bd=iso; } }
    return best;
  }
  M3.ocupadosAt = function(endISO){
    const {idxUA, idxOcc} = buildMovIndex();
    const pots = Object.keys(PV6.data?.areaHaByPot||{});
    const out=[];
    for(const p of pots){
      const occ = lastOnOrBefore(idxOcc,p,endISO,null);
      if(occ!=null){ if(occ>0) out.push(p); continue; }
      const ua = lastOnOrBefore(idxUA,p,endISO,0);
      if(ua>0) out.push(p);
    }
    return out.sort();
  };

  // --------- computo de días ----------
  M3.computeDays = function(pot, endISO, UA){
    endISO = toISO(endISO || PV6.state?.end || document.getElementById("date-end")?.value);
    const Aha = Number(PV6.data?.areaHaByPot?.[pot] || 0);
    const kg  = kgFor(pot, endISO);
    if(!Aha || !kg) return {kg:null,dbr:0,dfdn:0,phi:1,dadj:0};

    const P = params();
    const oferta = kg * Aha;

    // Días brutos (consumo base UI)
    const consBase = Math.max(0.1, Number(P.consumoBase||10));
    const dbr = oferta / (Math.max(1,UA) * consBase);

    // Consumo con FDN = (120/FDN%) * auKg
    const fdn = Number(PV6.data?.fdnByPot?.[pot] ?? P.fdnDefault); // fracción
    const pct = Math.max(0.1, (120 / Math.max(10, fdn*100)) / 100); // 0.0174
    const consFDN = Math.max(0.1, P.auKg * pct);
    const dfdn = oferta / (Math.max(1,UA) * consFDN);

    // φ(D) = 1 - min(wmax, beta * dfdn)
    const phi = 1 - Math.min(P.wmax, P.beta * dfdn);
    const dadj = Math.max(0, dfdn * Math.max(0, phi));

    return {kg, dbr, dfdn, phi, dadj};
  };

  console.log("[M3] FDN(120/FDN) + desperdicio", {use_fdn_120_over:true, waste_mode:"curve"});
})();
