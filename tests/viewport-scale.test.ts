import { describe, expect, it } from 'vitest';

import { calculateUiScale } from '../src/ui/viewport-scale';

describe('calculateUiScale', () => {
  it.each([
    [{ width: 1920, height: 1080 }, 1],
    [{ width: 2560, height: 1440 }, 1.333],
    [{ width: 3840, height: 2160 }, 2],
  ])('AUTO 배율을 해상도에 맞춘다: %o', (viewport, expected) => {
    expect(calculateUiScale(viewport, 'auto')).toBe(expected);
  });

  it('모바일과 작은 창에서는 확대하지 않는다', () => {
    expect(calculateUiScale({ width: 375, height: 812 }, '200')).toBe(1);
    expect(calculateUiScale({ width: 960, height: 1080 }, 'auto')).toBe(1);
  });

  it('수동 배율도 화면에 맞는 안전 상한을 넘지 않는다', () => {
    expect(calculateUiScale({ width: 1920, height: 1080 }, '125')).toBe(1.25);
    expect(calculateUiScale({ width: 1280, height: 800 }, '200')).toBe(1);
    expect(calculateUiScale({ width: 3840, height: 2160 }, '200')).toBe(2);
  });
});
