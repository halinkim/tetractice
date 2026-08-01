import { describe, expect, it } from 'vitest';
import { sprintProgressState } from '../src/render/renderer';

describe('40 lines pro mode progress', () => {
  it('starts at 40 lines remaining in sprint pro mode', () => {
    expect(sprintProgressState({ mode: 'sprint', lines: 0 }, true)).toEqual({
      visible: true,
      remaining: 40,
    });
  });

  it('counts down as lines are cleared', () => {
    expect(sprintProgressState({ mode: 'sprint', lines: 13 }, true)).toEqual({
      visible: true,
      remaining: 27,
    });
  });

  it('stays within the 40-line target range', () => {
    expect(sprintProgressState({ mode: 'sprint', lines: 45 }, true).remaining).toBe(0);
    expect(sprintProgressState({ mode: 'sprint', lines: -4 }, true).remaining).toBe(40);
  });

  it('is hidden outside sprint or when pro mode is disabled', () => {
    expect(sprintProgressState({ mode: 'zen', lines: 0 }, true).visible).toBe(false);
    expect(sprintProgressState({ mode: 'sprint', lines: 0 }, false).visible).toBe(false);
  });
});
