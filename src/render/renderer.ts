import {
  $,
  BOARD_H,
  BOARD_W,
  CELL,
  PIECE_COLORS,
  SHAPES,
  VISIBLE_H,
  VISIBLE_START,
  clamp,
  config,
  deepClone,
} from '../core/state';

class Renderer {
  [key: string]: any;
  constructor() {
    this.canvas = $('boardCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.fxCanvas = $('fxCanvas');
    this.fx = this.fxCanvas.getContext('2d');
    this.holdCanvas = $('holdCanvas');
    this.holdCtx = this.holdCanvas.getContext('2d');
    this.nextCanvases = [...document.querySelectorAll('.next-canvas')];
    this.nextContexts = this.nextCanvases.map((c) => c.getContext('2d'));
    [this.ctx, this.fx, this.holdCtx, ...this.nextContexts].forEach((ctx) => {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    });
    this.particles = [];
    this.trails = [];
    this.clearFlashes = [];
    this.blockCache = new Map();
    this.lastMiniSignature = '';
    this.lastTime = performance.now();
  }
  block(ctx, x, y, size, color, alpha = 1, ghost = false) {
    ctx.save();
    ctx.globalAlpha = alpha;
    if (ghost) {
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha * 0.2;
      ctx.fillRect(x + size * 0.09, y + size * 0.09, size * 0.82, size * 0.82);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, size * 0.06);
      ctx.strokeRect(x + size * 0.11, y + size * 0.11, size * 0.78, size * 0.78);
      ctx.restore();
      return;
    }
    const cacheKey = `${size}:${color}`;
    let sprite = this.blockCache.get(cacheKey);
    if (!sprite) {
      sprite = document.createElement('canvas');
      sprite.width = Math.ceil(size);
      sprite.height = Math.ceil(size);
      const spriteCtx = sprite.getContext('2d');
      const gap = Math.max(2, Math.round(size * 0.055));
      const edge = Math.max(2, Math.round(size * 0.11));
      const faceX = gap;
      const faceY = gap;
      const faceSize = size - gap * 2;
      const faceRight = faceX + faceSize;
      const faceBottom = faceY + faceSize;

      spriteCtx.fillStyle = this.mix(color, '#0c0a0f', 0.68);
      spriteCtx.fillRect(Math.max(1, gap * 0.35), Math.max(1, gap * 0.35), size - gap * 0.7, size - gap * 0.7);
      spriteCtx.fillStyle = color;
      spriteCtx.fillRect(faceX, faceY, faceSize, faceSize);

      spriteCtx.fillStyle = this.mix(color, '#ffffff', 0.28);
      spriteCtx.beginPath();
      spriteCtx.moveTo(faceX, faceY);
      spriteCtx.lineTo(faceRight, faceY);
      spriteCtx.lineTo(faceRight - edge, faceY + edge);
      spriteCtx.lineTo(faceX + edge, faceY + edge);
      spriteCtx.closePath();
      spriteCtx.fill();

      spriteCtx.fillStyle = this.mix(color, '#ffffff', 0.12);
      spriteCtx.beginPath();
      spriteCtx.moveTo(faceX, faceY);
      spriteCtx.lineTo(faceX + edge, faceY + edge);
      spriteCtx.lineTo(faceX + edge, faceBottom - edge);
      spriteCtx.lineTo(faceX, faceBottom);
      spriteCtx.closePath();
      spriteCtx.fill();

      spriteCtx.fillStyle = this.mix(color, '#0c0a0f', 0.28);
      spriteCtx.beginPath();
      spriteCtx.moveTo(faceX, faceBottom);
      spriteCtx.lineTo(faceX + edge, faceBottom - edge);
      spriteCtx.lineTo(faceRight - edge, faceBottom - edge);
      spriteCtx.lineTo(faceRight, faceBottom);
      spriteCtx.closePath();
      spriteCtx.fill();

      spriteCtx.fillStyle = this.mix(color, '#0c0a0f', 0.4);
      spriteCtx.beginPath();
      spriteCtx.moveTo(faceRight, faceY);
      spriteCtx.lineTo(faceRight, faceBottom);
      spriteCtx.lineTo(faceRight - edge, faceBottom - edge);
      spriteCtx.lineTo(faceRight - edge, faceY + edge);
      spriteCtx.closePath();
      spriteCtx.fill();

      spriteCtx.fillStyle = this.mix(color, '#ffffff', 0.035);
      spriteCtx.fillRect(faceX + edge, faceY + edge, faceSize - edge * 2, faceSize - edge * 2);
      this.blockCache.set(cacheKey, sprite);
    }
    ctx.drawImage(sprite, x, y, size, size);
    ctx.restore();
  }
  targetBlock(ctx, x, y, size) {
    const inset = Math.max(4, size * 0.07);
    const edge = Math.max(8, size * 0.22);
    const left = x + inset;
    const top = y + inset;
    const right = x + size - inset;
    const bottom = y + size - inset;
    ctx.save();
    ctx.fillStyle = '#ffd34e';
    ctx.globalAlpha = 0.08;
    ctx.fillRect(left, top, right - left, bottom - top);
    ctx.globalAlpha = 0.96;
    ctx.strokeStyle = '#ffd34e';
    ctx.lineWidth = Math.max(3, size * 0.055);
    ctx.lineCap = 'square';
    ctx.beginPath();
    ctx.moveTo(left, top + edge); ctx.lineTo(left, top); ctx.lineTo(left + edge, top);
    ctx.moveTo(right - edge, top); ctx.lineTo(right, top); ctx.lineTo(right, top + edge);
    ctx.moveTo(right, bottom - edge); ctx.lineTo(right, bottom); ctx.lineTo(right - edge, bottom);
    ctx.moveTo(left + edge, bottom); ctx.lineTo(left, bottom); ctx.lineTo(left, bottom - edge);
    ctx.stroke();
    ctx.restore();
  }
  mix(a, b, amount) {
    const pa = this.hex(a);
    const pb = this.hex(b);
    const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * amount));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  hex(value) {
    const raw = value.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16));
  }
  draw(game) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#0d0b12';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const gridAlpha = config.visual.gridOpacity / 100;
    if (gridAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = gridAlpha * 0.55;
      ctx.strokeStyle = '#655b70';
      ctx.lineWidth = 1;
      for (let x = 1; x < BOARD_W; x += 1) {
        ctx.beginPath(); ctx.moveTo(x * CELL + 0.5, 0); ctx.lineTo(x * CELL + 0.5, VISIBLE_H * CELL); ctx.stroke();
      }
      for (let y = 1; y < VISIBLE_H; y += 1) {
        ctx.beginPath(); ctx.moveTo(0, y * CELL + 0.5); ctx.lineTo(BOARD_W * CELL, y * CELL + 0.5); ctx.stroke();
      }
      ctx.restore();
    }

    const finesseDrill = Boolean(game.isFinesseDrill?.());
    const finesseTarget = finesseDrill ? game.finesseSession?.currentCase : null;
    const spinDrill = Boolean(game.isSpinDrill?.());
    const spinCase = spinDrill ? game.spinSession?.currentCase : null;
    const spinGuided = spinDrill && config.training.spinStyle === 'guided';
    const spinTarget = spinGuided ? spinCase : null;
    const trainingTarget = finesseTarget || spinTarget;
    const stackTerrain = finesseTarget?.context === 'stack' || spinDrill;
    if (game.board) {
      for (let y = VISIBLE_START; y < BOARD_H; y += 1) {
        for (let x = 0; x < BOARD_W; x += 1) {
          const type = game.board[y][x];
          if (type) this.block(ctx, x * CELL, (y - VISIBLE_START) * CELL, CELL, stackTerrain ? '#51475c' : PIECE_COLORS[type]);
        }
      }
    }
    if (game.current) {
      if (config.gameplay.ghost) {
        const ghostY = game.ghostY();
        if (ghostY !== game.current.y) {
          const ghostColor = config.visual.coloredGhost ? PIECE_COLORS[game.current.type] : '#9aa5b8';
          const alpha = config.visual.ghostOpacity / 100;
          for (const [dx, dy] of SHAPES[game.current.type][game.current.rot]) {
            const y = ghostY + dy;
            if (y >= VISIBLE_START) this.block(ctx, (game.current.x + dx) * CELL, (y - VISIBLE_START) * CELL, CELL, ghostColor, alpha, true);
          }
        }
      }
    }

    if (trainingTarget) {
      const targetCells = trainingTarget.target?.cells || trainingTarget.cells;
      for (const [x, y] of targetCells) {
        if (y >= VISIBLE_START) this.targetBlock(ctx, x * CELL, (y - VISIBLE_START) * CELL, CELL);
      }
    }

    if (game.current) {
      for (const [dx, dy] of SHAPES[game.current.type][game.current.rot]) {
        const y = game.current.y + dy;
        if (y >= VISIBLE_START) this.block(ctx, (game.current.x + dx) * CELL, (y - VISIBLE_START) * CELL, CELL, PIECE_COLORS[game.current.type]);
      }
    }

    this.drawFlashes();
    const finessePreviews = finesseDrill ? game.previewFinesseCases(5) : [];
    const spinPreviews = spinDrill ? game.previewSpinCases(5) : [];
    const next = game.previewTypes ? game.previewTypes(5) : game.randomizer ? game.randomizer.peek(5) : [];
    const miniSignature = finesseDrill
      ? `${finesseTarget?.id || '-'}|${finessePreviews.map((entry) => entry.id).join('|')}`
      : spinDrill
        ? `${config.training.spinStyle}|${spinCase?.id || '-'}|${spinPreviews.map((entry) => entry.id).join('|')}`
      : `${game.holdType || '-'}|${next.join('')}`;
    if (miniSignature !== this.lastMiniSignature) {
      this.lastMiniSignature = miniSignature;
      if (finesseDrill) {
        this.drawFinesseMini(this.holdCtx, this.holdCanvas, finesseTarget, 24);
        this.nextContexts.forEach((miniCtx, index) => this.drawFinesseMini(miniCtx, this.nextCanvases[index], finessePreviews[index], index === 0 ? 23 : 20));
      } else if (spinDrill) {
        if (spinGuided) {
          this.drawFinesseMini(this.holdCtx, this.holdCanvas, spinCase ? { ...spinCase, cells: spinCase.target.cells } : null, 24);
          this.nextContexts.forEach((miniCtx, index) => {
            const entry = spinPreviews[index];
            this.drawFinesseMini(miniCtx, this.nextCanvases[index], entry ? { ...entry, cells: entry.target.cells } : null, index === 0 ? 23 : 20);
          });
        } else {
          this.drawStateMini(this.holdCtx, this.holdCanvas, spinCase?.type, spinCase?.fromRot, 54);
          this.nextContexts.forEach((miniCtx, index) => this.drawMini(miniCtx, this.nextCanvases[index], spinPreviews[index]?.type, index === 0 ? 64 : 60));
        }
      } else {
        this.drawMini(this.holdCtx, this.holdCanvas, game.holdType, 60);
        this.nextContexts.forEach((miniCtx, index) => this.drawMini(miniCtx, this.nextCanvases[index], next[index], index === 0 ? 64 : 60));
      }
    }
    this.updateDanger(game);
  }
  drawMini(ctx, canvas, type, blockSize) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!type) return;
    const cells = SHAPES[type][0];
    const xs = cells.map(([x]) => x);
    const ys = cells.map(([, y]) => y);
    const minX = Math.min(...xs); const maxX = Math.max(...xs);
    const minY = Math.min(...ys); const maxY = Math.max(...ys);
    const width = (maxX - minX + 1) * blockSize;
    const height = (maxY - minY + 1) * blockSize;
    const originX = (canvas.width - width) / 2 - minX * blockSize;
    const originY = (canvas.height - height) / 2 - minY * blockSize;
    for (const [x, y] of cells) this.block(ctx, originX + x * blockSize, originY + y * blockSize, blockSize, PIECE_COLORS[type]);
  }
  drawStateMini(ctx, canvas, type, rotation = 0, blockSize = 60) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!type) return;
    const cells = SHAPES[type][rotation];
    const xs = cells.map(([x]) => x);
    const ys = cells.map(([, y]) => y);
    const minX = Math.min(...xs); const maxX = Math.max(...xs);
    const minY = Math.min(...ys); const maxY = Math.max(...ys);
    const originX = (canvas.width - (maxX - minX + 1) * blockSize) / 2 - minX * blockSize;
    const originY = (canvas.height - (maxY - minY + 1) * blockSize) / 2 - minY * blockSize;
    for (const [x, y] of cells) this.block(ctx, originX + x * blockSize, originY + y * blockSize, blockSize, PIECE_COLORS[type]);
  }
  drawFinesseMini(ctx, canvas, target, blockSize) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!target) return;
    const occupiedRows = target.board
      ? target.board.flatMap((row, y) => row.some(Boolean) ? [y] : [])
      : [];
    const topY = Math.min(...target.cells.map(([, y]) => y), ...occupiedRows, BOARD_H - 4);
    const rowsShown = Math.max(4, Math.min(11, BOARD_H - topY));
    const baseline = canvas.height - 20;
    const actualBlockSize = Math.min(blockSize, Math.floor((baseline - 8) / rowsShown));
    const boardWidth = BOARD_W * actualBlockSize;
    const originX = (canvas.width - boardWidth) / 2;
    ctx.save();
    ctx.strokeStyle = '#5d5068';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(originX, baseline + 1);
    ctx.lineTo(originX + boardWidth, baseline + 1);
    ctx.stroke();
    ctx.globalAlpha = 0.26;
    ctx.lineWidth = 1;
    for (let x = 0; x <= BOARD_W; x += 1) {
      ctx.beginPath();
      ctx.moveTo(originX + x * actualBlockSize, baseline - actualBlockSize * rowsShown);
      ctx.lineTo(originX + x * actualBlockSize, baseline);
      ctx.stroke();
    }
    ctx.restore();
    if (target.board) {
      const firstRow = BOARD_H - rowsShown;
      for (let y = firstRow; y < BOARD_H; y += 1) {
        for (let x = 0; x < BOARD_W; x += 1) {
          if (target.board[y]?.[x]) this.block(ctx, originX + x * actualBlockSize, baseline - (BOARD_H - y) * actualBlockSize, actualBlockSize, '#51475c');
        }
      }
    }
    for (const [x, y] of target.cells) {
      const rowFromFloor = BOARD_H - y;
      this.block(ctx, originX + x * actualBlockSize, baseline - rowFromFloor * actualBlockSize, actualBlockSize, PIECE_COLORS[target.type]);
    }
  }
  updateDanger(game) {
    let top = BOARD_H;
    if (game.board) {
      for (let y = VISIBLE_START; y < BOARD_H; y += 1) {
        if (game.board[y].some(Boolean)) { top = y; break; }
      }
    }
    const danger = top <= VISIBLE_START + 5;
    $('boardRig').classList.toggle('is-danger', danger);
  }
  bounce(clear = false) {
    if (config.visual.reducedMotion || config.visual.bounce <= 0) return;
    const rig = $('boardRig');
    const cls = clear ? 'is-clearing' : 'is-bouncing';
    rig.classList.remove('is-bouncing', 'is-clearing');
    void rig.offsetWidth;
    rig.style.setProperty('--bounce-strength', `${config.visual.bounce / 100}`);
    rig.classList.add(cls);
    setTimeout(() => rig.classList.remove(cls), clear ? 190 : 150);
  }
  addHardDrop(piece, fromY, toY) {
    if (!config.visual.hardDropTrail || config.visual.reducedMotion || fromY === toY) return;
    this.trails.push({ piece: deepClone(piece), fromY, toY, life: 1, maxLife: 1 });
    const count = Math.round(config.visual.particles / 100 * 8);
    const cells = SHAPES[piece.type][piece.rot];
    for (let i = 0; i < count; i += 1) {
      const [dx, dy] = cells[i % cells.length];
      const x = (piece.x + dx + 0.5) * CELL;
      const y = (toY + dy - VISIBLE_START + 0.9) * CELL;
      this.addParticle(x, y, PIECE_COLORS[piece.type], (Math.random() - 0.5) * 150, -40 - Math.random() * 130, 0.28 + Math.random() * 0.2, 5 + Math.random() * 8);
    }
  }
  addLineClear(rows, color = '#ffffff') {
    const now = performance.now();
    for (const row of rows) this.clearFlashes.push({ row, born: now, life: 260 });
    if (config.visual.reducedMotion) return;
    const count = Math.round(config.visual.particles / 100 * 34 * Math.max(1, rows.length));
    for (let i = 0; i < count; i += 1) {
      const row = rows[i % rows.length];
      const x = Math.random() * BOARD_W * CELL;
      const y = (row - VISIBLE_START + 0.5) * CELL;
      this.addParticle(x, y, color, (Math.random() - 0.5) * 350, (Math.random() - 0.7) * 260, 0.35 + Math.random() * 0.45, 4 + Math.random() * 12);
    }
  }
  addParticle(x, y, color, vx, vy, life, size) {
    this.particles.push({ x, y, color, vx, vy, life, maxLife: life, size });
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);
  }
  drawFlashes() {
    const now = performance.now();
    for (let i = this.clearFlashes.length - 1; i >= 0; i -= 1) {
      const flash = this.clearFlashes[i];
      const age = now - flash.born;
      if (age >= flash.life) {
        this.clearFlashes.splice(i, 1);
        continue;
      }
      const alpha = 1 - age / flash.life;
      const y = (flash.row - VISIBLE_START) * CELL;
      if (y < 0 || y >= VISIBLE_H * CELL) continue;
      this.ctx.save();
      this.ctx.globalAlpha = alpha * 0.65;
      const g = this.ctx.createLinearGradient(0, 0, BOARD_W * CELL, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      this.ctx.fillStyle = g;
      this.ctx.fillRect(0, y, BOARD_W * CELL, CELL);
      this.ctx.restore();
    }
  }
  drawEffects(now) {
    const dt = clamp((now - this.lastTime) / 1000, 0, 0.05);
    this.lastTime = now;
    const fx = this.fx;
    fx.clearRect(0, 0, this.fxCanvas.width, this.fxCanvas.height);
    for (let i = this.trails.length - 1; i >= 0; i -= 1) {
      const trail = this.trails[i];
      trail.life -= dt * 5.8;
      if (trail.life <= 0) { this.trails.splice(i, 1); continue; }
      const alpha = (trail.life / trail.maxLife) * 0.18;
      const color = PIECE_COLORS[trail.piece.type];
      for (const [dx, dy] of SHAPES[trail.piece.type][trail.piece.rot]) {
        const x = (trail.piece.x + dx) * CELL + CELL * 0.32;
        const y1 = (trail.fromY + dy - VISIBLE_START) * CELL;
        const y2 = (trail.toY + dy - VISIBLE_START) * CELL;
        if (y2 < 0) continue;
        const top = Math.max(0, y1);
        const bottom = Math.min(VISIBLE_H * CELL, y2 + CELL);
        const g = fx.createLinearGradient(0, top, 0, bottom);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(1, color);
        fx.save();
        fx.globalAlpha = alpha;
        fx.fillStyle = g;
        fx.fillRect(x, top, CELL * 0.36, Math.max(0, bottom - top));
        fx.restore();
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.vy += 430 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      fx.save();
      fx.globalAlpha = (p.life / p.maxLife) ** 1.6;
      fx.fillStyle = p.color;
      fx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      fx.restore();
    }
  }
}

const makeBoard = () => Array.from({ length: BOARD_H }, () => Array(BOARD_W).fill(null));

export { Renderer };
