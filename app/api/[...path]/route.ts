/**
 * Same-origin gateway to the Python API. API_URL is read at request time, so the same build
 * works locally, in containers, and on Vercel (where the API is a separate project).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Headers only this proxy may set. Anything a browser sends under these names is dropped.
const PROXY_HEADERS = ['x-bgi-proxy-secret', 'x-bgi-client-ip', 'x-bgi-site-host'];

async function proxy(request: Request, {params}: {params: Promise<{path: string[]}>}) {
  const {path} = await params;
  const incoming = new URL(request.url);
  const target = new URL(`/api/${path.map(encodeURIComponent).join('/')}`, process.env.API_URL || 'http://127.0.0.1:8000');
  target.search = incoming.search;
  const headers = new Headers(request.headers);
  for (const name of ['host', 'connection', 'content-length', 'transfer-encoding', ...PROXY_HEADERS]) headers.delete(name);
  headers.set('accept-encoding', 'identity');
  const secret = process.env.PROXY_SECRET;
  if (secret) {
    // Proves the request came through this site, and passes on who asked and which site
    // they were on: the API rate-limits per visitor and accepts writes only from this site.
    headers.set('x-bgi-proxy-secret', secret);
    const client = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (client) headers.set('x-bgi-client-ip', client);
    headers.set('x-bgi-site-host', request.headers.get('x-forwarded-host') || incoming.host);
  }
  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
  // Club logos and profile photos may be up to 1 MB; every other request stays small.
  const joined = path.join('/');
  const limit = /^officer\/clubs\/[^/]+\/logo$/.test(joined) || joined === 'profile/avatar' ? 1024 * 1024 : 65536;
  if (body && body.byteLength > limit) return Response.json({detail: limit > 65536 ? 'Images can be at most 1 MB' : 'Request body is too large'}, {status: 413});
  try {
    const response = await fetch(target, {method: request.method, headers, body, cache: 'no-store', redirect: 'manual', signal: request.signal});
    const outgoing = new Headers(response.headers);
    // fetch already decoded the body, so its original encoding and length no longer apply.
    for (const name of ['connection', 'transfer-encoding', 'content-encoding', 'content-length']) outgoing.delete(name);
    return new Response(response.body, {status: response.status, headers: outgoing});
  } catch {
    return Response.json({detail: process.env.VERCEL ? 'The API is unavailable right now. Please try again shortly.' : 'The local API is unavailable. Start both servers and try again.'}, {status: 502});
  }
}

export {proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE, proxy as HEAD, proxy as OPTIONS};
