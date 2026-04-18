/**
 * 법령 개정 감시
 * 1) lsHstInf: 최근 N년 변경일(regDt)별로 이력 수집 → 모니터링 대상 법령만 필터
 * 2) oldAndNew: 법령ID(또는 MST)로 신·구 조문 본문 조회 후 저장
 */

import { lawAPIClient } from './lawClient';
import { upsertChangeLog } from '../db';

/**
 * lsHstInf를 스캔할 기간(오늘 기준 과거 몇 년).
 * 안정화 후 `3` 등으로 올리면 됨. `LAW_LS_HST_LOOKBACK_YEARS` 환경변수가 있으면 우선.
 */
export const LAW_CHANGE_HISTORY_LOOKBACK_YEARS = 1;

const LS_HST_INTER_DAY_DELAY_MIN_MS = 500;
const LS_HST_INTER_DAY_DELAY_MAX_MS = 1000;

function resolveLookbackYears(override?: number): number {
  if (typeof override === 'number' && override > 0) {
    return Math.min(override, 20);
  }
  const env = process.env.LAW_LS_HST_LOOKBACK_YEARS;
  if (env != null && env !== '') {
    const n = parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) {
      return Math.min(n, 20);
    }
  }
  return LAW_CHANGE_HISTORY_LOOKBACK_YEARS;
}

function formatDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function countCalendarDaysInclusive(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.floor((b - a) / 86400000) + 1;
}

function randomInterDayDelayMs(min: number, max: number): number {
  if (max <= 0) return 0;
  if (min >= max) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

export type SyncMonitoredLawsFromHistoryOptions = {
  /** 기본: LAW_CHANGE_HISTORY_LOOKBACK_YEARS / 환경변수 */
  lookbackYears?: number;
  /**
   * regDt 하루 처리가 끝난 뒤 다음 날 lsHstInf 호출 전 대기(밀리초).
   * 기본 500~1000ms 랜덤. 테스트는 `{ min: 0, max: 0 }`.
   */
  delayBetweenRegDtDaysMs?: { min: number; max: number };
};

function formatDateForAPI(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

function normalizeDateValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const digitsOnly = String(value).replace(/\D/g, '');
  return /^\d{8}$/.test(digitsOnly) ? digitsOnly : null;
}

function lawHistoryRowName(row: any): string | undefined {
  return row?.법령명한글 ?? row?.법령명;
}

function monitoredLawMatchesRow(row: any, monitoredName: string): boolean {
  const rowName = lawHistoryRowName(row)?.trim();
  const name = monitoredName.trim();
  if (!rowName || !name) return false;
  return rowName === name || rowName.includes(name) || name.includes(rowName);
}

/** oldAndNew JSON에서 시행일자(YYYYMMDD) 추출 — 테스트·UI용 */
export function extractEffectiveDateFromComparison(data: any): string | null {
  try {
    if (data?._extractedEffectiveDate) {
      const n = normalizeDateValue(data._extractedEffectiveDate);
      if (n) return n;
    }

    const root = data?.OldAndNewService ?? data?.OldAndNew ?? data;
    const prioritizedDate = normalizeDateValue(root?.신조문_기본정보?.시행일자);
    if (prioritizedDate) return prioritizedDate;

    const fallbackCandidates = [
      root?.구조문_기본정보?.시행일자,
      root?.기본정보?.시행일자,
      root?.신조문_기본정보?.efYd,
      data?.efYd,
    ];
    for (const candidate of fallbackCandidates) {
      const normalized = normalizeDateValue(candidate);
      if (normalized) return normalized;
    }

    const visited = new Set<any>();
    const collectEffectiveDates = (node: any): string[] => {
      if (!node || typeof node !== 'object') return [];
      if (visited.has(node)) return [];
      visited.add(node);
      const found: string[] = [];
      if (Array.isArray(node)) {
        for (const item of node) {
          found.push(...collectEffectiveDates(item));
        }
        return found;
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === '시행일자') {
          const normalized = normalizeDateValue(value);
          if (normalized) found.push(normalized);
        }
        if (value && typeof value === 'object') {
          found.push(...collectEffectiveDates(value));
        }
      }
      return found;
    };

    const discoveredDates = collectEffectiveDates(data);
    return discoveredDates.length > 0 ? discoveredDates[0] : null;
  } catch (e) {
    console.error('[DateExtractError]', e);
    return null;
  }
}

export function toLawContentPayload(response: any): { content: string; oldText: string; newText: string } {
  const svc = response?.OldAndNewService ?? response?.OldAndNew ?? response;
  const newArticles = svc?.신조문목록 ?? response?.신조문목록 ?? null;
  const oldArticles = svc?.구조문목록 ?? response?.구조문목록 ?? null;

  const payload = {
    신조문목록: newArticles,
    구조문목록: oldArticles,
  };

  const content = JSON.stringify(payload);

  const collectHtml = (node: any): string[] => {
    if (node === null || node === undefined) return [];
    if (typeof node === 'string') {
      return node.includes('<') && node.includes('>') ? [node] : [];
    }
    if (Array.isArray(node)) return node.flatMap(collectHtml);
    if (typeof node === 'object') return Object.values(node).flatMap(collectHtml);
    return [];
  };

  const oldText = collectHtml(oldArticles).join('\n');
  const newText = collectHtml(newArticles).join('\n');

  return { content, oldText, newText };
}

export type MonitoredLawInput = {
  itemId: number;
  /** 법령 MST (lsHstInf에 법령ID가 없을 때 oldAndNew 보조) */
  mst: string;
  name: string;
};

/**
 * 최근 N년간 regDt를 하루씩 돌며 lsHstInf → 모니터링 법령이면 oldAndNew 저장.
 * 일별 lsHstInf 묶음 처리 후 다음 날짜로 넘어가기 전 0.5~1초(기본) 대기.
 */
export async function syncMonitoredLawsFromChangeHistory(
  laws: MonitoredLawInput[],
  options?: SyncMonitoredLawsFromHistoryOptions
): Promise<{ detected: number; collected: number; errors: string[] }> {
  const errors: string[] = [];
  let detected = 0;
  let collected = 0;

  if (laws.length === 0) {
    return { detected: 0, collected: 0, errors: [] };
  }

  const lookbackYears = resolveLookbackYears(options?.lookbackYears);
  const delayBounds = options?.delayBetweenRegDtDaysMs ?? {
    min: LS_HST_INTER_DAY_DELAY_MIN_MS,
    max: LS_HST_INTER_DAY_DELAY_MAX_MS,
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowStart = new Date(
    today.getFullYear() - lookbackYears,
    today.getMonth(),
    today.getDate()
  );

  const totalDays = countCalendarDaysInclusive(windowStart, today);
  let dayIndex = 0;

  const seenKeys = new Set<string>();

  for (let d = new Date(windowStart); d.getTime() <= today.getTime(); d = addDays(d, 1)) {
    dayIndex += 1;
    const regDt = formatDateForAPI(d);
    const iso = formatDateISO(d);

    console.log(
      `[LawSync] Processing date: ${iso} (${dayIndex}/${totalDays}) regDt=${regDt} lookbackYears=${lookbackYears}`
    );

    let rows: any[] = [];
    try {
      rows = await lawAPIClient.getAllLawChangeHistoryForDate(regDt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`lsHstInf ${regDt}: ${msg}`);
      continue;
    }

    for (const row of rows) {
      const monitored = laws.find((l) => monitoredLawMatchesRow(row, l.name));
      if (!monitored) continue;

      const lawIdRaw = row.법령ID ?? row['법령ID'];
      const lawId = lawIdRaw != null && String(lawIdRaw).trim() !== '' ? String(lawIdRaw) : undefined;

      let comparison: any = null;
      if (lawId) {
        comparison = await lawAPIClient.getLawComparison({ lawId });
      }
      if (!comparison && monitored.mst) {
        comparison = await lawAPIClient.getLawComparison({ mst: monitored.mst });
      }

      if (!comparison) {
        errors.push(`oldAndNew 실패: ${monitored.name} regDt=${regDt} lawId=${lawId ?? 'n/a'}`);
        continue;
      }

      const effectiveFromRow = normalizeDateValue(row.시행일자);
      const effectiveDateStr =
        effectiveFromRow ?? extractEffectiveDateFromComparison(comparison) ?? normalizeDateValue(comparison?._extractedEffectiveDate);

      if (!effectiveDateStr) {
        console.error(`[Law] ❌ 시행일자 없음: ${monitored.name} regDt=${regDt}`);
        errors.push(`No effective date: ${monitored.name} regDt=${regDt}`);
        continue;
      }

      const dedupeKey = `${monitored.itemId}|${lawId ?? monitored.mst}|${regDt}|${effectiveDateStr}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      detected++;

      try {
        const year = parseInt(effectiveDateStr.substring(0, 4), 10);
        const month = parseInt(effectiveDateStr.substring(4, 6), 10);
        const day = parseInt(effectiveDateStr.substring(6, 8), 10);
        const effectiveDate = new Date(year, month - 1, day);

        const effDay = new Date(effectiveDate);
        effDay.setHours(0, 0, 0, 0);
        const status = effDay.getTime() > today.getTime() ? 'upcoming' : 'current';

        const announcementNo = `LS-${lawId ?? monitored.mst}-${regDt}-${effectiveDateStr}`;
        const { content, oldText, newText } = toLawContentPayload(comparison);

        console.log(`[DB Save] 💾 ${monitored.name} ${announcementNo} status=${status}`);

        await upsertChangeLog({
          itemId: monitored.itemId,
          announcementNo,
          effectiveDate,
          status: status as 'current' | 'upcoming',
          comparisonData: {
            ...comparison,
            oldText,
            newText,
            _sourceRegDt: regDt,
            _lsHstInfRow: row,
          },
          content,
          rawData: { historyRow: row, oldAndNew: comparison },
        });

        collected++;
      } catch (saveError) {
        const saveErrorMsg = saveError instanceof Error ? saveError.message : String(saveError);
        console.error(`[Law] ❌ 저장 실패 ${monitored.name}: ${saveErrorMsg}`);
        errors.push(`Failed to save ${monitored.name}: ${saveErrorMsg}`);
      }
    }

    if (d.getTime() < today.getTime()) {
      const waitMs = randomInterDayDelayMs(delayBounds.min, delayBounds.max);
      if (waitMs > 0) {
        console.log(`[LawSync] lsHstInf inter-day delay ${waitMs}ms before next regDt`);
        await sleepMs(waitMs);
      }
    }
  }

  return { detected, collected, errors };
}

/**
 * @deprecated syncMonitoredLawsFromChangeHistory + syncMonitor 일괄 호출 사용
 */
export async function detectAndCollectLawChanges(
  itemId: number,
  externalId: string,
  lawName: string,
  options?: SyncMonitoredLawsFromHistoryOptions
): Promise<{ detected: number; collected: number; errors: string[] }> {
  return syncMonitoredLawsFromChangeHistory(
    [{ itemId, mst: externalId, name: lawName }],
    options
  );
}
