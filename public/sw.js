/* Service worker del panel (DP-10): recibe el push y abre la bandeja de autorizaciones. Sin caché: el panel trabaja con red. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = { title: 'GymFlow', body: '', url: '/panel', tag: undefined };
  try { d = { ...d, ...e.data.json() }; } catch { d.body = e.data ? e.data.text() : ''; }
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, tag: d.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url }, renotify: !!d.tag }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/panel';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    const abierta = ws.find((w) => 'focus' in w);
    if (abierta) { abierta.navigate(url); return abierta.focus(); }
    return self.clients.openWindow(url);
  }));
});
