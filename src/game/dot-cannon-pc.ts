import {
  BOARD_H,
  BOARD_W,
  PIECES,
} from '../core/state';
import { DOT_CANNON_PC_VALID_ORDERS } from './dot-cannon-pc-orders';

type PieceType = typeof PIECES[number];
export type PcVariant = 'left-j' | 'right-l';

export type DotCannonPcCell = {
  x: number;
  y: number;
  type: PieceType;
};

export type DotCannonPcSolution = {
  id: string;
  label: string;
  variant: PcVariant;
  rows: string[];
  cells: DotCannonPcCell[];
  cellsByPiece: Record<PieceType, Array<[number, number]>>;
  requiredPieces: PieceType[];
};

export type DotCannonPcWitness = {
  solution: DotCannonPcSolution;
  placementOrder: PieceType[];
};

const PC_INITIAL_ROWS = [
  '..........',
  'XX........',
  'XXXXX..XXX',
  'XXXX...XXX',
  'XXXXX.XXXX',
];

const PC_SOLUTION_ROWS = [
  [
    'IIIILJJZOO',
    '..LLLJZZOO',
    '.....JZ...',
    '....TTT...',
    '.....T....',
  ],
  [
    'IIIILJJZOO',
    '..LLLJZZOO',
    '.....SS...',
    '....SSZ...',
    '.....J....',
  ],
  [
    'IIIILJJZOO',
    '..LLLJZZOO',
    '.....TZ...',
    '....TTT...',
    '.....J....',
  ],
  [
    'IIIILJSSOO',
    '..LLLJJJOO',
    '.....SS...',
    '....TTT...',
    '.....T....',
  ],
  [
    'JJJLLLSSOO',
    '..JLIIIIOO',
    '.....SS...',
    '....TTT...',
    '.....T....',
  ],
  [
    'JJJSIIIIOO',
    '..JSSLLLOO',
    '.....LZ...',
    '....SZZ...',
    '.....Z....',
  ],
  [
    'JJJSTTTZOO',
    '..JSSLZZOO',
    '.....LZ...',
    '....SLL...',
    '.....T....',
  ],
  [
    'IIIITTTZOO',
    '..JJJLZZOO',
    '.....LZ...',
    '....JLL...',
    '.....T....',
  ],
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

const makeCellsByPiece = () => Object.fromEntries(
  PIECES.map((piece) => [piece, []]),
) as Record<PieceType, Array<[number, number]>>;

const makeSolution = (index: number, rows: string[], variant: PcVariant): DotCannonPcSolution => {
  const cells: DotCannonPcCell[] = [];
  const cellsByPiece = makeCellsByPiece();
  const startY = BOARD_H - rows.length;
  rows.forEach((row, rowIndex) => {
    if (row.length !== BOARD_W) throw new Error(`Invalid Dot Cannon PC row: ${row}`);
    [...row].forEach((value, x) => {
      if (!PIECES.includes(value)) return;
      const type = value as PieceType;
      const y = startY + rowIndex;
      cells.push({ x, y, type });
      cellsByPiece[type].push([x, y]);
    });
  });
  const requiredPieces = PIECES.filter((piece) => cellsByPiece[piece].length === 4);
  if (requiredPieces.length !== 6) throw new Error(`Dot Cannon PC ${index + 1} must use six pieces.`);
  for (const piece of PIECES) {
    if (![0, 4].includes(cellsByPiece[piece].length)) {
      throw new Error(`Dot Cannon PC ${index + 1} has invalid ${piece} cells.`);
    }
  }
  return {
    id: `pc-${index + 1}-${variant}`,
    label: `PC SOLUTION ${index + 1}`,
    variant,
    rows,
    cells,
    cellsByPiece,
    requiredPieces,
  };
};

export const DOT_CANNON_PC_SOLUTIONS: Record<PcVariant, DotCannonPcSolution[]> = {
  'left-j': PC_SOLUTION_ROWS.map((rows, index) => makeSolution(index, rows, 'left-j')),
  'right-l': PC_SOLUTION_ROWS.map((rows, index) => makeSolution(index, mirrorRows(rows), 'right-l')),
};

const LEFT_PC_INITIAL_CELLS = PC_INITIAL_ROWS.flatMap((row, rowIndex) => (
  [...row].flatMap((value, x) => value === 'X' ? [{ x, y: BOARD_H - PC_INITIAL_ROWS.length + rowIndex }] : [])
));

export const DOT_CANNON_PC_INITIAL_CELLS: Record<PcVariant, Array<{ x: number; y: number }>> = {
  'left-j': LEFT_PC_INITIAL_CELLS,
  'right-l': LEFT_PC_INITIAL_CELLS.map(({ x, y }) => ({ x: BOARD_W - 1 - x, y })),
};

const solveBag = (solution: DotCannonPcSolution, bag: PieceType[]): PieceType[] | null => {
  const validOrders = DOT_CANNON_PC_VALID_ORDERS[
    solution.id as keyof typeof DOT_CANNON_PC_VALID_ORDERS
  ] as readonly string[] | undefined;
  if (!validOrders) throw new Error(`Missing precomputed Dot Cannon PC table: ${solution.id}`);
  const canPlayOrder = (order: PieceType[]) => {
    const memo = new Set<string>();
    const visit = (queueIndex: number, hold: PieceType | null, orderIndex: number): boolean => {
      if (orderIndex === order.length) return true;
      const key = `${queueIndex}|${hold || '-'}|${orderIndex}`;
      if (memo.has(key) || queueIndex >= bag.length) return false;
      memo.add(key);
      const current = bag[queueIndex];
      if (current === order[orderIndex] && visit(queueIndex + 1, hold, orderIndex + 1)) return true;
      if (hold) {
        if (hold === order[orderIndex] && visit(queueIndex + 1, current, orderIndex + 1)) return true;
      } else if (queueIndex + 1 < bag.length && bag[queueIndex + 1] === order[orderIndex]) {
        if (visit(queueIndex + 2, current, orderIndex + 1)) return true;
      }
      return false;
    };
    return visit(0, null, 0);
  };
  for (const encodedOrder of validOrders) {
    const order = [...encodedOrder] as PieceType[];
    if (canPlayOrder(order)) return order;
  }
  return null;
};

export const findDotCannonPcWitnesses = (bag: PieceType[], variant: PcVariant): DotCannonPcWitness[] => (
  DOT_CANNON_PC_SOLUTIONS[variant].flatMap((solution) => {
    const placementOrder = solveBag(solution, bag);
    return placementOrder ? [{ solution, placementOrder }] : [];
  })
);

export const selectDotCannonPcWitness = (
  bag: PieceType[],
  variant: PcVariant,
  seed: number,
) => {
  const witnesses = findDotCannonPcWitnesses(bag, variant);
  return {
    witnesses,
    selected: witnesses.length ? witnesses[(seed >>> 0) % witnesses.length] : null,
  };
};

export const dotCannonPcCoverage = (bags: PieceType[][]) => (
  bags.filter((bag) => findDotCannonPcWitnesses(bag, 'left-j').length > 0).length
);
