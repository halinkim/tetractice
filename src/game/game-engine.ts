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
import { PieceRandomizer } from './randomizer';

const makeBoard = () => Array.from({ length: BOARD_H }, () => Array(BOARD_W).fill(null));

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
    this.combo = -1;
    this.b2b = 0;
    this.lastAction = null;
    this.lastRotation = null;
    this.pieceManipulations = 0;
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
    const status = state === 'playing' ? 'RUNNING' : state === 'paused' ? 'PAUSED' : state === 'countdown' ? 'GET READY' : state === 'over' ? 'RUN COMPLETE' : 'READY';
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
    const modeInfo = {
      sprint: ['SOLO / 40 LINES', '40 LINES', '40줄을 가능한 한 빠르게 제거하세요.', 'LINES LEFT'],
      zen: ['SOLO / ZEN', 'ZEN', '종료 조건 없이 쌓기와 핸들링을 연습하세요.', 'LINES'],
      custom: ['SOLO / CUSTOM', 'CUSTOM', '설정한 목표 줄 수 또는 무한 모드로 연습하세요.', 'LINES LEFT'],
    }[this.mode];
    $('modeKicker').textContent = modeInfo[0];
    $('modeTitle').textContent = modeInfo[1];
    $('modeDescription').textContent = modeInfo[2];
    $('objectiveLabel').textContent = modeInfo[3];
    const strideToggle = $('strideModeToggle');
    if (strideToggle) {
      strideToggle.disabled = this.mode === 'zen';
      strideToggle.closest('label')?.classList.toggle('is-disabled', this.mode === 'zen');
      strideToggle.closest('label')?.setAttribute('title', this.mode === 'zen' ? 'Stride Mode는 ZEN에서 적용되지 않습니다.' : 'READY–SET–GO 시작 시퀀스를 사용합니다.');
    }
    const finesseRetryToggle = $('finesseRetryToggle');
    if (finesseRetryToggle) {
      finesseRetryToggle.disabled = this.mode === 'zen';
      finesseRetryToggle.closest('label')?.classList.toggle('is-disabled', this.mode === 'zen');
      finesseRetryToggle.closest('label')?.setAttribute('title', this.mode === 'zen' ? '자동 재시작은 ZEN에서 적용되지 않습니다.' : 'Finesse fault가 감지되면 같은 시드로 다시 시작합니다.');
    }
    document.querySelectorAll('.mode-tab').forEach((button: any) => button.classList.toggle('is-active', button.dataset.mode === this.mode));
    this.updatePB();
    this.updateHUD();
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
    const strideActive = Boolean(config.ui.strideMode && this.mode !== 'zen' && !options.skipCountdown);
    const avoidFirstPiece = Boolean(strideActive && this.mode !== 'custom');
    this.board = makeBoard();
    this.randomizer = new PieceRandomizer(this.seed, config.gameplay.randomizer, avoidFirstPiece);
    this.randomizer.ensure(7);
    this.current = null;
    this.holdType = null;
    this.canHold = true;
    this.runFrame = 0;
    this.playFrame = 0;
    this.countdownStyle = options.skipCountdown ? 'skip' : strideActive ? 'stride' : 'normal';
    this.countdownFrames = this.countdownStyle === 'skip' ? 1 : this.countdownStyle === 'stride' ? 90 : 180;
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
    this.combo = -1;
    this.b2b = 0;
    this.lastAction = null;
    this.lastRotation = null;
    this.pieceManipulations = 0;
    this.bufferTap = { hold: false, rotation: null };
    this.horizontal = { leftCharge: 0, rightCharge: 0, repeat: 0, activeDir: 0, dcd: 0 };
    this.retryHoldFrames = 0;
    this.retryArmed = false;
    this.result = null;
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
    $('countdownSub').textContent = options.retryReason || (this.replayMode ? 'REPLAY' : this.handlingTest ? 'HANDLING TEST' : 'GET READY');
    this.audio.ensure();
    this.updateHUD();
  }
  replayConfigSnapshot() {
    return {
      handling: deepClone(config.handling),
      gameplay: deepClone(config.gameplay),
      ui: { strideMode: config.ui.strideMode, retryOnFinesse: config.ui.retryOnFinesse },
    };
  }
  injectReplayEvents() {
    if (!this.replayMode || !this.replay?.events) return;
    while (this.replayCursor < this.replay.events.length && this.replay.events[this.replayCursor].frame === this.runFrame) {
      const event = this.replay.events[this.replayCursor];
      this.input.inject(event.action, event.type);
      this.replayCursor += 1;
    }
  }
  recordEdges() {
    if (this.replayMode || !this.replay || !['countdown', 'playing'].includes(this.state)) return;
    for (const event of this.input.edges) {
      if (event.source === 'replay' || ['pause', 'config', 'fullscreen', 'retry'].includes(event.action)) continue;
      this.replay.events.push({ frame: this.runFrame, action: event.action, type: event.type === 'pulse' ? 'down' : event.type });
      if (event.pulse) this.replay.events.push({ frame: this.runFrame, action: event.action, type: 'up' });
    }
  }
  fixedUpdate() {
    this.injectReplayEvents();
    this.input.beginTick(this.runFrame);
    this.recordEdges();
    this.handleGlobalEdges();
    if (this.processRetryHold()) return;

    if (this.state === 'countdown') {
      this.processBuffers();
      this.processHorizontal();
      this.countdownFrames -= 1;
      this.runFrame += 1;
      if (this.countdownFrames > 0) {
        const previous = $('countdownValue').textContent;
        let text;
        if (this.countdownStyle === 'stride') {
          text = this.countdownFrames > 60 ? 'READY' : this.countdownFrames > 30 ? 'SET' : 'GO';
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

    this.processPlayingEdges();
    if (this.state !== 'playing') return;

    const verticalFirst = config.handling.softDropPriority;
    if (verticalFirst) this.processVertical();
    this.processHorizontal();
    if (!verticalFirst) this.processVertical();
    this.processLock();

    this.playFrame += 1;
    this.runFrame += 1;
    if (this.actionTextTimer > 0) {
      this.actionTextTimer -= 1;
      if (this.actionTextTimer <= 0) $('actionText').classList.remove('is-visible');
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
    this.combo = -1;
    this.b2b = 0;
    this.lastAction = null;
    this.lastRotation = null;
    this.pieceManipulations = 0;
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
    $('startOverlay').classList.remove('is-hidden');
    this.renderer.lastMiniSignature = '';
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
  processBuffers() {
    for (const edge of this.input.edges) {
      if (this.replayMode && edge.source !== 'replay') continue;
      if (edge.type !== 'down') continue;
      if (edge.action === 'hold') this.bufferTap.hold = true;
      if (['rotateCW', 'rotateCCW', 'rotate180'].includes(edge.action)) this.bufferTap.rotation = edge.action;
    }
  }
  processPlayingEdges() {
    for (const edge of this.input.edges) {
      if (this.replayMode && edge.source !== 'replay' && !['pause', 'config', 'fullscreen', 'retry'].includes(edge.action)) continue;
      if (edge.type === 'up') {
        if (edge.action === 'moveLeft' && this.horizontal.activeDir === -1 && !this.input.isDown('moveRight')) this.horizontal.activeDir = 0;
        if (edge.action === 'moveRight' && this.horizontal.activeDir === 1 && !this.input.isDown('moveLeft')) this.horizontal.activeDir = 0;
        continue;
      }
      if (edge.type !== 'down') continue;
      if (['pause', 'config', 'fullscreen', 'retry'].includes(edge.action)) continue;
      this.inputs += 1;
      if (!this.current) {
        if (edge.action === 'hold') this.bufferTap.hold = true;
        if (['rotateCW', 'rotateCCW', 'rotate180'].includes(edge.action)) this.bufferTap.rotation = edge.action;
        continue;
      }
      switch (edge.action) {
        case 'moveLeft':
          this.pieceManipulations += 1;
          this.directionPress(-1);
          this.tryMove(-1, 0, true);
          break;
        case 'moveRight':
          this.pieceManipulations += 1;
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
          this.tryRotate(1, true);
          break;
        case 'rotateCCW':
          this.pieceManipulations += 1;
          this.tryRotate(-1, true);
          break;
        case 'rotate180':
          if (config.gameplay.allow180) {
            this.pieceManipulations += 1;
            this.tryRotate(2, true);
          }
          break;
        case 'hold':
          this.hold(true);
          break;
        default: break;
      }
      if (this.state !== 'playing') break;
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
  updateHorizontalCharge(hasPiece = true) {
    const left = this.input.isDown('moveLeft');
    const right = this.input.isDown('moveRight');
    const previousDir = this.horizontal.activeDir;
    if (!left) this.horizontal.leftCharge = 0;
    if (!right) this.horizontal.rightCharge = 0;
    if (this.horizontal.activeDir === -1 && !left) this.horizontal.activeDir = right ? 1 : 0;
    if (this.horizontal.activeDir === 1 && !right) this.horizontal.activeDir = left ? -1 : 0;
    if (!this.horizontal.activeDir) {
      if (left && right) this.horizontal.activeDir = this.input.lastPressed('moveLeft') > this.input.lastPressed('moveRight') ? -1 : 1;
      else if (left) this.horizontal.activeDir = -1;
      else if (right) this.horizontal.activeDir = 1;
    }
    if (previousDir !== this.horizontal.activeDir) this.horizontal.repeat = 0;
    if (!this.horizontal.activeDir) this.horizontal.repeat = 0;
    if (this.horizontal.dcd > 0) {
      this.horizontal.dcd = Math.max(0, this.horizontal.dcd - 1);
      return { ready: false, crossed: false, dir: this.horizontal.activeDir };
    }
    const dir = this.horizontal.activeDir;
    if (!dir) return { ready: false, crossed: false, dir: 0 };
    const key = dir === -1 ? 'leftCharge' : 'rightCharge';
    const previous = this.horizontal[key];
    this.horizontal[key] += 1;
    const ready = this.horizontal[key] >= config.handling.das;
    const crossed = previous < config.handling.das && ready;
    if (!hasPiece) return { ready, crossed, dir };
    return { ready, crossed, dir };
  }
  processHorizontal() {
    const info = this.updateHorizontalCharge(Boolean(this.current));
    if (!info.ready || !info.dir) return;
    if (config.handling.arr <= 0) {
      if (!this.current) return;
      let moved = false;
      while (this.tryMove(info.dir, 0, true, false)) moved = true;
      if (moved) this.audio.play('move');
      return;
    }
    if (info.crossed) this.horizontal.repeat = config.handling.arr;
    else this.horizontal.repeat += 1;
    if (!this.current) {
      this.horizontal.repeat = Math.min(config.handling.arr, this.horizontal.repeat);
      return;
    }
    let moved = false;
    while (this.horizontal.repeat >= config.handling.arr) {
      this.horizontal.repeat -= config.handling.arr;
      if (!this.tryMove(info.dir, 0, true, false)) {
        this.horizontal.repeat = 0;
        break;
      }
      moved = true;
    }
    if (moved) this.audio.play('move');
  }
  processVertical() {
    if (this.areRemaining > 0) {
      this.areRemaining -= 1;
      if (this.areRemaining <= 0) this.spawnNext(true);
      return;
    }
    if (!this.current) return;
    const soft = this.input.isDown('softDrop');
    if (soft && config.handling.sdfMax) {
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
    this.gravityAccumulator += speed;
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
  processLock() {
    if (!this.current) return;
    if (this.collides(this.current, 0, 1, this.current.rot)) {
      this.lockTimer += 1;
      if (this.lockTimer >= config.gameplay.lockDelay) this.lockPiece();
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
    if (manual && dx) {
      this.lastAction = 'move';
      this.lastRotation = null;
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
        this.lastAction = 'rotate';
        this.lastRotation = { delta, kickIndex: 0 };
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
        this.lastRotation = { delta, kickIndex: index };
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
    const frames = config.handling.dcd > 0 ? config.handling.dcd + 1 : 0;
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
    this.score += distance * 2;
    this.lastAction = 'hardDrop';
    this.renderer.addHardDrop(this.current, fromY, toY);
    this.setDCD();
    this.audio.play('drop');
    this.lockPiece();
  }
  hold(manual = false) {
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
    if (!this.randomizer) return;
    this.current = this.createPiece(this.randomizer.next());
    this.canHold = true;
    this.gravityAccumulator = 0;
    this.lockTimer = 0;
    this.lockResetsUsed = 0;
    this.lastAction = 'spawn';
    this.lastRotation = null;
    this.pieceManipulations = 0;
    if (this.collides(this.current)) {
      this.topOut();
      return;
    }
    if (applyBuffers) this.applySpawnBuffers();
  }
  applySpawnBuffers() {
    const ihsMode = config.handling.ihs;
    const holdTrigger = ihsMode === 'hold' ? this.input.isDown('hold') : ihsMode === 'tap' ? this.bufferTap.hold : false;
    if (holdTrigger && config.gameplay.holdEnabled) this.hold(false);
    if (!this.current || this.state === 'over') return;
    const irsMode = config.handling.irs;
    let rotation = null;
    if (irsMode === 'tap') rotation = this.bufferTap.rotation;
    else if (irsMode === 'hold') {
      const candidates = ['rotateCW', 'rotateCCW', 'rotate180'].filter((action) => this.input.isDown(action));
      candidates.sort((a, b) => this.input.lastPressed(b) - this.input.lastPressed(a));
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
  lockPiece() {
    if (!this.current) return;
    const locked = deepClone(this.current);
    const tSpin = this.detectTSpin();
    for (const [x, y] of this.cells()) {
      if (y >= 0 && y < BOARD_H) this.board[y][x] = this.current.type;
    }
    const rows = [];
    for (let y = 0; y < BOARD_H; y += 1) if (this.board[y].every(Boolean)) rows.push(y);
    const finesse = this.measureFinesse(locked);
    if (finesse > 0) {
      this.finesseFaults += finesse;
      if (config.ui.finesseAlert) {
        this.showAction(`FINESSE +${finesse}`, 'danger');
        this.audio.play('finesse');
      }
      if (config.ui.retryOnFinesse && this.mode !== 'zen' && !this.replayMode) {
        this.start({ sameSeed: true, retryReason: 'FINESSE FAULT · AUTO RETRY' });
        return;
      }
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
    const optimal = this.finesseDistance(piece.type, piece.x, targetRot);
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
    this.result = {
      success,
      badge,
      time: this.playFrame * TICK_MS,
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
        $('resultKicker').textContent = 'NEW PERSONAL BEST';
        $('resultBadge').textContent = 'NEW PB';
        uiBridge.toast('새 개인 최고 기록입니다.', 'accent');
      } else {
        $('resultKicker').textContent = 'RUN COMPLETE';
        $('resultBadge').textContent = badge;
      }
    } else {
      $('resultKicker').textContent = success ? 'RUN COMPLETE' : 'RUN ENDED';
      $('resultBadge').textContent = badge;
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
    const seconds = this.playFrame / TICK_RATE;
    return seconds > 0 ? this.pieces / seconds : 0;
  }
  kpp() {
    return this.pieces > 0 ? this.inputs / this.pieces : 0;
  }
  kps() {
    const seconds = this.playFrame / TICK_RATE;
    return seconds > 0 ? this.inputs / seconds : 0;
  }
  app() {
    return this.pieces > 0 ? this.attack / this.pieces : 0;
  }
  targetValue() {
    if (this.mode === 'sprint') return Math.max(0, 40 - this.lines);
    if (this.mode === 'zen') return this.lines;
    if (config.gameplay.customLines <= 0) return this.lines;
    return Math.max(0, config.gameplay.customLines - this.lines);
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
    $('inputsValue').textContent = String(this.inputs);
    $('kppValue').textContent = this.kpp().toFixed(2);
    $('kpsValue').textContent = this.kps().toFixed(2);
    $('piecesValue').textContent = String(this.pieces);
    $('linesValue').textContent = String(this.lines);
    $('scoreValue').textContent = Math.round(this.score).toLocaleString('en-US');
    $('comboValue').textContent = this.combo >= 0 ? `${this.combo}×` : '—';
    $('b2bValue').textContent = this.b2b > 0 ? `${this.b2b}×` : '—';
    $('finesseValue').textContent = String(this.finesseFaults);
    $('ppsValue').textContent = this.pps().toFixed(2);
    $('appValue').textContent = this.app().toFixed(2);
    $('objectiveValue').textContent = String(this.targetValue());
    $('objectiveLabel').textContent = this.mode === 'zen' || (this.mode === 'custom' && config.gameplay.customLines <= 0) ? 'LINES' : 'LINES LEFT';
    $('holdState').textContent = this.canHold ? 'READY' : 'USED';
    $('latencyText').textContent = `INPUT QUEUE ${this.input.avgLatency().toFixed(1)} ms`;
    $('sameSeedRestartButton').disabled = !this.seed;
    $('footerRestartButton').disabled = !this.seed;
  }
}

const formatTime = (ms) => {
  if (!Number.isFinite(ms)) return '—';
  const total = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
};

export { GameEngine };
