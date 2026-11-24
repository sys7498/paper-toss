const typeface = '"Gothic A1", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const graphemes = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('ko', {granularity: 'grapheme'})
  : null;

function breakLines(context, text, maxWidth) {
  const lines = [];
  for (const paragraph of text.split(/\r\n?|\n/)) {
    let line = '';
    for (const word of paragraph.match(/\S+\s*|\s+/gu) || []) {
      if (line && context.measureText(line + word.trimEnd()).width > maxWidth) {
        lines.push(line.trimEnd());
        line = '';
      }
      if (context.measureText(word.trimEnd()).width <= maxWidth) {
        line += word;
        continue;
      }
      const parts = graphemes ? Array.from(graphemes.segment(word), ({segment}) => segment) : Array.from(word);
      for (const letter of parts) {
        if (line && context.measureText(line + letter).width > maxWidth) {
          lines.push(line.trimEnd());
          line = '';
        }
        line += letter;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function loadInkFont() {
  return document.fonts.load('700 52px "Gothic A1"', '쪽지').catch(() => []);
}

function arrangeInk(context, text, hasImage) {
  if (!text.trim()) return [];
  let size = hasImage ? 54 : 64;
  let lines;
  const maxWidth = 790;
  const maxHeight = hasImage ? 275 : 610;
  for (;;) {
    context.font = `700 ${size}px ${typeface}`;
    lines = breakLines(context, text, maxWidth);
    if (lines.length * size * 1.48 <= maxHeight || size === 14) break;
    size -= 2;
  }
  // Reflow unusually tall notes while keeping all their written words.
  if (lines.length * size * 1.48 > maxHeight) {
    lines = lines.filter((line) => line.trim());
    if (lines.length * size * 1.48 > maxHeight) lines = breakLines(context, lines.join(' '), maxWidth);
  }
  const spacing = Math.min(size * 1.48, maxHeight / lines.length);
  const top = hasImage ? 462 : Math.max(110, (800 - lines.length * spacing) * .5);
  return lines.map((line, i) => ({
    line, size, maxWidth, x: 117, y: top + (i + .5) * spacing
  }));
}

export function createInk() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 800;
  const context = canvas.getContext('2d');
  let current;
  let currentHasImage;
  function write(text, refresh = false, hasImage = false) {
    if (text === current && hasImage === currentHasImage && !refresh) return false;
    current = text;
    currentHasImage = hasImage;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const lines = arrangeInk(context, text, hasImage);
    context.textBaseline = 'middle';
    context.fillStyle = '#27231e';
    for (const {line, x, y, size, maxWidth} of lines) {
      context.font = `700 ${size}px ${typeface}`;
      context.fillText(line, x, y, maxWidth);
    }
    return true;
  }
  return {canvas, write};
}

export function createPaperWords(paper) {
  const measure = document.createElement('canvas').getContext('2d');
  let current;
  let currentHasImage;
  return function write(text, refresh = false, hasImage = false) {
    if (text === current && hasImage === currentHasImage && !refresh) return;
    current = text;
    currentHasImage = hasImage;
    const lines = arrangeInk(measure, text, hasImage).map(({line, x, y, size}) => {
      const words = document.createElement('span');
      words.style.left = `${x / 1024 * 100}%`;
      words.style.top = `${y / 800 * 100}%`;
      words.style.fontSize = `calc(var(--ink-unit) * ${size})`;
      words.textContent = line;
      return words;
    });
    paper.replaceChildren(...lines);
  };
}
