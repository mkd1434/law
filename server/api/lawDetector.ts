/**
 * 법령 개정 감시
 * 1) lsJoHstInf: fromRegDt~toRegDt 기간 조회를 **연 단위 청크**로 순회 → 모니터링 법령만 필터
 * 2) (선택) oldAndNew: 법령ID/MST로 신·구 본문 조회 — 실패해도 조문 메타·링크는 저장
 */

import { toLawContentPayload } from '@shared/oldNewContentPayload';
import { lawAPIClient } from './lawClient';
import { upsertChangeLog } from '../db';

/** lsHstInf 스캔 기간(오늘 기준 과거 몇 년). `LAW_LS_HST_LOOKBACK_YEARS` 환경변수 우선. */
export const LAW_CHANGE_HISTORY_LOOKBACK_YEARS = 1;

/**
 * 실험/개발용: 오늘부터 **며칠 전까지**만 regDt 루프 (법령·행정규칙 prmlYd 동일).
 * `LAW_SYNC_LOOKBACK_DAYS`가 있으면 그걸 쓰고, **없고 NODE_ENV=development면 기본 365일**.
 * 운영에서는 비우면 `LAW_LS_HST_LOOKBACK_YEARS`(년) 또는 행정규칙 3년 구간을 씀.
 */
export const LAW_SYNC_LOOKBACK_DAYS_ENV = 'LAW_SYNC_LOOKBACK_DAYS';

/** 개발 모드에서만 쓰는 기본 스캔 일수 (연 단위 lsJoHstInf 청크와 맞추려면 1년 이상이 자연스러움) */
export const DEV_SYNC_LOOKBACK_DAYS_DEFAULT = 365;

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

/** lsJoHstInf 연 구간 청크 처리 후 대기(ms). 기본 1000ms. */
const LS_JO_CHUNK_AFTER_DELAY_MS = 1000;

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
  const env =
    process.env.LAW_LS_JO_CHUNK_DELAY_MS ?? process.env.LAW_LS_HST_AFTER_DAY_DELAY_MS;
  if (env != null && env !== '') {
    const n = parseInt(env, 10);
    if (Number.isFinite(n) && n >= 0) {
      return n;
    }
  }
  return LS_JO_CHUNK_AFTER_DELAY_MS;
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
   * 연 단위 lsJoHstInf 청크 처리 후 대기(ms). 기본 1000. 테스트 `{ min: 0, max: 0 }`.
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

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfCalendarYear(d: Date): Date {
  return new Date(d.getFullYear(), 11, 31);
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

/** 달력 연도 기준: cursor가 속한 해의 12/31(또는 오늘)까지 한 청크 */
function* eachYearChunkInWindow(
  windowStart: Date,
  today: Date
): Generator<{ from: Date; to: Date; label: string }> {
  let cursor = startOfDay(windowStart);
  const end = startOfDay(today);
  while (cursor.getTime() <= end.getTime()) {
    const yearEnd = startOfDay(endOfCalendarYear(cursor));
    const to = minDate(yearEnd, end);
    const label = `${formatDateForAPI(cursor)}~${formatDateForAPI(to)}`;
    yield { from: new Date(cursor), to: new Date(to), label };
    cursor = addDays(to, 1);
  }
}

/** lsJoHstInf 행 → UI·저장용 조문 메타 (명세 필드명) */
export function buildJoRevisionMeta(row: any): Record<string, unknown> {
  if (!row || typeof row !== "object") return {};
  const r = row as Record<string, unknown>;
  const detailLink =
    r["조문변경이력상세링크"] ?? r.조문변경이력상세링크 ?? r["조문변경이력\n상세링크"];
  return {
    공포일자: r.공포일자,
    시행일자: r.시행일자,
    변경사유: r.변경사유,
    조문링크: r.조문링크,
    조문변경이력상세링크: detailLink,
    조문개정일: r.조문개정일 ?? r["조문제개정일"],
    조문시행일: r.조문시행일,
    조문정보: r.조문정보,
    조문번호: r.조문번호 ?? r["jo num"] ?? r["jo_num"],
    법령명한글: r.법령명한글,
    법령ID: r.법령ID,
  };
}

function joRowStableParts(row: any): { lawId: string; jo: string; rev: string } {
  const lawIdRaw = row?.법령ID ?? row?.["법령ID"];
  const lawId = lawIdRaw != null ? String(lawIdRaw).trim() : "";
  const joRaw = row?.조문번호 ?? row?.["jo num"] ?? row?.jo_num ?? "";
  const jo = String(joRaw).replace(/\s/g, "");
  const rev =
    normalizeDateValue(row?.조문개정일 ?? row?.["조문제개정일"]) ?? "norev";
  return { lawId, jo: jo || "jo", rev };
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
 * lsJoHstInf를 **연 단위 fromRegDt~toRegDt** 청크로 조회 → 모니터링 법령이면 저장.
 * (페이지마다 RateLimiter + 청크 간 지연 기본 1초)
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

  const chunkDelay = resolveAfterDayDelayMs(options?.delayAfterEachRegDtDayMs);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { windowStart, description: windowDesc } = resolveScanWindowStart(today, options);

  const chunks = [...eachYearChunkInWindow(windowStart, today)];
  const seenKeys = new Set<string>();

  console.log(
    `[LawSync] window: ${windowDesc} — lsJoHstInf in ${chunks.length} year chunk(s)`
  );

  let chunkIndex = 0;
  for (const { from, to, label } of chunks) {
    chunkIndex += 1;
    const fromStr = formatDateForAPI(from);
    const toStr = formatDateForAPI(to);

    console.log(
      `[LawSync] lsJoHstInf chunk ${chunkIndex}/${chunks.length} ${label} (${fromStr}~${toStr})`
    );

    let rows: any[] = [];
    try {
      rows = await lawAPIClient.getAllLawJoHistoryForRange(fromStr, toStr);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`lsJoHstInf ${fromStr}~${toStr}: ${msg}`);
      continue;
    }

    for (const row of rows) {
      const monitored = laws.find((l) => monitoredLawMatchesRow(row, l.name));
      if (!monitored) continue;

      const lawIdRaw = row.법령ID ?? row["법령ID"];
      const lawId =
        lawIdRaw != null && String(lawIdRaw).trim() !== ""
          ? String(lawIdRaw).trim()
          : undefined;

      const { jo, rev } = joRowStableParts(row);
      const dedupeKey = `${monitored.itemId}|${lawId ?? monitored.mst}|${jo}|${rev}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      detected++;

      let comparison: any = null;
      if (lawId) {
        comparison = await lawAPIClient.getLawComparison({ lawId });
      }
      if (!comparison && monitored.mst) {
        comparison = await lawAPIClient.getLawComparison({ mst: monitored.mst });
      }

      if (!comparison) {
        errors.push(
          `oldAndNew 스킵(조문 메타만 저장): ${monitored.name} lawId=${lawId ?? "n/a"} chunk=${label}`
        );
      }

      const joMeta = buildJoRevisionMeta(row);
      const effectiveDateStr =
        normalizeDateValue(row.조문시행일) ??
        normalizeDateValue(row.시행일자) ??
        (comparison
          ? extractEffectiveDateFromComparison(comparison) ??
            normalizeDateValue(comparison?._extractedEffectiveDate)
          : null);

      if (!effectiveDateStr) {
        console.error(
          `[Law] ❌ 조문시행일/시행일자 없음: ${monitored.name} chunk=${label}`
        );
        errors.push(`No effective date: ${monitored.name} chunk=${label}`);
        continue;
      }

      const promulgation = normalizeDateValue(row.공포일자) ?? "unk";

      try {
        const year = parseInt(effectiveDateStr.substring(0, 4), 10);
        const month = parseInt(effectiveDateStr.substring(4, 6), 10);
        const day = parseInt(effectiveDateStr.substring(6, 8), 10);
        const effectiveDate = new Date(year, month - 1, day);

        const effDay = new Date(effectiveDate);
        effDay.setHours(0, 0, 0, 0);
        const status = effDay.getTime() > today.getTime() ? "upcoming" : "current";

        const announcementNo = `JO-${lawId ?? monitored.mst}-${jo}-${rev}-${promulgation}`;

        let content: string | null = null;
        let oldText = "";
        let newText = "";
        if (comparison) {
          const payload = toLawContentPayload(comparison);
          content = payload.content;
          oldText = payload.oldText;
          newText = payload.newText;
        }

        console.log(`[DB Save] 💾 ${monitored.name} ${announcementNo} status=${status}`);

        await upsertChangeLog({
          itemId: monitored.itemId,
          announcementNo,
          effectiveDate,
          status: status as "current" | "upcoming",
          comparisonData: {
            ...(comparison && typeof comparison === "object" ? comparison : {}),
            oldText,
            newText,
            joRevisionMeta: joMeta,
            _lsJoHstInfRow: row,
            _lsJoChunk: { fromRegDt: fromStr, toRegDt: toStr },
          },
          content: content ?? undefined,
          rawData: { lsJoHstInfRow: row, oldAndNew: comparison },
        });

        collected++;
      } catch (saveError) {
        const saveErrorMsg =
          saveError instanceof Error ? saveError.message : String(saveError);
        console.error(`[Law] ❌ 저장 실패 ${monitored.name}: ${saveErrorMsg}`);
        errors.push(`Failed to save ${monitored.name}: ${saveErrorMsg}`);
      }
    }

    if (chunkIndex < chunks.length && chunkDelay > 0) {
      console.log(`[LawSync] after chunk ${label} sleep ${chunkDelay}ms`);
      await sleepMs(chunkDelay);
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
