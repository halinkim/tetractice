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

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  desktop.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });
  desktop.on('pageerror', (error) => browserErrors.push(`page: ${error.message}`));

  await desktop.goto(baseUrl, { waitUntil: 'networkidle' });
  assert.equal(await desktop.title(), 'STACK//LAB — High Fidelity Stacker Trainer');
  assert(await desktop.locator('#startButton').isVisible(), '시작 버튼이 보여야 합니다.');
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

  await desktop.keyboard.press('ArrowLeft');
  await desktop.keyboard.press('KeyZ');
  await desktop.keyboard.press('Space');
  await desktop.waitForFunction(
    () => Number(document.querySelector('#piecesValue')?.textContent) >= 1,
    undefined,
    { timeout: 2_000 },
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
  assert.equal(fourKLayout.topbar?.height, 136, '4K에서 상단바도 같은 비율로 확대되어야 합니다.');

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
  console.log('desktop gameplay, 4k scaling, settings, mobile layout: ok');
} finally {
  await browser.close();
}
