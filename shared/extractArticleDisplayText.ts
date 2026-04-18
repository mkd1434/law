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
