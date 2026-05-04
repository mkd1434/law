/**
 * 법제처 API JSON 응답 형태가 버전/엔드포인트마다 달라 공통으로 배열을 뽑는 유틸
 */

function parseJsonIfString(payload: unknown): any {
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
  return payload;
}

/** 단일 행 객체를 길이 1 배열로 통일 */
function toRowArray(v: unknown): any[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "object") return [v as any];
  return [];
}

/** 객체 직계 값 중 "법령/조문 이력 행 배열"로 보이는 첫 배열 */
function scanObjectForRowArrays(node: object): any[] {
  for (const val of Object.values(node)) {
    if (!Array.isArray(val) || val.length === 0) continue;
    const first = val[0];
    if (!first || typeof first !== "object") continue;
    const r = first as Record<string, unknown>;
    if (
      r["법령ID"] != null ||
      r["법령명한글"] != null ||
      r["법령명"] != null ||
      r["조문번호"] != null ||
      r["조문개정일"] != null ||
      r["조문제개정일"] != null ||
      r["조문링크"] != null ||
      r["조문정보"] != null
    ) {
      return val as any[];
    }
  }
  return [];
}

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

/**
 * lsJoHstInf (조문 개정 이력) 목록.
 * 실제 JSON은 (1) `LawSearch.law`만 채우고 `lsJoHstInf` 키가 없거나,
 * (2) `lsJoHstInf.law` / `row` / `jo` 등으로 오는 경우가 섞여 있음.
 */
export function normalizeLsJoHstInfList(payload: any): any[] {
  const root = parseJsonIfString(payload);
  if (!root) return [];
  if (Array.isArray(root)) return root;
  if (Array.isArray(root.data)) return root.data;
  if (Array.isArray(root.law)) return root.law;

  const search = root.LawSearch ?? root.lawSearch ?? root;

  const inf =
    search?.lsJoHstInf ??
    search?.LsJoHstInf ??
    root.lsJoHstInf ??
    root.LsJoHstInf;

  if (Array.isArray(inf)) return inf;

  if (inf && typeof inf === "object") {
    for (const key of ["law", "Law", "jo", "Jo", "row", "Row", "list", "List"]) {
      const arr = toRowArray((inf as Record<string, unknown>)[key]);
      if (arr.length > 0) return arr;
    }
    const fromInf = scanObjectForRowArrays(inf);
    if (fromInf.length > 0) return fromInf;
  }

  const lawUnderSearch = toRowArray(search?.law ?? search?.Law);
  if (lawUnderSearch.length > 0) return lawUnderSearch;

  if (search && typeof search === "object" && !Array.isArray(search)) {
    const fromSearch = scanObjectForRowArrays(search);
    if (fromSearch.length > 0) return fromSearch;
  }

  return [];
}

/** lsJoHstInf totalCnt (조문이 있는 법령 건수 등 명세 필드) */
export function readLsJoHstInfTotalCnt(payload: any): number {
  return readLsHstInfTotalCnt(payload);
}

/** lsHstInf 응답에서 총 건수 (페이지네이션용) */
export function readLsHstInfTotalCnt(payload: any): number {
  if (!payload) return 0;
  const search = payload.LawSearch ?? payload.lawSearch;
  const nestedJo = search?.lsJoHstInf ?? search?.LsJoHstInf;
  const n =
    payload.totalCnt ??
    payload.TotalCnt ??
    search?.totalCnt ??
    search?.TotalCnt ??
    (nestedJo && typeof nestedJo === "object" && !Array.isArray(nestedJo)
      ? (nestedJo as any).totalCnt ?? (nestedJo as any).TotalCnt
      : undefined);
  const num = typeof n === "string" ? parseInt(n, 10) : Number(n);
  return Number.isFinite(num) ? num : 0;
}

/** admrul 응답 총 건수 */
export function readAdmrulTotalCnt(payload: any): number {
  if (!payload) return 0;
  const n = payload.totalCnt ?? payload.TotalCnt ?? payload.LawSearch?.totalCnt;
  const num = typeof n === 'string' ? parseInt(n, 10) : Number(n);
  return Number.isFinite(num) ? num : 0;
}
