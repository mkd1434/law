/**
 * 동기화 작업 스케줄러
 * 주기적으로 법령 및 행정규칙의 변동을 감지하고 수집
 */

import { getMonitoredItems } from '../db';
import {
  DEV_SYNC_LOOKBACK_DAYS_DEFAULT,
  LAW_CHANGE_HISTORY_LOOKBACK_YEARS,
  LAW_SYNC_LOOKBACK_DAYS_ENV,
  getSyncLookbackWindowDays,
  syncMonitoredLawsFromChangeHistory,
} from '../api/lawDetector';
import { detectAndCollectRuleChanges } from '../api/ruleDetector';

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

    console.log(`[SyncJob] ✅ Found ${laws.length} laws and ${rules.length} rules to monitor`);
    
    // 법령 목록 출력
    if (laws.length > 0) {
      console.log('[SyncJob] 📋 Laws to process:');
      laws.forEach((law, idx) => {
        console.log(`  ${idx + 1}. ${law.name} (ID: ${law.lawId})`);
      });
    }
    
    // 행정규칙 목록 출력
    if (rules.length > 0) {
      console.log('[SyncJob] 📋 Rules to process:');
      rules.forEach((rule, idx) => {
        console.log(`  ${idx + 1}. ${rule.name} (ID: ${rule.ruleId})`);
      });
    }

    // Step 3: 법령 — lsJoHstInf 기간 조회(연 단위 청크) + 모니터링 법령 매칭 → 조문 메타 저장, oldAndNew는 가능 시
    if (laws.length > 0) {
      const envLookback = process.env.LAW_LS_HST_LOOKBACK_YEARS;
      const win = getSyncLookbackWindowDays();
      const windowHint = win
        ? `${win.days}d (${win.label})`
        : `years: ${envLookback ?? LAW_CHANGE_HISTORY_LOOKBACK_YEARS} (production; dev uses ${DEV_SYNC_LOOKBACK_DAYS_DEFAULT}d without env)`;
      console.log(
        `[SyncJob] Laws: lsJoHstInf yearly chunks (${windowHint}; ${LAW_SYNC_LOOKBACK_DAYS_ENV} / LAW_LS_HST_* / LAW_LS_JO_CHUNK_DELAY_MS)...`
      );
      try {
        const result = await syncMonitoredLawsFromChangeHistory(
          laws.map((law) => ({
            itemId: law.itemId,
            mst: law.lawId,
            name: law.name,
          }))
        );
        console.log(
          `[SyncJob] Laws - Detected: ${result.detected}, Collected: ${result.collected}`
        );
        if (result.errors.length > 0) {
          console.warn('[SyncJob] Law errors:', result.errors);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn('[SyncJob] Law batch error:', errorMsg);
      }
    }

    // Step 4: 행정규칙 변동 감지 및 수집
    if (rules.length > 0) {
      console.log('[SyncJob] Processing rules...');
      let totalRuleDetected = 0;
      let totalRuleCollected = 0;
      const ruleErrors: string[] = [];

      for (const rule of rules) {
        try {
          const result = await detectAndCollectRuleChanges(rule.itemId, rule.name);
          totalRuleDetected += result.detected;
          totalRuleCollected += result.collected;
          ruleErrors.push(...result.errors);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          ruleErrors.push(`Error processing ${rule.name}: ${errorMsg}`);
        }
      }

      console.log(`[SyncJob] Rules - Detected: ${totalRuleDetected}, Collected: ${totalRuleCollected}`);
      if (ruleErrors.length > 0) {
        console.warn('[SyncJob] Rule errors:', ruleErrors);
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
