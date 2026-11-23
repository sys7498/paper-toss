const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const codePattern = /^[A-Za-z0-9_-]{22}$/;
const ivLength = 12;

function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(code) {
  return Uint8Array.from(atob(code.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));
}

function parseLetter(bytes) {
  const [note, coords] = JSON.parse(textDecoder.decode(bytes));
  if (typeof note !== 'string' || !note.trim() || note.length > 400 || !Array.isArray(coords) ||
      coords.length < 4 || coords.length > 144 || coords.length % 2 ||
      !coords.every((n) => Number.isInteger(n) && n >= 0 && n <= 1000)) return null;

  const points = [];
  for (let i = 0; i < coords.length; i += 2) {
    points.push([
      Math.max(.06, Math.min(.94, coords[i] / 1000)),
      Math.max(.10, Math.min(.90, coords[i + 1] / 1000))
    ]);
  }
  return {note, points};
}

async function letterEndpoint(keyBytes) {
  // Only the hash goes to storage. The encryption key stays in the URL fragment.
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', keyBytes));
  return '/api/letters?id=' + encode(digest.subarray(0, 16));
}

export async function createShareLink(note, points) {
  const coords = points.flatMap(([x, y]) => [Math.round(x * 1000), Math.round(y * 1000)]);
  const bytes = textEncoder.encode(JSON.stringify([note, coords]));
  const keyBytes = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(ivLength));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, bytes));
  const ciphertext = new Uint8Array(ivLength + encrypted.length);
  ciphertext.set(iv);
  ciphertext.set(encrypted, ivLength);

  const response = await fetch(await letterEndpoint(keyBytes), {method: 'POST', body: encode(ciphertext)});
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
  const ciphertext = decode(await response.text());
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  try {
    const bytes = await crypto.subtle.decrypt({name: 'AES-GCM', iv: ciphertext.subarray(0, ivLength)}, key, ciphertext.subarray(ivLength));
    return parseLetter(bytes);
  } catch {
    return null;
  }
}
