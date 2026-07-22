self.addEventListener("push", (event) => {
  const payload = event.data?.json?.() ?? {};
  if (!["incoming_call", "call_notification_test"].includes(payload.type)) return;
  const isTest = payload.type === "call_notification_test";
  event.waitUntil(
    self.registration.showNotification(
      payload.title || (isTest ? "AdeHQ notifications are ready" : "Incoming AdeHQ call"),
      {
      body: isTest ? "Background ringing can reach this device." : "Open AdeHQ to answer or decline.",
      icon: "/brand/adehq-icon.svg",
      badge: "/brand/adehq-icon.svg",
      tag: isTest ? "call-notification-test" : `call-${payload.callId}`,
      renotify: !isTest,
      requireInteraction: !isTest,
      data: { url: payload.url || `/calls?call=${payload.callId}` },
      },
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/calls", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        existing.navigate(target);
        return existing.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
