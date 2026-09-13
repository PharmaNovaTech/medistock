// ================================================================
// MediStock v5.1.5 - Service Worker
// Offline-first PWA with smart caching
// ================================================================

const SW_VERSION = '5.1.5';
const CACHE_NAME = `medistock-v${SW_VERSION}`;
const RUNTIME_CACHE = `medistock-runtime-v${SW_VERSION}`;

// ไฟล์ที่ต้อง cache ตอน install
const PRECACHE_URLS = [
    './',
    './index.html',
    './manifest.json',
    './favicon.ico',
    './favicon-96x96.png',
    './apple-touch-icon.png',
    './android-chrome-192x192.png',
    './android-chrome-512x512.png'
];

// CDN ที่ควร cache (runtime)
const CDN_PATTERNS = [
    'cdnjs.cloudflare.com',
    'unpkg.com',
    'cdn.jsdelivr.net',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
];

// ================================================================
// INSTALL — Precache ไฟล์หลัก
// ================================================================
self.addEventListener('install', (event) => {
    console.log(`[SW ${SW_VERSION}] Installing...`);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log(`[SW] Precaching ${PRECACHE_URLS.length} files`);
                return cache.addAll(PRECACHE_URLS.map(url => new Request(url, { cache: 'reload' })));
            })
            .then(() => {
                console.log('[SW] Precache complete');
                return self.skipWaiting();
            })
            .catch((err) => {
                console.error('[SW] Precache failed:', err);
            })
    );
});

// ================================================================
// ACTIVATE — ลบ cache เก่า
// ================================================================
self.addEventListener('activate', (event) => {
    console.log(`[SW ${SW_VERSION}] Activating...`);
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name.startsWith('medistock-') && name !== CACHE_NAME && name !== RUNTIME_CACHE)
                        .map((name) => {
                            console.log(`[SW] Deleting old cache: ${name}`);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log('[SW] Activation complete');
                return self.clients.claim();
            })
    );
});

// ================================================================
// FETCH — กลยุทธ์ caching
// ================================================================
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // ข้าม non-GET
    if (request.method !== 'GET') return;

    // ข้าม request ที่ไม่ใช่ http/https (เช่น chrome-extension)
    if (!url.protocol.startsWith('http')) return;

    // ข้าม Google Sheets API (ต้อง real-time เสมอ)
    if (url.hostname === 'sheets.googleapis.com') return;

    // ข้าม Drive API
    if (url.hostname === 'www.googleapis.com') return;

    // ✅ ไฟล์ของเราเอง → Cache First (offline priority)
    if (url.origin === self.location.origin) {
        event.respondWith(cacheFirst(request));
        return;
    }

    // ✅ CDN (library, font) → Stale While Revalidate
    if (CDN_PATTERNS.some(pattern => url.hostname.includes(pattern))) {
        event.respondWith(staleWhileRevalidate(request));
        return;
    }

    // ✅ อื่นๆ → Network First (fallback cache)
    event.respondWith(networkFirst(request));
});

// ================================================================
// Cache Strategies
// ================================================================

// Cache First — ใช้ cache ก่อน ถ้าไม่มีค่อย fetch
async function cacheFirst(request) {
    try {
        const cached = await caches.match(request);
        if (cached) {
            return cached;
        }
        const response = await fetch(request);
        if (response && response.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        console.warn('[SW] cacheFirst failed:', err);
        // Fallback: ลองหา index.html ถ้าเป็น navigation
        if (request.mode === 'navigate') {
            const cached = await caches.match('./index.html');
            if (cached) return cached;
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
}

// Stale While Revalidate — คืน cache ทันที + update background
async function staleWhileRevalidate(request) {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(request);
    
    const fetchPromise = fetch(request)
        .then((response) => {
            if (response && response.status === 200) {
                cache.put(request, response.clone());
            }
            return response;
        })
        .catch((err) => {
            console.warn('[SW] SWR fetch failed:', err);
            return null;
        });

    return cached || await fetchPromise || new Response('Offline', { status: 503 });
}

// Network First — ลอง network ก่อน ถ้า fail ค่อยใช้ cache
async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (response && response.status === 200) {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
}

// ================================================================
// MESSAGE — รับข้อความจาก client
// ================================================================
self.addEventListener('message', (event) => {
    const { type, payload } = event.data || {};

    if (type === 'SKIP_WAITING') {
        console.log('[SW] Skip waiting — activating new version');
        self.skipWaiting();
        return;
    }

    if (type === 'GET_VERSION') {
        event.ports[0]?.postMessage({ version: SW_VERSION });
        return;
    }

    if (type === 'CLEAR_CACHE') {
        event.waitUntil(
            caches.keys().then((names) => {
                return Promise.all(
                    names
                        .filter(n => n.startsWith('medistock-'))
                        .map(n => caches.delete(n))
                );
            }).then(() => {
                event.ports[0]?.postMessage({ success: true });
            })
        );
        return;
    }

    if (type === 'CACHE_URLS') {
        const urls = payload?.urls || [];
        event.waitUntil(
            caches.open(RUNTIME_CACHE).then((cache) => {
                return cache.addAll(urls);
            }).then(() => {
                event.ports[0]?.postMessage({ success: true, count: urls.length });
            }).catch((err) => {
                event.ports[0]?.postMessage({ success: false, error: err.message });
            })
        );
        return;
    }
});

// ================================================================
// SYNC — Background Sync (ถ้ารองรับ)
// ================================================================
self.addEventListener('sync', (event) => {
    if (event.tag === 'medistock-sync') {
        console.log('[SW] Background sync triggered');
        event.waitUntil(
            self.clients.matchAll().then((clients) => {
                clients.forEach((client) => {
                    client.postMessage({ type: 'TRIGGER_SYNC' });
                });
            })
        );
    }
});

console.log(`[SW ${SW_VERSION}] Service Worker loaded`);