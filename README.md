# STACK//LAB

고정 60Hz 시뮬레이션과 Canvas 2D 렌더링을 사용하는 스태커 트레이너입니다.

`BUILD` 모드에서는 도트 캐논 1가방의 좌·우 형태, 완성된 1가방 바닥에서 시작해 중앙 아래 홈의 T-Spin Triple로 마무리하는 2가방 형태, 8개 해법을 사용하는 3가방 PC를 실제 7-bag으로 연습할 수 있습니다. 1가방은 J/L 순서를 따르는 자동 출제 외에도 LEFT J 기본형 또는 RIGHT L 대칭형만 선택해 반복할 수 있습니다. `FULL 3 BAGS`에서는 세 단계를 하나의 보드에서 연속으로 진행하며, 첫 가방에서 선택한 형태를 세 단계 내내 유지합니다. 3가방 PC는 TETR.IO식 SRS+·180° 기준으로 전체 5,040개 순서를 빌드 전에 계산한 정적 테이블을 사용해 PC 가능 여부와 가능한 해법 수를 즉시 안내합니다. 초보(미노별 목표), 중수(전체 실루엣), 고수(가이드 없음) 난이도와 실패 후 같은 가방/새 가방 재시도 정책을 지원하며, 성공하면 항상 새로운 가방으로 넘어갑니다.

## 개발

```bash
npm install
npm run dev
```

런타임 스택은 프레임워크 없는 TypeScript, Canvas 2D, Web Audio입니다. Vite 8은 개발 서버와 프로덕션 번들만 담당하며, 실제 배포물에는 UI 프레임워크나 서드파티 런타임 의존성이 포함되지 않습니다.

데스크톱 UI는 1920×1080을 100% 기준으로 자동 확대됩니다. QHD에서는 약 133%, 4K에서는 200%가 적용되며, `CONFIG → VISUAL → INTERFACE SCALE`에서 100–200% 고정 배율로 변경할 수 있습니다. 모바일과 작은 창은 기존 100% 레이아웃을 유지합니다.

## 검증

```bash
npm run typecheck
npm test
npm run build
```

로컬 개발 서버를 실행한 상태에서 Chrome/Edge 기반 브라우저 스모크 테스트도 실행할 수 있습니다.

```bash
npm run smoke
```

프로덕션 결과물은 `dist/`에 생성됩니다. `base: './'` 설정을 사용하므로 정적 호스팅이나 하위 경로에도 배포할 수 있습니다.

## 구조

```text
src/
  audio/audio-engine.ts   Web Audio 효과음
  builds/catalog.ts       빌드 목록, 단계 설명과 빌드별 첫 가방 출제 정책
  core/state.ts           설정, 규칙 상수, 공용 유틸리티와 로컬 상태
  game/game-engine.ts     고정 60Hz 게임 시뮬레이션
  game/build.ts           빌드 세션 생성, 목표 판정, 도움말과 진도 모델
  game/dot-cannon-pc.ts   도트 캐논 PC 해법·도달 가능성·7-bag 판정
  game/randomizer.ts      시드 기반 7-bag/14-bag 생성기
  input/input-manager.ts  키보드·게임패드 입력 큐
  render/renderer.ts      Canvas 2D 렌더링과 파티클
  ui/bridge.ts            엔진과 DOM UI 사이의 명시적 연결
  ui/viewport-scale.ts    4K 대응 전체 인터페이스 배율
  main.ts                 DOM 이벤트와 앱 부트스트랩
```

`standalone.html`은 마이그레이션 전 동작 비교를 위한 원본으로 보존합니다.
