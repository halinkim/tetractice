const VERSION = '1.0.1';
const TICK_RATE = 60;
const TICK_MS = 1000 / TICK_RATE;
const BOARD_W = 10;
const BOARD_H = 40;
const VISIBLE_H = 20;
const VISIBLE_START = BOARD_H - VISIBLE_H;
const CELL = 80;
const STORAGE_CONFIG = 'stacklab.config.v1';
const STORAGE_PB = 'stacklab.pb.v1';
const STORAGE_FINESSE = 'stacklab.finesse.v1';
const STORAGE_SPIN = 'stacklab.spin.v1';

const $ = (id: string): any => document.getElementById(id);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const deepClone = (value: any): any => JSON.parse(JSON.stringify(value));
const isObject = (value: any) => value && typeof value === 'object' && !Array.isArray(value);
const deepMerge = (base: any, patch: any): any => {
  const out = deepClone(base);
  const merge = (target: any, source: any) => {
    if (!isObject(source)) return target;
    for (const [key, value] of Object.entries(source)) {
      if (isObject(value) && isObject(target[key])) merge(target[key], value);
      else if (value !== undefined) target[key] = deepClone(value);
    }
    return target;
  };
  return merge(out, patch);
};

const PIECES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
const PIECE_COLORS = {
  I: '#38d9e6',
  J: '#5b74f4',
  L: '#f5a03a',
  O: '#f7d84a',
  S: '#4dd184',
  T: '#a966e8',
  Z: '#f15370',
};

const SHAPES = {
  I: [
    [[0, 1], [1, 1], [2, 1], [3, 1]],
    [[2, 0], [2, 1], [2, 2], [2, 3]],
    [[0, 2], [1, 2], [2, 2], [3, 2]],
    [[1, 0], [1, 1], [1, 2], [1, 3]],
  ],
  O: [
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
  ],
  T: [
    [[1, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [1, 2]],
    [[1, 0], [0, 1], [1, 1], [1, 2]],
  ],
  J: [
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [2, 2]],
    [[1, 0], [1, 1], [0, 2], [1, 2]],
  ],
  L: [
    [[2, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 2]],
    [[0, 1], [1, 1], [2, 1], [0, 2]],
    [[0, 0], [1, 0], [1, 1], [1, 2]],
  ],
  S: [
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[1, 0], [1, 1], [2, 1], [2, 2]],
    [[1, 1], [2, 1], [0, 2], [1, 2]],
    [[0, 0], [0, 1], [1, 1], [1, 2]],
  ],
  Z: [
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[2, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [1, 2], [2, 2]],
    [[1, 0], [0, 1], [1, 1], [0, 2]],
  ],
};

// SRS kick coordinates converted to a screen coordinate system where +y points down.
const JLSTZ_90 = {
  '0>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '1>0': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '1>2': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '2>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '2>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '3>2': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '3>0': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '0>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
};

const I_90_SRS = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
};

// TETR.IO-style SRS+ mirrors the I piece's left-facing 90° kick tables.
const I_90_SRS_PLUS = {
  ...I_90_SRS,
  '0>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '3>0': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3>2': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

const JLSTZ_180 = {
  '0>2': [[0, 0], [0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0]],
  '2>0': [[0, 0], [0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0]],
  '1>3': [[0, 0], [1, 0], [1, 2], [1, 1], [0, 2], [0, 1]],
  '3>1': [[0, 0], [-1, 0], [-1, 2], [-1, 1], [0, 2], [0, 1]],
};

const I_180 = {
  '0>2': [[0, 0], [0, 1]],
  '2>0': [[0, 0], [0, -1]],
  '1>3': [[0, 0], [1, 0]],
  '3>1': [[0, 0], [-1, 0]],
};

const ACTION_META = [
  ['moveLeft', 'MOVE LEFT'],
  ['moveRight', 'MOVE RIGHT'],
  ['softDrop', 'SOFT DROP'],
  ['hardDrop', 'HARD DROP'],
  ['rotateCCW', 'ROTATE COUNTERCLOCKWISE'],
  ['rotateCW', 'ROTATE CLOCKWISE'],
  ['rotate180', 'ROTATE 180°'],
  ['hold', 'HOLD'],
  ['retry', 'RETRY'],
  ['pause', 'PAUSE'],
  ['config', 'CONFIG'],
  ['fullscreen', 'FULLSCREEN'],
];

const GUIDELINE_BINDINGS = {
  moveLeft: ['ArrowLeft', 'Numpad4', 'GP:B14'],
  moveRight: ['ArrowRight', 'Numpad6', 'GP:B15'],
  softDrop: ['ArrowDown', 'Numpad2', 'GP:B13'],
  hardDrop: ['Space', 'Numpad8', 'GP:B1'],
  rotateCCW: ['KeyZ', 'ControlLeft', 'GP:B2'],
  rotateCW: ['ArrowUp', 'KeyX', 'GP:B0'],
  rotate180: ['KeyA', '', 'GP:B3'],
  hold: ['KeyC', 'ShiftLeft', 'GP:B4'],
  retry: ['KeyR', '', ''],
  pause: ['Escape', 'F1', 'GP:B9'],
  config: ['F10', '', ''],
  fullscreen: ['F11', '', ''],
};

const WASD_BINDINGS = {
  moveLeft: ['KeyA', 'Numpad4', 'GP:B14'],
  moveRight: ['KeyD', 'Numpad6', 'GP:B15'],
  softDrop: ['KeyW', 'Numpad8', 'GP:B13'],
  hardDrop: ['KeyS', 'Numpad5', 'GP:B1'],
  rotateCCW: ['ArrowLeft', 'Numpad7', 'GP:B2'],
  rotateCW: ['ArrowRight', 'Numpad9', 'GP:B0'],
  rotate180: ['ArrowUp', 'Numpad2', 'GP:B3'],
  hold: ['ShiftLeft', 'NumpadEnter', 'GP:B4'],
  retry: ['KeyR', '', ''],
  pause: ['Escape', 'F1', 'GP:B9'],
  config: ['F10', '', ''],
  fullscreen: ['F11', '', ''],
};

const PRESET_ALIASES = {
  guideline: {
    rotateCCW: ['ControlRight', 'Numpad3', 'Numpad7'],
    rotateCW: ['Numpad1', 'Numpad5', 'Numpad9'],
    hold: ['ShiftRight', 'Numpad0'],
  },
  wasd: {
    hold: ['ShiftRight'],
  },
};

const DEFAULT_CONFIG = {
  handling: {
    arr: 2,
    das: 10,
    dcd: 0,
    sdf: 6,
    sdfMax: false,
    hardDropSafety: true,
    cancelDas: false,
    softDropPriority: false,
    irs: 'hold',
    ihs: 'hold',
  },
  controls: {
    preset: 'guideline',
    bindings: deepClone(GUIDELINE_BINDINGS),
    gamepadSensitivity: 55,
  },
  gameplay: {
    randomizer: 'calm',
    rotation: 'srsplus',
    gravity: 0.02,
    lockDelay: 30,
    lockResets: 15,
    are: 0,
    lineAre: 0,
    customLines: 100,
    ghost: true,
    holdEnabled: true,
    allow180: true,
  },
  visual: {
    uiScale: 'auto',
    boardZoom: 100,
    gridOpacity: 22,
    ghostOpacity: 28,
    bounce: 55,
    particles: 65,
    volume: 55,
    coloredGhost: true,
    hardDropTrail: true,
    reducedMotion: false,
  },
  training: {
    finesseType: 'floor',
    finessePreset: 'all',
    finessePieces: deepClone(PIECES),
    finesseRotations: [0, 1, 2, 3],
    finesseColumns: Array.from({ length: BOARD_W }, (_, index) => index),
    spinStyle: 'guided',
    spinValidation: 'technique',
    spinPreset: 'basics',
    spinPieces: ['T', 'S', 'Z'],
  },
  ui: {
    mode: 'sprint',
    proMode: true,
    finesseAlert: true,
    retryOnFinesse: false,
    strideMode: false,
    audioEnabled: true,
  },
};

const sanitizeConfig = (candidate: any): any => {
  const cfg = deepMerge(DEFAULT_CONFIG, candidate || {});
  cfg.handling.arr = clamp(Number(cfg.handling.arr) || 0, 0, 20);
  cfg.handling.das = clamp(Number(cfg.handling.das) || 1, 1, 60);
  cfg.handling.dcd = clamp(Number(cfg.handling.dcd) || 0, 0, 60);
  cfg.handling.sdf = clamp(Number(cfg.handling.sdf) || 1, 1, 40);
  cfg.handling.sdfMax = Boolean(cfg.handling.sdfMax);
  cfg.handling.hardDropSafety = Boolean(cfg.handling.hardDropSafety);
  cfg.handling.cancelDas = Boolean(cfg.handling.cancelDas);
  cfg.handling.softDropPriority = Boolean(cfg.handling.softDropPriority);
  if (!['off', 'hold', 'tap'].includes(cfg.handling.irs)) cfg.handling.irs = 'hold';
  if (!['off', 'hold', 'tap'].includes(cfg.handling.ihs)) cfg.handling.ihs = 'hold';

  cfg.controls.gamepadSensitivity = clamp(Number(cfg.controls.gamepadSensitivity) || 55, 20, 95);
  cfg.controls.bindings = deepMerge(GUIDELINE_BINDINGS, cfg.controls.bindings || {});
  for (const [action] of ACTION_META) {
    const list = Array.isArray(cfg.controls.bindings[action]) ? cfg.controls.bindings[action].slice(0, 3) : [];
    while (list.length < 3) list.push('');
    cfg.controls.bindings[action] = list.map((x) => typeof x === 'string' ? x : '');
  }

  if (!['calm', 'bag7', 'bag14'].includes(cfg.gameplay.randomizer)) cfg.gameplay.randomizer = 'calm';
  if (!['srsplus', 'srs'].includes(cfg.gameplay.rotation)) cfg.gameplay.rotation = 'srsplus';
  cfg.gameplay.gravity = clamp(Number(cfg.gameplay.gravity) || 0, 0, 20);
  cfg.gameplay.lockDelay = clamp(Math.round(Number(cfg.gameplay.lockDelay) || 30), 1, 600);
  cfg.gameplay.lockResets = clamp(Math.round(Number(cfg.gameplay.lockResets) || 0), 0, 99);
  cfg.gameplay.are = clamp(Math.round(Number(cfg.gameplay.are) || 0), 0, 600);
  cfg.gameplay.lineAre = clamp(Math.round(Number(cfg.gameplay.lineAre) || 0), 0, 600);
  cfg.gameplay.customLines = clamp(Math.round(Number(cfg.gameplay.customLines) || 0), 0, 9999);
  cfg.gameplay.ghost = Boolean(cfg.gameplay.ghost);
  cfg.gameplay.holdEnabled = Boolean(cfg.gameplay.holdEnabled);
  cfg.gameplay.allow180 = Boolean(cfg.gameplay.allow180);

  cfg.visual.uiScale = ['100', '125', '150', '175', '200'].includes(String(cfg.visual.uiScale))
    ? String(cfg.visual.uiScale)
    : 'auto';
  for (const key of ['boardZoom', 'gridOpacity', 'ghostOpacity', 'bounce', 'particles', 'volume']) {
    cfg.visual[key] = clamp(Number(cfg.visual[key]) || 0, key === 'boardZoom' ? 60 : 0, key === 'boardZoom' ? 140 : 100);
  }
  cfg.visual.coloredGhost = Boolean(cfg.visual.coloredGhost);
  cfg.visual.hardDropTrail = Boolean(cfg.visual.hardDropTrail);
  cfg.visual.reducedMotion = Boolean(cfg.visual.reducedMotion);
  if (!['floor', 'stack', 'flow'].includes(cfg.training.finesseType)) cfg.training.finesseType = 'floor';
  if (!['all', 'custom', 'weak'].includes(cfg.training.finessePreset)) cfg.training.finessePreset = 'all';
  const finessePieces = Array.isArray(cfg.training.finessePieces) ? cfg.training.finessePieces : PIECES;
  cfg.training.finessePieces = PIECES.filter((piece) => finessePieces.includes(piece));
  if (!cfg.training.finessePieces.length) cfg.training.finessePieces = deepClone(PIECES);
  const finesseRotations = Array.isArray(cfg.training.finesseRotations) ? cfg.training.finesseRotations : [0, 1, 2, 3];
  cfg.training.finesseRotations = [0, 1, 2, 3].filter((rotation) => finesseRotations.includes(rotation));
  if (!cfg.training.finesseRotations.length) cfg.training.finesseRotations = [0, 1, 2, 3];
  const finesseColumns = Array.isArray(cfg.training.finesseColumns) ? cfg.training.finesseColumns : Array.from({ length: BOARD_W }, (_, index) => index);
  cfg.training.finesseColumns = Array.from({ length: BOARD_W }, (_, index) => index).filter((column) => finesseColumns.includes(column));
  if (!cfg.training.finesseColumns.length) cfg.training.finesseColumns = Array.from({ length: BOARD_W }, (_, index) => index);
  if (!['guided', 'recall'].includes(cfg.training.spinStyle)) cfg.training.spinStyle = 'guided';
  if (!['technique', 'placement'].includes(cfg.training.spinValidation)) cfg.training.spinValidation = 'technique';
  if (!['basics', 'all', 'states', 'weak', 'custom'].includes(cfg.training.spinPreset)) cfg.training.spinPreset = 'basics';
  const spinPieces = Array.isArray(cfg.training.spinPieces) ? cfg.training.spinPieces : ['T', 'S', 'Z'];
  cfg.training.spinPieces = ['T', 'S', 'Z', 'L', 'J', 'I'].filter((piece) => spinPieces.includes(piece));
  if (!cfg.training.spinPieces.length) cfg.training.spinPieces = ['T', 'S', 'Z'];
  if (!['sprint', 'zen', 'custom', 'finesse', 'spin'].includes(cfg.ui.mode)) cfg.ui.mode = 'sprint';
  cfg.ui.proMode = Boolean(cfg.ui.proMode);
  cfg.ui.finesseAlert = Boolean(cfg.ui.finesseAlert);
  cfg.ui.retryOnFinesse = Boolean(cfg.ui.retryOnFinesse);
  cfg.ui.strideMode = Boolean(cfg.ui.strideMode);
  cfg.ui.audioEnabled = Boolean(cfg.ui.audioEnabled);
  return cfg;
};

const loadJSON = (key: string, fallback: any): any => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
};

let config: any = sanitizeConfig(loadJSON(STORAGE_CONFIG, null));
let personalBests: any = loadJSON(STORAGE_PB, { sprint: null });

const prettyCode = (code) => {
  if (!code) return '—';
  if (code.startsWith('GP:B')) return `PAD ${code.slice(4)}`;
  const map = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    Space: 'SPACE', Escape: 'ESC', ControlLeft: 'LCTRL', ControlRight: 'RCTRL',
    ShiftLeft: 'LSHIFT', ShiftRight: 'RSHIFT', Backspace: 'BACKSPACE', Delete: 'DELETE',
    Numpad0: 'NUM 0', Numpad1: 'NUM 1', Numpad2: 'NUM 2', Numpad3: 'NUM 3',
    Numpad4: 'NUM 4', Numpad5: 'NUM 5', Numpad6: 'NUM 6', Numpad7: 'NUM 7',
    Numpad8: 'NUM 8', Numpad9: 'NUM 9', NumpadEnter: 'NUM ENTER',
    F1: 'F1', F10: 'F10', F11: 'F11',
  };
  if (map[code]) return map[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return code.toUpperCase();
};

export const setConfig = (next: any) => {
  config = next;
};

export const setPersonalBests = (next: any) => {
  personalBests = next;
};

export {
  VERSION,
  TICK_RATE,
  TICK_MS,
  BOARD_W,
  BOARD_H,
  VISIBLE_H,
  VISIBLE_START,
  CELL,
  STORAGE_CONFIG,
  STORAGE_PB,
  STORAGE_FINESSE,
  STORAGE_SPIN,
  $,
  clamp,
  deepClone,
  deepMerge,
  PIECES,
  PIECE_COLORS,
  SHAPES,
  JLSTZ_90,
  I_90_SRS,
  I_90_SRS_PLUS,
  JLSTZ_180,
  I_180,
  ACTION_META,
  GUIDELINE_BINDINGS,
  WASD_BINDINGS,
  PRESET_ALIASES,
  DEFAULT_CONFIG,
  sanitizeConfig,
  loadJSON,
  config,
  personalBests,
  prettyCode,
};
