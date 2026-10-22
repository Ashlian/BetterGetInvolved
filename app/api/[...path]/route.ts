/** Same-origin gateway. Resolve API_URL at request time, including in containers. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function proxy(request: Request, {params}: {params: Promise<{path: string[]}>}) {
  const {path} = await params;
  const target = new URL(`/api/${path.map(encodeURIComponent).join('/')}`, process.env.API_URL || 'http://127.0.0.1:8000');
  target.search = new URL(request.url).search;
  const headers = new Headers(request.headers);
  for (const name of ['host', 'connection', 'content-length', 'transfer-encoding']) headers.delete(name);
  headers.set('accept-encoding', 'identity');
  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
  if (body && body.byteLength > 65536) return Response.json({detail: 'Request body is too large'}, {status: 413});
  try {
    const response = await fetch(target, {method: request.method, headers, body, cache: 'no-store', redirect: 'manual', signal: request.signal});
    const outgoing = new Headers(response.headers);
    for (const name of ['connection', 'transfer-encoding']) outgoing.delete(name);
    return new Response(response.body, {status: response.status, headers: outgoing});
  } catch {
    return Response.json({detail: 'The local API is unavailable. Start both servers and try again.'}, {status: 502});
  }
}

export {proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE, proxy as HEAD, proxy as OPTIONS};
