/**
 * 법령 개정 감시 엔진
 * 
 * 1. oldAndNew API만 호출 (개별 MST)
 * 2. 한글 시행일자 필드 우선 읽기
 * 3. 시행일자가 20230415 이후인 것만 DB 저장
 * 4. Rate Limit 1초 간격 유지
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
 * 시행일자가 기준일 이후인지 확인
 * @param effectiveDateStr - YYYYMMDD 형식의 시행일자
 * @param baseDate - 기준일 (기본값: 2023-04-15)
 */
function isEffectiveDateAfter(effectiveDateStr: string, baseDate: string = '20230415'): boolean {
  if (!effectiveDateStr || effectiveDateStr.length !== 8) {
    console.warn(`[DateFilter] ⚠️  Invalid date format: ${effectiveDateStr}`);
    return false;
  }
  
  const numericDate = parseInt(effectiveDateStr);
  const numericBase = parseInt(baseDate);
  
  return numericDate >= numericBase;
}

/**
 * 법령 개정 감시 (법령 + 행정규칙)
 * 
 * 변경된 로직:
 * 1. oldAndNew API만 호출 (각 법령 MST마다 1회)
 * 2. 한글 시행일자 필드 우선 읽기
 * 3. 시행일자 >= 20230415인 것만 저장
 * 4. 1초 간격 유지
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

    // 법령 vs 행정규칙 분기
    if (lawName.includes('고시')) {
      // === 행정규칙(고시) 처리 ===
      console.log(`[Law] 📋 Processing as ADMIN RULE (고시): ${lawName}`);
      
      // 3년 범위 계산
      const today = new Date();
      const threeYearsAgo = new Date(today.getFullYear() - 3, today.getMonth(), today.getDate());
      const startDate = formatDateForAPI(threeYearsAgo);
      const endDate = formatDateForAPI(today);

      const adminRuleResponse = await lawAPIClient.getAdminRulesByDateRange(startDate, endDate);

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

      // oldAndNew API 호출 (직접 MST 사용)
      const comparisonResponse = await lawAPIClient.getLawComparison(externalId);

      if (comparisonResponse) {
        detected++;
        
        // DB에 변경 로그 저장
        try {
          // 한글 시행일자 필드 추출 (우선순위)
          let effectiveDate = new Date();
          let efYdStr = formatDateForAPI(new Date()); // 기본값: 오늘 날짜
          
          const extractedDate = comparisonResponse?._extractedEffectiveDate;
          if (extractedDate && String(extractedDate).length === 8) {
            efYdStr = String(extractedDate);
            
            // 시행일자 필터링: 20230415 이후인 것만 저장
            if (!isEffectiveDateAfter(efYdStr)) {
              console.log(`[Law] ⏭️  Skipping: effective date ${efYdStr} is before 20230415`);
              return { detected: 1, collected: 0, errors };
            }
            
            const year = parseInt(efYdStr.substring(0, 4));
            const month = parseInt(efYdStr.substring(4, 6));
            const day = parseInt(efYdStr.substring(6, 8));
            effectiveDate = new Date(year, month - 1, day);
            console.log(`[Law] 📅 Using effective date: ${efYdStr}`);
          } else {
            console.warn(`[Law] ⚠️  No valid effective date found, SKIPPING this record`);
            return { detected: 1, collected: 0, errors: ['No valid effective date'] };
          }
          
          // announcementNo: MST-{externalId}_{efYd} (고유성 보장)
          const announcementNo = `MST-${externalId}_${efYdStr}`;
          console.log(`[DB Save] Saving to DB - announcementNo: ${announcementNo}, effectiveDate: ${effectiveDate.toISOString()}`);
          
          await upsertChangeLog({
            itemId,
            announcementNo,
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
