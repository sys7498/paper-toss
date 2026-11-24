export const maxImageBytes = 4_000_000;
export const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

async function imageType(file) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const signature = String.fromCharCode(...bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (signature.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png';
  if (signature.startsWith('GIF87a') || signature.startsWith('GIF89a')) return 'image/gif';
  if (signature.startsWith('RIFF') && signature.slice(8, 12) === 'WEBP') return 'image/webp';
  if (signature.slice(4, 8) === 'ftyp') {
    const brand = signature.slice(8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1'].includes(brand)) return 'image/heic';
  }
  throw new Error('JPG, PNG, WebP, AVIF 또는 GIF 사진을 골라 주세요.');
}

export async function prepareImage(file) {
  const type = await imageType(file);
  if (type === 'image/gif' && file.size > maxImageBytes) {
    throw new Error('GIF는 4MB까지 넣을 수 있어요.');
  }
  const blob = file.slice(0, file.size, type);
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    image.src = url;
    try { await image.decode(); } catch { throw new Error('이 사진을 열 수 없어요. JPG, PNG 또는 GIF를 골라 주세요.'); }
    if (type !== 'image/heic' && file.size <= maxImageBytes) return blob;

    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const resized = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', .86));
    if (!resized || resized.size > maxImageBytes) throw new Error('이 사진을 첨부할 수 없어요. 더 작은 사진을 골라 주세요.');
    return resized;
  } finally {
    URL.revokeObjectURL(url);
  }
}
