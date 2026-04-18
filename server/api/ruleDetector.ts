/**
 * 행정규칙 변동 감지 및 수집 로직
 * 행정규칙(고시) 목록 조회 API를 통해 변동을 감지하고 신구규칙 비교 데이터를 수집
 */

import { lawAPIClient } from './lawClient';
import { addChangeLog, getLatestChangeLogForItem, type ChangeLogWritePayload } from '../db';

/**
 * 행정규칙 변동 감지 및 수집
 * @param itemId - monitored_items 테이블의 ID
 * @param ruleName - 행정규칙 이름 (고시명)
 * @param lastKnownDate - 마지막으로 알려진 발령일자 (DB에서 조회)
 */
export async function detectAndCollectRuleChanges(
  itemId: number,
  ruleName: string,
  lastKnownDate?: Date
): Promise<{ detected: number; collected: number; errors: string[] }> {
  console.log(`\n[Rule] 🔍 Processing: ${ruleName}`);
  const errors: string[] = [];
  let detectedCount = 0;
  let collectedCount = 0;

  try {
    // Step 1: 행정규칙 목록 조회 (3년 범위)
    console.log(`[Rule] 📋 Fetching admin rules for ${ruleName}`);
    
    const today = new Date();
    const threeYearsAgo = new Date(today.getFullYear() - 3, today.getMonth(), today.getDate());
    const startDate = formatDateForAPI(threeYearsAgo);
    const endDate = formatDateForAPI(today);

    const ruleList = await lawAPIClient.getAdminRulesByDateRange(startDate, endDate);

    if (!ruleList || !ruleList.data) {
      console.log(`[Rule] ℹ️  No admin rules found for ${ruleName}`);
      return { detected: 0, collected: 0, errors: [] };
    }

    // Step 2: 해당 고시명의 항목 필터링
    const rules = Array.isArray(ruleList.data) ? ruleList.data : [ruleList.data];
    const targetRules = rules.filter((rule: any) => {
      return rule.법령명 && rule.법령명.includes(ruleName);
    });

    if (targetRules.length === 0) {
      console.warn(`[Rule] No matching rules found for ${ruleName}`);
      return { detected: 0, collected: 0, errors };
    }

    console.log(`[Rule] ✅ Found ${targetRules.length} matching rules`);

    // Step 3: DB와 대조하여 신규/미래 데이터 판별
    for (const rule of targetRules) {
      try {
        const announcementDate = parseDate(rule.발령일자);
        const effectiveDate = parseDate(rule.시행일자);
        const announcementNo = rule.공고번호 || '';
        const ruleLid = rule.법령LID;

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
        if (ruleLid) {
          console.log(`[Rule] Fetching comparison data for LID ${ruleLid}`);
          const comparisonData = await lawAPIClient.getAdminRuleComparison(ruleLid);

          // Step 5: DB에 저장
          const changeLog: ChangeLogWritePayload = {
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
        }
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
 * 날짜 포맷팅 (YYYYMMDD)
 */
function formatDateForAPI(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
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
  rules: Array<{ itemId: number; name: string; lastKnownDate?: Date }>
): Promise<{ totalDetected: number; totalCollected: number; errors: string[] }> {
  let totalDetected = 0;
  let totalCollected = 0;
  const allErrors: string[] = [];

  for (const rule of rules) {
    try {
      const result = await detectAndCollectRuleChanges(
        rule.itemId,
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
