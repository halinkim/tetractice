import { describe, expect, it } from 'vitest';

import { sanitizeConfig } from '../src/core/state';

describe('training config', () => {
  it('persists valid spin coach and clear-rule choices', () => {
    const config = sanitizeConfig({ training: { spinStyle: 'recall', spinValidation: 'placement' } });
    expect(config.training.spinStyle).toBe('recall');
    expect(config.training.spinValidation).toBe('placement');
  });

  it('falls back to guided technique practice for invalid values', () => {
    const config = sanitizeConfig({ training: { spinStyle: 'unknown', spinValidation: 'unknown' } });
    expect(config.training.spinStyle).toBe('guided');
    expect(config.training.spinValidation).toBe('technique');
  });

  it('migrates hidden build and deep presets back to basics', () => {
    expect(sanitizeConfig({ training: { spinPreset: 'deep' } }).training.spinPreset).toBe('basics');
    expect(sanitizeConfig({ training: { spinPreset: 'builds' } }).training.spinPreset).toBe('basics');
  });

  it('persists L, J, and I all-spin piece choices', () => {
    const config = sanitizeConfig({ training: { spinPieces: ['T', 'L', 'J', 'I', 'O'] } });
    expect(config.training.spinPieces).toEqual(['T', 'L', 'J', 'I']);
  });

  it('persists build difficulty and retry policy while rejecting unknown values', () => {
    const expert = sanitizeConfig({ training: { buildId: 'dot-cannon', buildPhase: 'bag-2', buildVariant: 'right-l', buildDifficulty: 'expert', buildRetry: 'new' }, ui: { mode: 'build' } });
    expect(expert.training.buildId).toBe('dot-cannon');
    expect(expert.training.buildPhase).toBe('bag-2');
    expect(expert.training.buildVariant).toBe('right-l');
    expect(expert.training.buildDifficulty).toBe('expert');
    expect(expert.training.buildRetry).toBe('new');
    expect(expert.ui.mode).toBe('build');

    const pc = sanitizeConfig({ training: { buildPhase: 'pc-3' } });
    expect(pc.training.buildPhase).toBe('pc-3');
    const full = sanitizeConfig({ training: { buildPhase: 'full' } });
    expect(full.training.buildPhase).toBe('full');

    const fallback = sanitizeConfig({ training: { buildId: 'unknown', buildPhase: 'unknown', buildVariant: 'unknown', buildDifficulty: 'unknown', buildRetry: 'unknown' } });
    expect(fallback.training.buildId).toBe('dot-cannon');
    expect(fallback.training.buildPhase).toBe('bag-1');
    expect(fallback.training.buildVariant).toBe('auto');
    expect(fallback.training.buildDifficulty).toBe('beginner');
    expect(fallback.training.buildRetry).toBe('same');
  });
});
