/* pv6_mov_remote_patch.js
   Intercepta SIEMPRE las lecturas de "MOV_GANADO_CARGA_MIX.csv"
   y las redirige a la URL de Google Sheets publicada como CSV.
   Muestra en consola: "[MOV][patch] intercept → remoto OK (N filas)"
   y en la pestaña Red verás la solicitud apuntando a la URL remota.
*/
(function () {
  const TARGET_NAME = "MOV_GANADO_CARGA_MIX.csv";
  const REMOTE_URL_BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR_Rp6f-Xdv6RyWXQhY0uV1E5P3PBQpjMJIVrxeRAq4RCYMEzlqWY24Jltqstcp3uV79moaJc63d4cf/pub?gid=0&single=true&output=csv";

  // Cache-busting para evitar respuestas enramadas del navegador
  const withCacheBust = (url) => {
    const u = new URL(url);
    u.searchParams.set("_ts", Date.now().toString());
    return u.toString();
  };

  const isTarget = (url) => {
    try {
      // Soporta rutas relativas o absolutas
      const u = new URL(url, location.href);
      return u.pathname.endsWith("/" + TARGET_NAME) || u.pathname === TARGET_NAME || u.href.endsWith("/" + TARGET_NAME);
    } catch {
      // Si no es URL válida (p.ej. solo nombre), comparar por inclusión
      return String(url).includes(TARGET_NAME);
    }
  };

  const countCsvRows = (csvText) => {
    // Cuenta filas de datos (excluyendo encabezado y líneas vacías)
    if (!csvText) return 0;
    // Usa Papa si está disponible para mayor robustez; si no, fallback simple
    try {
      if (window.Papa && window.Papa.parse) {
        const parsed = Papa.parse(csvText, { skipEmptyLines: true });
        const rows = Array.isArray(parsed.data) ? parsed.data.length : 0;
        return rows > 0 ? (rows - 1) : 0; // quitar encabezado
      }
    } catch {}
    // Fallback: split por líneas
    const lines = csvText.split(/\r?\n/).filter(Boolean);
    return lines.length > 1 ? (lines.length - 1) : 0;
  };

  // ---- Patch fetch ----
  const _fetch = window.fetch;
  if (typeof _fetch === "function") {
    window.fetch = async function (input, init) {
      try {
        let url = (typeof input === "string") ? input : (input && input.url);
        if (url && isTarget(url)) {
          const remote = withCacheBust(REMOTE_URL_BASE);
          const req = (typeof input === "string") ? remote : new Request(remote, input);
          const res = await _fetch(req, init);

          // Clona y cuenta filas para log
          const clone = res.clone();
          const text = await clone.text();
          const n = countCsvRows(text);
          console.log(`[MOV][patch] intercept → remoto OK (${n} filas)`);

          // Devuelve respuesta original (no el clone)
          return new Response(text, {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers
          });
        }
      } catch (e) {
        console.warn("[MOV][patch] fetch intercept warning:", e);
      }
      return _fetch(input, init);
    };
  }

  // ---- Patch XMLHttpRequest (para Papa.parse con download:true) ----
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const _open = XHR.prototype.open;
    const _send = XHR.prototype.send;

    XHR.prototype.open = function (method, url, async, user, password) {
      this.__mov_is_target = isTarget(url);
      this.__mov_original_url = url;
      this.__mov_replaced_url = this.__mov_is_target ? withCacheBust(REMOTE_URL_BASE) : url;
      return _open.call(this, method, this.__mov_replaced_url, async, user, password);
    };

    XHR.prototype.send = function (body) {
      if (this.__mov_is_target) {
        const onLoad = () => {
          try {
            const text = this.responseText || "";
            const n = countCsvRows(text);
            console.log(`[MOV][patch] intercept → remoto OK (${n} filas)`);
          } catch (e) {
            console.warn("[MOV][patch] XHR count warning:", e);
          }
          this.removeEventListener("load", onLoad);
        };
        this.addEventListener("load", onLoad);
      }
      return _send.call(this, body);
    };
  }

  // ---- Hardening: intercepta también Papa.parse(url, {download:true}) antes de crear XHR (fallback) ----
  if (window.Papa && typeof window.Papa.parse === "function") {
    const _papaparse = window.Papa.parse.bind(window.Papa);
    window.Papa.parse = function (input, config = {}) {
      try {
        if (typeof input === "string" && (config && config.download === true) && isTarget(input)) {
          const remote = withCacheBust(REMOTE_URL_BASE);
          const wrappedConfig = Object.assign({}, config);
          const _complete = wrappedConfig.complete;
          wrappedConfig.complete = function (results, file) {
            try {
              const n = (results && Array.isArray(results.data)) ? Math.max(0, results.data.length - 1) : 0;
              console.log(`[MOV][patch] intercept → remoto OK (${n} filas)`);
            } catch {}
            if (typeof _complete === "function") _complete(results, file);
          };
          return _papaparse(remote, wrappedConfig);
        }
      } catch (e) {
        console.warn("[MOV][patch] Papa.parse intercept warning:", e);
      }
      return _papaparse(input, config);
    };
  }

  console.log("[MOV][patch] armado OK");
})();
