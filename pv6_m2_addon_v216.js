/* PV6 M2.17 — Pastoreo con manejo (estable, con API y anclaje robusto)
   - Inserta el card aunque no encuentre el ancla original (usa varios fallback y, si no, body)
   - Origen (ocupados) desde PV6.data.movRows (≤ fecha “hasta”)
   - Destino: Ninguno + Sugeridos (top Kg) + Todos (alfabético), excluye Z*
   - Tabla: Dbr / Dfdn(120/FDN) / Δdesp(d)=min(wmax,β·Dfdn) / Daj / Estado(chips)
   - Alinea Kg con fecha “hasta” y fuente (raw/7d)
   - API pública: PV6.M216.calcDays(pot, fechaISO, {UA}), PV6.M216.render()
*/
(function(){
  if (window.__PV6_M216__) return;
  window.__PV6_M216__ = true;

  (window.PV6 ||= {}); (PV6.data ||= {}); (PV6.state ||= {});
  const A = PV6, D = PV6.data, S = PV6.state;

  const $  = (s,r=document)=>r.querySelector(s);
  const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));

  function iso(s){
    if(!s) return null;
    s=String(s).trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if(m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
    const dt=new Date(s); return isNaN(dt)? s : dt.toISOString().slice(0,10);
  }
  const endISO = ()=> iso(S.end || $("#date-end")?.value);
  function fuenteMode(){
    const f=(S.fuente||$("#fuente")?.value||$("#source")?.value||"").toLowerCase();
    return (f.includes("raw")||f.includes("día")||f.includes("dia"))?"kgms_raw":"kgms_7d";
  }

  // Kg MS/ha por potrero alineado con UI
  function kgForPot(p){
    const mode=fuenteMode(), end=endISO();
    try{
      if (typeof A.ui?.kgForPot==="function") return A.ui.kgForPot(p,end,mode);
      if (typeof A.kgForPot==="function")     return A.kgForPot(p,end,mode);
    }catch(e){}
    const map7=(D.kgms7dByPot||D.kgms_by_pot||{})[p], mapR=(D.kgmsRawByPot||D.kg_by_pot||{})[p];
    const v7=map7?map7[end]:null, vR=mapR?mapR[end]:null;
    return mode==="kgms_raw" ? (vR ?? v7 ?? null) : (v7 ?? vR ?? null);
  }

  // Ocupados a la fecha “hasta” desde MOV
  function listOcupados(){
    const rows = Array.isArray(D.movRows)? D.movRows : [];
    const idxUA={}, idxO={};
    for(const r of rows){
      const d=iso(r.date), p=String(r.name_canon||"").trim();
      if(!d||!p) continue;
      (idxUA[p] ||= {})[d] = Number(r.UA_total||0);
      (idxO[p]  ||= {})[d] = (r.ocupado==null||r.ocupado==="")? null : (Number(r.ocupado)>0?1:0);
    }
    function last(idx,p,lim){
      const rec=idx[p]; if(!rec) return null; let best=null, b="";
      for(const k in rec){ const z=iso(k); if(z&&z<=lim&&z>=b){ best=rec[k]; b=z; } }
      return best;
    }
    const lim=endISO();
    const pots=Object.keys(D.areaHaByPot||{}); const out=[];
    pots.forEach(p=>{
      const o=last(idxO,p,lim);
      if(o!=null){ if(o>0) out.push(p); return; }
      const ua=last(idxUA,p,lim)||0; if(ua>0) out.push(p);
    });
    return out.sort();
  }

  // Panel UI — anclaje robusto
  function findAnchor(){
    // 1) a la derecha del mapa
    let a = $$(".leaflet-container").slice(-1)[0]?.closest("div");
    if (a) return a;
    // 2) panel derecho comunes
    a = $("#right, .right, #panel-derecho, .panel-derecho, aside, .sidebar, #sidebar");
    if (a) return a;
    // 3) sección que contenga “Simular pastoreo”
    a = [...$$("section,div")].find(el => /simular\s+pastoreo/i.test((el.textContent||"")));
    if (a) return a;
    // 4) body como último recurso
    return document.body;
  }

  function ensurePanel(){
    let panel = $("#pv6-m2");
    if(panel) return panel;
    const anchor = findAnchor(); if(!anchor) return null;

    panel = document.createElement("div");
    panel.id="pv6-m2";
    panel.style.marginTop="8px";
    panel.innerHTML = `
    <div class="card" style="padding:12px;border:1px solid #ddd;border-radius:10px;background:#fff">
      <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:6px">
        <strong>Pastoreo con manejo (PV6) <small class="text-muted">M2.17</small></strong>
        <div style="display:flex;gap:8px">
          <button id="m216-recalc" class="btn btn-sm btn-light">Recalcular sugeridos</button>
          <button id="m216-clear"  class="btn btn-sm btn-light">Limpiar</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px">
        <label>Origen (ocupados)
          <select id="m216-origen" class="form-control form-control-sm"></select>
        </label>
        <label>Destino
          <select id="m216-dest" class="form-control form-control-sm"></select>
        </label>
        <label>UA
          <input id="m216-ua" class="form-control form-control-sm" type="number" step="1" placeholder="p.ej. 200"/>
        </label>
        <label>PV total (kg)
          <input id="m216-pvkg" class="form-control form-control-sm" type="number" step="1" placeholder="p.ej. 81000"/>
        </label>
      </div>
      <div style="overflow:auto;max-height:360px">
        <table id="m216-tab" class="table table-sm">
          <thead><tr>
            <th>Potrero</th><th class="text-end">Kg MS/ha</th>
            <th class="text-end">Días br.</th><th class="text-end">Días FDN</th>
            <th class="text-end">Δ desper. (d)</th><th class="text-end">Días aj.</th>
            <th>Estado</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>`;
    // Insertar: si no es body, detrás del anchor; si es body, al final
    if (anchor === document.body) document.body.appendChild(panel);
    else anchor.parentElement.insertBefore(panel, anchor.nextSibling);
    return panel;
  }

  // Selectores
  function fillOrigen(){
    const sel=$("#m216-origen"); if(!sel) return;
    const occ=listOcupados(); sel.innerHTML="";
    if(occ.length){ occ.forEach(p=> sel.append(new Option(p,p))); }
    else sel.append(new Option("(no hay ocupados a la fecha)",""));
  }
  function fillDestino(){
    const sel=$("#m216-dest"); if(!sel) return;
    const all=Object.keys(D.areaHaByPot||{}).filter(p=>!/^z/i.test(p));
    const top=[...all].map(p=>({p,kg:kgForPot(p)||0})).sort((a,b)=>b.kg-a.kg).slice(0,12).map(x=>x.p);
    sel.innerHTML="";
    sel.append(new Option("— Ningún potrero (salida de finca) —",""));
    const g1=document.createElement("optgroup"); g1.label="Sugeridos";
    top.forEach(p=> g1.append(new Option(p,p))); sel.appendChild(g1);
    const g2=document.createElement("optgroup"); g2.label="Todos los potreros";
    all.filter(p=>!top.includes(p)).sort((a,b)=>a.localeCompare(b)).forEach(p=> g2.append(new Option(p,p)));
    sel.appendChild(g2);
  }

  // Parámetros
  function params(){
    const P=A.defaults?.params||A.params||{};
    return {
      coef: Number($("#coef-uso")?.value||S.coef||60)/100,
      consumo: Number($("#consumo-base")?.value||S.consumo||10),
      auKg: Number(A.defaults?.auKg ?? 450),
      beta: Number(P.beta ?? 0.05),
      wmax: Number(P.wmax ?? 0.30),
    };
  }
  function fdnFor(p){
    const v=D.fdnByPot?.[p]; if(v==null) return null;
    const n=Number(v); if(!isFinite(n)) return null;
    return n>1? n/100 : n;
  }
  function ofertaKg(p){
    const kg=kgForPot(p)||0; const ha=Number(D.areaHaByPot?.[p]||0);
    const {coef}=params(); return kg*ha*coef;
  }

  // Cálculos
  function computeRow(p, UA){
    const {consumo, auKg, beta, wmax} = params();
    const kg=kgForPot(p)||0, off=ofertaKg(p);
    const d_br = (UA>0 && consumo>0) ? (off/(UA*consumo)) : 0;

    let d_fdn=d_br;
    const fdn=fdnFor(p);
    if (fdn && UA>0){
      const imax = auKg * (120/(fdn*100)) / 100;  // kg/UA/d
      const cap = Math.min(consumo, imax);
      d_fdn = cap>0 ? (off/(UA*cap)) : 0;
    }
    const delta = Math.min(wmax, beta * d_fdn);
    const d_aj  = Math.max(d_br, d_fdn - delta);

    let estado="—";
    try{ if(typeof A.ui?.stateForKg==="function") estado=A.ui.stateForKg(kg,endISO())||"—"; }catch(e){}
    return {p, kg, d_br, d_fdn, delta, d_aj, estado};
  }

  // Render
  function renderTable(){
    const tb=$("#m216-tab tbody"); if(!tb) return;
    const UA=Number($("#m216-ua")?.value||0);
    const all=Object.keys(D.areaHaByPot||{}).filter(p=>!/^z/i.test(p));
    const rows=all.map(p=>computeRow(p,UA));
    const top=[...rows].sort((a,b)=>b.kg-a.kg).slice(0,12).map(r=>r.p);
    rows.sort((a,b)=>{ const ai=top.indexOf(a.p), bi=top.indexOf(b.p);
      if(ai>=0&&bi<0) return -1; if(bi>=0&&ai<0) return 1; return a.p.localeCompare(b.p); });
    const fmt=(x,d=1)=> (isFinite(x)? x.toFixed(d) : "—");
    tb.innerHTML = rows.map(r=>`
      <tr>
        <td>${r.p}</td>
        <td class="text-end">${fmt(r.kg,3)}</td>
        <td class="text-end">${fmt(r.d_br,1)}</td>
        <td class="text-end">${fmt(r.d_fdn,1)}</td>
        <td class="text-end">${fmt(r.delta,1)}</td>
        <td class="text-end"><strong>${fmt(r.d_aj,1)}</strong></td>
        <td>${r.estado}</td>
      </tr>`).join("");
  }

  // API pública
  PV6.M216 = {
    calcDays: (pot, fechaISO, {UA}={}) => { if(fechaISO) PV6.state.end=fechaISO; return computeRow(pot, Number(UA||0)); },
    render:   () => { try{ fillDestino(); renderTable(); }catch(e){ console.warn("[M2.17] render warn:", e); } }
  };

  function boot(){
    const panel=ensurePanel(); if(!panel) { console.warn("[M2.17] sin ancla; card agregado al body"); }
    fillOrigen(); fillDestino();
    $("#m216-recalc")?.addEventListener("click", renderTable);
    $("#m216-clear") ?.addEventListener("click", ()=>{ $("#m216-ua").value=""; $("#m216-pvkg").value=""; renderTable(); });
    ["#date-end","#fuente","#source"].forEach(sel=>{ const el=$(sel); if(el) el.addEventListener("change", ()=> PV6.M216.render()); });
    renderTable();
    console.log("[M2.17] listo — fuente:", fuenteMode(), "hasta:", endISO());
  }

  if (document.readyState==="loading") document.addEventListener("DOMContentLoaded", boot, {once:true});
  else boot();
})();
