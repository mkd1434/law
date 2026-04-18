/**
 * 동기화 잡만 실행 (TRUNCATE 없음)
 * 사용: pnpm exec tsx scripts/run-sync-job.ts
 */
import "dotenv/config";
import { runSyncJob } from "../server/jobs/syncMonitor";

runSyncJob()
  .then(() => {
    console.log("[run-sync-job] 완료");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
