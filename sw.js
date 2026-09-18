/**
 * ================================================================
 * MediStock v5.3.0 — Service Worker (PWA Offline)
 * ================================================================
 */

const SW_VERSION = '5.3.0';
const CACHE_NAME = `medistock-v${SW_VERSION}`;
const RUNTIME_CACHE = `medistock-runtime-v${SW_VERSION}`;

// Assets to pre-cache
const PRECACHE_URLS = [
    './',
    './index.html',
    './MediStock_v5.3.0.html',
    './manifest.json',
    './favicon.ico',
    './favicon-16x16.png',
    './favicon-32x32.png',
    './apple-touch-icon.png',
    // CDN Libraries
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js',
    'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
    'https://unpkg.com/@zxing/library@0.19.1/umd/index.min.js',
    'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
    'https://cdn.jsdelivr.net/npm/chart.js'
];

// ================================================================
// INSTALL
// ================================================================
self.addEventListener('install', (event) => {
    console.log(`[SW v${SW_VERSION}] Installing...`);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log(`[SW v${SW_VERSION}] Pre-caching ${PRECACHE_URLS.length} assets`);
                // ใช้ individual add เพื่อไม่ให้ fail ทั้งหมดถ้ามีบางตัว fail
                return Promise.all(
                    PRECACHE_URLS.map(url => 
                        cache.add(url).catch(err => 
                            console.warn(`[SW] Failed to cache: ${url}`, err.message)
                        )
                    )
                );
            })
            .then(() => {
                console.log(`[SW v${SW_VERSION}] Installed`);
                return self.skipWaiting();
            })
    );
});

// ================================================================
// ACTIVATE
// ================================================================
self.addEventListener('activate', (event) => {
    console.log(`[SW v${SW_VERSION}] Activating...`);
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames
                        .filter(name => name.startsWith('medistock-') && 
                                       name !== CACHE_NAME && 
                                       name !== RUNTIME_CACHE)
                        .map(name => {
                            console.log(`[SW] Deleting old cache: ${name}`);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log(`[SW v${SW_VERSION}] Activated`);
                return self.clients.claim();
            })
    );
});

// ================================================================
// FETCH (Network-first for API, Cache-first for assets)
// ================================================================
self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // Skip non-GET
    if (req.method !== 'GET') return;

    // Skip chrome extensions / devtools
    if (url.protocol === 'chrome-extension:' || url.protocol === 'devtools:') return;

    // ========== API calls: Network-first ==========
    if (url.hostname.includes('script.google.com') ||
        url.hostname.includes('sheets.googleapis.com') ||
        url.hostname.includes('googleapis.com')) {
        event.respondWith(networkFirst(req, RUNTIME_CACHE));
        return;
    }

    // ========== Same-origin HTML/JS/CSS: Network-first (เพื่ออัปเดตได้) ==========
    if (url.origin === location.origin && 
        (url.pathname.endsWith('.html') || 
         url.pathname.endsWith('.js') || 
         url.pathname.endsWith('.css') ||
         url.pathname === '/' || 
         url.pathname.endsWith('/'))) {
        event.respondWith(networkFirst(req, CACHE_NAME));
        return;
    }

    // ========== CDN / Fonts / Images: Cache-first ==========
    event.respondWith(cacheFirst(req, CACHE_NAME));
});

// ================================================================
// STRATEGIES
// ================================================================
async function networkFirst(request, cacheName) {
    try {
        const networkResponse = await fetch(request);
        // Cache successful responses
        if (networkResponse && networkResponse.ok && networkResponse.status === 200) {
            const cache = await caches.open(cacheName);
            cache.put(request, networkResponse.clone()).catch(() => {});
        }
        return networkResponse;
    } catch (err) {
        console.log(`[SW] Network failed, falling back to cache: ${request.url}`);
        const cached = await caches.match(request);
        if (cached) return cached;
        
        // Fallback สำหรับ HTML
        if (request.destination === 'document') {
            const fallback = await caches.match('./index.html') || 
                            await caches.match('./MediStock_v5.3.0.html');
            if (fallback) return fallback;
        }
        
        throw err;
    }
}

async function cacheFirst(request, cacheName) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok && networkResponse.status === 200) {
            const cache = await caches.open(cacheName);
            cache.put(request, networkResponse.clone()).catch(() => {});
        }
        return networkResponse;
    } catch (err) {
        console.warn(`[SW] Fetch failed for: ${request.url}`, err.message);
        throw err;
    }
}

// ================================================================
// MESSAGE HANDLERS
// ================================================================
self.addEventListener('message', (event) => {
    if (!event.data) return;

    if (event.data.type === 'SKIP_WAITING') {
        console.log(`[SW v${SW_VERSION}] SKIP_WAITING received`);
        self.skipWaiting();
    }

    if (event.data.type === 'CLEAR_CACHE') {
        event.waitUntil(
            caches.keys().then(names => {
                return Promise.all(
                    names.filter(n => n.startsWith('medistock-')).map(n => caches.delete(n))
                );
            }).then(() => {
                if (event.ports && event.ports[0]) {
                    event.ports[0].postMessage({ ok: true });
                }
            })
        );
    }

    if (event.data.type === 'GET_VERSION') {
        if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ version: SW_VERSION });
        }
    }
});

// ================================================================
// PUSH NOTIFICATIONS (optional)
// ================================================================
self.addEventListener('push', (event) => {
    if (!event.data) return;
    
    try {
        const data = event.data.json();
        const title = data.title || 'MediStock';
        const options = {
            body: data.body || '',
            icon: './apple-touch-icon.png',
            badge: './favicon-32x32.png',
            vibrate: [200, 100, 200],
            data: data.data || {}
        };
        
        event.waitUntil(self.registration.showNotification(title, options));
    } catch (e) {
        console.warn('[SW] Push parse failed:', e.message);
    }
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then(clients => {
            // ถ้ามี tab อยู่แล้ว ให้ focus
            for (const client of clients) {
                if (client.url.includes('MediStock') && 'focus' in client) {
                    return client.focus();
                }
            }
            // ถ้าไม่มี เปิดใหม่
            if (self.clients.openWindow) {
                return self.clients.openWindow('./');
            }
        })
    );
});

console.log(`[SW v${SW_VERSION}] Service Worker loaded`);