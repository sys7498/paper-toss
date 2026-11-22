// Map the square layer to the four projected corners while keeping the ink on it.
function projection(corners, size) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = corners;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const dx = x0 - x1 + x2 - x3, dy = y0 - y1 + y2 - y3;
  const determinant = dx1 * dy2 - dx2 * dy1;
  const g = (dx * dy2 - dx2 * dy) / determinant;
  const h = (dx1 * dy - dx * dy1) / determinant;
  return `matrix3d(${[
    x1 - x0 + g * x1, y1 - y0 + g * y1, 0, g / size,
    x3 - x0 + h * x3, y3 - y0 + h * y3, 0, h / size,
    0, 0, 1, 0, x0 * size, y0 * size, 0, 1
  ].map((value) => value.toFixed(8)).join(',')})`;
}

const anchors = [[0, 0], [1, 0], [1, 1], [0, 1]];
const restingCorner = () => ({x: 0, y: 0, vx: 0, vy: 0});

export function createWritingWind(layer, reducedMotion) {
  let size = 0, frame = null, previous = null, time = 0;
  let corners = anchors.map(restingCorner);

  function tick(now) {
    const dt = previous === null ? 0 : Math.min((now - previous) / 1000, .04);
    previous = now;
    time += dt;
    const pushX = .021 * Math.sin(time * 1.8) + .006 * Math.sin(time * 3.7 + .4);
    const pushY = .012 * Math.sin(time * 1.5 + .2);
    const turn = .027 * Math.sin(time * 2.05);
    corners.forEach((corner, index) => {
      const [x, y] = anchors[index];
      const left = corners[(index + 3) % 4], right = corners[(index + 1) % 4];
      const flick = Math.sin(time * 3.1 - index * .98);
      const targetX = pushX - turn * (y - .5) + flick * .016 * (x - .5);
      const targetY = pushY + turn * (x - .5) + flick * .024;
      corner.vx += (25 * (targetX - corner.x) + 6 * (left.x + right.x - 2 * corner.x) - 5 * corner.vx) * dt;
      corner.vy += (25 * (targetY - corner.y) + 6 * (left.y + right.y - 2 * corner.y) - 5 * corner.vy) * dt;
    });
    const points = corners.map((corner, index) => {
      corner.x += corner.vx * dt;
      corner.y += corner.vy * dt;
      return [anchors[index][0] + corner.x, anchors[index][1] + corner.y];
    });
    layer.style.transform = projection(points, size);
    frame = requestAnimationFrame(tick);
  }

  function sync() {
    if (size > 0 && !reducedMotion.matches && !document.hidden) {
      if (frame === null) frame = requestAnimationFrame(tick);
    } else if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = previous = null;
      time = 0;
      corners = anchors.map(restingCorner);
      layer.style.transform = '';
    }
  }
  document.addEventListener('visibilitychange', sync);
  reducedMotion.addEventListener('change', sync);
  return function setSize(next) {
    size = next;
    sync();
  };
}
