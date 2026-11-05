export type BoardGeometry = { x: number; y: number; width: number; height: number };
export const defaultGeometry = (): BoardGeometry => ({ x: .1, y: .1, width: .8, height: .8 });
export function validGeometry(value: any): value is BoardGeometry {
  return !!value && ['x', 'y', 'width', 'height'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))
    && value.x >= 0 && value.y >= 0 && value.width > 0 && value.height > 0
    && value.x + value.width <= 1.0000001 && value.y + value.height <= 1.0000001;
}
export function restoreGeometry(value: unknown, vw: number, vh: number): BoardGeometry {
  return validGeometry(value) && value.width * vw >= Math.min(560, vw) && value.height * vh >= Math.min(320, vh)
    ? value : defaultGeometry();
}
export function resizeGeometry(start: BoardGeometry, edge: string, dx: number, dy: number, vw: number, vh: number): BoardGeometry {
  let { x, y, width, height } = start;
  const right = x + width, bottom = y + height;
  const minW = Math.min(560 / vw, 1), minH = Math.min(320 / vh, 1);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  if (edge.includes('w')) { x = clamp(x + dx / vw, 0, right - minW); width = right - x; }
  if (edge.includes('e')) width = clamp(width + dx / vw, minW, 1 - x);
  if (edge.includes('n')) { y = clamp(y + dy / vh, 0, bottom - minH); height = bottom - y; }
  if (edge.includes('s')) height = clamp(height + dy / vh, minH, 1 - y);
  return { x, y, width, height };
}
