/**
 * 법령 개정 감시
 * 1) lsHstInf: 명세상 regDt(변경일) 하루 단위 조회 → 모니터링 법령만 필터
 * 2) oldAndNew: 법령ID(또는 MST)로 신·구 조문 본문 조회 후 저장
 */

import { toLawContentPayload } from '@shared/oldNewContentPayload';
import { lawAPIClient } from './lawClient';
import { upsertChangeLog } from '../db';

/** lsHstInf 스캔 기간(오늘 기준 과거 몇 년). `LAW_LS_HST_LOOKBACK_YEARS` 환경변수 우선. */
export const LAW_CHANGE_HISTORY_LOOKBACK_YEARS = 1;

/**
 * 실험/개발용: 오늘부터 **며칠 전까지**만 regDt 루프 (법령·행정규칙 prmlYd 동일).
 * `LAW_SYNC_LOOKBACK_DAYS`가 있으면 그걸 쓰고, **없고 NODE_ENV=development면 기본 31일**.
 * 운영에서는 비우면 `LAW_LS_HST_LOOKBACK_YEARS`(년) 또는 행정규칙 3년 구간을 씀.
 */
export const LAW_SYNC_LOOKBACK_DAYS_ENV = 'LAW_SYNC_LOOKBACK_DAYS';

/** 개발 모드에서만 쓰는 기본 스캔 일수 */
export const DEV_SYNC_LOOKBACK_DAYS_DEFAULT = 31;

/** 일 단위 스캔 구간이 있으면 { days, label }, 없으면 null(년/3년 로직으로 폴백) */
export function getSyncLookbackWindowDays():
  | { days: number; label: string }
  | null {
  const env = process.env.LAW_SYNC_LOOKBACK_DAYS;
  if (env != null && env !== '') {
    const n = parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) {
      return {
        days: Math.min(n, 3660),
        label: LAW_SYNC_LOOKBACK_DAYS_ENV,
      };
    }
  }
  if (process.env.NODE_ENV === 'development') {
    return {
      days: DEV_SYNC_LOOKBACK_DAYS_DEFAULT,
      label: 'NODE_ENV=development (override with LAW_SYNC_LOOKBACK_DAYS)',
    };
  }
  return null;
}

/** regDt 하루 처리 후 다음 날로 넘어가기 전 대기(ms). 기본 1000ms. */
const LS_HST_AFTER_DAY_DELAY_MS = 1000;

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

function resolveScanWindowStart(
  today: Date,
  options?: SyncMonitoredLawsFromHistoryOptions
): { windowStart: Date; description: string } {
  const dayWindow = getSyncLookbackWindowDays();
  if (dayWindow) {
    return {
      windowStart: addDays(today, -dayWindow.days),
      description: `${dayWindow.days} day(s) (${dayWindow.label})`,
    };
  }
  const years = resolveLookbackYears(options?.lookbackYears);
  const windowStart = new Date(
    today.getFullYear() - years,
    today.getMonth(),
    today.getDate()
  );
  return {
    windowStart,
    description: `${years} year(s) (LAW_LS_HST_LOOKBACK_YEARS; production)`,
  };
}

function resolveAfterDayDelayMs(override?: { min: number; max: number }): number {
  if (override) {
    if (override.max <= 0) return 0;
    if (override.min >= override.max) return override.min;
    return override.min + Math.floor(Math.random() * (override.max - override.min + 1));
  }
  const env = process.env.LAW_LS_HST_AFTER_DAY_DELAY_MS;
  if (env != null && env !== '') {
    const n = parseInt(env, 10);
    if (Number.isFinite(n) && n >= 0) {
      return n;
    }
  }
  return LS_HST_AFTER_DAY_DELAY_MS;
}

function formatDateForAPI(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function formatDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

function countCalendarDaysInclusive(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.floor((b - a) / 86400000) + 1;
}

async function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

function normalizeDateValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const digitsOnly = String(value).replace(/\D/g, '');
  return /^\d{8}$/.test(digitsOnly) ? digitsOnly : null;
}

export type SyncMonitoredLawsFromHistoryOptions = {
  lookbackYears?: number;
  /**
   * 일별 lsHstInf 묶음 처리 후 다음 regDt 전 대기(ms).
   * 기본 1000. 테스트 `{ min: 0, max: 0 }`.
   */
  delayAfterEachRegDtDayMs?: { min: number; max: number };
};

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

export type MonitoredLawInput = {
  itemId: number;
  mst: string;
  name: string;
};

/**
 * regDt를 하루씩 돌며 lsHstInf → 모니터링 법령이면 oldAndNew 저장.
 * (페이지마다 LawAPIClient RateLimiter 1초 + 일 단위 처리 후 추가 지연 기본 1초)
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

  const afterDayDelay = resolveAfterDayDelayMs(options?.delayAfterEachRegDtDayMs);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { windowStart, description: windowDesc } = resolveScanWindowStart(today, options);

  const totalDays = countCalendarDaysInclusive(windowStart, today);
  let dayIndex = 0;
  const seenKeys = new Set<string>();

  console.log(`[LawSync] window: ${windowDesc} (~${totalDays} regDt day(s))`);

  for (let d = new Date(windowStart); d.getTime() <= today.getTime(); d = addDays(d, 1)) {
    dayIndex += 1;
    const regDt = formatDateForAPI(d);
    const iso = formatDateISO(d);

    console.log(`[LawSync] lsHstInf regDt=${regDt} (${iso}) day ${dayIndex}/${totalDays}`);

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
        effectiveFromRow ??
        extractEffectiveDateFromComparison(comparison) ??
        normalizeDateValue(comparison?._extractedEffectiveDate);

      if (!effectiveDateStr) {
        console.error(`[Law] ❌ 시행일자 없음: ${monitored.name} regDt=${regDt}`);
        errors.push(`No effective date: ${monitored.name} regDt=${regDt}`);
        continue;
      }

      const promulgation = normalizeDateValue(row.공포일자) ?? 'unk';

      const dedupeKey = `${monitored.itemId}|${lawId ?? monitored.mst}|${promulgation}|${effectiveDateStr}`;
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

        const announcementNo = `LS-${lawId ?? monitored.mst}-${promulgation}-${effectiveDateStr}`;
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

    if (d.getTime() < today.getTime() && afterDayDelay > 0) {
      console.log(`[LawSync] after regDt=${regDt} sleep ${afterDayDelay}ms`);
      await sleepMs(afterDayDelay);
    }
  }

  return { detected, collected, errors };
}

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
