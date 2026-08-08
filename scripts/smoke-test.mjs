import assert from 'node:assert/strict';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright-core';

const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:5173/';
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

let executablePath;
for (const candidate of candidates) {
  try {
    await access(candidate);
    executablePath = candidate;
    break;
  } catch {
    // 다음 설치 경로를 확인합니다.
  }
}

assert(executablePath, 'Chrome 또는 Edge 실행 파일을 찾지 못했습니다.');

const browser = await chromium.launch({ executablePath, headless: true });
const browserErrors = [];
const spinInputKeys = {
  left: 'ArrowLeft',
  right: 'ArrowRight',
  rotateCW: 'ArrowUp',
  rotateCCW: 'KeyZ',
  rotate180: 'KeyA',
  softDrop: 'ArrowDown',
  hardDrop: 'Space',
};
const playSpinPracticeRoute = async (page) => {
  const timeline = JSON.parse(await page.locator('#spinCoach').getAttribute('data-practice-timeline'));
  for (const step of timeline) {
    if (step.token === 'hardDrop') {
      await page.keyboard.press(spinInputKeys[step.token]);
      break;
    }
    if (step.token === 'softDrop') await page.keyboard.down(spinInputKeys[step.token]);
    else await page.keyboard.press(spinInputKeys[step.token]);
    await page.waitForFunction(
      ({ resultX, resultY, resultRot }) => {
        const coach = document.querySelector('#spinCoach');
        return Number(coach?.getAttribute('data-current-x')) === resultX
          && Number(coach?.getAttribute('data-current-y')) === resultY
          && coach?.getAttribute('data-current-state') === ['0', 'R', '2', 'L'][resultRot];
      },
      step,
      { timeout: 2_000 },
    );
    if (step.token === 'softDrop') await page.keyboard.up(spinInputKeys[step.token]);
  }
};

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  desktop.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });
  desktop.on('pageerror', (error) => browserErrors.push(`page: ${error.message}`));

  await desktop.goto(baseUrl, { waitUntil: 'networkidle' });
  assert.equal(await desktop.title(), 'STACK LAB — 스태커 연습 게임');
  assert(await desktop.locator('#startButton').isVisible(), '시작 버튼이 보여야 합니다.');
  assert.equal(await desktop.locator('#finesseValue').textContent(), '100% · 0F', '일반 게임 HUD에 FINESSE가 표시되어야 합니다.');
  assert.equal(
    await desktop.locator('#uiRoot').getAttribute('data-ui-scale'),
    '1.000',
    '일반 데스크톱에서는 기존 배율을 유지해야 합니다.',
  );

  await desktop.locator('#startButton').click();
  await desktop.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('data-state') === 'playing',
    undefined,
    { timeout: 6_000 },
  );

  const clockAudit = await desktop.evaluate(async () => {
    const parseTimer = (value) => {
      const [minutes, rest] = value.split(':');
      const [seconds, millis] = rest.split('.');
      return Number(minutes) * 60_000 + Number(seconds) * 1_000 + Number(millis);
    };
    const startWall = performance.now();
    const startGame = parseTimer(document.querySelector('#elapsedTime').textContent);
    const frameTimes = [];
    let previousFrame = startWall;
    await new Promise((resolve) => {
      const sample = (now) => {
        frameTimes.push(now - previousFrame);
        previousFrame = now;
        if (frameTimes.length >= 120) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const wallElapsed = performance.now() - startWall;
    const gameElapsed = parseTimer(document.querySelector('#elapsedTime').textContent) - startGame;
    frameTimes.sort((a, b) => a - b);
    return {
      drift: Math.abs(gameElapsed - wallElapsed),
      p95FrameTime: frameTimes[Math.floor(frameTimes.length * .95)],
    };
  });
  assert(clockAudit.drift < 50, `게임 타이머와 실제 시간의 오차가 너무 큽니다: ${clockAudit.drift.toFixed(1)}ms`);
  assert(clockAudit.p95FrameTime < 50, `렌더링이 20 FPS 아래로 떨어집니다: ${clockAudit.p95FrameTime.toFixed(1)}ms`);

  await desktop.keyboard.press('ArrowLeft');
  await desktop.keyboard.press('KeyZ');
  await desktop.keyboard.press('Space');
  await desktop.waitForFunction(
    () => Number(document.querySelector('#piecesValue')?.textContent) >= 1,
    undefined,
    { timeout: 2_000 },
  );
  assert(
    Number(await desktop.locator('#ppsValue').textContent()) > 0,
    'PPS가 첫 조각 배치 후 좌측 RUN 카드에 표시되어야 합니다.',
  );

  await desktop.locator('#configButton').click();
  assert(await desktop.locator('#settingsPanel').isVisible(), '설정 패널이 열려야 합니다.');
  await desktop.keyboard.press('Escape');
  await desktop.locator('#settingsPanel').waitFor({ state: 'hidden' });

  if (process.env.SMOKE_DESKTOP_SCREENSHOT) {
    const screenshotPath = path.resolve(process.env.SMOKE_DESKTOP_SCREENSHOT);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await desktop.screenshot({ path: screenshotPath });
  }

  const seedBeforeRetry = await desktop.locator('#seedValue').textContent();
  await desktop.keyboard.down('KeyR');
  await desktop.waitForTimeout(650);
  await desktop.keyboard.up('KeyR');
  await desktop.waitForFunction(
    (previousSeed) => document.querySelector('#seedValue')?.textContent !== previousSeed,
    seedBeforeRetry,
    { timeout: 2_000 },
  );
  assert.notEqual(
    await desktop.locator('#seedValue').textContent(),
    seedBeforeRetry,
    'R 재시작은 새로운 시드를 생성해야 합니다.',
  );

  const fourK = await browser.newPage({ viewport: { width: 3840, height: 2160 } });
  fourK.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`4k console: ${message.text()}`);
  });
  fourK.on('pageerror', (error) => browserErrors.push(`4k page: ${error.message}`));
  await fourK.goto(baseUrl, { waitUntil: 'networkidle' });

  const fourKFrameAudit = await fourK.evaluate(async () => {
    const frameTimes = [];
    let previous = performance.now();
    await new Promise((resolve) => {
      const sample = (now) => {
        frameTimes.push(now - previous);
        previous = now;
        if (frameTimes.length >= 120) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    frameTimes.sort((a, b) => a - b);
    return {
      median: frameTimes[Math.floor(frameTimes.length * 0.5)],
      p95: frameTimes[Math.floor(frameTimes.length * 0.95)],
    };
  });
  assert(fourKFrameAudit.p95 < 50, `4K 렌더링이 20 FPS 아래로 떨어집니다: ${fourKFrameAudit.p95.toFixed(1)}ms`);

  const fourKLayout = await fourK.evaluate(() => {
    const rect = (selector) => {
      const bounds = document.querySelector(selector)?.getBoundingClientRect();
      return bounds ? { width: bounds.width, height: bounds.height } : null;
    };
    return {
      board: rect('#boardRig'),
      rootScale: document.querySelector('#uiRoot')?.getAttribute('data-ui-scale'),
      topbar: rect('.topbar'),
    };
  });
  assert.equal(fourKLayout.rootScale, '2.000', '4K에서 UI 배율은 200%여야 합니다.');
  assert.equal(fourKLayout.board?.width, 700, '4K에서 보드는 700px 너비여야 합니다.');
  assert.equal(fourKLayout.board?.height, 1400, '4K에서 보드는 1400px 높이여야 합니다.');
  assert.equal(fourKLayout.topbar?.height, 128, '4K에서 상단바도 같은 비율로 확대되어야 합니다.');

  const miniCanvasLayout = await fourK.evaluate(() => {
    const describe = (selector) => {
      const canvas = document.querySelector(selector);
      const bounds = canvas?.getBoundingClientRect();
      const style = canvas ? getComputedStyle(canvas) : null;
      if (!(canvas instanceof HTMLCanvasElement) || !bounds || !style) return null;

      const boxRatio = bounds.width / bounds.height;
      const bitmapRatio = canvas.width / canvas.height;
      const fittedByHeight = boxRatio > bitmapRatio;
      const contentWidth = fittedByHeight ? bounds.height * bitmapRatio : bounds.width;
      const contentHeight = fittedByHeight ? bounds.height : bounds.width / bitmapRatio;

      return {
        objectFit: style.objectFit,
        horizontalScale: contentWidth / canvas.width,
        verticalScale: contentHeight / canvas.height,
      };
    };

    return {
      hold: describe('#holdCanvas'),
      nextFirst: describe('.next-canvas.is-first'),
      nextRest: describe('.next-canvas:not(.is-first)'),
    };
  });
  for (const [name, canvas] of Object.entries(miniCanvasLayout)) {
    assert.equal(canvas?.objectFit, 'contain', `${name} canvas must preserve its bitmap ratio`);
    assert(Math.abs(canvas.horizontalScale - canvas.verticalScale) < 0.001, `${name} minos must use a uniform scale`);
  }

  await fourK.locator('#configButton').click();
  const settingsBounds = await fourK.locator('#settingsPanel').boundingBox();
  assert.equal(settingsBounds?.width, 1440, '4K 설정 패널도 200%로 확대되어야 합니다.');
  await fourK.locator('.settings-tab[data-tab="visual"]').click();
  assert.equal(await fourK.locator('#uiScaleSelect').inputValue(), 'auto');
  await fourK.locator('#uiScaleSelect').selectOption('150');
  await fourK.waitForFunction(
    () => document.querySelector('#uiRoot')?.getAttribute('data-ui-scale') === '1.500',
  );
  assert.equal(
    (await fourK.locator('#boardRig').boundingBox())?.width,
    525,
    '수동 150% 배율이 전체 게임 UI에 적용되어야 합니다.',
  );
  await fourK.locator('#uiScaleSelect').selectOption('auto');
  await fourK.waitForFunction(
    () => document.querySelector('#uiRoot')?.getAttribute('data-ui-scale') === '2.000',
  );
  await fourK.keyboard.press('Escape');

  const mobile = await browser.newPage({ viewport: { width: 375, height: 812 } });
  mobile.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`mobile console: ${message.text()}`);
  });
  mobile.on('pageerror', (error) => browserErrors.push(`mobile page: ${error.message}`));
  await mobile.goto(baseUrl, { waitUntil: 'networkidle' });

  const mobileLayout = await mobile.evaluate(() => ({
    hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    startVisible: Boolean(
      document.querySelector('#startButton')?.getBoundingClientRect().width,
    ),
  }));
  assert.equal(mobileLayout.hasHorizontalOverflow, false, '모바일에서 가로 스크롤이 없어야 합니다.');
  assert.equal(mobileLayout.startVisible, true, '모바일에서 시작 버튼이 보여야 합니다.');
  assert.equal(
    await mobile.locator('#uiRoot').getAttribute('data-ui-scale'),
    '1.000',
    '모바일에서는 자동 확대를 비활성화해야 합니다.',
  );
  await mobile.locator('.mode-tab[data-mode="spin"]').click();
  assert(await mobile.locator('#spinSetup').isVisible(), '모바일에서도 SPIN LAB 설정이 보여야 합니다.');
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
    'SPIN 탭을 선택해도 모바일 가로 스크롤이 생기지 않아야 합니다.',
  );

  await mobile.locator('.mode-tab[data-mode="build"]').click();
  assert(await mobile.locator('#buildSetup').isVisible(), '모바일에서도 BUILD 설정이 보여야 합니다.');
  await mobile.locator('#buildPhasePicker [data-build-phase="full"]').click();
  assert(await mobile.locator('#buildVariantSection').isVisible(), '전체 연습에서도 첫 가방 좌우 선택기가 보여야 합니다.');
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
    'BUILD 탭을 선택해도 모바일 가로 스크롤이 생기지 않아야 합니다.',
  );

  const buildPractice = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  buildPractice.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`build console: ${message.text()}`);
  });
  buildPractice.on('pageerror', (error) => browserErrors.push(`build page: ${error.message}`));
  await buildPractice.goto(baseUrl, { waitUntil: 'networkidle' });
  await buildPractice.locator('.mode-tab[data-mode="build"]').click();
  assert(await buildPractice.locator('#buildSetup').isVisible(), 'DOT CANNON 설정이 보여야 합니다.');
  assert.equal(await buildPractice.locator('#buildPhasePicker [data-build-phase="bag-1"]').getAttribute('aria-pressed'), 'true');
  assert(await buildPractice.locator('#buildVariantSection').isVisible(), '1가방 연습에서는 좌우 선택기가 보여야 합니다.');
  assert.equal(await buildPractice.locator('#buildVariantPicker [data-build-variant="auto"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await buildPractice.locator('#buildDifficultyPicker [data-build-difficulty="beginner"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await buildPractice.locator('#buildRetryPicker [data-build-retry="same"]').getAttribute('aria-pressed'), 'true');
  await buildPractice.locator('#buildPhasePicker [data-build-phase="full"]').click();
  assert.equal(await buildPractice.locator('#buildPhasePicker [data-build-phase="full"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await buildPractice.locator('#buildSummaryName').textContent(), 'DOT CANNON · FULL 3 BAGS');
  assert.equal(await buildPractice.locator('#buildSummaryMeta').textContent(), 'BUILD → TST → PC');
  assert(await buildPractice.locator('#buildVariantSection').isVisible(), '전체 연습은 첫 가방 좌우 선택을 지원해야 합니다.');
  await buildPractice.locator('#buildPhasePicker [data-build-phase="pc-3"]').click();
  assert.equal(await buildPractice.locator('#buildPhasePicker [data-build-phase="pc-3"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await buildPractice.locator('#buildSummaryName').textContent(), 'DOT CANNON · 3-BAG PC');
  assert.equal(await buildPractice.locator('#buildSummaryMeta').textContent(), 'SRS+180 · 87.58%');
  assert.equal(await buildPractice.locator('#buildVariantSection').isVisible(), false, '3가방 PC에서는 첫 가방 전용 선택기를 숨겨야 합니다.');
  await buildPractice.locator('#buildPhasePicker [data-build-phase="bag-2"]').click();
  assert.equal(await buildPractice.locator('#buildPhasePicker [data-build-phase="bag-2"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await buildPractice.locator('#buildSummaryName').textContent(), 'DOT CANNON · BAG 2');
  assert.equal(await buildPractice.locator('#buildSummaryMeta').textContent(), 'FIXED · 180° · 100%');
  assert.equal(await buildPractice.locator('#buildVariantSection').isVisible(), false, '2가방에서는 첫 가방 전용 선택기를 숨겨야 합니다.');
  await buildPractice.locator('#buildPhasePicker [data-build-phase="bag-1"]').click();
  await buildPractice.locator('#buildVariantPicker [data-build-variant="left-j"]').click();
  assert.equal(await buildPractice.locator('#buildVariantPicker [data-build-variant="left-j"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await buildPractice.locator('#buildVariantPicker [data-build-variant="auto"]').getAttribute('aria-pressed'), 'false');
  assert.equal(await buildPractice.locator('#buildVariantPicker [data-build-variant="right-l"]').getAttribute('aria-pressed'), 'false');
  assert.equal(await buildPractice.locator('#buildSummaryMeta').textContent(), 'LEFT J · J BEFORE L');
  await buildPractice.locator('#buildDifficultyPicker [data-build-difficulty="intermediate"]').click();
  assert.equal(await buildPractice.locator('#buildDifficultyPicker [data-build-difficulty="intermediate"]').getAttribute('aria-pressed'), 'true');
  await buildPractice.locator('#buildDifficultyPicker [data-build-difficulty="expert"]').click();
  assert.equal(await buildPractice.locator('#buildDifficultyPicker [data-build-difficulty="expert"]').getAttribute('aria-pressed'), 'true');
  await buildPractice.locator('#startButton').click();
  await buildPractice.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('data-state') === 'playing',
    undefined,
    { timeout: 4_000 },
  );
  assert.equal(await buildPractice.locator('#buildCoach').isVisible(), false, '고수 모드에서는 설명 패널도 숨겨야 합니다.');
  await buildPractice.locator('#brandButton').click();
  await buildPractice.locator('#buildDifficultyPicker [data-build-difficulty="intermediate"]').click();
  await buildPractice.locator('#startButton').click();
  await buildPractice.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('data-state') === 'playing',
    undefined,
    { timeout: 4_000 },
  );
  assert.equal(await buildPractice.locator('#buildCoachLevel').textContent(), 'INTERMEDIATE SHAPE');
  assert.equal(await buildPractice.locator('#buildCoachTitle').textContent(), 'BUILD SILHOUETTE');
  assert.match(
    await buildPractice.locator('#buildCoachDetail').textContent(),
    /^전체 외곽만 보고 각 미노의 위치를 판단하세요\. J #[1-7]가 L #[1-7]보다 먼저 · LEFT J 기본형$/,
  );
  assert(await buildPractice.locator('#buildCoach').isVisible(), '중수 모드에서는 전체 실루엣 설명이 보여야 합니다.');
  await buildPractice.locator('#brandButton').click();
  await buildPractice.locator('#buildDifficultyPicker [data-build-difficulty="beginner"]').click();
  await buildPractice.locator('#buildVariantPicker [data-build-variant="right-l"]').click();
  assert.equal(await buildPractice.locator('#buildVariantPicker [data-build-variant="left-j"]').getAttribute('aria-pressed'), 'false');
  assert.equal(await buildPractice.locator('#buildVariantPicker [data-build-variant="right-l"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await buildPractice.locator('#buildSummaryMeta').textContent(), 'RIGHT L · L BEFORE J');
  await buildPractice.locator('#buildRetryPicker [data-build-retry="new"]').click();
  assert.equal(await buildPractice.locator('#buildRetryPicker [data-build-retry="new"]').getAttribute('aria-pressed'), 'true');
  await buildPractice.locator('#buildRetryPicker [data-build-retry="same"]').click();
  if (process.env.SMOKE_BUILD_SETUP_SCREENSHOT) {
    const screenshotPath = path.resolve(process.env.SMOKE_BUILD_SETUP_SCREENSHOT);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await buildPractice.screenshot({ path: screenshotPath });
  }
  await buildPractice.locator('#startButton').click();
  await buildPractice.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('data-state') === 'playing',
    undefined,
    { timeout: 4_000 },
  );
  assert.equal(await buildPractice.locator('#statusText').textContent(), 'TRAINING');
  assert.equal(await buildPractice.locator('#objectiveLabel').textContent(), 'MINOS LEFT');
  assert.equal(await buildPractice.locator('#objectiveValue').textContent(), '7');
  assert.equal(await buildPractice.locator('#holdPanelLabel').textContent(), 'HOLD');
  assert(await buildPractice.locator('#buildCoach').isVisible(), '초보 모드에서는 목표 가이드가 보여야 합니다.');
  assert.equal(await buildPractice.locator('#buildCoachLevel').textContent(), 'BEGINNER GUIDE');
  assert.match(await buildPractice.locator('#buildCoachDetail').textContent(), /L #[1-7]가 J #[1-7]보다 먼저 · RIGHT L 대칭형/);
  const buildSeed = await buildPractice.locator('#seedValue').textContent();
  if (process.env.SMOKE_BUILD_SCREENSHOT) {
    const screenshotPath = path.resolve(process.env.SMOKE_BUILD_SCREENSHOT);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await buildPractice.screenshot({ path: screenshotPath });
  }
  await buildPractice.keyboard.press('Space');
  await buildPractice.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('data-state') === 'over',
    undefined,
    { timeout: 2_000 },
  );
  assert.equal(await buildPractice.locator('#resultBadge').textContent(), 'BUILD MISSED');
  assert.match(await buildPractice.locator('#retryButton').textContent(), /RETRY SAME BAG/);
  await buildPractice.locator('#retryButton').click();
  assert.equal(await buildPractice.locator('#seedValue').textContent(), buildSeed, 'SAME BAG은 동일한 시드를 유지해야 합니다.');
  await buildPractice.locator('#brandButton').click();
  await buildPractice.locator('#buildRetryPicker [data-build-retry="new"]').click();
  await buildPractice.locator('#startButton').click();
  await buildPractice.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('data-state') === 'playing',
    undefined,
    { timeout: 4_000 },
  );
  const newPolicySeed = await buildPractice.locator('#seedValue').textContent();
  await buildPractice.keyboard.press('Space');
  await buildPractice.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('data-state') === 'over',
    undefined,
    { timeout: 2_000 },
  );
  assert.match(await buildPractice.locator('#retryButton').textContent(), /START NEW BAG/);
  await buildPractice.locator('#retryButton').click();
  assert.notEqual(await buildPractice.locator('#seedValue').textContent(), newPolicySeed, 'NEW BAG은 새로운 시드를 생성해야 합니다.');
  await buildPractice.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('data-state') === 'playing',
    undefined,
    { timeout: 4_000 },
  );
  await buildPractice.keyboard.press('Space');
  await buildPractice.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('data-state') === 'over',
    undefined,
    { timeout: 2_000 },
  );
  assert.equal(await buildPractice.locator('.result-back-hint').textContent(), 'ESC BACK TO SETUP');
  await buildPractice.keyboard.press('Escape');
  await buildPractice.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('data-state') === 'idle',
    undefined,
    { timeout: 2_000 },
  );
  assert(await buildPractice.locator('#startOverlay').isVisible(), 'ESC는 결과 화면에서 현재 모드의 설정 화면으로 돌아가야 합니다.');
  assert.equal(await buildPractice.evaluate(() => document.activeElement?.id), 'startButton');
  await buildPractice.locator('#buildPhasePicker [data-build-phase="bag-2"]').click();
  await buildPractice.locator('#buildDifficultyPicker [data-build-difficulty="beginner"]').click();
  await buildPractice.locator('#startButton').click();
  await buildPractice.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('data-state') === 'playing',
    undefined,
    { timeout: 4_000 },
  );
  assert.match(await buildPractice.locator('#buildCoachDetail').textContent(), /1가방 바닥|180°|T-Spin Triple|중앙 아래 홈/);
  assert.equal(await buildPractice.locator('#objectiveValue').textContent(), '7');
  await buildPractice.locator('#brandButton').click();
  await buildPractice.locator('#buildPhasePicker [data-build-phase="pc-3"]').click();
  const pcStartAt = performance.now();
  await buildPractice.locator('#startButton').click();
  const pcStartLatency = performance.now() - pcStartAt;
  assert(pcStartLatency < 1_000, `3가방 PC 정적 해법 조회가 너무 느립니다: ${pcStartLatency.toFixed(1)}ms`);
  let pcState;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await buildPractice.waitForFunction(
      () => ['playing', 'over'].includes(document.querySelector('#app')?.getAttribute('data-state')),
      undefined,
      { timeout: 5_000 },
    );
    pcState = await buildPractice.locator('#app').getAttribute('data-state');
    if (pcState === 'playing') break;
    assert.equal(await buildPractice.locator('#resultBadge').textContent(), 'PC UNAVAILABLE');
    assert.match(await buildPractice.locator('#retryButton').textContent(), /FIND NEW BAG/);
    assert.equal(await buildPractice.locator('#resultSameSeedButton').isVisible(), false);
    assert.equal(await buildPractice.locator('#sameSeedRestartButton').isVisible(), false);
    await buildPractice.locator('#retryButton').click();
  }
  assert.equal(pcState, 'playing', '연습 가능한 3가방 PC 시드를 찾아야 합니다.');
  assert.equal(await buildPractice.locator('#objectiveValue').textContent(), '6');
  assert.match(await buildPractice.locator('#buildCoachDetail').textContent(), /PC|해법/);
  await buildPractice.locator('#brandButton').click();
  await buildPractice.locator('#buildPhasePicker [data-build-phase="full"]').click();
  assert.equal(await buildPractice.locator('#buildSummaryMeta').textContent(), 'BUILD → TST → PC · RIGHT L');
  await buildPractice.locator('#startButton').click();
  await buildPractice.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('data-state') === 'playing',
    undefined,
    { timeout: 5_000 },
  );
  assert.equal(await buildPractice.locator('#objectiveValue').textContent(), '7');
  assert.match(await buildPractice.locator('#buildCoachProgress').textContent(), /^1\/3 · 0 \/ 7$/);
  assert.match(await buildPractice.locator('#buildCoachDetail').textContent(), /L #[1-7]가 J #[1-7]보다 먼저 · RIGHT L 대칭형/);

  const finesse = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  finesse.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`finesse console: ${message.text()}`);
  });
  finesse.on('pageerror', (error) => browserErrors.push(`finesse page: ${error.message}`));
  await finesse.goto(baseUrl, { waitUntil: 'networkidle' });
  await finesse.locator('.mode-tab[data-mode="finesse"]').click();
  assert(await finesse.locator('#finesseSetup').isVisible(), 'FINESSE LAB 선택기가 보여야 합니다.');
  for (const piece of ['I', 'J', 'L', 'O', 'S', 'Z']) {
    await finesse.locator(`#finessePiecePicker [data-piece="${piece}"]`).click();
  }
  assert.equal(await finesse.locator('#finesseCaseCount').textContent(), '34', 'T 미노의 34개 배치만 선택되어야 합니다.');
  for (const piece of ['I', 'J', 'L', 'O', 'S', 'T', 'Z']) {
    assert.equal(
      await finesse.locator(`#finessePiecePicker [data-piece="${piece}"]`).getAttribute('aria-pressed'),
      String(piece === 'T'),
      `${piece} 미노 선택 상태가 설정과 일치해야 합니다.`,
    );
    assert.equal(
      await finesse.locator(`#finessePiecePicker [data-piece="${piece}"]`).evaluate((element) => element.classList.contains('is-selected')),
      piece === 'T',
      `${piece} 미노의 시각적 선택 상태가 일치해야 합니다.`,
    );
  }
  if (process.env.SMOKE_FINESSE_SETUP_SCREENSHOT) {
    await finesse.waitForTimeout(220);
    const screenshotPath = path.resolve(process.env.SMOKE_FINESSE_SETUP_SCREENSHOT);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await finesse.screenshot({ path: screenshotPath });
  }
  await finesse.locator('#startButton').click();
  await finesse.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('data-state') === 'playing',
    undefined,
    { timeout: 4_000 },
  );
  assert.equal(await finesse.locator('#statusText').textContent(), 'TRAINING');
  const casesBeforeFault = await finesse.locator('#objectiveValue').textContent();
  await finesse.keyboard.press('ArrowLeft');
  await finesse.keyboard.press('ArrowRight');
  await finesse.keyboard.press('Space');
  await finesse.waitForFunction(
    () => Number(document.querySelector('#linesValue')?.textContent) >= 1,
    undefined,
    { timeout: 2_000 },
  );
  assert.equal(await finesse.locator('#objectiveValue').textContent(), casesBeforeFault, '실패한 케이스는 완료 처리하지 않아야 합니다.');
  assert.match(await finesse.locator('#finesseValue').textContent(), /0% · [1-9]\d*F/, '실패가 정확도와 fault 수에 반영되어야 합니다.');
  if (process.env.SMOKE_FINESSE_SCREENSHOT) {
    await finesse.waitForTimeout(220);
    const screenshotPath = path.resolve(process.env.SMOKE_FINESSE_SCREENSHOT);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await finesse.screenshot({ path: screenshotPath });
  }

  const extendedFinesse = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  extendedFinesse.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`extended finesse console: ${message.text()}`);
  });
  extendedFinesse.on('pageerror', (error) => browserErrors.push(`extended finesse page: ${error.message}`));
  await extendedFinesse.goto(baseUrl, { waitUntil: 'networkidle' });
  await extendedFinesse.locator('.mode-tab[data-mode="finesse"]').click();
  await extendedFinesse.locator('#masteryMapButton').click();
  assert(await extendedFinesse.locator('#masteryOverlay').isVisible(), '숙련도 맵이 열려야 합니다.');
  await extendedFinesse.locator('#masteryPieceTabs [data-mastery-piece="T"]').click();
  assert.equal(await extendedFinesse.locator('#masteryCaseGrid [data-case-id]').count(), 34, 'T 미노 숙련도 케이스 34개가 보여야 합니다.');
  await extendedFinesse.locator('#masteryCaseGrid [data-case-id="T:0:0"]').click();
  assert.match(await extendedFinesse.locator('#masteryCaseDetail').textContent(), /T · SPAWN · COLUMN 1/);
  if (process.env.SMOKE_MASTERY_SCREENSHOT) {
    await extendedFinesse.waitForTimeout(220);
    const screenshotPath = path.resolve(process.env.SMOKE_MASTERY_SCREENSHOT);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await extendedFinesse.screenshot({ path: screenshotPath });
  }
  await extendedFinesse.locator('#closeMasteryButton').click();
  await extendedFinesse.locator('#finesseTypePicker [data-finesse-type="stack"]').click();
  assert.equal(await extendedFinesse.locator('#finesseSetup').getAttribute('data-training-type'), 'stack');
  await extendedFinesse.locator('#startButton').click();
  await extendedFinesse.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('data-state') === 'playing',
    undefined,
    { timeout: 4_000 },
  );
  assert.notEqual(await extendedFinesse.locator('#holdState').textContent(), 'READY', 'STACK 목표 방향이 표시되어야 합니다.');
  if (process.env.SMOKE_FINESSE_STACK_SCREENSHOT) {
    await extendedFinesse.waitForTimeout(220);
    const screenshotPath = path.resolve(process.env.SMOKE_FINESSE_STACK_SCREENSHOT);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await extendedFinesse.screenshot({ path: screenshotPath });
  }

  const flow = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  flow.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`flow console: ${message.text()}`);
  });
  flow.on('pageerror', (error) => browserErrors.push(`flow page: ${error.message}`));
  await flow.goto(baseUrl, { waitUntil: 'networkidle' });
  await flow.locator('.mode-tab[data-mode="finesse"]').click();
  await flow.locator('#finesseTypePicker [data-finesse-type="flow"]').click();
  assert.equal(await flow.locator('#finesseSetup').getAttribute('data-training-type'), 'flow');
  assert.equal(await flow.locator('#finesseCaseUnit').textContent(), '7-BAG');
  assert.equal(await flow.locator('#finesseDrillFilters').isVisible(), false, 'FLOW에서는 케이스 필터를 숨겨야 합니다.');
  await flow.locator('#startButton').click();
  await flow.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('data-state') === 'playing',
    undefined,
    { timeout: 4_000 },
  );
  assert.equal(await flow.locator('#holdPanelLabel').textContent(), 'HOLD');
  assert.equal(await flow.locator('#objectiveLabel').textContent(), 'LINES');
  await flow.keyboard.press('Space');
  await flow.waitForFunction(
    () => Number(document.querySelector('#linesValue')?.textContent) >= 1,
    undefined,
    { timeout: 2_000 },
  );
  if (process.env.SMOKE_FINESSE_FLOW_SCREENSHOT) {
    await flow.waitForTimeout(220);
    const screenshotPath = path.resolve(process.env.SMOKE_FINESSE_FLOW_SCREENSHOT);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await flow.screenshot({ path: screenshotPath });
  }
  await flow.locator('#brandButton').click();
  await flow.locator('#masteryMapButton').click();
  assert.match(await flow.locator('#masteryPracticed').textContent(), /^[1-9]\d*\/162$/, 'FLOW 결과가 숙련도 맵에 누적되어야 합니다.');

  const spin = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  spin.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`spin console: ${message.text()}`);
  });
  spin.on('pageerror', (error) => browserErrors.push(`spin page: ${error.message}`));
  await spin.goto(baseUrl, { waitUntil: 'networkidle' });
  await spin.locator('.mode-tab[data-mode="spin"]').click();
  assert(await spin.locator('#spinSetup').isVisible(), 'SPIN LAB 선택기가 보여야 합니다.');
  assert.equal(await spin.locator('#spinCaseCount').textContent(), '8', '기본 과정은 검증된 T/S/Z 스핀 8개 케이스여야 합니다.');
  assert.equal(await spin.locator('#spinSetup').getAttribute('data-validation'), 'technique', '기본 판정은 NEO·FIN을 구분해야 합니다.');
  assert.equal(await spin.locator('#spinValidationPicker [data-spin-validation="technique"]').getAttribute('aria-pressed'), 'true');
  await spin.locator('#spinValidationPicker [data-spin-validation="placement"]').click();
  assert.equal(await spin.locator('#spinSetup').getAttribute('data-validation'), 'placement', '최종 배치 판정을 시작 전에 선택할 수 있어야 합니다.');
  assert.equal(await spin.locator('#spinValidationPicker [data-spin-validation="placement"]').getAttribute('aria-pressed'), 'true');
  await spin.locator('#startButton').click();
  await spin.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('data-state') === 'playing',
    undefined,
    { timeout: 4_000 },
  );
  assert.equal(await spin.locator('#spinCoach').getAttribute('data-validation'), 'placement');
  assert.equal(await spin.locator('#spinKickValue').textContent(), 'POSITION CHECK');
  assert.match(await spin.locator('#spinConceptValue').textContent(), /최종 배치가 같으면 성공/);
  await spin.locator('#brandButton').click();
  assert(await spin.locator('#startOverlay').isVisible(), '배치 판정 확인 후 시작 화면으로 돌아와야 합니다.');
  await spin.locator('#spinValidationPicker [data-spin-validation="technique"]').click();
  await spin.locator('#spinStylePicker [data-spin-style="recall"]').click();
  assert.equal(await spin.locator('#spinSetup').getAttribute('data-style'), 'recall', '설명 숨김을 시작 전에 선택할 수 있어야 합니다.');
  await spin.locator('#spinStylePicker [data-spin-style="guided"]').click();
  if (process.env.SMOKE_SPIN_SETUP_SCREENSHOT) {
    await spin.waitForTimeout(220);
    const screenshotPath = path.resolve(process.env.SMOKE_SPIN_SETUP_SCREENSHOT);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await spin.screenshot({ path: screenshotPath });
  }
  assert.equal(await spin.locator('#spinPresetPicker [data-spin-preset="builds"]').count(), 0, 'BUILDS preset must stay hidden.');
  assert.equal(await spin.locator('#spinPresetPicker [data-spin-preset="deep"]').count(), 0, 'DEEP preset must stay hidden.');
  await spin.locator('#spinPresetPicker [data-spin-preset="all"]').click();
  assert.equal(await spin.locator('#spinCaseCount').textContent(), '38', 'ALL SPINS must include the 12 L/J/I cases and exclude the 10 hidden BUILD/DEEP cases.');
  if (false) { // Historical BUILD/DEEP browser routes stay documented while the presets are hidden.
  await spin.locator('#spinPresetPicker [data-spin-preset="all"]').click();
  assert.equal(await spin.locator('#spinCaseCount').textContent(), '36', 'ALL SPINS는 검증된 확장 케이스 36개를 포함해야 합니다.');
  await spin.locator('#spinPresetPicker [data-spin-preset="builds"]').click();
  assert.equal(await spin.locator('#spinCaseCount').textContent(), '8', 'BUILDS는 좌우 빌드형 T-Spin Double 여덟 케이스만 포함해야 합니다.');
  assert.equal(await spin.locator('#spinPresetLabel').textContent(), 'COMMON BUILD ROUTES');
  await spin.locator('#startButton').click();
  await spin.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('data-state') === 'playing',
    undefined,
    { timeout: 4_000 },
  );
  for (let buildIndex = 0; buildIndex < 8; buildIndex += 1) {
    assert.equal(await spin.locator('#spinCaseTitle').textContent(), 'BUILD T-SPIN DOUBLE');
    const buildRoute = JSON.parse(await spin.locator('#spinCoach').getAttribute('data-practice-route'));
    assert(buildRoute.filter((token) => token === 'softDrop').length >= 3, '빌드형 T스핀은 실제 SDF MAX 하강 구간이 세 번 이상이어야 합니다.');
    assert(buildRoute.slice(buildRoute.indexOf('softDrop') + 1).some((token) => token === 'left' || token === 'right'), '빌드형 T스핀은 첫 하강 뒤 옆 진입이 필요해야 합니다.');
    if (buildIndex === 0 && process.env.SMOKE_BUILD_SPIN_SCREENSHOT) {
      await spin.waitForTimeout(220);
      const screenshotPath = path.resolve(process.env.SMOKE_BUILD_SPIN_SCREENSHOT);
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await spin.screenshot({ path: screenshotPath });
    }
    if (process.env.SMOKE_BUILD_SPIN_SCREENSHOT_DIR) {
      await spin.waitForTimeout(120);
      const screenshotPath = path.resolve(process.env.SMOKE_BUILD_SPIN_SCREENSHOT_DIR, `build-${buildIndex + 1}.png`);
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await spin.screenshot({ path: screenshotPath });
    }
    await playSpinPracticeRoute(spin);
    await spin.waitForFunction(
      (completed) => Number(document.querySelector('#linesValue')?.textContent) >= completed,
      buildIndex + 1,
      { timeout: 2_000 },
    );
    assert.equal(await spin.locator('#objectiveValue').textContent(), String(7 - buildIndex), '표시된 빌드 입력을 그대로 누르면 해당 케이스가 완료되어야 합니다.');
    if (buildIndex < 7) {
      await spin.waitForFunction(
        () => document.querySelector('#spinCoach')?.getAttribute('data-current-y') === '19',
        undefined,
        { timeout: 2_000 },
      );
    }
  }
  await spin.locator('#brandButton').click();
  await spin.locator('#spinPresetPicker [data-spin-preset="deep"]').click();
  assert.equal(await spin.locator('#spinCaseCount').textContent(), '2', 'DEEP은 좌우 깊은 T-Spin Double 두 케이스만 포함해야 합니다.');
  assert.equal(await spin.locator('#spinPresetLabel').textContent(), 'DEEP T-SPIN ROUTES');
  await spin.locator('#startButton').click();
  await spin.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('data-state') === 'playing',
    undefined,
    { timeout: 4_000 },
  );
  assert.equal(await spin.locator('#spinCaseTitle').textContent(), 'DEEP T-SPIN DOUBLE');
  const deepRoute = JSON.parse(await spin.locator('#spinCoach').getAttribute('data-practice-route'));
  assert.equal(deepRoute.filter((token) => token === 'softDrop').length, 3, '딥 T스핀은 실제 SDF MAX 하강 구간이 세 번이어야 합니다.');
  assert(deepRoute.filter((token) => token.startsWith('rotate')).length >= 5, '딥 T스핀은 통로 안에서 여러 번 회전해야 합니다.');
  const deepBoardBox = await spin.locator('#boardRig').boundingBox();
  const deepCoachBox = await spin.locator('#spinCoach').boundingBox();
  assert(deepBoardBox && deepCoachBox && deepCoachBox.x >= deepBoardBox.x + deepBoardBox.width, '데스크톱 코치는 보드와 겹치지 않아야 합니다.');
  if (process.env.SMOKE_DEEP_SPIN_SCREENSHOT) {
    await spin.waitForTimeout(220);
    const screenshotPath = path.resolve(process.env.SMOKE_DEEP_SPIN_SCREENSHOT);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await spin.screenshot({ path: screenshotPath });
  }
  await playSpinPracticeRoute(spin);
  await spin.waitForFunction(
    () => Number(document.querySelector('#linesValue')?.textContent) >= 1,
    undefined,
    { timeout: 2_000 },
  );
  assert.equal(await spin.locator('#objectiveValue').textContent(), '1', '표시된 딥 입력을 그대로 누르면 한 케이스가 완료되어야 합니다.');
  await spin.locator('#brandButton').click();
  await spin.locator('#spinPresetPicker [data-spin-preset="all"]').click();
  }
  await spin.locator('#spinGuideButton').click();
  assert(await spin.locator('#spinGuideOverlay').isVisible(), '스핀 원리 가이드가 열려야 합니다.');
  await spin.locator('#spinGuideTabs [data-spin-guide="T"]').click();
  if (false) { // Historical total before BUILD/DEEP were hidden.
  assert.equal(await spin.locator('#spinGuideCaseTabs [data-spin-case-id]').count(), 24, 'T 가이드에 기본, Mini, Iso, Neo, Fin, Build, Deep 좌우 케이스가 있어야 합니다.');
  }
  assert.equal(await spin.locator('#spinGuideCaseTabs [data-spin-case-id]').count(), 14, 'T guide must exclude the 10 hidden BUILD/DEEP cases.');
  assert.equal(await spin.locator('#spinGuideCaseTabs [data-spin-case-id^="T:mini-single"]').count(), 2);
  assert.equal(await spin.locator('#spinGuideCaseTabs [data-spin-case-id^="T:iso-double"]').count(), 2);
  assert.equal(await spin.locator('#spinGuideCaseTabs [data-spin-case-id^="T:neo-double"]').count(), 2);
  assert.equal(await spin.locator('#spinGuideCaseTabs [data-spin-case-id^="T:fin-double"]').count(), 2);
  if (false) { // Historical BUILD/DEEP guide counts.
  assert.equal(await spin.locator('#spinGuideCaseTabs [data-spin-case-id^="T:deep-double"]').count(), 2);
  assert.equal(await spin.locator('#spinGuideCaseTabs [data-spin-case-id^="T:build-tower"]').count(), 8);
  }
  assert.equal(await spin.locator('#spinGuideCaseTabs [data-spin-case-id^="T:deep-double"]').count(), 0);
  assert.equal(await spin.locator('#spinGuideCaseTabs [data-spin-case-id^="T:build-tower"]').count(), 0);
  await spin.locator('#spinGuideCaseTabs [data-spin-case-id="T:triple-left"]').click();
  assert.match(await spin.locator('#spinGuideRouteTitle').textContent(), /T-SPIN TRIPLE/);
  assert.match(await spin.locator('#spinGuideAfterLabel').textContent(), /3줄 클리어/);
  await spin.locator('#spinGuideCaseTabs [data-spin-case-id="T:neo-double-right"]').click();
  assert.match(await spin.locator('#spinGuideRouteTitle').textContent(), /NEO T-SPIN MINI DOUBLE/);
  assert.match(await spin.locator('#spinGuideRouteExplanation').textContent(), /앞쪽 코너가 하나/);
  assert.equal(await spin.locator('#spinGuideStateRows [data-spin-case-id]').count(), 2, 'Neo-TSD의 좌우 진입을 함께 비교해야 합니다.');
  if (process.env.SMOKE_T_SPIN_GUIDE_SCREENSHOT) {
    await spin.waitForTimeout(220);
    const screenshotPath = path.resolve(process.env.SMOKE_T_SPIN_GUIDE_SCREENSHOT);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await spin.screenshot({ path: screenshotPath });
  }
  for (const [piece, expectedCases] of [['L', 3], ['J', 3], ['I', 6]]) {
    await spin.locator(`#spinGuideTabs [data-spin-guide="${piece}"]`).click();
    assert.equal(
      await spin.locator('#spinGuideCaseTabs [data-spin-case-id]').count(),
      expectedCases,
      `${piece} guide must expose every verified all-spin case.`,
    );
    assert.match(await spin.locator('#spinGuideRouteTitle').textContent(), new RegExp(`^${piece}-SPIN`));
  }
  await spin.locator('#spinGuideTabs [data-spin-guide="S"]').click();
  assert.match(await spin.locator('#spinGuideBody').textContent(), /벽이 있는 반대 진입/);
  assert.equal(await spin.locator('#spinGuideCaseTabs [data-spin-case-id]').count(), 6, 'S 가이드는 Single, 양방향 Double, Triple을 보여줘야 합니다.');
  assert.match(await spin.locator('#spinGuideEntryLabel').textContent(), /오른쪽/);
  assert.equal(await spin.locator('#spinGuideRouteTitle').textContent(), 'S-SPIN DOUBLE · 오른쪽 세로 (R) → 반대 가로 (2)');
  assert.equal(await spin.locator('#spinGuideInputKey').textContent(), '↻ 시계');
  assert.equal(await spin.locator('#spinGuideBeforeGrid .is-piece').count(), 4);
  assert.equal(await spin.locator('#spinGuideBeforeGrid .is-target').count(), 4);
  assert.equal(await spin.locator('#spinGuideAfterGrid .is-piece').count(), 4);
  assert((await spin.locator('#spinGuideBeforeGrid .is-terrain').count()) > 0, '실제 슬롯 지형을 보여줘야 합니다.');
  assert.equal(await spin.locator('#spinGuideStateRows [data-spin-case-id]').count(), 2);
  assert.match(await spin.locator('#spinGuideRouteExplanation').textContent(), /예시 입력.*↓ MAX.*SPACE/);
  assert.match(await spin.locator('#spinGuideRouteExplanation').textContent(), /2줄을 지웁니다/);
  if (process.env.SMOKE_SPIN_GUIDE_SCREENSHOT) {
    await spin.waitForTimeout(220);
    const screenshotPath = path.resolve(process.env.SMOKE_SPIN_GUIDE_SCREENSHOT);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await spin.screenshot({ path: screenshotPath });
  }
  await spin.locator('#practiceSpinGuideButton').click();
  assert.equal(await spin.locator('#spinGuideOverlay').isVisible(), false);
  assert.equal(await spin.locator('#spinCaseCount').textContent(), '6', '가이드에서 S의 전체 스핀 가족을 연습 목록에 넣을 수 있어야 합니다.');
  await spin.locator('#spinPresetPicker [data-spin-preset="basics"]').click();
  await spin.locator('#spinPiecePicker [data-spin-piece="T"]').click();
  await spin.locator('#spinPiecePicker [data-spin-piece="Z"]').click();
  assert.equal(await spin.locator('#spinCaseCount').textContent(), '1', '실제 플레이 검증은 S-Spin Double만 사용해야 합니다.');
  await spin.locator('#startButton').click();
  await spin.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('data-state') === 'playing',
    undefined,
    { timeout: 4_000 },
  );
  assert(await spin.locator('#spinCoach').isVisible(), '플레이 중 회전 상태 코치가 보여야 합니다.');
  assert.equal(await spin.locator('#spinCaseTitle').textContent(), 'S-SPIN DOUBLE');
  const spinCasesBefore = Number(await spin.locator('#objectiveValue').textContent());
  await spin.keyboard.press('Space');
  await spin.waitForFunction(
    () => Number(document.querySelector('#linesValue')?.textContent) >= 1,
    undefined,
    { timeout: 2_000 },
  );
  assert.equal(Number(await spin.locator('#objectiveValue').textContent()), spinCasesBefore, '직접 하드드롭은 S 홈을 채우지 못하고 실패해야 합니다.');
  assert.match(await spin.locator('#finesseValue').textContent(), /0% · 1F/);
  assert.equal(await spin.locator('#finesseHint').isVisible(), false, '스핀 피드백이 보드 하단을 가리면 안 됩니다.');
  assert.match(await spin.locator('#spinFeedback').textContent(), /목표/);
  assert.equal(await spin.locator('#spinFeedback').getAttribute('data-tone'), 'danger');
  if (process.env.SMOKE_SPIN_FEEDBACK_SCREENSHOT) {
    const screenshotPath = path.resolve(process.env.SMOKE_SPIN_FEEDBACK_SCREENSHOT);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await spin.screenshot({ path: screenshotPath });
  }
  await spin.waitForFunction(
    () => document.querySelector('#spinCoach')?.getAttribute('data-current-y') === '19',
    undefined,
    { timeout: 2_000 },
  );
  const spawnY = Number(await spin.locator('#spinCoach').getAttribute('data-current-y'));
  const practiceRoute = JSON.parse(await spin.locator('#spinCoach').getAttribute('data-practice-route'));
  const practiceTimeline = JSON.parse(await spin.locator('#spinCoach').getAttribute('data-practice-timeline'));
  assert(practiceRoute.includes('softDrop'), '권장 입력에 SDF MAX 소프트드롭이 포함되어야 합니다.');
  assert.equal(practiceRoute.at(-1), 'hardDrop', '권장 입력은 하드드롭 확정까지 포함해야 합니다.');
  assert.match(await spin.locator('#spinDirectionValue').textContent(), /↓ MAX.*SPACE/);
  const fixedCoachCopy = await spin.evaluate(() => [
    '#spinCaseTitle',
    '#spinKickValue',
    '#spinStateFrom',
    '#spinStateTo',
    '#spinDirectionValue',
    '#spinConceptValue',
  ].map((selector) => document.querySelector(selector)?.textContent));
  const inputKeys = {
    left: 'ArrowLeft',
    right: 'ArrowRight',
    rotateCW: 'ArrowUp',
    rotateCCW: 'KeyZ',
    rotate180: 'KeyA',
    softDrop: 'ArrowDown',
    hardDrop: 'Space',
  };
  for (const step of practiceTimeline) {
    if (step.token === 'hardDrop') {
      assert(Number(await spin.locator('#spinCoach').getAttribute('data-current-y')) > spawnY, 'SDF MAX 입력으로 미노가 실제 슬롯까지 내려가야 합니다.');
      if (process.env.SMOKE_SPIN_SCREENSHOT) {
        await spin.waitForTimeout(120);
        const screenshotPath = path.resolve(process.env.SMOKE_SPIN_SCREENSHOT);
        await mkdir(path.dirname(screenshotPath), { recursive: true });
        await spin.screenshot({ path: screenshotPath });
      }
      await spin.keyboard.press(inputKeys[step.token]);
      break;
    }
    if (step.token === 'softDrop') await spin.keyboard.down(inputKeys[step.token]);
    else await spin.keyboard.press(inputKeys[step.token]);
    await spin.waitForFunction(
      ({ resultX, resultY, resultRot }) => {
        const coach = document.querySelector('#spinCoach');
        return Number(coach?.getAttribute('data-current-x')) === resultX
          && Number(coach?.getAttribute('data-current-y')) === resultY
          && coach?.getAttribute('data-current-state') === ['0', 'R', '2', 'L'][resultRot];
      },
      step,
      { timeout: 2_000 },
    );
    if (step.token === 'softDrop') await spin.keyboard.up(inputKeys[step.token]);
    assert.deepEqual(await spin.evaluate(() => [
      '#spinCaseTitle',
      '#spinKickValue',
      '#spinStateFrom',
      '#spinStateTo',
      '#spinDirectionValue',
      '#spinConceptValue',
    ].map((selector) => document.querySelector(selector)?.textContent)), fixedCoachCopy, '조작 중에도 케이스 설명은 바뀌면 안 됩니다.');
  }
  await spin.waitForFunction(
    () => Number(document.querySelector('#linesValue')?.textContent) >= 2,
    undefined,
    { timeout: 2_000 },
  );
  assert.equal(Number(await spin.locator('#objectiveValue').textContent()), spinCasesBefore - 1, '올바른 킥은 케이스를 완료해야 합니다.');
  assert.match(await spin.locator('#finesseValue').textContent(), /50% · 1F/);
  await spin.locator('#brandButton').click();
  await spin.locator('#spinStylePicker [data-spin-style="recall"]').click();
  await spin.locator('#startButton').click();
  await spin.waitForFunction(
    () => document.querySelector('#app')?.getAttribute('data-state') === 'playing',
    undefined,
    { timeout: 4_000 },
  );
  assert.equal(await spin.locator('#spinCoach').getAttribute('data-style'), 'recall');
  assert.equal(await spin.locator('#spinCoach').isVisible(), false, 'COACH OFF에서는 플레이 설명 패널 전체를 숨겨야 합니다.');
  assert.equal(await spin.locator('#spinDirectionValue').isVisible(), false, 'RECALL에서는 정답 회전 방향을 숨겨야 합니다.');
  assert.equal(await spin.locator('#spinConceptValue').isVisible(), false, 'RECALL에서는 원리 힌트를 숨겨야 합니다.');

  for (const [piece, expectedCases] of [['L', 3], ['J', 3], ['I', 6]]) {
    const family = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    family.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
    });
    family.on('pageerror', (error) => browserErrors.push(`page: ${error.message}`));
    await family.goto(baseUrl, { waitUntil: 'networkidle' });
    await family.locator('.mode-tab[data-mode="spin"]').click();
    await family.locator('#spinGuideButton').click();
    await family.locator(`#spinGuideTabs [data-spin-guide="${piece}"]`).click();
    await family.locator('#practiceSpinGuideButton').click();
    assert.equal(await family.locator('#spinCaseCount').textContent(), String(expectedCases));
    await family.locator('#startButton').click();
    await family.waitForFunction(
      () => document.querySelector('#app')?.getAttribute('data-state') === 'playing',
      undefined,
      { timeout: 4_000 },
    );
    for (let caseIndex = 0; caseIndex < expectedCases; caseIndex += 1) {
      assert.match(await family.locator('#spinCaseTitle').textContent(), new RegExp(`^${piece}-SPIN`));
      const casesLeft = Number(await family.locator('#objectiveValue').textContent());
      await playSpinPracticeRoute(family);
      await family.waitForFunction(
        (nextValue) => Number(document.querySelector('#objectiveValue')?.textContent) === nextValue,
        casesLeft - 1,
        { timeout: 2_000 },
      );
      if (caseIndex < expectedCases - 1) {
        await family.waitForFunction(
          () => document.querySelector('#spinCoach')?.getAttribute('data-current-y') === '19',
          undefined,
          { timeout: 2_000 },
        );
      }
    }
    await family.close();
  }

  if (process.env.SMOKE_SCREENSHOT) {
    const screenshotPath = path.resolve(process.env.SMOKE_SCREENSHOT);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await fourK.locator('#startButton').click();
    await fourK.waitForFunction(
      () => document.querySelector('#app')?.getAttribute('data-state') === 'playing',
      undefined,
      { timeout: 6_000 },
    );
    await fourK.keyboard.press('KeyC');
    await fourK.screenshot({ path: screenshotPath });
  }

  assert.deepEqual(browserErrors, []);
  console.log(
    `desktop gameplay, 4k scaling, settings, mobile layout: ok `
    + `(clock drift ${clockAudit.drift.toFixed(1)}ms, desktop p95 ${clockAudit.p95FrameTime.toFixed(1)}ms, `
    + `4k median ${fourKFrameAudit.median.toFixed(1)}ms / p95 ${fourKFrameAudit.p95.toFixed(1)}ms)`,
  );
} finally {
  await browser.close();
}
