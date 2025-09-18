/* sw_mov_remote.js
   Intercepta CUALQUIER request a "MOV_GANADO_CARGA_MIX.csv"
   y lo redirige a Google Sheets publicado como CSV.
*/
const REMOTE_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR_Rp6f-Xdv6RyWXQhY0uV1E5P3PBQpjMJIVrxeRAq4RCYMEzlqWY24Jltqstcp3uV79moaJc63d4cf/pub?gid=0&single=true&output=csv";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

function isTarget(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.pathname.endsWith("/MOV_GANADO_CARGA_MIX.csv") || u.pathname === "/MOV_GANADO_CARGA_MIX.csv";
  } catch {
    return false;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = req.url;

  if (isTarget(url)) {
    const bust = `${REMOTE_URL}${REMOTE_URL.includes("?") ? "&" : "?"}_ts=${Date.now()}`;
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(bust, { cache: "no-store", mode: "cors" });
          const text = await res.clone().text();
          const lines = text.split(/\r?\n/).filter(Boolean);
          const n = Math.max(0, lines.length - 1);
          // Notifica al cliente para que se vea en la consola de la página
          const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
          clientsList.forEach((c) => c.postMessage({ kind: "MOV_PATCH_OK", rows: n }));
          return new Response(text, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8" } });
        } catch (err) {
          const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
          clientsList.forEach((c) => c.postMessage({ kind: "MOV_PATCH_ERR", msg: String(err) }));
          return fetch(req); // Fallback
        }
      })()
    );
  }
});
