import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import DetailView from './DetailView';
import * as trpc from '@/lib/trpc';

// Mock trpc
vi.mock('@/lib/trpc', () => ({
  trpc: {
    monitoring: {
      getChangeLogs: {
        useQuery: vi.fn(),
      },
    },
  },
}));

// Mock wouter
vi.mock('wouter', () => ({
  useRoute: vi.fn(() => [true, { id: '1' }]),
  useLocation: vi.fn(() => ['/', vi.fn()]),
}));

describe('DetailView - 공개 접근 테스트', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('로그인 없이 상세 페이지에 접근 가능해야 함', async () => {
    // Mock 데이터
    const mockChangeLog = {
      id: 1,
      itemId: 1,
      announcementNo: 'MST-282333_20230808',
      effectiveDate: new Date('2023-08-08'),
      status: 'current',
      comparisonData: {
        oldText: '구법 내용',
        newText: '신법 내용',
      },
      createdAt: new Date(),
    };

    // trpc.monitoring.getChangeLogs.useQuery 모킹
    (trpc.trpc.monitoring.getChangeLogs.useQuery as any).mockReturnValue({
      data: [mockChangeLog],
      isLoading: false,
    });

    // 렌더링
    const { container } = render(
      <BrowserRouter>
        <DetailView />
      </BrowserRouter>
    );

    // 로그인 메시지가 없어야 함
    expect(screen.queryByText('로그인이 필요합니다')).not.toBeInTheDocument();

    // 공고 번호가 표시되어야 함
    await waitFor(() => {
      expect(screen.getByText('MST-282333_20230808')).toBeInTheDocument();
    });

    // 상세 정보가 표시되어야 함
    expect(screen.getByText('구법 (Old Law)')).toBeInTheDocument();
    expect(screen.getByText('신법 (New Law)')).toBeInTheDocument();
  });

  it('trpc 쿼리가 enabled: true로 설정되어야 함', () => {
    // Mock 데이터
    const mockChangeLog = {
      id: 1,
      itemId: 1,
      announcementNo: 'MST-282333_20230808',
      effectiveDate: new Date('2023-08-08'),
      status: 'current',
      comparisonData: {
        oldText: '구법 내용',
        newText: '신법 내용',
      },
      createdAt: new Date(),
    };

    (trpc.trpc.monitoring.getChangeLogs.useQuery as any).mockReturnValue({
      data: [mockChangeLog],
      isLoading: false,
    });

    render(
      <BrowserRouter>
        <DetailView />
      </BrowserRouter>
    );

    // useQuery가 호출되었는지 확인
    expect(trpc.trpc.monitoring.getChangeLogs.useQuery).toHaveBeenCalled();

    // 호출 시 enabled: true가 전달되었는지 확인
    const callArgs = (trpc.trpc.monitoring.getChangeLogs.useQuery as any).mock.calls[0];
    expect(callArgs[1].enabled).toBe(true);
  });
});
