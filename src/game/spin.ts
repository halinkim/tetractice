import {
  BOARD_H,
  BOARD_W,
  I_180,
  I_90_SRS,
  I_90_SRS_PLUS,
  JLSTZ_180,
  JLSTZ_90,
} from '../core/state';
import { cellsKey, collidesWithBoard, dropPlacement, pieceCells } from './finesse';

const STATE_LABELS = ['0', 'R', '2', 'L'];
const ROTATION_TOKENS = { 1: 'rotateCW', '-1': 'rotateCCW', 2: 'rotate180' };
const LINE_NAMES = { 1: 'SINGLE', 2: 'DOUBLE', 3: 'TRIPLE' };

const spinStateName = (type, rot) => {
  const state = ((rot % 4) + 4) % 4;
  if (type === 'S' || type === 'Z') return [
    '처음 가로 (0)',
    '오른쪽 세로 (R)',
    '반대 가로 (2)',
    '왼쪽 세로 (L)',
  ][state];
  if (type === 'T') return [
    '돌기 위 (0)',
    '돌기 오른쪽 (R)',
    '돌기 아래 (2)',
    '돌기 왼쪽 (L)',
  ][state];
  if (type === 'I') return [
    '처음 가로 (0)',
    '오른쪽 세로 (R)',
    '반대 가로 (2)',
    '왼쪽 세로 (L)',
  ][state];
  if (type === 'J' || type === 'L') return [
    '처음 가로 (0)',
    '오른쪽 세로 (R)',
    '뒤집힌 가로 (2)',
    '왼쪽 세로 (L)',
  ][state];
  return ['처음 방향 (0)', '오른쪽 90° (R)', '180° 방향 (2)', '왼쪽 90° (L)'][state];
};

const makeBoard = () => Array.from({ length: BOARD_H }, () => Array(BOARD_W).fill(null));
const cloneBoard = (board) => board.map((row) => [...row]);
const inBounds = (x, y) => x >= 0 && x < BOARD_W && y >= 0 && y < BOARD_H;

const kickTable = (type, from, to, rotationSystem = 'srsplus') => {
  const key = `${from}>${to}`;
  if ((from + 2) % 4 === to) return type === 'I' ? I_180[key] || [[0, 0]] : JLSTZ_180[key] || [[0, 0]];
  if (type === 'I') return (rotationSystem === 'srs' ? I_90_SRS : I_90_SRS_PLUS)[key] || [[0, 0]];
  return JLSTZ_90[key] || [[0, 0]];
};

const rotationDelta = (from, to) => ((from + 1) % 4 === to ? 1 : (from + 3) % 4 === to ? -1 : (from + 2) % 4 === to ? 2 : 0);

const rotateWithKicks = (type, state, to, board, rotationSystem = 'srsplus') => {
  const table = kickTable(type, state.rot, to, rotationSystem);
  for (let index = 0; index < table.length; index += 1) {
    const [kickX, kickY] = table[index];
    const candidate = { x: state.x + kickX, y: state.y + kickY, rot: to };
    if (!collidesWithBoard(type, candidate, board)) return { ...candidate, kickIndex: index };
  }
  return null;
};

const rotationEntriesForTarget = (type, target, board, rotationSystem = 'srsplus', options: any = {}) => {
  const targetKey = cellsKey(pieceCells(type, target));
  const entries: any[] = [];
  const deltas = options.allow180 ? [1, -1, 2] : [1, -1];
  for (const delta of deltas) {
    const fromRot = (target.rot - delta + 4) % 4;
    for (let y = Math.max(0, target.y - 3); y <= Math.min(BOARD_H - 1, target.y + 3); y += 1) {
      for (let x = target.x - 3; x <= target.x + 3; x += 1) {
        const start = { x, y, rot: fromRot };
        if (collidesWithBoard(type, start, board)) continue;
        const rotated = rotateWithKicks(type, start, target.rot, board, rotationSystem);
        if (!rotated || cellsKey(pieceCells(type, rotated)) !== targetKey) continue;
        entries.push({ start, delta, kickIndex: rotated.kickIndex });
      }
    }
  }
  return entries;
};

// Downward movement costs no finesse input. The returned timeline records the
// height at which each real input can be performed while the piece is falling.
const findSpinApproach = (type, target, board, rotationSystem = 'srsplus', options: any = {}) => {
  const spawn = { x: 3, y: 19, rot: 0, path: [], timeline: [] };
  if (collidesWithBoard(type, spawn, board)) return null;
  const queue: any[] = [spawn];
  const best = new Map([[`${spawn.x},${spawn.y},${spawn.rot}`, 0]]);
  while (queue.length) {
    const state = queue.shift();
    if (state.x === target.x && state.y === target.y && state.rot === target.rot) {
      return options.withTimeline ? { tokens: state.path, timeline: state.timeline } : state.path;
    }
    if (state.y > target.y + 2 || state.path.length > 12) continue;

    const fallen = { ...state, y: state.y + 1 };
    if (!collidesWithBoard(type, fallen, board)) {
      const key = `${fallen.x},${fallen.y},${fallen.rot}`;
      if (!best.has(key) || best.get(key) >= state.path.length) {
        best.set(key, state.path.length);
        queue.unshift({ ...fallen, path: state.path, timeline: state.timeline });
      }
    }

    const candidates: any[] = [];
    for (const [dx, token] of [[-1, 'left'], [1, 'right']] as any[]) {
      const moved = { ...state, x: state.x + dx };
      if (!collidesWithBoard(type, moved, board)) candidates.push({ ...moved, token });
    }
    const rotations: any[] = [[1, 'rotateCW'], [-1, 'rotateCCW']];
    if (options.allow180) rotations.push([2, 'rotate180']);
    for (const [delta, token] of rotations) {
      const to = (state.rot + delta + 4) % 4;
      const rotated = rotateWithKicks(type, state, to, board, rotationSystem);
      if (rotated) candidates.push({ x: rotated.x, y: rotated.y, rot: rotated.rot, token });
    }
    for (const candidate of candidates) {
      const depth = state.path.length + 1;
      const key = `${candidate.x},${candidate.y},${candidate.rot}`;
      if (best.has(key) && best.get(key) <= depth) continue;
      best.set(key, depth);
      queue.push({
        x: candidate.x,
        y: candidate.y,
        rot: candidate.rot,
        path: [...state.path, candidate.token],
        timeline: [...state.timeline, {
          token: candidate.token,
          atY: state.y,
          resultX: candidate.x,
          resultY: candidate.y,
          resultRot: candidate.rot,
        }],
      });
    }
  }
  return null;
};

// Builds a literal input sequence for SDF MAX. Unlike findSpinApproach, this
// does not assume that the player waits for an exact gravity height between
// inputs: every downward step means pressing Soft Drop until the piece stops.
const findSdfMaxRoute = (type, target, board, rotationSystem = 'srsplus', options: any = {}) => {
  const spawn = { x: 3, y: 19, rot: 0, path: [] };
  if (collidesWithBoard(type, spawn, board)) return null;
  const queue: any[] = [spawn];
  const bestDepth = new Map([[`${spawn.x},${spawn.y},${spawn.rot}`, 0]]);
  const rotations: any[] = options.preferCCW
    ? [[-1, 'rotateCCW'], [1, 'rotateCW']]
    : [[1, 'rotateCW'], [-1, 'rotateCCW']];
  if (options.allow180) rotations.push([2, 'rotate180']);

  while (queue.length) {
    const state = queue.shift();
    if (state.x === target.x && state.y === target.y && state.rot === target.rot) return state.path;
    if (state.path.length >= 14) continue;
    const candidates: any[] = [];
    for (const [dx, token] of [[-1, 'left'], [1, 'right']] as any[]) {
      const moved = { x: state.x + dx, y: state.y, rot: state.rot };
      if (!collidesWithBoard(type, moved, board)) candidates.push({ ...moved, token });
    }
    for (const [delta, token] of rotations) {
      const to = (state.rot + delta + 4) % 4;
      const rotated = rotateWithKicks(type, state, to, board, rotationSystem);
      if (rotated) candidates.push({ x: rotated.x, y: rotated.y, rot: rotated.rot, token });
    }
    const dropped = dropPlacement(type, state, board);
    if (dropped && dropped.y > state.y) candidates.push({ x: dropped.x, y: dropped.y, rot: dropped.rot, token: 'softDrop' });

    for (const candidate of candidates) {
      const depth = state.path.length + 1;
      const key = `${candidate.x},${candidate.y},${candidate.rot}`;
      if (bestDepth.has(key) && bestDepth.get(key) <= depth) continue;
      bestDepth.set(key, depth);
      queue.push({ x: candidate.x, y: candidate.y, rot: candidate.rot, path: [...state.path, candidate.token] });
    }
  }
  return null;
};

const simulateSdfMaxRoute = (type, route, board, rotationSystem = 'srsplus') => {
  let state: any = { x: 3, y: 19, rot: 0 };
  let lastRotation = null;
  const timeline: any[] = [];
  for (const token of route || []) {
    if (token === 'left' || token === 'right') {
      const candidate = { ...state, x: state.x + (token === 'left' ? -1 : 1) };
      if (collidesWithBoard(type, candidate, board)) return null;
      state = candidate;
      lastRotation = null;
    } else if (token === 'softDrop') {
      const candidate = dropPlacement(type, state, board);
      if (!candidate || candidate.y === state.y) return null;
      state = candidate;
    } else {
      const delta = token === 'rotateCW' ? 1 : token === 'rotateCCW' ? -1 : token === 'rotate180' ? 2 : 0;
      if (!delta) return null;
      const to = (state.rot + delta + 4) % 4;
      const rotated = rotateWithKicks(type, state, to, board, rotationSystem);
      if (!rotated) return null;
      lastRotation = { from: state.rot, to, delta, kickIndex: rotated.kickIndex };
      state = { x: rotated.x, y: rotated.y, rot: rotated.rot };
    }
    timeline.push({ token, resultX: state.x, resultY: state.y, resultRot: state.rot });
  }
  return { state, lastRotation, timeline };
};

const isImmobile = (type, state, board) => (
  [[-1, 0], [1, 0], [0, -1]].every(([dx, dy]) => (
    collidesWithBoard(type, { ...state, x: state.x + dx, y: state.y + dy }, board)
  ))
);

const tCornerCount = (state, board) => {
  const pivotX = state.x + 1;
  const pivotY = state.y + 1;
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].filter(([dx, dy]) => {
    const x = pivotX + dx;
    const y = pivotY + dy;
    return !inBounds(x, y) || Boolean(board[y][x]);
  }).length;
};

const tSpinClassification = (state, board, kickIndex = 0) => {
  const pivotX = state.x + 1;
  const pivotY = state.y + 1;
  const corners = [[pivotX - 1, pivotY - 1], [pivotX + 1, pivotY - 1], [pivotX - 1, pivotY + 1], [pivotX + 1, pivotY + 1]];
  const occupied = corners.map(([x, y]) => !inBounds(x, y) || Boolean(board[y][x]));
  const count = occupied.filter(Boolean).length;
  if (count < 3) return null;
  const frontByRot = { 0: [0, 1], 1: [1, 3], 2: [2, 3], 3: [0, 2] };
  const frontCount = frontByRot[state.rot].filter((index) => occupied[index]).length;
  const kind = frontCount >= 2 || kickIndex === 4 ? 'full' : 'mini';
  return { kind, count, frontCount, occupied };
};

const simulateSpinClear = (board, type, target) => {
  const placed = cloneBoard(board);
  if (collidesWithBoard(type, target, placed)) return null;
  for (const [x, y] of pieceCells(type, target)) placed[y][x] = type;
  const clearedRows = [];
  for (let y = 0; y < BOARD_H; y += 1) if (placed[y].every(Boolean)) clearedRows.push(y);
  const survivors = placed.filter((_, y) => !clearedRows.includes(y));
  const boardAfter = [
    ...Array.from({ length: clearedRows.length }, () => Array(BOARD_W).fill(null)),
    ...survivors,
  ];
  return { placed, clearedRows, boardAfter };
};

// Empty cells reachable from the top are usable surface space. Anything else
// is a sealed hole left inside the stack.
const hasEnclosedHole = (board) => {
  const reachable = new Set();
  const queue: any[] = [];
  for (let x = 0; x < BOARD_W; x += 1) {
    if (!board[0][x]) {
      reachable.add(`${x},0`);
      queue.push([x, 0]);
    }
  }
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (!inBounds(nx, ny) || board[ny][nx] || reachable.has(key)) continue;
      reachable.add(key);
      queue.push([nx, ny]);
    }
  }
  for (let y = 0; y < BOARD_H; y += 1) {
    for (let x = 0; x < BOARD_W; x += 1) {
      if (!board[y][x] && !reachable.has(`${x},${y}`)) return true;
    }
  }
  return false;
};

const isDirectHardDropReachable = (type, target, board) => {
  const targetKey = cellsKey(pieceCells(type, target));
  for (let rot = 0; rot < 4; rot += 1) {
    for (let x = -3; x < BOARD_W + 2; x += 1) {
      const landing = dropPlacement(type, { x, y: 19, rot }, board);
      if (landing && cellsKey(pieceCells(type, landing)) === targetKey) return true;
    }
  }
  return false;
};

const fillRowExcept = (board, y, holes, reserved) => {
  const empty = new Set(holes);
  for (let x = 0; x < BOARD_W; x += 1) {
    if (!empty.has(x) && !reserved.has(`${x},${y}`)) board[y][x] = 'J';
  }
};

const terrainRowsFromStrings = (startY, rows, mirrored = false) => rows.map((source, index) => {
  const row = mirrored ? [...source].reverse().join('') : source;
  return {
    y: startY + index,
    holes: [...row].flatMap((cell, x) => cell === '.' ? [x] : []),
  };
});

const BUILD_TOWER_A = [
  '........##',
  '........##',
  '........##',
  '........##',
  '######..##',
  '#####...##',
  '##......##',
  '###...####',
  '##.....###',
  '##......##',
  '##......##',
  '##......##',
  '##......##',
  '##......##',
];

const BUILD_TOWER_B = [
  '.......###',
  '#####..###',
  '####...###',
  '#......###',
  '#....#####',
  '###...####',
  '#......###',
  '#......###',
  '#......###',
  '#......###',
  '#......###',
  '#......###',
  '#......###',
];

const BUILD_TOWER_C = [
  '#.........',
  '#.........',
  '#.......##',
  '#........#',
  '#........#',
  '#........#',
  '#######..#',
  '######...#',
  '###.....##',
  '#........#',
  '#........#',
];

const BUILD_TOWER_D = [
  '#.....####',
  '#.......##',
  '#.......##',
  '#.....####',
  '####....##',
  '###.....##',
  '#...######',
  '#.......##',
  '#.......##',
  '#.......##',
  '#.......##',
];

const TEMPLATE_SPECS: any[] = [
  {
    id: 'S:insert-double', type: 'S', family: 'insert-double', clearName: 'DOUBLE',
    target: { x: 4, y: 37, rot: 2 }, start: { x: 3, y: 36, rot: 1 }, kickIndex: 2,
    clearRows: [38, 39],
    concept: '가로 S가 위에서 내려갈 수 없는 두 줄짜리 홈을, 오른쪽 세로 방향으로 소프트드롭한 뒤 시계 방향으로 다시 돌려 채웁니다.',
  },
  {
    id: 'Z:insert-double', type: 'Z', family: 'insert-double', clearName: 'DOUBLE',
    target: { x: 4, y: 37, rot: 2 }, start: { x: 5, y: 36, rot: 3 }, kickIndex: 2,
    clearRows: [38, 39],
    concept: '가로 Z가 위에서 내려갈 수 없는 두 줄짜리 홈을, 왼쪽 세로 방향으로 소프트드롭한 뒤 반시계 방향으로 다시 돌려 채웁니다.',
  },
  {
    id: 'S:insert-double-reverse', type: 'S', family: 'insert-double', clearName: 'DOUBLE', tier: 'advanced',
    target: { x: 4, y: 37, rot: 2 }, start: { x: 5, y: 36, rot: 3 }, kickIndex: 2,
    clearRows: [38, 39], extras: [[7, 37]],
    concept: '오른쪽 벽이 있는 S 홈에서는 왼쪽 세로 방향으로 진입하고, 반시계 방향 회전 보정으로 같은 두 줄짜리 슬롯을 채웁니다.',
  },
  {
    id: 'Z:insert-double-reverse', type: 'Z', family: 'insert-double', clearName: 'DOUBLE', tier: 'advanced',
    target: { x: 4, y: 37, rot: 2 }, start: { x: 3, y: 36, rot: 1 }, kickIndex: 2,
    clearRows: [38, 39], extras: [[3, 37]],
    concept: '왼쪽 벽이 있는 Z 홈에서는 오른쪽 세로 방향으로 진입하고, 시계 방향 회전 보정으로 같은 두 줄짜리 슬롯을 채웁니다.',
  },
  {
    id: 'S:kick-single-right', type: 'S', family: 'kick-single', clearName: 'SINGLE', tier: 'advanced',
    target: { x: 4, y: 37, rot: 1 }, start: { x: 4, y: 35, rot: 0 }, kickIndex: 3,
    clearRows: [39], extras: [[6, 37], [4, 35]],
    concept: '가로 S를 홈 위에 걸친 뒤 시계 방향의 아래쪽 회전 보정으로 세로 슬롯에 내려 넣어 한 줄을 지웁니다.',
  },
  {
    id: 'S:kick-single-left', type: 'S', family: 'kick-single', clearName: 'SINGLE', tier: 'advanced',
    target: { x: 4, y: 37, rot: 3 }, start: { x: 4, y: 35, rot: 0 }, kickIndex: 3,
    clearRows: [39], extras: [[5, 37], [6, 36]],
    concept: '가로 S를 반대쪽 홈 위에 걸친 뒤 반시계 방향의 아래쪽 회전 보정으로 세로 슬롯에 내려 넣습니다.',
  },
  {
    id: 'Z:kick-single-right', type: 'Z', family: 'kick-single', clearName: 'SINGLE', tier: 'advanced',
    target: { x: 4, y: 37, rot: 1 }, start: { x: 4, y: 35, rot: 0 }, kickIndex: 3,
    clearRows: [39], extras: [[5, 37], [4, 36]],
    concept: '가로 Z를 홈 위에 걸친 뒤 시계 방향의 아래쪽 회전 보정으로 오른쪽 세로 슬롯에 내려 넣습니다.',
  },
  {
    id: 'Z:kick-single-left', type: 'Z', family: 'kick-single', clearName: 'SINGLE', tier: 'advanced',
    target: { x: 4, y: 37, rot: 3 }, start: { x: 4, y: 35, rot: 0 }, kickIndex: 3,
    clearRows: [39], extras: [[4, 37], [6, 35]],
    concept: '가로 Z를 반대쪽 홈 위에 걸친 뒤 반시계 방향의 아래쪽 회전 보정으로 왼쪽 세로 슬롯에 내려 넣습니다.',
  },
  {
    id: 'S:kick-triple-right', type: 'S', family: 'kick-triple', clearName: 'TRIPLE', tier: 'advanced',
    target: { x: 4, y: 37, rot: 1 }, start: { x: 4, y: 35, rot: 0 }, kickIndex: 3,
    clearRows: [37, 38, 39], extras: [[4, 35]],
    concept: '가로 S를 시계 방향으로 돌리며 두 칸 아래의 세로 슬롯에 차 넣어 세 줄을 동시에 지웁니다.',
  },
  {
    id: 'S:kick-triple-left', type: 'S', family: 'kick-triple', clearName: 'TRIPLE', tier: 'advanced',
    target: { x: 4, y: 37, rot: 3 }, start: { x: 4, y: 35, rot: 0 }, kickIndex: 3,
    clearRows: [37, 38, 39], extras: [[6, 36]],
    concept: '가로 S를 반시계 방향으로 돌리며 두 칸 아래의 반대 세로 슬롯에 차 넣어 세 줄을 지웁니다.',
  },
  {
    id: 'Z:kick-triple-right', type: 'Z', family: 'kick-triple', clearName: 'TRIPLE', tier: 'advanced',
    target: { x: 4, y: 37, rot: 1 }, start: { x: 4, y: 35, rot: 0 }, kickIndex: 3,
    clearRows: [37, 38, 39], extras: [[4, 36]],
    concept: '가로 Z를 시계 방향으로 돌리며 두 칸 아래의 오른쪽 세로 슬롯에 차 넣어 세 줄을 지웁니다.',
  },
  {
    id: 'Z:kick-triple-left', type: 'Z', family: 'kick-triple', clearName: 'TRIPLE', tier: 'advanced',
    target: { x: 4, y: 37, rot: 3 }, start: { x: 4, y: 35, rot: 0 }, kickIndex: 3,
    clearRows: [37, 38, 39], extras: [[6, 35]],
    concept: '가로 Z를 반시계 방향으로 돌리며 두 칸 아래의 왼쪽 세로 슬롯에 차 넣어 세 줄을 지웁니다.',
  },
  {
    id: 'L:spin-single', type: 'L', family: 'jl-spin-single', clearName: 'SINGLE', tier: 'advanced',
    target: { x: 2, y: 38, rot: 0 }, start: { x: 3, y: 37, rot: 3 }, kickIndex: 2,
    clearRows: [38],
    concept: 'L을 왼쪽 세로로 세운 채 턱 아래까지 내린 뒤 시계 방향으로 돌려, 하드드롭으로 닿지 않는 가로 홈의 한 줄을 완성합니다.',
  },
  {
    id: 'L:spin-double', type: 'L', family: 'jl-spin-double', clearName: 'DOUBLE', tier: 'advanced',
    target: { x: 2, y: 38, rot: 0 }, start: { x: 3, y: 37, rot: 3 }, kickIndex: 2,
    clearRows: [38, 39],
    concept: '같은 L 회전 보정으로 두 줄짜리 홈을 채웁니다. 먼저 반시계 방향으로 L을 세우고, 소프트드롭 후 시계 방향으로 마무리합니다.',
  },
  {
    id: 'L:spin-triple', type: 'L', family: 'jl-spin-triple', clearName: 'TRIPLE', tier: 'advanced',
    target: { x: 3, y: 37, rot: 1 }, start: { x: 3, y: 35, rot: 0 }, kickIndex: 3,
    clearRows: [37, 38, 39], extras: [[3, 35]],
    concept: '가로 L을 턱 아래에 맞춘 뒤 시계 방향 회전 보정으로 세로 슬롯 깊숙이 내려 보내 세 줄을 동시에 지웁니다.',
  },
  {
    id: 'J:spin-single', type: 'J', family: 'jl-spin-single', clearName: 'SINGLE', tier: 'advanced',
    target: { x: 4, y: 38, rot: 0 }, start: { x: 3, y: 37, rot: 1 }, kickIndex: 2,
    clearRows: [38],
    concept: 'J를 오른쪽 세로로 세운 채 턱 아래까지 내린 뒤 반시계 방향으로 돌려, 하드드롭으로 닿지 않는 가로 홈의 한 줄을 완성합니다.',
  },
  {
    id: 'J:spin-double', type: 'J', family: 'jl-spin-double', clearName: 'DOUBLE', tier: 'advanced',
    target: { x: 4, y: 38, rot: 0 }, start: { x: 3, y: 37, rot: 1 }, kickIndex: 2,
    clearRows: [38, 39],
    concept: 'L 더블의 좌우 반전입니다. J를 시계 방향으로 세우고 소프트드롭한 뒤 반시계 방향으로 돌려 두 줄을 완성합니다.',
  },
  {
    id: 'J:spin-triple', type: 'J', family: 'jl-spin-triple', clearName: 'TRIPLE', tier: 'advanced',
    target: { x: 4, y: 37, rot: 3 }, start: { x: 4, y: 35, rot: 0 }, kickIndex: 3,
    clearRows: [37, 38, 39], extras: [[6, 35]],
    concept: '가로 J를 턱 아래에 맞춘 뒤 반시계 방향 회전 보정으로 세로 슬롯 깊숙이 내려 보내 세 줄을 동시에 지웁니다.',
  },
  {
    id: 'I:spin-single-left', type: 'I', family: 'i-spin-single', clearName: 'SINGLE', tier: 'advanced',
    target: { x: 3, y: 38, rot: 0 }, start: { x: 2, y: 36, rot: 3 }, kickIndex: 4,
    clearRows: [39], extras: [[4, 37], [2, 37], [2, 36], [4, 38]],
    concept: 'I를 왼쪽 세로로 세워 오버행 아래까지 내린 뒤 시계 방향 SRS+ 보정으로 두 칸 아래의 가로 홈에 눕혀 한 줄을 지웁니다.',
  },
  {
    id: 'I:spin-single-right', type: 'I', family: 'i-spin-single', clearName: 'SINGLE', tier: 'advanced',
    target: { x: 3, y: 38, rot: 0 }, start: { x: 4, y: 36, rot: 1 }, kickIndex: 4,
    clearRows: [39], extras: [[5, 37], [7, 37], [7, 36], [5, 38]],
    concept: 'I Single의 좌우 반전입니다. 오른쪽 세로로 진입한 뒤 반시계 방향 SRS+ 보정으로 가로 홈에 눕힙니다.',
  },
  {
    id: 'I:spin-double-left', type: 'I', family: 'i-spin-double', clearName: 'DOUBLE', tier: 'advanced',
    target: { x: 1, y: 36, rot: 3 }, start: { x: 2, y: 36, rot: 0 }, kickIndex: 2,
    clearRows: [38, 39], extras: [[2, 33], [2, 35]],
    concept: '가로 I를 왼쪽 입구까지 내린 뒤 반시계 방향 SRS+ 보정으로 세로 홈에 세워 두 줄을 지웁니다.',
  },
  {
    id: 'I:spin-double-right', type: 'I', family: 'i-spin-double', clearName: 'DOUBLE', tier: 'advanced',
    target: { x: 5, y: 36, rot: 1 }, start: { x: 4, y: 36, rot: 0 }, kickIndex: 2,
    clearRows: [38, 39], extras: [[7, 33], [7, 35]],
    concept: 'I 더블의 좌우 반전입니다. 오른쪽 입구에서 시계 방향 SRS+ 보정을 사용해 세로 홈에 넣습니다.',
  },
  {
    id: 'I:spin-triple-left', type: 'I', family: 'i-spin-triple', clearName: 'TRIPLE', tier: 'advanced',
    target: { x: 0, y: 36, rot: 1 }, start: { x: 2, y: 35, rot: 0 }, kickIndex: 3,
    clearRows: [37, 38, 39], extras: [[2, 35]],
    concept: '가로 I를 왼쪽 턱에 걸친 뒤 시계 방향 회전 보정으로 벽 쪽 세로 홈에 밀어 넣어 세 줄을 지웁니다.',
  },
  {
    id: 'I:spin-triple-right', type: 'I', family: 'i-spin-triple', clearName: 'TRIPLE', tier: 'advanced',
    target: { x: 6, y: 36, rot: 3 }, start: { x: 4, y: 35, rot: 0 }, kickIndex: 3,
    clearRows: [37, 38, 39], extras: [[7, 35]],
    concept: 'I 트리플의 좌우 반전입니다. 오른쪽 턱에서 반시계 방향 회전 보정으로 벽 쪽 세로 홈을 완성합니다.',
  },
  {
    id: 'T:single-left', type: 'T', family: 't-spin-single', clearName: 'SINGLE',
    target: { x: 4, y: 36, rot: 2 }, start: { x: 4, y: 36, rot: 1 }, kickIndex: 0,
    clearRows: [37], extras: [[4, 36]], terrainRows: [{ y: 38, holes: [0, 5] }],
    concept: '왼쪽 오버행 아래로 T를 소프트드롭하고 회전해 한 줄을 지우는 기본 T-Spin Single입니다.',
  },
  {
    id: 'T:single-right', type: 'T', family: 't-spin-single', clearName: 'SINGLE',
    target: { x: 4, y: 36, rot: 2 }, start: { x: 4, y: 36, rot: 3 }, kickIndex: 0,
    clearRows: [37], extras: [[6, 36]], terrainRows: [{ y: 38, holes: [0, 5] }],
    concept: '오른쪽 오버행 아래로 T를 소프트드롭하고 회전해 한 줄을 지우는 기본 T-Spin Single입니다.',
  },
  {
    id: 'T:double-left', type: 'T', family: 't-spin-double', clearName: 'DOUBLE',
    target: { x: 4, y: 37, rot: 2 }, start: { x: 4, y: 37, rot: 1 }, kickIndex: 0,
    clearRows: [38, 39], extras: [[4, 37]],
    concept: '왼쪽 오버행 아래의 T자 홈에 세로 T를 소프트드롭한 뒤 회전해 두 줄을 지웁니다.',
  },
  {
    id: 'T:double-right', type: 'T', family: 't-spin-double', clearName: 'DOUBLE',
    target: { x: 4, y: 37, rot: 2 }, start: { x: 4, y: 37, rot: 3 }, kickIndex: 0,
    clearRows: [38, 39], extras: [[6, 37]],
    concept: '오른쪽 오버행 아래의 T자 홈에 세로 T를 소프트드롭한 뒤 회전해 두 줄을 지웁니다.',
  },
  {
    id: 'T:triple-left', type: 'T', family: 't-spin-triple', clearName: 'TRIPLE',
    target: { x: 4, y: 37, rot: 1 }, start: { x: 5, y: 35, rot: 0 }, kickIndex: 4,
    clearRows: [37, 38, 39], extras: [[5, 35]],
    concept: '오버행 아래에서 0→R의 마지막 SRS 킥을 사용해 T를 두 칸 아래로 보내고 세 줄을 지웁니다.',
  },
  {
    id: 'T:triple-right', type: 'T', family: 't-spin-triple', clearName: 'TRIPLE',
    target: { x: 4, y: 37, rot: 3 }, start: { x: 3, y: 35, rot: 0 }, kickIndex: 4,
    clearRows: [37, 38, 39], extras: [[5, 35]],
    concept: '오버행 아래에서 0→L의 마지막 SRS 킥을 사용해 T를 두 칸 아래로 보내고 세 줄을 지웁니다.',
  },
  {
    id: 'T:mini-single-left', type: 'T', family: 't-spin-mini-single', clearName: 'SINGLE', tier: 'advanced', spinKind: 'mini',
    lessonLabel: 'T-SPIN MINI SINGLE',
    target: { x: 3, y: 38, rot: 0 }, start: { x: 2, y: 37, rot: 1 }, kickIndex: 2,
    clearRows: [39], extras: [[2, 38], [5, 38]],
    concept: '앞쪽 코너가 하나만 막힌 작은 T 홈입니다. 오른쪽을 향한 T를 반시계 방향으로 돌려 Mini Single을 만듭니다.',
  },
  {
    id: 'T:mini-single-right', type: 'T', family: 't-spin-mini-single', clearName: 'SINGLE', tier: 'advanced', spinKind: 'mini',
    lessonLabel: 'T-SPIN MINI SINGLE',
    target: { x: 3, y: 38, rot: 0 }, start: { x: 4, y: 37, rot: 3 }, kickIndex: 2,
    clearRows: [39], extras: [[6, 38], [3, 38]],
    concept: '반대쪽 작은 T 홈입니다. 왼쪽을 향한 T를 시계 방향으로 돌려 Mini Single을 만듭니다.',
  },
  {
    id: 'T:iso-double-right', type: 'T', family: 'iso-t-spin-double', clearName: 'DOUBLE', tier: 'advanced', spinKind: 'full', variant: 'iso',
    lessonLabel: 'ISO T-SPIN DOUBLE',
    target: { x: 4, y: 37, rot: 1 }, start: { x: 4, y: 35, rot: 2 }, kickIndex: 3,
    clearRows: [37, 39], extras: [[5, 35], [4, 38]],
    concept: '돌기가 아래인 T를 시계 방향으로 돌려 두 칸 아래로 차 넣습니다. 앞쪽 두 코너가 막혀 정식 T-Spin Double로 판정됩니다.',
  },
  {
    id: 'T:iso-double-left', type: 'T', family: 'iso-t-spin-double', clearName: 'DOUBLE', tier: 'advanced', spinKind: 'full', variant: 'iso',
    lessonLabel: 'ISO T-SPIN DOUBLE',
    target: { x: 4, y: 37, rot: 3 }, start: { x: 4, y: 35, rot: 2 }, kickIndex: 3,
    clearRows: [37, 39], extras: [[5, 35], [6, 38]],
    concept: 'Iso-TSD의 좌우 반전입니다. 돌기가 아래인 T를 반시계 방향으로 돌려 두 칸 아래에 넣습니다.',
  },
  {
    id: 'T:neo-double-right', type: 'T', family: 'neo-t-spin-double', clearName: 'DOUBLE', tier: 'advanced', spinKind: 'mini', variant: 'neo',
    lessonLabel: 'NEO T-SPIN MINI DOUBLE',
    target: { x: 4, y: 37, rot: 1 }, start: { x: 4, y: 35, rot: 2 }, kickIndex: 3,
    clearRows: [38, 39], extras: [[5, 35], [4, 37]],
    concept: '두 칸 아래로 차 넣지만 앞쪽 코너가 하나뿐인 Neo-TSD입니다. 같은 Double이라도 Mini로 판정되는 차이를 익힙니다.',
  },
  {
    id: 'T:neo-double-left', type: 'T', family: 'neo-t-spin-double', clearName: 'DOUBLE', tier: 'advanced', spinKind: 'mini', variant: 'neo',
    lessonLabel: 'NEO T-SPIN MINI DOUBLE',
    target: { x: 4, y: 37, rot: 3 }, start: { x: 4, y: 35, rot: 2 }, kickIndex: 3,
    clearRows: [38, 39], extras: [[5, 35], [6, 37]],
    concept: 'Neo-TSD의 좌우 반전입니다. 앞쪽 코너 수 때문에 정식 TSD가 아니라 Mini Double로 판정됩니다.',
  },
  {
    id: 'T:fin-double-right', type: 'T', family: 'fin-t-spin-double', clearName: 'DOUBLE', tier: 'advanced', spinKind: 'full', variant: 'fin',
    lessonLabel: 'FIN T-SPIN DOUBLE',
    target: { x: 4, y: 37, rot: 1 }, start: { x: 5, y: 35, rot: 2 }, kickIndex: 4,
    clearRows: [38, 39], extras: [[6, 35], [5, 35], [4, 37]],
    concept: '마지막 SRS 회전 보정으로 T를 왼쪽 아래 두 칸에 차 넣습니다. 앞쪽 코너가 하나여도 마지막 킥 예외로 정식 TSD가 됩니다.',
  },
  {
    id: 'T:fin-double-left', type: 'T', family: 'fin-t-spin-double', clearName: 'DOUBLE', tier: 'advanced', spinKind: 'full', variant: 'fin',
    lessonLabel: 'FIN T-SPIN DOUBLE',
    target: { x: 4, y: 37, rot: 3 }, start: { x: 3, y: 35, rot: 2 }, kickIndex: 4,
    clearRows: [38, 39], extras: [[4, 35], [5, 35], [6, 37]],
    concept: 'Fin-TSD의 좌우 반전입니다. 마지막 킥으로 T를 오른쪽 아래 두 칸에 넣고 정식 TSD 판정을 받습니다.',
  },
  {
    id: 'T:deep-double-cw', type: 'T', family: 'deep-t-spin-double', clearName: 'DOUBLE', tier: 'advanced', spinKind: 'full', variant: 'deep',
    lessonLabel: 'DEEP T-SPIN DOUBLE', quarterTurnRoute: true,
    target: { x: 4, y: 37, rot: 2 }, start: { x: 4, y: 37, rot: 1 }, kickIndex: 0,
    clearRows: [38, 39], extras: [[4, 37]],
    terrainRows: [
      { y: 28, holes: [5, 6, 7] },
      { y: 29, holes: [4, 5, 6] },
      { y: 30, holes: [2, 3, 4, 5] },
      { y: 31, holes: [2, 3, 4, 5] },
      { y: 32, holes: [2, 3, 4, 5, 6] },
      { y: 33, holes: [2, 3, 4, 5, 6] },
      { y: 34, holes: [2, 3, 4, 5] },
      { y: 35, holes: [3, 4, 5] },
      { y: 36, holes: [3, 4, 5, 6, 7] },
      { y: 37, holes: [4, 5, 6] },
    ],
    concept: '높은 실전 스택 안의 굽은 통로입니다. SDF MAX로 걸리는 곳까지 내리고 시계 방향으로 두 번 돌려 통로 방향을 바꾸는 과정을 두 차례 거친 뒤 T-Spin Double을 완성합니다.',
  },
  {
    id: 'T:deep-double-ccw', type: 'T', family: 'deep-t-spin-double', clearName: 'DOUBLE', tier: 'advanced', spinKind: 'full', variant: 'deep',
    lessonLabel: 'DEEP T-SPIN DOUBLE', quarterTurnRoute: true, preferCCW: true,
    target: { x: 3, y: 37, rot: 2 }, start: { x: 3, y: 37, rot: 3 }, kickIndex: 0,
    clearRows: [38, 39], extras: [[5, 37]],
    terrainRows: [
      { y: 28, holes: [2, 3, 4] },
      { y: 29, holes: [3, 4, 5] },
      { y: 30, holes: [4, 5, 6, 7] },
      { y: 31, holes: [4, 5, 6, 7] },
      { y: 32, holes: [3, 4, 5, 6, 7] },
      { y: 33, holes: [3, 4, 5, 6, 7] },
      { y: 34, holes: [4, 5, 6, 7] },
      { y: 35, holes: [4, 5, 6] },
      { y: 36, holes: [2, 3, 4, 5, 6] },
      { y: 37, holes: [3, 4, 5] },
    ],
    concept: '같은 깊은 통로의 좌우 반전입니다. SDF MAX로 멈출 때마다 반시계 방향 회전을 이어서 아래 공간을 열고, 바닥의 T 홈까지 내려가 Double을 완성합니다.',
  },
  {
    id: 'T:build-tower-a-cw', type: 'T', family: 'build-tower-a-double', clearName: 'DOUBLE', tier: 'advanced', spinKind: 'full', variant: 'build',
    lessonLabel: 'BUILD T-SPIN DOUBLE', quarterTurnRoute: true,
    target: { x: 4, y: 37, rot: 2 }, start: { x: 4, y: 37, rot: 1 }, kickIndex: 0,
    clearRows: [38, 39], extras: [[2, 37], [3, 37], [4, 37]], terrainRows: terrainRowsFromStrings(24, BUILD_TOWER_A),
    concept: '오른쪽 높은 기둥과 왼쪽 선반 사이로 진입하는 실전 빌드형입니다. 첫 선반에 세로 T를 세운 뒤 가로로 한 칸 더 내리고, 왼쪽으로 옮겨 다시 세로로 돌려 긴 중앙 우물을 통과합니다.',
  },
  {
    id: 'T:build-tower-a-ccw', type: 'T', family: 'build-tower-a-double', clearName: 'DOUBLE', tier: 'advanced', spinKind: 'full', variant: 'build',
    lessonLabel: 'BUILD T-SPIN DOUBLE', quarterTurnRoute: true, preferCCW: true,
    target: { x: 3, y: 37, rot: 2 }, start: { x: 3, y: 37, rot: 3 }, kickIndex: 0,
    clearRows: [38, 39], extras: [[5, 37], [6, 37], [7, 37]], terrainRows: terrainRowsFromStrings(24, BUILD_TOWER_A, true),
    concept: '같은 기둥·선반 빌드의 좌우 반전입니다. 왼쪽 높은 기둥 옆에서 시작해 우물 입구로 이동하고, 반시계 방향 회전 위주로 여러 줄 아래의 T 홈까지 내려갑니다.',
  },
  {
    id: 'T:build-tower-b-cw', type: 'T', family: 'build-tower-b-double', clearName: 'DOUBLE', tier: 'advanced', spinKind: 'full', variant: 'build',
    lessonLabel: 'BUILD T-SPIN DOUBLE', quarterTurnRoute: true,
    target: { x: 4, y: 37, rot: 2 }, start: { x: 4, y: 37, rot: 1 }, kickIndex: 0,
    clearRows: [38, 39], extras: [[1, 37], [2, 37], [3, 37], [4, 37]], terrainRows: terrainRowsFromStrings(25, BUILD_TOWER_B),
    concept: '한쪽 기둥에서 길게 뻗은 두 개의 오버행을 이용하는 빌드형입니다. 각 선반 끝에서 방향을 바꾸며 내려가고, 마지막 세로 통로를 통과한 뒤 T-Spin Double을 완성합니다.',
  },
  {
    id: 'T:build-tower-b-ccw', type: 'T', family: 'build-tower-b-double', clearName: 'DOUBLE', tier: 'advanced', spinKind: 'full', variant: 'build',
    lessonLabel: 'BUILD T-SPIN DOUBLE', quarterTurnRoute: true, preferCCW: true,
    target: { x: 3, y: 37, rot: 2 }, start: { x: 3, y: 37, rot: 3 }, kickIndex: 0,
    clearRows: [38, 39], extras: [[5, 37], [6, 37], [7, 37], [8, 37]], terrainRows: terrainRowsFromStrings(25, BUILD_TOWER_B, true),
    concept: '두 오버행 빌드의 좌우 반전입니다. 첫 하강 뒤 옆으로 파고들어 선반 아래를 통과하고, 멈출 때마다 반시계 회전으로 다음 하강 공간을 엽니다.',
  },
  {
    id: 'T:build-tower-c-cw', type: 'T', family: 'build-tower-c-double', clearName: 'DOUBLE', tier: 'advanced', spinKind: 'full', variant: 'build',
    lessonLabel: 'BUILD T-SPIN DOUBLE', quarterTurnRoute: true,
    target: { x: 4, y: 37, rot: 2 }, start: { x: 4, y: 37, rot: 1 }, kickIndex: 0,
    clearRows: [38, 39], extras: [[1, 37], [2, 37], [3, 37], [4, 37]], terrainRows: terrainRowsFromStrings(27, BUILD_TOWER_C),
    concept: '긴 가로 선반을 중심으로 만든 실전 빌드형입니다. 오른쪽의 좁은 입구로 먼저 내린 다음 두 번 회전해 선반 아래로 파고들고, 중앙으로 되돌아와 바닥 슬롯을 완성합니다.',
  },
  {
    id: 'T:build-tower-c-ccw', type: 'T', family: 'build-tower-c-double', clearName: 'DOUBLE', tier: 'advanced', spinKind: 'full', variant: 'build',
    lessonLabel: 'BUILD T-SPIN DOUBLE', quarterTurnRoute: true, preferCCW: true,
    target: { x: 3, y: 37, rot: 2 }, start: { x: 3, y: 37, rot: 3 }, kickIndex: 0,
    clearRows: [38, 39], extras: [[5, 37], [6, 37], [7, 37], [8, 37]], terrainRows: terrainRowsFromStrings(27, BUILD_TOWER_C, true),
    concept: '긴 가로 선반형의 좌우 반전입니다. 왼쪽 입구에서 반시계 회전을 이어가며 선반 아래를 통과하고, 중앙 T 홈까지 여러 단계로 내려갑니다.',
  },
  {
    id: 'T:build-tower-d-cw', type: 'T', family: 'build-tower-d-double', clearName: 'DOUBLE', tier: 'advanced', spinKind: 'full', variant: 'build',
    lessonLabel: 'BUILD T-SPIN DOUBLE', quarterTurnRoute: true,
    target: { x: 4, y: 37, rot: 2 }, start: { x: 4, y: 37, rot: 1 }, kickIndex: 0,
    clearRows: [38, 39], extras: [[1, 37], [2, 37], [3, 37], [4, 37]], terrainRows: terrainRowsFromStrings(27, BUILD_TOWER_D),
    concept: '두 층의 선반이 서로 엇갈린 오버행 빌드입니다. 첫 선반에서 방향을 바꾸고 회전 보정으로 다음 층에 내려선 뒤, 좁은 중앙 통로를 따라 TSD 슬롯까지 들어갑니다.',
  },
  {
    id: 'T:build-tower-d-ccw', type: 'T', family: 'build-tower-d-double', clearName: 'DOUBLE', tier: 'advanced', spinKind: 'full', variant: 'build',
    lessonLabel: 'BUILD T-SPIN DOUBLE', quarterTurnRoute: true, preferCCW: true,
    target: { x: 3, y: 37, rot: 2 }, start: { x: 3, y: 37, rot: 3 }, kickIndex: 0,
    clearRows: [38, 39], extras: [[5, 37], [6, 37], [7, 37], [8, 37]], terrainRows: terrainRowsFromStrings(27, BUILD_TOWER_D, true),
    concept: '엇갈린 두 층 오버행의 좌우 반전입니다. 각 선반 끝에서 반시계 회전과 옆 이동을 조합해 아래 공간을 열고 마지막 Double을 완성합니다.',
  },
];

const createTemplateCase = (spec, rotationSystem = 'srsplus', options: any = {}) => {
  const targetCells = pieceCells(spec.type, spec.target);
  const reserved = new Set(targetCells.map(([x, y]) => `${x},${y}`));
  const board = makeBoard();
  for (const y of spec.clearRows) fillRowExcept(board, y, [], reserved);
  for (const row of spec.terrainRows || []) fillRowExcept(board, row.y, row.holes || [], reserved);
  for (const [x, y] of spec.extras || []) {
    if (reserved.has(`${x},${y}`)) return null;
    board[y][x] = 'J';
  }

  const fromRot = spec.start.rot;
  const toRot = spec.target.rot;
  const delta = rotationDelta(fromRot, toRot);
  const rotated = rotateWithKicks(spec.type, spec.start, toRot, board, rotationSystem);
  const approachRoute = findSpinApproach(spec.type, spec.start, board, rotationSystem, { withTimeline: true, allow180: options.allow180 });
  const sdfMaxSetup = findSdfMaxRoute(spec.type, spec.start, board, rotationSystem, {
    allow180: options.allow180 && !spec.quarterTurnRoute,
    preferCCW: spec.preferCCW,
  });
  const clearResult = simulateSpinClear(board, spec.type, spec.target);
  if (!rotated || rotated.x !== spec.target.x || rotated.y !== spec.target.y || rotated.kickIndex !== spec.kickIndex) return null;
  if (!approachRoute || !clearResult) return null;
  if (clearResult.clearedRows.join(',') !== spec.clearRows.join(',')) return null;
  if (isDirectHardDropReachable(spec.type, spec.target, board)) return null;
  if (hasEnclosedHole(clearResult.boardAfter)) return null;
  if (spec.type !== 'T' && !isImmobile(spec.type, spec.target, board)) return null;
  const classification = spec.type === 'T'
    ? tSpinClassification(spec.target, board, spec.kickIndex)
    : { kind: 'full', count: null, frontCount: null };
  if (!classification || (spec.spinKind && spec.spinKind !== classification.kind)) return null;

  const direction = delta === 2 ? '180' : delta > 0 ? 'CW' : 'CCW';
  const lineClearCount = clearResult.clearedRows.length;
  const clearLabel = `${spec.type}-SPIN${classification.kind === 'mini' ? ' MINI' : ''} ${LINE_NAMES[lineClearCount]}`;
  const lessonLabel = spec.lessonLabel || clearLabel;
  const inputRoute = sdfMaxSetup ? [...sdfMaxSetup, ROTATION_TOKENS[delta]] : null;
  const simulatedRoute = inputRoute ? simulateSdfMaxRoute(spec.type, inputRoute, board, rotationSystem) : null;
  const routeVerified = Boolean(simulatedRoute
    && cellsKey(pieceCells(spec.type, simulatedRoute.state)) === cellsKey(targetCells)
    && simulatedRoute.lastRotation?.from === fromRot
    && simulatedRoute.lastRotation?.to === toRot
    && simulatedRoute.lastRotation?.delta === delta
    && simulatedRoute.lastRotation?.kickIndex === spec.kickIndex);
  return {
    ...spec,
    tier: spec.tier || 'basic',
    title: lessonLabel,
    lessonLabel,
    board,
    resultBoard: clearResult.boardAfter,
    spawn: { x: 3, y: 19, rot: 0 },
    target: { ...spec.target, cells: targetCells, exactTargetKey: cellsKey(targetCells) },
    fromRot,
    toRot,
    direction,
    delta,
    approach: approachRoute.tokens,
    approachTimeline: approachRoute.timeline,
    inputRoute: routeVerified ? inputRoute : null,
    practiceRoute: routeVerified ? [...inputRoute, 'hardDrop'] : null,
    practiceTimeline: routeVerified
      ? [...simulatedRoute.timeline, {
        token: 'hardDrop',
        resultX: simulatedRoute.state.x,
        resultY: simulatedRoute.state.y,
        resultRot: simulatedRoute.state.rot,
      }]
      : null,
    stagingGrounded: collidesWithBoard(spec.type, { ...spec.start, y: spec.start.y + 1 }, board),
    solution: [...approachRoute.tokens, ROTATION_TOKENS[delta]],
    stateLabels: [STATE_LABELS[fromRot], STATE_LABELS[toRot]],
    stateNames: [spinStateName(spec.type, fromRot), spinStateName(spec.type, toRot)],
    lineClearCount,
    clearLabel,
    spinKind: classification.kind,
    cornerCount: classification.count,
    frontCornerCount: classification.frontCount,
    directHardDrop: false,
    requiresSoftDrop: true,
  };
};

const createSpinCatalog = (options: any = {}) => TEMPLATE_SPECS
  .map((spec) => createTemplateCase(spec, options.rotationSystem || 'srsplus', options))
  .filter(Boolean);

const evaluateSpinAttempt = (spinCase, piece, lastRotation, options: any = {}) => {
  const targetMatched = piece.type === spinCase.type
    && cellsKey(pieceCells(piece.type, piece)) === spinCase.target.exactTargetKey;
  if (options.validation === 'placement') {
    if (!targetMatched) return { success: false, reason: 'target-missed' };
    const result = simulateSpinClear(spinCase.board, piece.type, piece);
    if (!result || result.clearedRows.length !== spinCase.lineClearCount) return { success: false, reason: 'no-line-clear' };
    if (hasEnclosedHole(result.boardAfter)) return { success: false, reason: 'hole-left' };
    return { success: true, reason: 'placement', lines: result.clearedRows.length };
  }
  if (!lastRotation) return { success: false, reason: 'no-rotation' };
  if (lastRotation.from !== spinCase.fromRot) return { success: false, reason: 'wrong-state' };
  if (lastRotation.to !== spinCase.toRot || lastRotation.delta !== spinCase.delta) return { success: false, reason: 'wrong-direction' };
  if (!targetMatched) return { success: false, reason: 'target-missed' };
  if (lastRotation.kickIndex !== spinCase.kickIndex) {
    const alternative = piece.type === 'T'
      ? tSpinClassification(piece, spinCase.board, lastRotation.kickIndex)
      : null;
    if (spinCase.variant === 'fin' && alternative?.kind === 'mini') {
      return { success: false, reason: 'mini-not-fin' };
    }
    return { success: false, reason: 'wrong-kick' };
  }
  if (piece.type !== 'T' && !isImmobile(piece.type, piece, spinCase.board)) return { success: false, reason: 'not-immobile' };
  if (piece.type === 'T') {
    const classification = tSpinClassification(piece, spinCase.board, lastRotation.kickIndex);
    if (!classification) return { success: false, reason: 'not-t-spin' };
    if (classification.kind !== spinCase.spinKind) return { success: false, reason: 'wrong-spin-kind' };
  }
  const result = simulateSpinClear(spinCase.board, piece.type, piece);
  if (!result || result.clearedRows.length !== spinCase.lineClearCount) return { success: false, reason: 'no-line-clear' };
  if (hasEnclosedHole(result.boardAfter)) return { success: false, reason: 'hole-left' };
  return { success: true, reason: 'spin', spinKind: spinCase.spinKind, kickIndex: lastRotation.kickIndex, lines: result.clearedRows.length };
};

const SPIN_GUIDES = {
  PRINCIPLE: {
    title: 'SPIN PRINCIPLE',
    body: '0/R/2/L은 미노의 네 회전 방향을 줄여 쓴 기호입니다. 처음 나온 방향이 0, 시계 방향으로 90° 돌리면 R, 180° 돌리면 2, 반시계 방향으로 90° 돌리면 L입니다. 화면에서는 모양 이름을 먼저 표시하고 이 기호는 괄호 안에만 덧붙입니다.',
    points: ['0 = 처음 방향 · R = 시계 방향 90° · 2 = 180° · L = 반시계 방향 90°.', 'S와 Z의 0과 2는 겉모양이 같지만 회전축 위치가 달라 다음 회전 결과가 다릅니다.', '입구를 통과하는 세로 모양으로 소프트드롭한 뒤 마지막 회전으로 줄을 완성합니다.'],
  },
  T: {
    title: 'T-SPIN FAMILY',
    body: 'T 중심의 대각선 네 코너 중 세 곳 이상이 막힌 상태에서 마지막 입력이 회전이어야 합니다. 앞쪽 코너 수와 사용한 회전 보정에 따라 정식 T-Spin과 Mini가 갈립니다.',
    points: ['기본 SINGLE / DOUBLE / TRIPLE뿐 아니라 Mini Single도 연습합니다.', 'Iso와 Neo는 같은 두 칸 하강 킥을 쓰지만 앞쪽 코너 수 때문에 각각 정식 Double과 Mini Double로 갈립니다.', 'Fin은 앞쪽 코너가 하나여도 마지막 SRS 킥 예외로 정식 T-Spin Double이 됩니다.'],
  },
  S: {
    title: 'S-SPIN FAMILY',
    body: '기본 두 줄 삽입뿐 아니라 벽이 있는 반대 진입, 아래로 두 칸 차 넣는 Single과 Triple을 함께 연습합니다.',
    points: ['벽이 없으면 오른쪽 세로(R)에서 시계 방향, 반대쪽 벽이 있으면 왼쪽 세로(L)에서 반시계 방향으로 Double을 넣습니다.', 'Single과 Triple은 가로 상태에서 회전 보정으로 세로 S를 두 칸 아래에 넣습니다.', '모든 케이스는 완성 상태를 직접 하드드롭해서는 넣을 수 없습니다.'],
  },
  Z: {
    title: 'Z-SPIN FAMILY',
    body: 'S의 좌우 반전만 외우지 않고, 벽의 위치에 따라 회전 방향이 바뀌는 Double과 아래쪽 킥을 쓰는 Single·Triple을 구분합니다.',
    points: ['벽이 없으면 왼쪽 세로(L)에서 반시계 방향, 반대쪽 벽이 있으면 오른쪽 세로(R)에서 시계 방향으로 Double을 넣습니다.', 'Single과 Triple은 가로 상태에서 회전 보정으로 세로 Z를 두 칸 아래에 넣습니다.', '회전 전 상태와 마지막 회전 방향이 모두 맞아야 성공합니다.'],
  },
  L: {
    title: 'L-SPIN FAMILY',
    body: 'L은 가로 홈을 채우는 Single·Double과, 세로로 깊게 들어가는 Triple을 연습합니다. 모두 일반 하드드롭으로는 목표 칸에 닿지 않습니다.',
    points: ['Single과 Double은 왼쪽 세로(L)로 준비한 뒤 시계 방향으로 눕힙니다.', 'Triple은 가로(0) 상태를 턱에 맞춘 뒤 시계 방향 회전 보정으로 세로 홈에 넣습니다.', '비-T 올스핀은 마지막 회전 후 좌우와 위쪽으로 빠져나올 수 없는 상태여야 합니다.'],
  },
  J: {
    title: 'J-SPIN FAMILY',
    body: 'J는 L의 좌우 반전입니다. 오른쪽 세로 준비에서 가로 홈을 채우거나, 반시계 방향 회전 보정으로 세 줄짜리 세로 홈에 진입합니다.',
    points: ['Single과 Double은 오른쪽 세로(R)로 준비한 뒤 반시계 방향으로 눕힙니다.', 'Triple은 가로(0) 상태를 턱에 맞춘 뒤 반시계 방향으로 세로 홈에 넣습니다.', '최종 모양뿐 아니라 마지막 회전과 immobile 상태를 함께 확인합니다.'],
  },
  I: {
    title: 'I-SPIN FAMILY',
    body: 'I는 SRS+의 좌우 대칭 회전 보정을 이용해 오버행 아래의 가로 홈이나 좁은 세로 홈으로 이동합니다. Single·Double·Triple의 좌우 경로를 각각 연습합니다.',
    points: ['Single은 세로 I를 오버행 아래까지 내린 뒤 마지막 회전으로 두 칸 아래의 가로 홈에 눕힙니다.', 'Double과 Triple은 가로 I를 입구 높이까지 내린 뒤 벽 방향으로 돌려 세로 홈을 채웁니다.', 'I는 전용 SRS+ 킥표를 사용하므로 J/L과 같은 위치에서도 이동량이 다릅니다.'],
  },
};

export {
  SPIN_GUIDES,
  STATE_LABELS,
  createTemplateCase,
  createSpinCatalog,
  evaluateSpinAttempt,
  findSdfMaxRoute,
  findSpinApproach,
  hasEnclosedHole,
  isDirectHardDropReachable,
  isImmobile,
  rotateWithKicks,
  rotationEntriesForTarget,
  simulateSdfMaxRoute,
  simulateSpinClear,
  spinStateName,
  tCornerCount,
  tSpinClassification,
};
