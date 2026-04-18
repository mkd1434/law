/**
 * change_logs에 content(longtext) 컬럼이 없으면 추가합니다.
 * 마이그레이션 0002/0004를 적용하지 못한 DB에서 조회·저장 오류를 막기 위한 보조 스크립트입니다.
 *
 * 사용: 프로젝트 루트 `.env`의 DATABASE_URL 또는 환경 변수 후 `pnpm db:ensure-content`
 */

import "dotenv/config";
import mysql from "mysql2/promise";

function mysqlUrlHostForLog(urlStr: string): string {
  try {
    const noScheme = urlStr.replace(/^mysql2?:\/\//i, "");
    const at = noScheme.indexOf("@");
    const hostPart = at >= 0 ? noScheme.slice(at + 1) : noScheme;
    const slash = hostPart.indexOf("/");
    const hostPort = slash >= 0 ? hostPart.slice(0, slash) : hostPart;
    const q = hostPort.indexOf("?");
    const hp = q >= 0 ? hostPort.slice(0, q) : hostPort;
    return hp || "(호스트 없음)";
  } catch {
    return "(파싱 불가)";
  }
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error(
      "[ensure-content] DATABASE_URL이 없습니다. ~/law/.env 에 설정하거나 export 하세요."
    );
    process.exit(1);
  }

  if (url.includes("...")) {
    console.error(
      "[ensure-content] DATABASE_URL에 '...'가 있습니다. 문서 예시 그대로가 아니라 실제 호스트·사용자·비밀번호·DB명으로 넣어 주세요."
    );
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

main().catch((e: unknown) => {
  const err = e as { code?: string; errno?: number; message?: string };
  if (err.code === "ENOTFOUND") {
    const host = mysqlUrlHostForLog(process.env.DATABASE_URL ?? "");
    console.error("[ensure-content] DB 호스트를 DNS에서 찾지 못했습니다 (ENOTFOUND).");
    console.error(`  시도한 host:port → ${host}`);
    console.error("  확인: RDS/내부망 엔드포인트 철자, VPC·보안그룹, 예시 mysql://... 그대로 사용 여부.");
    console.error("  팁: .env에 올바른 DATABASE_URL을 넣었다면 export 없이 pnpm db:ensure-content 만 실행해 보세요.");
    process.exit(1);
  }
  console.error("[ensure-content] 실패:", e);
  process.exit(1);
});
