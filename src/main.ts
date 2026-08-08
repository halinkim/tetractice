import './styles.css';
import {
  $,
  ACTION_META,
  DEFAULT_CONFIG,
  GUIDELINE_BINDINGS,
  PIECES,
  STORAGE_CONFIG,
  STORAGE_FINESSE,
  STORAGE_SPIN,
  STORAGE_BUILD,
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
    if (!['sprint', 'finesse', 'spin', 'build', 'zen', 'custom'].includes(mode)) return;
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
    $('audioButton').setAttribute('aria-pressed', String(config.ui.audioEnabled));
    $('audioButton').classList.toggle('is-muted', !config.ui.audioEnabled);
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
    scheduleSave();
  });
  $('sdfMaxButton').addEventListener('click', () => {
    config.handling.sdfMax = !config.handling.sdfMax;
    $('sdfRange').value = config.handling.sdfMax ? '41' : String(config.handling.sdf);
    $('sdfOutput').textContent = config.handling.sdfMax ? 'MAX' : `${config.handling.sdf}×`;
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
  document.querySelectorAll('#finesseTypePicker [data-finesse-type]').forEach((button: any) => button.addEventListener('click', () => {
    config.training.finesseType = button.dataset.finesseType;
    game.updateModeUI();
    scheduleSave();
  }));
  const updateFinessePresetFromFilters = () => {
    const allSelected = config.training.finessePieces.length === PIECES.length
      && config.training.finesseRotations.length === 4
      && config.training.finesseColumns.length === 10;
    config.training.finessePreset = allSelected ? 'all' : 'custom';
  };
  $('finesseAllButton').addEventListener('click', () => {
    config.training.finessePreset = 'all';
    config.training.finessePieces = [...PIECES];
    config.training.finesseRotations = [0, 1, 2, 3];
    config.training.finesseColumns = Array.from({ length: 10 }, (_, index) => index);
    game.updateFinesseSetup();
    scheduleSave();
  });
  $('finesseWeakButton').addEventListener('click', () => {
    config.training.finessePreset = 'weak';
    game.updateFinesseSetup();
    scheduleSave();
  });
  document.querySelectorAll('#finessePiecePicker [data-piece]').forEach((button: any) => button.addEventListener('click', () => {
    const selected = new Set(config.training.finessePieces);
    if (selected.has(button.dataset.piece)) {
      if (selected.size <= 1) return;
      selected.delete(button.dataset.piece);
    } else selected.add(button.dataset.piece);
    config.training.finessePieces = PIECES.filter((piece) => selected.has(piece));
    updateFinessePresetFromFilters();
    game.updateFinesseSetup();
    scheduleSave();
  }));
  const bindFinesseNumberFilter = (selector, key, dataKey, allowedValues) => {
    document.querySelectorAll(selector).forEach((button: any) => button.addEventListener('click', () => {
      const value = Number(button.dataset[dataKey]);
      const selected = new Set(config.training[key]);
      if (selected.has(value)) {
        if (selected.size <= 1) return;
        selected.delete(value);
      } else selected.add(value);
      config.training[key] = allowedValues.filter((candidate) => selected.has(candidate));
      updateFinessePresetFromFilters();
      game.updateFinesseSetup();
      scheduleSave();
    }));
  };
  bindFinesseNumberFilter('#finesseRotationPicker [data-rotation]', 'finesseRotations', 'rotation', [0, 1, 2, 3]);
  bindFinesseNumberFilter('#finesseColumnPicker [data-column]', 'finesseColumns', 'column', Array.from({ length: 10 }, (_, index) => index));
  document.querySelectorAll('#spinStylePicker [data-spin-style]').forEach((button: any) => button.addEventListener('click', () => {
    config.training.spinStyle = button.dataset.spinStyle;
    game.updateSpinSetup();
    scheduleSave();
  }));
  document.querySelectorAll('#spinValidationPicker [data-spin-validation]').forEach((button: any) => button.addEventListener('click', () => {
    config.training.spinValidation = button.dataset.spinValidation;
    game.updateSpinSetup();
    scheduleSave();
  }));
  document.querySelectorAll('#spinPresetPicker [data-spin-preset]').forEach((button: any) => button.addEventListener('click', () => {
    const preset = button.dataset.spinPreset;
    config.training.spinPreset = preset;
    if (preset === 'basics') config.training.spinPieces = ['T', 'S', 'Z'];
    else if (preset === 'all') config.training.spinPieces = ['T', 'S', 'Z', 'L', 'J', 'I'];
    else if (preset === 'weak') config.training.spinPieces = ['T', 'S', 'Z', 'L', 'J', 'I'];
    game.updateSpinSetup();
    scheduleSave();
  }));
  document.querySelectorAll('#spinPiecePicker [data-spin-piece]').forEach((button: any) => button.addEventListener('click', () => {
    const order = ['T', 'S', 'Z', 'L', 'J', 'I'];
    const selected = new Set(config.training.spinPieces);
    if (selected.has(button.dataset.spinPiece)) {
      if (selected.size <= 1) return;
      selected.delete(button.dataset.spinPiece);
    } else selected.add(button.dataset.spinPiece);
    config.training.spinPieces = order.filter((piece) => selected.has(piece));
    game.updateSpinSetup();
    scheduleSave();
  }));
  document.querySelectorAll('#buildDifficultyPicker [data-build-difficulty]').forEach((button: any) => button.addEventListener('click', () => {
    config.training.buildDifficulty = button.dataset.buildDifficulty;
    game.updateBuildSetup();
    scheduleSave();
  }));
  document.querySelectorAll('#buildPhasePicker [data-build-phase]').forEach((button: any) => button.addEventListener('click', () => {
    config.training.buildPhase = button.dataset.buildPhase;
    game.updateBuildSetup();
    scheduleSave();
  }));
  $('buildVariantPicker').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('[data-build-variant]') as HTMLElement | null;
    if (!button) return;
    config.training.buildVariant = button.dataset.buildVariant;
    game.updateBuildSetup();
    scheduleSave();
  });
  document.querySelectorAll('#buildRetryPicker [data-build-retry]').forEach((button: any) => button.addEventListener('click', () => {
    config.training.buildRetry = button.dataset.buildRetry;
    game.updateBuildSetup();
    scheduleSave();
  }));
  $('spinGuideButton').addEventListener('click', () => game.openSpinGuide());
  $('closeSpinGuideButton').addEventListener('click', () => game.closeSpinGuide());
  document.querySelectorAll('#spinGuideTabs [data-spin-guide]').forEach((button: any) => button.addEventListener('click', () => {
    game.renderSpinGuide(button.dataset.spinGuide);
  }));
  const selectSpinGuideCase = (event) => {
    const button = (event.target as HTMLElement).closest('[data-spin-case-id]') as HTMLElement | null;
    if (button) game.renderSpinGuideCase(button.dataset.spinCaseId);
  };
  $('spinGuideCaseTabs').addEventListener('click', selectSpinGuideCase);
  $('spinGuideStateRows').addEventListener('click', selectSpinGuideCase);
  $('practiceSpinGuideButton').addEventListener('click', () => game.practiceCurrentSpinGuide());
  $('masteryMapButton').addEventListener('click', () => game.openMasteryMap());
  $('closeMasteryButton').addEventListener('click', () => game.closeMasteryMap());
  document.querySelectorAll('#masteryPieceTabs [data-mastery-piece]').forEach((button: any) => button.addEventListener('click', () => {
    game.renderMasteryMap(button.dataset.masteryPiece);
  }));
  $('masteryCaseGrid').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('[data-case-id]') as HTMLElement | null;
    if (button) game.showMasteryCase(button.dataset.caseId);
  });
  window.addEventListener('keydown', (event) => {
    const activeOverlay = !$('spinGuideOverlay').classList.contains('is-hidden') ? $('spinGuideOverlay')
      : !$('masteryOverlay').classList.contains('is-hidden') ? $('masteryOverlay') : null;
    if (!activeOverlay && event.code === 'Escape' && game.state === 'over') {
      event.preventDefault();
      event.stopImmediatePropagation();
      game.resetToIdle();
      $('startButton').focus();
      return;
    }
    if (!activeOverlay) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (activeOverlay.id === 'spinGuideOverlay') game.closeSpinGuide();
      else game.closeMasteryMap();
      return;
    }
    if (event.code === 'Tab') {
      const focusable = [...activeOverlay.querySelectorAll('button:not(:disabled)')] as HTMLElement[];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }, true);
  document.querySelectorAll('.settings-tab').forEach((button: any) => button.addEventListener('click', () => selectSettingsTab(button.dataset.tab)));
  $('configButton').addEventListener('click', () => openSettings('handling'));
  $('closeSettingsButton').addEventListener('click', closeSettings);
  $('doneSettingsButton').addEventListener('click', closeSettings);
  $('settingsBackdrop').addEventListener('click', closeSettings);
  $('startButton').addEventListener('click', () => game.start());
  $('pauseButton').addEventListener('click', () => game.pause(false));
  $('resumeButton').addEventListener('click', () => game.resume());
  $('pauseRestartButton').addEventListener('click', () => game.restartAttempt());
  $('retryButton').addEventListener('click', () => game.restartAttempt());
  $('resultSameSeedButton').addEventListener('click', () => game.restartSameSeed());
  $('sameSeedRestartButton').addEventListener('click', () => game.restartSameSeed());
  $('footerRestartButton').addEventListener('click', () => game.restartAttempt());
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
    try { localStorage.removeItem(STORAGE_CONFIG); localStorage.removeItem(STORAGE_PB); localStorage.removeItem(STORAGE_FINESSE); localStorage.removeItem(STORAGE_SPIN); localStorage.removeItem(STORAGE_BUILD); } catch (_) {}
    game.resetFinesseProgress();
    game.resetSpinProgress();
    game.resetBuildProgress();
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
  let simulationTime = previous;

  const loop = (now) => {
    input.pollGamepads();
    const rawDelta = now - previous;
    const delta = clamp(rawDelta, 0, 100);
    previous = now;
    if (rawDelta > 100) simulationTime = now - accumulator - delta;
    accumulator += delta;
    let steps = 0;
    while (accumulator >= TICK_MS && steps < 8) {
      const tickStart = simulationTime;
      simulationTime += TICK_MS;
      game.fixedUpdate(tickStart, simulationTime);
      accumulator -= TICK_MS;
      steps += 1;
    }
    if (steps === 8) {
      accumulator = 0;
      simulationTime = now;
    }
    renderer.draw(game);
    renderer.drawEffects(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();
