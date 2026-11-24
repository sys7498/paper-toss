import { imageTypes, maxImageBytes } from './letter-image.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const codePattern = /^[A-Za-z0-9_-]{22}$/;
const ivLength = 12;
const maxMetadataBytes = 4096;

function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(code) {
  return Uint8Array.from(atob(code.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));
}

function parseLetter(bytes, imageBytes) {
  const [note, coords, type] = JSON.parse(textDecoder.decode(bytes));
  if (typeof note !== 'string' || (!note.trim() && !imageBytes) || note.length > 400 || !Array.isArray(coords) ||
      coords.length < 4 || coords.length > 144 || coords.length % 2 ||
      !coords.every((n) => Number.isInteger(n) && n >= 0 && n <= 1000)) return null;
  if (imageBytes && (!imageTypes.has(type) || !imageBytes.length || imageBytes.length > maxImageBytes)) return null;

  const points = [];
  for (let i = 0; i < coords.length; i += 2) {
    points.push([
      Math.max(.06, Math.min(.94, coords[i] / 1000)),
      Math.max(.10, Math.min(.90, coords[i + 1] / 1000))
    ]);
  }
  return {note, points, image: imageBytes ? new Blob([imageBytes], {type}) : null};
}

async function letterEndpoint(keyBytes) {
  // Only the hash goes to storage. The encryption key stays in the URL fragment.
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', keyBytes));
  return '/api/letters?id=' + encode(digest.subarray(0, 16));
}

async function packLetter(note, coords, image) {
  if (!image) return textEncoder.encode(JSON.stringify([note, coords]));
  if (!imageTypes.has(image.type) || !image.size || image.size > maxImageBytes) throw new Error('Invalid image');
  const metadata = textEncoder.encode(JSON.stringify([note, coords, image.type]));
  if (metadata.length > maxMetadataBytes) throw new Error('Invalid letter metadata');
  const bytes = new Uint8Array(4 + metadata.length + image.size);
  new DataView(bytes.buffer).setUint32(0, metadata.length);
  bytes.set(metadata, 4);
  bytes.set(new Uint8Array(await image.arrayBuffer()), 4 + metadata.length);
  return bytes;
}

function unpackLetter(buffer) {
  if (buffer.byteLength <= 4) return null;
  const length = new DataView(buffer).getUint32(0);
  if (length > maxMetadataBytes || length >= buffer.byteLength - 4) return null;
  return parseLetter(new Uint8Array(buffer, 4, length), new Uint8Array(buffer, 4 + length));
}

export async function createShareLink(note, points, image) {
  const coords = points.flatMap(([x, y]) => [Math.round(x * 1000), Math.round(y * 1000)]);
  const bytes = await packLetter(note, coords, image);
  const keyBytes = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(ivLength));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, bytes));
  const ciphertext = new Uint8Array(ivLength + encrypted.length);
  ciphertext.set(iv);
  ciphertext.set(encrypted, ivLength);

  const response = await fetch(await letterEndpoint(keyBytes), {
    method: 'POST',
    body: image ? ciphertext : encode(ciphertext),
    headers: image ? {'Content-Type': 'application/octet-stream'} : undefined
  });
  if (!response.ok) throw new Error('Could not save letter');
  return new URL('/#m=' + encode(keyBytes), location.origin).href;
}

export function isLetterLink(hash) {
  return hash.startsWith('#m=') || hash.startsWith('#p=');
}

export async function readShareLink(hash) {
  const code = hash.slice(3);
  if (hash.startsWith('#p=')) {
    if (code.length > 9000) return null;
    try { return parseLetter(decode(code)); } catch { return null; }
  }

  if (!codePattern.test(code)) return null;
  const keyBytes = decode(code);
  if (encode(keyBytes) !== code) return null;

  const response = await fetch(await letterEndpoint(keyBytes), {cache: 'no-store'});
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Could not load letter');
  const hasImage = response.headers.get('Content-Type') === 'application/octet-stream';
  const ciphertext = hasImage ? new Uint8Array(await response.arrayBuffer()) : decode(await response.text());
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  try {
    const bytes = await crypto.subtle.decrypt({name: 'AES-GCM', iv: ciphertext.subarray(0, ivLength)}, key, ciphertext.subarray(ivLength));
    return hasImage ? unpackLetter(bytes) : parseLetter(bytes);
  } catch {
    return null;
  }
}
