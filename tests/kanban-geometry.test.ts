import { describe, it, expect } from 'vitest';
import { defaultGeometry, restoreGeometry, resizeGeometry } from '../dashboard/src/kanban-geometry';
describe('board geometry', () => {
  it('defaults and rejects damaged, offscreen and unusable state', () => {
    for (const value of [null, {}, { x: NaN }, { x: -.1, y: 0, width: .8, height: .8 }, { x: .5, y: 0, width: .8, height: .8 }, { x: 0, y: 0, width: .1, height: .1 }])
      expect(restoreGeometry(value, 1440, 900)).toEqual(defaultGeometry());
    expect(restoreGeometry(defaultGeometry(), 1440, 900)).toEqual(defaultGeometry());
  });
  it.each(['n','s','e','w','nw','ne','sw','se'])('resizes %s within viewport and minimum', edge => {
    for (const delta of [-10000, 10000]) {
      const g = resizeGeometry(defaultGeometry(), edge, delta, delta, 1440, 900);
      expect(g.x).toBeGreaterThanOrEqual(0); expect(g.y).toBeGreaterThanOrEqual(0);
      expect(g.width * 1440).toBeGreaterThanOrEqual(559.99); expect(g.height * 900).toBeGreaterThanOrEqual(319.99);
      expect(g.x + g.width).toBeLessThanOrEqual(1.000001); expect(g.y + g.height).toBeLessThanOrEqual(1.000001);
    }
  });
});
