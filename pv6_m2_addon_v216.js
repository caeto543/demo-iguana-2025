// PV6 Manejo — M2.17 (FIXED, fresh link)
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
      <div class="table-wrap" style="max-height:38vh;overflow:auto">
        <table class="rank">
          <thead><tr>
            <th>Potrero</th><th>Kg MS/ha</th><th>Días br.</th><th>Días FDN</th><th>Δ desperd. (d)</th><th>Días aj.</th><th>Estado</th>
          </tr></thead>
          <tbody id="pv6-m2-body"></tbody>
        </table>
      </div>
    `;
    side.prepend(card); // arriba del panel derecho
  }

  function refreshUI(){
    const ds = S.end || lastDateAvailable();
    const fuente = (S.fuente==='raw')? 'kgms_raw':'kgms_7d';
    const statusEl = document.getElementById('pv6-m2-status');
    if (statusEl) statusEl.textContent = `[M2.17] listo — fuente: ${fuente} hasta: ${ds}`;

    const body = document.getElementById('pv6-m2-body');
    if (!body) return;
    const padres = selectedParents().filter(n=>!n.startsWith('z'));
    const rows = padres.map(nm=>({nm, kg: kgFor(nm, ds)||0})).sort((a,b)=>b.kg-a.kg);
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
    ['date-end','fuente','coef-uso','consumo','mode','btn-apply'].forEach(id=>{
      const el=document.getElementById(id);
      if (!el) return;
      if (id==='btn-apply') el.addEventListener('click', refreshUI);
      else el.addEventListener('change', refreshUI);
    });
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', attach); else attach();
})();
