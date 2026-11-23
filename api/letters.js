import { get, put } from '@vercel/blob';

const idPattern = /^[A-Za-z0-9_-]{22}$/;
const ciphertextPattern = /^[A-Za-z0-9_-]{39,4600}$/;
const headers = { 'Cache-Control': 'no-store' };
const pathname = (id) => `letters/${id}.txt`;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id || !idPattern.test(id)) return new Response(null, {status: 400, headers});

    try {
      if (request.method === 'POST') {
        const origin = request.headers.get('origin');
        if (origin && origin !== url.origin) return new Response(null, {status: 403, headers});
        if (Number(request.headers.get('content-length')) > 4600) return new Response(null, {status: 413, headers});
        const ciphertext = await request.text();
        if (!ciphertextPattern.test(ciphertext)) return new Response(null, {status: 400, headers});

        await put(pathname(id), ciphertext, {
          access: 'private',
          contentType: 'text/plain',
          allowOverwrite: false
        });
        return new Response(null, {status: 201, headers});
      }

      if (request.method === 'GET') {
        const result = await get(pathname(id), {access: 'private'});
        if (!result) return new Response(null, {status: 404, headers});
        return new Response(result.stream, {headers: {...headers, 'Content-Type': 'text/plain; charset=utf-8'}});
      }

      return new Response(null, {status: 405, headers: {...headers, Allow: 'GET, POST'}});
    } catch (error) {
      console.error('Letter storage request failed:', error.name);
      return new Response(null, {status: 503, headers});
    }
  }
};
