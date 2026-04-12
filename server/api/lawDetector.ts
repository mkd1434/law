/**
 * 법령 개정 감시 엔진
 * 
 * 1. 날짜별 법령 개정 이력 조회 (lsHstInf)
 * 2. 감시 대상 법령 필터링
 * 3. 신구법 비교 데이터 조회 (oldAndNew)
 * 4. 행정규칙 조회 (admrul)
 */

import { lawAPIClient } from './lawClient';
import { getDb, upsertChangeLog } from '../db';
import { monitoredItems } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

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
 * 날짜 범위 생성 (시작일부터 종료일까지 매일)
 */
function getDateRange(startDate: Date, endDate: Date): string[] {
  const dates: string[] = [];
  const current = new Date(startDate);

  while (current <= endDate) {
    dates.push(formatDateForAPI(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * 법령 개정 감시 (법령 + 행정규칙)
 */
export async function detectAndCollectLawChanges(
  itemId: number,
  externalId: string,
  lawName: string
): Promise<{ detected: number; collected: number; errors: string[] }> {
  const errors: string[] = [];
  let detected = 0;
  let collected = 0;

  try {
    console.log(`[Law] 🔍 Processing: ${lawName} (MST: ${externalId})`);

    // 3년 범위 계산
    const today = new Date();
    const threeYearsAgo = new Date(today.getFullYear() - 3, today.getMonth(), today.getDate());
    const regDt = formatDateForAPI(threeYearsAgo);

    console.log(`[Law] 📅 Date range: ${regDt} ~ ${formatDateForAPI(today)} (3 years)`);

    // 법령 vs 행정규칙 분기
    if (lawName.includes('고시')) {
      // === 행정규칙(고시) 처리 ===
      console.log(`[Law] 📋 Processing as ADMIN RULE (고시): ${lawName}`);
      
      const adminRuleResponse = await lawAPIClient.getAdminRulesByDateRange(regDt, formatDateForAPI(today));

      if (!adminRuleResponse || !adminRuleResponse.data) {
        console.warn(`[Law] ⚠️  No admin rules found for ${lawName}`);
        return { detected: 0, collected: 0, errors };
      }

      const adminRules = Array.isArray(adminRuleResponse.data) ? adminRuleResponse.data : [];
      console.log(`[Law] ✅ Found ${adminRules.length} admin rules`);

      // 감시 대상 고시 찾기
      for (const rule of adminRules) {
        if (rule.법령명 && rule.법령명.includes(lawName)) {
          detected++;
          console.log(`[Law] 📌 Matched admin rule: ${rule.법령명}`);

          // 신구규칙 비교 조회
          if (rule.법령LID) {
            const comparisonResponse = await lawAPIClient.getAdminRuleComparison(rule.법령LID);
            if (comparisonResponse) {
              collected++;
              console.log(`[Law] ✅ Collected comparison data for: ${rule.법령명}`);
            }
          }
        }
      }
    } else {
      // === 법령(법률, 령, 규칙) 처리 ===
      console.log(`[Law] 📋 Processing as LAW (법령): ${lawName}`);

      // 신구법 비교 조회 (직접 MST 사용)
      const comparisonResponse = await lawAPIClient.getLawComparison(externalId);

      if (comparisonResponse) {
        detected++;
        
        // DB에 변경 로그 저장
        try {
          // API 응답에서 efYd (시행일자) 추출
          let effectiveDate = new Date();
          if (comparisonResponse?.efYd) {
            // 날짜 형식: YYYYMMDD -> Date 객체로 변환
            const efYdStr = String(comparisonResponse.efYd);
            console.log(`[DB Save] efYd: ${efYdStr} (raw value from API)`);
            if (efYdStr.length === 8) {
              const year = parseInt(efYdStr.substring(0, 4));
              const month = parseInt(efYdStr.substring(4, 6));
              const day = parseInt(efYdStr.substring(6, 8));
              effectiveDate = new Date(year, month - 1, day);
              console.log(`[Law] 📅 Extracted efYd: ${efYdStr} -> ${effectiveDate.toISOString()}`);
              console.log(`[DB Save] Parsed date: year=${year}, month=${month}, day=${day}`);
            } else {
              console.warn(`[DB Save] Invalid efYd format: ${efYdStr} (expected 8 digits)`);
            }
          } else {
            console.warn(`[DB Save] No efYd in response, using current date`);
          }
          
          console.log(`[DB Save] Saving to DB - announcementNo: MST-${externalId}, effectiveDate: ${effectiveDate.toISOString()}`);
          await upsertChangeLog({
            itemId,
            announcementNo: `MST-${externalId}`,
            effectiveDate,
            status: 'current',
            comparisonData: comparisonResponse,
            rawData: comparisonResponse,
          });
          collected++;
          console.log(`[Law] ✅ Saved law comparison for MST: ${externalId}, effectiveDate: ${effectiveDate.toISOString()}`);
        } catch (saveError) {
          const saveErrorMsg = saveError instanceof Error ? saveError.message : String(saveError);
          console.error(`[Law] ❌ Failed to save law comparison: ${saveErrorMsg}`);
          errors.push(`Failed to save: ${saveErrorMsg}`);
        }
      } else {
        console.warn(`[Law] ⚠️  No comparison data found for MST: ${externalId}`);
      }
    }

    if (detected > 0) {
      console.log(`[Law] ✅ Found ${detected} changes for ${lawName}`);
    } else {
      console.log(`[Law] ℹ️  No changes found for ${lawName}`);
    }

    return { detected, collected, errors };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Law] ❌ Error processing ${lawName}:`, errorMsg);
    errors.push(errorMsg);
    return { detected: 0, collected: 0, errors };
  }
}
