/* PV6 — Parche remoto de movimientos
   Reemplaza en caliente la carga de MOV_GANADO_CARGA_MIX.csv por una URL remota (Google Sheets publicado como CSV).

   Requisitos:
   1) Este archivo DEBE cargarse DESPUÉS de papaparse.min.js y ANTES de app.v6.js en index.html.
   2) Sustituye la constante URL_REMOTA por tu URL publicada (termina en output=csv).

   Verificación en consola:
   - [MOV][patch] armado (esperando Papa)          -> el parche está cargado y esperando a PapaParse
   - [MOV][patch] armado OK                        -> el parche se activó
   - [MOV][patch] intercept -> ...                 -> se interceptó el archivo local y se redirigió al remoto
   - [MOV][patch] remoto OK / remoto falló         -> resultado de la carga remota
*/

(function(){
  const URL_REMOTA =
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vR_Rp6f-Xdv6RyWXQhY0uV1E5P3PBQpjMJIVrxeRAq4RCYMEzlqWY24Jltqstcp3uV79moaJc63d4cf/pub?gid=0&single=true&output=csv';

  const RE_MOV = /MOV_GANADO_CARGA_MIX\.csv(\?.*)?$/i;
  const MAX_INTENTOS = 40;          // ~6s (40 * 150ms)
  const ESPERA_MS = 150;

  let intentos = 0;
  let armado = false;

  function armarParche(){
    // Necesitamos Papa.parse y su función original
    if (!window.Papa || typeof Papa.parse !== 'function') {
      if (intentos === 0) console.warn('[MOV][patch] armado (esperando Papa)');
      intentos++;
      if (intentos > MAX_INTENTOS) {
        console.warn('[MOV][patch] no se pudo armar (Papa no apareció)');
        return;
      }
      return void setTimeout(armarParche, ESPERA_MS);
    }

    const originalParse = Papa.parse;

    Papa.parse = function(url, cfg) {
      try {
        // Solo interceptamos si: (a) es string; (b) coincide con el CSV local; (c) tenemos URL remota https
        if (typeof url === 'string' && RE_MOV.test(url) && /^https?:\/\//i.test(URL_REMOTA)) {
          const remoto = URL_REMOTA + (URL_REMOTA.includes('?') ? '&' : '?') + '_ts=' + Date.now();
          console.warn('[MOV][patch] intercept ->', url, '→', remoto);

          const cfg1 = Object.assign({}, cfg, {
            complete: function(res, file){
              console.warn('[MOV][patch] remoto OK', file || '');
              if (cfg && typeof cfg.complete === 'function') cfg.complete(res, file);
            },
            error: function(err, file){
              console.warn('[MOV][patch] remoto falló; fallback a local →', url, err);
              // Fallback: intentamos el original con la ruta LOCAL
              const cfg2 = Object.assign({}, cfg, {
                complete: cfg && cfg.complete ? cfg.complete.bind(null) : undefined,
                error:   cfg && cfg.error    ? cfg.error.bind(null)    : undefined
              });
              return originalParse.call(Papa, url, cfg2);
            }
          });

          // Forzamos download para que Papa trate la URL remota como CSV online
          cfg1.download = true;
          cfg1.dynamicTyping = true;
          cfg1.header = true;
          cfg1.skipEmptyLines = true;

          return originalParse.call(Papa, remoto, cfg1);
        }
      } catch(e){
        console.warn('[MOV][patch] error interceptando; uso local →', e);
      }
      // Cualquier otro caso: comportamiento original
      return originalParse.call(Papa, url, cfg);
    };

    armado = true;
    console.warn('[MOV][patch] armado OK');
  }

  // Arrancamos
  armarParche();
})();
