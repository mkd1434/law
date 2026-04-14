import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectAndCollectLawChanges } from './lawDetector';
import * as lawClient from './lawClient';
import * as db from '../db';

// Mock 데이터: 실제 API 응답 구조 (efYd 포함)
const mockLawComparisonResponse = {
  efYd: '20230808',  // 시행일자 (YYYYMMDD)
  법령명: '전기공사업법',
  법령번호: '법률 제18839호',
  제정일자: '20230808',
  기본정보: {
    efYd: '20230808',
    법령명: '전기공사업법',
  },
  신조문목록: [
    {
      조문번호: '제1조',
      제목: '목적',
      내용: '이 법은 전기공사의 시공을 적정하게 하기 위하여...',
    },
  ],
};

// Mock 데이터: efYd가 없는 응답
const mockLawComparisonResponseNoEfYd = {
  법령명: '전기공사업법',
  법령번호: '법률 제18839호',
};

describe('lawDetector - efYd 파싱 로직', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('efYd가 있는 응답에서 올바른 날짜로 파싱되어야 함', async () => {
    // Mock lawAPIClient.getLawComparison
    vi.spyOn(lawClient, 'lawAPIClient', 'get').mockReturnValue({
      getLawComparison: vi.fn().mockResolvedValue(mockLawComparisonResponse),
      getAdminRulesByDateRange: vi.fn(),
      getAdminRuleComparison: vi.fn(),
      getLawChangeHistoryByDate: vi.fn(),
    } as any);

    // Mock upsertChangeLog
    const mockUpsertChangeLog = vi.spyOn(db, 'upsertChangeLog').mockResolvedValue(undefined);

    // 테스트 실행
    const result = await detectAndCollectLawChanges(1, '282333', '전기공사업법');

    // 검증
    expect(result.detected).toBe(1);
    expect(result.collected).toBe(1);
    expect(result.errors).toHaveLength(0);

    // upsertChangeLog 호출 검증
    expect(mockUpsertChangeLog).toHaveBeenCalledOnce();
    const callArgs = mockUpsertChangeLog.mock.calls[0][0];
    
    // efYd가 올바르게 파싱되었는지 확인
    expect(callArgs.announcementNo).toBe('MST-282333_20230808');
    expect(callArgs.effectiveDate).toEqual(new Date(2023, 7, 8)); // 2023-08-08
    expect(callArgs.itemId).toBe(1);
    expect(callArgs.status).toBe('current');
  });

  it('efYd가 없는 응답에서 현재 날짜로 설정되어야 함', async () => {
    // Mock lawAPIClient.getLawComparison
    vi.spyOn(lawClient, 'lawAPIClient', 'get').mockReturnValue({
      getLawComparison: vi.fn().mockResolvedValue(mockLawComparisonResponseNoEfYd),
      getAdminRulesByDateRange: vi.fn(),
      getAdminRuleComparison: vi.fn(),
      getLawChangeHistoryByDate: vi.fn(),
    } as any);

    // Mock upsertChangeLog
    const mockUpsertChangeLog = vi.spyOn(db, 'upsertChangeLog').mockResolvedValue(undefined);

    // 테스트 실행
    const result = await detectAndCollectLawChanges(1, '282333', '전기공사업법');

    // 검증
    expect(result.detected).toBe(1);
    expect(result.collected).toBe(1);

    // upsertChangeLog 호출 검증
    expect(mockUpsertChangeLog).toHaveBeenCalledOnce();
    const callArgs = mockUpsertChangeLog.mock.calls[0][0];
    
    // announcementNo가 MST-{externalId}_{오늘날짜} 형식인지 확인
    expect(callArgs.announcementNo).toMatch(/^MST-282333_\d{8}$/);
    
    // effectiveDate가 현재 날짜 근처인지 확인
    const now = new Date();
    const savedDate = new Date(callArgs.effectiveDate);
    const timeDiff = Math.abs(now.getTime() - savedDate.getTime());
    expect(timeDiff).toBeLessThan(5000); // 5초 이내
  });

  it('announcementNo가 MST-{externalId}_{efYd} 형식이어야 함 (고유성 보장)', async () => {
    // Mock lawAPIClient.getLawComparison
    vi.spyOn(lawClient, 'lawAPIClient', 'get').mockReturnValue({
      getLawComparison: vi.fn().mockResolvedValue(mockLawComparisonResponse),
      getAdminRulesByDateRange: vi.fn(),
      getAdminRuleComparison: vi.fn(),
      getLawChangeHistoryByDate: vi.fn(),
    } as any);

    // Mock upsertChangeLog
    const mockUpsertChangeLog = vi.spyOn(db, 'upsertChangeLog').mockResolvedValue(undefined);

    // 테스트 실행
    const result = await detectAndCollectLawChanges(1, '282333', '전기공사업법');

    // 검증: announcementNo가 MST-{externalId}_{efYd} 형식인지 확인
    expect(mockUpsertChangeLog).toHaveBeenCalledOnce();
    const callArgs = mockUpsertChangeLog.mock.calls[0][0];
    
    // 예: MST-282333_20230808
    expect(callArgs.announcementNo).toBe('MST-282333_20230808');
  });

  it('efYd 값이 8자리 숫자가 아니면 현재 날짜로 설정되어야 함', async () => {
    const invalidEfYdResponse = {
      efYd: 'invalid-date',  // 잘못된 형식
      법령명: '전기공사업법',
    };

    // Mock lawAPIClient.getLawComparison
    vi.spyOn(lawClient, 'lawAPIClient', 'get').mockReturnValue({
      getLawComparison: vi.fn().mockResolvedValue(invalidEfYdResponse),
      getAdminRulesByDateRange: vi.fn(),
      getAdminRuleComparison: vi.fn(),
      getLawChangeHistoryByDate: vi.fn(),
    } as any);

    // Mock upsertChangeLog
    const mockUpsertChangeLog = vi.spyOn(db, 'upsertChangeLog').mockResolvedValue(undefined);

    // 테스트 실행
    const result = await detectAndCollectLawChanges(1, '282333', '전기공사업법');

    // 검증
    expect(result.detected).toBe(1);
    expect(result.collected).toBe(1);

    // upsertChangeLog 호출 검증
    expect(mockUpsertChangeLog).toHaveBeenCalledOnce();
    const callArgs = mockUpsertChangeLog.mock.calls[0][0];
    
    // announcementNo가 MST-{externalId}_{오늘날짜} 형식인지 확인
    expect(callArgs.announcementNo).toMatch(/^MST-282333_\d{8}$/);
    
    // effectiveDate가 현재 날짜 근처인지 확인
    const now = new Date();
    const savedDate = new Date(callArgs.effectiveDate);
    const timeDiff = Math.abs(now.getTime() - savedDate.getTime());
    expect(timeDiff).toBeLessThan(5000); // 5초 이내
  });
});
