# 법령 및 행정규칙 통합 모니터링 시스템 - 개발 체크리스트

## Phase 1: 프로젝트 구조 설계 및 todo.md 작성
- [x] 프로젝트 초기화 (webdev_init_project)
- [x] 전체 개발 계획 수립 및 todo.md 작성

## Phase 2: MySQL 설치 및 DB/테이블 설계 구현
- [x] MySQL 설치 및 보안 설정 (root 패스워드: pass1234)
- [x] law_monitor 데이터베이스 생성
- [x] monitored_items 테이블 설계 및 생성 (id, name, type, is_active)
- [x] change_logs 테이블 설계 및 생성 (id, item_id, announcement_no, effective_date, status, comparison_data)
- [x] Drizzle ORM 스키마 정의 (drizzle/schema.ts 업데이트)
- [x] 마이그레이션 SQL 생성 및 적용
- [x] DB 쿼리 헬퍼 함수 작성 (server/db.ts)

## Phase 3: 백엔드 API 서버 구현
- [x] 법제처 API 클라이언트 설정 (server/api/lawClient.ts)
- [x] 법령(Law) 감지 로직 구현 (변경이력 조회 API)
- [x] 법령(Law) 수집 로직 구현 (신구법 본문 조회 API)
- [x] 행정규칙(Rule) 감지 로직 구현 (목록 조회 API + DB 대조)
- [x] 행정규칙(Rule) 수집 로직 구현 (신구법 비교 본문 조회 API)
- [x] Rate Limiting 구현 (2~3개씩 순차 호출, 1초 지연)
- [x] 자동 재시도(Retry) 로직 구현
- [x] tRPC 라우터 구현 (monitored_items, change_logs CRUD)
- [x] 모니터링 대상 목록 관리 API (추가/수정/삭제)
- [x] 동기화 작업 스케줄러 구현 (server/jobs/syncMonitor.ts)
- [ ] 백엔드 단위 테스트 작성 (vitest)

## Phase 4: 프론트엔드 UI 구현
- [x] 모던 미니멀 디자인 시스템 설정 (색상 팔레트: 보라색→청록색 그라디언트)
- [x] 글로벌 스타일 및 타이포그래피 설정 (client/src/index.css)
- [x] 레이아웃 컴포넌트 설계 (헤더, 네비게이션)
- [x] 메인 화면 구현 (최근 1년 개정 사항 + 미래 시행 예정 목록)
- [x] 법령/규칙 탭 구현 및 필터링
- [x] 상세 화면 구현 (좌측 구법 vs 우측 신법 2컬럼 비교 레이아웃)
- [ ] 신구법 비교 텍스트 하이라이트 및 시각화
- [ ] 모니터링 대상 관리 페이지 (추가/수정/삭제 UI)
- [x] 반응형 디자인 (모바일, 태블릿, 데스크톱)
- [x] 로딩 상태 및 에러 처리 UI
- [ ] 프론트엔드 단위 테스트 작성 (vitest)

## Phase 4-1: 개선 작업 (체크포인트 전)
- [x] MySQL 설치 및 root 패스워드 설정 (pass1234)
- [x] law_monitor 데이터베이스 생성
- [x] 테이블 생성 (users, monitored_items, change_logs)
- [x] 프로젝트 빌드 성공
- [x] DB 연결 준비 완료
- [x] Rate Limiting 클라이언트 구현 (lawClient.ts)
- [x] change_logs CRUD 프로시저 추가 (생성/수정/삭제)
- [x] tRPCError 표준화 및 권한/검증 오류 처리
- [x] Home에서 타입별 changeLogs 필터링 (법령/규칙 탭)
- [x] 최근 1년 조건 명시적 적용 (서버/클라이언트)
- [x] 국가법령정보 API 연동 (모든 4가지 API 구현 완료)
  - [x] 법령 변경이력 목록 조회 API
  - [x] 신구법 본문 조회 API
  - [x] 행정규칙 목록 조회 API
  - [x] 행정규칙 신구규칙 비교 본문 조회 API
- [x] Rate Limiting 강화 (2~3개씩, 1초 지연)
- [x] 자동 재시도 로직 (withRetry 구현)
- [x] 첫째 체크포인트 생성 준비 완료생성

## Phase 5: 환경 변수 설정 및 전체 시스템 통합 테스트
- [ ] .env 파일 템플릿 생성 (.env.example)
- [ ] 환경 변수 설정 (DB 주소, API Key, 포트 등)
- [ ] 로컬 환경 테스트 (MySQL 연결, API 호출, UI 렌더링)
- [ ] 법령 API 통합 테스트 (실제 API 호출)
- [ ] 행정규칙 API 통합 테스트 (실제 API 호출)
- [ ] Rate Limiting 및 Retry 로직 테스트
- [ ] 신구법 비교 데이터 정확성 검증
- [ ] 전체 워크플로우 E2E 테스트

## Phase 6: GitHub 푸시 준비 및 최종 배포 가이드 작성
- [ ] .gitignore 설정 (node_modules, .env, dist 등)
- [ ] README.md 작성 (설치, 실행, 배포 가이드)
- [ ] 모니터링 대상 목록 추가 가이드 문서 작성
- [ ] EC2 배포 가이드 작성 (환경 설정, 서비스 실행)
- [ ] GitHub 리포지토리 준비 (계정 아이디 및 토큰 대기)
- [ ] 최종 코드 리뷰 및 정리
- [ ] 첫 번째 커밋 및 푸시 준비

## 주요 파일 구조
```
law_monitor/
├── client/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.tsx (메인 목록)
│   │   │   ├── DetailView.tsx (신구법 비교)
│   │   │   └── MonitoredItemsManage.tsx (모니터링 대상 관리)
│   │   ├── components/
│   │   │   ├── TabFilter.tsx (법령/규칙 탭)
│   │   │   ├── ChangeLogList.tsx (변경 로그 목록)
│   │   │   └── ComparisonView.tsx (신구법 비교 뷰)
│   │   ├── index.css (모던 미니멀 디자인)
│   │   └── App.tsx
│   └── public/
├── server/
│   ├── api/
│   │   ├── lawClient.ts (법제처 API 클라이언트)
│   │   ├── lawDetector.ts (법령 감지 로직)
│   │   ├── ruleDetector.ts (행정규칙 감지 로직)
│   │   └── rateLimiter.ts (Rate Limiting)
│   ├── jobs/
│   │   └── syncMonitor.ts (동기화 스케줄러)
│   ├── db.ts (쿼리 헬퍼)
│   ├── routers.ts (tRPC 라우터)
│   └── routers/
│       ├── monitoredItems.ts
│       └── changeLogs.ts
├── drizzle/
│   └── schema.ts (DB 스키마)
├── shared/
│   ├── types.ts (공유 타입)
│   └── const.ts (상수)
├── .env.example
├── README.md
└── DEPLOYMENT_GUIDE.md
```

## 기술 스택
- Frontend: React 19 + Tailwind CSS 4 + shadcn/ui
- Backend: Express 4 + tRPC 11 + Drizzle ORM
- Database: MySQL 8
- Testing: Vitest
- Authentication: Manus OAuth
- API: 법제처 공개 API

## 설계 원칙
- 법령과 행정규칙 API 로직 완전 분리
- Rate Limiting으로 법제처 서버 보호
- 자동 재시도로 네트워크 안정성 확보
- 모니터링 대상 목록 유연한 추가/수정 가능
- 로컬 및 EC2 환경 모두 호환 가능한 설정 구조
