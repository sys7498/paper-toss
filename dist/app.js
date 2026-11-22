import { createPaper, focalRatio, nearPlane, restRotation } from './paper.js';
import { createFlight, smoothPath } from './flight.js';
import { createPaperWords, loadInkFont } from './ink.js';
import { openSurface } from './paper-surface.js';
import { createWritingWind } from './writing-wind.js';

const el = (id) => document.getElementById(id);
const studio = document.querySelector('.studio');
const main = document.querySelector('main');
const messageInput = el('message');
const coarsePointer = matchMedia('(pointer: coarse)');
const guide = el('guide');
const canvas = el('paper');
const paper = createPaper(canvas);
const writingPaper = el('writing-paper');
const paperPosition = el('paper-position');
const paperInk = el('paper-ink');
const writeWords = createPaperWords(paperInk);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const setWindSize = createWritingWind(el('paper-surface'), reducedMotion);
const near = [.5, .47];
const flatRotation = openSurface.rotation;
const defaultPath = [near, [.52, .32], [.57, .23], [.70, .22], [.82, .30], [.89, .45], [.91, .58]];
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
let path = defaultPath;
let message = '';
let mode = '';
let generation = 0;
let previewing = false;
let pointer = null;
let draftPath = null;
let pose;
let inkText = '';

function positionWords() {
  const showWords = pose?.folded === 0 && Boolean(inkText.trim());
  paperInk.hidden = !showWords;
  if (!showWords) return;
  const unit = Math.min(studio.clientWidth, studio.clientHeight) * focalRatio / nearPlane;
  paperInk.style.width = `${3.22 * unit}px`;
  paperInk.style.height = `${2.51 * unit}px`;
  paperInk.style.setProperty('--ink-unit', `${3.22 * unit / 1024}px`);
  const [x, y, z] = flatRotation;
  paperInk.style.transform = `translate(-50%, -50%) perspective(${nearPlane * unit}px) rotateX(${-x}rad) rotateY(${y}rad) rotateZ(${-z}rad)`;
}

function paint(next = pose) {
  pose = next;
  positionWords();
  const onFlatSheet = next.folded === 0;
  const writing = mode === 'compose' && onFlatSheet;
  writingPaper.hidden = !writing;
  canvas.style.visibility = writing ? 'hidden' : '';
  if (onFlatSheet) {
    const size = openSurface.span * Math.min(studio.clientWidth, studio.clientHeight) * focalRatio / nearPlane;
    paperPosition.style.width = `${size}px`;
    paperPosition.style.left = `${next.x * 100}%`;
    paperPosition.style.top = `${next.y * 100}%`;
    setWindSize(writing ? size : 0);
  } else {
    setWindSize(0);
  }
  if (!writing) paper.draw({...next, suppressInk: onFlatSheet});
}

new ResizeObserver(() => {
  paper.resize();
  if (pose) paint();
}).observe(studio);
paper.resize();

function setWords(text, refresh = false) {
  inkText = text;
  writeWords(text, refresh);
  positionWords();
}

function setInk(text) {
  setWords(text);
  paper.write(text);
}
loadInkFont().then(() => {
  if (!inkText) return;
  setWords(inkText, true);
  if (mode !== 'compose' || pose?.folded !== 0) paper.write(inkText, true);
});

function showGuide(points, visible) {
  guide.toggleAttribute('hidden', !visible);
  if (!visible) return;
  guide.querySelector('path').setAttribute('d', smoothPath(points).map(([x, y], i) => `${i ? 'L' : 'M'}${x * 1000} ${y * 1000}`).join(' '));
}

const panels = {
  compose: 'compose', editor: 'editor', link: 'link-panel',
  arrived: 'catch'
};
const announcements = { waiting: '종이 도착 대기 중', arrived: '종이 도착', opened: '메시지 펼침' };

// On mobile the keyboard can shrink only the visual viewport.
function fitWritingViewport() {
  const viewport = window.visualViewport;
  const keyboard = mode === 'compose' && coarsePointer.matches &&
    document.activeElement === messageInput && viewport && viewport.scale < 1.05 &&
    window.innerHeight - viewport.height > 110;
  main.toggleAttribute('data-keyboard', Boolean(keyboard));
  if (keyboard) main.style.setProperty('--writing-height', `${Math.round(viewport.height)}px`);
  else main.style.removeProperty('--writing-height');
}
window.visualViewport?.addEventListener('resize', fitWritingViewport);
messageInput.addEventListener('focus', fitWritingViewport);
messageInput.addEventListener('blur', fitWritingViewport);

function screen(next) {
  mode = next;
  main.dataset.mode = next;
  fitWritingViewport();
  for (const id of ['compose', 'editor', 'link-panel', 'catch', 'reply']) {
    el(id).hidden = panels[next] !== id && !(next === 'opened' && id === 'reply');
  }
  studio.dataset.draw = String(next === 'editor');
  el('status').textContent = '';
  el('announcement').textContent = announcements[next] || '';
  paperInk.setAttribute('aria-hidden', String(next !== 'opened'));
  showGuide(path, next === 'editor');
}

function animate(duration, step) {
  const current = ++generation;
  const start = performance.now();
  const length = reducedMotion.matches ? Math.min(120, duration) : duration;
  paper.begin();
  return new Promise((resolve) => {
    function frame(now) {
      if (current !== generation) {
        paper.end(true);
        resolve(false);
        return;
      }
      const t = clamp((now - start) / length, 0, 1);
      if (t === 1) paper.end();
      step(t);
      if (t < 1) requestAnimationFrame(frame);
      else resolve(true);
    }
    requestAnimationFrame(frame);
  });
}

function at(point, options = {}) {
  paint({ x: point[0], y: point[1], ...options });
}

function startCompose() {
  generation++;
  previewing = false;
  pointer = null;
  draftPath = null;
  screen('compose');
  setWords(el('message').value);
  at(near, {folded: 0, rotation: flatRotation, creased: true});
}

function uniform(points, samples = 72) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  let j = 1;
  return Array.from({ length: samples }, (_, i) => {
    const distance = lengths.at(-1) * i / (samples - 1);
    while (j < points.length - 1 && lengths[j] < distance) j++;
    const ratio = (distance - lengths[j - 1]) / (lengths[j] - lengths[j - 1] || 1);
    return points[j - 1].map((value, axis) => value + (points[j][axis] - value) * ratio);
  });
}

function flight(receiving) {
  const {width, height} = studio.getBoundingClientRect();
  const track = createFlight(path, width, height);
  const windup = !receiving && !reducedMotion.matches ? 150 : 0;
  const settle = receiving && !reducedMotion.matches ? 160 : 0;
  const arrivalTime = windup + track.duration;
  const duration = arrivalTime + settle;
  const start = pose;
  const aim = track.pose(.05, false);
  const launchDistance = Math.hypot(aim.x - start.x, aim.y - start.y) || 1;
  const landing = track.pose(1, true);

  return animate(duration, (t) => {
    const elapsed = t * duration;
    if (elapsed < windup) {
      const amount = Math.sin(Math.PI * elapsed / windup) * .032;
      paint({
        ...start, creased: false,
        x: start.x - (aim.x - start.x) / launchDistance * amount,
        y: start.y - (aim.y - start.y) / launchDistance * amount,
        depth: -amount, rotation: start.rotation.map((angle, axis) => angle + amount * [6, -4, 4][axis])
      });
    } else if (elapsed < arrivalTime || !settle) {
      paint(track.pose(clamp((elapsed - windup) / track.duration, 0, 1), receiving));
    } else {
      const time = (elapsed - arrivalTime) / settle;
      const swing = Math.sin(time * Math.PI) * (1 - time);
      paint({
        ...landing, depth: -swing * .046,
        rotation: restRotation.map((angle, axis) => angle + swing * [.28, .38, .32][axis])
      });
    }
  });
}

function updateMessage() {
  const text = el('message').value;
  el('message').setCustomValidity('');
  if (mode === 'compose') setWords(text);
}
el('message').addEventListener('input', updateMessage);
el('message').addEventListener('compositionend', updateMessage);
el('compose').addEventListener('submit', async (event) => {
  event.preventDefault();
  message = el('message').value.trim();
  if (!message) {
    el('message').setCustomValidity('메시지를 입력해 주세요.');
    el('message').reportValidity();
    return;
  }
  const button = event.submitter;
  const input = el('message');
  button.disabled = input.readOnly = true;
  setInk(message);
  showGuide(path, false);
  const finished = await animate(790, (t) => {
    const eased = t * t * (3 - 2 * t);
    at(near, {
      folded: eased,
      creased: true,
      rotation: restRotation.map((angle, axis) => flatRotation[axis] + (angle - flatRotation[axis]) * eased)
    });
  });
  button.disabled = input.readOnly = false;
  if (!finished) return;
  screen('editor');
});

function drawPoint(event, bounds) {
  const point = [
    clamp((event.clientX - bounds.left) / bounds.width, .06, .94),
    clamp((event.clientY - bounds.top) / bounds.height, .1, .90)
  ];
  const last = draftPath.at(-1);
  if (Math.hypot(point[0] - last[0], point[1] - last[1]) > .007) draftPath.push(point);
}
function drawPointer(event) {
  const bounds = studio.getBoundingClientRect();
  const samples = event.getCoalescedEvents?.();
  for (const sample of samples?.length ? samples : [event]) drawPoint(sample, bounds);
  showGuide(draftPath, true);
}
studio.addEventListener('pointerdown', (event) => {
  if (mode !== 'editor' || previewing || pointer !== null || event.button !== 0 || event.isPrimary === false) return;
  pointer = event.pointerId;
  studio.setPointerCapture(pointer);
  draftPath = [near];
  drawPointer(event);
});
studio.addEventListener('pointermove', (event) => {
  if (event.pointerId === pointer) drawPointer(event);
});
studio.addEventListener('pointerup', (event) => {
  if (event.pointerId !== pointer) return;
  drawPointer(event);
  if (draftPath.length > 1) path = uniform(draftPath, 48).map((point) => point.map((value) => Math.round(value * 1000) / 1000));
  pointer = null;
  draftPath = null;
  showGuide(path, true);
});
function cancelDrawing(event) {
  if (event.pointerId !== pointer) return;
  pointer = null;
  draftPath = null;
  showGuide(path, true);
}
studio.addEventListener('pointercancel', cancelDrawing);
studio.addEventListener('lostpointercapture', cancelDrawing);
el('reset').onclick = () => {
  if (previewing) return;
  path = defaultPath;
  showGuide(path, true);
};
el('preview').onclick = async () => {
  if (previewing || pointer !== null) return;
  previewing = true;
  showGuide(path, false);
  if (!await flight(true)) return;
  previewing = false;
  screen('editor');
};

function shareURL() {
  const packed = path.flatMap(([x, y]) => [Math.round(x * 1000), Math.round(y * 1000)]);
  const data = new TextEncoder().encode(JSON.stringify([message, packed]));
  const encoded = btoa(String.fromCharCode(...data)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const url = new URL(location.href);
  url.hash = 'p=' + encoded;
  url.search = '';
  return url.href;
}

function readLink() {
  if (!location.hash.startsWith('#p=')) return null;
  try {
    const encoded = location.hash.slice(3);
    if (encoded.length > 9000) return null;
    const data = Uint8Array.from(atob(encoded.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
    const [note, coords] = JSON.parse(new TextDecoder().decode(data));
    if (typeof note !== 'string' || !note.trim() || note.length > 400 || !Array.isArray(coords) ||
        coords.length < 4 || coords.length > 144 || coords.length % 2 ||
        !coords.every((n) => Number.isInteger(n) && n >= 0 && n <= 1000)) return null;
    const points = [];
    for (let i = 0; i < coords.length; i += 2) points.push([clamp(coords[i] / 1000, .06, .94), clamp(coords[i + 1] / 1000, .1, .9)]);
    return { note, points };
  } catch {
    return null;
  }
}

el('share').onclick = async () => {
  if (previewing || pointer !== null) return;
  previewing = true;
  showGuide(path, false);
  el('announcement').textContent = '종이 던지는 중';
  if (!await flight(false)) return;
  previewing = false;
  el('link').value = shareURL();
  screen('link');
  el('copy').focus();
};
const canShare = typeof window.navigator.share === 'function';
if (canShare) el('copy').textContent = '링크 공유';
el('copy').onclick = async () => {
  const url = el('link').value;
  if (canShare) {
    try {
      await window.navigator.share({url});
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  try {
    await window.navigator.clipboard.writeText(url);
    el('status').textContent = '링크를 복사했어요.';
  } catch {
    el('link').focus();
    el('link').select();
    el('status').textContent = '선택된 링크를 복사해 주세요.';
  }
};
el('back').onclick = () => {
  screen('editor');
  at(path[0], { rotation: restRotation });
};
el('edit').onclick = startCompose;
el('reply').onclick = () => {
  history.replaceState(null, '', location.pathname + location.search);
  path = defaultPath;
  message = '';
  startCompose();
  el('message').focus();
};
function openPaper() {
  if (mode !== 'arrived' || el('catch').hidden) return;
  el('catch').hidden = true;
  const [x, y] = path[0];
  studio.dataset.opening = 'true';
  setInk(message);
  animate(850, (t) => {
    const eased = t * t * (3 - 2 * t);
    at([x + (.5 - x) * eased, y + (.48 - y) * eased], {
      folded: 1 - eased,
      creased: true,
      rotation: restRotation.map((angle, axis) => angle + (flatRotation[axis] - angle) * eased)
    });
  }).then((finished) => {
    if (!finished) return;
    delete studio.dataset.opening;
    screen('opened');
    paperInk.focus({preventScroll: true});
  });
}
el('catch').onclick = openPaper;

function waitForFlight() {
  const current = generation;
  const {width, height} = studio.getBoundingClientRect();
  paint(createFlight(path, width, height).pose(0, true));
  return new Promise((resolve) => {
    let frame, timer;
    function schedule() {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      if (current !== generation) {
        document.removeEventListener('visibilitychange', schedule);
        resolve(false);
        return;
      }
      if (document.hidden) return;
      // Start after the waiting scene has had a chance to paint on screen.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          timer = setTimeout(() => {
            if (document.hidden) return;
            document.removeEventListener('visibilitychange', schedule);
            resolve(current === generation);
          }, 3000);
        });
      });
    }
    document.addEventListener('visibilitychange', schedule);
    schedule();
  });
}

async function receive() {
  screen('waiting');
  if (!await waitForFlight()) return;
  el('announcement').textContent = '종이가 날아오는 중';
  if (!await flight(true)) return;
  studio.style.setProperty('--arrival-x', `${pose.x * 100}%`);
  studio.style.setProperty('--arrival-y', `${pose.y * 100}%`);
  screen('arrived');
}

function loadLocation() {
  const incoming = readLink();
  if (incoming) {
    generation++;
    previewing = false;
    pointer = null;
    draftPath = null;
    delete studio.dataset.opening;
    setInk('');
    message = incoming.note;
    path = incoming.points;
    receive();
    return;
  }
  message = '';
  path = defaultPath;
  delete studio.dataset.opening;
  startCompose();
  if (location.hash.startsWith('#p=')) el('status').textContent = '메시지 링크가 손상되었어요.';
}

window.addEventListener('hashchange', loadLocation);
loadLocation();
