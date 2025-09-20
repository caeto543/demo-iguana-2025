/* =========================================================================
   PV6 M2 — Pastoreo con manejo (card UI)  — v2.16
   - Anti-duplicado (solo 1 instancia)
   - Inserta automáticamente el card si no existe
   - Origen: ocupados (desde MOV) a la fecha "hasta"
   - Destino: sugeridos (Verde) + resto, excluye Z/ z*
   - Tabla: Kg | Días br. | Días FDN | Δ desperd. (días) | Días aj. | Estado
   - Cálculo: PV6.M3.computeDays(pot, fecha, UA)  (FDN 120/FDN + desperdicio)
   ======================================================================== */
(function(){
  if (window.__PV6_M2_ACTIVE__) { console.log("[M2] otra instancia detectada → skip"); return; }
  window.__PV6_M2_ACTIVE__ = true;

  (window.PV6 ||= {}); (PV6.data ||= {});
  const M2 = {}; PV6.M2 = M2;

  // ----------------- IDs / helpers -----------------
  const IDS = {
    panel:"pv6-m2", title:"pv6-m2-title",
    origin:"pv6-m2-origin", dest:"pv6-m2-dest",
    ua:"pv6-ua", pv:"pv6-pvkg", n:"pv6-n",
    recalc:"pv6-m2-recalc", clear:"pv6-m2-clear",
    table:"pv6-m2-tab"
  };
  const auKgDefault = ()=> Number(PV6?.defaults?.auKg ?? 450);

  function toISO(s){
    if(!s) return null; const t=String(s).trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m=t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if(m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
    const d=new Date(t); return isNaN(d)?t:d.toISOString().slice(0,10);
  }
  const endISO = ()=> toISO(PV6.state?.end || document.getElementById("date-end")?.value);
  function fuenteMode(){
    const f=(PV6.state?.fuente||"kgms_7d").toLowerCase();
    return (f.includes("raw")||f.includes("día")||f.includes("dia"))?"raw":"7d";
  }
  const isZ = (n)=> /^z/i.test(n) || n.split(/[_-]/).some(seg=>/^z\d*$/i.test(seg));

  function kgFor(pot){
    const D=PV6.data||{};
    const map = (fuenteMode()==="raw")
      ? (D.kgmsRawByPot || D.kg_by_pot)
      : (D.kgms7dByPot  || D.kgms_by_pot);
    const s=map?.[pot]; if(!s) return null;
    if(typeof s==="number") return s;
    const ks=Object.keys(s).filter(k=>/^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
    if(!ks.length) return Number(s)||null;
    const end=endISO(); let pick=ks[0];
    for(const k of ks){ if(k<=end) pick=k; else break; }
    return Number(s[pick])||null;
  }
  function stateFor(kg){
    try{
      if(PV6.ui && typeof PV6.ui.stateForKg==="function") return PV6.ui.stateForKg(kg, endISO());
      if(typeof window.stateForKg==="function")         return window.stateForKg(kg, endISO());
    }catch(e){}
    return "";
  }

  function haveCore(){ return PV6 && PV6.data && PV6.data.areaHaByPot; }
  function haveMov(){  return Array.isArray(PV6.data?.movRows) && PV6.data.movRows.length>0; }
  function haveFDN(){  return PV6.data?.fdnByPot && Object.keys(PV6.data.fdnByPot).length>0; }
  async function waitForData(){
    let d=150; for(let i=0;i<24;i++){ if(haveCore()&&haveMov()&&haveFDN()) return true; await new Promise(r=>setTimeout(r,d)); d=Math.min(d*1.5,450); }
    return false;
  }

  // ----------------- Ocupados & destino -----------------
  function ocupadosAtEnd(){
    if (PV6.M3 && typeof PV6.M3.ocupadosAt==="function") return PV6.M3.ocupadosAt(endISO());
    // fallback desde MOV:
    const rows = Array.isArray(PV6.data?.movRows)? PV6.data.movRows : [];
    const idxUA={}, idxOcc={}; const end=endISO();
    function set(idx,p,d,v){ (idx[p] ||= {})[d]=v; }
    function last(idx,p){ const rec=idx[p]; if(!rec) return null; let best=null,bd=""; for(const k in rec){ const iso=toISO(k); if(iso && iso<=end && iso>=bd){ best=rec[k]; bd=iso; } } return best; }
    rows.forEach(r=>{ const d=toISO(r.date), p=String(r.name_canon||"").trim(); if(!d||!p) return;
      if (r.UA_total!=null) set(idxUA, p, d, Number(r.UA_total)||0);
      set(idxOcc, p, d, (r.ocupado==null||r.ocupado==="")? null : Number(r.ocupado)>0?1:0);
    });
    const pots=Object.keys(PV6.data?.areaHaByPot||{}), out=[];
    pots.forEach(p=>{
      const occ=last(idxOcc,p); if(occ!=null){ if(occ>0) out.push(p); return; }
      const ua =last(idxUA,p)||0; if(ua>0) out.push(p);
    });
    return out.sort();
  }

  function buildOrigin(){
    const sel=document.getElementById(IDS.origin); if(!sel) return;
    const list=ocupadosAtEnd();
    sel.innerHTML="";
    if(!list.length){ sel.disabled=true; sel.append(new Option("(no hay ocupados a la fecha)","")); return; }
    sel.disabled=false; list.forEach(p=> sel.append(new Option(p,p)));
  }

  function buildDest(){
    const sel=document.getElementById(IDS.dest); if(!sel) return;
    const pots=Object.keys(PV6.data?.areaHaByPot||{}).filter(n=>!isZ(n));
    const rows=pots.map(p=>{ const kg=kgFor(p)||0; const st=stateFor(kg); return {p,kg,rank:(st==="Verde"?2:(st==="Ajuste"?1:0))}; });
    const greens=rows.filter(r=>r.rank===2).sort((a,b)=>b.kg-a.kg).map(r=>r.p);
    const others=rows.filter(r=>r.rank!==2).sort((a,b)=>a.p.localeCompare(b.p)).map(r=>r.p);

    sel.innerHTML="";
    sel.append(new Option("— Ningún potrero (salida de finca) —","__NONE__"));
    if(greens.length){
      const g=document.createElement("optgroup"); g.label="Destinos sugeridos";
      greens.forEach(nm=> g.append(new Option(nm,nm)));
      sel.appendChild(g);
    }
    const g2=document.createElement("optgroup"); g2.label="Todos los potreros";
    others.forEach(nm=> g2.append(new Option(nm,nm)));
    sel.appendChild(g2);
  }

  // ----------------- Cálculo -----------------
  function readUA(){
    const uaEl=document.getElementById(IDS.ua), pvEl=document.getElementById(IDS.pv), nEl=document.getElementById(IDS.n);
    const ua=Number(uaEl?.value||0), pv=Number(pvEl?.value||0), n=Number(nEl?.value||0);
    if(ua>0){ if(pvEl)pvEl.value=""; if(nEl)nEl.value=""; return ua; }
    if(pv>0){ if(uaEl)uaEl.value=""; if(nEl)nEl.value=""; return pv/auKgDefault(); }
    if(n>0){  if(uaEl)uaEl.value=""; if(pvEl)pvEl.value=""; return n; }
    // por defecto usar UA del potrero seleccionado (si lo muestra la UI) o 0
    return 0;
  }

  function computeRow(pot, UA){
    // M3.computeDays devuelve: { kg, dbr, dfdn, phi, dadj }
    const d = (PV6.M3 && typeof PV6.M3.computeDays==="function")
      ? PV6.M3.computeDays(pot, endISO(), Math.max(1, UA||1))
      : {kg: kgFor(pot)||0, dbr:0, dfdn:0, phi:1, dadj:0};
    const delta = Math.max(0, (d.dfdn||0) - (d.dadj||0)); // Δ desperdicio en días
    return { pot, kg:d.kg, dbr:d.dbr, dfdn:d.dfdn, delta, dadj:d.dadj, st: stateFor(d.kg) };
  }

  function renderTable(){
    const tb=document.querySelector(`#${IDS.table} tbody`); if(!tb) return;
    const UA = Math.max(1, readUA()||1);
    const pots=Object.keys(PV6.data?.areaHaByPot||{}).filter(n=>!isZ(n));
    const rows=pots.map(p=>{ const kg=kgFor(p)||0; const st=stateFor(kg); return {p,kg,rank:(st==="Verde"?2:(st==="Ajuste"?1:0))}; })
                   .sort((a,b)=> (b.rank-a.rank) || (b.kg-a.kg));

    tb.innerHTML="";
    const frag=document.createDocumentFragment();
    rows.forEach(r=>{
      const d=computeRow(r.p, UA);
      const tr=document.createElement("tr");
      function td(v,align="right"){ const e=document.createElement("td"); e.style.textAlign=align; e.textContent=(v==null||v==="")?"—":v; return e; }
      tr.appendChild(td(r.p,"left"));
      tr.appendChild(td(isFinite(d.kg)   ? d.kg.toFixed(3):"—"));
      tr.appendChild(td(isFinite(d.dbr)  ? d.dbr.toFixed(1):"0"));
      tr.appendChild(td(isFinite(d.dfdn) ? d.dfdn.toFixed(1):"0"));
      tr.appendChild(td(isFinite(d.delta)? d.delta.toFixed(1):"0"));    // Δ desperdicio (días)
      tr.appendChild(td(isFinite(d.dadj) ? d.dadj.toFixed(1):"0"));
      tr.appendChild(td(d.st||"—","center"));
      frag.appendChild(tr);
    });
    tb.appendChild(frag);
  }

  function wire(){
    [IDS.ua,IDS.pv,IDS.n].forEach(id=>{
      const el=document.getElementById(id); if(el) el.addEventListener("input", renderTable);
    });
    const recalc=document.getElementById(IDS.recalc), clear=document.getElementById(IDS.clear);
    if(recalc) recalc.addEventListener("click", renderTable);
    if(clear)  clear .addEventListener("click", ()=>{["ua","pv","n"].forEach(k=>{const e=document.getElementById(IDS[k]); if(e) e.value="";}); renderTable();});

    ["fuente","source","sel-fuente","select-fuente","date-end"].forEach(id=>{
      const el=document.getElementById(id); if(el) el.addEventListener("change", ()=>{ buildOrigin(); buildDest(); renderTable(); });
    });
  }

  // ----------------- Inserción del card -----------------
  function ensurePanel(){
    // si existe viejo, lo reciclo
    const old=document.getElementById(IDS.panel);
    if(old && old.parentNode){ old.parentNode.removeChild(old); }

    // buscar “Simular pastoreo (sin manejo)”
    let anchor=null;
    [...document.querySelectorAll("div,section,h2,h3")].some(el=>{
      const t=(el.textContent||"").trim().toLowerCase();
      if(/simular\s+pastoreo\s*\(sin manejo\)/i.test(t)){ anchor=el.closest("section,div")||el; return true; }
      return false;
    });

    const card=document.createElement("section");
    card.id=IDS.panel;
    card.style.cssText="border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.04);";

    card.innerHTML = `
      <div id="${IDS.title}" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <strong>Pastoreo con manejo (PV6)</strong>
        <small style="opacity:.6">M2.16</small>
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
          <thead style="position:sticky;top:0;background:#fafafa">
            <tr>
              <th style="text-align:left;">Potrero</th>
              <th>Kg MS/ha</th>
              <th>Días br.</th>
              <th>Días FDN</th>
              <th>Δ desperd. (d)</th>
              <th>Días aj.</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <div style="opacity:.65; font-size:12px; margin-top:6px;">
        Tip: UA ↔ PV/N son excluyentes. Si escribes UA se bloquean PV/N; si PV ⇒ UA con auKg; si N ⇒ UA con N.
      </div>
    `;
    if(anchor && anchor.parentNode) anchor.parentNode.insertBefore(card, anchor);
    else (document.querySelector("aside,.right,.panel-derecho")||document.body).appendChild(card);
  }

  // ----------------- Init -----------------
  async function init(){
    ensurePanel();
    const ok = await waitForData();
    buildOrigin(); buildDest(); wire(); renderTable();

    if(!ok){
      const iv=setInterval(()=>{
        if(haveMov() && haveFDN()){ clearInterval(iv); buildOrigin(); buildDest(); renderTable(); }
      },250); setTimeout(()=>clearInterval(iv),4000);
    }
    const rows = Array.isArray(PV6.data?.movRows)? PV6.data.movRows : [];
    console.log("[M2.16] listo — movRows:", rows.length, "fdnKey:", PV6.data?.fdnByPot?"fdnByPot":"(default)");
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", init, {once:true});
  else init();
})();
