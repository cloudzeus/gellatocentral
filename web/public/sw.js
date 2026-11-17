// Service worker του Gelato System.
// ΔΕΝ κρατά σελίδες με δεδομένα επιχείρησης (θα έδειχνε παλιά αποθέματα/αποδείξεις ή δεδομένα άλλου χρήστη στην ίδια
// συσκευή). Κρατά μόνο τα στατικά αρχεία της εφαρμογής και μια σελίδα «εκτός σύνδεσης».
const CACHE = "gs-static-v1";
const OFFLINE = "/offline";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, "/logo.png", "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  // Αρχεία με hash στο όνομα: δεν αλλάζουν ποτέ, άρα πρώτα από την cache
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    })));
    return;
  }
  // Σελίδες: πάντα από το δίκτυο· χωρίς σύνδεση, η σελίδα «εκτός σύνδεσης»
  if (req.mode === "navigate") e.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
});
