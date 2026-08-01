import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config, deepClone } from '../src/core/state';
import { GameEngine } from '../src/game/game-engine';
import { InputManager, calculateSubframe } from '../src/input/input-manager';

const originalHandling = deepClone(config.handling);
const originalGameplay = deepClone(config.gameplay);

beforeEach(() => {
  vi.stubGlobal('window', { addEventListener: vi.fn() });
});

afterEach(() => {
  Object.assign(config.handling, deepClone(originalHandling));
  Object.assign(config.gameplay, deepClone(originalGameplay));
  vi.unstubAllGlobals();
});

const makeHorizontalEngine = () => {
  const engine: any = Object.create(GameEngine.prototype);
  engine.horizontal = {
    leftCharge: 0,
    rightCharge: 0,
    repeat: 0,
    activeDir: -1,
    dcd: 0,
  };
  engine.tickHeld = { moveLeft: true, moveRight: false };
  engine.tickLastPressed = { moveLeft: 1, moveRight: -Infinity };
  engine.current = { type: 'T', x: 3, y: 19, rot: 0 };
  engine.audio = { play: vi.fn() };
  engine.tryMove = vi.fn(() => true);
  return engine;
};

describe('subframe input', () => {
  it('maps an event timestamp to its position inside a simulation tick', () => {
    expect(calculateSubframe(108, 100, 116)).toBeCloseTo(0.5);
    expect(calculateSubframe(90, 100, 116)).toBe(0);
    expect(calculateSubframe(120, 100, 116)).toBe(1);
  });

  it('preserves multiple edges and their order inside the same tick', () => {
    const input = new InputManager();
    const tickStart = performance.now();
    const tickEnd = tickStart + 16;
    input.enqueue('moveLeft', 'down', tickStart + 4, 'keyboard');
    input.enqueue('moveLeft', 'up', tickStart + 12, 'keyboard');

    input.beginTick(8, tickStart, tickEnd);

    expect(input.edges.map((edge) => [edge.type, edge.subframe])).toEqual([
      ['down', 0.25],
      ['up', 0.75],
    ]);
    expect(input.isDown('moveLeft')).toBe(false);
    expect(input.lastPressed('moveLeft')).toBeCloseTo(8.25);
  });

  it('replays and records the same subframe position', () => {
    const input = new InputManager();
    input.inject('moveRight', 'down', 0.375);
    input.beginTick(12, 100, 116);
    expect(input.edges[0].subframe).toBe(0.375);
    input.edges = [{ action: 'moveRight', type: 'down', source: 'keyboard', subframe: 0.375 }];

    const engine: any = Object.create(GameEngine.prototype);
    engine.input = input;
    engine.replayMode = false;
    engine.replay = { events: [] };
    engine.state = 'playing';
    engine.runFrame = 12;
    engine.recordEdges();

    expect(engine.replay.events).toEqual([
      { frame: 12, subframe: 0.375, action: 'moveRight', type: 'down' },
    ]);
  });

  it('charges DAS by only the held fraction of a frame', () => {
    const engine = makeHorizontalEngine();
    config.handling.das = 10;
    config.handling.arr = 2;

    engine.advanceHorizontal(0.25);

    expect(engine.horizontal.leftCharge).toBeCloseTo(0.25);
    expect(engine.tryMove).not.toHaveBeenCalled();
  });

  it('fires the first auto-shift exactly when fractional DAS crosses its threshold', () => {
    const engine = makeHorizontalEngine();
    config.handling.das = 10;
    config.handling.arr = 2;
    engine.horizontal.leftCharge = 9.75;

    engine.advanceHorizontal(0.25);

    expect(engine.horizontal.leftCharge).toBeCloseTo(10);
    expect(engine.tryMove).toHaveBeenCalledTimes(1);
    expect(engine.tryMove).toHaveBeenCalledWith(-1, 0, true, false);
  });

  it('consumes DCD before resuming fractional DAS charge', () => {
    const engine = makeHorizontalEngine();
    config.handling.das = 10;
    engine.horizontal.dcd = 0.6;

    engine.advanceHorizontal(1);

    expect(engine.horizontal.dcd).toBe(0);
    expect(engine.horizontal.leftCharge).toBeCloseTo(0.4);
  });

  it('accumulates gravity across fractional frame slices', () => {
    const engine: any = Object.create(GameEngine.prototype);
    engine.areRemaining = 0;
    engine.current = { type: 'T', x: 3, y: 19, rot: 0 };
    engine.tickHeld = { softDrop: false };
    engine.gravityAccumulator = 0;
    engine.score = 0;
    engine.tryMove = vi.fn(() => true);
    config.gameplay.gravity = 1;

    engine.processVertical(0.4);
    expect(engine.tryMove).not.toHaveBeenCalled();
    expect(engine.gravityAccumulator).toBeCloseTo(0.4);

    engine.processVertical(0.6);
    expect(engine.tryMove).toHaveBeenCalledTimes(1);
    expect(engine.gravityAccumulator).toBeCloseTo(0);
  });

  it('records an automatic lock at the fractional lock-delay boundary', () => {
    const engine: any = Object.create(GameEngine.prototype);
    engine.current = { type: 'T', x: 3, y: 19, rot: 0 };
    engine.lockTimer = 29.6;
    engine.currentSubframe = 0.8;
    engine.collides = vi.fn(() => true);
    engine.lockPiece = vi.fn();
    config.gameplay.lockDelay = 30;

    engine.processLock(0.6);

    expect(engine.lockPiece).toHaveBeenCalledOnce();
    expect(engine.currentSubframe).toBeCloseTo(0.6);
  });

  it('keeps gravity and lock delay active in SPIN LAB', () => {
    const engine: any = Object.create(GameEngine.prototype);
    engine.mode = 'spin';
    engine.current = { type: 'S', x: 3, y: 19, rot: 0 };
    engine.areRemaining = 0;
    engine.tickHeld = { softDrop: false };
    engine.gravityAccumulator = 0;
    engine.score = 0;
    engine.tryMove = vi.fn(() => true);
    config.gameplay.gravity = 1;

    engine.processVertical(1);
    expect(engine.tryMove).toHaveBeenCalledOnce();

    engine.lockTimer = config.gameplay.lockDelay - 0.5;
    engine.currentSubframe = 1;
    engine.collides = vi.fn(() => true);
    engine.lockPiece = vi.fn();
    engine.processLock(0.5);
    expect(engine.lockPiece).toHaveBeenCalledOnce();
  });

  it('invalidates a stale spin marker after the piece falls', () => {
    const engine: any = Object.create(GameEngine.prototype);
    engine.board = Array.from({ length: 40 }, () => Array(10).fill(null));
    engine.current = { type: 'T', x: 3, y: 19, rot: 0 };
    engine.lastRotation = { delta: 1, kickIndex: 0, from: 3, to: 0 };

    expect(engine.tryMove(0, 1, false)).toBe(true);
    expect(engine.lastRotation).toBeNull();
  });

  it('invalidates a stale spin marker when hard drop still travels', () => {
    const engine: any = Object.create(GameEngine.prototype);
    engine.current = { type: 'T', x: 3, y: 19, rot: 0 };
    engine.lastRotation = { delta: 1, kickIndex: 0, from: 3, to: 0 };
    engine.score = 0;
    engine.mode = 'sprint';
    engine.ghostY = vi.fn(() => 30);
    engine.renderer = { addHardDrop: vi.fn() };
    engine.audio = { play: vi.fn() };
    engine.setDCD = vi.fn();
    engine.lockPiece = vi.fn();

    engine.hardDrop();

    expect(engine.lastRotation).toBeNull();
    expect(engine.lockPiece).toHaveBeenCalledOnce();
  });

  it('keeps the final rotation marker when hard drop locks in place', () => {
    const engine: any = Object.create(GameEngine.prototype);
    const rotation = { delta: 1, kickIndex: 0, from: 3, to: 0 };
    engine.current = { type: 'T', x: 3, y: 30, rot: 0 };
    engine.lastRotation = rotation;
    engine.score = 0;
    engine.mode = 'sprint';
    engine.ghostY = vi.fn(() => 30);
    engine.renderer = { addHardDrop: vi.fn() };
    engine.audio = { play: vi.fn() };
    engine.setDCD = vi.fn();
    engine.lockPiece = vi.fn();

    engine.hardDrop();

    expect(engine.lastRotation).toBe(rotation);
  });
});
