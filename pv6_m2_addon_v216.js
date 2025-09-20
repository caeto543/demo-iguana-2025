// PV6 Manejo — M2.17
// UI y cálculos: Origen ocupados, Destinos sugeridos + todos, tabla con Días br., Días FDN, Δ desperd., Días aj., Estado.
(function(){
  // Requiere que el app principal exponga:
  // - state, series, moves, FND, AREAS, selectedParents, kgFor, inferNandOcc, computeRestDaysFromEvents, lastOnOrBefore, parseDate, addDays, daysBetween, clamp
  if (typeof window === 'undefined' || typeof window.state === 'undefined') {
    console.warn('[M2.17] App base no listo. Asegúrate de cargar app.v6.js antes de este addon.');
    return;
  }

  const S = window.state;

  function daysFDN(fnd){
    // Regla: 120 / FDN  (FDN en 0–1)
    if (fnd == null || !isFinite(fnd) || fnd <= 0) return null;
    return 120 / (fnd * 100); // si FND viene en 0–1, 120/(FDN*100) = 1.2/FDN
  }

  function calcRow(nm, ds){
    const dEnd = parseDate(ds);
    const area = AREAS.get(nm) || 0;
    const kg   = kgFor(nm, ds);
    const fnd  = FND.has(nm) ? FND.get(nm) : null;
    const {N, occ} = inferNandOcc(moves.get(nm)||[], dEnd);

    // Días brutos
    const uso = (S.coefUso/100);
    const base = S.consumo;
    const cons = (fnd==null)? base : clamp(base * (1 - S.params.alpha * fnd), 7, 14);
    const oferta = (kg||0) * area * uso;
    const demanda = (N||0) * cons;
    const Dbr = (oferta>0 && demanda>0) ? (oferta/demanda) : null;

    // Días FDN y ajuste
    const Dfdn = daysFDN(fnd); // días mínimos por calidad
    const delta = (Dfdn==null) ? null : Math.min(S.params.wmax, S.params.beta * Dfdn);
    const Daj = (Dbr==null && Dfdn==null) ? null
              : (Dbr==null) ? Math.max(0, Dfdn - (delta||0))
              : (Dfdn==null) ? Dbr
              : Math.max(Dbr, Dfdn - (delta||0));

    // Estado (usa lógica de ranking de tu app)
    const okEntrada = (kg!=null && kg>=S.params.Emin && kg<=S.params.Emax);
    const estado = okEntrada ? 1 : (kg!=null && kg>=S.params.Smin ? 0 : -1);

    return { nm, kg, N, area, fnd, Dbr, Dfdn, delta, Daj, estado, occ };
  }

  function buildUI(){
    const host = document.getElementById('pv6-manejo-card') || document.querySelector('.side');
    if (!host) return;

    const html = `
      <div class="card-header">
        <h3>Pastoreo con manejo (PV6)</h3>
        <div style="font-size:12px;color:#6b7a8c" id="pv6-m2-status">—</div>
      </div>
      <div style="display:grid;gap:6px">
        <label>Origen (ocupados al día “hasta”)<br>
          <select id="pv6-origen"></select>
        </label>
        <label>Destino<br>
          <select id="pv6-destino"></select>
        </label>
        <div class="table-wrap">
          <table class="rank">
            <thead>
              <tr>
                <th>Potrero</th>
                <th>Kg MS/ha</th>
                <th>Días br.</th>
                <th>Días FDN</th>
                <th>Δ desperd. (d)</th>
                <th>Días aj.</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody id="pv6-m2-body"></tbody>
          </table>
        </div>
      </div>
    `;
    const card = document.getElementById('pv6-manejo-card');
    if (card) card.innerHTML = html;
    else if (host) {
      const sec = document.createElement('section');
      sec.className = 'card';
      sec.innerHTML = html;
      host.appendChild(sec);
    }
  }

  function refreshUI(){
    const ds = S.end;
    const dEnd = parseDate(ds);
    const fuente = (S.fuente === 'raw') ? 'kgms_raw' : 'kgms_7d';
    const statusEl = document.getElementById('pv6-m2-status');
    if (statusEl) statusEl.textContent = `[M2.17] listo — fuente: ${fuente} hasta: ${ds}`;

    // Origen (ocupados)
    const origenSel = document.getElementById('pv6-origen');
    const destinoSel = document.getElementById('pv6-destino');
    const body = document.getElementById('pv6-m2-body');
    if (!origenSel || !destinoSel || !body) return;

    const padres = selectedParents();
    const ocupados = [];
    const libres = [];
    padres.forEach(nm => {
      if (nm.startsWith('z')) return;
      const m = moves.get(nm) || [];
      const {occ} = inferNandOcc(m, dEnd);
      (occ ? ocupados : libres).push(nm);
    });

    // fill origen
    origenSel.innerHTML = '';
    ocupados.forEach(nm => {
      const opt = document.createElement('option');
      opt.value = nm;
      opt.textContent = nm;
      origenSel.appendChild(opt);
    });

    // destinos: none + sugeridos + todos
    const makeOpt = (val, txt) => {
      const o = document.createElement('option'); o.value = val; o.textContent = txt; return o;
    };
    destinoSel.innerHTML = '';
    destinoSel.appendChild(makeOpt('__NONE__', '— Ningún potrero (salida de finca) —'));

    // sugeridos por Kg
    const rows = padres
      .filter(nm => !nm.startsWith('z'))
      .map(nm => ({nm, kg: kgFor(nm, ds) || 0}))
      .sort((a,b)=> (b.kg - a.kg));

    // Añade sugeridos (top 8)
    rows.slice(0,8).forEach(r => destinoSel.appendChild(makeOpt(r.nm, `⭐ ${r.nm}`)));

    // Separador visual
    destinoSel.appendChild(makeOpt('', '────────────'));
    rows.forEach(r => destinoSel.appendChild(makeOpt(r.nm, r.nm)));

    // Tabla (calcular para todos los padres)
    body.innerHTML = '';
    rows.forEach(r => {
      const x = calcRow(r.nm, ds);
      const tr = document.createElement('tr');
      const estadoTxt = x.estado===1 ? '<span class="state green">Verde</span>'
                        : x.estado===0 ? '<span class="state yellow">Amarillo</span>'
                        : '<span class="state red">Rojo</span>';
      const fmt = n => (n==null || !isFinite(n)) ? '–' : (Math.round(n*10)/10).toLocaleString('es-CO');
      tr.innerHTML = `
        <td style="text-align:left">${x.nm}</td>
        <td>${x.kg==null ? '–' : Math.round(x.kg).toLocaleString('es-CO')}</td>
        <td>${fmt(x.Dbr)}</td>
        <td>${fmt(x.Dfdn)}</td>
        <td>${fmt(x.delta)}</td>
        <td>${fmt(x.Daj)}</td>
        <td>${estadoTxt}</td>`;
      body.appendChild(tr);
    });
  }

  // Hook con el app base
  function attach(){
    buildUI();
    refreshUI();
    // Escuchar cambios clave del UI base
    const ids = ['date-end','fuente','coef-uso','consumo','mode'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', refreshUI);
    });
    const btn = document.getElementById('btn-apply');
    if (btn) btn.addEventListener('click', refreshUI);
  }

  // Espera a que el DOM y el app base estén listos
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', attach);
  }else{
    attach();
  }
})();
