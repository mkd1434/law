/**
 * 법령 변동 감지 및 수집 로직
 * 법령 변경이력 API를 통해 변동을 감지하고 신구법 비교 데이터를 수집
 */

import { lawAPIClient } from './lawClient';
import { addChangeLog, getLatestChangeLogForItem } from '../db';
import { InsertChangeLog } from '../../drizzle/schema';

/**
 * 법령 변동 감지 및 수집
 * @param itemId - monitored_items 테이블의 ID
 * @param lawId - 법제처 API에서 사용하는 법령 ID
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
    console.log(`[Law] Fetching change history for ${lawName} (ID: ${lawId})`);
    
    // 최근 1년 내의 날짜 계산
    const today = new Date();
    const oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    const regDt = formatDateForAPI(oneYearAgo);
    
    const changeHistory = await lawAPIClient.getLawChangeHistory(regDt);

    if (!changeHistory || !changeHistory.data) {
      errors.push(`No change history found for ${lawName}`);
      return { detected: 0, collected: 0, errors };
    }

    const changes = Array.isArray(changeHistory.data) ? changeHistory.data : [changeHistory.data];
    detectedCount = changes.length;

    console.log(`[Law] Found ${detectedCount} changes for ${lawName}`);

    // Step 2: 각 변경사항에 대해 신구법 비교 데이터 수집
    for (const change of changes) {
      try {
        // API 응답 필드 매핑 (한글/영문 혼합 가능)
        const changeId = change.법령일련번호 || change.lawId || change.id;
        const effectiveDate = parseDate(change.시행일자 || change.effectiveDate);
        const announcementNo = change.공포번호 || change.announcementNo || '';

        if (!effectiveDate) {
          console.warn(`[Law] Skipping change due to missing effective date:`, change);
          continue;
        }

        // 오늘 날짜보다 미래인지 확인하여 status 결정
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const status = effectiveDate > today ? 'upcoming' : 'current';

        // 이미 수집된 변경사항인지 확인
        const existing = await getLatestChangeLogForItem(itemId);
        if (existing && existing.announcementNo === announcementNo) {
          console.log(`[Law] Change already collected: ${announcementNo}`);
          continue;
        }

        // Step 3: 신구법 본문 조회
        // MST 또는 ID 중 하나 사용
        const mst = change.법령일련번호 || change.lawMST || changeId;
        console.log(`[Law] Fetching comparison data for MST ${mst}`);
        const comparisonData = await lawAPIClient.getLawComparison({ MST: String(mst) });

        // Step 4: DB에 저장
        const changeLog: InsertChangeLog = {
          itemId,
          announcementNo: announcementNo || `${formatDateForAPI(today)}_${changeId}`,
          effectiveDate,
          status: status as 'current' | 'upcoming',
          comparisonData: JSON.stringify(comparisonData) || null,
          rawData: JSON.stringify(change) || null,
        };

        try {
          await addChangeLog(changeLog);
          collectedCount++;
          console.log(`[Law] Successfully collected change: ${announcementNo}`);
        } catch (dbError) {
          const dbErrorMsg = dbError instanceof Error ? dbError.message : 'Unknown error';
          console.error(`[Law] DB error for ${announcementNo}:`, dbErrorMsg);
          // DB 오류는 기록하지만 계속 진행
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Law] Error processing change:`, errorMsg);
        errors.push(`Error processing change: ${errorMsg}`);
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Law] Error detecting changes for ${lawName}:`, errorMsg);
    errors.push(`Error detecting changes: ${errorMsg}`);
  }

  return { detected: detectedCount, collected: collectedCount, errors };
}

/**
 * API 요청용 날짜 포맧 변환 (YYYYMMDD)
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
 * 여러 법령에 대해 변동 감지 및 수집 수행
 */
export async function detectAndCollectAllLaws(
  laws: Array<{ itemId: number; lawId: string; name: string }>
): Promise<{ totalDetected: number; totalCollected: number; errors: string[] }> {
  let totalDetected = 0;
  let totalCollected = 0;
  const allErrors: string[] = [];

  for (const law of laws) {
    try {
      const result = await detectAndCollectLawChanges(law.itemId, law.lawId, law.name);
      totalDetected += result.detected;
      totalCollected += result.collected;
      allErrors.push(...result.errors);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Law] Error processing law ${law.name}:`, errorMsg);
      allErrors.push(`Error processing law ${law.name}: ${errorMsg}`);
    }
  }

  return { totalDetected, totalCollected, errors: allErrors };
}
