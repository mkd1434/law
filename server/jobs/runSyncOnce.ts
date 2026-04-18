/**
 * 모니터링 동기화 1회 실행 (CLI)
 *
 * 사용: 프로젝트 루트에서 DATABASE_URL 설정 후
 *   pnpm sync
 *
 * 개발과 동일한 기본 창(31일)을 쓰려면:
 *   cross-env NODE_ENV=development pnpm sync
 *
 * 일수만 지정(운영에서 짧게 테스트):
 *   LAW_SYNC_LOOKBACK_DAYS=31 pnpm sync
 */

import "dotenv/config";
import { runSyncJob } from "./syncMonitor";

runSyncJob()
  .then(() => {
    console.log("[sync] 완료");
    process.exit(0);
  })
  .catch((e) => {
    console.error("[sync] 실패:", e);
    process.exit(1);
  });
