import {
  BOARD_H,
  BOARD_W,
  I_180,
  I_90_SRS,
  I_90_SRS_PLUS,
  JLSTZ_180,
  JLSTZ_90,
  PIECES,
  SHAPES,
} from '../core/state';

const ROTATION_LABELS = ['SPAWN', 'RIGHT', 'REVERSE', 'LEFT'];
const TOKEN_LABELS = {
  left: '←',
  right: '→',
  dasLeft: '⇐',
  dasRight: '⇒',
  rotateCW: '↻',
  rotateCCW: '↺',
  rotate180: '↷',
};

const sortCells = (cells) => [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0]);

const shapeInfo = (type, rot) => {
  const shape = SHAPES[type][rot];
  const xs = shape.map(([x]) => x);
  const ys = shape.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const normalized = sortCells(shape.map(([x, y]) => [x - minX, y - minY]));
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    normalized,
    signature: normalized.map(([x, y]) => `${x},${y}`).join(';'),
  };
};

const placementKey = (type, x, rot) => {
  const info = shapeInfo(type, rot);
  return `${info.signature}@${x + info.minX}`;
};

const cellsKey = (cells) => sortCells(cells).map(([x, y]) => `${x},${y}`).join(';');

const pieceCells = (type, state) => SHAPES[type][state.rot].map(([dx, dy]) => [state.x + dx, state.y + dy]);

const collidesWithBoard = (type, state, board) => pieceCells(type, state).some(([x, y]) => (
  x < 0 || x >= BOARD_W || y >= BOARD_H || (y >= 0 && Boolean(board?.[y]?.[x]))
));

const dropPlacement = (type, state, board) => {
  if (collidesWithBoard(type, state, board)) return null;
  const landed = { ...state };
  while (!collidesWithBoard(type, { ...landed, y: landed.y + 1 }, board)) landed.y += 1;
  return landed;
};

const legalX = (type, x, rot) => {
  const info = shapeInfo(type, rot);
  return x + info.minX >= 0 && x + info.maxX < BOARD_W;
};

const kickTable = (type, from, to, delta, rotationSystem) => {
  const key = `${from}>${to}`;
  if (Math.abs(delta) === 2) return (type === 'I' ? I_180 : JLSTZ_180)[key] || [[0, 0]];
  if (type === 'I') return (rotationSystem === 'srsplus' ? I_90_SRS_PLUS : I_90_SRS)[key] || [[0, 0]];
  return JLSTZ_90[key] || [[0, 0]];
};

const rotateState = (type, state, delta, rotationSystem) => {
  const to = (state.rot + delta + 4) % 4;
  if (type === 'O') return { x: state.x, rot: to };
  for (const [kickX] of kickTable(type, state.rot, to, delta, rotationSystem)) {
    if (legalX(type, state.x + kickX, to)) return { x: state.x + kickX, rot: to };
  }
  return null;
};

const rotateBoardState = (type, state, delta, board, rotationSystem) => {
  if (type === 'O') return null;
  const to = (state.rot + delta + 4) % 4;
  for (const [kickX, kickY] of kickTable(type, state.rot, to, delta, rotationSystem)) {
    const candidate = { x: state.x + kickX, y: state.y + kickY, rot: to };
    if (!collidesWithBoard(type, candidate, board)) return candidate;
  }
  return null;
};

const finesseNeighbors = (type, state, { allow180, rotationSystem, arr }) => {
  const result = [];
  const info = shapeInfo(type, state.rot);
  const wallLeft = -info.minX;
  const wallRight = BOARD_W - 1 - info.maxX;
  const leftTargets = arr <= 0
    ? [...new Set([state.x - 1, wallLeft])].filter((x) => x >= wallLeft && x < state.x)
    : Array.from({ length: state.x - wallLeft }, (_, index) => state.x - index - 1);
  const rightTargets = arr <= 0
    ? [...new Set([state.x + 1, wallRight])].filter((x) => x <= wallRight && x > state.x)
    : Array.from({ length: wallRight - state.x }, (_, index) => state.x + index + 1);
  for (const x of leftTargets) {
    result.push({ x, rot: state.rot, token: x === state.x - 1 ? 'left' : 'dasLeft' });
  }
  for (const x of rightTargets) {
    result.push({ x, rot: state.rot, token: x === state.x + 1 ? 'right' : 'dasRight' });
  }

  const rotations = [
    [1, 'rotateCW'],
    [-1, 'rotateCCW'],
  ];
  if (allow180) rotations.push([2, 'rotate180']);
  for (const [delta, token] of rotations) {
    const rotated = rotateState(type, state, delta, rotationSystem);
    if (rotated && (rotated.x !== state.x || rotated.rot !== state.rot)) result.push({ ...rotated, token });
  }
  return result;
};

const findFinesseSolutions = (type, targetKey, options: any = {}) => {
  const settings = {
    allow180: options.allow180 !== false,
    arr: options.arr === undefined ? 2 : Math.max(0, Number(options.arr) || 0),
    rotationSystem: options.rotationSystem === 'srs' ? 'srs' : 'srsplus',
  };
  const queue: any[] = [{ x: 3, rot: 0, path: [] }];
  const bestDepth = new Map([['3,0', 0]]);
  const solutions = [];
  let solutionDepth = Infinity;

  while (queue.length) {
    const state = queue.shift();
    if (state.path.length > solutionDepth) break;
    if (placementKey(type, state.x, state.rot) === targetKey) {
      solutionDepth = state.path.length;
      solutions.push(state.path);
      if (solutions.length >= 12) break;
      continue;
    }
    if (state.path.length >= solutionDepth) continue;
    for (const neighbor of finesseNeighbors(type, state, settings)) {
      const depth = state.path.length + 1;
      const key = `${neighbor.x},${neighbor.rot}`;
      const previousDepth = bestDepth.get(key);
      if (previousDepth !== undefined && previousDepth < depth) continue;
      bestDepth.set(key, depth);
      queue.push({ x: neighbor.x, rot: neighbor.rot, path: [...state.path, neighbor.token] });
    }
  }

  return { minInputs: solutionDepth, solutions };
};

const findBoardFinesseSolutions = (type, target, board, options: any = {}) => {
  const settings = {
    allow180: options.allow180 !== false,
    arr: options.arr === undefined ? 2 : Math.max(0, Number(options.arr) || 0),
    rotationSystem: options.rotationSystem === 'srs' ? 'srs' : 'srsplus',
    startY: Number.isFinite(options.startY) ? Number(options.startY) : 19,
    allowVerticalMovement: options.allowVerticalMovement !== false,
  };
  const targetKey = cellsKey(target.cells || target);
  const start = { x: 3, y: settings.startY, rot: 0, path: [] };
  if (collidesWithBoard(type, start, board)) return { minInputs: Infinity, solutions: [] };
  const queue: any[] = [start];
  const bestDepth = new Map([[`${start.x},${start.y},${start.rot}`, 0]]);
  const solutions = [];
  let solutionDepth = Infinity;

  while (queue.length) {
    const state = queue.shift();
    if (state.path.length > solutionDepth) break;
    const landing = dropPlacement(type, state, board);
    if (landing && cellsKey(pieceCells(type, landing)) === targetKey) {
      solutionDepth = state.path.length;
      solutions.push(state.path);
      if (solutions.length >= 12) break;
      continue;
    }
    const fallen = { x: state.x, y: state.y + 1, rot: state.rot };
    if (settings.allowVerticalMovement && !collidesWithBoard(type, fallen, board)) {
      const fallKey = `${fallen.x},${fallen.y},${fallen.rot}`;
      const previousDepth = bestDepth.get(fallKey);
      if (previousDepth === undefined || previousDepth > state.path.length) {
        bestDepth.set(fallKey, state.path.length);
        queue.unshift({ ...fallen, path: state.path });
      }
    }
    if (state.path.length >= solutionDepth) continue;

    const neighbors: any[] = [];
    for (const dir of [-1, 1]) {
      let x = state.x;
      const reachable = [];
      while (!collidesWithBoard(type, { ...state, x: x + dir }, board)) {
        x += dir;
        reachable.push(x);
      }
      const targets = settings.arr <= 0
        ? [...new Set([reachable[0], reachable[reachable.length - 1]])].filter(Number.isFinite)
        : reachable;
      for (const targetX of targets) {
        const distance = Math.abs(targetX - state.x);
        neighbors.push({
          x: targetX,
          y: state.y,
          rot: state.rot,
          token: dir < 0 ? distance === 1 ? 'left' : 'dasLeft' : distance === 1 ? 'right' : 'dasRight',
        });
      }
    }

    const rotations: any[] = [[1, 'rotateCW'], [-1, 'rotateCCW']];
    if (settings.allow180) rotations.push([2, 'rotate180']);
    for (const [delta, token] of rotations) {
      const rotated = rotateBoardState(type, state, delta, board, settings.rotationSystem);
      if (rotated) neighbors.push({ ...rotated, token });
    }

    for (const neighbor of neighbors) {
      const depth = state.path.length + 1;
      const key = `${neighbor.x},${neighbor.y},${neighbor.rot}`;
      const previousDepth = bestDepth.get(key);
      if (previousDepth !== undefined && previousDepth < depth) continue;
      bestDepth.set(key, depth);
      queue.push({ ...neighbor, path: [...state.path, neighbor.token] });
    }
  }

  return { minInputs: solutionDepth, solutions };
};

const randomUnit = (random) => Math.max(0, Math.min(0.999999999, Number(random()) || 0));

const practicalStackDelta = (random) => {
  const roll = randomUnit(random);
  return roll < 0.22 ? -1 : roll > 0.78 ? 1 : 0;
};

// Builds the field backwards from a clean post-placement skyline. The target
// tetromino is then removed from the top of its columns, leaving an open,
// hard-drop-safe cavity instead of a bridge over arbitrary column heights.
const createStackBoard = (baseCase, random = Math.random, maxHeight = 5) => {
  const maxLift = Math.max(2, Math.min(8, Math.floor(Number(maxHeight) || 5)));
  const lift = 2 + Math.floor(randomUnit(random) * (maxLift - 1));
  const target = { x: baseCase.x, y: baseCase.y - lift, rot: baseCase.rot };
  const cells = sortCells(pieceCells(baseCase.type, target));
  const targetColumns = new Set(cells.map(([x]) => x));
  const bottomByColumn = new Map();
  const countByColumn = new Map();
  for (const [x, y] of cells) {
    bottomByColumn.set(x, Math.max(bottomByColumn.get(x) ?? -Infinity, y));
    countByColumn.set(x, (countByColumn.get(x) || 0) + 1);
  }

  const heights = Array(BOARD_W).fill(null);
  for (const [x, bottomY] of bottomByColumn) heights[x] = BOARD_H - 1 - bottomY;
  const columns = [...targetColumns].sort((left, right) => left - right);
  const minTarget = columns[0];
  const maxTarget = columns[columns.length - 1];
  const maxSurfaceHeight = Math.max(maxLift + 3, ...heights.filter(Number.isFinite));
  const continueSurface = (neighbor) => Math.max(1, Math.min(maxSurfaceHeight, neighbor + practicalStackDelta(random)));
  for (let x = minTarget - 1; x >= 0; x -= 1) heights[x] = continueSurface(heights[x + 1]);
  for (let x = maxTarget + 1; x < BOARD_W; x += 1) heights[x] = continueSurface(heights[x - 1]);

  // Keep a conventional open side well so no line is already complete. The
  // well never intersects the requested target, and every other column stays
  // solid from the floor upward.
  const edgeWells = [0, BOARD_W - 1].filter((x) => !targetColumns.has(x));
  const gap = edgeWells[Math.floor(randomUnit(random) * edgeWells.length)];
  heights[gap] = 0;

  const completedHeights = heights.map((height, x) => height + (countByColumn.get(x) || 0));
  const board = Array.from({ length: BOARD_H }, () => Array(BOARD_W).fill(null));
  for (let x = 0; x < BOARD_W; x += 1) {
    for (let offset = 0; offset < completedHeights[x]; offset += 1) board[BOARD_H - 1 - offset][x] = 'J';
  }
  for (const [x, y] of cells) board[y][x] = null;
  return { board, heights, completedHeights, gap, target, cells };
};

const createStackFinesseCase = (baseCase, random = Math.random, options: any = {}) => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { board, heights, completedHeights, gap, target, cells } = createStackBoard(baseCase, random, options.maxHeight || 5);
    const landing = dropPlacement(baseCase.type, { x: target.x, y: 19, rot: target.rot }, board);
    if (!landing || cellsKey(pieceCells(baseCase.type, landing)) !== cellsKey(cells)) continue;
    const route = findBoardFinesseSolutions(baseCase.type, { cells }, board, { ...options, allowVerticalMovement: false });
    if (!Number.isFinite(route.minInputs) || !route.solutions.length) continue;
    return {
      ...baseCase,
      id: `stack:${baseCase.id}:${heights.join('.')}`,
      masteryId: baseCase.id,
      context: 'stack',
      board,
      stackHeights: heights,
      completedStackHeights: completedHeights,
      stackGap: gap,
      x: target.x,
      y: target.y,
      rot: target.rot,
      cells,
      exactTargetKey: cellsKey(cells),
      minInputs: route.minInputs,
      solutions: route.solutions,
    };
  }
  return null;
};

const masteryLevel = (progress) => {
  const attempts = Math.max(0, Number(progress?.attempts) || 0);
  if (!attempts) return 'untried';
  const successes = Math.max(0, Number(progress?.successes) || 0);
  const accuracy = successes / attempts;
  if (attempts >= 10 && accuracy >= 0.95 && (progress?.bestStreak || 0) >= 5) return 'mastered';
  if (attempts >= 5 && accuracy >= 0.8) return 'solid';
  return 'learning';
};

const createFinesseCatalog = (options: any = {}) => {
  const catalog = [];
  for (const type of PIECES) {
    const seenShapes = new Set();
    for (let rot = 0; rot < 4; rot += 1) {
      const info = shapeInfo(type, rot);
      if (seenShapes.has(info.signature)) continue;
      seenShapes.add(info.signature);
      for (let left = 0; left <= BOARD_W - info.width; left += 1) {
        const x = left - info.minX;
        const y = BOARD_H - 1 - info.maxY;
        const targetKey = `${info.signature}@${left}`;
        const solution = findFinesseSolutions(type, targetKey, options);
        catalog.push({
          id: `${type}:${rot}:${left}`,
          type,
          rot,
          rotationLabel: ROTATION_LABELS[rot],
          left,
          x,
          y,
          width: info.width,
          height: info.height,
          cells: sortCells(SHAPES[type][rot].map(([dx, dy]) => [x + dx, y + dy])),
          targetKey,
          minInputs: solution.minInputs,
          solutions: solution.solutions,
        });
      }
    }
  }
  return catalog;
};

const shuffleFinesseCases = (cases, random = Math.random) => {
  const shuffled = [...cases];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled;
};

const selectFinesseCases = (catalog, pieces, filters: any = {}) => {
  const allowed = new Set(Array.isArray(pieces) && pieces.length ? pieces : PIECES);
  const rotations = new Set(Array.isArray(filters.rotations) && filters.rotations.length ? filters.rotations : [0, 1, 2, 3]);
  const columns = new Set(Array.isArray(filters.columns) && filters.columns.length
    ? filters.columns
    : Array.from({ length: BOARD_W }, (_, index) => index));
  return catalog.filter((entry) => allowed.has(entry.type) && rotations.has(entry.rot) && columns.has(entry.left));
};

const rankWeakFinesseCases = (cases, mastery, limit = 30) => {
  const attempted = cases.filter((entry) => {
    const progress = mastery?.[entry.id];
    return (progress?.attempts || 0) > 0
      && ((progress?.faults || 0) > 0 || (progress?.successes || 0) < (progress?.attempts || 0));
  });
  if (!attempted.length) return [...cases];
  return [...attempted]
    .sort((a, b) => {
      const left = mastery[a.id] || {};
      const right = mastery[b.id] || {};
      const leftRate = (left.successes || 0) / Math.max(1, left.attempts || 0);
      const rightRate = (right.successes || 0) / Math.max(1, right.attempts || 0);
      return leftRate - rightRate
        || (right.faults || 0) - (left.faults || 0)
        || (left.lastPracticed || 0) - (right.lastPracticed || 0);
    })
    .slice(0, Math.min(limit, attempted.length));
};

const evaluateFinessePlacement = (target, piece, manipulationCount) => {
  const exactMatch = piece && (target?.exactTargetKey
    ? cellsKey(pieceCells(piece.type, piece)) === target.exactTargetKey
    : placementKey(piece.type, piece.x, piece.rot) === target?.targetKey);
  if (!target || !piece || piece.type !== target.type || !exactMatch) {
    return { success: false, reason: 'wrong-position', extraInputs: 0 };
  }
  const extraInputs = Math.max(0, manipulationCount - target.minInputs);
  if (extraInputs > 0) return { success: false, reason: 'extra-input', extraInputs };
  return { success: true, reason: 'perfect', extraInputs: 0 };
};

const formatFinesseSolution = (solution) => solution.map((token) => TOKEN_LABELS[token] || token).join(' ');

export {
  ROTATION_LABELS,
  TOKEN_LABELS,
  cellsKey,
  collidesWithBoard,
  createFinesseCatalog,
  createStackFinesseCase,
  dropPlacement,
  evaluateFinessePlacement,
  findBoardFinesseSolutions,
  findFinesseSolutions,
  formatFinesseSolution,
  masteryLevel,
  pieceCells,
  placementKey,
  rankWeakFinesseCases,
  selectFinesseCases,
  shapeInfo,
  shuffleFinesseCases,
};
