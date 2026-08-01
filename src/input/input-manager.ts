import {
  $,
  ACTION_META,
  PRESET_ALIASES,
  TICK_MS,
  clamp,
  config,
} from '../core/state';
import { uiBridge } from '../ui/bridge';

const normalizeEventTimestamp = (value, now = performance.now()) => (
  Number.isFinite(value) && Math.abs(value - now) < 60_000 ? value : now
);

const calculateSubframe = (at, tickStart, tickEnd) => {
  const span = Math.max(0.001, tickEnd - tickStart);
  return Number(clamp((at - tickStart) / span, 0, 1).toFixed(9));
};

class InputManager {
  [key: string]: any;
  constructor() {
    this.queue = [];
    this.states = new Map();
    this.tickStartStates = new Map();
    this.edges = [];
    this.bindingMap = new Map();
    this.gamepadState = new Map();
    this.analogState = { left: false, right: false, down: false };
    this.latencySamples = [];
    this.sequence = 0;
    this.capture = null;
    this.rebuildBindings();
    window.addEventListener('keydown', (event) => this.onKeyDown(event), { capture: true });
    window.addEventListener('keyup', (event) => this.onKeyUp(event), { capture: true });
    window.addEventListener('blur', () => this.releaseAll());
  }
  state(action) {
    if (!this.states.has(action)) this.states.set(action, { down: false, lastPressed: -Infinity });
    return this.states.get(action);
  }
  rebuildBindings() {
    this.bindingMap.clear();
    const addBinding = (code, action) => {
      if (!code || code.startsWith('GP:')) return;
      if (!this.bindingMap.has(code)) this.bindingMap.set(code, []);
      if (!this.bindingMap.get(code).includes(action)) this.bindingMap.get(code).push(action);
    };
    for (const [action, slots] of Object.entries(config.controls.bindings) as [string, string[]][]) {
      for (const code of slots) addBinding(code, action);
    }
    const aliases = PRESET_ALIASES[config.controls.preset] || {};
    for (const [action, codes] of Object.entries(aliases) as [string, string[]][]) {
      for (const code of codes) addBinding(code, action);
    }
  }
  shouldPrevent(code) {
    return this.bindingMap.has(code) || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'F10', 'F11'].includes(code);
  }
  onKeyDown(event) {
    const panelOpen = !$('settingsPanel')?.classList.contains('is-hidden');
    if (panelOpen && (event.code === 'Escape' || event.code === 'F10')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      uiBridge.closeSettings();
      return;
    }
    if (this.capture) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.code === 'Escape') this.finishCapture(null, false);
      else if (event.code === 'Backspace' || event.code === 'Delete') this.finishCapture('', true);
      else this.finishCapture(event.code, true);
      return;
    }
    if (this.shouldPrevent(event.code)) event.preventDefault();
    const actions = this.bindingMap.get(event.code) || [];
    if (!event.repeat && actions.length) {
      try { uiBridge.ensureAudio(); } catch (_) {}
    }
    if (!event.repeat && actions.includes('fullscreen')) {
      uiBridge.toggleFullscreen();
    }
    for (const action of actions) {
      if (action === 'fullscreen' && !event.repeat) continue;
      if (event.repeat) {
        if (action === 'hardDrop' && !config.handling.hardDropSafety) {
          this.enqueue(action, 'pulse', event.timeStamp || performance.now(), 'keyboard');
        }
        continue;
      }
      this.enqueue(action, 'down', event.timeStamp || performance.now(), 'keyboard');
    }
  }
  onKeyUp(event) {
    if (this.capture) return;
    if (this.shouldPrevent(event.code)) event.preventDefault();
    const actions = this.bindingMap.get(event.code) || [];
    for (const action of actions) this.enqueue(action, 'up', event.timeStamp || performance.now(), 'keyboard');
  }
  enqueue(action, type, at = performance.now(), source = 'virtual', forcedSubframe = null) {
    const now = performance.now();
    this.queue.push({
      action,
      type,
      at: normalizeEventTimestamp(at, now),
      source,
      forcedSubframe,
      seq: this.sequence += 1,
    });
  }
  inject(action, type, subframe = 0) {
    this.enqueue(action, type, performance.now(), 'replay', clamp(Number(subframe) || 0, 0, 1));
  }
  beginTick(frame, tickStart = performance.now() - TICK_MS, tickEnd = performance.now()) {
    this.edges.length = 0;
    this.tickStartStates = new Map(
      [...this.states].map(([action, state]) => [action, { ...state }]),
    );
    const now = performance.now();
    const ready = [];
    const pending = [];
    for (const event of this.queue) {
      if (Number.isFinite(event.forcedSubframe) || event.at <= tickEnd + 0.001) ready.push(event);
      else pending.push(event);
    }
    this.queue = pending;
    const events = ready.sort((a, b) => (a.forcedSubframe ?? calculateSubframe(a.at, tickStart, tickEnd))
      - (b.forcedSubframe ?? calculateSubframe(b.at, tickStart, tickEnd)) || a.seq - b.seq);
    for (const event of events) {
      const state = this.state(event.action);
      const subframe = Number.isFinite(event.forcedSubframe)
        ? clamp(event.forcedSubframe, 0, 1)
        : calculateSubframe(event.at, tickStart, tickEnd);
      const edge = { ...event, subframe };
      if (event.type === 'pulse') {
        this.edges.push({ ...edge, type: 'down', pulse: true });
      } else if (event.type === 'down') {
        if (state.down) continue;
        state.down = true;
        state.lastPressed = frame + subframe;
        this.edges.push(edge);
      } else if (event.type === 'up') {
        if (!state.down) continue;
        state.down = false;
        this.edges.push(edge);
      }
      if (event.source === 'keyboard' || event.source === 'gamepad') {
        const latency = clamp(now - event.at, 0, 100);
        this.latencySamples.push(latency);
        if (this.latencySamples.length > 60) this.latencySamples.shift();
      }
    }
  }
  isDown(action) {
    return this.state(action).down;
  }
  tickStartIsDown(action) {
    return this.tickStartStates.get(action)?.down || false;
  }
  tickStartLastPressed(action) {
    return this.tickStartStates.get(action)?.lastPressed ?? -Infinity;
  }
  lastPressed(action) {
    return this.state(action).lastPressed;
  }
  avgLatency() {
    if (!this.latencySamples.length) return 0;
    return this.latencySamples.reduce((a, b) => a + b, 0) / this.latencySamples.length;
  }
  hardReset() {
    this.queue.length = 0;
    this.edges.length = 0;
    this.tickStartStates.clear();
    for (const state of this.states.values()) { state.down = false; state.lastPressed = -Infinity; }
    this.gamepadState.clear();
    this.analogState = { left: false, right: false, down: false };
  }
  releaseAll() {
    for (const [action, state] of this.states) {
      if (state.down) this.enqueue(action, 'up', performance.now(), 'system');
    }
    this.gamepadState.clear();
    this.analogState = { left: false, right: false, down: false };
  }
  pollGamepads() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const threshold = config.controls.gamepadSensitivity / 100;
    for (const pad of pads) {
      if (!pad) continue;
      for (let index = 0; index < pad.buttons.length; index += 1) {
        const token = `GP:B${index}`;
        const key = `${pad.index}:${index}`;
        const down = Boolean(pad.buttons[index].pressed);
        const previous = this.gamepadState.get(key) || false;
        if (down !== previous) {
          this.gamepadState.set(key, down);
          if (this.capture && down) {
            this.finishCapture(token, true);
            return;
          }
          for (const [action, slots] of Object.entries(config.controls.bindings) as [string, string[]][]) {
            if (slots.includes(token)) this.enqueue(action, down ? 'down' : 'up', performance.now(), 'gamepad');
          }
        }
      }
      const x = pad.axes[0] || 0;
      const y = pad.axes[1] || 0;
      this.updateAnalog('left', x < -threshold, 'moveLeft');
      this.updateAnalog('right', x > threshold, 'moveRight');
      this.updateAnalog('down', y > threshold, 'softDrop');
      break;
    }
  }
  updateAnalog(key, down, action) {
    if (this.analogState[key] === down) return;
    this.analogState[key] = down;
    this.enqueue(action, down ? 'down' : 'up', performance.now(), 'gamepad');
  }
  startCapture(action, slot) {
    this.capture = { action, slot };
    $('bindingCaptureLabel').textContent = `${ACTION_META.find(([id]) => id === action)?.[1] || action} · SLOT ${slot + 1}`;
    $('bindingCapture').classList.remove('is-hidden');
  }
  finishCapture(code, commit) {
    const capture = this.capture;
    if (!capture) return;
    this.capture = null;
    $('bindingCapture').classList.add('is-hidden');
    if (commit) {
      config.controls.bindings[capture.action][capture.slot] = code;
      config.controls.preset = 'custom';
      this.rebuildBindings();
      uiBridge.renderBindings();
      uiBridge.updateControlHints();
      uiBridge.scheduleSave();
    }
  }
}

export { InputManager, calculateSubframe, normalizeEventTimestamp };
