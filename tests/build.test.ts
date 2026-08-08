import { describe, expect, it } from 'vitest';
import { BOARD_H, BOARD_W, JLSTZ_180, JLSTZ_90, PIECES, SHAPES, config } from '../src/core/state';
import { getBuildDefinition, type BuildPiece } from '../src/builds/catalog';
import {
  DOT_CANNON_BAG_2_TARGETS,
  DOT_CANNON_TARGETS,
  advanceDotCannonAfterLineClear,
  buildGuideCells,
  buildTargetMatchesBoard,
  commitDotCannonPlacement,
  createDotCannonSession,
  createEmptyBuildProgress,
  describeDotCannonVariant,
  evaluateDotCannonPlacement,
  evaluateDotCannonTechnique,
  recordBuildResult,
  sanitizeBuildProgress,
  selectDotCannonVariant,
  shouldReuseBuildSeed,
} from '../src/game/build';
import {
  DOT_CANNON_PC_INITIAL_CELLS,
  DOT_CANNON_PC_SOLUTIONS,
  dotCannonPcCoverage,
  findDotCannonPcWitnesses,
} from '../src/game/dot-cannon-pc';
import { DOT_CANNON_PC_VALID_ORDERS } from '../src/game/dot-cannon-pc-orders';
import { GameEngine } from '../src/game/game-engine';

const makeBoard = () => Array.from({ length: BOARD_H }, () => Array(BOARD_W).fill(null));

const permutations = <T>(values: T[]): T[][] => values.length <= 1
  ? [values]
  : values.flatMap((value, index) => permutations([...values.slice(0, index), ...values.slice(index + 1)])
    .map((suffix) => [value, ...suffix]));

const findTstRoute = (board: any[][], targetCells: Array<[number, number]>) => {
  const cellsFor = (state: { x: number; y: number; rot: number }) => (
    SHAPES.T[state.rot].map(([dx, dy]) => [state.x + dx, state.y + dy] as [number, number])
  );
  const collides = (state: { x: number; y: number; rot: number }) => cellsFor(state)
    .some(([x, y]) => x < 0 || x >= BOARD_W || y >= BOARD_H || y < -4 || (y >= 0 && board[y][x]));
  const normalized = (cells: Array<[number, number]>) => cells.map(([x, y]) => `${x},${y}`).sort().join('|');
  const target = normalized(targetCells);
  const queue = [{ x: 3, y: 19, rot: 0, path: [] as string[] }];
  const seen = new Set<string>();
  for (let index = 0; index < queue.length; index += 1) {
    const state = queue[index];
    const key = `${state.x},${state.y},${state.rot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const [token, candidate] of [
      ['LEFT', { ...state, x: state.x - 1 }],
      ['RIGHT', { ...state, x: state.x + 1 }],
      ['DOWN', { ...state, y: state.y + 1 }],
    ] as const) {
      if (!collides(candidate)) queue.push({ ...candidate, path: [...state.path, token] });
    }
    for (const [delta, token] of [[1, 'CW'], [-1, 'CCW'], [2, '180']] as const) {
      const to = (state.rot + delta + 4) % 4;
      const kicks = (Math.abs(delta) === 2 ? JLSTZ_180 : JLSTZ_90)[`${state.rot}>${to}`] || [[0, 0]];
      for (const [kx, ky] of kicks) {
        const candidate = { x: state.x + kx, y: state.y + ky, rot: to, path: [...state.path, token] };
        if (collides(candidate)) continue;
        if (
          normalized(cellsFor(candidate)) === target
          && collides({ ...candidate, y: candidate.y + 1 })
        ) return candidate.path;
        queue.push(candidate);
        break;
      }
    }
  }
  return null;
};

describe('Dot Cannon build training', () => {
  it('contains two exact seven-piece targets', () => {
    for (const target of [...Object.values(DOT_CANNON_TARGETS), ...Object.values(DOT_CANNON_BAG_2_TARGETS)]) {
      expect(target.cells).toHaveLength(28);
      for (const piece of PIECES) expect(target.cellsByPiece[piece]).toHaveLength(4);
    }
  });

  it('mirrors and swaps the second-bag target for the right-side base', () => {
    expect(DOT_CANNON_BAG_2_TARGETS['left-j'].rows).toEqual([
      'IS........',
      'ISSJJ..LOO',
      'I.SJ...LOO',
      'I..JTZZLL.',
      '....TTZZ..',
      '....T.....',
      '..........',
    ]);
    expect(DOT_CANNON_BAG_2_TARGETS['right-l'].rows).toEqual([
      '........ZI',
      'OOJ..LLZZI',
      'OOJ...LZ.I',
      '.JJSSTL..I',
      '..SSTT....',
      '.....T....',
      '..........',
    ]);
  });

  it('selects the J-side or L-side target from their relative bag order', () => {
    const jFirst = ['I', 'J', 'O', 'S', 'L', 'T', 'Z'] as const;
    const lFirst = ['I', 'L', 'O', 'S', 'J', 'T', 'Z'] as const;
    expect(selectDotCannonVariant([...jFirst])).toBe('left-j');
    expect(selectDotCannonVariant([...lFirst])).toBe('right-l');
    expect(describeDotCannonVariant([...jFirst])).toBe('J #2가 L #5보다 먼저 · LEFT J 기본형');
    expect(describeDotCannonVariant([...lFirst])).toBe('L #2가 J #5보다 먼저 · RIGHT L 대칭형');
  });

  it('conditions the first bag for a requested side without biasing the other pieces', () => {
    const definition = getBuildDefinition('dot-cannon');
    const bags = permutations([...PIECES] as BuildPiece[]);
    const leftBags = bags.map((bag) => definition.prepareOpeningBag(bag, 'left-j'));
    const rightBags = bags.map((bag) => definition.prepareOpeningBag(bag, 'right-l'));

    expect(leftBags.every((bag) => selectDotCannonVariant(bag) === 'left-j')).toBe(true);
    expect(rightBags.every((bag) => selectDotCannonVariant(bag) === 'right-l')).toBe(true);
    expect(new Set(leftBags.map((bag) => bag.join(''))).size).toBe(2520);
    expect(new Set(rightBags.map((bag) => bag.join(''))).size).toBe(2520);
    bags.forEach((bag, index) => {
      expect(leftBags[index].filter((piece) => !['J', 'L'].includes(piece)))
        .toEqual(bag.filter((piece) => !['J', 'L'].includes(piece)));
      expect(rightBags[index].filter((piece) => !['J', 'L'].includes(piece)))
        .toEqual(bag.filter((piece) => !['J', 'L'].includes(piece)));
    });
  });

  it('uses the conditioned bag in both the session and the live randomizer queue', () => {
    const original = {
      buildId: config.training.buildId,
      buildPhase: config.training.buildPhase,
      buildVariant: config.training.buildVariant,
    };
    try {
      config.training.buildId = 'dot-cannon';
      config.training.buildPhase = 'full';
      config.training.buildVariant = 'right-l';
      const bags = [
        ['I', 'J', 'O', 'S', 'L', 'T', 'Z'],
        ['T', 'I', 'O', 'J', 'S', 'Z', 'L'],
        ['I', 'J', 'L', 'O', 'S', 'T', 'Z'],
      ];
      const engine = Object.create(GameEngine.prototype) as any;
      engine.randomizer = {
        queue: bags.flat(),
        ensure: () => {},
        peek(count: number) { return this.queue.slice(0, count); },
      };
      engine.board = makeBoard();
      engine.updateBuildCoach = () => {};

      engine.initializeBuildSession(44);

      expect(selectDotCannonVariant(engine.randomizer.queue.slice(0, 7))).toBe('right-l');
      expect(engine.buildSession.bag).toEqual(engine.randomizer.queue.slice(0, 7));
      expect(engine.buildFullBags[0]).toEqual(engine.buildSession.bag);
      expect(engine.buildFullBags[1]).toEqual(bags[1]);
      expect(engine.buildFullBags[2]).toEqual(bags[2]);
    } finally {
      Object.assign(config.training, original);
    }
  });

  it('preserves the first-bag variant across every stage of full practice', () => {
    const firstBag = ['I', 'L', 'O', 'S', 'J', 'T', 'Z'] as const;
    const secondBag = ['T', 'I', 'O', 'J', 'S', 'Z', 'L'] as const;
    const thirdBag = ['Z', 'S', 'O', 'L', 'J', 'I', 'T'] as const;
    const first = createDotCannonSession(21, [...firstBag], 'bag-1', {
      practiceId: 'full',
      variantBag: [...firstBag],
    });
    const second = createDotCannonSession(21, [...secondBag], 'bag-2', {
      practiceId: 'full',
      variant: first.variant,
      variantBag: [...firstBag],
    });
    const third = createDotCannonSession(21, [...thirdBag], 'pc-3', {
      practiceId: 'full',
      variant: first.variant,
      variantBag: [...firstBag],
    });
    expect(first.variant).toBe('right-l');
    expect(second.variant).toBe('right-l');
    expect(third.variant).toBe('right-l');
    expect(first.practiceId).toBe('full');
    expect(second.practiceId).toBe('full');
    expect(third.practiceId).toBe('full');
    expect(second.variantReason).toBe(first.variantReason);
    expect(third.variantReason).toBe(first.variantReason);

    const progress = createEmptyBuildProgress();
    recordBuildResult(progress, third, true);
    expect(progress.phases.full).toEqual({ attempts: 1, successes: 1 });
    expect(progress.phases['pc-3']).toEqual({ attempts: 0, successes: 0 });
  }, 30_000);

  it('advances a full run to the next exact bag while clearing boundary hold state', () => {
    const bags = [
      ['I', 'J', 'O', 'S', 'L', 'T', 'Z'],
      ['T', 'I', 'O', 'J', 'S', 'Z', 'L'],
      ['I', 'J', 'L', 'O', 'S', 'T', 'Z'],
    ] as const;
    expect(findDotCannonPcWitnesses([...bags[2]], 'left-j').length).toBeGreaterThan(0);
    const engine = Object.create(GameEngine.prototype) as any;
    engine.seed = 33;
    engine.buildFullBags = bags.map((bag) => [...bag]);
    engine.randomizer = { queue: [] };
    engine.current = { type: 'T' };
    engine.holdType = 'I';
    engine.canHold = false;
    engine.areRemaining = 8;
    engine.buildSession = createDotCannonSession(33, [...bags[0]], 'bag-1', {
      practiceId: 'full',
      variantBag: [...bags[0]],
    });
    engine.showAction = () => {};
    engine.spawnNext = () => {};
    engine.updateHUD = () => {};
    engine.finish = () => { throw new Error('The selected third bag should have a PC witness.'); };

    expect(engine.advanceFullBuildStage()).toBe(true);
    expect(engine.buildSession.phaseId).toBe('bag-2');
    expect(engine.buildSession.variant).toBe('left-j');
    expect(engine.randomizer.queue).toEqual([...bags[1], ...bags[2]]);
    expect(engine.holdType).toBeNull();
    expect(engine.canHold).toBe(true);
    expect(engine.areRemaining).toBe(0);

    expect(engine.advanceFullBuildStage()).toBe(true);
    expect(engine.buildSession.phaseId).toBe('pc-3');
    expect(engine.buildSession.practiceId).toBe('full');
    expect(engine.randomizer.queue).toEqual([...bags[2]]);
  }, 30_000);

  it('accepts only the exact colored target placement for each piece', () => {
    const session = createDotCannonSession(1, ['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
    const targetCells = session.target.cellsByPiece.I;
    expect(evaluateDotCannonPlacement(session, 'I', targetCells).success).toBe(true);
    expect(evaluateDotCannonPlacement(session, 'I', targetCells.map(([x, y]) => [x - 1, y]))).toEqual({
      success: false,
      reason: 'I 미노가 목표 위치에서 벗어났습니다.',
    });
    session.placedTypes.push('I');
    expect(evaluateDotCannonPlacement(session, 'I', targetCells).success).toBe(false);
  });

  it('uses colored piece guides for beginners, a silhouette for intermediate players, and none for experts', () => {
    const session = createDotCannonSession(1, ['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
    const beginner = buildGuideCells(session, 'beginner');
    const intermediate = buildGuideCells(session, 'intermediate');
    expect(beginner).toHaveLength(28);
    expect(beginner.every((cell) => !Object.hasOwn(cell, 'active'))).toBe(true);
    expect(beginner.every((cell) => cell.displayType)).toBe(true);
    expect(intermediate.every((cell) => cell.displayType === null && !Object.hasOwn(cell, 'active'))).toBe(true);
    expect(buildGuideCells(session, 'expert')).toEqual([]);
  });

  it('recognizes the completed colored target board', () => {
    const session = createDotCannonSession(1, ['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
    const board = makeBoard();
    for (const piece of PIECES) {
      const cells = session.expectedCellsByPiece[piece];
      commitDotCannonPlacement(session, piece, cells);
      for (const [x, y] of cells) board[y][x] = piece;
    }
    expect(buildTargetMatchesBoard(session, board)).toBe(true);
    board[BOARD_H - 1][0] = null;
    expect(buildTargetMatchesBoard(session, board)).toBe(false);
  });

  it('finishes bag 2 by spinning T into the lower cavity for a triple', () => {
    const session = createDotCannonSession(2, ['I', 'J', 'L', 'O', 'S', 'T', 'Z'], 'bag-2');
    expect(session.initialCells).toHaveLength(28);
    expect(session.expectedBoardCells).toEqual(session.initialCells);
    const board = makeBoard();
    for (const cell of session.initialCells) board[cell.y][cell.x] = cell.type;
    for (const piece of ['I', 'S', 'J', 'L', 'O', 'Z'] as const) {
      const cells = session.expectedCellsByPiece[piece];
      commitDotCannonPlacement(session, piece, cells);
      for (const [x, y] of cells) board[y][x] = piece;
    }
    expect(board.filter((row) => row.every(Boolean))).toHaveLength(0);

    const tCells = session.expectedCellsByPiece.T;
    expect(tCells).toEqual([[4, 36], [4, 37], [5, 37], [4, 38]]);
    const route = findTstRoute(board, tCells);
    expect(route).not.toBeNull();
    expect(['CW', 'CCW', '180']).toContain(route?.at(-1));
    commitDotCannonPlacement(session, 'T', tCells);
    for (const [x, y] of tCells) board[y][x] = 'T';
    const clearedRows = board.flatMap((row, y) => row.every(Boolean) ? [y] : []);
    expect(clearedRows).toEqual([36, 37, 38]);
    expect(evaluateDotCannonTechnique(session, 'T', { tSpin: true, lines: 3 }).success).toBe(true);
    expect(evaluateDotCannonTechnique(session, 'T', { tSpin: false, lines: 3 }).success).toBe(false);
    expect(evaluateDotCannonTechnique(session, 'T', { tSpin: true, lines: 1 }).success).toBe(false);

    for (let index = clearedRows.length - 1; index >= 0; index -= 1) board.splice(clearedRows[index], 1);
    while (board.length < BOARD_H) board.unshift(Array(BOARD_W).fill(null));
    advanceDotCannonAfterLineClear(session, clearedRows);
    expect(buildTargetMatchesBoard(session, board)).toBe(true);
    expect(board.flatMap((row) => row.filter(Boolean))).toHaveLength(26);
    expect(board.flatMap((row, y) => row.flatMap((cell, x) => cell ? [`${x},${y}`] : [])).sort()).toEqual(
      DOT_CANNON_PC_INITIAL_CELLS['left-j'].map(({ x, y }) => `${x},${y}`).sort(),
    );

    const mirrored = createDotCannonSession(1, ['I', 'J', 'L', 'O', 'S', 'T', 'Z'], 'bag-2');
    const mirroredBoard = makeBoard();
    for (const cell of mirrored.initialCells) mirroredBoard[cell.y][cell.x] = cell.type;
    for (const piece of ['I', 'S', 'J', 'L', 'O', 'Z'] as const) {
      const cells = mirrored.expectedCellsByPiece[piece];
      commitDotCannonPlacement(mirrored, piece, cells);
      for (const [x, y] of cells) mirroredBoard[y][x] = piece;
    }
    const mirroredT = mirrored.expectedCellsByPiece.T;
    expect(mirroredT).toEqual([[5, 36], [4, 37], [5, 37], [5, 38]]);
    expect(findTstRoute(mirroredBoard, mirroredT)).not.toBeNull();
    commitDotCannonPlacement(mirrored, 'T', mirroredT);
    for (const [x, y] of mirroredT) mirroredBoard[y][x] = 'T';
    const mirroredClears = mirroredBoard.flatMap((row, y) => row.every(Boolean) ? [y] : []);
    expect(mirroredClears).toEqual([36, 37, 38]);
    for (let index = mirroredClears.length - 1; index >= 0; index -= 1) mirroredBoard.splice(mirroredClears[index], 1);
    while (mirroredBoard.length < BOARD_H) mirroredBoard.unshift(Array(BOARD_W).fill(null));
    advanceDotCannonAfterLineClear(mirrored, mirroredClears);
    expect(buildTargetMatchesBoard(mirrored, mirroredBoard)).toBe(true);
    expect(mirroredBoard.flatMap((row, y) => row.flatMap((cell, x) => cell ? [`${x},${y}`] : [])).sort()).toEqual(
      DOT_CANNON_PC_INITIAL_CELLS['right-l'].map(({ x, y }) => `${x},${y}`).sort(),
    );
  });

  it('uses a new seed after success while preserving the selected miss policy', () => {
    expect(shouldReuseBuildSeed(true, 'same')).toBe(false);
    expect(shouldReuseBuildSeed(true, 'new')).toBe(false);
    expect(shouldReuseBuildSeed(false, 'same')).toBe(true);
    expect(shouldReuseBuildSeed(false, 'new')).toBe(false);
  });

  it('contains eight six-piece PC targets on the verified 26-cell base', () => {
    for (const variant of ['left-j', 'right-l'] as const) {
      expect(DOT_CANNON_PC_INITIAL_CELLS[variant]).toHaveLength(26);
      expect(DOT_CANNON_PC_SOLUTIONS[variant]).toHaveLength(8);
      for (const solution of DOT_CANNON_PC_SOLUTIONS[variant]) {
        expect(solution.cells).toHaveLength(24);
        expect(solution.requiredPieces).toHaveLength(6);
      }
    }
    expect(DOT_CANNON_PC_INITIAL_CELLS['right-l']).toEqual(
      DOT_CANNON_PC_INITIAL_CELLS['left-j'].map(({ x, y }) => ({ x: BOARD_W - 1 - x, y })),
    );
  });

  it('ships every PC reachability result as a precomputed static order table', () => {
    const solutionIds = Object.values(DOT_CANNON_PC_SOLUTIONS)
      .flat()
      .map((solution) => solution.id)
      .sort();
    expect(Object.keys(DOT_CANNON_PC_VALID_ORDERS).sort()).toEqual(solutionIds);
    expect(Object.values(DOT_CANNON_PC_VALID_ORDERS)
      .reduce((total, orders) => total + orders.length, 0)).toBe(1808);
    for (const solution of Object.values(DOT_CANNON_PC_SOLUTIONS).flat()) {
      const required = [...solution.requiredPieces].sort().join('');
      for (const order of DOT_CANNON_PC_VALID_ORDERS[solution.id]) {
        expect([...order].sort().join('')).toBe(required);
      }
    }
  });

  it('computes TETR.IO SRS+ and 180-degree PC coverage across every 7-bag order', () => {
    const bags = permutations([...PIECES]);
    expect(bags).toHaveLength(5040);
    expect(dotCannonPcCoverage(bags)).toBe(4414);
    expect(bags.filter((bag) => findDotCannonPcWitnesses(bag, 'right-l').length > 0)).toHaveLength(4414);
  }, 30_000);

  it('creates a six-piece PC session only from solutions feasible for its bag', () => {
    const bags = permutations([...PIECES]);
    const feasibleBag = bags.find((bag) => findDotCannonPcWitnesses(bag, 'left-j').length > 0)!;
    const unavailableBag = bags.find((bag) => findDotCannonPcWitnesses(bag, 'left-j').length === 0)!;
    const feasible = createDotCannonSession(8, feasibleBag, 'pc-3');
    const unavailable = createDotCannonSession(10, unavailableBag, 'pc-3');
    expect(feasible.pcPossible).toBe(true);
    expect(feasible.requiredPieces).toHaveLength(6);
    expect(feasible.initialCells).toHaveLength(26);
    expect(feasible.placementOrder).toHaveLength(6);
    expect(unavailable.pcPossible).toBe(false);
  }, 30_000);

  it('plays a selected PC witness through its real line-clear sequence', () => {
    const bag = permutations([...PIECES])
      .find((candidate) => findDotCannonPcWitnesses(candidate, 'left-j').length > 0)!;
    const session = createDotCannonSession(12, bag, 'pc-3');
    const board = makeBoard();
    for (const cell of session.initialCells) board[cell.y][cell.x] = cell.type;

    for (const piece of session.placementOrder) {
      const cells = session.expectedCellsByPiece[piece];
      expect(evaluateDotCannonPlacement(session, piece, cells).success).toBe(true);
      commitDotCannonPlacement(session, piece, cells);
      for (const [x, y] of cells) board[y][x] = piece;
      const rows = board.flatMap((row, y) => row.every(Boolean) ? [y] : []);
      for (let index = rows.length - 1; index >= 0; index -= 1) board.splice(rows[index], 1);
      while (board.length < BOARD_H) board.unshift(Array(BOARD_W).fill(null));
      advanceDotCannonAfterLineClear(session, rows);
    }

    expect(board.every((row) => row.every((cell) => cell === null))).toBe(true);
    expect(buildTargetMatchesBoard(session, board)).toBe(true);
  }, 30_000);

  it('tracks attempts, clears, streaks, and sanitized persisted data', () => {
    const session = createDotCannonSession(1, ['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
    const progress = createEmptyBuildProgress();
    recordBuildResult(progress, session, true);
    expect(progress).toMatchObject({ attempts: 1, successes: 1, streak: 1, bestStreak: 1 });
    expect(progress.phases['bag-1']).toEqual({ attempts: 1, successes: 1 });
    recordBuildResult(progress, session, false);
    expect(progress).toMatchObject({ attempts: 2, successes: 1, streak: 0, bestStreak: 1 });
    expect(sanitizeBuildProgress({ version: 1, attempts: -10, successes: '2' })).toMatchObject({
      attempts: 0,
      successes: 2,
    });
  });
});
