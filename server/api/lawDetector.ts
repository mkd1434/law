/**
 * 법령 개정 감시 엔진 - 강제 수정 버전
 * 
 * 1. 한글 시행일자 필드 완전 탐색 (모든 경로)
 * 2. 날짜 필터 해제 (모든 데이터 저장)
 * 3. 데이터 누락 방지 (API 응답 전체 로깅)
 * 4. InitSeed 중복 체크 제거
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
 * 한글 시행일자 필드 완전 탐색
 * 모든 가능한 경로에서 시행일자를 찾음
 * 
 * 탐색 경로:
 * 1. OldAndNewService.신조문_기본정보.시행일자
 * 2. OldAndNewService.기본정보.시행일자
 * 3. OldAndNewService.신조문목록.조문[0].시행일자
 * 4. 공포일자 (fallback)
 */
function extractEffectiveDate(data: any): string | null {
  if (!data) return null;

  // 1. 신조문_기본정보.시행일자 (최우선)
  if (data?.신조문_기본정보?.시행일자) {
    const date = String(data.신조문_기본정보.시행일자);
    if (date.length === 8 && /^\d{8}$/.test(date)) {
      console.log(`[DateExtract] ✅ Found 신조문_기본정보.시행일자: ${date}`);
      return date;
    }
  }

  // 2. 기본정보.시행일자
  if (data?.기본정보?.시행일자) {
    const date = String(data.기본정보.시행일자);
    if (date.length === 8 && /^\d{8}$/.test(date)) {
      console.log(`[DateExtract] ✅ Found 기본정보.시행일자: ${date}`);
      return date;
    }
  }

  // 3. 구조문_기본정보.시행일자
  if (data?.구조문_기본정보?.시행일자) {
    const date = String(data.구조문_기본정보.시행일자);
    if (date.length === 8 && /^\d{8}$/.test(date)) {
      console.log(`[DateExtract] ✅ Found 구조문_기본정보.시행일자: ${date}`);
      return date;
    }
  }

  // 4. 신조문목록.조문[0].시행일자
  if (Array.isArray(data?.신조문목록?.조문) && data.신조문목록.조문.length > 0) {
    const date = String(data.신조문목록.조문[0].시행일자);
    if (date && date.length === 8 && /^\d{8}$/.test(date)) {
      console.log(`[DateExtract] ✅ Found 신조문목록.조문[0].시행일자: ${date}`);
      return date;
    }
  }

  // 5. efYd (영문 필드)
  if (data?.efYd) {
    const date = String(data.efYd);
    if (date.length === 8 && /^\d{8}$/.test(date)) {
      console.log(`[DateExtract] ✅ Found efYd: ${date}`);
      return date;
    }
  }

  // 6. 공포일자 (fallback)
  if (data?.공포일자) {
    const date = String(data.공포일자);
    if (date.length === 8 && /^\d{8}$/.test(date)) {
      console.log(`[DateExtract] ⚠️  Using fallback 공포일자: ${date}`);
      return date;
    }
  }

  // 7. 제정일자 (fallback)
  if (data?.제정일자) {
    const date = String(data.제정일자);
    if (date.length === 8 && /^\d{8}$/.test(date)) {
      console.log(`[DateExtract] ⚠️  Using fallback 제정일자: ${date}`);
      return date;
    }
  }

  return null;
}

/**
 * 법령 개정 감시 (법령 + 행정규칙)
 * 
 * 강제 수정 로직:
 * 1. 한글 시행일자 필드 완전 탐색
 * 2. 날짜 필터 해제 (모든 데이터 저장)
 * 3. 데이터 누락 방지 (API 응답 전체 로깅)
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
        
        // === 한글 시행일자 필드 완전 탐색 ===
        const effectiveDateStr = extractEffectiveDate(comparisonResponse);
        
        if (!effectiveDateStr) {
          // 데이터 누락 방지: API 응답 전체 로깅
          console.error(`[Law] ❌ No valid effective date found!`);
          console.error(`[Law] 📊 Full API Response:`, JSON.stringify(comparisonResponse, null, 2));
          errors.push('No valid effective date found - see logs for full response');
          return { detected: 1, collected: 0, errors };
        }

        // DB에 변경 로그 저장
        try {
          const year = parseInt(effectiveDateStr.substring(0, 4));
          const month = parseInt(effectiveDateStr.substring(4, 6));
          const day = parseInt(effectiveDateStr.substring(6, 8));
          const effectiveDate = new Date(year, month - 1, day);

          // announcementNo: MST-{externalId}_{efYd} (고유성 보장)
          const announcementNo = `MST-${externalId}_${effectiveDateStr}`;
          
          console.log(`[DB Save] 💾 Saving to DB`);
          console.log(`  - announcementNo: ${announcementNo}`);
          console.log(`  - effectiveDate: ${effectiveDate.toISOString()}`);
          console.log(`  - itemId: ${itemId}`);
          
          await upsertChangeLog({
            itemId,
            announcementNo,
            effectiveDate,
            status: 'current',
            comparisonData: comparisonResponse,
            rawData: comparisonResponse,
          });
          
          collected++;
          console.log(`[Law] ✅ Saved law comparison for MST: ${externalId}`);
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
      console.log(`[Law] ✅ Found ${detected} changes for ${lawName}, collected ${collected}`);
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
