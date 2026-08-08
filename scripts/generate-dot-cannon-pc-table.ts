import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BOARD_H,
  BOARD_W,
  I_180,
  I_90_SRS_PLUS,
  JLSTZ_180,
  JLSTZ_90,
  PIECES,
  SHAPES,
} from '../src/core/state';
import {
  DOT_CANNON_PC_INITIAL_CELLS,
  DOT_CANNON_PC_SOLUTIONS,
  type DotCannonPcSolution,
  type PcVariant,
} from '../src/game/dot-cannon-pc';

type PieceType = typeof PIECES[number];
type PlacementState = { x: number; y: number; rot: number };
type OccupancyBoard = boolean[][];

const normalizedCells = (cells: Array<[number, number]>) => cells
  .map(([x, y]) => `${x},${y}`)
  .sort()
  .join('|');

const cellsFor = (type: PieceType, state: PlacementState): Array<[number, number]> => (
  SHAPES[type][state.rot].map(([dx, dy]) => [state.x + dx, state.y + dy])
);

const collides = (board: OccupancyBoard, type: PieceType, state: PlacementState) => {
  for (const [x, y] of cellsFor(type, state)) {
    if (x < 0 || x >= BOARD_W || y >= BOARD_H || y < -4) return true;
    if (y >= 0 && board[y][x]) return true;
  }
  return false;
};

const rotate = (
  board: OccupancyBoard,
  type: PieceType,
  state: PlacementState,
  delta: number,
): PlacementState | null => {
  if (type === 'O') return null;
  const to = (state.rot + delta + 4) % 4;
  const key = `${state.rot}>${to}`;
  const table = Math.abs(delta) === 2
    ? (type === 'I' ? I_180 : JLSTZ_180)[key] || [[0, 0]]
    : (type === 'I' ? I_90_SRS_PLUS : JLSTZ_90)[key] || [[0, 0]];
  for (const [kx, ky] of table) {
    const candidate = { x: state.x + kx, y: state.y + ky, rot: to };
    if (!collides(board, type, candidate)) return candidate;
  }
  return null;
};

const canReachTarget = (
  board: OccupancyBoard,
  type: PieceType,
  targetCells: Array<[number, number]>,
) => {
  const targetKey = normalizedCells(targetCells);
  const start = { x: 3, y: 19, rot: 0 };
  if (collides(board, type, start)) return false;
  const queue = [start];
  const seen = new Set<string>();
  for (let index = 0; index < queue.length; index += 1) {
    const state = queue[index];
    const key = `${state.x},${state.y},${state.rot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (
      normalizedCells(cellsFor(type, state)) === targetKey
      && collides(board, type, { ...state, y: state.y + 1 })
    ) return true;
    const candidates: Array<PlacementState | null> = [
      { ...state, x: state.x - 1 },
      { ...state, x: state.x + 1 },
      { ...state, y: state.y + 1 },
      rotate(board, type, state, 1),
      rotate(board, type, state, -1),
      rotate(board, type, state, 2),
    ];
    for (const candidate of candidates) {
      if (!candidate || collides(board, type, candidate)) continue;
      const candidateKey = `${candidate.x},${candidate.y},${candidate.rot}`;
      if (!seen.has(candidateKey)) queue.push(candidate);
    }
  }
  return false;
};

const initialPcBoard = (variant: PcVariant) => {
  const board = Array.from({ length: BOARD_H }, () => Array(BOARD_W).fill(false));
  for (const { x, y } of DOT_CANNON_PC_INITIAL_CELLS[variant]) board[y][x] = true;
  return board;
};

const clearBoardRows = (board: OccupancyBoard, rows: number[]) => {
  const next = board.map((row) => [...row]);
  for (let index = rows.length - 1; index >= 0; index -= 1) next.splice(rows[index], 1);
  while (next.length < BOARD_H) next.unshift(Array(BOARD_W).fill(false));
  return next;
};

const shiftTargetCells = (cells: Array<[number, number]>, rows: number[]) => {
  const cleared = new Set(rows);
  return cells
    .filter(([, y]) => !cleared.has(y))
    .map(([x, y]) => [x, y + rows.filter((row) => row > y).length] as [number, number]);
};

const createValidOrders = (solution: DotCannonPcSolution) => {
  const validOrders: PieceType[][] = [];
  const visit = (
    board: OccupancyBoard,
    targets: Record<PieceType, Array<[number, number]>>,
    remaining: PieceType[],
    order: PieceType[],
  ) => {
    if (!remaining.length) {
      if (!board.some((row) => row.some(Boolean))) validOrders.push([...order]);
      return;
    }
    for (const piece of remaining) {
      const cells = targets[piece];
      if (cells.length !== 4 || !canReachTarget(board, piece, cells)) continue;
      const placedBoard = board.map((row) => [...row]);
      for (const [x, y] of cells) placedBoard[y][x] = true;
      const clearedRows: number[] = [];
      placedBoard.forEach((row, y) => { if (row.every(Boolean)) clearedRows.push(y); });
      const nextBoard = clearBoardRows(placedBoard, clearedRows);
      const nextRemaining = remaining.filter((candidate) => candidate !== piece);
      const nextTargets = Object.fromEntries(PIECES.map((candidate) => [
        candidate,
        nextRemaining.includes(candidate)
          ? shiftTargetCells(targets[candidate], clearedRows)
          : targets[candidate].map(([x, y]) => [x, y]),
      ])) as Record<PieceType, Array<[number, number]>>;
      if (nextRemaining.some((candidate) => nextTargets[candidate].length !== 4)) continue;
      visit(nextBoard, nextTargets, nextRemaining, [...order, piece]);
    }
  };
  visit(
    initialPcBoard(solution.variant),
    Object.fromEntries(PIECES.map((piece) => [
      piece,
      solution.cellsByPiece[piece].map(([x, y]) => [x, y]),
    ])) as Record<PieceType, Array<[number, number]>>,
    solution.requiredPieces,
    [],
  );
  return validOrders;
};

const generateDotCannonPcOrderTable = () => Object.fromEntries(
  Object.values(DOT_CANNON_PC_SOLUTIONS).flat().map((solution) => [
    solution.id,
    createValidOrders(solution).map((order) => order.join('')),
  ]),
) as Record<string, string[]>;

const table = generateDotCannonPcOrderTable();
const target = resolve(process.cwd(), 'src/game/dot-cannon-pc-orders.ts');
const source = `// Generated by npm run generate:dot-cannon-pc. Do not edit by hand.\n`
  + `export const DOT_CANNON_PC_VALID_ORDERS = ${JSON.stringify(table, null, 2)} as const;\n`;

writeFileSync(target, source, 'utf8');

const orderCount = Object.values(table).reduce((total, orders) => total + orders.length, 0);
console.log(`Generated ${Object.keys(table).length} Dot Cannon PC tables (${orderCount} valid orders).`);
