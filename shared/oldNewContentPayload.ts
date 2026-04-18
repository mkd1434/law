/**
 * 법제처 oldAndNew / 행정규칙 admrulOldAndNew 응답 → 저장·화면용 content + old/new 텍스트.
 * 서버(lawDetector/ruleDetector)와 클라이언트(DetailView)에서 동일 로직을 씁니다.
 */

import {
  joinArticleDisplayText,
  joinArticleDisplayTextDeep,
} from './extractArticleDisplayText';

function textsFromArticleRoots(
  oldArticles: unknown,
  newArticles: unknown
): { oldText: string; newText: string } {
  const oldText =
    joinArticleDisplayText(oldArticles) ||
    joinArticleDisplayTextDeep(oldArticles);
  const newText =
    joinArticleDisplayText(newArticles) ||
    joinArticleDisplayTextDeep(newArticles);
  return { oldText, newText };
}

export function toLawContentPayload(response: any): {
  content: string;
  oldText: string;
  newText: string;
} {
  const svc = response?.OldAndNewService ?? response?.OldAndNew ?? response;
  const newArticles = svc?.신조문목록 ?? response?.신조문목록 ?? null;
  const oldArticles = svc?.구조문목록 ?? response?.구조문목록 ?? null;
  const payload = { 신조문목록: newArticles, 구조문목록: oldArticles };
  const content = JSON.stringify(payload);
  const { oldText, newText } = textsFromArticleRoots(oldArticles, newArticles);
  return { content, oldText, newText };
}

export function toRuleContentPayload(response: any): {
  content: string;
  oldText: string;
  newText: string;
} {
  const svc =
    response?.AdmrulOldAndNewService ?? response?.admrulOldAndNew ?? response;
  const newArticles = svc?.신조문목록 ?? response?.신조문목록 ?? null;
  const oldArticles = svc?.구조문목록 ?? response?.구조문목록 ?? null;
  const payload = { 신조문목록: newArticles, 구조문목록: oldArticles };
  const content = JSON.stringify(payload);
  const { oldText, newText } = textsFromArticleRoots(oldArticles, newArticles);
  return { content, oldText, newText };
}
