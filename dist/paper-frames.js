import * as THREE from './vendor/three.js';
import layout from './frames/layout.js';
import { openSurface } from './paper-surface.js';

const vertexShader = `
  uniform vec2 center;
  uniform vec2 scale;
  uniform float roll;
  varying vec2 frameUv;
  void main() {
    float c = cos(roll), s = sin(roll);
    vec2 rotated = mat2(c, s, -s, c) * position.xy;
    gl_Position = vec4(center + rotated * scale, 0.0, 1.0);
    frameUv = uv;
  }
`;

const fragmentShader = `
  uniform sampler2D beauty;
  uniform sampler2D coordinates;
  uniform sampler2D ink;
  uniform vec4 tile;
  uniform vec4 nextTile;
  uniform float frameBlend;
  uniform float turnPerFrame;
  uniform bool hasInk;
  varying vec2 frameUv;
  void main() {
    vec2 at = tile.xy + frameUv * tile.zw;
    vec4 paper = texture2D(beauty, at);
    if (hasInk && paper.a > 0.05) {
      vec3 mapping = texture2D(coordinates, at).rgb;
      if (mapping.b > 0.48) {
        vec4 pen = texture2D(ink, mapping.rg / mapping.b);
        paper.rgb *= mix(vec3(1.0), pen.rgb, pen.a * smoothstep(0.48, 0.94, mapping.b));
      }
    }
    if (frameBlend > 0.0) {
      float c = cos(turnPerFrame), s = sin(turnPerFrame);
      vec2 nextUv = mat2(c, -s, s, c) * (frameUv - 0.5) + 0.5;
      vec4 nextPaper = vec4(0.0);
      if (all(greaterThanEqual(nextUv, vec2(0.0))) && all(lessThanEqual(nextUv, vec2(1.0)))) {
        nextPaper = texture2D(beauty, nextTile.xy + nextUv * nextTile.zw);
      }
      float alpha = mix(paper.a, nextPaper.a, frameBlend);
      vec3 color = mix(paper.rgb * paper.a, nextPaper.rgb * nextPaper.a, frameBlend);
      paper = vec4(color / max(alpha, 0.0001), alpha);
    }
    gl_FragColor = paper;
    #include <colorspace_fragment>
  }
`;

function texture(loader, filename, colorSpace) {
  return loader.loadAsync(new URL(`./frames/${filename}`, import.meta.url).href).then((asset) => {
    asset.colorSpace = colorSpace;
    const isPhoto = colorSpace === THREE.SRGBColorSpace;
    asset.generateMipmaps = isPhoto;
    asset.minFilter = isPhoto ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    return asset;
  });
}

export function createPaperFrames(renderer, ink, ready) {
  const uniform = (value) => ({value});
  const uniforms = {
    center: uniform(new THREE.Vector2()),
    scale: uniform(new THREE.Vector2()),
    roll: uniform(0),
    tile: uniform(new THREE.Vector4()),
    nextTile: uniform(new THREE.Vector4()),
    frameBlend: uniform(0),
    turnPerFrame: uniform(0),
    beauty: uniform(null),
    coordinates: uniform(null),
    ink: uniform(ink),
    hasInk: uniform(false)
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader, transparent: true, depthTest: false, toneMapped: false
  });
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  frame.frustumCulled = false;
  scene.add(frame);

  const loader = new THREE.TextureLoader();
  const frames = loadSheets(
    (filename, color) => texture(loader, filename, color ? THREE.SRGBColorSpace : THREE.NoColorSpace),
    (sheet) => {
      if (sheet.count === 1) renderer.initTexture(sheet.beauty);
      ready();
    }
  );
  let activeAtlas;

  function draw({x, y, folded, spin, orbitRoll, distance, focal, width, height, hasInk, creased, animated}) {
    const frame = frames.select({folded, spin, orbitRoll, creased, animated});
    if (!frame) return false;
    const {columns, rows, col, row, span, roll, beauty, coordinates} = frame;
    // Keep stills ready for the final frame. Only replace an atlas when another
    // animation needs a different one.
    if (frame.count > 1 && activeAtlas?.name !== frame.name) {
      if (activeAtlas) {
        for (const asset of [activeAtlas.beauty, activeAtlas.coordinates]) {
          if (!asset) continue;
          asset.dispose();
          asset.needsUpdate = true;
        }
      }
      activeAtlas = frame;
    }
    const size = span * focal / distance;
    uniforms.center.value.set(x * 2 - 1, 1 - y * 2);
    uniforms.scale.value.set(size * 2 / width, size * 2 / height);
    uniforms.roll.value = roll;
    uniforms.tile.value.set(col / columns, 1 - (row + 1) / rows, 1 / columns, 1 / rows);
    if (frame.blend > 0) {
      uniforms.nextTile.value.set(frame.nextCol / columns, 1 - (frame.nextRow + 1) / rows, 1 / columns, 1 / rows);
    }
    uniforms.frameBlend.value = frame.blend;
    uniforms.turnPerFrame.value = frame.turnPerFrame;
    uniforms.beauty.value = beauty;
    uniforms.coordinates.value = coordinates;
    uniforms.hasInk.value = hasInk && Boolean(coordinates);
    renderer.render(scene, camera);
    return true;
  }

  return {draw, begin: frames.begin};
}

function loadSheets(load, ready) {
  const loaded = {};
  let selected = {};
  for (const [name, sheet] of Object.entries(layout)) {
    const beautyFile = load(`${name}.webp`, true);
    const mapFile = sheet.ink ? load(`${name}-uv.png`, false) : null;
    Promise.all([beautyFile, mapFile]).then(([beauty, coordinates]) => {
      loaded[name] = {...sheet, beauty, coordinates};
      ready(loaded[name]);
    }).catch(() => {
      // The live 3D renderer remains available when frames cannot be loaded.
    });
  }
  function select({folded, spin, orbitRoll, creased, animated}) {
    const available = animated ? selected : loaded;
    const spinning = folded === 1 && !creased;
    const still = folded === 0 ? 'flat' : folded === 1 && spin === 0 ? 'rest' : null;
    const name = !animated && still && available[still] ? still : spinning ? 'spin' : 'open';
    const sheet = available[name];
    if (!sheet) return null;
    const time = name === 'spin' ? (spin + 1) / 2 : folded;
    const frameNumber = THREE.MathUtils.clamp(time, 0, 1) * (sheet.count - 1);
    const index = name === 'spin' ? Math.floor(frameNumber) : Math.round(frameNumber);
    const next = Math.min(index + 1, sheet.count - 1);
    const phase = sheet.count > 1 ? index / (sheet.count - 1) : 0;
    const flatRoll = openSurface.rotation[2];
    const canonicalRoll = {
      spin: .15 - 2.3 * (2 * phase - 1),
      open: flatRoll + (.15 - flatRoll) * phase,
      flat: flatRoll,
      rest: .15
    }[name];
    return {
      ...sheet, name, index, roll: orbitRoll - canonicalRoll,
      col: index % sheet.columns, row: Math.floor(index / sheet.columns),
      nextCol: next % sheet.columns, nextRow: Math.floor(next / sheet.columns),
      blend: name === 'spin' ? frameNumber - index : 0,
      turnPerFrame: name === 'spin' ? 4.6 / (sheet.count - 1) : 0
    };
  }
  function begin() {
    // Keep each animation on the same renderer when an asset finishes downloading.
    selected = {...loaded};
  }
  return {select, begin};
}

function image(filename) {
  return new Promise((resolve, reject) => {
    const asset = new Image();
    asset.crossOrigin = 'anonymous';
    asset.onload = () => resolve(asset);
    asset.onerror = reject;
    asset.src = new URL(`./frames/${filename}`, import.meta.url).href;
  });
}

export function createCanvasPaperFrames(context, ink, ready) {
  const frames = loadSheets(image, ready);
  const composite = document.createElement('canvas');
  const buffer = composite.getContext('2d', {willReadFrequently: true});
  let inkPixels, cached;

  function invalidateInk() {
    inkPixels = null;
    cached = null;
  }

  function withInk(frame, size) {
    const {beauty, coordinates, name, index, col, row} = frame;
    if (cached?.name === name && cached.index === index) return composite;
    inkPixels ||= ink.getContext('2d').getImageData(0, 0, ink.width, ink.height).data;
    if (composite.width !== size || composite.height !== size) composite.width = composite.height = size;
    buffer.drawImage(coordinates, col * size, row * size, size, size, 0, 0, size, size);
    const map = buffer.getImageData(0, 0, size, size).data;
    buffer.clearRect(0, 0, size, size);
    buffer.drawImage(beauty, col * size, row * size, size, size, 0, 0, size, size);
    const paper = buffer.getImageData(0, 0, size, size);
    for (let i = 0; i < map.length; i += 4) {
      if (!map[i + 2] || !paper.data[i + 3]) continue;
      const x = Math.round(map[i] * (ink.width - 1) / 255);
      const y = Math.round((255 - map[i + 1]) * (ink.height - 1) / 255);
      const at = (y * ink.width + x) * 4;
      const alpha = inkPixels[at + 3] / 255;
      if (alpha === 0) continue;
      for (let channel = 0; channel < 3; channel++) {
        paper.data[i + channel] *= 1 - alpha * (1 - inkPixels[at + channel] / 255);
      }
    }
    buffer.putImageData(paper, 0, 0);
    cached = {name, index};
    return composite;
  }

  function draw(options) {
    const frame = frames.select(options);
    if (!frame) return false;
    const {beauty, col, row, columns, span, roll} = frame;
    const {x, y, width, height, distance, focal, opacity} = options;
    const hasInk = options.hasInk && Boolean(frame.coordinates);
    const size = beauty.width / columns;
    const projected = span * focal / distance;
    context.save();
    context.globalAlpha = opacity * (1 - frame.blend);
    context.translate(x * width, y * height);
    context.rotate(-roll);
    const asset = hasInk ? withInk(frame, size) : beauty;
    const sx = hasInk ? 0 : col * size, sy = hasInk ? 0 : row * size;
    context.drawImage(asset, sx, sy, size, size, -projected / 2, -projected / 2, projected, projected);
    if (frame.blend > 0) {
      context.globalCompositeOperation = 'lighter';
      context.globalAlpha = opacity * frame.blend;
      context.rotate(-frame.turnPerFrame);
      context.drawImage(beauty, frame.nextCol * size, frame.nextRow * size, size, size,
        -projected / 2, -projected / 2, projected, projected);
    }
    context.restore();
    return true;
  }
  return {draw, begin: frames.begin, invalidateInk};
}
