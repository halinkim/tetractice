const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const MIN_DESKTOP_WIDTH = 1024;
const MIN_DESKTOP_HEIGHT = 700;
const MAX_SCALE = 2;

export type UiScalePreference = 'auto' | '100' | '125' | '150' | '175' | '200';

type ViewportSize = {
  width: number;
  height: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const normalizePreference = (value: unknown): UiScalePreference => {
  const normalized = String(value);
  return ['100', '125', '150', '175', '200'].includes(normalized)
    ? normalized as UiScalePreference
    : 'auto';
};

export const calculateUiScale = (
  viewport: ViewportSize,
  preference: unknown = 'auto',
) => {
  const { width, height } = viewport;
  if (width < MIN_DESKTOP_WIDTH || height < MIN_DESKTOP_HEIGHT) return 1;

  const normalized = normalizePreference(preference);
  const safeFit = clamp(Math.min(width / 1280, height / 800), 1, MAX_SCALE);
  const requested = normalized === 'auto'
    ? Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT)
    : Number(normalized) / 100;

  return Math.round(clamp(requested, 1, safeFit) * 1000) / 1000;
};

export const createViewportScale = (
  root: HTMLElement,
  initialPreference: unknown = 'auto',
) => {
  let preference = normalizePreference(initialPreference);
  let animationFrame = 0;

  const apply = () => {
    animationFrame = 0;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const scale = calculateUiScale(viewport, preference);

    root.style.setProperty('--ui-scale', String(scale));
    root.dataset.uiScale = scale.toFixed(3);

    if (viewport.width < MIN_DESKTOP_WIDTH || viewport.height < MIN_DESKTOP_HEIGHT) {
      root.style.removeProperty('--ui-logical-width');
      root.style.removeProperty('--ui-logical-height');
      return;
    }

    root.style.setProperty('--ui-logical-width', `${viewport.width / scale}px`);
    root.style.setProperty('--ui-logical-height', `${viewport.height / scale}px`);
  };

  const schedule = () => {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(apply);
  };

  const setPreference = (nextPreference: unknown) => {
    preference = normalizePreference(nextPreference);
    schedule();
  };

  window.addEventListener('resize', schedule, { passive: true });
  window.visualViewport?.addEventListener('resize', schedule, { passive: true });
  apply();

  return { apply, setPreference };
};
