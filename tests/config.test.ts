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
});
