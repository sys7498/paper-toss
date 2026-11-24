import { get, put } from '@vercel/blob';
import { maxImageBytes } from '../dist/letter-image.js';

const idPattern = /^[A-Za-z0-9_-]{22}$/;
const ciphertextPattern = /^[A-Za-z0-9_-]{39,4600}$/;
const maxBinaryBytes = maxImageBytes + 4 + 4096 + 12 + 16;
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
        const binary = request.headers.get('content-type') === 'application/octet-stream';
        const limit = binary ? maxBinaryBytes : 4600;
        if (Number(request.headers.get('content-length')) > limit) return new Response(null, {status: 413, headers});
        const ciphertext = binary ? Buffer.from(await request.arrayBuffer()) : await request.text();
        if (ciphertext.length > limit) return new Response(null, {status: 413, headers});
        if (binary ? ciphertext.length <= 32 : !ciphertextPattern.test(ciphertext)) return new Response(null, {status: 400, headers});

        await put(pathname(id), ciphertext, {
          access: 'private',
          contentType: binary ? 'application/octet-stream' : 'text/plain',
          allowOverwrite: false
        });
        return new Response(null, {status: 201, headers});
      }

      if (request.method === 'GET') {
        const result = await get(pathname(id), {access: 'private'});
        if (!result) return new Response(null, {status: 404, headers});
        const contentType = result.blob.contentType === 'application/octet-stream'
          ? 'application/octet-stream'
          : 'text/plain; charset=utf-8';
        return new Response(result.stream, {headers: {...headers, 'Content-Type': contentType}});
      }

      return new Response(null, {status: 405, headers: {...headers, Allow: 'GET, POST'}});
    } catch (error) {
      console.error('Letter storage request failed:', error.name);
      return new Response(null, {status: 503, headers});
    }
  }
};
