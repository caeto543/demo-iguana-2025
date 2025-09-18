/* PV6 — parche remoto de movimientos (GitHub Pages / Netlify compatible)
   Intercepta la carga de MOV_GANADO_CARGA_MIX.csv y la redirige a una URL remota (Google Sheets publicado como CSV).
   Requisitos:
   - Cargar DESPUÉS de papaparse.min.js y ANTES de app.v6.js en index.html
   - Definir window.PV6_MOV_REMOTE_URL (opcional) con tu URL publicada (termina en output=csv)
*/
(function () {
  // 1) Toma la URL remota desde window o usa la de respaldo si quieres dejar una por defecto
  const URL_REMOTA = (window.PV6_MOV_REMOTE_URL || '').trim();

  // 2) Coincide exactamente con el archivo local de movimientos
  const RE_MOV = /\/?MOV_GANADO_CARGA_MIX\.csv(\?.*)?$/i;

  // 3) Pequeño “espera & arma” por si Papa aún no está disponible
  const ESPERA_MS = 150;
  const MAX_INTENTOS = 40;
  let intentos = 0;
  let armado = false;

  function ts(url) {
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + '_ts=' + Date.now();
  }

  function armar() {
    if (armado) return;
    if (!window.Papa || !window.Papa.parse) {
      if (intentos === 0) console.warn('[MOV][patch] armado (esperando Papa)');
      if (++intentos < MAX_INTENTOS) return setTimeout(armar, ESPERA_MS);
      console.warn('[MOV][patch] Papa no apareció; salto parche');
      return;
    }

    // Guardamos el Papa.parse original
    const parseOrig = Papa.parse;

    // Interceptamos tanto la firma (url, cfg) como la firma de objeto { download:true, url:... }
    Papa.parse = function (arg1, arg2) {
      // Caso 1: Papa.parse(urlString, config)
      if (typeof arg1 === 'string') {
        let url = arg1;
        if (RE_MOV.test(url) && URL_REMOTA) {
          console.warn('[MOV][patch] intercept ->', url, '→', URL_REMOTA);
          const cfg = Object.assign({}, arg2, {
            complete: wrapComplete(arg2 && arg2.complete, url),
            error: wrapError(arg2 && arg2.error, url)
          });
          return parseOrig.call(Papa, ts(URL_REMOTA), cfg);
        }
        return parseOrig.call(Papa, url, arg2);
      }

      // Caso 2: Papa.parse({ download:true, url:... , ... })
      if (arg1 && typeof arg1 === 'object' && arg1.download && typeof arg1.url === 'string') {
        const obj = Object.assign({}, arg1);
        if (RE_MOV.test(obj.url) && URL_REMOTA) {
          console.warn('[MOV][patch] intercept ->', obj.url, '→', URL_REMOTA);
          obj.url = ts(URL_REMOTA);
          obj.complete = wrapComplete(obj.complete, arg1.url);
          obj.error = wrapError(obj.error, arg1.url);
          return parseOrig.call(Papa, obj);
        }
      }

      // Cualquier otro caso, seguir normal
      return parseOrig.apply(Papa, arguments);
    };

    armado = true;
    console.warn('[MOV][patch] armado OK');
  }

  function wrapComplete(cb, origen) {
    return function (res, file) {
      console.warn('[MOV][patch] remoto OK ←', origen, res && res.data ? `(rows: ${res.data.length})` : '');
      if (typeof cb === 'function') cb(res, file);
    };
  }

  function wrapError(cb, origen) {
    return function (err, file) {
      console.warn('[MOV][patch] remoto falló; fallback a local ←', origen, err);
      if (typeof cb === 'function') cb(err, file);
    };
  }

  armar();
})();
