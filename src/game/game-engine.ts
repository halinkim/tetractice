import type { AudioEngine } from '../audio/audio-engine';
import type { InputManager } from '../input/input-manager';
import type { Renderer } from '../render/renderer';
import {
  $,
  BOARD_H,
  BOARD_W,
  I_180,
  I_90_SRS,
  I_90_SRS_PLUS,
  JLSTZ_180,
  JLSTZ_90,
  PIECE_COLORS,
  SHAPES,
  STORAGE_PB,
  STORAGE_FINESSE,
  STORAGE_SPIN,
  TICK_MS,
  TICK_RATE,
  VERSION,
  VISIBLE_START,
  clamp,
  config,
  deepClone,
  personalBests,
} from '../core/state';
import { uiBridge } from '../ui/bridge';
import {
  createFinesseCatalog,
  createStackFinesseCase,
  evaluateFinessePlacement,
  findBoardFinesseSolutions,
  findFinesseSolutions,
  formatFinesseSolution,
  masteryLevel,
  pieceCells,
  placementKey,
  rankWeakFinesseCases,
  selectFinesseCases,
  shuffleFinesseCases,
} from './finesse';
import {
  SPIN_GUIDES,
  createSpinCatalog,
  evaluateSpinAttempt,
  spinStateName,
} from './spin';
import { PieceRandomizer, XorShift32 } from './randomizer';

const makeBoard = () => Array.from({ length: BOARD_H }, () => Array(BOARD_W).fill(null));
const TIMELINE_ACTIONS = [
  'moveLeft', 'moveRight', 'softDrop', 'hardDrop',
  'rotateCW', 'rotateCCW', 'rotate180', 'hold',
  'retry', 'pause', 'config', 'fullscreen',
];
const SUBFRAME_EPSILON = 1e-7;
const FINESSE_NEUTRAL_ACTIONS = [
  'moveLeft', 'moveRight', 'softDrop', 'hardDrop',
  'rotateCW', 'rotateCCW', 'rotate180', 'hold',
];

const loadFinesseProgress = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_FINESSE) || 'null');
    return parsed?.cases && typeof parsed.cases === 'object' ? parsed : { version: 2, cases: {} };
  } catch (_) {
    return { version: 2, cases: {} };
  }
};

const loadSpinProgress = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_SPIN) || 'null');
    return parsed?.cases && typeof parsed.cases === 'object' ? parsed : { version: 1, cases: {} };
  } catch (_) {
    return { version: 1, cases: {} };
  }
};

class GameEngine {
  [key: string]: any;
  constructor(input, renderer, audio) {
    this.input = input;
    this.renderer = renderer;
    this.audio = audio;
    this.mode = config.ui.mode;
    this.state = 'idle';
    this.seed = 0;
    this.board = makeBoard();
    this.randomizer = null;
    this.current = null;
    this.holdType = null;
    this.canHold = true;
    this.runFrame = 0;
    this.playFrame = 0;
    this.currentSubframe = 0;
    this.tickHeld = null;
    this.tickLastPressed = null;
    this.countdownFrames = 0;
    this.countdownStyle = 'normal';
    this.areRemaining = 0;
    this.gravityAccumulator = 0;
    this.lockTimer = 0;
    this.lockResetsUsed = 0;
    this.lines = 0;
    this.score = 0;
    this.attack = 0;
    this.pieces = 0;
    this.inputs = 0;
    this.finesseFaults = 0;
    this.finessePerfectPieces = 0;
    this.finesseProgress = loadFinesseProgress();
    this.finesseCatalog = [];
    this.finesseSession = null;
    this.finesseHintTimer = 0;
    this.spinProgress = loadSpinProgress();
    this.spinCatalog = [];
    this.spinSession = null;
    this.spinGuidePiece = 'PRINCIPLE';
    this.masteryPiece = 'I';
    this.masteryCaseId = null;
    this.combo = -1;
    this.b2b = 0;
    this.lastAction = null;
    this.lastRotation = null;
    this.pieceManipulations = 0;
    this.pieceInputTokens = [];
    this.bufferTap = { hold: false, rotation: null };
    this.horizontal = {
      leftCharge: 0,
      rightCharge: 0,
      repeat: 0,
      activeDir: 0,
      dcd: 0,
    };
    this.replay = null;
    this.replayMode = false;
    this.replayCursor = 0;
    this.lastReplay = null;
    this.result = null;
    this.settingsPaused = false;
    this.handlingTest = false;
    this.actionTextTimer = 0;
    this.retryHoldFrames = 0;
    this.retryArmed = false;
    this.updateModeUI();
    this.setState('idle');
  }
  setState(state) {
    this.state = state;
    $('app').dataset.state = state;
    $('countdownOverlay').classList.toggle('is-hidden', state !== 'countdown');
    $('pauseOverlay').classList.toggle('is-hidden', state !== 'paused');
    $('resultOverlay').classList.toggle('is-hidden', state !== 'over');
    const status = state === 'playing' ? ['finesse', 'spin'].includes(this.mode) ? 'TRAINING' : 'RUNNING' : state === 'paused' ? 'PAUSED' : state === 'countdown' ? 'GET READY' : state === 'over' ? 'RESULT' : 'READY';
    $('statusText').textContent = status;
  }
  setCountdownText(text) {
    const element = $('countdownValue');
    if (element.textContent === text) return;
    element.textContent = text;
    element.style.animation = 'none';
    void element.offsetWidth;
    element.style.animation = '';
  }
  updateModeUI() {
    const finesseDescription = config.training.finesseType === 'stack'
      ? '실제 지형 위 목표 배치를 최소 입력으로 익히세요.'
      : config.training.finesseType === 'flow'
        ? '7-bag 실전 플레이에서 매 미노의 피네스를 점검하세요.'
        : '선택한 미노의 모든 바닥 배치를 최소 입력으로 익히세요.';
    const modeInfo = {
      sprint: ['SPRINT', '40 LINES', '40줄을 가능한 한 빠르게 제거하세요.', 'LINES LEFT'],
      finesse: ['TRAINING', 'FINESSE LAB', finesseDescription, 'CASES LEFT'],
      spin: ['TRAINING', 'SPIN LAB', '하드드롭으로 닿지 않는 홈을 소프트드롭과 회전으로 완성하세요.', 'CASES LEFT'],
      zen: ['ZEN MODE', 'ZEN', '종료 조건 없이 쌓기와 핸들링을 연습하세요.', 'LINES'],
      custom: ['CUSTOM GAME', 'CUSTOM', '설정한 목표 줄 수 또는 무한 모드로 연습하세요.', 'LINES LEFT'],
    }[this.mode];
    $('app').dataset.mode = this.mode;
    $('modeKicker').textContent = modeInfo[0];
    $('modeTitle').textContent = modeInfo[1];
    $('modeDescription').textContent = modeInfo[2];
    $('objectiveLabel').textContent = modeInfo[3];
    const strideToggle = $('strideModeToggle');
    if (strideToggle) {
      strideToggle.disabled = ['zen', 'finesse', 'spin'].includes(this.mode);
      strideToggle.closest('label')?.classList.toggle('is-disabled', ['zen', 'finesse', 'spin'].includes(this.mode));
      strideToggle.closest('label')?.setAttribute('title', ['zen', 'finesse', 'spin'].includes(this.mode) ? '이 모드에서는 Stride Mode를 별도로 사용하지 않습니다.' : 'READY–SET–GO 시작 시퀀스를 사용합니다.');
    }
    const finesseRetryToggle = $('finesseRetryToggle');
    if (finesseRetryToggle) {
      finesseRetryToggle.disabled = ['zen', 'finesse', 'spin'].includes(this.mode);
      finesseRetryToggle.closest('label')?.classList.toggle('is-disabled', ['zen', 'finesse', 'spin'].includes(this.mode));
      finesseRetryToggle.closest('label')?.setAttribute('title', this.mode === 'finesse'
        ? config.training.finesseType === 'flow' ? 'FLOW에서는 보드를 유지하며 다음 미노를 계속 플레이합니다.' : 'FINESSE LAB은 틀린 케이스만 즉시 다시 출제합니다.'
        : this.mode === 'zen' ? '자동 재시작은 ZEN에서 적용되지 않습니다.' : 'Finesse fault가 감지되면 같은 시드로 다시 시작합니다.');
    }
    $('finesseSetup').classList.toggle('is-hidden', this.mode !== 'finesse');
    $('spinSetup').classList.toggle('is-hidden', this.mode !== 'spin');
    this.updateFinesseSetup();
    this.updateSpinSetup();
    document.querySelectorAll('.mode-tab').forEach((button: any) => button.classList.toggle('is-active', button.dataset.mode === this.mode));
    this.updatePB();
    this.updateHUD();
  }
  refreshFinesseCatalog() {
    const signature = `${config.gameplay.rotation}:${config.gameplay.allow180}:${config.handling.arr}`;
    if (signature === this.finesseCatalogSignature && this.finesseCatalog.length) return;
    this.finesseCatalogSignature = signature;
    this.finesseCatalog = createFinesseCatalog({
      allow180: config.gameplay.allow180,
      arr: config.handling.arr,
      rotationSystem: config.gameplay.rotation,
    });
  }
  configuredFinesseCases() {
    this.refreshFinesseCatalog();
    const selected = selectFinesseCases(this.finesseCatalog, config.training.finessePieces, {
      rotations: config.training.finesseRotations,
      columns: config.training.finesseColumns,
    });
    if (config.training.finessePreset === 'weak') {
      return rankWeakFinesseCases(selected, this.finesseProgress.cases, 30);
    }
    return selected;
  }
  updateFinesseSetup() {
    if (!$('finesseSetup')) return;
    const cases = this.configuredFinesseCases();
    const preset = config.training.finessePreset;
    const trainingType = config.training.finesseType;
    $('finesseSetup').dataset.trainingType = trainingType;
    document.querySelectorAll('#finesseTypePicker [data-finesse-type]').forEach((button: any) => {
      const selected = button.dataset.finesseType === trainingType;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-selected', selected);
    });
    $('finesseAllButton').classList.toggle('is-active', preset === 'all');
    $('finesseWeakButton').classList.toggle('is-active', preset === 'weak');
    document.querySelectorAll('#finessePiecePicker [data-piece]').forEach((button: any) => {
      const selected = config.training.finessePieces.includes(button.dataset.piece);
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-selected', selected);
    });
    document.querySelectorAll('#finesseRotationPicker [data-rotation]').forEach((button: any) => {
      const selected = config.training.finesseRotations.includes(Number(button.dataset.rotation));
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-selected', selected);
    });
    document.querySelectorAll('#finesseColumnPicker [data-column]').forEach((button: any) => {
      const selected = config.training.finesseColumns.includes(Number(button.dataset.column));
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-selected', selected);
    });
    $('finessePresetLabel').textContent = trainingType === 'flow'
      ? 'ENDLESS FLOW'
      : preset === 'weak' ? 'WEAK REVIEW' : preset === 'custom' ? `${trainingType === 'stack' ? 'STACK' : 'CUSTOM'} CYCLE` : trainingType === 'stack' ? 'STACK CYCLE' : 'FULL CYCLE';
    $('finesseCaseCount').textContent = trainingType === 'flow' ? '∞' : String(cases.length);
    $('finesseCaseUnit').textContent = trainingType === 'flow' ? '7-BAG' : 'CASES';
    $('startButton').disabled = this.mode === 'finesse' && trainingType !== 'flow' && cases.length === 0;
  }
  refreshSpinCatalog() {
    const signature = `${config.gameplay.rotation}:${config.gameplay.allow180}`;
    if (signature === this.spinCatalogSignature && this.spinCatalog.length) return;
    this.spinCatalogSignature = signature;
    this.spinCatalog = createSpinCatalog({ rotationSystem: config.gameplay.rotation, allow180: config.gameplay.allow180 });
  }
  configuredSpinCases() {
    this.refreshSpinCatalog();
    let selected = this.spinCatalog.filter((entry) => (
      config.training.spinPieces.includes(entry.type)
      && !['build', 'deep'].includes(entry.variant)
    ));
    if (config.training.spinPreset === 'basics') selected = selected.filter((entry) => entry.tier === 'basic');
    if (config.training.spinPreset === 'states') selected = selected.filter((entry) => ['S', 'Z'].includes(entry.type) && entry.family === 'insert-double');
    if (config.training.spinPreset !== 'weak') return selected;
    return [...selected].sort((a, b) => {
      const ap = this.spinProgress.cases[a.id] || {};
      const bp = this.spinProgress.cases[b.id] || {};
      const aAccuracy = ap.attempts ? (ap.successes || 0) / ap.attempts : -1;
      const bAccuracy = bp.attempts ? (bp.successes || 0) / bp.attempts : -1;
      return aAccuracy - bAccuracy || (bp.faults || 0) - (ap.faults || 0) || a.id.localeCompare(b.id);
    }).slice(0, 12);
  }
  updateSpinSetup() {
    if (!$('spinSetup')) return;
    const cases = this.configuredSpinCases();
    $('spinSetup').dataset.style = config.training.spinStyle;
    $('spinSetup').dataset.validation = config.training.spinValidation;
    document.querySelectorAll('#spinStylePicker [data-spin-style]').forEach((button: any) => {
      const selected = button.dataset.spinStyle === config.training.spinStyle;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-selected', selected);
    });
    document.querySelectorAll('#spinValidationPicker [data-spin-validation]').forEach((button: any) => {
      const selected = button.dataset.spinValidation === config.training.spinValidation;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-selected', selected);
    });
    document.querySelectorAll('#spinPresetPicker [data-spin-preset]').forEach((button: any) => {
      const selected = button.dataset.spinPreset === config.training.spinPreset;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-selected', selected);
    });
    document.querySelectorAll('#spinPiecePicker [data-spin-piece]').forEach((button: any) => {
      const selected = config.training.spinPieces.includes(button.dataset.spinPiece);
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-selected', selected);
    });
    $('spinPresetLabel').textContent = config.training.spinPreset === 'all' ? `${cases.length} VERIFIED CASES`
      : config.training.spinPreset === 'states' ? 'S/Z INSERT DOUBLES'
      : config.training.spinPreset === 'weak' ? 'WEAK REVIEW'
        : config.training.spinPreset === 'custom' ? 'CUSTOM CYCLE' : 'BEGINNER CYCLE';
    $('spinCaseCount').textContent = String(cases.length);
    if (this.mode === 'spin') $('startButton').disabled = cases.length === 0;
  }
  initializeSpinSession(seed) {
    const cases = this.configuredSpinCases();
    const rng = new XorShift32((seed ^ 0x5a17cafe) >>> 0);
    this.spinSession = {
      deck: shuffleFinesseCases(cases, () => rng.next()),
      index: 0,
      currentCase: null,
      awaitingNeutral: false,
      attempts: 0,
      correct: 0,
      streak: 0,
      bestStreak: 0,
      caseAttempt: 0,
    };
  }
  saveSpinProgress() {
    try { localStorage.setItem(STORAGE_SPIN, JSON.stringify(this.spinProgress)); } catch (_) {}
  }
  resetSpinProgress() {
    this.spinProgress = { version: 1, cases: {} };
    this.updateSpinSetup();
  }
  isSpinDrill() {
    return this.mode === 'spin';
  }
  recordSpinProgress(caseId, success, firstTry) {
    const progress = this.spinProgress.cases[caseId] || { attempts: 0, successes: 0, faults: 0, streak: 0, bestStreak: 0 };
    progress.attempts += 1;
    progress.successes += success ? 1 : 0;
    progress.faults += success ? 0 : 1;
    progress.firstTrySuccesses = (progress.firstTrySuccesses || 0) + (success && firstTry ? 1 : 0);
    progress.streak = success ? progress.streak + 1 : 0;
    progress.bestStreak = Math.max(progress.bestStreak || 0, progress.streak);
    progress.lastPracticed = Date.now();
    this.spinProgress.cases[caseId] = progress;
    if (!this.replayMode) this.saveSpinProgress();
  }
  initializeFinesseSession(seed) {
    const cases = this.configuredFinesseCases();
    const rng = new XorShift32((seed ^ 0xf17e55e) >>> 0);
    const trainingType = config.training.finesseType;
    const shuffled = trainingType === 'flow' ? [] : shuffleFinesseCases(cases, () => rng.next());
    const deck = trainingType === 'stack'
      ? shuffled.map((entry) => createStackFinesseCase(entry, () => rng.next(), {
        allow180: config.gameplay.allow180,
        arr: config.handling.arr,
        rotationSystem: config.gameplay.rotation,
      })).filter(Boolean)
      : shuffled;
    this.finesseSession = {
      type: trainingType,
      deck,
      index: 0,
      currentCase: null,
      awaitingNeutral: false,
      attempts: 0,
      correct: 0,
      streak: 0,
      bestStreak: 0,
      caseAttempt: 0,
    };
  }
  saveFinesseProgress() {
    try { localStorage.setItem(STORAGE_FINESSE, JSON.stringify(this.finesseProgress)); } catch (_) {}
  }
  resetFinesseProgress() {
    this.finesseProgress = { version: 2, cases: {} };
    this.updateFinesseSetup();
    this.renderMasteryMap(this.masteryPiece);
  }
  finesseTrainingType() {
    return this.finesseSession?.type || config.training.finesseType;
  }
  isFinesseDrill() {
    return this.mode === 'finesse' && this.finesseTrainingType() !== 'flow';
  }
  recordFinesseProgress(caseId, { success, faults = 0, firstTry = false, trainingType = 'floor' }) {
    if (!caseId) return null;
    const progress = this.finesseProgress.cases[caseId] || {
      attempts: 0,
      successes: 0,
      firstTrySuccesses: 0,
      faults: 0,
      streak: 0,
      bestStreak: 0,
      lastPracticed: 0,
      modes: {},
    };
    progress.attempts += 1;
    progress.successes += success ? 1 : 0;
    progress.firstTrySuccesses += success && firstTry ? 1 : 0;
    progress.faults += faults;
    progress.streak = success ? progress.streak + 1 : 0;
    progress.bestStreak = Math.max(progress.bestStreak, progress.streak);
    progress.lastPracticed = Date.now();
    progress.modes ||= {};
    const modeProgress = progress.modes[trainingType] || { attempts: 0, successes: 0, faults: 0 };
    modeProgress.attempts += 1;
    modeProgress.successes += success ? 1 : 0;
    modeProgress.faults += faults;
    progress.modes[trainingType] = modeProgress;
    this.finesseProgress.version = 2;
    this.finesseProgress.cases[caseId] = progress;
    if (!this.replayMode) this.saveFinesseProgress();
    return progress;
  }
  renderMasteryMap(piece = this.masteryPiece) {
    if (!$('masteryCaseGrid')) return;
    this.refreshFinesseCatalog();
    this.masteryPiece = piece;
    const entries = this.finesseCatalog.filter((entry) => entry.type === piece);
    const allProgress = this.finesseCatalog.map((entry) => this.finesseProgress.cases[entry.id]);
    const practiced = allProgress.filter((progress) => (progress?.attempts || 0) > 0).length;
    const mastered = allProgress.filter((progress) => masteryLevel(progress) === 'mastered').length;
    $('masteryPracticed').textContent = `${practiced}/${this.finesseCatalog.length}`;
    $('masteryMastered').textContent = `${mastered}/${this.finesseCatalog.length}`;
    document.querySelectorAll('#masteryPieceTabs [data-mastery-piece]').forEach((button: any) => {
      const selected = button.dataset.masteryPiece === piece;
      button.setAttribute('aria-selected', String(selected));
    });
    const grid = $('masteryCaseGrid');
    grid.innerHTML = '';
    for (const entry of entries) {
      const progress = this.finesseProgress.cases[entry.id];
      const level = masteryLevel(progress);
      const attempts = progress?.attempts || 0;
      const accuracy = attempts ? Math.round((progress.successes || 0) / attempts * 100) : 0;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `mastery-case${this.masteryCaseId === entry.id ? ' is-active' : ''}`;
      button.dataset.caseId = entry.id;
      button.dataset.level = level;
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-label', `${entry.type} ${entry.rotationLabel}, ${entry.left + 1}열, ${attempts}회 시도, 정확도 ${accuracy}%`);
      button.innerHTML = `${['U', 'R', 'D', 'L'][entry.rot]}${entry.left + 1}<span>${{ untried: '—', learning: 'L', solid: 'S', mastered: 'M' }[level]}</span>`;
      grid.appendChild(button);
    }
    if (this.masteryCaseId && entries.some((entry) => entry.id === this.masteryCaseId)) this.showMasteryCase(this.masteryCaseId);
    else {
      this.masteryCaseId = null;
      $('masteryCaseDetail').textContent = 'SELECT A CASE';
    }
  }
  showMasteryCase(caseId) {
    const entry = this.finesseCatalog.find((candidate) => candidate.id === caseId);
    if (!entry) return;
    this.masteryCaseId = caseId;
    document.querySelectorAll('#masteryCaseGrid [data-case-id]').forEach((button: any) => button.classList.toggle('is-active', button.dataset.caseId === caseId));
    const progress = this.finesseProgress.cases[caseId] || {};
    const attempts = progress.attempts || 0;
    const accuracy = attempts ? Math.round((progress.successes || 0) / attempts * 100) : 0;
    const modeCounts = ['floor', 'stack', 'flow']
      .map((mode) => `${mode.toUpperCase()} ${progress.modes?.[mode]?.attempts || 0}`)
      .join(' · ');
    $('masteryCaseDetail').innerHTML = `<b>${entry.type} · ${entry.rotationLabel} · COLUMN ${entry.left + 1}</b><br>ATTEMPTS ${attempts} · ACCURACY ${accuracy}% · FAULTS ${progress.faults || 0} · BEST ${progress.bestStreak || 0}<br>${modeCounts}`;
  }
  openMasteryMap() {
    this.masteryReturnFocus = document.activeElement;
    this.renderMasteryMap(this.masteryPiece);
    $('masteryOverlay').classList.remove('is-hidden');
    $('closeMasteryButton').focus();
  }
  closeMasteryMap() {
    $('masteryOverlay').classList.add('is-hidden');
    if (this.masteryReturnFocus?.focus) this.masteryReturnFocus.focus();
    this.masteryReturnFocus = null;
  }
  spinGuideCases(piece = this.spinGuidePiece) {
    this.refreshSpinCatalog();
    const type = piece === 'PRINCIPLE' ? 'S' : piece;
    return this.spinCatalog.filter((entry) => entry.type === type && !['build', 'deep'].includes(entry.variant));
  }
  spinEntryMeta(spinCase) {
    const dx = spinCase.target.x - spinCase.start.x;
    const dy = spinCase.target.y - spinCase.start.y;
    const horizontal = dx < 0 ? 'left' : dx > 0 ? 'right' : 'center';
    const entryLabel = dx < 0 && dy > 0 ? '↙ 미노를 왼쪽 아래로 차 넣기'
      : dx > 0 && dy > 0 ? '미노를 오른쪽 아래로 차 넣기 ↘'
        : dy > 0 ? `↓ 미노를 아래로 ${dy}칸 차 넣기`
          : dx < 0 ? '← 미노를 왼쪽으로 넣기'
            : dx > 0 ? '미노를 오른쪽으로 넣기 →'
              : dy < 0 ? '미노를 위로 올려 넣기 ↑' : '제자리 회전으로 넣기';
    const arrows = [dx < 0 ? `← ${Math.abs(dx)}칸` : dx > 0 ? `→ ${dx}칸` : '', dy < 0 ? `↑ ${Math.abs(dy)}칸` : dy > 0 ? `↓ ${dy}칸` : ''].filter(Boolean);
    return { dx, dy, horizontal, entryLabel, kickLabel: `회전 보정 ${arrows.join(' · ') || '제자리'}` };
  }
  spinApproachLabel(spinCase) {
    return this.spinInputLabel(spinCase);
  }
  spinInputLabel(spinCase) {
    const labels = {
      left: '←',
      right: '→',
      rotateCW: '↻',
      rotateCCW: '↺',
      rotate180: '180°',
      softDrop: '↓ MAX',
      hardDrop: 'SPACE',
    };
    return (spinCase?.practiceRoute || []).map((token) => labels[token] || token).join(' · ') || '경로 없음';
  }
  spinTurnName(spinCase) {
    return spinCase.direction === '180' ? '180도 방향' : spinCase.direction === 'CW' ? '시계 방향' : '반시계 방향';
  }
  spinTurnInput(spinCase) {
    return spinCase.direction === '180' ? '↕ 180도' : spinCase.direction === 'CW' ? '↻ 시계' : '↺ 반시계';
  }
  compactSpinTransition(spinCase) {
    if (!spinCase) return 'READY';
    return spinCase.stateNames.map((name) => name.replace(/\s*\([^)]*\)/, '')).join(' → ');
  }
  drawSpinRouteGrid(host, spinCase, phase) {
    host.innerHTML = '';
    const columns = 7;
    const rows = 7;
    const startCells = pieceCells(spinCase.type, spinCase.start);
    const targetCells = spinCase.target.cells;
    const allX = [...startCells, ...targetCells].map(([x]) => x);
    const allY = [...startCells, ...targetCells].map(([, y]) => y);
    const left = clamp(Math.floor((Math.min(...allX) + Math.max(...allX)) / 2) - Math.floor(columns / 2), 0, BOARD_W - columns);
    const top = clamp(Math.min(...allY) - 2, VISIBLE_START, BOARD_H - rows);
    const startSet = new Set(startCells.map(([x, y]) => `${x},${y}`));
    const targetSet = new Set(targetCells.map(([x, y]) => `${x},${y}`));
    host.dataset.piece = spinCase.type;
    host.dataset.phase = phase;
    host.style.setProperty('--guide-columns', String(columns));
    for (let y = top; y < top + rows; y += 1) {
      for (let x = left; x < left + columns; x += 1) {
        const cell = document.createElement('i');
        const key = `${x},${y}`;
        cell.classList.toggle('is-terrain', Boolean(spinCase.board[y]?.[x]));
        cell.classList.toggle('is-target', phase === 'before' && targetSet.has(key));
        cell.classList.toggle('is-piece', phase === 'before' ? startSet.has(key) : targetSet.has(key));
        host.appendChild(cell);
      }
    }
  }
  renderSpinGuideCase(caseId = this.spinGuideCaseId) {
    const cases = this.spinGuideCases();
    const spinCase = cases.find((entry) => entry.id === caseId) || cases[0];
    if (!spinCase) return;
    this.spinGuideCaseId = spinCase.id;
    const meta = this.spinEntryMeta(spinCase);
    const input = this.spinTurnInput(spinCase);
    $('spinGuideEntryLabel').textContent = meta.entryLabel;
    $('spinGuideRouteTitle').textContent = `${spinCase.lessonLabel} · ${spinCase.stateNames[0]} → ${spinCase.stateNames[1]}`;
    $('spinGuideInputKey').textContent = input;
    $('spinGuideKickLabel').textContent = meta.kickLabel;
    $('spinGuideBeforeLabel').textContent = `${spinCase.stateNames[0]} · ${spinCase.stagingGrounded ? '홈 앞에 착지' : '낙하 중 이 높이'}`;
    $('spinGuideAfterLabel').textContent = `${spinCase.stateNames[1]} · ${spinCase.lineClearCount}줄 클리어`;
    this.drawSpinRouteGrid($('spinGuideBeforeGrid'), spinCase, 'before');
    this.drawSpinRouteGrid($('spinGuideAfterGrid'), spinCase, 'after');

    const paired = cases.filter((entry) => entry.type === spinCase.type && entry.family === spinCase.family);
    const alternative = paired.find((entry) => entry.id !== spinCase.id);
    const turnName = this.spinTurnName(spinCase);
    $('spinGuideRouteExplanation').textContent = `예시 입력 ${this.spinInputLabel(spinCase)}. ↓ MAX는 소프트드롭 키를 눌러 미노가 멈추면 놓으라는 뜻입니다. 왼쪽부터 한 번씩 그대로 입력하면 마지막 ${turnName} 회전이 미노를 ${meta.kickLabel.replace('회전 보정 ', '')} 움직여 ${spinCase.lineClearCount}줄을 지웁니다. ${spinCase.concept}${alternative ? ` 반대쪽에서는 ${alternative.stateNames[0]} 모양에서 ${this.spinTurnName(alternative)}으로 돌립니다.` : ''}`;

    const rows = $('spinGuideStateRows');
    rows.innerHTML = '';
    for (const entry of paired) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.spinCaseId = entry.id;
      button.classList.toggle('is-active', entry.id === spinCase.id);
      button.setAttribute('aria-pressed', String(entry.id === spinCase.id));
      button.innerHTML = `<b>${entry.variant ? entry.variant.toUpperCase() : entry.clearName}</b><span>${this.spinTurnInput(entry)}</span><small>${entry.stateNames[0]} → ${entry.stateNames[1]}</small>`;
      rows.appendChild(button);
    }
    $('spinGuideStateLesson').classList.toggle('is-single', paired.length < 2);
    $('spinGuideStateLessonTitle').textContent = paired.length > 1
      ? `${spinCase.lessonLabel} · 좌우 진입 비교`
      : `${spinCase.lessonLabel} 입력`;
    document.querySelectorAll('#spinGuideCaseTabs [data-spin-case-id]').forEach((button: any) => {
      const selected = button.dataset.spinCaseId === spinCase.id;
      button.setAttribute('aria-selected', String(selected));
      button.classList.toggle('is-selected', selected);
    });
  }
  renderSpinGuide(piece = this.spinGuidePiece) {
    const key = SPIN_GUIDES[piece] ? piece : 'PRINCIPLE';
    const guide = SPIN_GUIDES[key];
    this.spinGuidePiece = key;
    this.spinGuideCaseId = null;
    const guideType = key === 'PRINCIPLE' ? 'S' : key;
    $('spinGuideOverlay').style.setProperty('--guide-piece-color', PIECE_COLORS[guideType]);
    $('spinGuideTitle').textContent = guide.title;
    $('spinGuideBody').textContent = guide.body;
    $('spinGuidePoints').innerHTML = guide.points.map((point) => `<li>${point}</li>`).join('');
    document.querySelectorAll('#spinGuideTabs [data-spin-guide]').forEach((button: any) => {
      button.setAttribute('aria-selected', String(button.dataset.spinGuide === key));
    });
    const cases = this.spinGuideCases(key);
    const caseTabs = $('spinGuideCaseTabs');
    caseTabs.innerHTML = '';
    for (const entry of cases) {
      const meta = this.spinEntryMeta(entry);
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.spinCaseId = entry.id;
      button.setAttribute('role', 'tab');
      button.innerHTML = `<span>${entry.lessonLabel}</span><b>${meta.horizontal === 'left' ? '← ' : meta.horizontal === 'right' ? '→ ' : ''}${entry.stateNames[0]} → ${entry.stateNames[1]}</b>`;
      caseTabs.appendChild(button);
    }
    const practicePiece = key === 'PRINCIPLE' ? 'S/Z' : key;
    $('practiceSpinGuideButton').textContent = `${practicePiece} 스핀을 연습 목록에 넣기`;
    this.renderSpinGuideCase(cases[0]?.id);
  }
  practiceCurrentSpinGuide() {
    const piece = this.spinGuidePiece;
    if (piece === 'PRINCIPLE') {
      config.training.spinPieces = ['S', 'Z'];
      config.training.spinPreset = 'all';
    } else {
      config.training.spinPieces = [piece];
      config.training.spinPreset = 'custom';
    }
    this.updateSpinSetup();
    uiBridge.scheduleSave();
    this.closeSpinGuide();
  }
  openSpinGuide(piece = 'PRINCIPLE') {
    this.spinGuideReturnFocus = document.activeElement;
    this.renderSpinGuide(piece);
    $('spinGuideOverlay').classList.remove('is-hidden');
    $('closeSpinGuideButton').focus();
  }
  closeSpinGuide() {
    $('spinGuideOverlay').classList.add('is-hidden');
    if (this.spinGuideReturnFocus?.focus) this.spinGuideReturnFocus.focus();
    this.spinGuideReturnFocus = null;
  }
  updatePB() {
    if (this.mode === 'sprint' && personalBests.sprint) $('pbValue').textContent = formatTime(personalBests.sprint);
    else $('pbValue').textContent = '—';
  }
  newSeed() {
    if (window.crypto?.getRandomValues) {
      const value = new Uint32Array(1);
      window.crypto.getRandomValues(value);
      return value[0] || 1;
    }
    return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  }
  start(options: any = {}) {
    const seed = options.seed ?? (options.sameSeed && this.seed ? this.seed : this.newSeed());
    this.mode = options.mode || this.mode || config.ui.mode;
    config.ui.mode = this.mode;
    uiBridge.scheduleSave();
    this.seed = seed >>> 0;
    const finesseActive = this.mode === 'finesse';
    const finesseDrill = finesseActive && config.training.finesseType !== 'flow';
    const spinActive = this.mode === 'spin';
    const trainingActive = finesseActive || spinActive;
    const strideActive = Boolean(config.ui.strideMode && !['zen', 'finesse', 'spin'].includes(this.mode) && !options.skipCountdown);
    const avoidFirstPiece = Boolean(strideActive && this.mode !== 'custom');
    this.board = makeBoard();
    this.randomizer = new PieceRandomizer(this.seed, finesseActive && !finesseDrill ? 'bag7' : config.gameplay.randomizer, avoidFirstPiece);
    this.randomizer.ensure(7);
    this.current = null;
    this.holdType = null;
    this.canHold = !finesseDrill && !spinActive;
    this.runFrame = 0;
    this.playFrame = 0;
    this.currentSubframe = 0;
    this.tickHeld = null;
    this.tickLastPressed = null;
    this.countdownStyle = options.skipCountdown ? 'skip' : trainingActive || strideActive ? 'stride' : 'normal';
    this.countdownFrames = this.countdownStyle === 'skip' ? 1 : trainingActive ? 60 : this.countdownStyle === 'stride' ? 90 : 180;
    this.areRemaining = 0;
    this.gravityAccumulator = 0;
    this.lockTimer = 0;
    this.lockResetsUsed = 0;
    this.lines = 0;
    this.score = 0;
    this.attack = 0;
    this.pieces = 0;
    this.inputs = 0;
    this.finesseFaults = 0;
    this.finessePerfectPieces = 0;
    this.combo = -1;
    this.b2b = 0;
    this.lastAction = null;
    this.lastRotation = null;
    this.pieceManipulations = 0;
    this.pieceInputTokens = [];
    this.bufferTap = { hold: false, rotation: null };
    this.horizontal = { leftCharge: 0, rightCharge: 0, repeat: 0, activeDir: 0, dcd: 0 };
    this.retryHoldFrames = 0;
    this.retryArmed = false;
    this.result = null;
    this.finesseHintTimer = 0;
    $('finesseHint').classList.remove('is-visible');
    $('spinFeedback').textContent = '';
    if (finesseActive) this.initializeFinesseSession(this.seed);
    else this.finesseSession = null;
    if (spinActive) this.initializeSpinSession(this.seed);
    else this.spinSession = null;
    this.replayMode = Boolean(options.replay);
    if (this.replayMode) this.input.hardReset();
    this.replay = options.replay || {
      format: 'stacklab-replay',
      version: VERSION,
      createdAt: new Date().toISOString(),
      seed: this.seed,
      mode: this.mode,
      config: this.replayConfigSnapshot(),
      events: [],
    };
    this.replayCursor = 0;
    this.handlingTest = Boolean(options.handlingTest);
    this.updateModeUI();
    $('seedValue').textContent = this.seed.toString(16).toUpperCase().padStart(8, '0');
    $('resultOverlay').classList.add('is-hidden');
    $('startOverlay').classList.add('is-hidden');
    $('countdownOverlay').dataset.style = this.countdownStyle;
    this.setState('countdown');
    this.setCountdownText(this.countdownStyle === 'stride' ? 'READY' : this.countdownFrames <= 1 ? 'GO' : '3');
    $('countdownSub').textContent = options.retryReason || (this.replayMode ? 'REPLAY' : this.handlingTest ? 'HANDLING TEST' : finesseActive && !finesseDrill ? 'FLOW · 7-BAG' : spinActive ? '세우기 · 내리기 · 회전' : 'GET READY');
    this.audio.ensure();
    this.updateHUD();
  }
  replayConfigSnapshot() {
    return {
      handling: deepClone(config.handling),
      gameplay: deepClone(config.gameplay),
      training: deepClone(config.training),
      ui: { strideMode: config.ui.strideMode, retryOnFinesse: config.ui.retryOnFinesse },
    };
  }
  injectReplayEvents() {
    if (!this.replayMode || !this.replay?.events) return;
    while (this.replayCursor < this.replay.events.length && this.replay.events[this.replayCursor].frame === this.runFrame) {
      const event = this.replay.events[this.replayCursor];
      this.input.inject(event.action, event.type, event.subframe ?? 0);
      this.replayCursor += 1;
    }
  }
  recordEdges() {
    if (this.replayMode || !this.replay || !['countdown', 'playing'].includes(this.state)) return;
    for (const event of this.input.edges) {
      if (event.source === 'replay' || ['pause', 'config', 'fullscreen', 'retry'].includes(event.action)) continue;
      const subframe = Number(clamp(event.subframe ?? 0, 0, 1).toFixed(6));
      this.replay.events.push({ frame: this.runFrame, subframe, action: event.action, type: event.type === 'pulse' ? 'down' : event.type });
      if (event.pulse) this.replay.events.push({ frame: this.runFrame, subframe, action: event.action, type: 'up' });
    }
  }
  fixedUpdate(tickStart, tickEnd) {
    this.injectReplayEvents();
    this.input.beginTick(this.runFrame, tickStart, tickEnd);
    this.recordEdges();
    this.handleGlobalEdges();
    if (this.processRetryHold()) return;

    if (this.state === 'countdown') {
      this.processCountdownTimeline();
      this.countdownFrames -= 1;
      this.runFrame += 1;
      if (this.countdownFrames > 0) {
        const previous = $('countdownValue').textContent;
        let text;
        if (this.countdownStyle === 'stride') {
          text = ['finesse', 'spin'].includes(this.mode)
            ? this.countdownFrames > 30 ? 'READY' : 'GO'
            : this.countdownFrames > 60 ? 'READY' : this.countdownFrames > 30 ? 'SET' : 'GO';
        } else if (this.countdownStyle === 'skip') {
          text = 'GO';
        } else {
          const number = Math.ceil(this.countdownFrames / 60);
          text = number <= 0 ? 'GO' : String(number);
        }
        if (previous !== text) {
          this.setCountdownText(text);
          this.audio.play('count');
        }
      } else {
        this.spawnNext(true);
        if (this.state !== 'over') {
          this.setState('playing');
          this.audio.play('start');
          this.showAction('GO', 'accent');
        }
      }
      this.updateHUD();
      return;
    }

    if (this.state !== 'playing') {
      this.updateHUD();
      return;
    }

    this.processPlayingTimeline();
    if (this.state !== 'playing') return;
    this.maybeSpawnFinessePiece();
    this.maybeSpawnSpinPiece();
    if (this.state !== 'playing') return;

    this.playFrame += 1;
    this.currentSubframe = 0;
    this.tickHeld = null;
    this.tickLastPressed = null;
    this.runFrame += 1;
    if (this.actionTextTimer > 0) {
      this.actionTextTimer -= 1;
      if (this.actionTextTimer <= 0) $('actionText').classList.remove('is-visible');
    }
    if (this.finesseHintTimer > 0) {
      this.finesseHintTimer -= 1;
      if (this.finesseHintTimer <= 0) {
        $('finesseHint').classList.remove('is-visible');
        $('spinFeedback').textContent = '';
      }
    }
    this.updateHUD();
  }
  resetToIdle() {
    this.board = makeBoard();
    this.randomizer = null;
    this.current = null;
    this.holdType = null;
    this.canHold = true;
    this.seed = 0;
    this.runFrame = 0;
    this.playFrame = 0;
    this.currentSubframe = 0;
    this.tickHeld = null;
    this.tickLastPressed = null;
    this.countdownFrames = 0;
    this.areRemaining = 0;
    this.gravityAccumulator = 0;
    this.lockTimer = 0;
    this.lockResetsUsed = 0;
    this.lines = 0;
    this.score = 0;
    this.attack = 0;
    this.pieces = 0;
    this.inputs = 0;
    this.finesseFaults = 0;
    this.finessePerfectPieces = 0;
    this.finesseSession = null;
    this.spinSession = null;
    this.finesseHintTimer = 0;
    this.combo = -1;
    this.b2b = 0;
    this.lastAction = null;
    this.lastRotation = null;
    this.pieceManipulations = 0;
    this.pieceInputTokens = [];
    this.bufferTap = { hold: false, rotation: null };
    this.horizontal = { leftCharge: 0, rightCharge: 0, repeat: 0, activeDir: 0, dcd: 0 };
    this.result = null;
    this.replayMode = false;
    this.replayCursor = 0;
    this.handlingTest = false;
    this.retryHoldFrames = 0;
    this.retryArmed = false;
    this.input.hardReset();
    this.setState('idle');
    $('countdownOverlay').dataset.style = 'normal';
    $('seedValue').textContent = '—';
    $('resultOverlay').classList.add('is-hidden');
    $('masteryOverlay').classList.add('is-hidden');
    $('spinGuideOverlay').classList.add('is-hidden');
    $('startOverlay').classList.remove('is-hidden');
    $('finesseHint').classList.remove('is-visible');
    $('spinFeedback').textContent = '';
    $('spinCoach').classList.add('is-hidden');
    this.renderer.lastMiniSignature = '';
    this.updateFinesseSetup();
    this.updateSpinSetup();
    this.updateHUD();
  }
  handleGlobalEdges() {
    for (const edge of this.input.edges) {
      if (edge.type !== 'down') continue;
      if (edge.action === 'fullscreen') uiBridge.toggleFullscreen();
      if (edge.action === 'config') {
        uiBridge.openSettings('handling');
        continue;
      }
      if (edge.action === 'pause') {
        if (this.state === 'playing') this.pause(false);
        else if (this.state === 'paused' && !uiBridge.settingsOpen()) this.resume();
        continue;
      }
      if (edge.action === 'retry') {
        const retriable = ['countdown', 'playing', 'paused', 'over'].includes(this.state);
        if (retriable && config.ui.strideMode && this.mode !== 'zen') this.start();
        else if (retriable) {
          this.retryArmed = true;
          this.retryHoldFrames = 0;
          if (this.state === 'over') uiBridge.toast('재시작 키를 잠시 길게 누르세요. Stride Mode에서는 탭으로 재시작합니다.');
          else this.showAction('HOLD TO RETRY', 'danger');
        }
        continue;
      }
      if (edge.action === 'hardDrop' && this.state === 'idle') this.start();
      else if (edge.action === 'hardDrop' && this.state === 'over') this.start();
    }
  }
  processRetryHold() {
    if (!this.retryArmed) return false;
    const retriable = ['countdown', 'playing', 'paused', 'over'].includes(this.state);
    if (!retriable || !this.input.isDown('retry')) {
      this.retryArmed = false;
      this.retryHoldFrames = 0;
      return false;
    }
    this.retryHoldFrames += 1;
    if (this.retryHoldFrames < 30) return false;
    this.retryArmed = false;
    this.retryHoldFrames = 0;
    this.start();
    return true;
  }
  beginInputTimeline() {
    this.tickHeld = {};
    this.tickLastPressed = {};
    for (const action of TIMELINE_ACTIONS) {
      this.tickHeld[action] = this.input.tickStartIsDown(action);
      this.tickLastPressed[action] = this.input.tickStartLastPressed(action);
    }
    this.currentSubframe = 0;
  }
  timelineEdgeAllowed(edge) {
    return !this.replayMode || edge.source === 'replay'
      || ['pause', 'config', 'fullscreen', 'retry'].includes(edge.action);
  }
  applyTimelineEdge(edge) {
    if (edge.pulse) return;
    if (edge.type === 'down') {
      this.tickHeld[edge.action] = true;
      this.tickLastPressed[edge.action] = this.runFrame + edge.subframe;
    } else if (edge.type === 'up') {
      this.tickHeld[edge.action] = false;
    }
  }
  actionIsDown(action) {
    return this.tickHeld ? Boolean(this.tickHeld[action]) : this.input.isDown(action);
  }
  actionLastPressed(action) {
    return this.tickLastPressed?.[action] ?? this.input.lastPressed(action);
  }
  processCountdownTimeline() {
    this.beginInputTimeline();
    let cursor = 0;
    for (const edge of this.input.edges) {
      if (!this.timelineEdgeAllowed(edge)) continue;
      const target = clamp(edge.subframe ?? 0, cursor, 1);
      this.currentSubframe = target;
      this.advanceHorizontal(target - cursor);
      cursor = target;
      this.applyTimelineEdge(edge);
      if (edge.type === 'up' && ['moveLeft', 'moveRight'].includes(edge.action)) this.syncHorizontalDirection();
      if (edge.type !== 'down') continue;
      if (edge.action === 'moveLeft') this.directionPress(-1);
      else if (edge.action === 'moveRight') this.directionPress(1);
      else if (edge.action === 'hold') this.bufferTap.hold = true;
      else if (['rotateCW', 'rotateCCW', 'rotate180'].includes(edge.action)) this.bufferTap.rotation = edge.action;
    }
    this.currentSubframe = 1;
    this.advanceHorizontal(1 - cursor);
  }
  processPlayingTimeline() {
    this.beginInputTimeline();
    let cursor = 0;
    for (const edge of this.input.edges) {
      if (!this.timelineEdgeAllowed(edge)) continue;
      const target = clamp(edge.subframe ?? 0, cursor, 1);
      this.currentSubframe = target;
      this.advancePlaying(target - cursor);
      cursor = target;
      if (this.state !== 'playing') return;
      this.applyTimelineEdge(edge);
      this.processPlayingEdge(edge);
      if (this.state !== 'playing') return;
    }
    this.currentSubframe = 1;
    this.advancePlaying(1 - cursor);
  }
  recordPieceInput(token) {
    if (!this.pieceInputTokens) this.pieceInputTokens = [];
    this.pieceInputTokens.push(token);
  }
  markDasInput(dir) {
    if (!this.pieceInputTokens) return;
    const tapToken = dir === -1 ? 'left' : 'right';
    const dasToken = dir === -1 ? 'dasLeft' : 'dasRight';
    for (let index = this.pieceInputTokens.length - 1; index >= 0; index -= 1) {
      if (this.pieceInputTokens[index] === tapToken) {
        this.pieceInputTokens[index] = dasToken;
        return;
      }
    }
  }
  processPlayingEdge(edge) {
    if (edge.type === 'up') {
      if (['moveLeft', 'moveRight'].includes(edge.action)) this.syncHorizontalDirection();
      return;
    }
    if (edge.type !== 'down' || ['pause', 'config', 'fullscreen', 'retry'].includes(edge.action)) return;
    if ((this.isFinesseDrill() || this.isSpinDrill()) && !this.current) return;
    this.inputs += 1;
    if (!this.current) {
      if (edge.action === 'moveLeft') this.directionPress(-1);
      else if (edge.action === 'moveRight') this.directionPress(1);
      else if (edge.action === 'hold') this.bufferTap.hold = true;
      else if (['rotateCW', 'rotateCCW', 'rotate180'].includes(edge.action)) this.bufferTap.rotation = edge.action;
      return;
    }
    switch (edge.action) {
      case 'moveLeft':
        this.pieceManipulations += 1;
        this.recordPieceInput('left');
        this.directionPress(-1);
        this.tryMove(-1, 0, true);
        break;
      case 'moveRight':
        this.pieceManipulations += 1;
        this.recordPieceInput('right');
        this.directionPress(1);
        this.tryMove(1, 0, true);
        break;
      case 'softDrop':
        break;
      case 'hardDrop':
        this.hardDrop();
        break;
      case 'rotateCW':
        this.pieceManipulations += 1;
        this.recordPieceInput('rotateCW');
        this.tryRotate(1, true);
        break;
      case 'rotateCCW':
        this.pieceManipulations += 1;
        this.recordPieceInput('rotateCCW');
        this.tryRotate(-1, true);
        break;
      case 'rotate180':
        if (config.gameplay.allow180) {
          this.pieceManipulations += 1;
          this.recordPieceInput('rotate180');
          this.tryRotate(2, true);
        }
        break;
      case 'hold':
        this.hold(true);
        break;
      default: break;
    }
  }
  directionPress(dir) {
    if (dir === -1 && config.handling.cancelDas) this.horizontal.rightCharge = 0;
    if (dir === 1 && config.handling.cancelDas) this.horizontal.leftCharge = 0;
    this.horizontal.activeDir = dir;
    this.horizontal.repeat = 0;
    if (dir === -1) this.horizontal.leftCharge = 0;
    else this.horizontal.rightCharge = 0;
  }
  syncHorizontalDirection() {
    const left = this.actionIsDown('moveLeft');
    const right = this.actionIsDown('moveRight');
    const previousDir = this.horizontal.activeDir;
    if (!left) this.horizontal.leftCharge = 0;
    if (!right) this.horizontal.rightCharge = 0;
    if (this.horizontal.activeDir === -1 && !left) this.horizontal.activeDir = right ? 1 : 0;
    if (this.horizontal.activeDir === 1 && !right) this.horizontal.activeDir = left ? -1 : 0;
    if (!this.horizontal.activeDir) {
      if (left && right) this.horizontal.activeDir = this.actionLastPressed('moveLeft') > this.actionLastPressed('moveRight') ? -1 : 1;
      else if (left) this.horizontal.activeDir = -1;
      else if (right) this.horizontal.activeDir = 1;
    }
    if (previousDir !== this.horizontal.activeDir) this.horizontal.repeat = 0;
    if (!this.horizontal.activeDir) this.horizontal.repeat = 0;
  }
  advancePlaying(delta) {
    if (delta <= SUBFRAME_EPSILON || this.state !== 'playing') return;
    if (this.areRemaining > SUBFRAME_EPSILON && this.areRemaining < delta - SUBFRAME_EPSILON) {
      const target = this.currentSubframe;
      const firstSlice = this.areRemaining;
      this.currentSubframe = target - delta + firstSlice;
      this.advancePlaying(firstSlice);
      if (this.state !== 'playing') return;
      this.currentSubframe = target;
      this.advancePlaying(delta - firstSlice);
      return;
    }
    const verticalFirst = config.handling.softDropPriority;
    if (verticalFirst) this.processVertical(delta);
    if (this.state !== 'playing') return;
    this.advanceHorizontal(delta);
    if (!verticalFirst) this.processVertical(delta);
    if (this.state !== 'playing') return;
    this.processLock(delta);
  }
  advanceHorizontal(delta) {
    if (delta <= SUBFRAME_EPSILON) return;
    this.syncHorizontalDirection();
    let chargeDelta = delta;
    if (this.horizontal.dcd > 0) {
      const consumed = Math.min(chargeDelta, this.horizontal.dcd);
      this.horizontal.dcd = Math.max(0, this.horizontal.dcd - consumed);
      chargeDelta -= consumed;
    }
    const dir = this.horizontal.activeDir;
    if (!dir || chargeDelta <= SUBFRAME_EPSILON) return;
    const key = dir === -1 ? 'leftCharge' : 'rightCharge';
    const previous = this.horizontal[key];
    this.horizontal[key] += chargeDelta;
    const ready = this.horizontal[key] + SUBFRAME_EPSILON >= config.handling.das;
    const crossed = previous < config.handling.das && ready;
    if (!ready) return;
    if (config.handling.arr <= 0) {
      if (!this.current) return;
      let moved = false;
      while (this.tryMove(dir, 0, true, false)) moved = true;
      if (moved) {
        this.markDasInput(dir);
        this.audio.play('move');
      }
      return;
    }
    if (crossed) this.horizontal.repeat = config.handling.arr + Math.max(0, this.horizontal[key] - config.handling.das);
    else this.horizontal.repeat += chargeDelta;
    if (!this.current) {
      this.horizontal.repeat = Math.min(config.handling.arr, this.horizontal.repeat);
      return;
    }
    let moved = false;
    while (this.horizontal.repeat + SUBFRAME_EPSILON >= config.handling.arr) {
      this.horizontal.repeat -= config.handling.arr;
      if (!this.tryMove(dir, 0, true, false)) {
        this.horizontal.repeat = 0;
        break;
      }
      moved = true;
    }
    if (moved) {
      this.markDasInput(dir);
      this.audio.play('move');
    }
  }
  processVertical(delta) {
    let remaining = delta;
    if (this.areRemaining > 0) {
      const consumed = Math.min(remaining, this.areRemaining);
      this.areRemaining = Math.max(0, this.areRemaining - consumed);
      remaining -= consumed;
      if (this.areRemaining <= SUBFRAME_EPSILON) this.spawnNext(true);
      if (remaining <= SUBFRAME_EPSILON || this.state !== 'playing') return;
    }
    if (!this.current) return;
    const soft = this.actionIsDown('softDrop');
    if (soft && (config.handling.sdfMax || this.isSpinDrill())) {
      let distance = 0;
      while (this.tryMove(0, 1, false)) distance += 1;
      if (distance > 0) {
        this.score += distance;
        this.lastAction = 'softDrop';
        this.audio.play('soft');
      }
      this.gravityAccumulator = 0;
      return;
    }
    let speed = config.gameplay.gravity;
    if (soft) speed = Math.max(speed, 1 / TICK_RATE) * config.handling.sdf;
    this.gravityAccumulator += speed * remaining;
    let moved = 0;
    while (this.gravityAccumulator >= 1 && this.current) {
      if (this.tryMove(0, 1, false)) {
        this.gravityAccumulator -= 1;
        moved += 1;
      } else {
        this.gravityAccumulator = 0;
        break;
      }
    }
    if (soft && moved) {
      this.score += moved;
      this.lastAction = 'softDrop';
    }
  }
  processLock(delta) {
    if (!this.current) return;
    if (this.collides(this.current, 0, 1, this.current.rot)) {
      this.lockTimer += delta;
      if (this.lockTimer + SUBFRAME_EPSILON >= config.gameplay.lockDelay) {
        const overshoot = Math.max(0, this.lockTimer - config.gameplay.lockDelay);
        this.currentSubframe = Math.max(0, this.currentSubframe - overshoot);
        this.lockPiece();
      }
    } else {
      this.lockTimer = 0;
    }
  }
  cells(piece = this.current, x = piece?.x, y = piece?.y, rot = piece?.rot) {
    if (!piece) return [];
    return SHAPES[piece.type][rot].map(([dx, dy]) => [x + dx, y + dy]);
  }
  collides(piece, dx = 0, dy = 0, rot = piece.rot) {
    for (const [sx, sy] of SHAPES[piece.type][rot]) {
      const x = piece.x + dx + sx;
      const y = piece.y + dy + sy;
      if (x < 0 || x >= BOARD_W || y >= BOARD_H) return true;
      if (y >= 0 && this.board[y][x]) return true;
    }
    return false;
  }
  tryMove(dx, dy, manual, playAudio = manual) {
    if (!this.current || this.collides(this.current, dx, dy, this.current.rot)) return false;
    const wasGrounded = this.collides(this.current, 0, 1, this.current.rot);
    this.current.x += dx;
    this.current.y += dy;
    if (dx || dy) this.lastRotation = null;
    if (manual && dx) {
      this.lastAction = 'move';
      if (playAudio) this.audio.play('move');
    }
    if (manual && wasGrounded) this.resetLockFromManipulation();
    return true;
  }
  resetLockFromManipulation() {
    if (this.lockResetsUsed < config.gameplay.lockResets) {
      this.lockTimer = 0;
      this.lockResetsUsed += 1;
    }
  }
  tryRotate(delta, manual) {
    if (!this.current) return false;
    if (this.current.type === 'O') {
      if (manual) {
        const from = this.current.rot;
        const to = (from + delta + 4) % 4;
        this.lastAction = 'rotate';
        this.lastRotation = { delta, kickIndex: 0, from, to };
        this.setDCD();
        this.audio.play('rotate');
      }
      return true;
    }
    const from = this.current.rot;
    const to = (from + delta + 4) % 4;
    const table = this.kicks(this.current.type, from, to, delta);
    const wasGrounded = this.collides(this.current, 0, 1, this.current.rot);
    for (let index = 0; index < table.length; index += 1) {
      const [kx, ky] = table[index];
      if (!this.collides(this.current, kx, ky, to)) {
        this.current.x += kx;
        this.current.y += ky;
        this.current.rot = to;
        this.lastAction = 'rotate';
        this.lastRotation = { delta, kickIndex: index, from, to };
        if (manual && wasGrounded) this.resetLockFromManipulation();
        this.setDCD();
        this.audio.play('rotate');
        return true;
      }
    }
    return false;
  }
  kicks(type, from, to, delta) {
    const key = `${from}>${to}`;
    if (Math.abs(delta) === 2) return (type === 'I' ? I_180 : JLSTZ_180)[key] || [[0, 0]];
    if (type === 'I') return (config.gameplay.rotation === 'srsplus' ? I_90_SRS_PLUS : I_90_SRS)[key] || [[0, 0]];
    return JLSTZ_90[key] || [[0, 0]];
  }
  setDCD() {
    const frames = Math.max(0, config.handling.dcd);
    this.horizontal.dcd = Math.max(this.horizontal.dcd, frames);
    this.horizontal.repeat = 0;
  }
  ghostY() {
    if (!this.current) return 0;
    let y = this.current.y;
    while (!this.collides({ ...this.current, y }, 0, 1, this.current.rot)) y += 1;
    return y;
  }
  hardDrop() {
    if (!this.current) return;
    const fromY = this.current.y;
    const toY = this.ghostY();
    const distance = toY - fromY;
    this.current.y = toY;
    if (distance > 0) this.lastRotation = null;
    if (!['finesse', 'spin'].includes(this.mode)) this.score += distance * 2;
    this.lastAction = 'hardDrop';
    this.renderer.addHardDrop(this.current, fromY, toY);
    this.setDCD();
    this.audio.play('drop');
    this.lockPiece();
  }
  hold(manual = false) {
    if (this.isFinesseDrill() || this.isSpinDrill()) return false;
    if (!this.current || !config.gameplay.holdEnabled || !this.canHold) return false;
    const outgoing = this.current.type;
    if (this.holdType) {
      const incoming = this.holdType;
      this.holdType = outgoing;
      this.current = this.createPiece(incoming);
    } else {
      this.holdType = outgoing;
      this.current = this.createPiece(this.randomizer.next());
    }
    this.canHold = false;
    this.gravityAccumulator = 0;
    this.lockTimer = 0;
    this.lockResetsUsed = 0;
    this.lastAction = 'hold';
    this.lastRotation = null;
    this.pieceManipulations = 0;
    this.pieceInputTokens = [];
    if (manual) this.audio.play('hold');
    if (this.collides(this.current)) {
      this.topOut();
      return false;
    }
    return true;
  }
  createPiece(type) {
    return { type, x: 3, y: 19, rot: 0 };
  }
  spawnNext(applyBuffers = true) {
    if (this.isFinesseDrill()) {
      this.spawnFinessePiece();
      return;
    }
    if (this.isSpinDrill()) {
      this.spawnSpinPiece();
      return;
    }
    if (!this.randomizer) return;
    this.current = this.createPiece(this.randomizer.next());
    this.canHold = true;
    this.gravityAccumulator = 0;
    this.lockTimer = 0;
    this.lockResetsUsed = 0;
    this.lastAction = 'spawn';
    this.lastRotation = null;
    this.pieceManipulations = 0;
    this.pieceInputTokens = [];
    if (this.collides(this.current)) {
      this.topOut();
      return;
    }
    if (applyBuffers) this.applySpawnBuffers();
  }
  spawnFinessePiece() {
    const session = this.finesseSession;
    if (!session || session.index >= session.deck.length) {
      this.finish(true, 'CYCLE COMPLETE');
      return;
    }
    session.currentCase = session.deck[session.index];
    session.awaitingNeutral = false;
    this.board = session.type === 'stack' && session.currentCase.board ? deepClone(session.currentCase.board) : makeBoard();
    this.current = this.createPiece(session.currentCase.type);
    this.canHold = false;
    this.gravityAccumulator = 0;
    this.lockTimer = 0;
    this.lockResetsUsed = 0;
    this.lastAction = 'spawn';
    this.lastRotation = null;
    this.pieceManipulations = 0;
    this.pieceInputTokens = [];
    this.bufferTap = { hold: false, rotation: null };
    this.horizontal = { leftCharge: 0, rightCharge: 0, repeat: 0, activeDir: 0, dcd: 0 };
    this.renderer.lastMiniSignature = '';
  }
  finesseInputsNeutral() {
    return FINESSE_NEUTRAL_ACTIONS.every((action) => !this.input.isDown(action));
  }
  maybeSpawnFinessePiece() {
    if (!this.isFinesseDrill() || !this.finesseSession?.awaitingNeutral || !this.finesseInputsNeutral()) return;
    this.spawnFinessePiece();
  }
  spawnSpinPiece() {
    const session = this.spinSession;
    if (!session || session.index >= session.deck.length) {
      this.finish(true, 'LESSON COMPLETE');
      return;
    }
    const spinCase = session.deck[session.index];
    session.currentCase = spinCase;
    session.awaitingNeutral = false;
    this.board = deepClone(spinCase.board);
    this.current = { type: spinCase.type, ...deepClone(spinCase.spawn || { x: 3, y: 19, rot: 0 }) };
    this.canHold = false;
    this.gravityAccumulator = 0;
    this.lockTimer = 0;
    this.lockResetsUsed = 0;
    this.lastAction = 'spawn';
    this.lastRotation = null;
    this.pieceManipulations = 0;
    this.pieceInputTokens = [];
    this.bufferTap = { hold: false, rotation: null };
    this.horizontal = { leftCharge: 0, rightCharge: 0, repeat: 0, activeDir: 0, dcd: 0 };
    this.updateSpinCoach();
    this.renderer.lastMiniSignature = '';
  }
  spinInputsNeutral() {
    return FINESSE_NEUTRAL_ACTIONS.every((action) => !this.input.isDown(action));
  }
  maybeSpawnSpinPiece() {
    if (!this.isSpinDrill() || !this.spinSession?.awaitingNeutral || !this.spinInputsNeutral()) return;
    this.spawnSpinPiece();
  }
  previewSpinCases(count = 5) {
    if (!this.isSpinDrill() || !this.spinSession) return [];
    const start = this.spinSession.currentCase ? this.spinSession.index + 1 : this.spinSession.index;
    return this.spinSession.deck.slice(start, start + count);
  }
  updateSpinCoach() {
    const spinCase = this.spinSession?.currentCase;
    const coach = $('spinCoach');
    if (!coach) return;
    coach.classList.toggle('is-hidden', !this.isSpinDrill() || !spinCase || this.state === 'idle' || config.training.spinStyle === 'recall');
    if (!spinCase) return;
    const currentState = ['0', 'R', '2', 'L'][this.current?.rot ?? 0];
    const stateReady = this.current?.rot === spinCase.fromRot;
    const stagingReady = stateReady
      && this.current?.x === spinCase.start.x
      && this.current?.y === spinCase.start.y;
    coach.dataset.style = config.training.spinStyle;
    coach.dataset.validation = config.training.spinValidation;
    coach.dataset.stagingReady = String(stagingReady);
    coach.dataset.currentY = String(this.current?.y ?? '');
    coach.dataset.currentX = String(this.current?.x ?? '');
    coach.dataset.currentState = currentState;
    coach.dataset.stagingY = String(spinCase.start.y);
    coach.dataset.stagingX = String(spinCase.start.x);
    coach.dataset.finalDirection = spinCase.direction;
    coach.dataset.approachTimeline = JSON.stringify(spinCase.approachTimeline || []);
    coach.dataset.practiceRoute = JSON.stringify(spinCase.practiceRoute || []);
    coach.dataset.practiceTimeline = JSON.stringify(spinCase.practiceTimeline || []);
    const turnName = this.spinTurnName(spinCase);
    const placementOnly = config.training.spinValidation === 'placement';
    $('spinCaseTitle').textContent = spinCase.lessonLabel;
    $('spinKickValue').textContent = placementOnly ? 'POSITION CHECK' : 'TECHNIQUE CHECK';
    $('spinStateFrom').textContent = spinCase.stateNames[0];
    $('spinStateTo').textContent = spinCase.stateNames[1];
    $('spinDirectionValue').textContent = `예시 입력 · ${this.spinInputLabel(spinCase)}`;
    const finNote = spinCase.variant === 'fin' ? ' 일반적인 두 칸 하강 킥으로 넣으면 Mini이며, 표시된 마지막 킥을 써야 정식 Fin입니다.' : '';
    $('spinConceptValue').textContent = placementOnly
      ? '노란 목표 네 칸과 최종 배치가 같으면 성공합니다. NEO·FIN이나 마지막 회전 보정은 구분하지 않습니다.'
      : `↓ MAX에서 미노가 멈추면 키를 놓고, 예시 순서를 왼쪽부터 입력하세요. 마지막 ${turnName} 회전 후 SPACE로 확정합니다.${finNote}`;
  }
  evaluateSpinAttempt() {
    if (!this.current || !this.spinSession?.currentCase) return;
    const session = this.spinSession;
    const spinCase = session.currentCase;
    const strictEvaluation = evaluateSpinAttempt(spinCase, this.current, this.lastRotation);
    const placementOnly = config.training.spinValidation === 'placement';
    const evaluation = placementOnly
      ? evaluateSpinAttempt(spinCase, this.current, this.lastRotation, { validation: 'placement' })
      : strictEvaluation;
    const alternatePlacement = placementOnly && evaluation.success && !strictEvaluation.success;
    session.attempts += 1;
    session.caseAttempt += 1;
    const firstTry = session.caseAttempt === 1;
    const reasonLabels = {
      'no-rotation': '마지막에 회전하세요',
      'wrong-state': '회전 전 모양 확인',
      'wrong-direction': `TRY ${spinCase.direction}`,
      'target-missed': 'SLOT MISSED',
      'wrong-kick': '회전 위치 확인',
      'mini-not-fin': 'MINI · FIN 마지막 킥 필요',
      'wrong-spin-kind': 'MINI 판정 확인',
      'not-immobile': 'NOT LOCKED IN',
      'not-t-spin': '3 CORNERS NEEDED',
      'no-line-clear': 'NO LINE CLEAR',
      'hole-left': 'HOLE LEFT',
    };
    if (evaluation.success) {
      session.correct += 1;
      session.streak += 1;
      session.bestStreak = Math.max(session.bestStreak, session.streak);
      session.index += 1;
      session.caseAttempt = 0;
      this.pieces += 1;
      this.lines += spinCase.lineClearCount;
      this.finessePerfectPieces += 1;
      this.score = session.index;
      this.board = deepClone(spinCase.resultBoard);
      this.showAction(alternatePlacement ? 'PLACEMENT CLEAR' : spinCase.lessonLabel, 'accent');
      this.showSpinFeedback(alternatePlacement
        ? `${spinCase.lineClearCount}줄 클리어 · 다른 진입도 정답`
        : `${spinCase.lineClearCount}줄 클리어 · 성공`, 'accent');
      this.renderer.bounce(false);
    } else {
      session.streak = 0;
      this.finesseFaults += 1;
      this.showAction(reasonLabels[evaluation.reason] || 'TRY AGAIN', 'danger');
      this.showSpinFeedback(placementOnly
        ? '노란 목표 네 칸에 정확히 배치하세요'
        : `목표 · ${spinCase.stateNames[0]}에서 ${this.spinTurnName(spinCase)} 회전`, 'danger');
      this.audio.play('finesse');
    }
    this.recordSpinProgress(spinCase.id, evaluation.success, firstTry);
    this.current = null;
    this.gravityAccumulator = 0;
    this.lockTimer = 0;
    this.lockResetsUsed = 0;
    session.awaitingNeutral = true;
    session.currentCase = session.deck[session.index] || spinCase;
    this.renderer.lastMiniSignature = '';
    if (session.index >= session.deck.length) {
      this.finish(true, 'LESSON COMPLETE');
      return;
    }
    this.updateHUD();
  }
  previewFinesseCases(count = 5) {
    if (!this.isFinesseDrill() || !this.finesseSession) return [];
    const start = this.finesseSession.currentCase ? this.finesseSession.index + 1 : this.finesseSession.index;
    return this.finesseSession.deck.slice(start, start + count);
  }
  previewTypes(count = 5) {
    if (this.isFinesseDrill()) return this.previewFinesseCases(count).map((entry) => entry.type);
    if (this.isSpinDrill()) return this.previewSpinCases(count).map((entry) => entry.type);
    return this.randomizer ? this.randomizer.peek(count) : [];
  }
  applySpawnBuffers() {
    const ihsMode = config.handling.ihs;
    const holdTrigger = ihsMode === 'hold' ? this.actionIsDown('hold') : ihsMode === 'tap' ? this.bufferTap.hold : false;
    if (holdTrigger && config.gameplay.holdEnabled) this.hold(false);
    if (!this.current || this.state === 'over') return;
    const irsMode = config.handling.irs;
    let rotation = null;
    if (irsMode === 'tap') rotation = this.bufferTap.rotation;
    else if (irsMode === 'hold') {
      const candidates = ['rotateCW', 'rotateCCW', 'rotate180'].filter((action) => this.actionIsDown(action));
      candidates.sort((a, b) => this.actionLastPressed(b) - this.actionLastPressed(a));
      rotation = candidates[0] || null;
    }
    if (rotation === 'rotateCW') this.tryRotate(1, false);
    else if (rotation === 'rotateCCW') this.tryRotate(-1, false);
    else if (rotation === 'rotate180' && config.gameplay.allow180) this.tryRotate(2, false);
    if (ihsMode === 'tap') this.bufferTap.hold = false;
    if (irsMode === 'tap') this.bufferTap.rotation = null;
  }
  detectTSpin() {
    if (!this.current || this.current.type !== 'T' || !this.lastRotation) return { spin: false, mini: false };
    const cx = this.current.x + 1;
    const cy = this.current.y + 1;
    const corners = [[cx - 1, cy - 1], [cx + 1, cy - 1], [cx - 1, cy + 1], [cx + 1, cy + 1]];
    const occupied = corners.map(([x, y]) => x < 0 || x >= BOARD_W || y >= BOARD_H || y < 0 || Boolean(this.board[y][x]));
    if (occupied.filter(Boolean).length < 3) return { spin: false, mini: false };
    const frontByRot = {
      0: [0, 1],
      1: [1, 3],
      2: [2, 3],
      3: [0, 2],
    };
    const front = frontByRot[this.current.rot];
    const frontCount = front.filter((index) => occupied[index]).length;
    const mini = frontCount < 2 && (this.lastRotation?.kickIndex ?? 0) < 4;
    return { spin: true, mini };
  }
  showFinesseHint(text) {
    const hint = $('finesseHint');
    hint.textContent = text || '';
    hint.classList.toggle('is-visible', Boolean(text));
    this.finesseHintTimer = text ? 120 : 0;
  }
  showSpinFeedback(text, tone = 'accent') {
    const hint = $('finesseHint');
    hint.textContent = '';
    hint.classList.remove('is-visible');
    const feedback = $('spinFeedback');
    feedback.textContent = text || '';
    feedback.dataset.tone = tone;
    this.finesseHintTimer = text ? 75 : 0;
  }
  evaluateFinesseAttempt() {
    if (!this.current || !this.finesseSession?.currentCase) return;
    const session = this.finesseSession;
    const target = session.currentCase;
    const evaluation = evaluateFinessePlacement(target, this.current, this.pieceManipulations);
    session.attempts += 1;
    session.caseAttempt += 1;
    const firstTry = session.caseAttempt === 1;
    const faultCount = evaluation.success ? 0 : evaluation.reason === 'extra-input' ? Math.max(1, evaluation.extraInputs) : 1;

    if (evaluation.success) {
      session.correct += 1;
      session.streak += 1;
      session.bestStreak = Math.max(session.bestStreak, session.streak);
      session.caseAttempt = 0;
      session.index += 1;
      this.pieces += 1;
      this.finessePerfectPieces += 1;
      this.score = session.index;
      this.showAction('PERFECT', 'accent');
      this.showFinesseHint('');
      this.renderer.bounce(false);
    } else {
      session.streak = 0;
      this.finesseFaults += faultCount;
      const label = evaluation.reason === 'wrong-position' ? 'TARGET MISSED' : `EXTRA INPUT +${evaluation.extraInputs}`;
      const solution = target.solutions[0] || [];
      const actual = formatFinesseSolution(this.pieceInputTokens) || '—';
      this.showAction(label, 'danger');
      this.showFinesseHint(`YOU  ${actual}   ·   BEST  ${formatFinesseSolution(solution) || '—'}`);
      this.audio.play('finesse');
    }
    this.recordFinesseProgress(target.masteryId || target.id, {
      success: evaluation.success,
      faults: faultCount,
      firstTry,
      trainingType: session.type,
    });
    this.current = null;
    this.gravityAccumulator = 0;
    this.lockTimer = 0;
    this.lockResetsUsed = 0;
    session.awaitingNeutral = true;
    session.currentCase = session.deck[session.index] || target;
    this.renderer.lastMiniSignature = '';

    if (session.index >= session.deck.length) {
      this.finish(true, 'CYCLE COMPLETE');
      return;
    }
    this.updateHUD();
  }
  evaluateFlowFinesse(locked) {
    const session = this.finesseSession;
    if (!session || session.type !== 'flow') return this.measureFinesse(locked);
    this.refreshFinesseCatalog();
    const cells = pieceCells(locked.type, locked);
    const route = findBoardFinesseSolutions(locked.type, { cells }, this.board, {
      allow180: config.gameplay.allow180,
      arr: config.handling.arr,
      rotationSystem: config.gameplay.rotation,
    });
    const optimal = Number.isFinite(route.minInputs) ? route.minInputs : this.finesseDistance(locked.type, locked.x, locked.rot);
    const faults = Number.isFinite(optimal) ? Math.max(0, this.pieceManipulations - optimal) : 0;
    const success = faults === 0;
    const canonicalKey = placementKey(locked.type, locked.x, locked.rot);
    const entry = this.finesseCatalog.find((candidate) => candidate.type === locked.type && candidate.targetKey === canonicalKey);
    session.attempts += 1;
    if (success) {
      session.correct += 1;
      session.streak += 1;
      session.bestStreak = Math.max(session.bestStreak, session.streak);
      this.showFinesseHint('');
    } else {
      session.streak = 0;
      const actual = formatFinesseSolution(this.pieceInputTokens) || '—';
      const best = formatFinesseSolution(route.solutions[0] || []) || '—';
      this.showFinesseHint(`YOU  ${actual}   ·   BEST  ${best}`);
    }
    this.recordFinesseProgress(entry?.id, {
      success,
      faults,
      firstTry: true,
      trainingType: 'flow',
    });
    return faults;
  }
  lockPiece() {
    if (!this.current) return;
    if (this.isSpinDrill()) {
      this.evaluateSpinAttempt();
      return;
    }
    if (this.isFinesseDrill()) {
      this.evaluateFinesseAttempt();
      return;
    }
    const locked = deepClone(this.current);
    const tSpin = this.detectTSpin();
    const flowTraining = this.mode === 'finesse' && this.finesseSession?.type === 'flow';
    const flowFinesse = flowTraining ? this.evaluateFlowFinesse(locked) : null;
    const measuredFinesse = flowTraining ? null : this.measureFinesse(locked);
    for (const [x, y] of this.cells()) {
      if (y >= 0 && y < BOARD_H) this.board[y][x] = this.current.type;
    }
    const rows = [];
    for (let y = 0; y < BOARD_H; y += 1) if (this.board[y].every(Boolean)) rows.push(y);
    const finesse = flowTraining ? flowFinesse : measuredFinesse;
    if (finesse > 0) {
      this.finesseFaults += finesse;
      if (config.ui.finesseAlert) {
        this.showAction(`FINESSE +${finesse}`, 'danger');
        this.audio.play('finesse');
      }
      if (config.ui.retryOnFinesse && !['zen', 'finesse', 'spin'].includes(this.mode) && !this.replayMode) {
        this.start({ sameSeed: true, retryReason: 'FINESSE FAULT · AUTO RETRY' });
        return;
      }
    } else {
      this.finessePerfectPieces += 1;
      if (flowTraining) this.showAction('PERFECT', 'accent');
    }
    this.pieces += 1;
    this.applyScoring(rows.length, tSpin, this.isPerfectClearAfter(rows));
    if (rows.length) {
      this.renderer.addLineClear(rows, PIECE_COLORS[locked.type]);
      for (let i = rows.length - 1; i >= 0; i -= 1) this.board.splice(rows[i], 1);
      while (this.board.length < BOARD_H) this.board.unshift(Array(BOARD_W).fill(null));
      this.lines += rows.length;
      this.renderer.bounce(true);
    } else {
      this.renderer.bounce(false);
      this.audio.play('lock');
    }
    this.current = null;
    this.gravityAccumulator = 0;
    this.lockTimer = 0;
    this.lockResetsUsed = 0;

    if (this.mode === 'sprint' && this.lines >= 40) {
      this.complete();
      return;
    }
    if (this.mode === 'custom' && config.gameplay.customLines > 0 && this.lines >= config.gameplay.customLines) {
      this.complete();
      return;
    }
    const delay = rows.length ? config.gameplay.lineAre : config.gameplay.are;
    if (delay > 0) this.areRemaining = delay;
    else this.spawnNext(true);
  }
  isPerfectClearAfter(rows) {
    if (!rows.length) return false;
    const rowSet = new Set(rows);
    for (let y = 0; y < BOARD_H; y += 1) {
      if (rowSet.has(y)) continue;
      if (this.board[y].some(Boolean)) return false;
    }
    return true;
  }
  applyScoring(lines, tSpin, perfectClear) {
    let base = 0;
    let attack = 0;
    let qualifier = false;
    let label = '';
    if (tSpin.spin) {
      if (tSpin.mini) {
        base = [100, 200, 400, 0][lines] || 0;
        attack = [0, 1, 2, 0][lines] || 0;
        label = lines ? `T-SPIN MINI ${lines === 1 ? 'SINGLE' : 'DOUBLE'}` : 'T-SPIN MINI';
      } else {
        base = [400, 800, 1200, 1600][lines] || 0;
        attack = [0, 2, 4, 6][lines] || 0;
        label = lines ? `T-SPIN ${['', 'SINGLE', 'DOUBLE', 'TRIPLE'][lines]}` : 'T-SPIN';
      }
      qualifier = lines > 0;
    } else {
      base = [0, 100, 300, 500, 800][lines] || 0;
      attack = [0, 0, 1, 2, 4][lines] || 0;
      label = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD'][lines] || '';
      qualifier = lines === 4;
    }
    if (lines > 0) {
      this.combo += 1;
      if (qualifier) {
        if (this.b2b > 0) {
          base = Math.round(base * 1.5);
          attack += 1;
          label = `B2B ${label}`;
        }
        this.b2b += 1;
      } else {
        this.b2b = 0;
      }
      if (this.combo > 0) {
        base += 50 * this.combo;
        attack += Math.min(4, Math.floor((this.combo + 1) / 2));
      }
      if (perfectClear) {
        base += 3500;
        attack += 10;
        label = label ? `${label} · PERFECT CLEAR` : 'PERFECT CLEAR';
      }
      this.score += base;
      this.attack += attack;
      this.showAction(label, tSpin.spin || lines === 4 ? 'accent' : 'normal');
      this.audio.play(tSpin.spin ? 'tspin' : 'clear', lines);
    } else {
      this.combo = -1;
      if (tSpin.spin) {
        this.score += base;
        this.showAction(label, 'accent');
        this.audio.play('tspin');
      }
    }
  }
  measureFinesse(piece) {
    const targetRot = piece.type === 'O' ? 0 : piece.rot;
    const route = findFinesseSolutions(piece.type, placementKey(piece.type, piece.x, targetRot), {
      allow180: config.gameplay.allow180,
      arr: config.handling.arr,
      rotationSystem: config.gameplay.rotation,
    });
    const optimal = Number.isFinite(route.minInputs) ? route.minInputs : this.finesseDistance(piece.type, piece.x, targetRot);
    if (!Number.isFinite(optimal)) return 0;
    return Math.max(0, this.pieceManipulations - optimal);
  }
  finesseDistance(type, targetX, targetRot) {
    const widthFor = (rot) => {
      const xs = SHAPES[type][rot].map(([x]) => x);
      return [Math.min(...xs), Math.max(...xs)];
    };
    const legalX = (x, rot) => {
      const [min, max] = widthFor(rot);
      return x + min >= 0 && x + max < BOARD_W;
    };
    const start = { x: 3, rot: 0, d: 0 };
    const queue = [start];
    const seen = new Set(['3,0']);
    while (queue.length) {
      const state = queue.shift();
      if (state.x === targetX && state.rot === targetRot) return state.d;
      const neighbors = [];
      for (const dx of [-1, 1]) if (legalX(state.x + dx, state.rot)) neighbors.push([state.x + dx, state.rot]);
      const [minXShape, maxXShape] = widthFor(state.rot);
      neighbors.push([-minXShape, state.rot], [BOARD_W - 1 - maxXShape, state.rot]);
      const rotations = [1, -1];
      if (config.gameplay.allow180) rotations.push(2);
      for (const delta of rotations) {
        const rot = type === 'O' ? 0 : (state.rot + delta + 4) % 4;
        if (legalX(state.x, rot)) neighbors.push([state.x, rot]);
      }
      for (const [x, rot] of neighbors) {
        const key = `${x},${rot}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push({ x, rot, d: state.d + 1 });
      }
    }
    return Infinity;
  }
  topOut() {
    if (this.mode === 'zen') {
      this.board = makeBoard();
      this.current = null;
      this.holdType = null;
      this.canHold = true;
      this.combo = -1;
      this.b2b = 0;
      this.showAction('ZEN RESET', 'danger');
      this.spawnNext(true);
      return;
    }
    this.finish(false, 'TOP OUT');
  }
  complete() {
    this.finish(true, 'COMPLETE');
  }
  finish(success, badge) {
    if (this.state === 'over') return;
    const elapsedFrames = this.state === 'playing' ? this.playFrame + this.currentSubframe : this.playFrame;
    this.result = {
      success,
      badge,
      time: elapsedFrames * TICK_MS,
      pieces: this.pieces,
      inputs: this.inputs,
      finesse: this.finesseFaults,
    };
    if (this.replay && !this.replayMode) {
      this.replay.result = deepClone(this.result);
      this.lastReplay = deepClone(this.replay);
    }
    if (success && this.mode === 'sprint') {
      if (!personalBests.sprint || this.result.time < personalBests.sprint) {
        personalBests.sprint = this.result.time;
        try { localStorage.setItem(STORAGE_PB, JSON.stringify(personalBests)); } catch (_) {}
        $('resultBadge').textContent = 'NEW PERSONAL BEST';
        uiBridge.toast('새 개인 최고 기록입니다.', 'accent');
      } else {
        $('resultBadge').textContent = '';
      }
    } else {
      $('resultBadge').textContent = success && ['finesse', 'spin'].includes(this.mode) ? badge : success ? '' : badge;
    }
    $('resultTime').textContent = formatTime(this.result.time);
    $('resultPps').textContent = this.pps().toFixed(2);
    $('resultKpp').textContent = this.kpp().toFixed(2);
    $('resultFinesse').textContent = String(this.finesseFaults);
    $('resultPieces').textContent = String(this.pieces);
    this.setState('over');
    this.audio.play(success ? 'complete' : 'topout');
    this.updatePB();
    this.updateHUD();
  }
  pause(fromSettings = false) {
    if (this.state !== 'playing') return;
    this.settingsPaused = fromSettings;
    this.setState('paused');
  }
  resume() {
    if (this.state !== 'paused') return;
    this.settingsPaused = false;
    this.setState('playing');
  }
  pps() {
    return calculatePpsFromFrames(this.pieces, this.elapsedFrames());
  }
  kpp() {
    return this.pieces > 0 ? this.inputs / this.pieces : 0;
  }
  kps() {
    const seconds = this.elapsedFrames() / TICK_RATE;
    return seconds > 0 ? this.inputs / seconds : 0;
  }
  elapsedFrames() {
    if (this.result) return this.result.time / TICK_MS;
    return this.playFrame + (this.state === 'playing' ? this.currentSubframe : 0);
  }
  app() {
    return this.pieces > 0 ? this.attack / this.pieces : 0;
  }
  targetValue() {
    if (this.mode === 'spin') {
      return Math.max(0, (this.spinSession?.deck.length || this.configuredSpinCases().length) - (this.spinSession?.index || 0));
    }
    if (this.mode === 'finesse') {
      if (this.finesseTrainingType() === 'flow') return this.lines;
      return Math.max(0, (this.finesseSession?.deck.length || this.configuredFinesseCases().length) - (this.finesseSession?.index || 0));
    }
    if (this.mode === 'sprint') return Math.max(0, 40 - this.lines);
    if (this.mode === 'zen') return this.lines;
    if (config.gameplay.customLines <= 0) return this.lines;
    return Math.max(0, config.gameplay.customLines - this.lines);
  }
  finesseAccuracy() {
    if (this.mode === 'spin' && this.spinSession) {
      return this.spinSession.attempts > 0 ? this.spinSession.correct / this.spinSession.attempts * 100 : 100;
    }
    if (this.mode === 'finesse' && this.finesseSession) {
      return this.finesseSession.attempts > 0 ? this.finesseSession.correct / this.finesseSession.attempts * 100 : 100;
    }
    return this.pieces > 0 ? this.finessePerfectPieces / this.pieces * 100 : 100;
  }
  showAction(text, tone = 'normal') {
    if (!text) return;
    const element = $('actionText');
    element.textContent = text;
    element.dataset.tone = tone;
    element.classList.remove('is-visible');
    void element.offsetWidth;
    element.classList.add('is-visible');
    this.actionTextTimer = 75;
  }
  updateHUD() {
    $('ppsValue').textContent = this.pps().toFixed(2);
    $('finesseValue').textContent = `${Math.round(this.finesseAccuracy())}% · ${this.finesseFaults}F`;
    const training = ['finesse', 'spin'].includes(this.mode);
    const spinTraining = this.mode === 'spin';
    const flowTraining = this.mode === 'finesse' && this.finesseTrainingType() === 'flow';
    $('runCardTitle').textContent = spinTraining ? 'SPIN' : training ? 'FINESSE' : 'RUN';
    $('scoreRunLabel').textContent = training ? flowTraining ? 'LINES' : 'COVERAGE' : 'SCORE';
    $('finesseRunLabel').textContent = training ? 'ACCURACY' : 'FINESSE';
    $('linesRunLabel').textContent = training ? 'ATTEMPTS' : 'LINES';
    $('piecesRunLabel').textContent = training ? 'PERFECT' : 'PIECES';
    $('comboRunLabel').textContent = training ? 'STREAK' : 'COMBO';
    $('b2bRunLabel').textContent = training ? 'BEST' : 'B2B';
    if (training) {
      const session = spinTraining ? this.spinSession : this.finesseSession;
      const configuredCount = spinTraining ? this.configuredSpinCases().length : this.configuredFinesseCases().length;
      $('scoreValue').textContent = flowTraining ? String(this.lines) : `${session?.index || 0}/${session?.deck.length || configuredCount}`;
      $('linesValue').textContent = String(session?.attempts || 0);
      $('piecesValue').textContent = String(session?.correct || 0);
      $('comboValue').textContent = String(session?.streak || 0);
      $('b2bValue').textContent = String(session?.bestStreak || 0);
    } else {
      $('piecesValue').textContent = String(this.pieces);
      $('linesValue').textContent = String(this.lines);
      $('scoreValue').textContent = Math.round(this.score).toLocaleString('en-US');
      $('comboValue').textContent = this.combo >= 0 ? `${this.combo}×` : '—';
      $('b2bValue').textContent = this.b2b > 0 ? `${this.b2b}×` : '—';
    }
    $('elapsedTime').textContent = formatTime(this.elapsedFrames() * TICK_MS);
    $('objectiveValue').textContent = String(this.targetValue());
    $('objectiveLabel').textContent = training ? flowTraining ? 'LINES' : 'CASES LEFT' : this.mode === 'zen' || (this.mode === 'custom' && config.gameplay.customLines <= 0) ? 'LINES' : 'LINES LEFT';
    $('holdPanelLabel').textContent = training && !flowTraining ? 'TARGET' : 'HOLD';
    const target = spinTraining ? this.spinSession?.currentCase : this.finesseSession?.currentCase;
    $('holdState').textContent = training && !flowTraining
      ? spinTraining ? this.compactSpinTransition(target) : target?.rotationLabel || 'READY'
      : this.canHold ? 'READY' : 'USED';
    $('holdCanvas').setAttribute('aria-label', training && !flowTraining && target
      ? spinTraining ? `목표 ${target.type} 스핀, ${target.stateNames[0]}에서 ${target.stateNames[1]}` : `목표 ${target.type} 미노, ${target.rotationLabel}, 왼쪽에서 ${target.left + 1}번째 열`
      : '보관한 미노');
    this.updateSpinCoach();
    $('sameSeedRestartButton').disabled = !this.seed;
    $('footerRestartButton').disabled = !this.seed;
  }
}

const calculatePpsFromFrames = (pieces, frames) => {
  const seconds = frames / TICK_RATE;
  return seconds > 0 ? pieces / seconds : 0;
};

const formatTime = (ms) => {
  if (!Number.isFinite(ms)) return '—';
  const total = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
};

export { GameEngine, calculatePpsFromFrames, formatTime };
