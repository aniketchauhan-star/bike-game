// Minimal service worker: lets phones install the game as an app (it then opens straight in full screen).
// No caching on purpose — the game always loads the latest files from the server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
