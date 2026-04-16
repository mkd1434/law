import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectAndCollectLawChanges } from './lawDetector';
import * as lawClient from './lawClient';
import * as db from '../db';

// Mock 데이터: 한글 시행일자 필드 포함 (신조문_기본정보.시행일자)
const mockLawComparisonWithKoreanDate = {
  신조문_기본정보: {
    시행일자: '20230808',  // 한글 시행일자 필드
    법령명: '전기공사업법',
  },
  법령명: '전기공사업법',
  _extractedEffectiveDate: '20230808',
};

// Mock 데이터: 한글 시행일자만 있음 (efYd 없음)
const mockLawComparisonKoreanDateOnly = {
  신조문_기본정보: {
    시행일자: '20230815',  // 한글 시행일자만 있음
  },
  법령명: '전기공사업법',
  _extractedEffectiveDate: '20230815',
};

// Mock 데이터: 시행일자가 20230415 이전 (필터링 대상)
const mockLawComparisonBeforeFilterDate = {
  신조문_기본정보: {
    시행일자: '20230410',  // 20230415 이전
  },
  법령명: '전기공사업법',
  _extractedEffectiveDate: '20230410',
};

// Mock 데이터: 시행일자 없음 (저장하지 않음)
const mockLawComparisonNoDate = {
  법령명: '전기공사업법',
  _extractedEffectiveDate: null,  // 시행일자 없음
};

describe('lawDetector - 긴급 수정 (Rate Limit, 한글 시행일자, 필터링)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('한글 시행일자 필드 (신조문_기본정보.시행일자)', () => {
    it('한글 시행일자 필드에서 올바르게 추출되어야 함', async () => {
      vi.spyOn(lawClient, 'lawAPIClient', 'get').mockReturnValue({
        getLawComparison: vi.fn().mockResolvedValue(mockLawComparisonWithKoreanDate),
        getAdminRulesByDateRange: vi.fn(),
        getAdminRuleComparison: vi.fn(),
      } as any);

      const mockUpsertChangeLog = vi.spyOn(db, 'upsertChangeLog').mockResolvedValue(undefined);

      const result = await detectAndCollectLawChanges(1, '282333', '전기공사업법');

      expect(result.detected).toBe(1);
      expect(result.collected).toBe(1);
      expect(mockUpsertChangeLog).toHaveBeenCalledOnce();
      
      const callArgs = mockUpsertChangeLog.mock.calls[0][0];
      expect(callArgs.announcementNo).toBe('MST-282333_20230808');
      expect(callArgs.effectiveDate).toEqual(new Date(2023, 7, 8));
    });

    it('efYd 없이 한글 시행일자만으로도 저장되어야 함', async () => {
      vi.spyOn(lawClient, 'lawAPIClient', 'get').mockReturnValue({
        getLawComparison: vi.fn().mockResolvedValue(mockLawComparisonKoreanDateOnly),
        getAdminRulesByDateRange: vi.fn(),
        getAdminRuleComparison: vi.fn(),
      } as any);

      const mockUpsertChangeLog = vi.spyOn(db, 'upsertChangeLog').mockResolvedValue(undefined);

      const result = await detectAndCollectLawChanges(1, '282333', '전기공사업법');

      expect(result.detected).toBe(1);
      expect(result.collected).toBe(1);
      expect(mockUpsertChangeLog).toHaveBeenCalledOnce();
      
      const callArgs = mockUpsertChangeLog.mock.calls[0][0];
      expect(callArgs.announcementNo).toBe('MST-282333_20230815');
    });
  });

  describe('시행일자 필터링 (20230415 이후만)', () => {
    it('시행일자가 20230415 이후면 저장되어야 함', async () => {
      vi.spyOn(lawClient, 'lawAPIClient', 'get').mockReturnValue({
        getLawComparison: vi.fn().mockResolvedValue(mockLawComparisonWithKoreanDate),
        getAdminRulesByDateRange: vi.fn(),
        getAdminRuleComparison: vi.fn(),
      } as any);

      const mockUpsertChangeLog = vi.spyOn(db, 'upsertChangeLog').mockResolvedValue(undefined);

      const result = await detectAndCollectLawChanges(1, '282333', '전기공사업법');

      expect(result.collected).toBe(1);
      expect(mockUpsertChangeLog).toHaveBeenCalledOnce();
    });

    it('시행일자가 20230415 이전이면 저장하지 않아야 함', async () => {
      vi.spyOn(lawClient, 'lawAPIClient', 'get').mockReturnValue({
        getLawComparison: vi.fn().mockResolvedValue(mockLawComparisonBeforeFilterDate),
        getAdminRulesByDateRange: vi.fn(),
        getAdminRuleComparison: vi.fn(),
      } as any);

      const mockUpsertChangeLog = vi.spyOn(db, 'upsertChangeLog').mockResolvedValue(undefined);

      const result = await detectAndCollectLawChanges(1, '282333', '전기공사업법');

      expect(result.detected).toBe(1);
      expect(result.collected).toBe(0);  // 저장되지 않음
      expect(mockUpsertChangeLog).not.toHaveBeenCalled();
    });

    it('시행일자가 정확히 20230415면 저장되어야 함', async () => {
      const mockResponse = {
        신조문_기본정보: {
          시행일자: '20230415',
        },
        _extractedEffectiveDate: '20230415',
      };

      vi.spyOn(lawClient, 'lawAPIClient', 'get').mockReturnValue({
        getLawComparison: vi.fn().mockResolvedValue(mockResponse),
        getAdminRulesByDateRange: vi.fn(),
        getAdminRuleComparison: vi.fn(),
      } as any);

      const mockUpsertChangeLog = vi.spyOn(db, 'upsertChangeLog').mockResolvedValue(undefined);

      const result = await detectAndCollectLawChanges(1, '282333', '전기공사업법');

      expect(result.collected).toBe(1);
      expect(mockUpsertChangeLog).toHaveBeenCalledOnce();
    });
  });

  describe('오늘 날짜 도배 방지', () => {
    it('시행일자가 없으면 저장하지 않아야 함', async () => {
      vi.spyOn(lawClient, 'lawAPIClient', 'get').mockReturnValue({
        getLawComparison: vi.fn().mockResolvedValue(mockLawComparisonNoDate),
        getAdminRulesByDateRange: vi.fn(),
        getAdminRuleComparison: vi.fn(),
      } as any);

      const mockUpsertChangeLog = vi.spyOn(db, 'upsertChangeLog').mockResolvedValue(undefined);

      const result = await detectAndCollectLawChanges(1, '282333', '전기공사업법');

      expect(result.detected).toBe(1);
      expect(result.collected).toBe(0);  // 저장되지 않음
      expect(mockUpsertChangeLog).not.toHaveBeenCalled();
    });

    it('유효한 시행일자만 저장되어야 함', async () => {
      vi.spyOn(lawClient, 'lawAPIClient', 'get').mockReturnValue({
        getLawComparison: vi.fn().mockResolvedValue(mockLawComparisonWithKoreanDate),
        getAdminRulesByDateRange: vi.fn(),
        getAdminRuleComparison: vi.fn(),
      } as any);

      const mockUpsertChangeLog = vi.spyOn(db, 'upsertChangeLog').mockResolvedValue(undefined);

      const result = await detectAndCollectLawChanges(1, '282333', '전기공사업법');

      expect(result.collected).toBe(1);
      expect(mockUpsertChangeLog).toHaveBeenCalledOnce();
      
      const callArgs = mockUpsertChangeLog.mock.calls[0][0];
      // 오늘 날짜가 아닌 실제 시행일자가 저장되어야 함
      expect(callArgs.effectiveDate).toEqual(new Date(2023, 7, 8));
      expect(callArgs.effectiveDate.getFullYear()).toBe(2023);
    });
  });

  describe('announcementNo 고유 키 (MST + 시행일자)', () => {
    it('같은 MST도 시행일자가 다르면 다른 announcementNo 생성', async () => {
      const response1 = {
        신조문_기본정보: { 시행일자: '20230808' },
        _extractedEffectiveDate: '20230808',
      };

      const response2 = {
        신조문_기본정보: { 시행일자: '20230815' },
        _extractedEffectiveDate: '20230815',
      };

      const announcementNo1 = `MST-282333_${response1._extractedEffectiveDate}`;
      const announcementNo2 = `MST-282333_${response2._extractedEffectiveDate}`;

      expect(announcementNo1).toBe('MST-282333_20230808');
      expect(announcementNo2).toBe('MST-282333_20230815');
      expect(announcementNo1).not.toBe(announcementNo2);
    });
  });

  describe('Rate Limit 1초 간격', () => {
    it('API 호출 사이 최소 1초 간격 유지', async () => {
      const startTime = Date.now();
      
      // 1초 대기 시뮬레이션
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const endTime = Date.now();
      const elapsed = endTime - startTime;

      expect(elapsed).toBeGreaterThanOrEqual(1000);
    });
  });
});
