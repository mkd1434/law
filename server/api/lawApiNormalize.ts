/**
 * 법제처 API JSON 응답 형태가 버전/엔드포인트마다 달라 공통으로 배열을 뽑는 유틸
 */

export function normalizeLsHstInfList(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.law)) return payload.law;

  const search = payload.LawSearch ?? payload.lawSearch ?? payload;
  const inf = search?.lsHstInf ?? search?.LsHstInf ?? payload.lsHstInf ?? payload.LsHstInf;
  if (!inf) return [];

  const law = inf.law ?? inf.Law ?? inf;
  if (Array.isArray(law)) return law;
  if (law && typeof law === 'object') return [law];
  return [];
}

export function normalizeAdmrulList(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.admrul)) return payload.admrul;

  const search = payload.LawSearch ?? payload.lawSearch ?? payload;
  const block = search?.admrul ?? search?.AdmRul ?? payload.admrul;
  if (!block) return [];

  const rows = block.admrul ?? block.row ?? block.law ?? block;
  if (Array.isArray(rows)) return rows;
  if (rows && typeof rows === 'object') return [rows];
  return [];
}

/** lsHstInf 응답에서 총 건수 (페이지네이션용) */
export function readLsHstInfTotalCnt(payload: any): number {
  if (!payload) return 0;
  const n = payload.totalCnt ?? payload.TotalCnt ?? payload.LawSearch?.totalCnt;
  const num = typeof n === 'string' ? parseInt(n, 10) : Number(n);
  return Number.isFinite(num) ? num : 0;
}

/** admrul 응답 총 건수 */
export function readAdmrulTotalCnt(payload: any): number {
  if (!payload) return 0;
  const n = payload.totalCnt ?? payload.TotalCnt ?? payload.LawSearch?.totalCnt;
  const num = typeof n === 'string' ? parseInt(n, 10) : Number(n);
  return Number.isFinite(num) ? num : 0;
}
