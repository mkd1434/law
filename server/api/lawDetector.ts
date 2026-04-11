/**
 * 법령 변동 감지 및 수집 로직
 * 법령 변경이력 API를 통해 변동을 감지하고 신구법 비교 데이터를 수집
 * 강화된 에러 처리 및 로깅
 */

import { lawAPIClient } from './lawClient';
import { addChangeLog, getLatestChangeLogForItem } from '../db';
import { InsertChangeLog } from '../../drizzle/schema';

/**
 * API 요청용 날짜 포맷 변환 (YYYYMMDD)
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
    const year = parseInt(dateStr.substring(0, 4), 10);
    const month = parseInt(dateStr.substring(4, 6), 10);
    const day = parseInt(dateStr.substring(6, 8), 10);
    return new Date(year, month - 1, day);
  }

  // YYYY-MM-DD 형식
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(dateStr);
  }

  // 기타 형식 시도
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

/**
 * 법령 변동 감지 및 수집
 * @param itemId - monitored_items 테이블의 ID
 * @param lawId - 법제처 API에서 사용하는 법령 ID (MST)
 * @param lawName - 법령 이름
 */
export async function detectAndCollectLawChanges(
  itemId: number,
  lawId: string,
  lawName: string
): Promise<{ detected: number; collected: number; errors: string[] }> {
  const errors: string[] = [];
  let detectedCount = 0;
  let collectedCount = 0;

  try {
    // Step 1: 법령 변경이력 조회
    // 최근 1년 내의 변경이력을 조회 (최신 변경일부터 시작)
    console.log(`\n[Law] 🔍 Processing: ${lawName} (MST: ${lawId})`);

    // 최근 3년 내의 날짜 계산 (확장된 감시 범위)
    const today = new Date();
    const threeYearsAgo = new Date(today.getFullYear() - 3, today.getMonth(), today.getDate());
    const regDt = formatDateForAPI(threeYearsAgo);

    const changeHistory = await lawAPIClient.getLawChangeHistory(regDt);

    if (!changeHistory || !changeHistory.data) {
      console.log(`[Law] ℹ️  No change history found for ${lawName}`);
      return { detected: 0, collected: 0, errors: [] };
    }

    const changes = Array.isArray(changeHistory.data) ? changeHistory.data : [changeHistory.data];
    detectedCount = changes.length;

    console.log(`[Law] ✅ Found ${detectedCount} changes for ${lawName}`);

    // Step 2: 각 변경사항에 대해 신구법 비교 데이터 수집
    for (const change of changes) {
      try {
        // API 응답 필드 매핑 (한글/영문 혼합 가능)
        const changeId = change.법령일련번호 || change.lawId || change.id;
        const effectiveDate = parseDate(change.시행일자 || change.effectiveDate);
        const announcementNo = change.공포번호 || change.announcementNo || '';

        if (!effectiveDate) {
          console.warn(`[Law] ⚠️  Skipping change due to missing effective date for ${lawName}`);
          continue;
        }

        // 오늘 날짜보다 미래인지 확인하여 status 결정
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        effectiveDate.setHours(0, 0, 0, 0);
        const status = effectiveDate > now ? 'upcoming' : 'current';

        console.log(`[Law] 📅 Effective Date: ${formatDateForAPI(effectiveDate)} (Status: ${status})`);

        // 이미 수집된 변경사항인지 확인
        const existing = await getLatestChangeLogForItem(itemId);
        if (existing && existing.announcementNo === announcementNo) {
          console.log(`[Law] ℹ️  Change already collected: ${announcementNo}`);
          continue;
        }

        // Step 3: 신구법 본문 조회
        // MST 또는 ID 중 하나 사용
        const mst = change.법령일련번호 || change.lawMST || changeId;
        console.log(`[Law] 📄 Fetching comparison data for MST: ${mst}`);

        let comparisonData: any = null;
        try {
          comparisonData = await lawAPIClient.getLawComparison({ MST: String(mst) });
        } catch (apiError) {
          const apiErrorMsg = apiError instanceof Error ? apiError.message : 'Unknown API error';
          console.error(`[Law] ❌ API error fetching comparison for ${lawName}: ${apiErrorMsg}`);
          // 비교 데이터 조회 실패해도 계속 진행
        }

        // Step 4: DB에 저장
        const changeLog: InsertChangeLog = {
          itemId,
          announcementNo: announcementNo || `${formatDateForAPI(now)}_${changeId}`,
          effectiveDate,
          status: status as 'current' | 'upcoming',
          comparisonData: comparisonData ? JSON.stringify(comparisonData) : null,
          rawData: JSON.stringify(change) || null,
        };

        try {
          await addChangeLog(changeLog);
          collectedCount++;
          const statusBadge = status === 'upcoming' ? '🔔' : '✅';
          console.log(`[Law] ${statusBadge} Successfully saved: ${announcementNo} (Status: ${status})`);
        } catch (dbError) {
          const dbErrorMsg = dbError instanceof Error ? dbError.message : 'Unknown DB error';
          console.error(`[Law] ❌ DB error for ${announcementNo}: ${dbErrorMsg}`);
          errors.push(`DB error for ${lawName}: ${dbErrorMsg}`);
          // DB 오류는 기록하지만 계속 진행
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[Law] ❌ Error processing change for ${lawName}:`, errorMsg);
        errors.push(`Error processing change for ${lawName}: ${errorMsg}`);
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Law] ❌ Error detecting changes for ${lawName}:`, errorMsg);
    errors.push(`Error detecting changes for ${lawName}: ${errorMsg}`);
  }

  return { detected: detectedCount, collected: collectedCount, errors };
}
