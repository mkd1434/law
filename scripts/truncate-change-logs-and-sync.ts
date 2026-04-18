/**
 * change_logs 비우고 동기화 잡을 다시 실행 (운영/복구용)
 * 사용: pnpm exec tsx scripts/truncate-change-logs-and-sync.ts
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { runSyncJob } from "../server/jobs/syncMonitor";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }

  const conn = await mysql.createConnection(url);
  await conn.query("TRUNCATE TABLE change_logs");
  await conn.end();
  console.log("[truncate-change-logs-and-sync] TRUNCATE change_logs 완료");

  await runSyncJob();
  console.log("[truncate-change-logs-and-sync] runSyncJob 완료");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
