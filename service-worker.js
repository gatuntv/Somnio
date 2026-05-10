// ════════════════════════════════════════
//  SLEEP APP — SERVICE WORKER
//  Estrategia: Cache-first para assets estáticos,
//  Network-first para recursos externos (CDN).
// ════════════════════════════════════════

const CACHE_NAME = 'sleep-app-v1';

// Archivos locales que se cachean en la instalación
const PRECACHE_URLS = [
    './sleep-final.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png'
];

// Dominios externos que se cachean bajo demanda (network-first)
const CDN_HOSTS = [
    'cdn.tailwindcss.com',
    'cdnjs.cloudflare.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
];

// ─── INSTALL: Pre-cachear archivos locales ───
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Pre-cacheando archivos locales');
            // Cachear uno a uno para no fallar si alguno no existe aún
            return Promise.allSettled(
                PRECACHE_URLS.map(url =>
                    cache.add(url).catch(err =>
                        console.warn(`[SW] No se pudo cachear ${url}:`, err)
                    )
                )
            );
        }).then(() => self.skipWaiting())
    );
});

// ─── ACTIVATE: Limpiar caches antiguas ───
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => {
                        console.log('[SW] Eliminando cache antigua:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => self.clients.claim())
    );
});

// ─── FETCH: Estrategia híbrida ───
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Ignorar solicitudes no-GET y chrome-extension
    if (event.request.method !== 'GET') return;
    if (url.protocol === 'chrome-extension:') return;

    // ── CDN externos: Network-first, fallback a cache ──
    if (CDN_HOSTS.some(host => url.hostname.includes(host))) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    if (response && response.status === 200) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // ── Archivos locales: Cache-first, fallback a network ──
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                // Actualizar en background (stale-while-revalidate)
                fetch(event.request).then(response => {
                    if (response && response.status === 200) {
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, response));
                    }
                }).catch(() => {});
                return cachedResponse;
            }

            // No está en cache → ir a la red y cachear
            return fetch(event.request).then(response => {
                if (!response || response.status !== 200 || response.type === 'opaque') {
                    return response;
                }
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            });
        })
    );
});

// ─── PUSH NOTIFICATIONS (para alarmas futuras) ───
self.addEventListener('push', (event) => {
    const data = event.data?.json() ?? { title: 'Sleep App', body: '¡Es hora de despertar!' };
    event.waitUntil(
        self.registration.showNotification(data.title || 'Sleep App', {
            body: data.body || '¡Buenas noches!',
            icon: './icon-192.png',
            badge: './icon-192.png',
            vibrate: [300, 100, 300, 100, 300],
            tag: 'sleep-alarm',
            requireInteraction: true,
            actions: [
                { action: 'dismiss', title: 'Descartar' }
            ]
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    if (event.action === 'dismiss') return;
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            if (clientList.length > 0) return clientList[0].focus();
            return clients.openWindow('./sleep-final.html');
        })
    );
});
