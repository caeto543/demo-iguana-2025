/* =========================================================================
   PV6 M2 — Pastoreo con manejo (card UI)  — v2.15
   - Inserta automáticamente el card en la UI (sin tocar index.html)
   - Espera movRows + fdnByPot (M3) y luego inicializa
   - Origen (ocupados) desde MOV a la fecha 'hasta'
   - Destino: sugeridos (Verde) arriba + resto; excluye "z*"; incluye "salida de finca"
   - Tabla: Kg, Días br., Días FDN, φ(D), Días aj., Estado — usando PV6.M3.computeDays
   ======================================================================== */
(function () {
  (window.PV6 ||= {}); (PV6.data ||= {});
  const M2 = {}; PV6.M2 = M2;

  // ---------------- DOM ids ----------------
  const IDS = {
    panel: "pv6-m2",
    title: "pv6-m2-title",
    origin: "pv6-m2-origin",
    dest:   "pv6-m2-dest",
    ua:     "pv6-ua",
    pv:     "pv6-pvkg",
    n:      "pv6-n",
    mode:   "pv6-mode",
    recalc: "pv6-m2-recalc",
    clear:  "pv6-m2-clear",
    table:  "pv6-m2-tab"
  };

  // ---------------- Utils ----------------
  function toISO(s){
    if(!s) return null; const t=String(s).trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m=t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if(m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
    const d=new Date(t); return isNaN(d)? t : d.toISOString().slice(0,10);
  }
  function endISO(){ return toISO(PV6.state?.end || document.getElementById("date-end")?.value); }
  function fuenteMode(){
    const f=(PV6.state?.fuente||"kgms_7d").toLowerCase();
    return (f.includes("raw")||f.includes("día")||f.includes("dia"))?"raw":"7d";
  }
  function isZ(n){ return /^z/i.test(n) || n.split(/[_-]/).some(seg=>/^z\d*$/i.test(seg)); }

  function kgFor(pot){
    const D=PV6.data||{};
    const map = (fuenteMode()==="raw")
      ? (D.kgmsRawByPot || D.kg_by_pot)
      : (D.kgms7dByPot  || D.kgms_by_pot);
    const s = map?.[pot]; if(!s) return null;
    if(typeof s === "number") return s;
    const ks = Object.keys(s).filter(k=>/^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
    if(!ks.length) return Number(s)||null;
    const end=endISO(); let pick=ks[0];
    for(const k of ks){ if(k<=end) pick=k; else break; }
    return Number(s[pick])||null;
  }
  function stateFor(kg){
    try{
      if(PV6.ui && typeof PV6.ui.stateForKg==="function") return PV6.ui.stateForKg(kg, endISO());
      if(typeof window.stateForKg==="function") return window.stateForKg(kg, endISO());
    }catch(e){}
    return "";
  }

  function findFdnMap(){
    const D = PV6.data||{};
    if (D.fdnByPot && Object.keys(D.fdnByPot).length) return {map:D.fdnByPot, key:"fdnByPot"};
    for(const k of Object.keys(D)){ if(/fdn/i.test(k) && D[k] && typeof D[k]==="object") return {map:D[k], key:k}; }
    return {map:null, key:"(default)"};
  }
  function haveCore(){ return PV6 && PV6.data && PV6.data.areaHaByPot; }
  function haveMov(){ return Array.isArray(PV6.data?.movRows) && PV6.data.movRows.length>0; }
  function haveFDN(){ const m=findFdnMap(); return !!(m.map && Object.keys(m.map).length); }

  async function waitForData(){
    let delay=150;
    for(let i=0;i<24;i++){ // ~3.5s
      if(haveCore() && haveMov() && haveFDN()) return true;
      await new Promise(r=>setTimeout(r, delay)); delay=Math.min(delay*1.5, 450);
    }
    return false;
  }

  // --------------- Ocupados & Destino ---------------
  function ocupadosAtEnd(){
    if(!PV6.M3 || typeof PV6.M3.ocupadosAt!=="function") return [];
    return PV6.M3.ocupadosAt(endISO());
  }
  function buildOrigin(){
    const sel=document.getElementById(IDS.origin); if(!sel) return;
    const list=ocupadosAtEnd();
    sel.innerHTML="";
    if(!list.length){
      const o=document.createElement("option"); o.value=""; o.textContent="(no hay ocupados a la fecha)";
      sel.appendChild(o); sel.disabled=true; return;
    }
    sel.disabled=false;
    list.forEach(p=>{ const o=document.createElement("option"); o.value=p; o.textContent=p; sel.appendChild(o); });
  }
  function buildDest(){
    const sel=document.getElementById(IDS.dest); if(!sel) return;
    const pots=Object.keys(PV6.data?.areaHaByPot||{}).filter(n=>!isZ(n));
    const rows=pots.map(p=>{ const kg=kgFor(p)||0; const st=stateFor(kg);
      return {p,kg,rank:(st==="Verde"?2:(st==="Ajuste"?1:0))};
    });
    const greens=rows.filter(r=>r.rank===2).sort((a,b)=>b.kg-a.kg).map(r=>r.p);
    const others=rows.filter(r=>r.rank!==2).sort((a,b)=>a.p.localeCompare(b.p)).map(r=>r.p);

    sel.innerHTML="";
    const op0=document.createElement("option"); op0.value="__NONE__"; op0.textContent="— Ningún potrero (salida de finca) —"; sel.appendChild(op0);
    if(greens.length){
      const g=document.createElement("optgroup"); g.label="Destinos sugeridos";
      greens.forEach(nm=>{ const o=document.createElement("option"); o.value=nm; o.textContent=nm; g.appendChild(o); });
      sel.appendChild(g);
    }
    const g2=document.createElement("optgroup"); g2.label="Todos los potreros";
    others.forEach(nm=>{ const o=document.createElement("option"); o.value=nm; o.textContent=nm; g2.appendChild(o); });
    sel.appendChild(g2);
  }

  // --------------- Cálculo ---------------
  function readUA(){
    const ua = Number(document.getElementById(IDS.ua)?.value||0);
    if(ua>0) return ua;
    const pvkg = Number(document.getElementById(IDS.pv)?.value||0);
    const N    = Number(document.getElementById(IDS.n )?.value||0);
    const auKg = Number(PV6.defaults?.auKg ?? 450);
    if(pvkg>0) return pvkg/auKg;
    if(N>0)    return N;
    return 0;
  }
  function computeRow(pot, UA){
    const d = PV6.M3.computeDays(pot, endISO(), Math.max(1, UA||1));
    return { pot, kg:d.kg, dbr:d.dbr, dfdn:d.dfdn, phi:d.phi, dadj:d.dadj, st: stateFor(d.kg) };
  }
  function renderTable(){
    const tb=document.querySelector(`#${IDS.table} tbody`); if(!tb) return;
    const UA = Math.max(1, readUA()||1);
    const pots=Object.keys(PV6.data?.areaHaByPot||{}).filter(n=>!isZ(n));
    const rows=pots.map(p=>{
      const kg=kgFor(p)||0; const st=stateFor(kg);
      return {p,kg,rank:(st==="Verde"?2:(st==="Ajuste"?1:0))};
    }).sort((a,b)=> (b.rank-a.rank) || (b.kg-a.kg));

    tb.innerHTML=""; const frag=document.createDocumentFragment();
    rows.forEach(r=>{
      const d=computeRow(r.p, UA);
      const tr=document.createElement("tr");
      function td(v){ const e=document.createElement("td"); e.textContent=(v==null||v==="")?"—":v; return e; }
      tr.appendChild(td(r.p));
      tr.appendChild(td(isFinite(d.kg)?   d.kg.toFixed(3):"—"));
      tr.appendChild(td(isFinite(d.dbr)?  d.dbr.toFixed(1):"0"));
      tr.appendChild(td(isFinite(d.dfdn)? d.dfdn.toFixed(1):"0"));
      tr.appendChild(td(isFinite(d.phi)?  d.phi.toFixed(2):"—")); // si prefieres Δd desperdicio: (d.dfdn - d.dadj).toFixed(1)
      tr.appendChild(td(isFinite(d.dadj)? d.dadj.toFixed(1):"0"));
      tr.appendChild(td(d.st||"—"));
      frag.appendChild(tr);
    });
    tb.appendChild(frag);
  }

  function wire(){
    [IDS.ua, IDS.pv, IDS.n].forEach(id=>{
      const el=document.getElementById(id); if(el) el.addEventListener("input", renderTable);
    });
    const recalc=document.getElementById(IDS.recalc); if(recalc) recalc.addEventListener("click", renderTable);
    const clear =document.getElementById(IDS.clear ); if(clear ) clear .addEventListener("click", ()=>{["ua","pv","n"].forEach(k=>{const e=document.getElementById(IDS[k]); if(e) e.value="";}); renderTable();});
    ["fuente","source","sel-fuente","select-fuente","date-end"].forEach(id=>{
      const el=document.getElementById(id); if(el) el.addEventListener("change", ()=>{ buildOrigin(); buildDest(); renderTable(); });
    });
  }

  // --------------- Inserción automática del card ---------------
  function ensurePanel(){
    if(document.getElementById(IDS.panel)) return;

    // intentamos anclarlo justo ANTES de "Simular pastoreo (sin manejo)"
    let anchor=null;
    [...document.querySelectorAll("div,section,h2,h3")].some(el=>{
      const t=(el.textContent||"").trim().toLowerCase();
      if(/simular\s+pastoreo\s*\(sin manejo\)/i.test(t)){ anchor=el.closest("section,div")||el; return true; }
      return false;
    });

    const card = document.createElement("section");
    card.id = IDS.panel;
    card.style.border="1px solid #e5e7eb"; card.style.borderRadius="10px"; card.style.padding="12px"; card.style.background="#fff";
    card.innerHTML = `
      <div id="${IDS.title}" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <strong>Pastoreo con manejo (PV6)</strong>
        <small style="opacity:.6">M2.15</small>
        <button id="${IDS.recalc}" style="margin-left:auto">Recalcular sugeridos</button>
        <button id="${IDS.clear}">Limpiar</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
        <label>Origen (ocupados)
          <select id="${IDS.origin}"><option>(cargando…)</option></select>
        </label>
        <label>Destino
          <select id="${IDS.dest}"><option>—</option></select>
        </label>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px; margin-bottom:8px;">
        <label>UA <input id="${IDS.ua}" type="number" min="0" step="1" placeholder="p.ej. 200"></label>
        <label>PV total (kg) <input id="${IDS.pv}" type="number" min="0" step="1" placeholder="p.ej. 81000"></label>
        <label>N total <input id="${IDS.n}" type="number" min="0" step="1" placeholder="p.ej. 300"></label>
      </div>

      <div style="overflow:auto; max-height: 420px;">
        <table id="${IDS.table}" style="width:100%; font-size:13px; border-collapse:collapse;">
          <thead>
            <tr>
              <th style="text-align:left;">Potrero</th>
              <th>Kg MS/ha</th>
              <th>Días br.</th>
              <th>Días FDN</th>
              <th>φ(D)</th>
              <th>Días aj.</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <div style="opacity:.6; font-size:12px; margin-top:6px;">
        Tip: UA ↔ PV/N son excluyentes. Si escribes UA se bloquean PV/N; si PV ⇒ UA con auKg; si N ⇒ UA con N.
      </div>
    `;

    if (anchor && anchor.parentNode){
      anchor.parentNode.insertBefore(card, anchor);
    } else {
      // fallback: lo agregamos en el primer panel derecho disponible o al final del body
      const right = document.querySelector("aside, .right, .panel-derecho") || document.body;
      right.appendChild(card);
    }
  }

  // --------------- Init ---------------
  async function init(){
    ensurePanel(); // crea el card si no existe

    const ok = await waitForData(); // espera mov + fdn
    buildOrigin(); buildDest(); wire(); renderTable();

    if(!ok){
      // reintenta una sola vez cuando lleguen (por seguridad)
      const iv=setInterval(()=>{
        if(haveMov() && haveFDN()){
          clearInterval(iv);
          buildOrigin(); buildDest(); renderTable();
        }
      },250); setTimeout(()=>clearInterval(iv),4000);
    }
    const {key:fdnKey}=findFdnMap();
    const rows = Array.isArray(PV6.data?.movRows)? PV6.data.movRows : [];
    console.log("[M2.15] listo — movRows:", rows.length, "fdnKey:", fdnKey);
  }

  if (document.readyState==="loading") {
    document.addEventListener("DOMContentLoaded", init, {once:true});
  } else {
    init();
  }
})();
