import { depthRange, focalRatio, nearPlane, restRotation } from './paper.js';

const lerp = (a, b, t) => a + (b - a) * t;
const between = (a, b, t) => a.map((value, index) => lerp(value, b[index], t));

export function smoothPath(points) {
  // Cut each corner twice while keeping the launch and arrival points fixed.
  for (let pass = 0; pass < 2; pass++) {
    const rounded = [points[0]];
    for (let i = 1; i < points.length; i++) {
      rounded.push(between(points[i - 1], points[i], .25), between(points[i - 1], points[i], .75));
    }
    rounded.push(points.at(-1));
    points = rounded;
  }
  return points;
}

function cumulative(points) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(...points[i].map((value, axis) => value - points[i - 1][axis])));
  }
  return lengths;
}

export function createFlight(points, width, height) {
  const track = smoothPath(points);
  const screenLengths = cumulative(track);
  const totalScreen = screenLengths.at(-1) || 1;
  const focal = Math.min(width, height) * focalRatio || 1;

  // Back-project each 2D point into the camera at its assigned depth.
  const depths = screenLengths.map((distance) => distance / totalScreen);
  if (!screenLengths.at(-1)) depths.forEach((_, i) => depths[i] = i / (depths.length - 1));
  const world = track.map(([x, y], i) => {
    const z = nearPlane + depths[i] * depthRange;
    return [(x - .5) * width * z / focal, (y - .5) * height * z / focal, z];
  });
  const lengths = cumulative(world);
  const totalWorld = lengths.at(-1);
  const duration = Math.min(1550, Math.max(850, totalWorld * 77));

  function pose(time, receiving) {
    // Exponential drag slows travel along the 3D path after release.
    const travel = -Math.expm1(-1.65 * time) / -Math.expm1(-1.65);
    const distance = totalWorld * (receiving ? 1 - travel : travel);
    let low = 0, high = lengths.length - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (lengths[mid] < distance) low = mid;
      else high = mid;
    }
    const amount = (distance - lengths[low]) / (lengths[high] - lengths[low] || 1);
    const [x, y, z] = between(world[low], world[high], amount);
    const turn = -Math.expm1(-.9 * time) / -Math.expm1(-.9);
    const bank = Math.sin(Math.PI * time) * .4;
    const spin = receiving ? turn - 1 : turn;
    const rotation = restRotation.map((angle, axis) => angle + [1.7, 4.4, -2.3][axis] * spin);
    rotation[2] += bank;
    return {
      x: x * focal / (width * z || 1) + .5,
      y: y * focal / (height * z || 1) + .5,
      depth: (z - nearPlane) / depthRange,
      spin,
      rotation
    };
  }
  return {duration, pose};
}
