import { describe, expect, it } from 'vitest';

import { calculatePpsFromFrames, formatTime } from '../src/game/game-engine';

describe('game metrics', () => {
  it('60Hz 게임 프레임을 실제 경과 시간으로 표시한다', () => {
    expect(formatTime(120 * (1000 / 60))).toBe('00:02.000');
    expect(formatTime(62_345)).toBe('01:02.345');
  });

  it('PPS는 배치한 조각 수를 실제 플레이 초로 나눈다', () => {
    expect(calculatePpsFromFrames(6, 120)).toBe(3);
    expect(calculatePpsFromFrames(0, 0)).toBe(0);
  });
});
