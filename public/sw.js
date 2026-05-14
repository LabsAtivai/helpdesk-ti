// Service Worker — Central de Suporte Labs Ativa
const CACHE = 'helpdesk-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

// Recebe mensagens do frontend via postMessage
self.addEventListener('message', e => {
  if (e.data?.type === 'NOTIFY') {
    const { titulo, msg, tag, url } = e.data;
    self.registration.showNotification(titulo, {
      body: msg,
      icon: '/icon-192.png',
      badge: '/icon-72.png',
      tag: tag || 'helpdesk',
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: url || '/' }
    });
  }
});

// Clique na notificação — foca ou abre a aba
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Se já tem aba aberta, foca ela
      for (const c of list) {
        if (c.url.includes(self.location.origin)) {
          return c.focus().then(c => c.postMessage({ type: 'OPEN_TICKET', url }));
        }
      }
      // Senão abre nova aba
      return clients.openWindow(url);
    })
  );
});
