const VERSION = 'v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

// وقتی نسخه جدید activate شد، به همه تب‌ها بگو
self.addEventListener('activate', e => {
  e.waitUntil(
    clients.matchAll({type:'window'}).then(cls => {
      cls.forEach(c => c.postMessage({type:'UPDATE_AVAILABLE'}));
    })
  );
});
