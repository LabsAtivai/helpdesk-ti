// Service Worker — Central de Suporte Labs Ativa
// Mantém conexão SSE própria para notificações em background

let evtSource = null;
let userToken = null;

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(clients.claim()); });

// Recebe token do frontend quando usuário loga
self.addEventListener('message', e => {
  if (e.data?.type === 'START_SSE' && e.data.token) {
    userToken = e.data.token;
    startSSE(e.data.token, e.data.baseUrl);
  }
  if (e.data?.type === 'STOP_SSE') {
    stopSSE();
  }
});

function stopSSE() {
  if (evtSource) { evtSource.close(); evtSource = null; }
}

function startSSE(token, baseUrl) {
  stopSSE();
  const url = (baseUrl || 'https://help.labsativa.com.br') + '/api/events?token=' + encodeURIComponent(token);

  // SW não suporta EventSource nativamente — usa fetch com stream
  fetchSSE(url, token, baseUrl);
}

async function fetchSSE(url, token, baseUrl) {
  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // guarda linha incompleta

      let eventType = null;
      let eventData = null;
      for (const line of lines) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim();
        if (line.startsWith('data: ')) {
          try { eventData = JSON.parse(line.slice(6)); } catch {}
        }
        if (line === '' && eventType && eventData) {
          handleEvent(eventType, eventData);
          eventType = null; eventData = null;
        }
      }
    }
  } catch (err) {
    // Reconecta após 5s se cair
    setTimeout(() => { if (userToken) fetchSSE(url, token, baseUrl); }, 5000);
  }
}

function handleEvent(type, data) {
  let titulo, msg, tag;

  if (type === 'novo_chamado') {
    titulo = '🎫 Novo chamado #' + data.id;
    msg = data.titulo + ' — ' + data.nome;
    tag = 'chamado-' + data.id;
  } else if (type === 'nova_mensagem') {
    titulo = '💬 Nova mensagem de ' + data.de;
    msg = data.texto;
    tag = 'msg-' + data.ticketId;
  } else if (type === 'status_atualizado') {
    const icons = { 'Em andamento': '🔧', 'Resolvido': '✅' };
    titulo = (icons[data.status] || '📋') + ' Chamado #' + data.id + ' — ' + data.status;
    msg = data.titulo;
    tag = 'status-' + data.id;
  } else {
    return; // ping ou refresh — ignora
  }

  self.registration.showNotification(titulo, {
    body: msg,
    icon: '/icon-192.png',
    badge: '/icon-72.png',
    tag: tag,
    renotify: true,
    vibrate: [200, 100, 200],
    data: { type, ticketId: data.id || data.ticketId }
  });

  // Avisa as abas abertas para atualizar a UI
  self.clients.matchAll({ type: 'window' }).then(list => {
    list.forEach(c => c.postMessage({ type: 'SSE_EVENT', event: type, data }));
  });
}

// Clique na notificação — foca a aba e abre o ticket
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const { ticketId } = e.notification.data || {};
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin)) {
          c.focus();
          if (ticketId) c.postMessage({ type: 'OPEN_TICKET', ticketId });
          return;
        }
      }
      return self.clients.openWindow('/');
    })
  );
});
