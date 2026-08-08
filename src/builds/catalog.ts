export type BuildPiece = 'I' | 'J' | 'L' | 'O' | 'S' | 'T' | 'Z';
export type BuildId = 'dot-cannon';
export type BuildPhaseId = 'bag-1' | 'bag-2' | 'pc-3' | 'full';
export type BuildOpeningVariant = 'auto' | 'left-j' | 'right-l';

export type BuildOpeningVariantOption = {
  id: BuildOpeningVariant;
  label: string;
  detail: string;
  summary: string;
};

export type BuildDefinition = {
  id: BuildId;
  label: string;
  phases: Record<BuildPhaseId, { label: string; meta: string; description: string }>;
  openingVariantLabel: string;
  openingVariantScope: string;
  openingVariantPhases: BuildPhaseId[];
  openingVariants: BuildOpeningVariantOption[];
  prepareOpeningBag: (bag: BuildPiece[], variant: BuildOpeningVariant) => BuildPiece[];
};

const prepareDotCannonOpeningBag = (
  bag: BuildPiece[],
  variant: BuildOpeningVariant,
) => {
  const prepared = [...bag];
  if (variant === 'auto') return prepared;
  const jIndex = prepared.indexOf('J');
  const lIndex = prepared.indexOf('L');
  if (jIndex < 0 || lIndex < 0) throw new Error('Dot Cannon opening requires J and L in its 7-bag.');
  const alreadyMatches = variant === 'left-j' ? jIndex < lIndex : lIndex < jIndex;
  if (!alreadyMatches) [prepared[jIndex], prepared[lIndex]] = [prepared[lIndex], prepared[jIndex]];
  return prepared;
};

const DOT_CANNON: BuildDefinition = {
  id: 'dot-cannon',
  label: 'DOT CANNON',
  phases: {
    'bag-1': {
      label: 'BAG 1',
      meta: 'J FIRST = BASE · L FIRST = MIRROR',
      description: 'J가 L보다 먼저면 기본형, L이 먼저면 좌우대칭형을 구축하세요.',
    },
    'bag-2': {
      label: 'BAG 2',
      meta: 'FIXED · 180° · 100%',
      description: '완성된 1가방 바닥에서 중앙 아래 T-Spin Triple을 완성하세요.',
    },
    'pc-3': {
      label: '3-BAG PC',
      meta: 'SRS+180 · 87.58%',
      description: '가능한 해법이 선택된 3가방 Perfect Clear를 완성하세요.',
    },
    full: {
      label: 'FULL 3 BAGS',
      meta: 'BUILD → TST → PC',
      description: '첫 가방에서 형태를 고른 뒤 구축, TST, 3가방 PC를 연속으로 연습하세요.',
    },
  },
  openingVariantLabel: 'BAG 1 SIDE',
  openingVariantScope: 'BAG 1 · FULL ONLY',
  openingVariantPhases: ['bag-1', 'full'],
  openingVariants: [
    { id: 'auto', label: 'AUTO', detail: 'J/L 순서대로', summary: 'J FIRST = BASE · L FIRST = MIRROR' },
    { id: 'left-j', label: 'LEFT J', detail: 'J → L 가방만', summary: 'LEFT J · J BEFORE L' },
    { id: 'right-l', label: 'RIGHT L', detail: 'L → J 가방만', summary: 'RIGHT L · L BEFORE J' },
  ],
  prepareOpeningBag: prepareDotCannonOpeningBag,
};

export const BUILD_CATALOG: Record<BuildId, BuildDefinition> = {
  'dot-cannon': DOT_CANNON,
};

export const DEFAULT_BUILD_ID: BuildId = 'dot-cannon';

export const getBuildDefinition = (buildId: unknown) => (
  BUILD_CATALOG[buildId as BuildId] || BUILD_CATALOG[DEFAULT_BUILD_ID]
);

export const sanitizeBuildId = (buildId: unknown): BuildId => (
  Object.hasOwn(BUILD_CATALOG, String(buildId)) ? buildId as BuildId : DEFAULT_BUILD_ID
);

export const sanitizeBuildOpeningVariant = (
  buildId: unknown,
  variant: unknown,
): BuildOpeningVariant => {
  const definition = getBuildDefinition(buildId);
  return definition.openingVariants.some((option) => option.id === variant)
    ? variant as BuildOpeningVariant
    : definition.openingVariants[0].id;
};
