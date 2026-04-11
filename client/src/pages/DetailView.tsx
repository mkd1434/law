import { useRoute, useLocation } from 'wouter';
import { useAuth } from '@/_core/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';

/**
 * 신구법 비교 상세 페이지
 * 좌측(구법) vs 우측(신법) 2컬럼 레이아웃으로 변경 내용 대조
 */
export default function DetailView() {
  const [, params] = useRoute('/detail/:id');
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();
  const changeLogId = params?.id ? parseInt(params.id) : null;

  // 변경 로그 조회
  const { data: changeLogs, isLoading } = trpc.monitoring.getChangeLogs.useQuery(
    { limit: 1000 },
    { enabled: isAuthenticated }
  );

  const changeLog = changeLogs?.find((log: any) => log.id === changeLogId);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">로그인이 필요합니다.</p>
      </div>
    );
  }

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
  const oldText = comparisonData.oldText || '데이터 없음';
  const newText = comparisonData.newText || '데이터 없음';

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
                <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono">
                  {typeof oldText === 'string' ? oldText : JSON.stringify(oldText, null, 2)}
                </pre>
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
                <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono">
                  {typeof newText === 'string' ? newText : JSON.stringify(newText, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>
        </div>

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
