export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function average(a, b) {
  return (a + b) / 2;
}

export function normalize(value, low, high) {
  return clamp((value - low) / (high - low));
}

export function clamp(value) {
  return Math.min(1, Math.max(0, value));
}
