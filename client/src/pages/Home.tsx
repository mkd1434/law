import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Loader2, FileText, AlertCircle, CheckCircle2, Search, ChevronDown, ChevronUp, X } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { Link } from 'wouter';

type ActiveSection = 'monitored' | 'current' | 'upcoming' | null;

/**
 * 법령 및 행정규칙 통합 모니터링 시스템 - 메인 페이지
 * 최근 3년 이내의 개정 사항 및 미래 시행 예정 목록을 표시
 * 
 * 로그인 불필요 - 누구나 바로 메인 화면 접근 가능
 * 데이터는 페이지 로드 시 자동으로 조회됨
 */
export default function Home() {
  const [selectedTab, setSelectedTab] = useState<'law' | 'rule'>('law');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSection, setActiveSection] = useState<ActiveSection>(null);

  // 모니터링 대상 조회 (로그인 불필요 - 항상 활성화)
  // 에러 무시하고 빈 배열 반환 (Graceful Degradation)
  const { data: monitoredItems = [], isLoading: itemsLoading, error: itemsError } = trpc.monitoring.getMonitoredItems.useQuery(
    { type: selectedTab },
    { 
      enabled: true, // 항상 활성화
      retry: false, // 재시도 안 함
    }
  );

  // 변경 로그 조회 (로그인 불필요 - 항상 활성화)
  // 에러 무시하고 빈 배열 반환 (Graceful Degradation)
  const { data: allChangeLogs = [], isLoading: logsLoading, error: logsError } = trpc.monitoring.getChangeLogs.useQuery(
    { limit: 1000 },
    { 
      enabled: true, // 항상 활성화
      retry: false, // 재시도 안 함
    }
  );

  const isLoading = itemsLoading || logsLoading;

  // 에러 로깅 (디버깅용)
  if (itemsError) {
    console.warn('[Home] Items error (무시됨):', itemsError);
  }
  if (logsError) {
    console.warn('[Home] Logs error (무시됨):', logsError);
  }

  /**
   * 최근 3년 조건 필터링 및 타입별 분류
   * - 3년 이내: 현재 날짜 기준 1095일 이내
   * - 타입별: 선택된 탭(law/rule)에 해당하는 항목만
   * - 상태별: current와 upcoming으로 분류
   * - 검색: 공고번호 또는 법령명으로 검색
   */
  const filteredChangeLogs = useMemo(() => {
    if (!allChangeLogs || !monitoredItems) return { current: [], upcoming: [] };

    const now = new Date();
    const threeYearsAgo = new Date(now.getTime() - 3 * 365 * 24 * 60 * 60 * 1000); // 3년 날짜

    // 모니터링 대상 ID 목록 (선택된 타입)
    const monitoredItemIds = new Set(monitoredItems.map((item: any) => item.id));

    // 필터링: 3년 이내 + 선택된 타입 + 검색어
    const filtered = allChangeLogs.filter((log: any) => {
      const effectiveDate = new Date(log.effectiveDate);
      const isWithinThreeYears = effectiveDate >= threeYearsAgo;
      const isMonitored = monitoredItemIds.has(log.itemId);
      const matchesSearch = !searchQuery || 
        log.announcementNo?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.lawName?.toLowerCase().includes(searchQuery.toLowerCase());
      return isWithinThreeYears && isMonitored && matchesSearch;
    });

    // 상태별 분류
    return {
      current: filtered.filter((log: any) => log.status === 'current'),
      upcoming: filtered.filter((log: any) => log.status === 'upcoming'),
    };
  }, [allChangeLogs, monitoredItems, searchQuery]);

  // 통계 카드 클릭 핸들러
  const handleStatCardClick = (section: ActiveSection) => {
    setActiveSection(activeSection === section ? null : section);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-purple-50 to-cyan-50">
      {/* 헤더 */}
      <div className="border-b border-gray-200 bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-cyan-600 bg-clip-text text-transparent">
            법령 및 행정규칙 모니터링
          </h1>
          <p className="text-gray-600 mt-2">최근 3년 이내 변경 사항 및 시행 예정 목록</p>
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

        <Tabs defaultValue="law" onValueChange={(v) => { setSelectedTab(v as 'law' | 'rule'); setActiveSection(null); }} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-8">
            <TabsTrigger value="law">법령 (Laws)</TabsTrigger>
            <TabsTrigger value="rule">행정규칙 (Rules)</TabsTrigger>
          </TabsList>

          {/* 법령 탭 */}
          <TabsContent value="law" className="space-y-6">
            {/* 통계 카드 - 클릭 가능 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* 모니터링 대상 카드 */}
              <button
                onClick={() => handleStatCardClick('monitored')}
                className="text-left hover:shadow-lg transition-shadow"
              >
                <Card className={`cursor-pointer transition-colors ${activeSection === 'monitored' ? 'border-purple-500 bg-purple-50' : ''}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-600">모니터링 대상</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-purple-600">{monitoredItems?.length || 0}</p>
                    <p className="text-xs text-gray-500 mt-2">클릭하여 목록 보기</p>
                  </CardContent>
                </Card>
              </button>

              {/* 최근 개정 카드 */}
              <button
                onClick={() => handleStatCardClick('current')}
                className="text-left hover:shadow-lg transition-shadow"
              >
                <Card className={`cursor-pointer transition-colors ${activeSection === 'current' ? 'border-cyan-500 bg-cyan-50' : ''}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-600">최근 개정 (3년 이내)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-cyan-600">{filteredChangeLogs.current.length}</p>
                    <p className="text-xs text-gray-500 mt-2">클릭하여 목록 보기</p>
                  </CardContent>
                </Card>
              </button>

              {/* 시행 예정 카드 */}
              <button
                onClick={() => handleStatCardClick('upcoming')}
                className="text-left hover:shadow-lg transition-shadow"
              >
                <Card className={`cursor-pointer transition-colors ${activeSection === 'upcoming' ? 'border-orange-500 bg-orange-50' : ''}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-600">시행 예정</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-orange-600">{filteredChangeLogs.upcoming.length}</p>
                    <p className="text-xs text-gray-500 mt-2">클릭하여 목록 보기</p>
                  </CardContent>
                </Card>
              </button>
            </div>

            {/* 로딩 상태 */}
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-purple-600 mr-2" />
                <span className="text-gray-600">데이터를 불러오는 중입니다...</span>
              </div>
            )}

            {/* 모니터링 대상 목록 */}
            {activeSection === 'monitored' && !isLoading && (
              <Card className="border-purple-200 bg-purple-50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-purple-700">모니터링 대상 목록</CardTitle>
                      <CardDescription>총 {monitoredItems?.length || 0}개</CardDescription>
                    </div>
                    <button
                      onClick={() => setActiveSection(null)}
                      className="p-1 hover:bg-purple-100 rounded transition-colors"
                    >
                      <X className="w-5 h-5 text-gray-600" />
                    </button>
                  </div>
                </CardHeader>
                <CardContent>
                  {monitoredItems && monitoredItems.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {monitoredItems.map((item: any) => (
                        <div key={item.id} className="p-3 border border-purple-200 rounded-lg bg-white hover:bg-purple-100 transition-colors">
                          <p className="font-medium text-gray-900">{item.name}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <Badge variant="secondary" className="text-xs">
                              {item.type === 'law' ? '법령' : '규칙'}
                            </Badge>
                            {item.externalId && (
                              <span className="text-xs text-gray-500">MST: {item.externalId}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-center py-4">모니터링 대상이 없습니다.</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* 최근 개정 목록 */}
            {activeSection === 'current' && !isLoading && (
              <Card className="border-cyan-200 bg-cyan-50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-cyan-700">최근 개정 (Recent Changes)</CardTitle>
                      <CardDescription>최근 3년 이내 개정된 항목 - 총 {filteredChangeLogs.current.length}개</CardDescription>
                    </div>
                    <button
                      onClick={() => setActiveSection(null)}
                      className="p-1 hover:bg-cyan-100 rounded transition-colors"
                    >
                      <X className="w-5 h-5 text-gray-600" />
                    </button>
                  </div>
                </CardHeader>
                <CardContent>
                  {filteredChangeLogs.current && filteredChangeLogs.current.length > 0 ? (
                    <div className="space-y-3">
                      {filteredChangeLogs.current.map((log: any) => (
                        <Link key={log.id} href={`/detail/${log.id}`}>
                          <div className="p-4 border border-cyan-200 rounded-lg bg-white hover:bg-cyan-100 cursor-pointer transition-colors">
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
                      {searchQuery ? '검색 결과가 없습니다.' : '최근 3년 이내 개정 사항이 없습니다.'}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* 시행 예정 목록 */}
            {activeSection === 'upcoming' && !isLoading && (
              <Card className="border-orange-200 bg-orange-50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-orange-700">시행 예정 (Upcoming)</CardTitle>
                      <CardDescription>향후 시행될 항목 - 총 {filteredChangeLogs.upcoming.length}개</CardDescription>
                    </div>
                    <button
                      onClick={() => setActiveSection(null)}
                      className="p-1 hover:bg-orange-100 rounded transition-colors"
                    >
                      <X className="w-5 h-5 text-gray-600" />
                    </button>
                  </div>
                </CardHeader>
                <CardContent>
                  {filteredChangeLogs.upcoming && filteredChangeLogs.upcoming.length > 0 ? (
                    <div className="space-y-3">
                      {filteredChangeLogs.upcoming.map((log: any) => (
                        <Link key={log.id} href={`/detail/${log.id}`}>
                          <div className="p-4 border border-orange-200 rounded-lg bg-white hover:bg-orange-100 cursor-pointer transition-colors">
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
                  ) : (
                    <p className="text-gray-500 text-center py-8">시행 예정인 항목이 없습니다.</p>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* 행정규칙 탭 */}
          <TabsContent value="rule" className="space-y-6">
            {/* 통계 카드 - 클릭 가능 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* 모니터링 대상 카드 */}
              <button
                onClick={() => handleStatCardClick('monitored')}
                className="text-left hover:shadow-lg transition-shadow"
              >
                <Card className={`cursor-pointer transition-colors ${activeSection === 'monitored' ? 'border-purple-500 bg-purple-50' : ''}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-600">모니터링 대상</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-purple-600">{monitoredItems?.length || 0}</p>
                    <p className="text-xs text-gray-500 mt-2">클릭하여 목록 보기</p>
                  </CardContent>
                </Card>
              </button>

              {/* 최근 개정 카드 */}
              <button
                onClick={() => handleStatCardClick('current')}
                className="text-left hover:shadow-lg transition-shadow"
              >
                <Card className={`cursor-pointer transition-colors ${activeSection === 'current' ? 'border-cyan-500 bg-cyan-50' : ''}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-600">최근 개정 (3년 이내)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-cyan-600">{filteredChangeLogs.current.length}</p>
                    <p className="text-xs text-gray-500 mt-2">클릭하여 목록 보기</p>
                  </CardContent>
                </Card>
              </button>

              {/* 시행 예정 카드 */}
              <button
                onClick={() => handleStatCardClick('upcoming')}
                className="text-left hover:shadow-lg transition-shadow"
              >
                <Card className={`cursor-pointer transition-colors ${activeSection === 'upcoming' ? 'border-orange-500 bg-orange-50' : ''}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-600">시행 예정</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-orange-600">{filteredChangeLogs.upcoming.length}</p>
                    <p className="text-xs text-gray-500 mt-2">클릭하여 목록 보기</p>
                  </CardContent>
                </Card>
              </button>
            </div>

            {/* 로딩 상태 */}
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-purple-600 mr-2" />
                <span className="text-gray-600">데이터를 불러오는 중입니다...</span>
              </div>
            )}

            {/* 모니터링 대상 목록 */}
            {activeSection === 'monitored' && !isLoading && (
              <Card className="border-purple-200 bg-purple-50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-purple-700">모니터링 대상 목록</CardTitle>
                      <CardDescription>총 {monitoredItems?.length || 0}개</CardDescription>
                    </div>
                    <button
                      onClick={() => setActiveSection(null)}
                      className="p-1 hover:bg-purple-100 rounded transition-colors"
                    >
                      <X className="w-5 h-5 text-gray-600" />
                    </button>
                  </div>
                </CardHeader>
                <CardContent>
                  {monitoredItems && monitoredItems.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {monitoredItems.map((item: any) => (
                        <div key={item.id} className="p-3 border border-purple-200 rounded-lg bg-white hover:bg-purple-100 transition-colors">
                          <p className="font-medium text-gray-900">{item.name}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <Badge variant="secondary" className="text-xs">
                              {item.type === 'law' ? '법령' : '규칙'}
                            </Badge>
                            {item.externalId && (
                              <span className="text-xs text-gray-500">MST: {item.externalId}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-center py-4">모니터링 대상이 없습니다.</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* 최근 개정 목록 */}
            {activeSection === 'current' && !isLoading && (
              <Card className="border-cyan-200 bg-cyan-50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-cyan-700">최근 개정 (Recent Changes)</CardTitle>
                      <CardDescription>최근 3년 이내 개정된 항목 - 총 {filteredChangeLogs.current.length}개</CardDescription>
                    </div>
                    <button
                      onClick={() => setActiveSection(null)}
                      className="p-1 hover:bg-cyan-100 rounded transition-colors"
                    >
                      <X className="w-5 h-5 text-gray-600" />
                    </button>
                  </div>
                </CardHeader>
                <CardContent>
                  {filteredChangeLogs.current && filteredChangeLogs.current.length > 0 ? (
                    <div className="space-y-3">
                      {filteredChangeLogs.current.map((log: any) => (
                        <Link key={log.id} href={`/detail/${log.id}`}>
                          <div className="p-4 border border-cyan-200 rounded-lg bg-white hover:bg-cyan-100 cursor-pointer transition-colors">
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
                      {searchQuery ? '검색 결과가 없습니다.' : '최근 3년 이내 개정 사항이 없습니다.'}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* 시행 예정 목록 */}
            {activeSection === 'upcoming' && !isLoading && (
              <Card className="border-orange-200 bg-orange-50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-orange-700">시행 예정 (Upcoming)</CardTitle>
                      <CardDescription>향후 시행될 항목 - 총 {filteredChangeLogs.upcoming.length}개</CardDescription>
                    </div>
                    <button
                      onClick={() => setActiveSection(null)}
                      className="p-1 hover:bg-orange-100 rounded transition-colors"
                    >
                      <X className="w-5 h-5 text-gray-600" />
                    </button>
                  </div>
                </CardHeader>
                <CardContent>
                  {filteredChangeLogs.upcoming && filteredChangeLogs.upcoming.length > 0 ? (
                    <div className="space-y-3">
                      {filteredChangeLogs.upcoming.map((log: any) => (
                        <Link key={log.id} href={`/detail/${log.id}`}>
                          <div className="p-4 border border-orange-200 rounded-lg bg-white hover:bg-orange-100 cursor-pointer transition-colors">
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
                  ) : (
                    <p className="text-gray-500 text-center py-8">시행 예정인 항목이 없습니다.</p>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
