/*** Service Worker — ระบบติดตามน้ำท่วมเขตทวีวัฒนา ***/
const VER        = 'tww-v3';
const SHELL      = VER + '-shell';
const RUNTIME    = VER + '-runtime';
const TILES      = VER + '-tiles';
const DATA       = VER + '-data';
const TILE_LIMIT = 400;   // จำกัดจำนวน tile แผนที่ที่เก็บ กันกินพื้นที่เครื่อง

/* ไฟล์หลักที่ต้องมีไว้เปิดแอปตอนออฟไลน์ */
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

/* ---------- ติดตั้ง ---------- */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => Promise.allSettled(SHELL_FILES.map(f => c.add(f))))
      .then(() => self.skipWaiting())
  );
});

/* ---------- เปิดใช้งาน + ล้างแคชเวอร์ชันเก่า ---------- */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !k.startsWith(VER)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ---------- กลยุทธ์การดึงข้อมูล ---------- */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;          // POST ปล่อยผ่าน ให้ outbox จัดการเอง
  const url = new URL(req.url);

  // 1) API (Google Apps Script / Open-Meteo) → Network first, ล้มเหลวค่อยใช้แคช
  if (url.hostname.includes('script.google.com') || url.hostname.includes('open-meteo.com')) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(DATA).then(c => c.put(stripQuery(req), copy));
          return res;
        })
        .catch(() =>
          caches.open(DATA)
            .then(c => c.match(stripQuery(req)))
            .then(hit => hit || new Response(
              JSON.stringify({ ok: false, offline: true }),
              { headers: { 'Content-Type': 'application/json' } }
            ))
        )
    );
    return;
  }

  // 2) Tile แผนที่ → Cache first + จำกัดจำนวน
  if (url.hostname.includes('basemaps.cartocdn.com') || url.hostname.includes('tile.openstreetmap')) {
    e.respondWith(
      caches.open(TILES).then(c =>
        c.match(req).then(hit =>
          hit || fetch(req).then(res => {
            c.put(req, res.clone());
            trimCache(TILES, TILE_LIMIT);
            return res;
          }).catch(() => hit)
        )
      )
    );
    return;
  }

  // 3) ไฟล์แอป → Cache first แล้วอัปเดตเบื้องหลัง (stale-while-revalidate)
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(RUNTIME).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});

/* ---------- ยูทิลิตี้ ---------- */
function stripQuery(req) {            // ตัด ?t=timestamp ออก จะได้แคชซ้ำจุดเดิม
  const u = new URL(req.url);
  u.searchParams.delete('t');
  return new Request(u.toString(), { method: 'GET' });
}

async function trimCache(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  if (keys.length > max) {
    for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
  }
}

/* ---------- Background Sync: ส่งรายงานที่ค้างเมื่อเน็ตกลับมา ---------- */
self.addEventListener('sync', e => {
  if (e.tag === 'flush-outbox') {
    e.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true })
        .then(cs => cs.forEach(c => c.postMessage({ type: 'FLUSH_OUTBOX' })))
    );
  }
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});