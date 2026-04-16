import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectAndCollectLawChanges } from './lawDetector';
import * as lawClient from './lawClient';
import * as db from '../db';

describe('lawDetector - 강제 수정 (한글 시행일자 필드 완전 탐색)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('한글 시행일자 필드 완전 탐색', () => {
    it('신조문_기본정보.시행일자에서 추출 (최우선)', async () => {
      const mockResponse = {
        신조문_기본정보: {
          시행일자: '20230808',
          법령명: '전기공사업법',
        },
      };

      vi.spyOn(lawClient, 'lawAPIClient', 'get').mockReturnValue({
        getLawComparison: vi.fn().mockResolvedValue(mockResponse),
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
    });

    it('기본정보.시행일자에서 추출 (fallback 1)', async () => {
      const mockResponse = {
        기본정보: {
          시행일자: '20230815',
        },
        신조문_기본정보: {},
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
      
      const callArgs = mockUpsertChangeLog.mock.calls[0][0];
      expect(callArgs.announcementNo).toBe('MST-282333_20230815');
    });

    it('구조문_기본정보.시행일자에서 추출 (fallback 2)', async () => {
      const mockResponse = {
        구조문_기본정보: {
          시행일자: '20230820',
        },
        신조문_기본정보: {},
        기본정보: {},
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
      
      const callArgs = mockUpsertChangeLog.mock.calls[0][0];
      expect(callArgs.announcementNo).toBe('MST-282333_20230820');
    });

    it('신조문목록.조문[0].시행일자에서 추출 (fallback 3)', async () => {
      const mockResponse = {
        신조문목록: {
          조문: [
            { 시행일자: '20230825' },
          ],
        },
        신조문_기본정보: {},
        기본정보: {},
        구조문_기본정보: {},
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
      
      const callArgs = mockUpsertChangeLog.mock.calls[0][0];
      expect(callArgs.announcementNo).toBe('MST-282333_20230825');
    });

    it('efYd 필드에서 추출 (fallback 4)', async () => {
      const mockResponse = {
        efYd: '20230830',
        신조문_기본정보: {},
        기본정보: {},
        구조문_기본정보: {},
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
      
      const callArgs = mockUpsertChangeLog.mock.calls[0][0];
      expect(callArgs.announcementNo).toBe('MST-282333_20230830');
    });

    it('공포일자에서 추출 (fallback 5)', async () => {
      const mockResponse = {
        공포일자: '20230905',
        신조문_기본정보: {},
        기본정보: {},
        구조문_기본정보: {},
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
      
      const callArgs = mockUpsertChangeLog.mock.calls[0][0];
      expect(callArgs.announcementNo).toBe('MST-282333_20230905');
    });

    it('제정일자에서 추출 (fallback 6)', async () => {
      const mockResponse = {
        제정일자: '20230910',
        신조문_기본정보: {},
        기본정보: {},
        구조문_기본정보: {},
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
      
      const callArgs = mockUpsertChangeLog.mock.calls[0][0];
      expect(callArgs.announcementNo).toBe('MST-282333_20230910');
    });

    it('날짜를 못 찾으면 API 응답 전체 로깅 후 스킵', async () => {
      const mockResponse = {
        법령명: '전기공사업법',
        법령번호: '법률 제18839호',
        // 시행일자 필드 없음
      };

      vi.spyOn(lawClient, 'lawAPIClient', 'get').mockReturnValue({
        getLawComparison: vi.fn().mockResolvedValue(mockResponse),
        getAdminRulesByDateRange: vi.fn(),
        getAdminRuleComparison: vi.fn(),
      } as any);

      const mockUpsertChangeLog = vi.spyOn(db, 'upsertChangeLog').mockResolvedValue(undefined);

      const result = await detectAndCollectLawChanges(1, '282333', '전기공사업법');

      expect(result.detected).toBe(1);
      expect(result.collected).toBe(0);  // 저장되지 않음
      expect(mockUpsertChangeLog).not.toHaveBeenCalled();
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('날짜 필터 해제 (모든 데이터 저장)', () => {
    it('과거 날짜도 저장되어야 함', async () => {
      const mockResponse = {
        신조문_기본정보: {
          시행일자: '20200101',  // 과거 날짜
        },
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

    it('미래 날짜도 저장되어야 함', async () => {
      const mockResponse = {
        신조문_기본정보: {
          시행일자: '20300101',  // 미래 날짜
        },
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
});
