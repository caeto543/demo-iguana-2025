/* pv6_mov_remote_patch.js (reforzado) */
(function () {
  const TARGET_NAME = "MOV_GANADO_CARGA_MIX.csv";
  const REMOTE_URL_BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR_Rp6f-Xdv6RyWXQhY0uV1E5P3PBQpjMJIVrxeRAq4RCYMEzlqWY24Jltqstcp3uV79moaJc63d4cf/pub?gid=0&single=true&output=csv";
  const withBust = (u) => `${u}${u.includes("?") ? "&" : "?"}_ts=${Date.now()}`;
  const isTarget = (u) => {
    try { const x = new URL(u, location.href); return x.pathname.endsWith("/"+TARGET_NAME) || x.pathname===TARGET_NAME; }
    catch { return String(u).includes(TARGET_NAME); }
  };

  // Log desde mensajes del Service Worker
  navigator.serviceWorker && navigator.serviceWorker.addEventListener("message", (ev) => {
    const m = ev.data || {};
    if (m.kind === "MOV_PATCH_OK")  console.log(`[MOV][SW] intercept → remoto OK (${m.rows} filas)`);
    if (m.kind === "MOV_PATCH_ERR") console.warn("[MOV][SW] intercept error:", m.msg);
  });

  // fetch
  const _fetch = window.fetch;
  window.fetch = async function (input, init) {
    try {
      const url = typeof input === "string" ? input : input && input.url;
      if (url && isTarget(url)) {
        const res = await _fetch(withBust(REMOTE_URL_BASE), init);
        const txt = await res.clone().text();
        const n = Math.max(0, (txt.split(/\r?\n/).filter(Boolean).length - 1));
        console.log(`[MOV][patch] intercept → remoto OK (${n} filas)`);
        return new Response(txt, { status: res.status, statusText: res.statusText, headers: res.headers });
      }
    } catch (e) {}
    return _fetch(input, init);
  };

  // XHR
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const _open = XHR.prototype.open, _send = XHR.prototype.send;
    XHR.prototype.open = function (m, url, a, u, p) {
      this.__mov = isTarget(url);
      return _open.call(this, m, this.__mov ? withBust(REMOTE_URL_BASE) : url, a, u, p);
    };
    XHR.prototype.send = function (b) {
      if (this.__mov) this.addEventListener("load", () => {
        const t = this.responseText || ""; const n = Math.max(0, t.split(/\r?\n/).filter(Boolean).length - 1);
        console.log(`[MOV][patch] intercept → remoto OK (${n} filas)`);
      });
      return _send.call(this, b);
    };
  }

  // Papa.parse(url,{download:true})
  if (window.Papa && typeof Papa.parse === "function") {
    const _pp = Papa.parse.bind(Papa);
    Papa.parse = function (input, cfg = {}) {
      if (typeof input === "string" && cfg && cfg.download === true && isTarget(input)) {
        const wcfg = { ...cfg };
        const _complete = wcfg.complete;
        wcfg.complete = (r, f) => { try {
          const n = Array.isArray(r?.data) ? Math.max(0, r.data.length - 1) : 0;
          console.log(`[MOV][patch] intercept → remoto OK (${n} filas)`);
        } catch {} if (typeof _complete === "function") _complete(r, f); };
        return _pp(withBust(REMOTE_URL_BASE), wcfg);
      }
      return _pp(input, cfg);
    };
  }

  console.log("[MOV][patch] armado OK");
})();
