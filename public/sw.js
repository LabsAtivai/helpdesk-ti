// Service Worker — Central de Suporte Labs Ativa
const CACHE_NAME = 'helpdesk-v2';

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(clients.claim()); });

// Mantém SW vivo com BroadcastChannel para receber eventos do SSE
const bc = new BroadcastChannel('helpdesk_notif');

bc.onmessage = e => {
  const { titulo, msg, tag, ticketId } = e.data;
  self.registration.showNotification(titulo, {
    body: msg,
    icon: '/icon-192.png',
    badge: '/icon-72.png',
    tag: tag || 'helpdesk',
    renotify: true,
    vibrate: [200, 100, 200],
    data: { ticketId }
  });
};

// Recebe também via postMessage direto
self.addEventListener('message', e => {
  if (e.data?.type === 'NOTIFY') {
    const { titulo, msg, tag, ticketId } = e.data;
    self.registration.showNotification(titulo, {
      body: msg,
      icon: '/icon-192.png',
      badge: '/icon-72.png',
      tag: tag || 'helpdesk',
      renotify: true,
      vibrate: [200, 100, 200],
      data: { ticketId }
    });
  }
});

// Clique na notificação — foca a aba e abre o ticket
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const ticketId = e.notification.data?.ticketId;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin)) {
          c.focus();
          if (ticketId) c.postMessage({ type: 'OPEN_TICKET', ticketId });
          return;
        }
      }
      return clients.openWindow('/');
    })
  );
});
