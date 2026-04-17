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

  describe('한글 시행일자 필드 완전 탐색 (OldAndNewService 구조)', () => {
    it('신조문_기본정보.시행일자에서 추출 (최우선)', async () => {
      const mockResponse = {
        OldAndNewService: {
          신조문_기본정보: {
            시행일자: '20230808',
            법령명: '전기공사업법',
          },
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

    it('구조문_기본정보.시행일자에서 추출 (차선)', async () => {
      const mockResponse = {
        OldAndNewService: {
          구조문_기본정보: {
            시행일자: '20230815',
          },
          신조문_기본정보: {},
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
      
      const callArgs = mockUpsertChangeLog.mock.calls[0][0];
      expect(callArgs.announcementNo).toBe('MST-282333_20230815');
    });

    it('기본정보.시행일자에서 추출 (예비)', async () => {
      const mockResponse = {
        OldAndNewService: {
          기본정보: {
            시행일자: '20230820',
          },
          신조문_기본정보: {},
          구조문_기본정보: {},
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
      
      const callArgs = mockUpsertChangeLog.mock.calls[0][0];
      expect(callArgs.announcementNo).toBe('MST-282333_20230820');
    });

    it('OldAndNewService 내부 임의 중첩 경로의 시행일자도 추출', async () => {
      const mockResponse = {
        OldAndNewService: {
          신조문_기본정보: {},
          기타정보: {
            상세: {
              시행일자: '20230901',
            },
          },
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

      const callArgs = mockUpsertChangeLog.mock.calls[0][0];
      expect(callArgs.announcementNo).toBe('MST-282333_20230901');
    });

    it('efYd 필드에서 추출 (마지막 보루)', async () => {
      const mockResponse = {
        OldAndNewService: {
          신조문_기본정보: {
            efYd: '20230830',
          },
          구조문_기본정보: {},
          기본정보: {},
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
      
      const callArgs = mockUpsertChangeLog.mock.calls[0][0];
      expect(callArgs.announcementNo).toBe('MST-282333_20230830');
    });

    it('날짜를 못 찾으면 API 응답 전체 로깅 후 스킵', async () => {
      const mockResponse = {
        OldAndNewService: {
          법령명: '전기공사업법',
          법령번호: '법률 제18839호',
          신조문_기본정보: {},
          구조문_기본정보: {},
          기본정보: {},
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
      expect(result.collected).toBe(0);  // 저장되지 않음
      expect(mockUpsertChangeLog).not.toHaveBeenCalled();
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('날짜 필터 해제 (모든 데이터 저장)', () => {
    it('과거 날짜도 저장되어야 함', async () => {
      const mockResponse = {
        OldAndNewService: {
          신조문_기본정보: {
            시행일자: '20200101',  // 과거 날짜
          },
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
        OldAndNewService: {
          신조문_기본정보: {
            시행일자: '20300101',  // 미래 날짜
          },
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
