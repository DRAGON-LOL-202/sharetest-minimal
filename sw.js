self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.pathname.endsWith('/index.html')) {
    event.respondWith((async () => {
      let keys = '(none)';
      let fileInfo = '(no file)';
      let errorMsg = '';
      try {
        const formData = await event.request.formData();
        keys = Array.from(formData.keys()).join(', ') || '(empty)';
        const file = formData.get('sharedFile');
        if (file) {
          fileInfo = `${file.name} (${file.size} bytes, type=${file.type})`;
        }
      } catch (e) {
        errorMsg = (e && e.message) ? e.message : String(e);
      }
      const params = new URLSearchParams({
        shared: '1',
        keys,
        file: fileInfo,
        err: errorMsg
      });
      return Response.redirect('./index.html?' + params.toString(), 303);
    })());
  }
});
