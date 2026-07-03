# Armchair 로드맵 — 시뮬레이션에서 실물까지

기획서(2026-07-03)의 단계별 계획을 실행 기준으로 정리한 문서. 원칙: **리스크가 낮은 시뮬레이션에서 먼저 완성하고, 검증된 것만 실물로 이식한다.**

## 0단계 — 기반 (완료)

- [x] 목표 태스크 선정: 큐브 집어서 통에 넣기 (pick-and-place)
- [x] SO-101 관절 구성·LeRobot 데이터 포맷 조사 반영 (joint 순서, observation/action 레이아웃)
- [x] 개발 환경: Vite + React + Three.js(R3F), Python 스크립트

## 1단계 — 웹 텔레오퍼레이션 (완료, v0.1)

- [x] SO-101 형상의 5-DOF+그리퍼 아암 3D 모델 (프로시저럴, 외부 에셋 無)
- [x] 해석적 IK (elbow-up, 접근 각도 조절) + 서보 속도 제한
- [x] 드래그 타깃 조종 (XZ 평면 + Shift 수직) / 관절 슬라이더 모드
- [x] 30 Hz 에피소드 레코딩·재생, 성공 자동 판정, localStorage 보존
- [x] LeRobot 호환 내보내기 (`dataset.json` → `convert_to_lerobot.py`)
- [x] 실물 브릿지 (`so101_bridge.py`, WebSocket 30 Hz 스트리밍)
- [x] 웹캠 손 추적 텔레오퍼레이션 (MediaPipe HandLandmarker, 브라우저 내 추론 — 손 위치→타깃, 원근→리치, 핀치→그리퍼)

## 1.5단계 — v0.2 업그레이드 (완료)

- [x] 공식 SO-101 URDF/STL 모델 로딩 + 기구학 실측 캘리브레이션 (관절 프레임 측정, R0 오프셋, 접근각 자동 완화 IK)
- [x] Rapier(WASM) 강체 물리 — 큐브 낙하·밀림·통 충돌, 파지는 안정성 위해 키네마틱 유지
- [x] 카메라 관측 2뷰 (front 고정 + wrist 사이드마운트, 320×240, 기즈모 레이어 제외, sRGB 보정)
- [x] ZIP 내보내기 (fflate) + 변환기 영상 스트림 지원
- [x] 브라우저 정책 재생 (onnxruntime-web, obs[1,9]→action 청크) + 더미 모델 파이프라인 검증

## 2단계 — 정책 학습 (다음)

- [x] ACT 학습 튜토리얼 (docs/TRAINING.md) + ONNX 변환기 (scripts/export_policy_onnx.py)
- [ ] 실제 ACT 정책 학습·시뮬 내 성공률 벤치마크 (자동 롤아웃 평가)
- [ ] 에피소드 품질 자동 스코어링 (길이·부드러움·성공 여부)

## 3단계 — 실물 이식 (sim2real)

- [ ] SO-101 키트 구매·조립 (Seeed Studio, 약 $100~130)
- [ ] lerobot 캘리브레이션 → 브릿지 `--dry-run` 으로 부호/오프셋 확정
- [ ] 브라우저 텔레오퍼레이션으로 실물 데이터 수집 (웹캠 2대 병행)
- [ ] 시뮬 학습 정책 실물 검증, 격차 보정 (도메인 랜덤화)

## 4단계 — 공개 (v0.1 릴리스)

- [ ] 데모 GIF·1분 영상 제작 (README 최상단 `docs/assets/demo.gif`)
- [ ] GitHub 공개: 레포 설명 한 문장 고정 — "browser teleoperation & data collection for SO-101"
- [ ] Show HN / r/robotics / r/MachineLearning / X / LeRobot Discord 공유
- [ ] LeRobot Hub에 샘플 데이터셋 업로드 (커뮤니티 유입 경로)

## 배포 체크리스트 (기획서 6장 요약)

- README 최상단: 한 줄 설명 + 데모 GIF — 이 GIF가 스타의 8할
- 설치는 한 줄 (`npm run dev`), 실물 없이도 전 기능 체험 가능해야 함
- 범위를 좁게 유지: "만능 프레임워크"가 아니라 "브라우저 데이터 수집" 한 문장
- LeRobot 표준 포맷·Hub 호환 유지 — 기존 커뮤니티가 곧 사용자층
