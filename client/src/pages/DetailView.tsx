import { useRoute, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import {
  joinArticleDisplayText,
  joinArticleDisplayTextDeep,
} from '@shared/extractArticleDisplayText';
import {
  toLawContentPayload,
  toRuleContentPayload,
} from '@shared/oldNewContentPayload';
import {
  getJoRevisionMetaFromChangeLog,
  resolveLawGoKrUrl,
  formatYmdKorean,
} from '@/lib/joRevisionMeta';

function mergeLawRulePayload(envelope: unknown): {
  oldText: string;
  newText: string;
} {
  if (!envelope || typeof envelope !== 'object') return { oldText: '', newText: '' };
  const law = toLawContentPayload(envelope);
  const rule = toRuleContentPayload(envelope);
  return {
    oldText: (law.oldText || rule.oldText || '').trim(),
    newText: (law.newText || rule.newText || '').trim(),
  };
}

function pickArticleRoots(envelope: unknown): { old: unknown; new: unknown } {
  if (!envelope || typeof envelope !== 'object') return { old: null, new: null };
  const e = envelope as Record<string, unknown>;
  const svc =
    (e.OldAndNewService as object | undefined) ||
    (e.OldAndNew as object | undefined) ||
    (e.AdmrulOldAndNewService as object | undefined) ||
    (e.admrulOldAndNew as object | undefined);
  const s =
    svc && typeof svc === 'object' ? (svc as Record<string, unknown>) : e;
  return {
    old: e.구조문목록 ?? s?.구조문목록 ?? null,
    new: e.신조문목록 ?? s?.신조문목록 ?? null,
  };
}

function looksLikeHtmlFragment(s: string): boolean {
  return s.includes('<') && s.includes('>');
}

function ArticleBody({ body }: { body: string }) {
  if (!body || body === '데이터 없음') {
    return <p className="text-gray-500 text-sm">표시할 본문이 없습니다.</p>;
  }
  if (looksLikeHtmlFragment(body)) {
    return (
      <div
        className="text-sm text-gray-700 whitespace-pre-wrap font-mono"
        dangerouslySetInnerHTML={{ __html: body }}
      />
    );
  }
  return (
    <div className="text-sm text-gray-700 whitespace-pre-wrap font-mono">{body}</div>
  );
}

/**
 * 신구법 비교 상세 페이지
 * 좌측(구법) vs 우측(신법) 2컬럼 레이아웃으로 변경 내용 대조
 * 로그인 없이 누구나 접근 가능
 */
export default function DetailView() {
  const [, params] = useRoute('/detail/:id');
  const [, navigate] = useLocation();
  const changeLogId = params?.id ? parseInt(params.id) : null;

  // 변경 로그 조회 (공개 접근)
  const { data: changeLogs, isLoading } = trpc.monitoring.getChangeLogs.useQuery(
    { limit: 1000 },
    { enabled: true }
  );

  const changeLog = changeLogs?.find((log: any) => log.id === changeLogId);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
      </div>
    );
  }

  if (!changeLog) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-white via-purple-50 to-cyan-50">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <Button variant="outline" onClick={() => navigate('/')} className="mb-8">
            <ArrowLeft className="w-4 h-4 mr-2" />
            돌아가기
          </Button>
          <Card>
            <CardContent className="py-12">
              <p className="text-center text-gray-600">변경 사항을 찾을 수 없습니다.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const comparisonData = changeLog.comparisonData || {};
  const rawData = (changeLog as { rawData?: unknown }).rawData;
  const joMeta = getJoRevisionMetaFromChangeLog(changeLog);
  const joDetailLink =
    joMeta &&
    (joMeta['조문변경이력상세링크'] ?? joMeta['조문변경이력\n상세링크']);
  const joArticleLink = joMeta && joMeta['조문링크'];

  const parseStoredContent = (rawContent: unknown): { oldHtml: string; newHtml: string } => {
    if (!rawContent || typeof rawContent !== 'string') return { oldHtml: '', newHtml: '' };
    try {
      const parsed = JSON.parse(rawContent);
      const oldHtml = typeof parsed?.구조문목록 === 'string'
        ? parsed.구조문목록
        : JSON.stringify(parsed?.구조문목록 ?? '', null, 2);
      const newHtml = typeof parsed?.신조문목록 === 'string'
        ? parsed.신조문목록
        : JSON.stringify(parsed?.신조문목록 ?? '', null, 2);
      return { oldHtml, newHtml };
    } catch {
      return { oldHtml: '', newHtml: '' };
    }
  };

  const parsedContent = parseStoredContent(changeLog.content);

  const rootsFromComparison = pickArticleRoots(comparisonData);
  const rawEnvelope =
    rawData && typeof rawData === 'object'
      ? (rawData as Record<string, unknown>).oldAndNew ??
        (rawData as Record<string, unknown>).admrulOldAndNew ??
        rawData
      : null;
  const rootsFromRaw = pickArticleRoots(rawEnvelope);

  const treeOld = (root: unknown) =>
    joinArticleDisplayText(root) || joinArticleDisplayTextDeep(root);
  const fromTreesOld =
    treeOld(rootsFromComparison.old) || treeOld(rootsFromRaw.old);
  const fromTreesNew =
    treeOld(rootsFromComparison.new) || treeOld(rootsFromRaw.new);

  const fromComparisonPayload = mergeLawRulePayload(comparisonData);
  const fromRawPayload =
    rawData && typeof rawData === 'object'
      ? (() => {
          const r = rawData as Record<string, unknown>;
          if (r.oldAndNew) return mergeLawRulePayload(r.oldAndNew);
          if (r.admrulOldAndNew) return mergeLawRulePayload(r.admrulOldAndNew);
          return { oldText: '', newText: '' };
        })()
      : { oldText: '', newText: '' };

  const oldText =
    (parsedContent.oldHtml && parsedContent.oldHtml.trim()) ||
    (typeof comparisonData.oldText === 'string' && comparisonData.oldText.trim()) ||
    fromComparisonPayload.oldText ||
    fromTreesOld ||
    fromRawPayload.oldText ||
    '데이터 없음';
  const newText =
    (parsedContent.newHtml && parsedContent.newHtml.trim()) ||
    (typeof comparisonData.newText === 'string' && comparisonData.newText.trim()) ||
    fromComparisonPayload.newText ||
    fromTreesNew ||
    fromRawPayload.newText ||
    '데이터 없음';

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-purple-50 to-cyan-50">
      {/* 헤더 */}
      <div className="border-b border-gray-200 bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <Button variant="outline" onClick={() => navigate('/')} className="mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            돌아가기
          </Button>
          <h1 className="text-3xl font-bold text-gray-900">{changeLog.announcementNo}</h1>
          <div className="flex items-center gap-4 mt-4">
            <Badge variant={changeLog.status === 'upcoming' ? 'default' : 'secondary'}>
              {changeLog.status === 'upcoming' ? '시행 예정' : '현행'}
            </Badge>
            <p className="text-gray-600">
              시행일: {new Date(changeLog.effectiveDate).toLocaleDateString('ko-KR')}
            </p>
          </div>
        </div>
      </div>

      {/* 메인 콘텐츠 */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 구법 (좌측) */}
          <Card className="border-2 border-red-200 bg-red-50">
            <CardHeader>
              <CardTitle className="text-red-700">구법 (Old Law)</CardTitle>
              <CardDescription>이전 버전의 법령/규칙</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-white p-4 rounded border border-red-200 max-h-96 overflow-y-auto">
                <ArticleBody
                  body={
                    typeof oldText === 'string' ? oldText : JSON.stringify(oldText, null, 2)
                  }
                />
              </div>
            </CardContent>
          </Card>

          {/* 신법 (우측) */}
          <Card className="border-2 border-green-200 bg-green-50">
            <CardHeader>
              <CardTitle className="text-green-700">신법 (New Law)</CardTitle>
              <CardDescription>새로운 버전의 법령/규칙</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-white p-4 rounded border border-green-200 max-h-96 overflow-y-auto">
                <ArticleBody
                  body={
                    typeof newText === 'string' ? newText : JSON.stringify(newText, null, 2)
                  }
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {joMeta ? (
          <Card className="mt-8 border-indigo-200 bg-indigo-50/40">
            <CardHeader>
              <CardTitle className="text-indigo-900">조문 개정 이력</CardTitle>
              <CardDescription>
                국가법령정보 lsJoHstInf 조회로 수집한 공포·시행·조문 링크 정보입니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <dt className="text-gray-600">공포일자</dt>
                  <dd className="font-medium text-gray-900">
                    {formatYmdKorean(joMeta['공포일자'])}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-600">시행일자 (법령)</dt>
                  <dd className="font-medium text-gray-900">
                    {formatYmdKorean(joMeta['시행일자'])}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-600">조문개정일</dt>
                  <dd className="font-medium text-gray-900">
                    {formatYmdKorean(joMeta['조문개정일'] ?? joMeta['조문제개정일'])}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-600">조문시행일</dt>
                  <dd className="font-medium text-gray-900">
                    {formatYmdKorean(joMeta['조문시행일'])}
                  </dd>
                </div>
                {(joMeta['조문정보'] != null && String(joMeta['조문정보']).trim() !== '') ||
                (joMeta['조문번호'] != null && String(joMeta['조문번호']).trim() !== '') ? (
                  <div className="sm:col-span-2">
                    <dt className="text-gray-600">조문</dt>
                    <dd className="font-medium text-gray-900">
                      {String(joMeta['조문정보'] ?? '').trim() ||
                        (joMeta['조문번호'] != null ? `조문 ${String(joMeta['조문번호'])}` : '—')}
                    </dd>
                  </div>
                ) : null}
                {joMeta['변경사유'] != null && String(joMeta['변경사유']).trim() !== '' ? (
                  <div className="sm:col-span-2">
                    <dt className="text-gray-600">변경사유</dt>
                    <dd className="font-medium text-gray-900 whitespace-pre-wrap">
                      {String(joMeta['변경사유'])}
                    </dd>
                  </div>
                ) : null}
              </dl>
              <div className="flex flex-wrap gap-3 pt-2">
                {resolveLawGoKrUrl(joArticleLink as string | undefined) ? (
                  <a
                    href={resolveLawGoKrUrl(joArticleLink as string) ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-indigo-700 underline hover:text-indigo-900"
                  >
                    조문 링크 (law.go.kr)
                  </a>
                ) : null}
                {resolveLawGoKrUrl(joDetailLink as string | undefined) ? (
                  <a
                    href={resolveLawGoKrUrl(joDetailLink as string) ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-indigo-700 underline hover:text-indigo-900"
                  >
                    조문 변경이력 상세
                  </a>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* 상세 정보 */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>상세 정보</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-gray-600">공고 번호</p>
                <p className="font-semibold text-gray-900">{changeLog.announcementNo}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">시행 예정 날짜</p>
                <p className="font-semibold text-gray-900">
                  {new Date(changeLog.effectiveDate).toLocaleDateString('ko-KR')}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">상태</p>
                <p className="font-semibold text-gray-900">
                  {changeLog.status === 'upcoming' ? '시행 예정' : '현행'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">등록 일시</p>
                <p className="font-semibold text-gray-900">
                  {new Date(changeLog.createdAt).toLocaleDateString('ko-KR')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
