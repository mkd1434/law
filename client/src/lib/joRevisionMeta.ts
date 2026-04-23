const LAW_GO_KR = 'https://www.law.go.kr';

/** 상대 경로면 국가법령정보 사이트 절대 URL로 만듦 */
export function resolveLawGoKrUrl(pathOrUrl: string | null | undefined): string | null {
  if (pathOrUrl == null || typeof pathOrUrl !== 'string') return null;
  const t = pathOrUrl.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  return `${LAW_GO_KR}${t.startsWith('/') ? '' : '/'}${t}`;
}

export function formatYmdKorean(v: unknown): string {
  if (v == null || v === '') return '—';
  const digits = String(v).replace(/\D/g, '');
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
  }
  return String(v);
}

export function getJoRevisionMetaFromChangeLog(log: {
  comparisonData?: unknown;
  rawData?: unknown;
}): Record<string, unknown> | null {
  const cd = log.comparisonData;
  if (cd && typeof cd === 'object') {
    const jm = (cd as Record<string, unknown>).joRevisionMeta;
    if (jm && typeof jm === 'object') return jm as Record<string, unknown>;
  }
  const rd = log.rawData;
  if (rd && typeof rd === 'object') {
    const r = rd as Record<string, unknown>;
    const row = r.lsJoHstInfRow;
    if (row && typeof row === 'object') return row as Record<string, unknown>;
  }
  return null;
}

export function truncateText(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
}
