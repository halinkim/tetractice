import { describe, expect, it } from 'vitest';

import { PIECES } from '../src/core/state';
import { PieceRandomizer } from '../src/game/randomizer';

describe('PieceRandomizer', () => {
  it('같은 시드에서 같은 조각열을 만든다', () => {
    const first = new PieceRandomizer(0x12345678, 'bag7');
    const second = new PieceRandomizer(0x12345678, 'bag7');

    expect(Array.from({ length: 28 }, () => first.next())).toEqual(
      Array.from({ length: 28 }, () => second.next()),
    );
  });

  it('7-bag마다 일곱 종류를 정확히 한 번씩 포함한다', () => {
    const randomizer = new PieceRandomizer(42, 'bag7');
    const bag = Array.from({ length: 7 }, () => randomizer.next()).sort();

    expect(bag).toEqual([...PIECES].sort());
  });

  it('calm 모드는 첫 조각으로 S, Z, O를 피한다', () => {
    for (let seed = 1; seed <= 128; seed += 1) {
      const randomizer = new PieceRandomizer(seed, 'calm');
      expect(['S', 'Z', 'O']).not.toContain(randomizer.next());
    }
  });

  it('14-bag은 각 조각을 두 번씩 포함한다', () => {
    const randomizer = new PieceRandomizer(2026, 'bag14');
    const bag = Array.from({ length: 14 }, () => randomizer.next());

    for (const piece of PIECES) {
      expect(bag.filter((value) => value === piece)).toHaveLength(2);
    }
  });
});
