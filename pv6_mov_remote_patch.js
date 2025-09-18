/* PV6 — parche remoto de movimientos (GitHub Pages/Netlify friendly)
   - Intercepta Papa.parse tanto en firma (url, cfg) como en firma objeto {download:true, url:...}
   - Registra logs de armado, intercept y resultados
*/
(function () {
  // 1) Lee la URL desde window (si la definiste en index.html) o usa la de aquí.
  const URL_REMOTA = (window.PV6_MOV_REMOTE_URL || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR_Rp6f-Xdv6RyWXQhY0uV1E5P3PBQpjMJIVrxeRAq4RCYMEzlqWY24Jltqstcp3uV79moaJc63d4cf/pub?gid=0&single=true&output=csv').trim();
  const RE_MOV = /MOV_GANADO_CARGA_MIX\.csv(\?.*)?$/i;

  let armado = false;
  let intentos = 0;
  const ESPERA_MS = 150;
  const MAX_INTENTOS = 40;

  function isMov(u) {
    return typeof u === 'string' && RE_MOV.test(u);
  }
  function toRemote(u) {
    const sep = URL_REMOTA.includes('?') ? '&' : '?';
    return URL_REMOTA + sep + '_ts=' + Date.now();
  }

  function armarParche() {
    if (!window.Papa || !Papa.parse) {
      if (!armado && intentos === 0) console.warn('[MOV][patch] armado (esperando Papa)');
      if (++intentos < MAX_INTENTOS) return setTimeout(armarParche, ESPERA_MS);
      console.warn('[MOV][patch] Papa no apareció; no se aplicó parche');
      return;
    }

    const original = Papa.parse;

    Papa.parse = function (arg1, arg2) {
      // Firma 1: Papa.parse(url, cfg)
      if (typeof arg1 === 'string' && isMov(arg1) && typeof window.fetch !== 'undefined') {
        const remoto = toRemote(arg1);
        console.warn('[MOV][patch] intercept ->', remoto);
        const cfg = arg2 && typeof arg2 === 'object' ? arg2 : {};
        const onComplete = cfg.complete;
        const onError = cfg.error;

        const cfg1 = Object.assign({}, cfg, {
          complete: function (res, file) {
            console.warn('[MOV][patch] remoto OK (firma url,cfg)');
            if (typeof onComplete === 'function') onComplete(res, file);
          },
          error: function (err, file) {
            console.warn('[MOV][patch] remoto falló (firma url,cfg), fallback local');
            original.call(Papa, arg1, arg2); // vuelve a local
            if (typeof onError === 'function') onError(err, file);
          }
        });
        return original.call(Papa, remoto, cfg1);
      }

      // Firma 2: Papa.parse({ download:true, url:'...' }, cfg?)
      if (arg1 && typeof arg1 === 'object' && arg1.download && typeof arg1.url === 'string' && isMov(arg1.url)) {
        const remoto = toRemote(arg1.url);
        console.warn('[MOV][patch] intercept (obj) ->', remoto);

        const obj = Object.assign({}, arg1, { url: remoto });
        const cfg = arg2 && typeof arg2 === 'object' ? arg2 : {};
        const onComplete = cfg.complete;
        const onError = cfg.error;

        const cfg1 = Object.assign({}, cfg, {
          complete: function (res, file) {
            console.warn('[MOV][patch] remoto OK (firma objeto)');
            if (typeof onComplete === 'function') onComplete(res, file);
          },
          error: function (err, file) {
            console.warn('[MOV][patch] remoto falló (obj), fallback local');
            original.call(Papa, arg1, arg2); // vuelve a local
            if (typeof onError === 'function') onError(err, file);
          }
        });
        return original.call(Papa, obj, cfg1);
      }

      // Otros casos → comportamiento original
      return original.apply(Papa, arguments);
    };

    armado = true;
    console.warn('[MOV][patch] armado OK');
  }

  armarParche();
})();
