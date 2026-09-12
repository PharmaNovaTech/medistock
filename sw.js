/* ================================================================
 * MediStock v5.1.3 - Service Worker
 * ----------------------------------------------------------------
 * กลยุทธ์แคช:
 *  - App Shell (index.html, manifest)   → Network-First (fallback cache)
 *  - Static Assets (fonts, icons, libs) → Cache-First + Stale-While-Revalidate
 *  - CDN Libraries                       → Cache-First (precache ทั้งหมด)
 *  - API (Google Sheets, Sync)          → Network-Only (ห้ามแคช)
 *  - Fonts (Google Fonts)                → Cache-First
 * ================================================================ */

const SW_VERSION = '5.1.3';
const CACHE_VERSION = 'v5.1.3';
const CACHE_PREFIX = 'medistock';

// ─── Cache Names ────────────────────────────────────────────────
const CACHE_APP_SHELL   = `${CACHE_PREFIX}-app-shell-${CACHE_VERSION}`;
const CACHE_STATIC      = `${CACHE_PREFIX}-static-${CACHE_VERSION}`;
const CACHE_LIBS        = `${CACHE_PREFIX}-libs-${CACHE_VERSION}`;
const CACHE_FONTS       = `${CACHE_PREFIX}-fonts-${CACHE_VERSION}`;
const CACHE_IMAGES      = `${CACHE_PREFIX}-images-${CACHE_VERSION}`;
const CACHE_RUNTIME     = `${CACHE_PREFIX}-runtime-${CACHE_VERSION}`;

const ALL_CACHES = [
  CACHE_APP_SHELL,
  CACHE_STATIC,
  CACHE_LIBS,
  CACHE_FONTS,
  CACHE_IMAGES,
  CACHE_RUNTIME,
];

// ─── Files ที่ precache ตอน install ─────────────────────────────
const APP_SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
];

const STATIC_FILES = [
  './favicon.ico',
  './favicon-16x16.png',
  './favicon-32x32.png',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-192-maskable.png',
  './icon-512.png',
  './icon-512-maskable.png',
];

// ─── CDN Libraries (สำคัญมาก! ต้องแคชล่วงหน้าเพื่อให้ใช้ offline ได้)
const CDN_LIBRARIES = [
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://unpkg.com/@zxing/library@0.19.1/umd/index.min.js',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
];

// ─── Google Fonts (แคชล่วงหน้าเพื่อให้ธีมโหลดเร็ว/offline ได้)
const FONT_URLS = [
  'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap',
  'https://fonts.gstatic.com',
];

// ================================================================
// INSTALL — precache app shell + libraries
// ================================================================
self.addEventListener('install', (event) => {
  console.log('[SW] 📦 Installing MediStock SW v' + SW_VERSION);
  event.waitUntil(
    (async () => {
      // 1) App Shell (สำคัญที่สุด — ถ้าพลาดตัวอื่นยังไปต่อได้)
      const appShellCache = await caches.open(CACHE_APP_SHELL);
      await appShellCache.addAll(APP_SHELL_FILES).catch(err => {
        console.warn('[SW] ⚠️ App shell cache failed:', err);
      });

      // 2) Static assets (ไม่ critical ถ้าพลาด)
      const staticCache = await caches.open(CACHE_STATIC);
      await Promise.allSettled(
        STATIC_FILES.map(url =>
          fetch(url, { cache: 'no-cache' })
            .then(res => res.ok && staticCache.put(url, res))
            .catch(() => {})
        )
      );

      // 3) CDN libraries (สำคัญมากสำหรับ offline scan/export)
      const libsCache = await caches.open(CACHE_LIBS);
      await Promise.allSettled(
        CDN_LIBRARIES.map(url =>
          fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-cache' })
            .then(res => {
              // opaque responses (status 0) จาก CORS — เก็บได้แต่ตรวจ .ok ไม่ได้
              if (res && (res.ok || res.type === 'opaque')) {
                return libsCache.put(url, res);
              }
            })
            .catch(err => console.warn('[SW] ⚠️ Lib cache miss:', url, err.message))
        )
      );

      // 4) Google Fonts CSS (font files จะถูกแคชแบบ runtime)
      const fontsCache = await caches.open(CACHE_FONTS);
      await Promise.allSettled(
        [FONT_URLS[0]].map(url =>
          fetch(url, { mode: 'cors', credentials: 'omit' })
            .then(res => res.ok && fontsCache.put(url, res))
            .catch(() => {})
        )
      );

      console.log('[SW] ✅ Precache เสร็จสิ้น');

      // บังคับให้ SW ใหม่เข้าทำงานทันที
      await self.skipWaiting();
    })()
  );
});

// ================================================================
// ACTIVATE — ล้าง cache เก่า + เปิด navigation preload
// ================================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] 🚀 Activating MediStock SW v' + SW_VERSION);
  event.waitUntil(
    (async () => {
      // ลบ cache เก่าทั้งหมดที่ไม่ใช่ version ปัจจุบัน
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter(name => name.startsWith(CACHE_PREFIX) && !ALL_CACHES.includes(name))
          .map(name => {
            console.log('[SW] 🗑️ Deleting old cache:', name);
            return caches.delete(name);
          })
      );

      // เปิด Navigation Preload (ทำให้ navigation เร็วขึ้นบน Chrome)
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch (e) {
          console.warn('[SW] Navigation preload ไม่พร้อมใช้งาน:', e);
        }
      }

      // ควบคุมทุก tab ที่เปิดอยู่ทันที
      await self.clients.claim();

      // แจ้งเตือน client ว่าอัปเดตแล้ว
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(client => {
        client.postMessage({
          type: 'SW_ACTIVATED',
          version: SW_VERSION,
          timestamp: Date.now(),
        });
      });

      console.log('[SW] ✅ Activate เสร็จสิ้น');
    })()
  );
});

// ================================================================
// FETCH — Router
// ================================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // ─── 1) ข้าม non-GET (POST/PUT/DELETE) → Network only
  if (request.method !== 'GET') {
    return; // ให้ browser จัดการตามปกติ
  }

  // ─── 2) ข้าม chrome-extension, devtools, blob, data URLs
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // ─── 3) ห้าม cache Google Sheets API / Sync endpoints ─────────
  if (
    url.hostname === 'sheets.googleapis.com' ||
    url.hostname === 'script.google.com' ||
    url.hostname === 'script.googleusercontent.com' ||
    url.pathname.includes('/exec') ||
    url.searchParams.has('token') // Shared sync token
  ) {
    event.respondWith(networkOnly(request));
    return;
  }

  // ─── 4) Navigation requests (HTML pages) → Network-first ──────
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }

  // ─── 5) Google Fonts → Cache-first ────────────────────────────
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(cacheFirst(request, CACHE_FONTS));
    return;
  }

  // ─── 6) CDN libraries → Cache-first ───────────────────────────
  if (
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('cdn.jsdelivr.net') ||
    url.hostname.includes('unpkg.com')
  ) {
    event.respondWith(cacheFirst(request, CACHE_LIBS));
    return;
  }

  // ─── 7) Same-origin static assets ─────────────────────────────
  if (url.origin === self.location.origin) {
    // รูปภาพ → Cache-first
    if (isImageRequest(request)) {
      event.respondWith(cacheFirst(request, CACHE_IMAGES));
      return;
    }
    // ไฟล์อื่นๆ (css, js, json, woff, ico)
    if (isStaticAsset(request)) {
      event.respondWith(staleWhileRevalidate(request, CACHE_STATIC));
      return;
    }
    // อื่นๆ ใน origin เดียวกัน → network first
    event.respondWith(networkFirst(request, CACHE_RUNTIME));
    return;
  }

  // ─── 8) Cross-origin อื่นๆ → Network-first fallback cache ────
  event.respondWith(networkFirst(request, CACHE_RUNTIME));
});

// ================================================================
// STRATEGIES
// ================================================================

/** Network-only (ห้ามแคช) */
async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch (err) {
    // ตอบ error response แทนเพื่อไม่ให้ fetch ล้มเหลวแบบ uncaught
    return new Response(
      JSON.stringify({ ok: false, error: 'offline', message: 'ไม่มีการเชื่อมต่ออินเทอร์เน็ต' }),
      { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/** Network-first: ลองเน็ตก่อน ถ้าพลาดค่อยดู cache */
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return offlineFallback(request);
  }
}

/** Cache-first: ดู cache ก่อน ถ้าไม่มีค่อย fetch */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    return offlineFallback(request);
  }
}

/** Stale-While-Revalidate: คืน cache ทันที + อัปเดตเบื้องหลัง */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(response => {
      if (response && response.ok) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  return cached || (await networkPromise) || offlineFallback(request);
}

/** จัดการ navigation request (เปิดหน้า index.html) */
async function handleNavigation(event) {
  const { request } = event;
  try {
    // ใช้ preload response ถ้ามี (เร็วที่สุดบน Chrome)
    const preload = event.preloadResponse ? await event.preloadResponse : null;
    if (preload && preload.ok) {
      const cache = await caches.open(CACHE_APP_SHELL);
      cache.put('./index.html', preload.clone()).catch(() => {});
      return preload;
    }

    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_APP_SHELL);
      cache.put('./index.html', response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    // Offline → ใช้ index.html ที่ cache ไว้
    const cached =
      (await caches.match('./index.html')) ||
      (await caches.match('./')) ||
      (await caches.match(request));
    if (cached) return cached;
    return offlineFallback(request);
  }
}

// ================================================================
// HELPERS
// ================================================================
function isImageRequest(request) {
  if (request.destination === 'image') return true;
  const url = new URL(request.url);
  return /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i.test(url.pathname);
}

function isStaticAsset(request) {
  const dest = request.destination;
  if (['script', 'style', 'worker', 'font', 'manifest'].includes(dest)) return true;
  const url = new URL(request.url);
  return /\.(js|css|woff2?|ttf|otf|eot|json|webmanifest)$/i.test(url.pathname);
}

/** Fallback เมื่อ offline และไม่มี cache */
function offlineFallback(request) {
  const accept = request.headers.get('accept') || '';

  if (accept.includes('text/html') || request.mode === 'navigate') {
    return new Response(
      `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MediStock - ออฟไลน์</title>
  <style>
    body{font-family:-apple-system,'Segoe UI',sans-serif;background:#f0f9ff;color:#0f172a;
         display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;text-align:center;}
    .box{background:#fff;padding:32px 24px;border-radius:20px;box-shadow:0 10px 40px rgba(14,165,233,.15);max-width:400px;}
    .icon{font-size:56px;margin-bottom:12px;}
    h1{color:#0ea5e9;margin:0 0 8px;font-size:22px;}
    p{color:#64748b;font-size:14px;line-height:1.6;margin:8px 0 20px;}
    button{background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;border:none;
           padding:12px 28px;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;}
    button:active{transform:scale(0.96);}
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">📡</div>
    <h1>ไม่มีการเชื่อมต่ออินเทอร์เน็ต</h1>
    <p>MediStock ยังทำงานได้ตามปกติในโหมดออฟไลน์<br>ข้อมูลทั้งหมดถูกบันทึกไว้ในเครื่องของคุณแล้ว</p>
    <button onclick="location.reload()">🔄 ลองอีกครั้ง</button>
  </div>
</body>
</html>`,
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  if (accept.includes('application/json')) {
    return new Response(
      JSON.stringify({ ok: false, error: 'offline', message: 'ไม่มีการเชื่อมต่อ' }),
      { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  return new Response('Offline', { status: 503, statusText: 'Offline' });
}

// ================================================================
// MESSAGE HANDLER — ให้ client สั่งงาน SW ได้
// ================================================================
self.addEventListener('message', (event) => {
  const data = event.data || {};

  // ข้ามข้อความจาก SW เอง
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // ล้าง cache ทั้งหมด (เรียกจากหน้า Settings)
  if (data.type === 'CLEAR_ALL_CACHES') {
    event.waitUntil(
      (async () => {
        const names = await caches.keys();
        await Promise.all(
          names.filter(n => n.startsWith(CACHE_PREFIX)).map(n => caches.delete(n))
        );
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach(client => {
          client.postMessage({ type: 'CACHES_CLEARED', timestamp: Date.now() });
        });
      })()
    );
    return;
  }

  // ตรวจสอบว่ามี cache อยู่ไหม (สำหรับ debug)
  if (data.type === 'PING') {
    event.waitUntil(
      (async () => {
        const names = await caches.keys();
        event.source?.postMessage({
          type: 'PONG',
          version: SW_VERSION,
          caches: names.filter(n => n.startsWith(CACHE_PREFIX)),
          timestamp: Date.now(),
        });
      })()
    );
  }

  // Force update SW
  if (data.type === 'FORCE_UPDATE') {
    self.registration.update().catch(() => {});
  }
});

// ================================================================
// SYNC / PERIODIC SYNC (ถ้า browser รองรับ)
// ================================================================
self.addEventListener('sync', (event) => {
  if (event.tag === 'medistock-sync') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'BACKGROUND_SYNC_TRIGGERED', timestamp: Date.now() });
        });
      })
    );
  }
});

// ================================================================
// PUSH NOTIFICATION (optional — แจ้งเตือนสินค้าใกล้หมดอายุ)
// ================================================================
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch (e) {
    payload = { title: 'MediStock', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'MediStock', {
      body: payload.body || 'มีการแจ้งเตือนใหม่',
      icon: './icon-192.png',
      badge: './favicon-32x32.png',
      tag: payload.tag || 'medistock-notification',
      data: payload.data || {},
      vibrate: [200, 100, 200],
      requireInteraction: payload.requireInteraction || false,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './index.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // ถ้ามี tab ที่เปิดอยู่แล้ว → focus
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          return client.focus();
        }
      }
      // ถ้าไม่มี → เปิดใหม่
      return self.clients.openWindow(targetUrl);
    })
  );
});

console.log('[SW] 📥 MediStock Service Worker v' + SW_VERSION + ' โหลดแล้ว');