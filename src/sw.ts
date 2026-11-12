/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';
import { set } from 'idb-keyval';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any };

// WhatsApp/Files থেকে "Share" করা PDF গ্রহণ
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith((async () => {
      try {
        const form = await event.request.formData();
        const file = (form.getAll('pdf') as File[]).find((f) => f && typeof f !== 'string');
        if (file) await set('shared-pdf', { name: file.name, blob: file });
      } catch { /* ignore */ }
      return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
    })());
  }
});

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST, { ignoreURLParametersMatching: [/.*/] });
