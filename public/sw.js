// Service Worker — Central de Suporte Labs Ativa
// Responsável por exibir notificações nativas e tratar o clique nelas.
// A conexão SSE fica no index.html porque navegadores podem encerrar
// Service Workers em background, interrompendo streams longos.

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('message', e => {
  if (e.data?.type === 'SHOW_NOTIFICATION') {
    const { titulo, msg, tag, ticketId } = e.data;
    e.waitUntil(showNotification(titulo, msg, tag, ticketId));
  }
});

async function showNotification(titulo, msg, tag, ticketId) {
  await self.registration.showNotification(titulo, {
    body: msg,
    icon: '/icon-192.png',
    badge: '/icon-72.png',
    tag,
    renotify: true,
    vibrate: [200, 100, 200],
    data: { ticketId }
  });
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const { ticketId } = e.notification.data || {};

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin)) {
          c.focus();
          if (ticketId) c.postMessage({ type: 'OPEN_TICKET', ticketId });
          return;
        }
      }
      return self.clients.openWindow(ticketId ? '/?ticket=' + encodeURIComponent(ticketId) : '/');
    })
  );
});
