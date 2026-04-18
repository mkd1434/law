/**
 * 법제처 oldAndNew / 행정규칙 admrulOldAndNew JSON에서 화면용 본문 문자열 수집.
 * (HTML 조문 + 조문내용 등 일반 텍스트 모두 포함)
 */

const PRIORITY_TEXT_KEYS = [
  '조문내용',
  '항내용',
  '호내용',
  '목내용',
  '내용',
] as const;

function isLikelyHtmlFragment(s: string): boolean {
  return s.includes('<') && s.includes('>');
}

export function collectArticleDisplayParts(node: unknown): string[] {
  if (node == null) return [];
  if (typeof node === 'string') {
    const t = node.trim();
    if (!t) return [];
    return [t];
  }
  if (typeof node === 'number' || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap(collectArticleDisplayParts);
  if (typeof node !== 'object') return [];

  const o = node as Record<string, unknown>;
  const chunks: string[] = [];

  for (const key of PRIORITY_TEXT_KEYS) {
    const v = o[key];
    if (typeof v === 'string' && v.trim()) {
      chunks.push(v.trim());
    }
  }

  for (const [k, v] of Object.entries(o)) {
    if ((PRIORITY_TEXT_KEYS as readonly string[]).includes(k)) continue;
    chunks.push(...collectArticleDisplayParts(v));
  }

  return chunks;
}

/** HTML 블록은 그대로, 그 외는 단락 구분으로 이어 붙임 */
export function joinArticleDisplayText(node: unknown): string {
  const parts = collectArticleDisplayParts(node);
  if (parts.length === 0) return '';

  const htmlBlocks = parts.filter(isLikelyHtmlFragment);
  if (htmlBlocks.length > 0 && htmlBlocks.length === parts.length) {
    return htmlBlocks.join('\n');
  }

  return parts.join('\n\n');
}

const HANGUL = /[가-힣]/;

function isNoiseString(s: string): boolean {
  const t = s.trim();
  if (t.length < 2) return true;
  if (/^(Y|N|O|X|true|false|null|undefined|\d{1,8})$/i.test(t)) return true;
  return false;
}

/**
 * 조문 키 이름이 API마다 달라 `collectArticleDisplayParts`가 비었을 때,
 * 트리 아래의 의미 있는 문자열(한글·긴 문장)을 넓게 수집합니다.
 */
export function joinArticleDisplayTextDeep(node: unknown): string {
  const seen = new Set<string>();
  const out: string[] = [];
  let totalLen = 0;
  const MAX_PARTS = 2000;
  const MAX_TOTAL = 450_000;

  const walk = (n: unknown): void => {
    if (n == null || out.length >= MAX_PARTS || totalLen >= MAX_TOTAL) return;
    if (typeof n === 'string') {
      const t = n.trim();
      if (isNoiseString(t)) return;
      if (t.length < 12 && !HANGUL.test(t)) return;
      if (seen.has(t)) return;
      seen.add(t);
      out.push(t);
      totalLen += t.length + 2;
      return;
    }
    if (typeof n === 'number' || typeof n === 'boolean') return;
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    if (typeof n === 'object') {
      for (const v of Object.values(n as Record<string, unknown>)) walk(v);
    }
  };

  walk(node);
  return out.join('\n\n');
}
