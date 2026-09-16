function indexOfBytes(haystack, needle, fromIndex) {
  fromIndex = fromIndex || 0;
  outer:
  for (let i = fromIndex; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

// تحليل يدوي لجسم multipart/form-data لما formData() الجاهزة ترجّع فاضية
// (سلوك معروف في Chrome على أندرويد: بيقرأ الجسم صح بايتيًا بس أحيانًا
// بيفشل بصمت في تحويله لحقول FormData رغم إن الملف موجود فعليًا في الـ body)
async function parseMultipartManually(request) {
  const contentType = request.headers.get('content-type') || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) return null;
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const boundaryBytes = new TextEncoder().encode('--' + boundary);
  const crlfcrlf = new TextEncoder().encode('\r\n\r\n');
  const buf = new Uint8Array(await request.arrayBuffer());

  const fd = new FormData();
  let pos = indexOfBytes(buf, boundaryBytes, 0);
  if (pos === -1) return { fd, bodyBytes: buf.length };
  pos += boundaryBytes.length;

  while (true) {
    if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) break; // "--" نهاية الجسم
    if (buf[pos] === 0x0d && buf[pos + 1] === 0x0a) pos += 2; // تخطي CRLF

    const headerEnd = indexOfBytes(buf, crlfcrlf, pos);
    if (headerEnd === -1) break;
    const headerText = new TextDecoder('utf-8').decode(buf.slice(pos, headerEnd));

    const nextBoundary = indexOfBytes(buf, boundaryBytes, headerEnd);
    if (nextBoundary === -1) break;

    const bodyStart = headerEnd + 4;
    const bodyEnd = nextBoundary - 2; // إزالة CRLF قبل الـ boundary التالي
    const partBytes = buf.slice(bodyStart, Math.max(bodyStart, bodyEnd));

    const nameMatch = headerText.match(/name="([^"]*)"/i);
    const filenameMatch = headerText.match(/filename="([^"]*)"/i);
    const ctMatch = headerText.match(/Content-Type:\s*([^\r\n]+)/i);
    const fieldName = nameMatch ? nameMatch[1] : null;

    if (fieldName) {
      if (filenameMatch) {
        const fileType = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';
        const file = new File([partBytes], filenameMatch[1] || 'shared-file', { type: fileType });
        fd.append(fieldName, file);
      } else {
        const text = new TextDecoder('utf-8').decode(partBytes);
        fd.append(fieldName, text);
      }
    }

    pos = nextBoundary + boundaryBytes.length;
  }

  return { fd, bodyBytes: buf.length };
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.pathname.endsWith('/index.html')) {
    event.respondWith((async () => {
      let keys = '(none)';
      let fileInfo = '(no file)';
      let errorMsg = '';
      let recovered = 'لا';

      try {
        const cloned = event.request.clone();
        let formData = null;
        try {
          formData = await cloned.formData();
        } catch (e) {
          formData = null;
        }

        let entryCount = formData ? Array.from(formData.keys()).length : 0;

        if (entryCount === 0) {
          const manual = await parseMultipartManually(event.request);
          if (manual && Array.from(manual.fd.keys()).length > 0) {
            formData = manual.fd;
            entryCount = Array.from(formData.keys()).length;
            recovered = `نعم (حجم الجسم الخام: ${manual.bodyBytes} بايت)`;
          } else if (manual) {
            errorMsg = `formData فاضية والتحليل اليدوي برضو فاضي (حجم الجسم: ${manual.bodyBytes} بايت)`;
          }
        }

        keys = formData ? (Array.from(formData.keys()).join(', ') || '(empty)') : '(empty)';
        const file = formData ? formData.get('sharedFile') : null;
        if (file && file.name !== undefined) {
          fileInfo = `${file.name} (${file.size} bytes, type=${file.type})`;
        }
      } catch (e) {
        errorMsg = (e && e.message) ? e.message : String(e);
      }

      const params = new URLSearchParams({
        shared: '1',
        keys,
        file: fileInfo,
        recovered,
        err: errorMsg
      });
      return Response.redirect('./index.html?' + params.toString(), 303);
    })());
  }
});
