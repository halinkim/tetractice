import { describe, expect, it } from 'vitest';

import {
  createSpinCatalog,
  evaluateSpinAttempt,
  findSpinApproach,
  hasEnclosedHole,
  isDirectHardDropReachable,
  isImmobile,
  rotationEntriesForTarget,
  simulateSdfMaxRoute,
  simulateSpinClear,
  tSpinClassification,
} from '../src/game/spin';

const catalog = createSpinCatalog({ rotationSystem: 'srsplus' });

describe('meaningful spin lessons', () => {
  it('contains the basic cycle plus verified T/S/Z/L/J/I all-spin families', () => {
    expect(catalog).toHaveLength(48);
    expect(new Set(catalog.map((entry) => entry.id)).size).toBe(48);
    expect(catalog.filter((entry) => entry.tier === 'basic')).toHaveLength(8);
    expect(catalog.filter((entry) => entry.tier === 'advanced')).toHaveLength(40);
    for (const type of ['S', 'Z']) {
      const entries = catalog.filter((entry) => entry.type === type);
      expect(entries).toHaveLength(6);
      for (const clearName of ['SINGLE', 'DOUBLE', 'TRIPLE']) {
        expect(entries.filter((entry) => entry.clearName === clearName), `${type} ${clearName}`).toHaveLength(2);
      }
    }
    for (const type of ['L', 'J']) {
      const entries = catalog.filter((entry) => entry.type === type);
      expect(entries).toHaveLength(3);
      for (const clearName of ['SINGLE', 'DOUBLE', 'TRIPLE']) {
        expect(entries.filter((entry) => entry.clearName === clearName), `${type} ${clearName}`).toHaveLength(1);
      }
    }
    const iCases = catalog.filter((entry) => entry.type === 'I');
    expect(iCases).toHaveLength(6);
    expect(iCases.filter((entry) => entry.clearName === 'SINGLE')).toHaveLength(2);
    expect(iCases.filter((entry) => entry.clearName === 'DOUBLE')).toHaveLength(2);
    expect(iCases.filter((entry) => entry.clearName === 'TRIPLE')).toHaveLength(2);
    const tCases = catalog.filter((entry) => entry.type === 'T');
    expect(tCases).toHaveLength(24);
    expect(tCases.filter((entry) => entry.spinKind === 'mini')).toHaveLength(4);
    for (const variant of ['iso', 'neo', 'fin']) {
      expect(tCases.filter((entry) => entry.variant === variant), variant).toHaveLength(2);
    }
    expect(tCases.filter((entry) => entry.variant === 'deep')).toHaveLength(2);
    expect(tCases.filter((entry) => entry.variant === 'build')).toHaveLength(8);
  });

  it('uses immobile all-spin slots and literal SDF MAX routes for L, J, and I', () => {
    const allSpinCases = catalog.filter((entry) => ['L', 'J', 'I'].includes(entry.type));
    expect(allSpinCases).toHaveLength(12);
    for (const spinCase of allSpinCases) {
      expect(isImmobile(spinCase.type, spinCase.target, spinCase.board), spinCase.id).toBe(true);
      expect(spinCase.directHardDrop, spinCase.id).toBe(false);
      expect(spinCase.inputRoute, spinCase.id).toContain('softDrop');
    }
    expect(catalog.find((entry) => entry.id === 'L:spin-single')?.practiceRoute).toEqual([
      'rotateCCW', 'softDrop', 'rotateCW', 'hardDrop',
    ]);
    expect(catalog.find((entry) => entry.id === 'L:spin-double')?.practiceRoute).toEqual([
      'rotateCCW', 'softDrop', 'rotateCW', 'hardDrop',
    ]);
    expect(catalog.find((entry) => entry.id === 'L:spin-triple')?.practiceRoute).toEqual([
      'right', 'softDrop', 'left', 'rotateCW', 'hardDrop',
    ]);
    expect(catalog.find((entry) => entry.id === 'J:spin-single')?.practiceRoute).toEqual([
      'rotateCW', 'softDrop', 'rotateCCW', 'hardDrop',
    ]);
    expect(catalog.find((entry) => entry.id === 'J:spin-double')?.practiceRoute).toEqual([
      'rotateCW', 'softDrop', 'rotateCCW', 'hardDrop',
    ]);
    expect(catalog.find((entry) => entry.id === 'J:spin-triple')?.practiceRoute).toEqual([
      'softDrop', 'right', 'rotateCCW', 'hardDrop',
    ]);
    expect(catalog.find((entry) => entry.id === 'I:spin-single-left')?.practiceRoute).toEqual([
      'left', 'rotateCCW', 'softDrop', 'rotateCW', 'hardDrop',
    ]);
    expect(catalog.find((entry) => entry.id === 'I:spin-single-right')?.practiceRoute).toEqual([
      'right', 'rotateCW', 'softDrop', 'rotateCCW', 'hardDrop',
    ]);
    expect(catalog.find((entry) => entry.id === 'I:spin-double-left')?.practiceRoute).toEqual([
      'softDrop', 'left', 'rotateCCW', 'hardDrop',
    ]);
    expect(catalog.find((entry) => entry.id === 'I:spin-double-right')?.practiceRoute).toEqual([
      'softDrop', 'right', 'rotateCW', 'hardDrop',
    ]);
    expect(catalog.find((entry) => entry.id === 'I:spin-triple-left')?.practiceRoute).toEqual([
      'softDrop', 'left', 'rotateCW', 'hardDrop',
    ]);
    expect(catalog.find((entry) => entry.id === 'I:spin-triple-right')?.practiceRoute).toEqual([
      'softDrop', 'right', 'rotateCCW', 'hardDrop',
    ]);
  });

  it('forces multiple real stop, turn, and descent stages in deep T-spin routes', () => {
    const deepCases = [
      ...catalog.filter((entry) => entry.variant === 'deep'),
      ...createSpinCatalog({ rotationSystem: 'srsplus', allow180: true }).filter((entry) => entry.variant === 'deep'),
    ];
    expect(deepCases).toHaveLength(4);
    for (const spinCase of deepCases) {
      const route = spinCase.inputRoute;
      const dropIndexes = route.flatMap((token, index) => token === 'softDrop' ? [index] : []);
      expect(dropIndexes, spinCase.id).toHaveLength(3);
      expect(dropIndexes.map((index) => spinCase.practiceTimeline[index].resultY), spinCase.id).toEqual([28, 35, 37]);
      for (let stage = 0; stage < dropIndexes.length - 1; stage += 1) {
        const betweenDrops = route.slice(dropIndexes[stage] + 1, dropIndexes[stage + 1]);
        expect(betweenDrops.filter((token) => token.startsWith('rotate')), spinCase.id).toHaveLength(2);
      }
      expect(route.filter((token) => token === 'rotate180'), spinCase.id).toHaveLength(0);
      expect(spinCase.directHardDrop, spinCase.id).toBe(false);
    }
  });

  it('uses connected build silhouettes with side-entry movement for build T-spins', () => {
    const buildCases = catalog.filter((entry) => entry.variant === 'build');
    expect(buildCases).toHaveLength(8);
    for (const spinCase of buildCases) {
      const route = spinCase.inputRoute;
      const firstDrop = route.indexOf('softDrop');
      expect(route.filter((token) => token === 'softDrop').length, spinCase.id).toBeGreaterThanOrEqual(3);
      expect(route.filter((token) => token.startsWith('rotate')).length, spinCase.id).toBeGreaterThanOrEqual(4);
      expect(route.slice(firstDrop + 1).some((token) => token === 'left' || token === 'right'), spinCase.id).toBe(true);
      expect(route, spinCase.id).not.toContain('rotate180');

      const occupied = new Set<string>();
      const queue: [number, number][] = [];
      for (let y = 0; y < spinCase.board.length; y += 1) {
        for (let x = 0; x < spinCase.board[y].length; x += 1) {
          if (!spinCase.board[y][x]) continue;
          occupied.add(`${x},${y}`);
          if (y === spinCase.board.length - 1) queue.push([x, y]);
        }
      }
      const connected = new Set(queue.map(([x, y]) => `${x},${y}`));
      while (queue.length) {
        const [x, y] = queue.shift();
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const key = `${x + dx},${y + dy}`;
          if (!occupied.has(key) || connected.has(key)) continue;
          connected.add(key);
          queue.push([x + dx, y + dy]);
        }
      }
      expect(connected.size, spinCase.id).toBe(occupied.size);
    }
  });

  it('distinguishes T Mini, Iso, Neo, and Fin using front corners and kick exceptions', () => {
    for (const spinCase of catalog.filter((entry) => entry.type === 'T')) {
      const classification = tSpinClassification(spinCase.target, spinCase.board, spinCase.kickIndex);
      expect(classification?.kind, spinCase.id).toBe(spinCase.spinKind);
      expect(classification?.frontCount, spinCase.id).toBe(spinCase.frontCornerCount);
    }
    expect(catalog.find((entry) => entry.variant === 'iso')?.clearLabel).toBe('T-SPIN DOUBLE');
    expect(catalog.find((entry) => entry.variant === 'neo')?.clearLabel).toBe('T-SPIN MINI DOUBLE');
    expect(catalog.find((entry) => entry.variant === 'fin')?.clearLabel).toBe('T-SPIN DOUBLE');
  });

  it('uses the requested two-line S cavity and inserts S from vertical R into horizontal 2', () => {
    const spinCase = catalog.find((entry) => entry.type === 'S');
    const holes = (row) => row.flatMap((cell, x) => cell ? [] : [x]);
    expect(holes(spinCase.board[38])).toEqual([5, 6]);
    expect(holes(spinCase.board[39])).toEqual([4, 5]);
    expect(spinCase.stateLabels).toEqual(['R', '2']);
    expect(spinCase.stateNames).toEqual(['오른쪽 세로 (R)', '반대 가로 (2)']);
    expect(spinCase.direction).toBe('CW');
    expect(spinCase.kickIndex).toBe(2);
    expect(spinCase.lineClearCount).toBe(2);
  });

  it('rejects every case that can be placed by direct hard drop', () => {
    for (const spinCase of catalog) {
      expect(spinCase.directHardDrop, spinCase.id).toBe(false);
      expect(spinCase.requiresSoftDrop, spinCase.id).toBe(true);
      expect(isDirectHardDropReachable(spinCase.type, spinCase.target, spinCase.board), spinCase.id).toBe(false);
    }
  });

  it('clears the advertised rows and leaves no sealed hole after the spin', () => {
    for (const spinCase of catalog) {
      const result = simulateSpinClear(spinCase.board, spinCase.type, spinCase.target);
      expect(result.clearedRows, spinCase.id).toEqual(spinCase.clearRows);
      expect(result.clearedRows, spinCase.id).toHaveLength(spinCase.lineClearCount);
      expect(hasEnclosedHole(result.boardAfter), spinCase.id).toBe(false);
    }
  });

  it('keeps every soft-drop staging position reachable from normal spawn', () => {
    for (const spinCase of catalog) {
      expect(spinCase.board.some((row) => row.every(Boolean)), spinCase.id).toBe(false);
      expect(spinCase.spawn, spinCase.id).toEqual({ x: 3, y: 19, rot: 0 });
      expect(spinCase.start.y, spinCase.id).toBeGreaterThan(spinCase.spawn.y);
      expect(findSpinApproach(spinCase.type, spinCase.start, spinCase.board, 'srsplus'), spinCase.id).toEqual(spinCase.approach);
    }
  });

  it('provides a literal SDF MAX input route for every lesson', () => {
    expect(catalog.filter((entry) => !entry.inputRoute).map((entry) => entry.id)).toEqual([]);
    for (const spinCase of catalog) {
      expect(spinCase.inputRoute, spinCase.id).toContain('softDrop');
      expect(spinCase.practiceRoute.at(-1), spinCase.id).toBe('hardDrop');
      const result = simulateSdfMaxRoute(spinCase.type, spinCase.inputRoute, spinCase.board, 'srsplus');
      expect(result?.state, spinCase.id).toMatchObject({ x: spinCase.target.x, y: spinCase.target.y, rot: spinCase.target.rot });
      expect(result?.timeline, spinCase.id).toHaveLength(spinCase.inputRoute.length);
      expect(result?.timeline.at(-1), spinCase.id).toMatchObject({
        resultX: spinCase.target.x,
        resultY: spinCase.target.y,
        resultRot: spinCase.target.rot,
      });
      expect(spinCase.practiceTimeline, spinCase.id).toHaveLength(spinCase.practiceRoute.length);
      expect(result?.lastRotation, spinCase.id).toMatchObject({
        from: spinCase.fromRot,
        to: spinCase.toRot,
        delta: spinCase.delta,
        kickIndex: spinCase.kickIndex,
      });
    }
  });

  it('keeps Fin distinct from the easier Neo-style Mini entry', () => {
    expect(catalog.find((entry) => entry.id === 'T:fin-double-right')?.practiceRoute).toEqual([
      'right', 'right', 'right', 'rotateCW', 'softDrop', 'rotateCW', 'left', 'rotateCCW', 'hardDrop',
    ]);
    expect(catalog.find((entry) => entry.id === 'T:fin-double-left')?.practiceRoute).toEqual([
      'left', 'rotateCCW', 'softDrop', 'rotateCCW', 'right', 'rotateCW', 'hardDrop',
    ]);
    for (const spinCase of catalog.filter((entry) => entry.variant === 'fin')) {
      const entries = rotationEntriesForTarget(spinCase.type, spinCase.target, spinCase.board, 'srsplus', { allow180: true });
      expect(entries.some((entry) => entry.kickIndex === 4), spinCase.id).toBe(true);
      expect(entries.some((entry) => entry.kickIndex === 3), spinCase.id).toBe(true);
      expect(tSpinClassification(spinCase.target, spinCase.board, 3)?.kind, spinCase.id).toBe('mini');
      expect(tSpinClassification(spinCase.target, spinCase.board, 4)?.kind, spinCase.id).toBe('full');
      expect(evaluateSpinAttempt(spinCase, { type: spinCase.type, ...spinCase.target }, {
        from: spinCase.fromRot,
        to: spinCase.toRot,
        delta: spinCase.delta,
        kickIndex: 3,
      }).reason, spinCase.id).toBe('mini-not-fin');
    }
  });

  it('can accept the same final placement without enforcing Neo or Fin technique', () => {
    const fin = catalog.find((entry) => entry.id === 'T:fin-double-right');
    const piece = { type: fin.type, x: fin.target.x, y: fin.target.y, rot: fin.target.rot };
    expect(evaluateSpinAttempt(fin, piece, null)).toMatchObject({ success: false, reason: 'no-rotation' });
    expect(evaluateSpinAttempt(fin, piece, null, { validation: 'placement' })).toMatchObject({
      success: true,
      reason: 'placement',
      lines: 2,
    });
    expect(evaluateSpinAttempt(fin, piece, {
      from: fin.fromRot,
      to: fin.toRot,
      delta: fin.delta,
      kickIndex: 3,
    }, { validation: 'placement' })).toMatchObject({ success: true, reason: 'placement' });
    expect(evaluateSpinAttempt(fin, { ...piece, x: piece.x - 1 }, null, { validation: 'placement' }).reason).toBe('target-missed');
  });

  it('requires the intended final rotation, target, kick, and line clear', () => {
    const spinCase = catalog.find((entry) => entry.type === 'S');
    const piece = { type: spinCase.type, x: spinCase.target.x, y: spinCase.target.y, rot: spinCase.target.rot };
    expect(evaluateSpinAttempt(spinCase, piece, null).reason).toBe('no-rotation');
    expect(evaluateSpinAttempt(spinCase, piece, {
      from: spinCase.fromRot,
      to: spinCase.toRot,
      delta: spinCase.delta,
      kickIndex: spinCase.kickIndex,
    })).toMatchObject({ success: true, lines: 2 });
    expect(evaluateSpinAttempt(spinCase, piece, {
      from: 3,
      to: spinCase.toRot,
      delta: spinCase.delta,
      kickIndex: spinCase.kickIndex,
    }).reason).toBe('wrong-state');
  });
});
