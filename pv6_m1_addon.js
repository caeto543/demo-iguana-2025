/* PV6 M1 Addon — servicio SIN manejo (simulador, export CSV, exclusiones)
   Requiere: app.v6.js ya cargado antes (este script va DESPUÉS) */

(function(){
  const urlParams = new URLSearchParams(location.search);
  const FARM_ID = urlParams.get('farm') || 'default';
  const SERVICE = (urlParams.get('service')||'con').toLowerCase(); // 'sin' | 'con'

  // ===== Exclusiones persistentes por farm =====
  const EXC_KEY = `pv6:excluded:${FARM_ID}`;
  function loadExcluded(){
    try{ const a = JSON.parse(localStorage.getItem(EXC_KEY)||'[]'); return new Set(Array.isArray(a)?a:[]); }catch(e){ return new Set(); }
  }
  function saveExcluded(set){
    try{ localStorage.setItem(EXC_KEY, JSON.stringify(Array.from(set))); }catch(e){}
  }
  const EXCLUDED = loadExcluded();

  // Override suave: selectedParents() = respeta EXCLUDED
  if (typeof selectedParents === 'function'){
    const _origParents = selectedParents;
    window.selectedParents = function(){
      try{
        const base = Array.from(PARENTS.size ? PARENTS : Array.from(ALL_NAMES).filter(n=>!n.includes('_z_')));
        return base.filter(nm=>!EXCLUDED.has(nm));
      }catch(e){
        return _origParents();
      }
    };
  }

  // Oculta bloque "Ocupados" si service=sin
  if (SERVICE==='sin'){
    const firstBlock = document.querySelector('.pastoreo-dynamic > div:first-child');
    if (firstBlock) firstBlock.style.display='none';
  }

  // ===== Helpers comunes =====
  const nf0 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });
  const parseDate = s => new Date(s + 'T00:00:00');
  const toISO = d => new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
  const addDays = (d,n)=>{ const x=new Date(d); x.setDate(x.getDate()+n); return x; };
  const daysBetween = (a,b)=>Math.floor((b-a)/86400000);
  const clamp = (x,a,b)=> Math.max(a, Math.min(b, x));

  function buildMotivo(nm, ds, kg, p){
    const dEnd = parseDate(ds);
    const dLast = lastKgDate(nm, ds);
    const age = dLast ? daysBetween(dLast, dEnd) : null;
    const parts = [];
    if (kg==null) parts.push('Sin dato');
    else if (kg<p.Emin) parts.push('Bajo Emin');
    else if (kg>p.Emax) parts.push('Sobre Emax');
    else parts.push('Entrada OK');
    const s = slope7d(nm, ds);
    if (s!=null) parts.push(s>=0 ? 'K↑' : 'K↓');
    if (age!=null && age>state.qcMaxAge) parts.push('QC viejo');
    return parts.join('; ');
  }

  // Normaliza pendiente por rango del día (usa la del core si existe)
  function normalizedSlopeScore(nm, ds){
    if (typeof window.slope7d !== 'function') return 50;
    const names = selectedParents();
    const slopes=[];
    const dEnd = parseDate(ds), dIni = addDays(dEnd,-7);
    for (const p of names){
      const s = slope7d(p, ds);
      if (s!=null && Number.isFinite(s)) slopes.push(s);
    }
    if (!slopes.length) return 50;
    const minS=Math.min(...slopes), maxS=Math.max(...slopes);
    const s = slope7d(nm, ds) ?? 0;
    if (Math.abs(maxS - minS) < 1e-6) return 50;
    return clamp(100 * (s - minS) / (maxS - minS), 0, 100);
  }

  // ===== Ranking contextual para simulador (usa UA override y no toca el core)
  function computeRankingWithLoad(ds, UA_override){
    const rows=[], dEnd=parseDate(ds);
    for(const nm of selectedParents()){
      const area=AREAS.get(nm)||0;
      const m=moves.get(nm)||[];
      const fnd=FND.has(nm)? FND.get(nm) : null;
      const dsl=computeRestDaysFromEvents(m,dEnd);
      const kg=kgFor(nm,ds);
      if (kg==null || !Number.isFinite(kg)) continue;

      const UA_days = Number.isFinite(UA_override) && UA_override>0 ? UA_override : 0;
      const base=state.consumo;
      const cons=(fnd==null)? base : clamp(base*(1 - state.params.alpha*fnd), 7, 14);
      const uso=(state.coefUso/100);
      const oferta=(kg||0)*area*uso; const demanda=UA_days*cons;
      const D0 = (demanda>0 ? oferta/demanda : null);
      const phi=1 - Math.min(state.params.beta*Math.max((D0||0)-1,0), state.params.wmax);
      const Dadj=(D0!=null ? D0*phi : null);

      const p=state.params;
      const sNorm = normalizedSlopeScore(nm, ds);
      const w = state.weights?.[state.mode] ?? {entrada:35,calidad:25,pendiente:20,descanso:15,qc:5};
      const cEntrada = (kg<p.Emin)? (100*(kg/p.Emin)) : (kg>p.Emax)? (100*(p.Emax/Math.max(kg,p.Emax))) : 100;
      const penalSobremadurez=(kg>3500)? Math.min(30,(kg-3500)/10) : 0;
      const cCalidad=Math.max(0, 100 - (fnd==null?0:fnd*100*state.params.alpha) - penalSobremadurez);
      const cPend=sNorm;
      const cDesc=(dsl==null)? 0 : clamp(100*Math.min(1, dsl/Math.max(1,p.dslmin)), 0, 100);
      let cQC=100; const dLast=lastKgDate(nm,ds);
      if (dLast){ const age=daysBetween(dLast,dEnd); if (age>state.qcMaxAge){ const extra=age - state.qcMaxAge; cQC = clamp(100 - extra*8, 55, 100); } }
      const score = (cEntrada*w.entrada + cCalidad*w.calidad + cPend*w.pendiente + cDesc*w.descanso + cQC*w.qc) / (w.entrada+w.calidad+w.pendiente+w.descanso+w.qc);
      const ok = (kg!=null) && (kg>=p.Emin) && (kg<=p.Emax) && (dsl!=null) && (dsl>=p.dslmin);
      const estado = (!ok||score<50) ? -1 : (score<70?0:1);
      rows.push({ nm, kg, D0, Dadj, estado, score, ok });
    }
    rows.sort((a,b)=> (b.estado - a.estado) || (b.score - a.score) || (b.kg - a.kg));
    return rows;
  }

  // ===== Export CSV (día) — usa simulación si el usuario ingresó una carga
  function exportDayCSV(ds, UA_override){
    const rows = (UA_override && UA_override>0) ? computeRankingWithLoad(ds, UA_override) : computeRanking(ds);
    const p = state.params;
    const out = [['name_canon','kgms','slope7d','FDN','DSL','entry_ok','score','motivo']];
    const dEnd=parseDate(ds);
    for (const r of rows){
      const fnd = FND.has(r.nm)? FND.get(r.nm) : null;
      const dsl = computeRestDaysFromEvents(moves.get(r.nm)||[], dEnd);
      const slope = slope7d(r.nm, ds);
      const motivo = buildMotivo(r.nm, ds, r.kg, p);
      out.push([r.nm, r.kg!=null?Math.round(r.kg):'', slope!=null?Number(slope.toFixed(2)):'' , fnd!=null?Number((fnd*100).toFixed(0)):'', dsl!=null?dsl:'', r.ok?'1':'0', r.score?Number(r.score.toFixed(1)):'' , motivo]);
    }
    const csv = out.map(row=>row.join(',')).join('\n');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=`PV6_export_${ds}.csv`; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 800);
  }

  // ===== UI: Simulador, Exportar y Gestor de exclusiones
  function getUAFromInputs(){
    const pv = Number(document.getElementById('sim-pv')?.value||0);
    const uaIn = Number(document.getElementById('sim-ua')?.value||0);
    const nIn  = Number(document.getElementById('sim-n')?.value||0);
    let ua = uaIn;
    if (!ua && pv>0 && state.auKg>0) ua = pv/state.auKg;
    if (!ua && nIn>0) ua = nIn;
    return ua||0;
  }

  // Botón Exportar CSV (día)
  const btnExport = document.getElementById('btn-export-day');
  if (btnExport){
    btnExport.addEventListener('click', ()=> exportDayCSV(state.end, getUAFromInputs()));
  }

  // Simular
  const btnSim = document.getElementById('btn-sim-run');
  if (btnSim){
    btnSim.addEventListener('click', ()=>{
      const ua = getUAFromInputs();
      const rows = computeRankingWithLoad(state.end, ua).slice(0, 12);
      const tbody = document.getElementById('sim-body'); if (!tbody) return;
      tbody.innerHTML='';
      rows.forEach(r=>{
        const tr=document.createElement('tr');
        tr.innerHTML = `<td style="text-align:left;cursor:pointer">${r.nm}</td>
                        <td>${r.kg!=null?nf0.format(Math.round(r.kg)):'–'}</td>
                        <td>${r.D0!=null?nf1.format(r.D0):'–'}</td>
                        <td>${r.Dadj!=null?nf1.format(r.Dadj):'–'}</td>
                        <td>${r.estado===1?'<span class="state green">Verde</span>':(r.estado===0?'<span class="state yellow">Amarillo</span>':'<span class="state red">Rojo</span>')}</td>`;
        tr.addEventListener('click', ()=>{ state.scope=r.nm; const sel=document.getElementById('pot-select'); if (sel) sel.value=r.nm; renderAll(); });
        tbody.appendChild(tr);
      });
    });
  }
  const btnSimExp = document.getElementById('btn-sim-export');
  if (btnSimExp){
    btnSimExp.addEventListener('click', ()=> exportDayCSV(state.end, getUAFromInputs()));
  }

  // Gestor de exclusiones (modal)
  const btnExc = document.getElementById('btn-exc');
  if (btnExc){
    const modal = document.getElementById('exc-modal');
    const list = document.getElementById('exc-list');
    const btnCancel = document.getElementById('exc-cancel');
    const btnSave = document.getElementById('exc-save');

    function openExc(){
      list.innerHTML='';
      const base = Array.from(PARENTS.size ? PARENTS : Array.from(ALL_NAMES).filter(n=>!n.includes('_z_'))).sort((a,b)=>a.localeCompare(b,'es'));
      base.forEach(nm=>{
        const lab = document.createElement('label');
        const chk = document.createElement('input'); chk.type='checkbox'; chk.checked = !EXCLUDED.has(nm); chk.dataset.nm=nm;
        const span = document.createElement('span'); span.textContent = nm;
        lab.appendChild(chk); lab.appendChild(span); list.appendChild(lab);
      });
      modal.style.display='flex';
    }
    function closeExc(){ modal.style.display='none'; }

    btnExc.addEventListener('click', openExc);
    modal.querySelector('.backdrop').addEventListener('click', closeExc);
    btnCancel.addEventListener('click', closeExc);
    btnSave.addEventListener('click', ()=>{
      list.querySelectorAll('input[type=checkbox]').forEach(chk=>{
        const nm = chk.dataset.nm;
        if (!nm) return;
        if (chk.checked) EXCLUDED.delete(nm); else EXCLUDED.add(nm);
      });
      saveExcluded(EXCLUDED);
      closeExc();
      renderAll();
    });

    document.addEventListener('keydown', function onEsc(e){
      if (e.key==='Escape' && modal.style.display==='flex'){ closeExc(); }
    });
  }
})();
