export function registerMediaRoutes(router) {
  router.get('/media/*', async (request, env) => {
    const key = new URL(request.url).pathname.replace(/^\/media\//, '');
    if (!key) return new Response('Not found', { status: 404 });
    try {
      const obj = await env.MEDIA_BUCKET.get(key);
      if (!obj) return new Response('Not found', { status: 404 });
      const headers = {
        'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
      };
      return new Response(obj.body, { headers });
    } catch (e) {
      return new Response('Not found', { status: 404 });
    }
  });
}
