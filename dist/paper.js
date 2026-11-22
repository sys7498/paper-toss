import * as THREE from './vendor/three.js';
import { columns, rows, stages } from './paper-shape.js';
import { createInk } from './ink.js';
import { createPaperFrames, createCanvasPaperFrames } from './paper-frames.js';
import { openSurface } from './paper-surface.js';

export const nearPlane = 4.25;
export const depthRange = 13.75;
export const focalRatio = 1.10;
export const restRotation = [-.23, -.38, .15];

const points = columns * rows;
const faces = [];
const uv = new Float32Array(points * 2);
for (let y = 0; y < rows; y++) {
  for (let x = 0; x < columns; x++) {
    const a = y * columns + x;
    uv.set([x / (columns - 1), y / (rows - 1)], a * 2);
    if (x === columns - 1 || y === rows - 1) continue;
    const b = a + 1, c = a + columns, d = c + 1;
    if ((x + y) % 2) faces.push(a, b, c, b, d, c);
    else faces.push(a, b, d, a, d, c);
  }
}

const openedCreases = Array.from({length: points}, (_, index) => {
  const u = uv[index * 2] * 2 - 1, v = uv[index * 2 + 1] * 2 - 1;
  let height = .039 * Math.tanh((.82 * u + .51 * v + .1) / .092);
  for (const [x, y, width, rise] of openSurface.corners) {
    height += rise * Math.exp(-((u - x) ** 2 + (v - y) ** 2) / width ** 2);
  }
  for (const [x, y, angle, length, width, rise, curve] of openSurface.creases) {
    const dx = u - x, dy = v - y;
    const along = dx * Math.cos(angle) + dy * Math.sin(angle);
    const across = -dx * Math.sin(angle) + dy * Math.cos(angle) + curve * along ** 2;
    const peak = Math.exp(-((across / width) ** 2));
    const trough = Math.exp(-(((across - width) / (width * 1.4)) ** 2));
    height += rise * (peak - .42 * trough) * Math.exp(-((along / length) ** 4));
  }
  return height - stages[0][index * 3 + 2] / 8192;
});

function updateShape(positions, folded, creased) {
  const frame = THREE.MathUtils.clamp(folded, 0, 1) * (stages.length - 1);
  const first = stages[Math.floor(frame)], second = stages[Math.ceil(frame)];
  const mix = frame % 1;
  for (let i = 0; i < positions.length; i++) {
    positions[i] = (first[i] + (second[i] - first[i]) * mix) / 8192;
  }
  if (creased) {
    const strength = (1 - folded) ** 3;
    for (let i = 0; i < points; i++) positions[i * 3 + 2] += openedCreases[i] * strength;
  }
}

function fiberTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const noise = ctx.createImageData(256, 256);
  let state = 423817;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = 0; i < noise.data.length; i += 4) {
    const value = 196 + random() * 51;
    noise.data.set([value, value, value, 255], i);
  }
  ctx.putImageData(noise, 0, 0);
  for (let i = 0; i < 1600; i++) {
    const x = random() * 256, y = random() * 256;
    ctx.strokeStyle = random() > .5 ? '#ffffff55' : '#453a201f';
    ctx.lineWidth = .5 + random() * .55;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (random() - .5) * 11, y + (random() - .5) * 8);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 2);
  return texture;
}

export function createPaper(canvas) {
  const context = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!context) return createCanvasPaper(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true });
  renderer.setClearColor(0, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, .1, 30);
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(points * 3);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(faces);
  const ink = createInk();
  const inkMap = new THREE.CanvasTexture(ink.canvas);
  inkMap.colorSpace = THREE.SRGBColorSpace;
  inkMap.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  let currentPose;
  let hasInk = false;
  let motionCount = 0;
  const frames = createPaperFrames(renderer, () => {
    if (currentPose && !motionCount) draw(currentPose);
  });
  const material = new THREE.MeshStandardMaterial({
    color: 0xf0eadb, side: THREE.DoubleSide, roughness: .91,
    map: inkMap, bumpMap: fiberTexture(), bumpScale: .007
  });
  // Ink belongs to the front surface and shares the folds' lighting and shadows.
  const inkVisible = {value: true};
  material.onBeforeCompile = (shader) => {
    shader.uniforms.inkVisible = inkVisible;
    shader.fragmentShader = 'uniform bool inkVisible;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      if (gl_FrontFacing && inkVisible) {
        vec4 inkSample = texture2D(map, vMapUv);
        diffuseColor.rgb *= mix(vec3(1.0), inkSample.rgb, inkSample.a);
      }
    `);
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
  scene.add(new THREE.HemisphereLight(0xe9f0ff, 0x8b7963, .64));

  const keyDirection = new THREE.Vector3(-4, 5.5, 6);
  const key = new THREE.DirectionalLight(0xfff1d6, 2.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, {left: -2.2, right: 2.2, top: 2.2, bottom: -2.2, near: 4, far: 13});
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.normalBias = .018;
  key.shadow.bias = -.0004;
  const rimDirection = new THREE.Vector3(3, 1, -4);
  const rim = new THREE.DirectionalLight(0xd5e0fd, .7);
  scene.add(key, key.target, rim, rim.target);

  let width, height, focal, lastFold, lastCreased;
  function resize() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    if (!height || !width) return;
    focal = Math.min(width, height) * focalRatio;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(height / (2 * focal)));
    camera.updateProjectionMatrix();
  }
  function draw(pose) {
    currentPose = pose;
    const {x, y, depth = 0, folded = 1, rotation = restRotation, opacity = 1, creased = false, spin = 0, suppressInk = false} = pose;
    if (!focal) return;
    canvas.style.opacity = String(opacity);
    if (opacity === 0) return;
    const distance = nearPlane + depth * depthRange;
    const drawInk = hasInk && !suppressInk;
    if (frames.draw({x, y, folded, spin, orbitRoll: rotation[2], distance, focal, width, height, hasInk: drawInk, creased, animated: motionCount > 0})) return;
    if (folded !== lastFold || creased !== lastCreased) {
      updateShape(positions, folded, creased);
      lastCreased = creased;
      geometry.attributes.position.needsUpdate = true;
      geometry.computeVertexNormals();
      lastFold = folded;
    }
    inkVisible.value = drawInk;
    mesh.position.set((x - .5) * width * distance / focal, (.5 - y) * height * distance / focal, -distance);
    mesh.rotation.set(...rotation);
    key.position.copy(mesh.position).add(keyDirection);
    key.target.position.copy(mesh.position);
    rim.position.copy(mesh.position).add(rimDirection);
    rim.target.position.copy(mesh.position);
    renderer.render(scene, camera);
  }
  function write(text, refresh) {
    hasInk = Boolean(text.trim());
    if (ink.write(text, refresh)) inkMap.needsUpdate = true;
  }
  function begin() {
    if (motionCount === 0) frames.begin();
    motionCount++;
  }
  function end(redraw = false) {
    motionCount = Math.max(0, motionCount - 1);
    if (redraw && !motionCount && currentPose) draw(currentPose);
  }
  return {resize, draw, write, begin, end};
}

function createCanvasPaper(canvas) {
  const ctx = canvas.getContext('2d');
  const ink = createInk();
  const patches = faces.map((index) => ({
    x: uv[index * 2] * ink.canvas.width,
    y: (1 - uv[index * 2 + 1]) * ink.canvas.height
  }));
  let hasInk = false;
  let currentPose, motionCount = 0;
  const frames = createCanvasPaperFrames(ctx, ink.canvas, () => {
    if (currentPose && !motionCount) draw(currentPose);
  });
  const points3d = new Float32Array(points * 3);
  const matrix = new THREE.Matrix4();
  const vector = new THREE.Vector3();
  const euler = new THREE.Euler();
  let width, height, focal, lastFold, lastCreased;
  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    focal = Math.min(width, height) * focalRatio;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.imageSmoothingQuality = 'high';
  }
  function draw(pose) {
    currentPose = pose;
    const {x, y, depth = 0, folded = 1, rotation = restRotation, opacity = 1, creased = false, spin = 0, suppressInk = false} = pose;
    ctx.clearRect(0, 0, width, height);
    if (!opacity || !focal) return;
    const distance = nearPlane + depth * depthRange;
    const drawInk = hasInk && !suppressInk;
    if (frames.draw({x, y, folded, spin, orbitRoll: rotation[2], distance, focal, width, height, hasInk: drawInk, creased, opacity, animated: motionCount > 0})) return;
    if (folded !== lastFold || creased !== lastCreased) {
      updateShape(points3d, folded, creased);
      lastFold = folded;
      lastCreased = creased;
    }
    matrix.makeRotationFromEuler(euler.set(...rotation));
    const projected = Array.from({length: points}, (_, i) => {
      vector.fromArray(points3d, i * 3).applyMatrix4(matrix);
      const scale = focal / (distance - vector.z);
      return {x: vector.x, y: vector.y, z: vector.z,
        u: width / 2 + ((x - .5) * width * distance / focal + vector.x) * scale,
        v: height / 2 + ((y - .5) * height * distance / focal - vector.y) * scale};
    });
    const sorted = [];
    for (let i = 0; i < faces.length; i += 3) {
      const [a, b, c] = [projected[faces[i]], projected[faces[i + 1]], projected[faces[i + 2]]];
      sorted.push({a, b, c, z: a.z + b.z + c.z, i});
    }
    sorted.sort((a, b) => a.z - b.z);
    ctx.globalAlpha = opacity;
    for (const {a, b, c, z, i} of sorted) {
      const ux = b.x-a.x, uy = b.y-a.y, uz = b.z-a.z;
      const vx = c.x-a.x, vy = c.y-a.y, vz = c.z-a.z;
      const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
      const normal = Math.hypot(nx, ny, nz) || 1;
      const facing = nz < 0 ? -1 : 1;
      const light = Math.max(0, facing*(-.434*nx+.597*ny+.651*nz)/normal);
      const tone = Math.min(244, 108 + 128 * light + z * 9);
      ctx.fillStyle = ctx.strokeStyle = `rgb(${tone+5},${tone+2},${tone-5})`;
      ctx.lineWidth = .58;
      ctx.beginPath();
      ctx.moveTo(a.u, a.v);
      ctx.lineTo(b.u, b.v);
      ctx.lineTo(c.u, c.v);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (drawInk && nz > 0) {
        const p = patches[i], q = patches[i + 1], r = patches[i + 2];
        const sx = q.x - p.x, sy = q.y - p.y, tx = r.x - p.x, ty = r.y - p.y;
        const determinant = sx * ty - sy * tx;
        const a11 = ((b.u - a.u) * ty - (c.u - a.u) * sy) / determinant;
        const a12 = ((c.u - a.u) * sx - (b.u - a.u) * tx) / determinant;
        const a21 = ((b.v - a.v) * ty - (c.v - a.v) * sy) / determinant;
        const a22 = ((c.v - a.v) * sx - (b.v - a.v) * tx) / determinant;
        const left = Math.min(p.x, q.x, r.x), top = Math.min(p.y, q.y, r.y);
        const width = Math.max(p.x, q.x, r.x) - left, height = Math.max(p.y, q.y, r.y) - top;
        ctx.save();
        ctx.clip();
        ctx.transform(a11, a21, a12, a22, a.u - p.x * a11 - p.y * a12, a.v - p.x * a21 - p.y * a22);
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(ink.canvas, left, top, width, height, left, top, width, height);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }
  function write(text, refresh) {
    if (ink.write(text, refresh)) frames.invalidateInk();
    hasInk = Boolean(text.trim());
  }
  function begin() {
    if (motionCount === 0) frames.begin();
    motionCount++;
  }
  function end(redraw = false) {
    motionCount = Math.max(0, motionCount - 1);
    if (redraw && !motionCount && currentPose) draw(currentPose);
  }
  return {resize, draw, write, begin, end};
}
