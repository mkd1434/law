/**
 * 법령 데이터 수집 테스트 스크립트
 * 18개 법령에 대해 최근 변경이력을 조회하고 DB에 저장
 */

import { getDb } from '../db';
import { detectAndCollectLawChanges } from '../api/lawDetector';
import { monitoredItems } from '../../drizzle/schema';
import { eq, and } from 'drizzle-orm';

async function runTestSync() {
  console.log('[TestSync] 법령 데이터 수집 테스트 시작...\n');

  try {
    const db = await getDb();
    if (!db) {
      console.error('[TestSync] 데이터베이스 연결 실패');
      return;
    }

    // 모니터링 대상 조회
    const items = await db
      .select()
      .from(monitoredItems)
      .where(and(eq(monitoredItems.type, 'law'), eq(monitoredItems.isActive, 1)));

    console.log(`[TestSync] 조회된 모니터링 대상: ${items.length}개\n`);

    if (items.length === 0) {
      console.warn('[TestSync] 모니터링 대상이 없습니다.');
      return;
    }

    // 각 항목에 대해 변동 감지 및 수집
    let totalDetected = 0;
    let totalCollected = 0;
    const allErrors: string[] = [];

    for (const item of items) {
      try {
        console.log(`[TestSync] 처리 중: ${item.name} (ID: ${item.id}, MST: ${item.externalId})`);

        const result = await detectAndCollectLawChanges(
          item.id,
          item.externalId || '',
          item.name
        );

        totalDetected += result.detected;
        totalCollected += result.collected;
        allErrors.push(...result.errors);

        const errorCount = result.errors.length > 0 ? `, 에러: ${result.errors.length}개` : '';
        console.log(`  → 감지: ${result.detected}개, 수집: ${result.collected}개${errorCount}\n`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[TestSync] 오류: ${errorMsg}\n`);
        allErrors.push(`Error processing ${item.name}: ${errorMsg}`);
      }
    }

    console.log('\n[TestSync] 테스트 완료');
    console.log(`  총 감지: ${totalDetected}개`);
    console.log(`  총 수집: ${totalCollected}개`);
    if (allErrors.length > 0) {
      console.log(`  에러: ${allErrors.length}개`);
      allErrors.slice(0, 5).forEach((err: string) => console.log(`    - ${err}`));
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[TestSync] 테스트 실패:', errorMsg);
  }
}

// 실행
runTestSync().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
