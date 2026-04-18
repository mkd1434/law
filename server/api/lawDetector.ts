/**
 * 법령 개정 감시
 * 1) lsHstInf: startDt~endDt 기간(필요 시 일수 청크)으로 변경이력 수집 → 모니터링 법령만 필터
 * 2) oldAndNew: 법령ID(또는 MST)로 신·구 조문 본문 조회 후 저장
 */

import { lawAPIClient } from './lawClient';
import { upsertChangeLog } from '../db';

/**
 * lsHstInf를 스캔할 기간(오늘 기준 과거 몇 년).
 * `LAW_LS_HST_LOOKBACK_YEARS` 환경변수가 있으면 우선.
 */
export const LAW_CHANGE_HISTORY_LOOKBACK_YEARS = 1;

/**
 * 한 번의 lsHstInf 요청이 담는 최대 일수(기본 ≈ 1년).
 * 한 달 단위로 쪼개려면 31 등. `LAW_LS_HST_RANGE_CHUNK_DAYS` 환경변수로 덮어쓰기 가능.
 */
export const LAW_LS_HST_RANGE_CHUNK_DAYS_DEFAULT = 366;

const LS_HST_INTER_CHUNK_DELAY_MIN_MS = 500;
const LS_HST_INTER_CHUNK_DELAY_MAX_MS = 1000;

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

function resolveRangeChunkDays(override?: number): number {
  if (typeof override === 'number' && override > 0) {
    return Math.min(override, 3660);
  }
  const env = process.env.LAW_LS_HST_RANGE_CHUNK_DAYS;
  if (env != null && env !== '') {
    const n = parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) {
      return Math.min(n, 3660);
    }
  }
  return LAW_LS_HST_RANGE_CHUNK_DAYS_DEFAULT;
}

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

function randomChunkDelayMs(min: number, max: number): number {
  if (max <= 0) return 0;
  if (min >= max) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

/** [windowStart, today] 를 최대 maxDays일 단위(포함 구간)로 나눔 */
function buildDateRangeChunks(windowStart: Date, today: Date, maxDays: number): { startDt: string; endDt: string }[] {
  const chunks: { startDt: string; endDt: string }[] = [];
  let cur = new Date(windowStart);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setHours(0, 0, 0, 0);

  while (cur.getTime() <= end.getTime()) {
    const chunkEnd = addDays(cur, maxDays - 1);
    const to = chunkEnd.getTime() > end.getTime() ? end : chunkEnd;
    chunks.push({ startDt: formatDateForAPI(cur), endDt: formatDateForAPI(to) });
    cur = addDays(to, 1);
  }
  return chunks;
}

export type SyncMonitoredLawsFromHistoryOptions = {
  lookbackYears?: number;
  /** 한 청크 최대 일수 (기본: LAW_LS_HST_RANGE_CHUNK_DAYS_DEFAULT / 환경변수) */
  rangeChunkDays?: number;
  /**
   * 기간 청크 사이 대기(기본 500~1000ms). 테스트는 `{ min: 0, max: 0 }`.
   */
  delayBetweenRangeChunksMs?: { min: number; max: number };
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
 * lsHstInf를 startDt~endDt 기간(청크)으로 조회한 뒤 모니터링 법령이면 oldAndNew 저장.
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
  const chunkDays = resolveRangeChunkDays(options?.rangeChunkDays);
  const delayBounds = options?.delayBetweenRangeChunksMs ?? {
    min: LS_HST_INTER_CHUNK_DELAY_MIN_MS,
    max: LS_HST_INTER_CHUNK_DELAY_MAX_MS,
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowStart = new Date(
    today.getFullYear() - lookbackYears,
    today.getMonth(),
    today.getDate()
  );

  const chunks = buildDateRangeChunks(windowStart, today, chunkDays);
  const seenKeys = new Set<string>();

  for (let ci = 0; ci < chunks.length; ci++) {
    const { startDt, endDt } = chunks[ci];
    console.log(
      `[LawSync] lsHstInf range ${startDt}~${endDt} (chunk ${ci + 1}/${chunks.length}, lookbackYears=${lookbackYears}, chunkDays=${chunkDays})`
    );

    let rows: any[] = [];
    try {
      rows = await lawAPIClient.getAllLawChangeHistoryForRange(startDt, endDt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`lsHstInf ${startDt}~${endDt}: ${msg}`);
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
        errors.push(
          `oldAndNew 실패: ${monitored.name} range=${startDt}~${endDt} lawId=${lawId ?? 'n/a'}`
        );
        continue;
      }

      const effectiveFromRow = normalizeDateValue(row.시행일자);
      const effectiveDateStr =
        effectiveFromRow ??
        extractEffectiveDateFromComparison(comparison) ??
        normalizeDateValue(comparison?._extractedEffectiveDate);

      if (!effectiveDateStr) {
        console.error(`[Law] ❌ 시행일자 없음: ${monitored.name} range=${startDt}~${endDt}`);
        errors.push(`No effective date: ${monitored.name} range=${startDt}~${endDt}`);
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
            _lsHstInfRange: { startDt, endDt },
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

    if (ci < chunks.length - 1) {
      const waitMs = randomChunkDelayMs(delayBounds.min, delayBounds.max);
      if (waitMs > 0) {
        console.log(`[LawSync] lsHstInf inter-chunk delay ${waitMs}ms`);
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
