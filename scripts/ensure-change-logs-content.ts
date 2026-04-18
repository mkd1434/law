/**
 * change_logs에 content(longtext) 컬럼이 없으면 추가합니다.
 * 마이그레이션 0002/0004를 적용하지 못한 DB에서 조회·저장 오류를 막기 위한 보조 스크립트입니다.
 *
 * 사용: DATABASE_URL 설정 후 `pnpm db:ensure-content`
 */

import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[ensure-content] DATABASE_URL가 없습니다.");
    process.exit(1);
  }

  const conn = await mysql.createConnection(url);
  try {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'change_logs'
         AND COLUMN_NAME = 'content'`
    );
    const c = Number((rows as { c: number | string }[])[0]?.c ?? 0);
    if (c > 0) {
      console.log("[ensure-content] content 컬럼이 이미 있습니다. 변경 없음.");
      return;
    }

    await conn.query("ALTER TABLE `change_logs` ADD COLUMN `content` longtext");
    console.log("[ensure-content] content longtext 컬럼을 추가했습니다.");
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error("[ensure-content] 실패:", e);
  process.exit(1);
});
