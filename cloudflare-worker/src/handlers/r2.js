import { json } from '../utils/response.js';

export function registerR2Routes(router) {
  router.post('/r2/sign-upload', async (request, env) => {
    const url = new URL(request.url);
    const body = await request.json();
    const key = body.path;
    const contentType = body.contentType || 'application/octet-stream';
    if (!key) return json({ error: 'Missing path' }, { status: 400 });
    const uploadUrl = url.origin + '/r2/upload?key=' + encodeURIComponent(key) + '&ct=' + encodeURIComponent(contentType);
    return json({ url: uploadUrl });
  });

  // 1b) Batch sign upload: accepts array of {path, contentType} and returns array of signed URLs
  // Reduces round-trips for bulk uploads (e.g., 1000 files from 1000 requests to ~10 batched requests)
  router.post('/r2/sign-upload-batch', async (request, env) => {
    const url = new URL(request.url);
    const body = await request.json();
    const items = body.items; // Array of {path, contentType?}
    if (!Array.isArray(items) || items.length === 0) {
      return json({ error: 'Missing or empty items array' }, { status: 400 });
    }
    const urls = items.map(item => {
      const key = item.path;
      const contentType = item.contentType || 'application/octet-stream';
      if (!key) return null;
      return {
        path: key,
        url: url.origin + '/r2/upload?key=' + encodeURIComponent(key) + '&ct=' + encodeURIComponent(contentType)
      };
    }).filter(Boolean);
    return json({ urls });
  });

  // 2) PUT upload proxy: actually store into R2
  router.put('/r2/upload', async (request, env) => {
    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    const ct = url.searchParams.get('ct') || 'application/octet-stream';
    if (!key) return json({ error: 'Missing key' }, { status: 400 });
    await env.MEDIA_BUCKET.put(key, request.body, { httpMetadata: { contentType: ct } });
    return json({ ok: true, key });
  });

  // 2c) Multipart upload endpoints for large files (video)
  // INIT: POST /r2/multipart/init { key, contentType }
  router.post('/r2/multipart/init', async (request, env) => {
    try {
      const body = await request.json();
      const key = body.key;
      const contentType = body.contentType || 'application/octet-stream';
      if (!key) return json({ error: 'Missing key' }, { status: 400 });
      const mpu = await env.MEDIA_BUCKET.createMultipartUpload(key, { httpMetadata: { contentType } });
      return json({ uploadId: mpu.uploadId, key });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // UPLOAD PART: PUT /r2/multipart/part?key=...&uploadId=...&partNumber=1  (body=bytes)
  router.put('/r2/multipart/part', async (request, env) => {
    try {
      const url = new URL(request.url);
      const key = url.searchParams.get('key');
      const uploadId = url.searchParams.get('uploadId');
      const pn = url.searchParams.get('partNumber');
      const partNumber = Number(pn);
      if (!key || !uploadId || !partNumber) return json({ error: 'Missing key/uploadId/partNumber' }, { status: 400 });
      const mpu = await env.MEDIA_BUCKET.resumeMultipartUpload(key, uploadId);
      if (!mpu) return json({ error: 'Not found' }, { status: 404 });
      const res = await mpu.uploadPart(partNumber, request.body);
      return json({ etag: res.etag, partNumber });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // COMPLETE: POST /r2/multipart/complete { key, uploadId, parts:[{partNumber,etag}] }
  router.post('/r2/multipart/complete', async (request, env) => {
    try {
      const body = await request.json();
      const key = body.key; const uploadId = body.uploadId; const parts = body.parts || [];
      if (!key || !uploadId || !Array.isArray(parts) || !parts.length) return json({ error: 'Missing key/uploadId/parts' }, { status: 400 });
      const mpu = await env.MEDIA_BUCKET.resumeMultipartUpload(key, uploadId);
      if (!mpu) return json({ error: 'Not found' }, { status: 404 });
      await mpu.complete(parts.map(p => ({ partNumber: Number(p.partNumber), etag: String(p.etag) })));
      return json({ ok: true, key });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // ABORT: POST /r2/multipart/abort { key, uploadId }
  router.post('/r2/multipart/abort', async (request, env) => {
    try {
      const body = await request.json();
      const key = body.key; const uploadId = body.uploadId;
      if (!key || !uploadId) return json({ error: 'Missing key/uploadId' }, { status: 400 });
      const mpu = await env.MEDIA_BUCKET.resumeMultipartUpload(key, uploadId);
      if (!mpu) return json({ error: 'Not found' }, { status: 404 });
      await mpu.abort();
      return json({ ok: true });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // 2a) List R2 objects
  // Default: returns mixed directories and files under a prefix using delimiter '/'
  // When flat=1: returns a paginated flat list of objects with cursor for recursive operations
  router.get('/r2/list', async (request, env) => {
    const url = new URL(request.url);
    if (!env.MEDIA_BUCKET) return json([], { status: 200 });
    const inputPrefix = url.searchParams.get('prefix') || '';
    const norm = String(inputPrefix).replace(/^\/+|\/+$/g, '');
    const flat = /^(1|true|yes)$/i.test(url.searchParams.get('flat') || '');
    if (flat) {
      const cursor = url.searchParams.get('cursor') || undefined;
      const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') || '1000')));
      try {
        const prefixFlat = norm ? (norm.endsWith('/') ? norm : norm + '/') : '';
        const res = await env.MEDIA_BUCKET.list({ prefix: prefixFlat, cursor, limit });
        const objects = (res.objects || []).map((o) => ({
          key: o.key,
          size: o.size,
          modified: o.uploaded ? new Date(o.uploaded).toISOString() : null,
        }));
        return json({ objects, cursor: res.cursor || null, truncated: !!res.truncated });
      } catch (e) {
        return json({ error: e.message }, { status: 500 });
      }
    }
    const prefix = norm ? (norm.endsWith('/') ? norm : norm + '/') : '';
    const paged = /^(1|true|yes)$/i.test(url.searchParams.get('paged') || '');
    const cursor = url.searchParams.get('cursor') || undefined;
    const limitRaw = url.searchParams.get('limit');
    let limit = Number(limitRaw);
    if (!Number.isFinite(limit)) limit = 1000; // Cloudflare default
    limit = Math.min(1000, Math.max(1, limit));
    try {
      const listOpts = { prefix, delimiter: '/', cursor, limit };
      // When not paged we omit cursor/limit so behavior identical to previous implementation
      const res = paged ? await env.MEDIA_BUCKET.list(listOpts) : await env.MEDIA_BUCKET.list({ prefix, delimiter: '/' });
      const base = env.R2_PUBLIC_BASE || '';
      const makeUrl = (k) => base ? `${base}/${k}` : `${url.origin}/media/${k}`;
      const dirs = (res.delimitedPrefixes || []).map((p) => {
        const key = p;
        const name = key.replace(/^.*\//, '').replace(/\/$/, '') || key;
        return { key, name, type: 'directory' };
      });
      const files = (res.objects || []).map((o) => ({
        key: o.key,
        name: o.key.replace(/^.*\//, ''),
        type: 'file',
        size: o.size,
        modified: o.uploaded ? new Date(o.uploaded).toISOString() : null,
        url: makeUrl(o.key),
      }));
      if (paged) {
        return json({ items: [...dirs, ...files], cursor: res.cursor || null, truncated: !!res.truncated });
      }
      return json([...dirs, ...files]);
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // 2b) Delete R2 object (file) or empty directory (prefix ending with '/')
  router.delete('/r2/delete', async (request, env) => {
    const url = new URL(request.url);
    if (!env.MEDIA_BUCKET) return json({ error: 'R2 not configured' }, { status: 400 });
    const key = url.searchParams.get('key');
    const recursive = /^(1|true|yes)$/i.test(url.searchParams.get('recursive') || '');
    if (!key) return json({ error: 'Missing key' }, { status: 400 });
    try {
      if (key.endsWith('/')) {
        if (!recursive) {
          // Delete directory only if empty
          const check = await env.MEDIA_BUCKET.list({ prefix: key, limit: 2 });
          const has = (check.objects && check.objects.length) || (check.delimitedPrefixes && check.delimitedPrefixes.length);
          if (has) return json({ error: 'not-empty' }, { status: 400 });
          return json({ ok: true });
        }
        // Recursive delete (performance optimized): delete objects in parallel batches
        let cursor = undefined; let total = 0;
        // allow optional concurrency override (?c=30)
        const concRaw = url.searchParams.get('c');
        let concurrency = 20;
        if (concRaw) {
          const n = Number(concRaw);
          if (Number.isFinite(n) && n > 0 && n <= 100) concurrency = Math.floor(n);
        }
        while (true) {
          const res = await env.MEDIA_BUCKET.list({ prefix: key, cursor, limit: 1000 });
          const objs = res.objects || [];
          if (!objs.length) {
            if (!res.truncated) break;
            cursor = res.cursor;
            continue;
          }
          // Delete in concurrent batches to reduce total time
          let idx = 0;
          async function runBatch() {
            while (idx < objs.length) {
              const batch = [];
              for (let j = 0; j < concurrency && idx < objs.length; j++, idx++) {
                const objKey = objs[idx].key;
                batch.push(env.MEDIA_BUCKET.delete(objKey));
              }
              await Promise.allSettled(batch);
            }
          }
          await runBatch();
          total += objs.length;
          if (!res.truncated) break;
          cursor = res.cursor;
        }
        return json({ ok: true, deleted: total, concurrency });
      } else {
        await env.MEDIA_BUCKET.delete(key);
        return json({ ok: true });
      }
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });
}
