// PV6 Manejo — M2.17 (FIXED)
(function(){
  if (typeof window === 'undefined' || typeof window.state === 'undefined') return;

  const S = window.state;

  // helpers
  const parseDate = window.parseDate || (s => new Date(s+'T00:00:00'));
  const selectedParents = window.selectedParents || (()=>[]);
  const AREAS = window.AREAS || new Map();
  const FND = window.FND || new Map();
  const moves = window.moves || new Map();
  const kgFor = window.kgFor || ((nm,ds)=>null);
  const lastOnOrBefore = window.lastOnOrBefore || function(arr, d, key){
    if (!arr) return null; for (let i=arr.length-1;i>=0;i--){ const di=parseDate(arr[i].date); if (di<=d && arr[i][key]!=null) return arr[i][key]; } return null;
  };
  const clamp = window.clamp || ((x,a,b)=>Math.max(a,Math.min(b,x)));

  function lastDateAvailable(){
    if (S.end) return S.end;
    try{
      const series = window.series || new Map();
      for (const [nm,arr] of series){
        for (let i=arr.length-1;i>=0;i--){
          const d = arr[i].date || arr[i].fecha || arr[i].d || null;
          if (d) return d;
        }
      }
    }catch(_){}
    const t = new Date(); const m=String(t.getMonth()+1).padStart(2,'0'), d=String(t.getDate()).padStart(2,'0');
    return `${t.getFullYear()}-${m}-${d}`;
  }

  function getUA(nm, dEnd){
    const m = moves.get(nm) || [];
    let ua = lastOnOrBefore(m, dEnd, 'UA') ?? lastOnOrBefore(m, dEnd, 'UA_ef') ?? lastOnOrBefore(m, dEnd, 'UA_efectiva');
    if (ua==null){
      const N = lastOnOrBefore(m, dEnd, 'N') ?? lastOnOrBefore(m, dEnd, 'N_total');
      if (N!=null) ua = N/10;
    }
    return ua || 0;
  }

  function isOccupied(nm, dEnd){
    const m = moves.get(nm) || [];
    const occ = lastOnOrBefore(m, dEnd, 'occ');
    if (occ!=null) return !!occ;
    const ua = getUA(nm, dEnd);
    const N  = lastOnOrBefore(m, dEnd, 'N') ?? lastOnOrBefore(m, dEnd, 'N_total') ?? 0;
    return (ua>0 || N>0);
  }

  function daysFDN(f){
    if (f==null || !isFinite(f) || f<=0) return null;
    const pct = (f<=1) ? (f*100) : f; // acepta 0–1 o %
    return 120 / pct;
  }

  function calcRow(nm, ds){
    const dEnd = parseDate(ds);
    const area = AREAS.get(nm)||0;
    const kg   = kgFor(nm, ds);
    const fnd  = FND.has(nm)? FND.get(nm): null;
    const UA   = getUA(nm, dEnd);
    const uso  = (S.coefUso ?? 60) / 100;
    const base = S.consumo ?? 10;
    const oferta  = (kg||0) * area * uso;
    const demanda = (UA||0) * base;
    const Dbr = (oferta>0 && demanda>0) ? (oferta/demanda) : null;

    const Dfdn = daysFDN(fnd);
    const beta = S.params?.beta ?? 0.05, wmax = S.params?.wmax ?? 0.30;
    const delta = (Dfdn==null) ? null : Math.min(wmax, beta * Dfdn);
    const Daj = (Dbr==null && Dfdn==null) ? null
              : (Dbr==null) ? Math.max(0, Dfdn - (delta||0))
              : (Dfdn==null) ? Dbr
              : Math.max(Dbr, Dfdn - (delta||0));

    const Emin = S.params?.Emin ?? 2000, Emax = S.params?.Emax ?? 3200, Smin = S.params?.Smin ?? 1600;
    const estado = (kg==null) ? -1 : (kg>=Emin && kg<=Emax) ? 1 : (kg>=Smin ? 0 : -1);

    return { nm, kg, Dbr, Dfdn, delta, Daj, estado };
  }

  function buildUI(){
    const side = document.querySelector('aside.side');
    if (!side) return;
    let card = document.getElementById('pv6-manejo-card');
    if (!card){
      card = document.createElement('section');
      card.id = 'pv6-manejo-card';
      card.className = 'card';
    }
    card.innerHTML = `
      <div class="card-header">
        <h3>Pastoreo con manejo (PV6)</h3>
        <div style="font-size:12px;color:#6b7a8c" id="pv6-m2-status">—</div>
      </div>
      <div style="padding:0 8px 8px 8px">
        <div style="display:flex;gap:8px;align-items:center;margin:6px 0">
          <label style="display:flex;flex-direction:column;font-size:12px;color:#475569">
            Origen (ocupados)
            <select id="pv6-origen"></select>
          </label>
          <label style="display:flex;flex-direction:column;font-size:12px;color:#475569">
            Destino
            <select id="pv6-destino"></select>
          </label>
          <button id="pv6-recalc" class="btn">Recalcular sugeridos</button>
          <button id="pv6-clear" class="btn secondary">Limpiar</button>
        </div>
        <div class="table-wrap" style="max-height:38vh;overflow:auto">
          <table class="rank">
            <thead><tr>
              <th>Potrero</th><th>Kg MS/ha</th><th>Días br.</th><th>Días FDN</th><th>Δ desperd. (d)</th><th>Días aj.</th><th>Estado</th>
            </tr></thead>
            <tbody id="pv6-m2-body"></tbody>
          </table>
        </div>
      </div>
    `;
    side.prepend(card); // arriba del panel derecho
  }

  function refreshUI(){
    const ds = S.end || lastDateAvailable();
    const fuente = (S.fuente==='raw')? 'kgms_raw':'kgms_7d';
    const statusEl = document.getElementById('pv6-m2-status');
    if (statusEl) statusEl.textContent = `[M2.17] listo — fuente: ${fuente} hasta: ${ds}`;

    const origenSel = document.getElementById('pv6-origen');
    const destinoSel = document.getElementById('pv6-destino');
    const body = document.getElementById('pv6-m2-body');
    if (!origenSel || !destinoSel || !body) return;

    const padres = selectedParents().filter(n=>!n.startsWith('z'));
    const dEnd = parseDate(ds);

    const ocupados = padres.filter(nm => isOccupied(nm, dEnd));
    origenSel.innerHTML = '';
    if (ocupados.length===0){
      const opt = document.createElement('option'); opt.value='__NONE__'; opt.textContent='(no hay ocupados a la fecha)';
      origenSel.appendChild(opt);
    }else{
      ocupados.forEach(nm => { const o=document.createElement('option'); o.value=nm; o.textContent=nm; origenSel.appendChild(o); });
    }

    const makeOpt = (val, txt) => { const o=document.createElement('option'); o.value=val; o.textContent=txt; return o; };
    destinoSel.innerHTML='';
    destinoSel.appendChild(makeOpt('__NONE__', '— Ningún potrero (salida de finca) —'));
    const rows = padres.map(nm=>({nm, kg: kgFor(nm, ds)||0})).sort((a,b)=>b.kg-a.kg);
    rows.slice(0,8).forEach(r=>destinoSel.appendChild(makeOpt(r.nm, `⭐ ${r.nm}`)));
    destinoSel.appendChild(makeOpt('', '────────────'));
    rows.forEach(r=>destinoSel.appendChild(makeOpt(r.nm, r.nm)));

    body.innerHTML='';
    rows.forEach(r=>{
      const x = calcRow(r.nm, ds);
      const fmt = n => (n==null || !isFinite(n))? '–' : (Math.round(n*10)/10).toLocaleString('es-CO');
      const estadoTxt = x.estado===1 ? '<span class="state green">Verde</span>' : x.estado===0 ? '<span class="state yellow">Amarillo</span>' : '<span class="state red">Rojo</span>';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td style="text-align:left">${x.nm}</td>
        <td>${x.kg==null?'–':Math.round(x.kg).toLocaleString('es-CO')}</td>
        <td>${fmt(x.Dbr)}</td>
        <td>${fmt(x.Dfdn)}</td>
        <td>${fmt(x.delta)}</td>
        <td>${fmt(x.Daj)}</td>
        <td>${estadoTxt}</td>`;
      body.appendChild(tr);
    });
  }

  function attach(){
    buildUI();
    refreshUI();
    ['date-end','fuente','coef-uso','consumo','mode'].forEach(id=>{
      const el=document.getElementById(id); if (el) el.addEventListener('change', refreshUI);
    });
    const btnA=document.getElementById('btn-apply'); if (btnA) btnA.addEventListener('click', refreshUI);
    const btnR=document.getElementById('pv6-recalc'); if (btnR) btnR.addEventListener('click', refreshUI);
    const btnC=document.getElementById('pv6-clear'); if (btnC) btnC.addEventListener('click', ()=>{
      const o=document.getElementById('pv6-origen'); if (o) o.selectedIndex=0;
      const d=document.getElementById('pv6-destino'); if (d) d.selectedIndex=0;
    });
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', attach); else attach();
})();
