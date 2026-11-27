// iPhoneのホーム画面のアプリで、通知を受け取ってアイコンの数字（バッジ）を変える
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let s = { count: 0, title: '在庫管理', body: '売れた商品があります' };
    try {
      const r = await fetch('/api/push/status', { credentials: 'include', cache: 'no-store' });
      if (r.ok) s = await r.json();
    } catch { /* 読めない時は決まった文で知らせる */ }
    try {
      if (s.count > 0) await self.navigator.setAppBadge(s.count); else await self.navigator.clearAppBadge();
    } catch { /* 数字に対応していない端末 */ }
    await self.registration.showNotification(s.title, {
      body: s.body, icon: '/icon-180.png', badge: '/icon-180.png', tag: 'sold', renotify: true, data: { url: '/#/stops' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) { if ('focus' in c) { await c.navigate(event.notification.data?.url || '/'); return c.focus(); } }
    return self.clients.openWindow(event.notification.data?.url || '/');
  })());
});
