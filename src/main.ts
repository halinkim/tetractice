import './styles.css';
import {
  $,
  ACTION_META,
  DEFAULT_CONFIG,
  GUIDELINE_BINDINGS,
  STORAGE_CONFIG,
  STORAGE_PB,
  TICK_MS,
  VERSION,
  WASD_BINDINGS,
  clamp,
  config,
  deepClone,
  deepMerge,
  personalBests,
  prettyCode,
  sanitizeConfig,
  setConfig,
  setPersonalBests,
} from './core/state';
import { AudioEngine } from './audio/audio-engine';
import { GameEngine } from './game/game-engine';
import { InputManager } from './input/input-manager';
import { Renderer } from './render/renderer';
import { uiBridge } from './ui/bridge';
import { createViewportScale } from './ui/viewport-scale';

(() => {
  'use strict';

  const viewportScale = createViewportScale($('uiRoot'), config.visual.uiScale);

  const saveConfig = () => {
    try {
      localStorage.setItem(STORAGE_CONFIG, JSON.stringify(config));
      const label = $('settingsSaveState');
      if (label) {
        label.textContent = 'SETTINGS SAVED LOCALLY';
        label.dataset.dirty = 'false';
      }
    } catch (_) {
      toast('설정을 저장하지 못했습니다.', 'danger');
    }
  };

  let saveTimer = 0;
  const scheduleSave = () => {
    const label = $('settingsSaveState');
    if (label) {
      label.textContent = 'SAVING…';
      label.dataset.dirty = 'true';
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveConfig, 120);
  };

  const toast = (message, tone = 'normal') => {
    const element = document.createElement('div');
    element.className = `toast ${tone === 'accent' ? 'is-accent' : tone === 'danger' ? 'is-danger' : ''}`;
    element.textContent = message;
    $('toastHost')?.appendChild(element);
    setTimeout(() => {
      element.style.opacity = '0';
      element.style.transform = 'translateY(5px)';
      setTimeout(() => element.remove(), 220);
    }, 2200);
  };

  const downloadJSON = (name, value) => {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const readJSONFile = (file: File): Promise<any> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
    reader.onload = () => {
      try { resolve(JSON.parse(String(reader.result))); }
      catch (_) { reject(new Error('올바른 JSON 파일이 아닙니다.')); }
    };
    reader.readAsText(file);
  });

  const input = new InputManager();
  const audio = new AudioEngine();
  const renderer = new Renderer();
  const game = new GameEngine(input, renderer, audio);

  const settingsOpen = () => !$('settingsPanel').classList.contains('is-hidden');
  let settingsWasPlaying = false;
  const openSettings = (tab = 'handling') => {
    if (settingsOpen()) return;
    settingsWasPlaying = game.state === 'playing';
    if (settingsWasPlaying) game.pause(true);
    selectSettingsTab(tab);
    $('settingsBackdrop').classList.remove('is-hidden');
    $('settingsPanel').classList.remove('is-hidden');
    syncSettingsUI();
  };
  const closeSettings = () => {
    $('settingsBackdrop').classList.add('is-hidden');
    $('settingsPanel').classList.add('is-hidden');
    input.finishCapture(null, false);
    saveConfig();
    if (settingsWasPlaying && game.state === 'paused') game.resume();
    settingsWasPlaying = false;
  };
  const selectSettingsTab = (tab) => {
    document.querySelectorAll('.settings-tab').forEach((button: any) => button.classList.toggle('is-active', button.dataset.tab === tab));
    document.querySelectorAll('.settings-section').forEach((section: any) => section.classList.toggle('is-active', section.dataset.section === tab));
  };

  const setMode = (mode) => {
    if (!['sprint', 'zen', 'custom'].includes(mode)) return;
    if (game.state !== 'idle') game.resetToIdle();
    game.mode = mode;
    config.ui.mode = mode;
    game.updateModeUI();
    scheduleSave();
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (_) {
      toast('이 브라우저에서는 전체 화면을 열 수 없습니다.', 'danger');
    }
  };

  const updateAudioButton = () => {
    $('audioButton').textContent = config.ui.audioEnabled ? '◖' : '⊘';
    $('audioButton').classList.toggle('is-muted', !config.ui.audioEnabled);
  };

  const updateHandlingHUD = () => {
    $('arrHud').textContent = `${config.handling.arr.toFixed(1)}F`;
    $('dasHud').textContent = `${config.handling.das.toFixed(1)}F`;
    $('dcdHud').textContent = `${config.handling.dcd.toFixed(1)}F`;
    $('sdfHud').textContent = config.handling.sdfMax ? 'MAX' : `${config.handling.sdf}×`;
  };

  const updateControlHints = () => {
    const first = (action) => prettyCode(config.controls.bindings[action].find(Boolean) || '');
    $('hintLeft').textContent = first('moveLeft');
    $('hintRight').textContent = first('moveRight');
    $('hintCcw').textContent = first('rotateCCW');
    $('hintCw').textContent = first('rotateCW');
    $('hintHold').textContent = first('hold');
    $('hintHard').textContent = first('hardDrop');
    $('hintRestart').textContent = first('retry');
    $('hintPause').textContent = first('pause');
  };

  const applyVisualConfig = () => {
    $('boardRig').parentElement.style.setProperty('--board-scale', String(config.visual.boardZoom / 100));
    viewportScale.setPreference(config.visual.uiScale);
    document.body.classList.toggle('reduced-motion', config.visual.reducedMotion);
    updateAudioButton();
  };

  const renderBindings = () => {
    const host = $('bindingsList');
    host.innerHTML = '';
    for (const [action, label] of ACTION_META) {
      const row = document.createElement('div');
      row.className = 'binding-row';
      const title = document.createElement('span');
      title.textContent = label;
      row.appendChild(title);
      config.controls.bindings[action].forEach((code, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'binding-slot';
        button.textContent = prettyCode(code);
        button.title = code || '비어 있음';
        button.addEventListener('click', () => input.startCapture(action, index));
        row.appendChild(button);
      });
      host.appendChild(row);
    }
    $('guidelinePresetButton').classList.toggle('is-active', config.controls.preset === 'guideline');
    $('wasdPresetButton').classList.toggle('is-active', config.controls.preset === 'wasd');
  };

  const bindNumberRange = ({ range, number, output, get, set, format, min, max }) => {
    const r = $(range); const n = number ? $(number) : null; const o = $(output);
    const update = (raw) => {
      const value = clamp(Number(raw), min, max);
      set(value);
      r.value = String(value);
      if (n) n.value = String(value);
      o.textContent = format(value);
      updateHandlingHUD();
      applyVisualConfig();
      scheduleSave();
    };
    r.addEventListener('input', () => update(r.value));
    if (n) n.addEventListener('change', () => update(n.value));
    return () => {
      const value = get();
      r.value = String(value);
      if (n) n.value = String(value);
      o.textContent = format(value);
    };
  };

  const rangeSyncers = [
    bindNumberRange({ range: 'arrRange', number: 'arrNumber', output: 'arrOutput', get: () => config.handling.arr, set: (v) => { config.handling.arr = Math.round(v * 10) / 10; }, format: (v) => `${v.toFixed(1)}F`, min: 0, max: 20 }),
    bindNumberRange({ range: 'dasRange', number: 'dasNumber', output: 'dasOutput', get: () => config.handling.das, set: (v) => { config.handling.das = Math.round(v * 10) / 10; }, format: (v) => `${v.toFixed(1)}F`, min: 1, max: 60 }),
    bindNumberRange({ range: 'dcdRange', number: 'dcdNumber', output: 'dcdOutput', get: () => config.handling.dcd, set: (v) => { config.handling.dcd = Math.round(v * 10) / 10; }, format: (v) => `${v.toFixed(1)}F`, min: 0, max: 60 }),
    bindNumberRange({ range: 'gravityRange', number: 'gravityNumber', output: 'gravityOutput', get: () => config.gameplay.gravity, set: (v) => { config.gameplay.gravity = Math.round(v * 1000) / 1000; }, format: (v) => `${v.toFixed(3)}G`, min: 0, max: 20 }),
    bindNumberRange({ range: 'lockDelayRange', number: 'lockDelayNumber', output: 'lockDelayOutput', get: () => config.gameplay.lockDelay, set: (v) => { config.gameplay.lockDelay = Math.round(v); }, format: (v) => `${Math.round(v)}F`, min: 1, max: 600 }),
    bindNumberRange({ range: 'lockResetRange', number: 'lockResetNumber', output: 'lockResetOutput', get: () => config.gameplay.lockResets, set: (v) => { config.gameplay.lockResets = Math.round(v); }, format: (v) => String(Math.round(v)), min: 0, max: 99 }),
    bindNumberRange({ range: 'areRange', number: 'areNumber', output: 'areOutput', get: () => config.gameplay.are, set: (v) => { config.gameplay.are = Math.round(v); }, format: (v) => `${Math.round(v)}F`, min: 0, max: 600 }),
    bindNumberRange({ range: 'lineAreRange', number: 'lineAreNumber', output: 'lineAreOutput', get: () => config.gameplay.lineAre, set: (v) => { config.gameplay.lineAre = Math.round(v); }, format: (v) => `${Math.round(v)}F`, min: 0, max: 600 }),
    bindNumberRange({ range: 'customLinesRange', number: 'customLinesNumber', output: 'customLinesOutput', get: () => config.gameplay.customLines, set: (v) => { config.gameplay.customLines = Math.round(v); }, format: (v) => Math.round(v) === 0 ? '∞' : String(Math.round(v)), min: 0, max: 9999 }),
    bindNumberRange({ range: 'boardZoomRange', number: 'boardZoomNumber', output: 'boardZoomOutput', get: () => config.visual.boardZoom, set: (v) => { config.visual.boardZoom = Math.round(v); }, format: (v) => `${Math.round(v)}%`, min: 60, max: 140 }),
    bindNumberRange({ range: 'gridOpacityRange', number: 'gridOpacityNumber', output: 'gridOpacityOutput', get: () => config.visual.gridOpacity, set: (v) => { config.visual.gridOpacity = Math.round(v); }, format: (v) => `${Math.round(v)}%`, min: 0, max: 100 }),
    bindNumberRange({ range: 'ghostOpacityRange', number: 'ghostOpacityNumber', output: 'ghostOpacityOutput', get: () => config.visual.ghostOpacity, set: (v) => { config.visual.ghostOpacity = Math.round(v); }, format: (v) => `${Math.round(v)}%`, min: 0, max: 100 }),
    bindNumberRange({ range: 'bounceRange', number: 'bounceNumber', output: 'bounceOutput', get: () => config.visual.bounce, set: (v) => { config.visual.bounce = Math.round(v); }, format: (v) => `${Math.round(v)}%`, min: 0, max: 100 }),
    bindNumberRange({ range: 'particlesRange', number: 'particlesNumber', output: 'particlesOutput', get: () => config.visual.particles, set: (v) => { config.visual.particles = Math.round(v); }, format: (v) => `${Math.round(v)}%`, min: 0, max: 100 }),
    bindNumberRange({ range: 'volumeRange', number: 'volumeNumber', output: 'volumeOutput', get: () => config.visual.volume, set: (v) => { config.visual.volume = Math.round(v); }, format: (v) => `${Math.round(v)}%`, min: 0, max: 100 }),
  ];

  const toggleMap = {
    hardDropSafetyToggle: ['handling', 'hardDropSafety'],
    cancelDasToggle: ['handling', 'cancelDas'],
    softDropPriorityToggle: ['handling', 'softDropPriority'],
    ghostToggle: ['gameplay', 'ghost'],
    holdEnabledToggle: ['gameplay', 'holdEnabled'],
    allow180Toggle: ['gameplay', 'allow180'],
    coloredGhostToggle: ['visual', 'coloredGhost'],
    hardDropTrailToggle: ['visual', 'hardDropTrail'],
    reducedMotionToggle: ['visual', 'reducedMotion'],
  };
  for (const [id, [section, key]] of Object.entries(toggleMap)) {
    $(id).addEventListener('change', () => {
      config[section][key] = $(id).checked;
      applyVisualConfig();
      scheduleSave();
    });
  }

  const selectMap = {
    irsSelect: ['handling', 'irs'],
    ihsSelect: ['handling', 'ihs'],
    randomizerSelect: ['gameplay', 'randomizer'],
    rotationSelect: ['gameplay', 'rotation'],
    uiScaleSelect: ['visual', 'uiScale'],
  };
  for (const [id, [section, key]] of Object.entries(selectMap)) {
    $(id).addEventListener('change', () => {
      config[section][key] = $(id).value;
      if (id === 'uiScaleSelect') applyVisualConfig();
      scheduleSave();
    });
  }

  $('sdfRange').addEventListener('input', () => {
    const value = Number($('sdfRange').value);
    config.handling.sdfMax = value >= 41;
    config.handling.sdf = config.handling.sdfMax ? 40 : value;
    $('sdfOutput').textContent = config.handling.sdfMax ? 'MAX' : `${config.handling.sdf}×`;
    updateHandlingHUD();
    scheduleSave();
  });
  $('sdfMaxButton').addEventListener('click', () => {
    config.handling.sdfMax = !config.handling.sdfMax;
    $('sdfRange').value = config.handling.sdfMax ? '41' : String(config.handling.sdf);
    $('sdfOutput').textContent = config.handling.sdfMax ? 'MAX' : `${config.handling.sdf}×`;
    updateHandlingHUD();
    scheduleSave();
  });
  $('gamepadSensitivityRange').addEventListener('input', () => {
    config.controls.gamepadSensitivity = Number($('gamepadSensitivityRange').value);
    $('gamepadSensitivityOutput').textContent = `${config.controls.gamepadSensitivity}%`;
    scheduleSave();
  });

  const syncSettingsUI = () => {
    rangeSyncers.forEach((sync) => sync());
    for (const [id, [section, key]] of Object.entries(toggleMap)) $(id).checked = Boolean(config[section][key]);
    for (const [id, [section, key]] of Object.entries(selectMap)) $(id).value = config[section][key];
    $('sdfRange').value = config.handling.sdfMax ? '41' : String(config.handling.sdf);
    $('sdfOutput').textContent = config.handling.sdfMax ? 'MAX' : `${config.handling.sdf}×`;
    $('gamepadSensitivityRange').value = String(config.controls.gamepadSensitivity);
    $('gamepadSensitivityOutput').textContent = `${config.controls.gamepadSensitivity}%`;
    $('proModeToggle').checked = config.ui.proMode;
    $('finesseAlertToggle').checked = config.ui.finesseAlert;
    $('finesseRetryToggle').checked = config.ui.retryOnFinesse;
    $('strideModeToggle').checked = config.ui.strideMode;
    renderBindings();
    updateHandlingHUD();
    updateControlHints();
    applyVisualConfig();
  };

  const resetSection = (section) => {
    config[section] = deepClone(DEFAULT_CONFIG[section]);
    if (section === 'controls') input.rebuildBindings();
    syncSettingsUI();
    scheduleSave();
    toast(`${section.toUpperCase()} 기본값을 복원했습니다.`);
  };

  $('resetHandlingButton').addEventListener('click', () => resetSection('handling'));
  $('resetControlsButton').addEventListener('click', () => resetSection('controls'));
  $('resetGameplayButton').addEventListener('click', () => resetSection('gameplay'));
  $('resetVisualButton').addEventListener('click', () => resetSection('visual'));

  const applyPreset = (name) => {
    config.controls.preset = name;
    config.controls.bindings = deepClone(name === 'wasd' ? WASD_BINDINGS : GUIDELINE_BINDINGS);
    input.rebuildBindings();
    renderBindings();
    updateControlHints();
    scheduleSave();
    toast(`${name.toUpperCase()} 키 프리셋을 적용했습니다.`, 'accent');
  };
  $('guidelinePresetButton').addEventListener('click', () => applyPreset('guideline'));
  $('wasdPresetButton').addEventListener('click', () => applyPreset('wasd'));

  $('proModeToggle').addEventListener('change', () => {
    config.ui.proMode = $('proModeToggle').checked;
    document.body.classList.toggle('pro-disabled', !config.ui.proMode);
    scheduleSave();
  });
  $('finesseAlertToggle').addEventListener('change', () => { config.ui.finesseAlert = $('finesseAlertToggle').checked; scheduleSave(); });
  $('finesseRetryToggle').addEventListener('change', () => { config.ui.retryOnFinesse = $('finesseRetryToggle').checked; scheduleSave(); });
  $('strideModeToggle').addEventListener('change', () => { config.ui.strideMode = $('strideModeToggle').checked; scheduleSave(); });

  Object.assign(uiBridge, {
    closeSettings,
    ensureAudio: () => audio.ensure(),
    openSettings,
    renderBindings,
    scheduleSave,
    settingsOpen,
    toast,
    toggleFullscreen,
    updateControlHints,
  });

  document.querySelectorAll('.mode-tab').forEach((button: any) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  document.querySelectorAll('.settings-tab').forEach((button: any) => button.addEventListener('click', () => selectSettingsTab(button.dataset.tab)));
  $('configButton').addEventListener('click', () => openSettings('handling'));
  $('handlingEditButton').addEventListener('click', () => openSettings('handling'));
  $('closeSettingsButton').addEventListener('click', closeSettings);
  $('doneSettingsButton').addEventListener('click', closeSettings);
  $('settingsBackdrop').addEventListener('click', closeSettings);
  $('startButton').addEventListener('click', () => game.start());
  $('pauseButton').addEventListener('click', () => game.pause(false));
  $('resumeButton').addEventListener('click', () => game.resume());
  $('pauseRestartButton').addEventListener('click', () => game.start());
  $('retryButton').addEventListener('click', () => game.start());
  $('resultSameSeedButton').addEventListener('click', () => game.start({ sameSeed: true }));
  $('sameSeedRestartButton').addEventListener('click', () => game.start({ sameSeed: true }));
  $('footerRestartButton').addEventListener('click', () => game.start());
  $('brandButton').addEventListener('click', () => game.resetToIdle());
  $('fullscreenButton').addEventListener('click', toggleFullscreen);
  $('audioButton').addEventListener('click', () => {
    config.ui.audioEnabled = !config.ui.audioEnabled;
    updateAudioButton();
    if (config.ui.audioEnabled) audio.ensure();
    scheduleSave();
  });
  $('handlingTestButton').addEventListener('click', () => {
    closeSettings();
    game.mode = 'zen';
    game.start({ handlingTest: true, skipCountdown: true });
  });

  $('exportSettingsButton').addEventListener('click', () => downloadJSON(`stacklab-settings-${new Date().toISOString().slice(0, 10)}.json`, {
    format: 'stacklab-settings', version: VERSION, config,
  }));
  $('importSettingsButton').addEventListener('click', () => $('importSettingsInput').click());
  $('importSettingsInput').addEventListener('change', async () => {
    const file = $('importSettingsInput').files?.[0];
    if (!file) return;
    try {
      const data = await readJSONFile(file);
      if (data.format !== 'stacklab-settings' || !data.config) throw new Error('STACK//LAB 설정 파일이 아닙니다.');
      setConfig(sanitizeConfig(data.config));
      input.rebuildBindings();
      syncSettingsUI();
      game.mode = config.ui.mode;
      game.updateModeUI();
      saveConfig();
      toast('설정을 가져왔습니다.', 'accent');
    } catch (error) {
      toast(error.message, 'danger');
    }
    $('importSettingsInput').value = '';
  });
  $('exportReplayButton').addEventListener('click', () => {
    if (!game.lastReplay) { toast('내보낼 완료 리플레이가 없습니다.', 'danger'); return; }
    downloadJSON(`stacklab-replay-${game.seed.toString(16).padStart(8, '0')}.json`, game.lastReplay);
  });
  $('importReplayButton').addEventListener('click', () => $('importReplayInput').click());
  $('importReplayInput').addEventListener('change', async () => {
    const file = $('importReplayInput').files?.[0];
    if (!file) return;
    try {
      const replay = await readJSONFile(file);
      if (replay.format !== 'stacklab-replay' || !Array.isArray(replay.events) || !Number.isFinite(replay.seed)) throw new Error('STACK//LAB 리플레이 파일이 아닙니다.');
      setConfig(sanitizeConfig(deepMerge(config, replay.config || {})));
      input.rebuildBindings();
      syncSettingsUI();
      closeSettings();
      game.start({ seed: replay.seed, mode: replay.mode || 'sprint', replay });
      toast('리플레이를 재생합니다.', 'accent');
    } catch (error) {
      toast(error.message, 'danger');
    }
    $('importReplayInput').value = '';
  });
  $('resetAllDataButton').addEventListener('click', () => {
    setConfig(deepClone(DEFAULT_CONFIG));
    setPersonalBests({ sprint: null });
    try { localStorage.removeItem(STORAGE_CONFIG); localStorage.removeItem(STORAGE_PB); } catch (_) {}
    input.rebuildBindings();
    syncSettingsUI();
    game.mode = config.ui.mode;
    game.updateModeUI();
    toast('모든 로컬 데이터를 초기화했습니다.', 'danger');
  });

  $('buildLabel').textContent = `BUILD ${VERSION}`;
  document.body.classList.toggle('pro-disabled', !config.ui.proMode);
  syncSettingsUI();
  game.updateModeUI();
  game.updateHUD();

  let accumulator = 0;
  let previous = performance.now();
  let fpsWindowStart = previous;
  let renderedFrames = 0;
  let fixedFrame = 0;

  const loop = (now) => {
    input.pollGamepads();
    const delta = clamp(now - previous, 0, 100);
    previous = now;
    accumulator += delta;
    let steps = 0;
    while (accumulator >= TICK_MS && steps < 8) {
      game.fixedUpdate();
      accumulator -= TICK_MS;
      fixedFrame += 1;
      steps += 1;
    }
    if (steps === 8) accumulator = 0;
    renderer.draw(game);
    renderer.drawEffects(now);
    renderedFrames += 1;
    if (now - fpsWindowStart >= 500) {
      const fps = Math.round(renderedFrames * 1000 / (now - fpsWindowStart));
      $('fpsValue').textContent = String(fps);
      $('performanceBadge').classList.toggle('is-low', fps < 50);
      fpsWindowStart = now;
      renderedFrames = 0;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();
