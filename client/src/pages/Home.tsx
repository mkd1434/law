import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Loader2, FileText, AlertCircle, CheckCircle2, Search } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { Link } from 'wouter';

/**
 * 법령 및 행정규칙 통합 모니터링 시스템 - 메인 페이지
 * 최근 1년 이내의 개정 사항 및 미래 시행 예정 목록을 표시
 * 
 * 로그인 불필요 - 누구나 바로 메인 화면 접근 가능
 * 데이터는 페이지 로드 시 자동으로 조회됨
 */
export default function Home() {
  const [selectedTab, setSelectedTab] = useState<'law' | 'rule'>('law');
  const [searchQuery, setSearchQuery] = useState('');

  // 모니터링 대상 조회 (로그인 불필요 - 항상 활성화)
  const { data: monitoredItems, isLoading: itemsLoading } = trpc.monitoring.getMonitoredItems.useQuery(
    { type: selectedTab },
    { enabled: true } // 항상 활성화
  );

  // 변경 로그 조회 (로그인 불필요 - 항상 활성화)
  const { data: allChangeLogs, isLoading: logsLoading } = trpc.monitoring.getChangeLogs.useQuery(
    { limit: 1000 },
    { enabled: true } // 항상 활성화
  );

  const isLoading = itemsLoading || logsLoading;

  /**
   * 최근 1년 조건 필터링 및 타입별 분류
   * - 1년 이내: 현재 날짜 기준 365일 이내
   * - 타입별: 선택된 탭(law/rule)에 해당하는 항목만
   * - 상태별: current와 upcoming으로 분류
   * - 검색: 공고번호 또는 법령명으로 검색
   */
  const filteredChangeLogs = useMemo(() => {
    if (!allChangeLogs || !monitoredItems) return { current: [], upcoming: [] };

    const now = new Date();
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    // 모니터링 대상 ID 목록 (선택된 타입)
    const monitoredItemIds = new Set(monitoredItems.map((item: any) => item.id));

    // 필터링: 1년 이내 + 선택된 타입 + 검색어
    const filtered = allChangeLogs.filter((log: any) => {
      const effectiveDate = new Date(log.effectiveDate);
      const isWithinOneYear = effectiveDate >= oneYearAgo;
      const isMonitored = monitoredItemIds.has(log.itemId);
      const matchesSearch = !searchQuery || 
        log.announcementNo?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.lawName?.toLowerCase().includes(searchQuery.toLowerCase());
      return isWithinOneYear && isMonitored && matchesSearch;
    });

    // 상태별 분류
    return {
      current: filtered.filter((log: any) => log.status === 'current'),
      upcoming: filtered.filter((log: any) => log.status === 'upcoming'),
    };
  }, [allChangeLogs, monitoredItems, searchQuery]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-purple-50 to-cyan-50">
      {/* 헤더 */}
      <div className="border-b border-gray-200 bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-cyan-600 bg-clip-text text-transparent">
            법령 및 행정규칙 모니터링
          </h1>
          <p className="text-gray-600 mt-2">최근 1년 이내 변경 사항 및 시행 예정 목록</p>
        </div>
      </div>

      {/* 메인 콘텐츠 */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 검색창 */}
        <div className="mb-8">
          <div className="relative">
            <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="공고번호 또는 법령명으로 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
        </div>

        <Tabs defaultValue="law" onValueChange={(v) => setSelectedTab(v as 'law' | 'rule')} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-8">
            <TabsTrigger value="law">법령 (Laws)</TabsTrigger>
            <TabsTrigger value="rule">행정규칙 (Rules)</TabsTrigger>
          </TabsList>

          {/* 법령 탭 */}
          <TabsContent value="law" className="space-y-6">
            {/* 통계 카드 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">모니터링 대상</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-purple-600">{monitoredItems?.length || 0}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">최근 개정 (1년 이내)</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-cyan-600">{filteredChangeLogs.current.length}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">시행 예정</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-orange-600">{filteredChangeLogs.upcoming.length}</p>
                </CardContent>
              </Card>
            </div>

            {/* 로딩 상태 */}
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-purple-600 mr-2" />
                <span className="text-gray-600">데이터를 불러오는 중입니다...</span>
              </div>
            )}

            {/* 시행 예정 목록 (우선 표시) */}
            {!isLoading && filteredChangeLogs.upcoming.length > 0 && (
              <Card className="border-orange-200 bg-orange-50">
                <CardHeader>
                  <CardTitle className="text-orange-700">시행 예정 (Upcoming)</CardTitle>
                  <CardDescription>향후 시행될 법령 개정 사항</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {filteredChangeLogs.upcoming.slice(0, 10).map((log: any) => (
                      <Link key={log.id} href={`/detail/${log.id}`}>
                        <div className="p-4 border border-orange-200 rounded-lg hover:bg-orange-100 cursor-pointer transition-colors">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="font-semibold text-gray-900">{log.announcementNo}</p>
                              <p className="text-sm text-gray-600 mt-1">
                                법령명: {log.lawName || '미지정'}
                              </p>
                              <p className="text-sm text-gray-600">
                                시행일: {new Date(log.effectiveDate).toLocaleDateString('ko-KR')}
                              </p>
                            </div>
                            <Badge className="bg-orange-600 hover:bg-orange-700">시행 예정</Badge>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 최근 개정 목록 */}
            <Card>
              <CardHeader>
                <CardTitle>최근 개정 (Recent Changes)</CardTitle>
                <CardDescription>최근 1년 이내 개정된 법령</CardDescription>
              </CardHeader>
              <CardContent>
                {filteredChangeLogs.current && filteredChangeLogs.current.length > 0 ? (
                  <div className="space-y-3">
                    {filteredChangeLogs.current.slice(0, 20).map((log: any) => (
                      <Link key={log.id} href={`/detail/${log.id}`}>
                        <div className="p-4 border border-gray-200 rounded-lg hover:bg-purple-50 cursor-pointer transition-colors">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="font-semibold text-gray-900">{log.announcementNo}</p>
                              <p className="text-sm text-gray-600 mt-1">
                                법령명: {log.lawName || '미지정'}
                              </p>
                              <p className="text-sm text-gray-600">
                                시행일: {new Date(log.effectiveDate).toLocaleDateString('ko-KR')}
                              </p>
                            </div>
                            <Badge variant="secondary">현행</Badge>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">
                    {searchQuery ? '검색 결과가 없습니다.' : '최근 1년 이내 개정 사항이 없습니다.'}
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 행정규칙 탭 */}
          <TabsContent value="rule" className="space-y-6">
            {/* 통계 카드 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">모니터링 대상</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-purple-600">{monitoredItems?.length || 0}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">최근 개정 (1년 이내)</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-cyan-600">{filteredChangeLogs.current.length}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">시행 예정</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-orange-600">{filteredChangeLogs.upcoming.length}</p>
                </CardContent>
              </Card>
            </div>

            {/* 로딩 상태 */}
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-purple-600 mr-2" />
                <span className="text-gray-600">데이터를 불러오는 중입니다...</span>
              </div>
            )}

            {/* 시행 예정 목록 */}
            {!isLoading && filteredChangeLogs.upcoming.length > 0 && (
              <Card className="border-orange-200 bg-orange-50">
                <CardHeader>
                  <CardTitle className="text-orange-700">시행 예정 (Upcoming)</CardTitle>
                  <CardDescription>향후 시행될 행정규칙 개정 사항</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {filteredChangeLogs.upcoming.slice(0, 10).map((log: any) => (
                      <Link key={log.id} href={`/detail/${log.id}`}>
                        <div className="p-4 border border-orange-200 rounded-lg hover:bg-orange-100 cursor-pointer transition-colors">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="font-semibold text-gray-900">{log.announcementNo}</p>
                              <p className="text-sm text-gray-600 mt-1">
                                규칙명: {log.lawName || '미지정'}
                              </p>
                              <p className="text-sm text-gray-600">
                                시행일: {new Date(log.effectiveDate).toLocaleDateString('ko-KR')}
                              </p>
                            </div>
                            <Badge className="bg-orange-600 hover:bg-orange-700">시행 예정</Badge>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 최근 개정 목록 */}
            <Card>
              <CardHeader>
                <CardTitle>최근 개정 (Recent Changes)</CardTitle>
                <CardDescription>최근 1년 이내 개정된 행정규칙</CardDescription>
              </CardHeader>
              <CardContent>
                {filteredChangeLogs.current && filteredChangeLogs.current.length > 0 ? (
                  <div className="space-y-3">
                    {filteredChangeLogs.current.slice(0, 20).map((log: any) => (
                      <Link key={log.id} href={`/detail/${log.id}`}>
                        <div className="p-4 border border-gray-200 rounded-lg hover:bg-purple-50 cursor-pointer transition-colors">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="font-semibold text-gray-900">{log.announcementNo}</p>
                              <p className="text-sm text-gray-600 mt-1">
                                규칙명: {log.lawName || '미지정'}
                              </p>
                              <p className="text-sm text-gray-600">
                                시행일: {new Date(log.effectiveDate).toLocaleDateString('ko-KR')}
                              </p>
                            </div>
                            <Badge variant="secondary">현행</Badge>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">
                    {searchQuery ? '검색 결과가 없습니다.' : '최근 1년 이내 개정 사항이 없습니다.'}
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* 정보 섹션 */}
        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8">
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <FileText className="w-8 h-8 text-purple-600 mb-2" />
              <CardTitle>법령 모니터링</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                법령 변경이력 API를 통해 최근 1년 및 미래 시행 예정 건을 자동 감지
              </p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg">
            <CardHeader>
              <AlertCircle className="w-8 h-8 text-cyan-600 mb-2" />
              <CardTitle>행정규칙 모니터링</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                행정규칙 목록 조회 API로 신규 및 미래 시행 데이터를 자동 판별
              </p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg">
            <CardHeader>
              <CheckCircle2 className="w-8 h-8 text-purple-600 mb-2" />
              <CardTitle>신구법 비교</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                구법과 신법을 2컬럼 레이아웃으로 직관적으로 비교 분석
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
