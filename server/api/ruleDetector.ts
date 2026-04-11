/**
 * 행정규칙 변동 감지 및 수집 로직
 * 행정규칙 목록 조회 API를 통해 변동을 감지하고 신구규칙 비교 데이터를 수집
 */

import { lawAPIClient } from './lawClient';
import { addChangeLog, getLatestChangeLogForItem } from '../db';
import { InsertChangeLog } from '../../drizzle/schema';

/**
 * 행정규칙 변동 감지 및 수집
 * @param itemId - monitored_items 테이블의 ID
 * @param ruleId - 법제처 API에서 사용하는 행정규칙 ID
 * @param ruleName - 행정규칙 이름
 * @param lastKnownDate - 마지막으로 알려진 발령일자 (DB에서 조회)
 */
export async function detectAndCollectRuleChanges(
  itemId: number,
  ruleId: string,
  ruleName: string,
  lastKnownDate?: Date
): Promise<{ detected: number; collected: number; errors: string[] }> {
  const errors: string[] = [];
  let detectedCount = 0;
  let collectedCount = 0;

  try {
    // Step 1: 행정규칙 목록 조회 (전체 리스트)
    console.log(`[Rule] Fetching rule list for ${ruleName} (ID: ${ruleId})`);
    const ruleList = await lawAPIClient.getAdminRuleList({ display: 100 });

    if (!ruleList || !ruleList.data) {
      errors.push(`No rule list found for ${ruleName}`);
      return { detected: 0, collected: 0, errors };
    }

    // Step 2: 해당 규칙 ID의 항목 필터링
    const rules = Array.isArray(ruleList.data) ? ruleList.data : [ruleList.data];
    const targetRules = rules.filter((rule: any) => {
      const id = rule.ruleId || rule.id;
      return id === ruleId;
    });

    if (targetRules.length === 0) {
      console.warn(`[Rule] No matching rules found for ${ruleName}`);
      return { detected: 0, collected: 0, errors };
    }

    // Step 3: DB와 대조하여 신규/미래 데이터 판별
    for (const rule of targetRules) {
      try {
        const announcementDate = parseDate(rule.announcementDate || rule.발령일자);
        const effectiveDate = parseDate(rule.effectiveDate || rule.시행일자);
        const announcementNo = rule.announcementNo || rule.공고번호 || '';
        const changeId = rule.changeId || rule.id;

        if (!effectiveDate || !announcementNo) {
          console.warn(`[Rule] Skipping rule due to missing data:`, rule);
          continue;
        }

        // 마지막 알려진 날짜보다 이후인지 확인
        if (lastKnownDate && announcementDate && announcementDate <= lastKnownDate) {
          console.log(`[Rule] Rule already known: ${announcementNo}`);
          continue;
        }

        // 오늘 날짜보다 미래인지 확인하여 status 결정
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const status = effectiveDate > today ? 'upcoming' : 'current';

        detectedCount++;

        // Step 4: 신구규칙 비교 본문 조회
        console.log(`[Rule] Fetching comparison data for change ${changeId}`);
        const comparisonData = await lawAPIClient.getAdminRuleComparison({ ID: changeId });

        // Step 5: DB에 저장
        const changeLog: InsertChangeLog = {
          itemId,
          announcementNo,
          effectiveDate,
          status: status as 'current' | 'upcoming',
          comparisonData: comparisonData || null,
          rawData: rule,
        };

        await addChangeLog(changeLog);
        collectedCount++;

        console.log(`[Rule] Successfully collected change: ${announcementNo}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Rule] Error processing rule:`, errorMsg);
        errors.push(`Error processing rule: ${errorMsg}`);
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Rule] Error detecting changes for ${ruleName}:`, errorMsg);
    errors.push(`Error detecting changes: ${errorMsg}`);
  }

  return { detected: detectedCount, collected: collectedCount, errors };
}

/**
 * 날짜 파싱 유틸리티
 * 다양한 형식의 날짜 문자열을 Date 객체로 변환
 */
function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;

  // YYYYMMDD 형식
  if (/^\d{8}$/.test(dateStr)) {
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6)) - 1;
    const day = parseInt(dateStr.substring(6, 8));
    return new Date(year, month, day);
  }

  // YYYY-MM-DD 형식
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(dateStr);
  }

  // ISO 8601 형식
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date;
    }
  } catch (e) {
    // 파싱 실패
  }

  return null;
}

/**
 * 여러 행정규칙에 대해 변동 감지 및 수집 수행
 */
export async function detectAndCollectAllRules(
  rules: Array<{ itemId: number; ruleId: string; name: string; lastKnownDate?: Date }>
): Promise<{ totalDetected: number; totalCollected: number; errors: string[] }> {
  let totalDetected = 0;
  let totalCollected = 0;
  const allErrors: string[] = [];

  for (const rule of rules) {
    try {
      const result = await detectAndCollectRuleChanges(
        rule.itemId,
        rule.ruleId,
        rule.name,
        rule.lastKnownDate
      );
      totalDetected += result.detected;
      totalCollected += result.collected;
      allErrors.push(...result.errors);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Rule] Error processing rule ${rule.name}:`, errorMsg);
      allErrors.push(`Error processing rule ${rule.name}: ${errorMsg}`);
    }
  }

  return { totalDetected, totalCollected, errors: allErrors };
}
