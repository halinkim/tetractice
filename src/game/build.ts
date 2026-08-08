import { BOARD_H, BOARD_W, PIECES } from '../core/state';
import type { BuildId } from '../builds/catalog';
import {
  DOT_CANNON_PC_INITIAL_CELLS,
  DOT_CANNON_PC_SOLUTIONS,
  selectDotCannonPcWitness,
} from './dot-cannon-pc';

type PieceType = typeof PIECES[number];
type BoardCellType = PieceType | 'G';

export type BuildDifficulty = 'beginner' | 'intermediate' | 'expert';
export type BuildRetryMode = 'same' | 'new';
export type DotCannonVariant = 'left-j' | 'right-l';
export type DotCannonStage = 'bag-1' | 'bag-2' | 'pc-3';
export type DotCannonPhase = DotCannonStage | 'full';

export type BuildCell = {
  x: number;
  y: number;
  type: BoardCellType;
};

export type BuildTarget = {
  id: string;
  label: string;
  rows: string[];
  cells: BuildCell[];
  cellsByPiece: Record<PieceType, Array<[number, number]>>;
  requiredPieces: PieceType[];
};

export type BuildSession = {
  buildId: BuildId;
  phaseId: DotCannonStage;
  practiceId: DotCannonPhase;
  seed: number;
  bag: PieceType[];
  variant: DotCannonVariant;
  variantReason: string;
  target: BuildTarget;
  requiredPieces: PieceType[];
  initialCells: BuildCell[];
  expectedCellsByPiece: Record<PieceType, Array<[number, number]>>;
  expectedBoardCells: BuildCell[];
  pcPossible: boolean;
  pcSolutionCount: number;
  placementOrder: PieceType[];
  placedTypes: PieceType[];
  failed: boolean;
  failureReason: string;
  recorded: boolean;
};

export type BuildProgress = {
  version: 1;
  attempts: number;
  successes: number;
  streak: number;
  bestStreak: number;
  variants: Record<DotCannonVariant, { attempts: number; successes: number }>;
  phases: Record<DotCannonPhase, { attempts: number; successes: number }>;
};

const LEFT_J_ROWS = [
  '.S........',
  '.SS......I',
  'JJSL....TI',
  'JOOL.ZZTTI',
  'JOOLL.ZZTI',
];

const RIGHT_L_ROWS = [
  '........Z.',
  'I......ZZ.',
  'IT....JZLL',
  'ITTSS.JOOL',
  'ITSS.JJOOL',
];

const LEFT_J_BAG_2_ROWS = [
  'IS........',
  'ISSJJ..LOO',
  'I.SJ...LOO',
  'I..JTZZLL.',
  '....TTZZ..',
  '....T.....',
  '..........',
];

const MIRROR_PIECE: Record<PieceType, PieceType> = {
  I: 'I',
  J: 'L',
  L: 'J',
  O: 'O',
  S: 'Z',
  T: 'T',
  Z: 'S',
};

const mirrorRows = (rows: string[]) => rows.map((row) => [...row]
  .reverse()
  .map((value) => PIECES.includes(value) ? MIRROR_PIECE[value as PieceType] : value)
  .join(''));

const makeTarget = (
  id: string,
  label: string,
  rows: string[],
  requiredPieces: PieceType[] = [...PIECES],
): BuildTarget => {
  const cells: BuildCell[] = [];
  const cellsByPiece = Object.fromEntries(PIECES.map((piece) => [piece, []])) as BuildTarget['cellsByPiece'];
  const startY = BOARD_H - rows.length;
  rows.forEach((row, rowIndex) => {
    if (row.length !== BOARD_W) throw new Error(`Invalid Dot Cannon row: ${row}`);
    [...row].forEach((value, x) => {
      if (!PIECES.includes(value)) return;
      const type = value as PieceType;
      const y = startY + rowIndex;
      cells.push({ x, y, type });
      cellsByPiece[type].push([x, y]);
    });
  });
  for (const piece of PIECES) {
    const expectedCount = requiredPieces.includes(piece) ? 4 : 0;
    if (cellsByPiece[piece].length !== expectedCount) {
      throw new Error(`Dot Cannon ${id} requires ${expectedCount} ${piece} cells.`);
    }
  }
  return { id, label, rows, cells, cellsByPiece, requiredPieces };
};

export const DOT_CANNON_TARGETS: Record<DotCannonVariant, BuildTarget> = {
  'left-j': makeTarget('left-j', 'LEFT · J SIDE', LEFT_J_ROWS),
  'right-l': makeTarget('right-l', 'RIGHT · L SIDE', RIGHT_L_ROWS),
};

export const DOT_CANNON_BAG_2_TARGETS: Record<DotCannonVariant, BuildTarget> = {
  'left-j': makeTarget('left-j', 'LEFT · FIXED BAG 2', LEFT_J_BAG_2_ROWS),
  'right-l': makeTarget('right-l', 'RIGHT · FIXED BAG 2', mirrorRows(LEFT_J_BAG_2_ROWS)),
};

export const createEmptyBuildProgress = (): BuildProgress => ({
  version: 1,
  attempts: 0,
  successes: 0,
  streak: 0,
  bestStreak: 0,
  variants: {
    'left-j': { attempts: 0, successes: 0 },
    'right-l': { attempts: 0, successes: 0 },
  },
  phases: {
    'bag-1': { attempts: 0, successes: 0 },
    'bag-2': { attempts: 0, successes: 0 },
    'pc-3': { attempts: 0, successes: 0 },
    full: { attempts: 0, successes: 0 },
  },
});

export const sanitizeBuildProgress = (candidate: any): BuildProgress => {
  const fallback = createEmptyBuildProgress();
  if (!candidate || candidate.version !== 1) return fallback;
  const number = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));
  return {
    version: 1,
    attempts: number(candidate.attempts),
    successes: number(candidate.successes),
    streak: number(candidate.streak),
    bestStreak: number(candidate.bestStreak),
    variants: {
      'left-j': {
        attempts: number(candidate.variants?.['left-j']?.attempts),
        successes: number(candidate.variants?.['left-j']?.successes),
      },
      'right-l': {
        attempts: number(candidate.variants?.['right-l']?.attempts),
        successes: number(candidate.variants?.['right-l']?.successes),
      },
    },
    phases: {
      'bag-1': {
        attempts: number(candidate.phases?.['bag-1']?.attempts),
        successes: number(candidate.phases?.['bag-1']?.successes),
      },
      'bag-2': {
        attempts: number(candidate.phases?.['bag-2']?.attempts),
        successes: number(candidate.phases?.['bag-2']?.successes),
      },
      'pc-3': {
        attempts: number(candidate.phases?.['pc-3']?.attempts),
        successes: number(candidate.phases?.['pc-3']?.successes),
      },
      full: {
        attempts: number(candidate.phases?.full?.attempts),
        successes: number(candidate.phases?.full?.successes),
      },
    },
  };
};

export const selectDotCannonVariant = (bag: PieceType[]): DotCannonVariant => {
  const jIndex = bag.indexOf('J');
  const lIndex = bag.indexOf('L');
  if (jIndex < 0 || lIndex < 0) throw new Error('Dot Cannon practice requires a complete 7-bag.');
  return jIndex < lIndex ? 'left-j' : 'right-l';
};

export const describeDotCannonVariant = (bag: PieceType[], variant = selectDotCannonVariant(bag)) => {
  const jPosition = bag.indexOf('J') + 1;
  const lPosition = bag.indexOf('L') + 1;
  if (jPosition <= 0 || lPosition <= 0) throw new Error('Dot Cannon practice requires J and L in its 7-bag.');
  return variant === 'left-j'
    ? `J #${jPosition}가 L #${lPosition}보다 먼저 · LEFT J 기본형`
    : `L #${lPosition}가 J #${jPosition}보다 먼저 · RIGHT L 대칭형`;
};

const cloneCellsByPiece = (cellsByPiece: BuildTarget['cellsByPiece']) => Object.fromEntries(
  PIECES.map((piece) => [piece, cellsByPiece[piece].map(([x, y]) => [x, y])]),
) as BuildTarget['cellsByPiece'];

export type BuildSessionOptions = {
  practiceId?: DotCannonPhase;
  variant?: DotCannonVariant;
  variantBag?: PieceType[];
};

export const createDotCannonSession = (
  seed: number,
  bag: PieceType[],
  phaseId: DotCannonStage = 'bag-1',
  options: BuildSessionOptions = {},
): BuildSession => {
  const variant = options.variant || (phaseId === 'bag-1'
    ? selectDotCannonVariant(bag)
    : (seed >>> 0) % 2 === 0 ? 'left-j' : 'right-l');
  const variantReason = options.variantBag
    ? describeDotCannonVariant(options.variantBag, variant)
    : phaseId === 'bag-1'
      ? describeDotCannonVariant(bag, variant)
      : `독립 단계 연습 · ${variant === 'left-j' ? 'LEFT J 기본형' : 'RIGHT L 대칭형'}`;
  const pc = phaseId === 'pc-3' ? selectDotCannonPcWitness(bag, variant, seed) : null;
  const pcTarget = pc?.selected?.solution || DOT_CANNON_PC_SOLUTIONS[variant][0];
  const target: BuildTarget = phaseId === 'pc-3'
    ? pcTarget
    : phaseId === 'bag-2' ? DOT_CANNON_BAG_2_TARGETS[variant] : DOT_CANNON_TARGETS[variant];
  const initialCells: BuildCell[] = phaseId === 'pc-3'
    ? DOT_CANNON_PC_INITIAL_CELLS[variant].map(({ x, y }) => ({ x, y, type: 'G' }))
    : phaseId === 'bag-2' ? DOT_CANNON_TARGETS[variant].cells.map((cell) => ({ ...cell })) : [];
  return {
    buildId: 'dot-cannon',
    phaseId,
    practiceId: options.practiceId || phaseId,
    seed,
    bag: [...bag],
    variant,
    variantReason,
    target,
    requiredPieces: [...target.requiredPieces],
    initialCells,
    expectedCellsByPiece: cloneCellsByPiece(target.cellsByPiece),
    expectedBoardCells: initialCells.map((cell) => ({ ...cell })),
    pcPossible: phaseId !== 'pc-3' || Boolean(pc?.selected),
    pcSolutionCount: pc?.witnesses.length || 0,
    placementOrder: pc?.selected?.placementOrder || [],
    placedTypes: [],
    failed: false,
    failureReason: '',
    recorded: false,
  };
};

const BUILD_SESSION_FACTORIES: Record<BuildId, typeof createDotCannonSession> = {
  'dot-cannon': createDotCannonSession,
};

export const createBuildSession = (
  buildId: BuildId,
  seed: number,
  bag: PieceType[],
  phaseId: DotCannonStage = 'bag-1',
  options: BuildSessionOptions = {},
) => BUILD_SESSION_FACTORIES[buildId](seed, bag, phaseId, options);

const normalizedCells = (cells: Array<[number, number]>) => cells
  .map(([x, y]) => `${x},${y}`)
  .sort()
  .join('|');

export const evaluateDotCannonPlacement = (
  session: BuildSession,
  type: PieceType,
  cells: Array<[number, number]>,
) => {
  if (session.placedTypes.includes(type)) {
    return { success: false, reason: `${type} 미노는 이미 배치했습니다.` };
  }
  const expected = session.expectedCellsByPiece[type];
  if (normalizedCells(expected) !== normalizedCells(cells)) {
    return { success: false, reason: `${type} 미노가 목표 위치에서 벗어났습니다.` };
  }
  return { success: true, reason: '' };
};

export const evaluateDotCannonTechnique = (
  session: BuildSession,
  type: PieceType,
  result: { tSpin: boolean; lines: number },
) => {
  if (session.phaseId === 'bag-2' && type === 'T' && (!result.tSpin || result.lines !== 3)) {
    return {
      success: false,
      reason: 'T 미노를 중앙 아래 홈으로 스핀해 T-Spin Triple로 3줄을 지워야 합니다.',
    };
  }
  return { success: true, reason: '' };
};

export const commitDotCannonPlacement = (
  session: BuildSession,
  type: PieceType,
  cells: Array<[number, number]>,
) => {
  session.placedTypes.push(type);
  session.expectedBoardCells.push(...cells.map(([x, y]) => ({ x, y, type })));
};

const shiftAfterLineClear = (y: number, clearedRows: number[]) => (
  y + clearedRows.filter((row) => row > y).length
);

export const advanceDotCannonAfterLineClear = (session: BuildSession, clearedRows: number[]) => {
  if (!clearedRows.length) return;
  const cleared = new Set(clearedRows);
  session.expectedBoardCells = session.expectedBoardCells
    .filter((cell) => !cleared.has(cell.y))
    .map((cell) => ({ ...cell, y: shiftAfterLineClear(cell.y, clearedRows) }));
  for (const piece of PIECES) {
    if (session.placedTypes.includes(piece)) continue;
    session.expectedCellsByPiece[piece] = session.expectedCellsByPiece[piece]
      .filter(([, y]) => !cleared.has(y))
      .map(([x, y]) => [x, shiftAfterLineClear(y, clearedRows)]);
  }
};

export const buildTargetMatchesBoard = (session: BuildSession, board: any[][]) => {
  const expected = new Map(session.expectedBoardCells.map(({ x, y, type }) => [`${x},${y}`, type]));
  for (let y = 0; y < BOARD_H; y += 1) {
    for (let x = 0; x < BOARD_W; x += 1) {
      const type = board[y]?.[x] || null;
      const targetType = expected.get(`${x},${y}`) || null;
      if (type !== targetType) return false;
    }
  }
  return true;
};

export const buildGuideCells = (
  session: BuildSession | null,
  difficulty: BuildDifficulty,
) => {
  if (!session || difficulty === 'expert') return [];
  const placed = new Set(session.placedTypes);
  return PIECES.flatMap((type) => placed.has(type) ? [] : session.expectedCellsByPiece[type].map(([x, y]) => ({
    x,
    y,
    type,
    displayType: difficulty === 'beginner' ? type : null,
  })));
};

export const buildCoachMessage = (session: BuildSession | null, currentType?: PieceType | null) => {
  if (!session) return { title: 'DOT CANNON', detail: '가방을 준비하고 있습니다.' };
  const remaining = session.requiredPieces.filter((piece) => !session.placedTypes.includes(piece));
  if (!currentType) {
    return {
      title: session.target.label,
      detail: session.phaseId === 'pc-3'
        ? `PC 가능 · ${session.pcSolutionCount}개 해법 · 선택 해법의 6미노를 완성하세요.`
        : session.phaseId === 'bag-2'
        ? `남은 미노 ${remaining.length}개 · 1가방 바닥에서 고정 형태를 완성하세요.`
        : `남은 미노 ${remaining.length}개 · ${session.variantReason}`,
    };
  }
  if (!remaining.includes(currentType)) {
    const alreadyPlaced = session.placedTypes.includes(currentType);
    return {
      title: 'HOLD THIS MINO',
      detail: alreadyPlaced
        ? `${currentType}는 이미 사용했습니다. 홀드로 넘기고 남은 가방 미노를 꺼내세요.`
        : `이번 PC 해법에서는 ${currentType}를 사용하지 않습니다. HOLD로 넘기고 목표 미노를 꺼내세요.`,
    };
  }
  if (session.phaseId === 'bag-2' && currentType === 'T') {
    return {
      title: 'T-SPIN TRIPLE',
      detail: 'T를 위에 잠그지 말고 세로로 소프트드롭한 뒤, 중앙 아래 홈으로 회전시켜 3줄을 지우세요.',
    };
  }
  return {
    title: `${currentType} TARGET`,
    detail: `${session.target.label} · 흐린 목표 네 칸에 정확히 배치하세요.${session.phaseId === 'bag-1' ? ` 선택 기준: ${session.variantReason}.` : session.phaseId === 'pc-3' ? ' TETR.IO SRS+·180° 기준입니다.' : session.phaseId === 'bag-2' ? ' 180° 회전도 사용할 수 있습니다.' : ''}`,
  };
};

export const shouldReuseBuildSeed = (success: boolean | undefined, retryMode: BuildRetryMode) => (
  success === true ? false : retryMode === 'same'
);

export const recordBuildResult = (progress: BuildProgress, session: BuildSession, success: boolean) => {
  progress.attempts += 1;
  progress.successes += success ? 1 : 0;
  progress.streak = success ? progress.streak + 1 : 0;
  progress.bestStreak = Math.max(progress.bestStreak, progress.streak);
  const variant = progress.variants[session.variant];
  variant.attempts += 1;
  variant.successes += success ? 1 : 0;
  const phase = progress.phases[session.practiceId];
  phase.attempts += 1;
  phase.successes += success ? 1 : 0;
};
