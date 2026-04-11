/**
 * 동기화 작업 스케줄러
 * 주기적으로 법령 및 행정규칙의 변동을 감지하고 수집
 */

import { getMonitoredItems } from '../db';
import { detectAndCollectAllLaws } from '../api/lawDetector';
import { detectAndCollectAllRules } from '../api/ruleDetector';

/**
 * 모니터링 동기화 작업 실행
 */
export async function runSyncJob(): Promise<void> {
  console.log('[SyncJob] Starting monitoring sync job...');
  const startTime = Date.now();

  try {
    // Step 1: 활성화된 모니터링 대상 조회
    const allItems = await getMonitoredItems({ isActive: true });
    const items = Array.isArray(allItems) ? allItems : [];

    if (items.length === 0) {
      console.log('[SyncJob] No monitored items found');
      return;
    }

    // Step 2: 법령과 행정규칙 분리
    const laws = items
      .filter((item: any) => item.type === 'law')
      .map((item: any) => ({
        itemId: item.id,
        lawId: item.externalId || item.name,
        name: item.name,
      }));

    const rules = items
      .filter((item: any) => item.type === 'rule')
      .map((item: any) => ({
        itemId: item.id,
        ruleId: item.externalId || item.name,
        name: item.name,
      }));

    console.log(`[SyncJob] Found ${laws.length} laws and ${rules.length} rules to monitor`);

    // Step 3: 법령 변동 감지 및 수집
    if (laws.length > 0) {
      console.log('[SyncJob] Processing laws...');
      const lawResults = await detectAndCollectAllLaws(laws);
      console.log(`[SyncJob] Laws - Detected: ${lawResults.totalDetected}, Collected: ${lawResults.totalCollected}`);
      if (lawResults.errors.length > 0) {
        console.warn('[SyncJob] Law errors:', lawResults.errors);
      }
    }

    // Step 4: 행정규칙 변동 감지 및 수집
    if (rules.length > 0) {
      console.log('[SyncJob] Processing rules...');
      const ruleResults = await detectAndCollectAllRules(rules);
      console.log(`[SyncJob] Rules - Detected: ${ruleResults.totalDetected}, Collected: ${ruleResults.totalCollected}`);
      if (ruleResults.errors.length > 0) {
        console.warn('[SyncJob] Rule errors:', ruleResults.errors);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[SyncJob] Sync job completed in ${duration}ms`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[SyncJob] Error during sync job:', errorMsg);
    throw error;
  }
}

/**
 * 스케줄러 시작 (간단한 구현)
 * 실제 배포 환경에서는 node-cron, agenda 등의 라이브러리 사용 권장
 */
export function startScheduler(intervalHours: number = 6): NodeJS.Timeout {
  console.log(`[Scheduler] Starting scheduler with ${intervalHours}h interval`);

  // 초기 실행
  runSyncJob().catch(error => {
    console.error('[Scheduler] Initial sync job failed:', error);
  });

  // 주기적 실행
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const timer = setInterval(() => {
    runSyncJob().catch(error => {
      console.error('[Scheduler] Periodic sync job failed:', error);
    });
  }, intervalMs);

  return timer;
}

/**
 * 스케줄러 중지
 */
export function stopScheduler(timer: NodeJS.Timeout): void {
  clearInterval(timer);
  console.log('[Scheduler] Scheduler stopped');
}
