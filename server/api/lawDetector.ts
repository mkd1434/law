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
    console.log(`[Law] Fetching change history for ${lawName} (ID: ${lawId})`);
    const changeHistory = await lawAPIClient.getLawChangeHistory(lawId);

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
        const changeId = change.changeId || change.id;
        const effectiveDate = parseDate(change.effectiveDate || change.시행일자);
        const announcementNo = change.announcementNo || change.공고번호 || '';

        if (!changeId || !effectiveDate) {
          console.warn(`[Law] Skipping change due to missing data:`, change);
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

        // Step 3: 신구법 비교 본문 조회
        console.log(`[Law] Fetching comparison data for change ${changeId}`);
        const comparisonData = await lawAPIClient.getLawComparison({ MST: lawId });

        // Step 4: DB에 저장
        const changeLog: InsertChangeLog = {
          itemId,
          announcementNo,
          effectiveDate,
          status: status as 'current' | 'upcoming',
          comparisonData: comparisonData || null,
          rawData: change,
        };

        await addChangeLog(changeLog);
        collectedCount++;

        console.log(`[Law] Successfully collected change: ${announcementNo}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Law] Error processing change:`, errorMsg);
        errors.push(`Error processing change: ${errorMsg}`);
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Law] Error detecting changes for ${lawName}:`, errorMsg);
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
