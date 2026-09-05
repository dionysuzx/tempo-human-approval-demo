import { ORIGIN } from './proof.mjs';
import { nativeRequests } from './requests.mjs';
const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
async function readJSON(request) {
  if (
    !request.headers
      .get('Content-Type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    throw Error('JSON required');
  if (!request.body) throw Error('Body required');
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 400000) {
      await reader.cancel();
      throw Error('Request too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
export async function handleNative(request, store = nativeRequests) {
  try {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (
      url.origin !== ORIGIN ||
      request.headers.get('Host') !== 'localhost:8787' ||
      (origin && origin !== ORIGIN)
    )
      return new Response(JSON.stringify({ error: 'Local origin required' }), {
        status: 403,
        headers,
      });
    const path = url.pathname.split('/').filter(Boolean);
    let result;
    if (request.method === 'POST' && url.pathname === '/native/request') {
      if (origin !== ORIGIN) throw Error('Browser origin required');
      const body = await readJSON(request);
      result = store.create(body.message);
    } else if (
      request.method === 'GET' &&
      path.length === 3 &&
      path[1] === 'request'
    ) {
      result = store.claim(path[2]);
    } else if (
      request.method === 'POST' &&
      url.pathname === '/native/complete'
    ) {
      result = await store.complete(await readJSON(request));
    } else if (
      request.method === 'GET' &&
      path.length === 3 &&
      path[1] === 'result'
    ) {
      result = store.result(path[2], request.headers.get('X-Result-Token'));
    } else {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers,
      });
    }
    return new Response(JSON.stringify(result), { headers });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Native request failed',
      }),
      { status: 400, headers },
    );
  }
}
