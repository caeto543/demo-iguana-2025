// pv6_mov_remote_patch.js v3.2
(function () {
  const REMOTE_URL = (window.__PV6_SHEETS_MOV_URL__ || "").trim();
  const TARGET_NAME = "MOV_GANADO_CARGA_MIX.csv";

  // No SW; parche a fetch para ese recurso
  const _fetch = window.fetch;
  window.fetch = async function (input, init) {
    try {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const isTarget =
        url.includes(TARGET_NAME) ||
        (init && init.body && typeof init.body === "string" && init.body.includes(TARGET_NAME));

      if (isTarget && REMOTE_URL) {
        const res = await _fetch(REMOTE_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const rows = (text.match(/\n/g) || []).length;
        console.log(`[MOV][patch] intercept → remoto OK (${rows} filas)`);
        return new Response(text, {
          status: 200,
          headers: { "Content-Type": "text/csv; charset=utf-8" }
        });
      }
    } catch (e) {
      console.warn("[MOV][patch] error remoto:", e && e.message ? e.message : e);
    }
    return _fetch(input, init);
  };

  console.log("[MOV][patch] armado OK");
})();
