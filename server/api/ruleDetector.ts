/**
 * 행정규칙 변동 감지
 * 1) admrul: query(행정규칙명) + prmlYd(발령 기간)으로 목록 조회
 * 2) 시행일자 기준으로 최근 3년·시행 예정만 유지
 * 3) admrulOldAndNew: 행정규칙일련번호(ID) 우선, 없으면 행정규칙ID(LID)
 */

import { lawAPIClient } from './lawClient';
import { joinArticleDisplayText } from '@shared/extractArticleDisplayText';
import { getSyncLookbackWindowDays } from './lawDetector';
import { getLatestChangeLogForItem, upsertChangeLog, type ChangeLogWritePayload } from '../db';

/** prmlYd 시작일: getSyncLookbackWindowDays()와 동일(개발 시 기본 31일), 없으면 3년 전 */
function resolveRulePrmlStart(today: Date): Date {
  const w = getSyncLookbackWindowDays();
  if (w) {
    const d = new Date(today);
    d.setDate(d.getDate() - w.days);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  return new Date(today.getFullYear() - 3, today.getMonth(), today.getDate());
}

function formatDateForAPI(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function parseYyyymmdd(value: string | number | undefined | null): Date | null {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/\D/g, '');
  if (!/^\d{8}$/.test(s)) return null;
  const year = parseInt(s.substring(0, 4), 10);
  const month = parseInt(s.substring(4, 6), 10) - 1;
  const day = parseInt(s.substring(6, 8), 10);
  return new Date(year, month, day);
}

function adminRuleRowTitle(row: any): string {
  const v = row?.행정규칙명 ?? row?.['행정규칙명'] ?? '';
  return String(v).replace(/\s+/g, ' ').trim();
}

function monitoredRuleMatchesRow(row: any, ruleName: string): boolean {
  const n = adminRuleRowTitle(row);
  const q = ruleName.replace(/\s+/g, ' ').trim();
  if (!n || !q) return false;
  const nCompact = n.replace(/\s/g, '');
  const qCompact = q.replace(/\s/g, '');
  return (
    n === q ||
    n.includes(q) ||
    q.includes(n) ||
    nCompact.includes(qCompact) ||
    qCompact.includes(nCompact)
  );
}

/** 검색어 후보: 전체명, 공백제거, 앞 구절 축약 */
function buildAdmrulQueryCandidates(ruleName: string): string[] {
  const t = ruleName.trim();
  const out: string[] = [];
  const add = (s: string) => {
    const x = s.trim();
    if (x && !out.includes(x)) out.push(x);
  };
  add(t);
  add(t.replace(/\s+/g, ''));
  const m = t.match(/^(.{4,}?)(?:의 직무|에 관한|에 관하여)/);
  if (m) add(m[1].trim());
  if (t.length > 12) add(t.slice(0, 12));
  return out;
}

async function fetchAdminRulesMatchingName(
  ruleName: string,
  prmlYd: string
): Promise<{ rows: any[]; queryUsed: string; nwUsed: number } | null> {
  const queries = buildAdmrulQueryCandidates(ruleName);
  for (const nw of [1, 2] as const) {
    for (const q of queries) {
      const raw = await lawAPIClient.searchAdminRulesAll({ query: q, prmlYd, nw });
      const matched = raw.filter((row: any) => monitoredRuleMatchesRow(row, ruleName));
      if (matched.length > 0) {
        return { rows: matched, queryUsed: q, nwUsed: nw };
      }
      if (raw.length > 0) {
        const sample = raw
          .slice(0, 3)
          .map((r: any) => adminRuleRowTitle(r))
          .join(' | ');
        console.log(
          `[Rule] admrul ${raw.length} rows (query="${q}" nw=${nw}) — name filter miss; sample: ${sample}`
        );
      }
    }
  }
  return null;
}

function effectiveInMonitoringScope(effective: Date, threeYearsAgo: Date, today: Date): boolean {
  const eff = new Date(effective);
  eff.setHours(0, 0, 0, 0);
  const t0 = new Date(today);
  t0.setHours(0, 0, 0, 0);
  if (eff.getTime() > t0.getTime()) return true;
  const from = new Date(threeYearsAgo);
  from.setHours(0, 0, 0, 0);
  return eff.getTime() >= from.getTime();
}

export function toRuleContentPayload(response: any): { content: string; oldText: string; newText: string } {
  const svc = response?.AdmrulOldAndNewService ?? response?.admrulOldAndNew ?? response;
  const newArticles = svc?.신조문목록 ?? response?.신조문목록 ?? null;
  const oldArticles = svc?.구조문목록 ?? response?.구조문목록 ?? null;
  const payload = { 신조문목록: newArticles, 구조문목록: oldArticles };
  const content = JSON.stringify(payload);

  const oldText = joinArticleDisplayText(oldArticles);
  const newText = joinArticleDisplayText(newArticles);
  return { content, oldText, newText };
}

/**
 * 행정규칙 변동 감지 및 수집
 */
export async function detectAndCollectRuleChanges(
  itemId: number,
  ruleName: string,
  lastKnownDate?: Date
): Promise<{ detected: number; collected: number; errors: string[] }> {
  console.log(`\n[Rule] 🔍 Processing: ${ruleName}`);
  const errors: string[] = [];
  let detectedCount = 0;
  let collectedCount = 0;

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const prmlStart = resolveRulePrmlStart(today);

    const startDate = formatDateForAPI(prmlStart);
    const endDate = formatDateForAPI(today);
    const prmlYd = `${startDate}~${endDate}`;

    const win = getSyncLookbackWindowDays();
    console.log(
      `[Rule] 📋 admrul prmlYd=${prmlYd} (${win ? `${win.days}d (${win.label})` : 'default 3y production'} + query candidates)`
    );

    const fetched = await fetchAdminRulesMatchingName(ruleName, prmlYd);
    if (!fetched) {
      console.warn(`[Rule] No matching rules for ${ruleName}`);
      return { detected: 0, collected: 0, errors };
    }

    const targetRules = fetched.rows;
    console.log(
      `[Rule] ✅ ${targetRules.length} row(s) (query="${fetched.queryUsed}" nw=${fetched.nwUsed})`
    );

    let latestAnnouncement: Date | null = null;
    if (lastKnownDate) {
      latestAnnouncement = lastKnownDate;
    } else {
      const latest = await getLatestChangeLogForItem(itemId);
      const effRaw = latest?.effectiveDate;
      if (effRaw != null && effRaw !== '') {
        latestAnnouncement = new Date(effRaw as string | number | Date);
      }
    }

    for (const rule of targetRules) {
      try {
        const serial = rule.행정규칙일련번호 ?? rule['행정규칙일련번호'];
        const lid = rule.행정규칙ID ?? rule['행정규칙ID'];
        const eff = parseYyyymmdd(rule.시행일자);
        const prom = parseYyyymmdd(rule.발령일자);

        if (!eff) {
          console.warn(`[Rule] Skip (no 시행일자):`, rule);
          continue;
        }

        if (!effectiveInMonitoringScope(eff, prmlStart, today)) {
          continue;
        }

        if (latestAnnouncement && prom && prom <= latestAnnouncement) {
          console.log(`[Rule] Already known 발령: ${prom.toISOString()}`);
          continue;
        }

        const serialStr = serial != null && String(serial).trim() !== '' ? String(serial) : undefined;
        const lidStr = lid != null && String(lid).trim() !== '' ? String(lid) : undefined;

        let comparison: any = null;
        if (serialStr) {
          comparison = await lawAPIClient.getAdminRuleComparison({ id: serialStr });
        }
        if (!comparison && lidStr) {
          comparison = await lawAPIClient.getAdminRuleComparison({ lid: lidStr });
        }

        if (!comparison) {
          errors.push(`admrulOldAndNew 실패: ${ruleName} serial=${serialStr ?? 'n/a'} lid=${lidStr ?? 'n/a'}`);
          continue;
        }

        const exist = comparison?.신구법존재여부 ?? comparison?.AdmrulOldAndNewService?.신구법존재여부;
        if (exist === 'N' || exist === 'n') {
          console.log(`[Rule] 신구법 없음, 스킵: ${ruleName}`);
          continue;
        }

        const status = eff.getTime() > today.getTime() ? 'upcoming' : 'current';
        const promStr = prom ? formatDateForAPI(prom) : 'unknown';
        const effStr = formatDateForAPI(eff);
        const announcementNo = `AR-${serialStr ?? lidStr ?? 'x'}-${promStr}-${effStr}`;

        detectedCount++;

        const { content, oldText, newText } = toRuleContentPayload(comparison);

        const changeLog: ChangeLogWritePayload = {
          itemId,
          announcementNo,
          effectiveDate: eff,
          status: status as 'current' | 'upcoming',
          comparisonData: {
            ...comparison,
            oldText,
            newText,
            _admrulListRow: rule,
          },
          content,
          rawData: { listRow: rule, admrulOldAndNew: comparison },
        };

        await upsertChangeLog(changeLog);
        collectedCount++;
        console.log(`[Rule] 💾 ${announcementNo}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Rule] Error processing rule row:`, errorMsg);
        errors.push(`Error processing rule: ${errorMsg}`);
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Rule] Error detecting changes for ${ruleName}:`, errorMsg);
    errors.push(`Error detecting changes: ${errorMsg}`);
  }

  return { detected: detectedCount, collected: collectedCount, errors };
}

/**
 * 여러 행정규칙에 대해 변동 감지 및 수집 수행
 */
export async function detectAndCollectAllRules(
  rules: Array<{ itemId: number; name: string; lastKnownDate?: Date }>
): Promise<{ totalDetected: number; totalCollected: number; errors: string[] }> {
  let totalDetected = 0;
  let totalCollected = 0;
  const allErrors: string[] = [];

  for (const rule of rules) {
    try {
      const result = await detectAndCollectRuleChanges(rule.itemId, rule.name, rule.lastKnownDate);
      totalDetected += result.detected;
      totalCollected += result.collected;
      allErrors.push(...result.errors);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Rule] Error processing rule ${rule.name}:`, errorMsg);
      allErrors.push(`Error processing rule ${rule.name}: ${errorMsg}`);
    }
  }

  return { totalDetected, totalCollected, errors: allErrors };
}
