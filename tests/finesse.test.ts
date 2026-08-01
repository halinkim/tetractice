import { describe, expect, it, vi } from 'vitest';

import { GameEngine } from '../src/game/game-engine';
import {
  createFinesseCatalog,
  createStackFinesseCase,
  dropPlacement,
  evaluateFinessePlacement,
  findBoardFinesseSolutions,
  masteryLevel,
  pieceCells,
  rankWeakFinesseCases,
  selectFinesseCases,
  shuffleFinesseCases,
} from '../src/game/finesse';

const catalog = createFinesseCatalog({ allow180: true, rotationSystem: 'srsplus' });

const heightProfile = (board) => Array.from({ length: 10 }, (_, x) => {
  const top = board.findIndex((row) => Boolean(row[x]));
  return top < 0 ? 0 : board.length - top;
});

const hasOnlySolidColumns = (board) => Array.from({ length: 10 }, (_, x) => {
  let foundTerrain = false;
  for (let y = 0; y < board.length; y += 1) {
    if (board[y][x]) foundTerrain = true;
    else if (foundTerrain) return false;
  }
  return true;
}).every(Boolean);

const placeCaseOnBoard = (stacked) => {
  const placed = stacked.board.map((row) => [...row]);
  for (const [x, y] of pieceCells(stacked.type, stacked)) placed[y][x] = stacked.type;
  return placed;
};

describe('finesse catalog', () => {
  it('enumerates every unique empty-floor placement exactly once', () => {
    expect(catalog).toHaveLength(162);
    expect(new Set(catalog.map((entry) => entry.id)).size).toBe(162);
    expect(catalog.filter((entry) => entry.type === 'I')).toHaveLength(17);
    expect(catalog.filter((entry) => entry.type === 'O')).toHaveLength(9);
    expect(catalog.filter((entry) => entry.type === 'T')).toHaveLength(34);
  });

  it('finds a two-step-or-better route for every placement', () => {
    for (const entry of catalog) {
      expect(Number.isFinite(entry.minInputs), entry.id).toBe(true);
      expect(entry.minInputs, entry.id).toBeLessThanOrEqual(2);
      expect(entry.solutions.length, entry.id).toBeGreaterThan(0);
    }
  });

  it('filters exact piece drills without losing their cases', () => {
    const selected = selectFinesseCases(catalog, ['T']);
    expect(selected).toHaveLength(34);
    expect(selected.every((entry) => entry.type === 'T')).toBe(true);
    expect(selectFinesseCases(catalog, ['T'], { rotations: [0], columns: [3] })).toEqual([
      expect.objectContaining({ id: 'T:0:3' }),
    ]);
  });

  it('creates a complete shuffle bag rather than sampling with replacement', () => {
    const randomValues = [0.13, 0.91, 0.37, 0.62];
    let cursor = 0;
    const shuffled = shuffleFinesseCases(catalog, () => randomValues[cursor++ % randomValues.length]);
    expect(shuffled).toHaveLength(catalog.length);
    expect(new Set(shuffled.map((entry) => entry.id))).toEqual(new Set(catalog.map((entry) => entry.id)));
    expect(shuffled.map((entry) => entry.id)).not.toEqual(catalog.map((entry) => entry.id));
  });

  it('distinguishes a correct target from extra-input and wrong-position attempts', () => {
    const target = catalog.find((entry) => entry.id === 'T:0:3');
    expect(evaluateFinessePlacement(target, { type: 'T', x: 3, rot: 0 }, 0).success).toBe(true);
    expect(evaluateFinessePlacement(target, { type: 'T', x: 3, rot: 0 }, 1)).toMatchObject({
      success: false,
      reason: 'extra-input',
      extraInputs: 1,
    });
    expect(evaluateFinessePlacement(target, { type: 'T', x: 2, rot: 0 }, 1).reason).toBe('wrong-position');
  });

  it('ranks attempted weak cases before mastered cases', () => {
    const [first, second] = catalog;
    const ranked = rankWeakFinesseCases([first, second], {
      [first.id]: { attempts: 4, successes: 1, faults: 3 },
      [second.id]: { attempts: 4, successes: 4, faults: 0 },
    });
    expect(ranked[0].id).toBe(first.id);
  });

  it('builds a reachable stack placement above a non-empty skyline', () => {
    const base = catalog.find((entry) => entry.id === 'T:0:3');
    let value = 0x12345678;
    const random = () => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value / 0x100000000;
    };
    const stacked = createStackFinesseCase(base, random, { allow180: true, arr: 2, rotationSystem: 'srsplus' });
    expect(stacked).toBeTruthy();
    expect(stacked.masteryId).toBe(base.id);
    expect(stacked.y).toBeLessThan(base.y);
    expect(stacked.board.flat().some(Boolean)).toBe(true);
    expect(stacked.solutions.length).toBeGreaterThan(0);
    expect(dropPlacement(stacked.type, { x: stacked.x, y: 19, rot: stacked.rot }, stacked.board)).toMatchObject({
      x: stacked.x,
      y: stacked.y,
      rot: stacked.rot,
    });
    expect(hasOnlySolidColumns(stacked.board)).toBe(true);
    expect(heightProfile(stacked.board)).toEqual(stacked.stackHeights);
    expect(stacked.stackHeights.filter((height) => height === 0)).toHaveLength(1);
    expect([0, 9]).toContain(stacked.stackGap);
    expect(new Set(stacked.cells.map(([x]) => x)).has(stacked.stackGap)).toBe(false);
    const completed = placeCaseOnBoard(stacked);
    expect(hasOnlySolidColumns(completed)).toBe(true);
    expect(heightProfile(completed)).toEqual(stacked.completedStackHeights);
    expect(completed.some((row) => row.every(Boolean))).toBe(false);
  });

  it('generates a reachable stack version for every canonical case', () => {
    let value = 0x9e3779b9;
    const random = () => {
      value ^= value << 13;
      value ^= value >>> 17;
      value ^= value << 5;
      return (value >>> 0) / 0x100000000;
    };
    for (const base of catalog) {
      const stacked = createStackFinesseCase(base, random, { allow180: true, arr: 2, rotationSystem: 'srsplus' });
      expect(stacked, base.id).toBeTruthy();
      expect(Number.isFinite(stacked.minInputs), base.id).toBe(true);
      expect(hasOnlySolidColumns(stacked.board), base.id).toBe(true);
      expect(hasOnlySolidColumns(placeCaseOnBoard(stacked)), base.id).toBe(true);
      expect(heightProfile(stacked.board), base.id).toEqual(stacked.stackHeights);
      expect(stacked.stackHeights.filter((height) => height === 0), base.id).toHaveLength(1);
      for (let x = 1; x < stacked.stackHeights.length; x += 1) {
        if (stacked.stackHeights[x] === 0 || stacked.stackHeights[x - 1] === 0) continue;
        expect(Math.abs(stacked.stackHeights[x] - stacked.stackHeights[x - 1]), `${base.id} surface ${x}`).toBeLessThanOrEqual(2);
      }
      expect(dropPlacement(stacked.type, { x: stacked.x, y: 19, rot: stacked.rot }, stacked.board), base.id).toMatchObject({
        x: stacked.x,
        y: stacked.y,
        rot: stacked.rot,
      });
    }
  });

  it('keeps standing S, Z, J, and L targets open to a normal hard drop', () => {
    let value = 0x51a7f00d;
    const random = () => {
      value = (Math.imul(value, 1103515245) + 12345) >>> 0;
      return value / 0x100000000;
    };
    for (const type of ['S', 'Z', 'J', 'L']) {
      const verticalCases = catalog.filter((entry) => entry.type === type && entry.height === 3);
      expect(verticalCases.length, type).toBeGreaterThan(0);
      for (const base of verticalCases) {
        const stacked = createStackFinesseCase(base, random, { allow180: true, arr: 2, rotationSystem: 'srsplus' });
        expect(stacked, base.id).toBeTruthy();
        const landing = dropPlacement(type, { x: stacked.x, y: 19, rot: stacked.rot }, stacked.board);
        expect(landing, base.id).toMatchObject({ x: stacked.x, y: stacked.y, rot: stacked.rot });
        expect(hasOnlySolidColumns(stacked.board), base.id).toBe(true);
      }
    }
  });

  it('solves board-aware landing routes and classifies mastery levels', () => {
    const base = catalog.find((entry) => entry.id === 'I:0:3');
    const board = Array.from({ length: 40 }, () => Array(10).fill(null));
    board[39][0] = 'J';
    const landing = dropPlacement(base.type, { x: base.x, y: 19, rot: base.rot }, board);
    const cells = base.cells.map(([x, y]) => [x, y + landing.y - base.y]);
    const route = findBoardFinesseSolutions(base.type, { cells }, board, { allow180: true, arr: 2, rotationSystem: 'srsplus' });
    expect(route.minInputs).toBe(base.minInputs);
    expect(masteryLevel(null)).toBe('untried');
    expect(masteryLevel({ attempts: 3, successes: 2, bestStreak: 2 })).toBe('learning');
    expect(masteryLevel({ attempts: 5, successes: 4, bestStreak: 3 })).toBe('solid');
    expect(masteryLevel({ attempts: 20, successes: 19, bestStreak: 7 })).toBe('mastered');
  });
});

describe('finesse training loop', () => {
  const makeEngine = (target) => {
    const engine: any = Object.create(GameEngine.prototype);
    engine.current = { type: target.type, x: target.x, y: target.y, rot: target.rot };
    engine.finesseSession = {
      deck: [target, catalog[1]],
      index: 0,
      currentCase: target,
      awaitingNeutral: false,
      attempts: 0,
      correct: 0,
      streak: 0,
      bestStreak: 0,
      caseAttempt: 0,
    };
    engine.finesseProgress = { version: 1, cases: {} };
    engine.pieceManipulations = target.minInputs;
    engine.pieceInputTokens = [];
    engine.pieces = 0;
    engine.finessePerfectPieces = 0;
    engine.finesseFaults = 0;
    engine.score = 0;
    engine.replayMode = true;
    engine.renderer = { bounce: vi.fn(), lastMiniSignature: '' };
    engine.audio = { play: vi.fn() };
    engine.showAction = vi.fn();
    engine.showFinesseHint = vi.fn();
    engine.updateHUD = vi.fn();
    engine.finish = vi.fn();
    return engine;
  };

  it('advances only after an optimal placement', () => {
    const target = catalog.find((entry) => entry.id === 'T:0:3');
    const engine = makeEngine(target);

    engine.evaluateFinesseAttempt();

    expect(engine.finesseSession.index).toBe(1);
    expect(engine.finesseSession.correct).toBe(1);
    expect(engine.finesseSession.awaitingNeutral).toBe(true);
    expect(engine.pieces).toBe(1);
    expect(engine.finesseFaults).toBe(0);
  });

  it('keeps a failed target at the front of the deck', () => {
    const target = catalog.find((entry) => entry.id === 'T:0:3');
    const engine = makeEngine(target);
    engine.current.x += 1;

    engine.evaluateFinesseAttempt();

    expect(engine.finesseSession.index).toBe(0);
    expect(engine.finesseSession.correct).toBe(0);
    expect(engine.finesseSession.currentCase.id).toBe(target.id);
    expect(engine.finesseFaults).toBe(1);
  });

  it('records live 7-bag placements against the same canonical mastery case', () => {
    const target = catalog.find((entry) => entry.id === 'T:0:3');
    const engine: any = Object.create(GameEngine.prototype);
    engine.board = Array.from({ length: 40 }, () => Array(10).fill(null));
    engine.finesseSession = { type: 'flow', attempts: 0, correct: 0, streak: 0, bestStreak: 0 };
    engine.finesseCatalog = catalog;
    engine.refreshFinesseCatalog = vi.fn();
    engine.finesseProgress = { version: 2, cases: {} };
    engine.pieceManipulations = target.minInputs;
    engine.pieceInputTokens = target.solutions[0];
    engine.replayMode = true;
    engine.showFinesseHint = vi.fn();

    expect(engine.evaluateFlowFinesse({ type: target.type, x: target.x, y: target.y, rot: target.rot })).toBe(0);
    expect(engine.finesseSession).toMatchObject({ attempts: 1, correct: 1, streak: 1, bestStreak: 1 });
    expect(engine.finesseProgress.cases[target.id]).toMatchObject({
      attempts: 1,
      successes: 1,
      faults: 0,
      modes: { flow: { attempts: 1, successes: 1, faults: 0 } },
    });
  });

  it('uses canonical finesse in 40-line play even when a stack kick looks shorter', () => {
    const engine: any = Object.create(GameEngine.prototype);
    engine.board = Array.from({ length: 40 }, () => Array(10).fill(null));
    const terrain = [
      [false, true, true, false, true, true, false, false, false, true],
      [true, true, false, true, false, false, false, false, false, true],
      [true, false, true, false, false, false, false, false, false, true],
      [true, false, false, false, false, false, false, false, false, false],
      [true, false, false, true, true, true, true, true, true, true],
      [false, false, true, true, false, false, false, false, true, true],
    ];
    terrain.forEach((row, offset) => row.forEach((filled, x) => {
      if (filled) engine.board[34 + offset][x] = 'J';
    }));
    engine.pieceManipulations = 2;

    const piece = { type: 'I', x: 1, y: 31, rot: 1 };
    const boardRoute = findBoardFinesseSolutions(piece.type, { cells: [[3, 31], [3, 32], [3, 33], [3, 34]] }, engine.board, {
      allow180: true,
      arr: 2,
      rotationSystem: 'srsplus',
    });

    expect(boardRoute.minInputs).toBe(1);
    expect(engine.measureFinesse(piece)).toBe(0);
  });
});
