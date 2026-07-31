const APP_CACHE = 'nihongo-lab-app-v6.0.0';
const CONTENT_CACHE = 'nihongo-lab-content-2026.07.31-phase3-advanced-business';
const APP_SHELL = ['./','./index.html','./app.css','./app.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./data/catalog.json','./data/id-aliases.json'];
self.addEventListener('install', event => { event.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(APP_SHELL))); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => ![APP_CACHE,CONTENT_CACHE].includes(k)).map(k => caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('message', event => { if(event.data?.type==='SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url); if(url.origin!==self.location.origin) return;
  if(url.pathname.endsWith('/data/catalog.json')) { event.respondWith(fetch(event.request).then(r=>{const copy=r.clone();caches.open(CONTENT_CACHE).then(c=>c.put(event.request,copy));return r;}).catch(()=>caches.match(event.request))); return; }
  if(url.pathname.includes('/data/packs/') || url.pathname.includes('/schemas/')) { event.respondWith(caches.match(event.request).then(cached=>{const network=fetch(event.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CONTENT_CACHE).then(c=>c.put(event.request,copy));}return r;});return cached||network;})); return; }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(APP_CACHE).then(c=>c.put(event.request,copy));}return r;}).catch(()=>caches.match('./index.html'))));
});