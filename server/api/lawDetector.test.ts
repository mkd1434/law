import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractEffectiveDateFromComparison,
  syncMonitoredLawsFromChangeHistory,
} from './lawDetector';
import * as lawClient from './lawClient';
import * as db from '../db';

describe('lawDetector — 시행일자 추출 (oldAndNew)', () => {
  it('신조문_기본정보.시행일자 우선', () => {
    const data = {
      OldAndNewService: {
        신조문_기본정보: { 시행일자: '20230808' },
      },
    };
    expect(extractEffectiveDateFromComparison(data)).toBe('20230808');
  });

  it('구조문_기본정보.시행일자', () => {
    const data = {
      OldAndNewService: {
        신조문_기본정보: {},
        구조문_기본정보: { 시행일자: '20230815' },
      },
    };
    expect(extractEffectiveDateFromComparison(data)).toBe('20230815');
  });

  it('중첩 경로의 시행일자', () => {
    const data = {
      OldAndNewService: {
        신조문_기본정보: {},
        기타: { 시행일자: '20230901' },
      },
    };
    expect(extractEffectiveDateFromComparison(data)).toBe('20230901');
  });

  it('없으면 null', () => {
    const data = { OldAndNewService: { 신조문_기본정보: {} } };
    expect(extractEffectiveDateFromComparison(data)).toBeNull();
  });
});

describe('lawDetector — lsHstInf → oldAndNew 배치', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T12:00:00Z'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('특정 regDt에 매칭되는 행만 oldAndNew 저장', async () => {
    const mockComparison = {
      OldAndNewService: {
        신조문_기본정보: { 시행일자: '20230808' },
        신조문목록: [],
        구조문목록: [],
      },
    };

    const getAll = vi.fn(async (regDt: string) => {
      if (regDt === '20240401') {
        return [
          {
            법령명한글: '전기공사업법',
            법령ID: '282333',
            시행일자: 20230808,
          },
        ];
      }
      return [];
    });

    const getLawComparison = vi.fn().mockResolvedValue(mockComparison);
    const mockUpsert = vi.spyOn(db, 'upsertChangeLog').mockResolvedValue(undefined as any);

    vi.spyOn(lawClient, 'lawAPIClient', 'get').mockReturnValue({
      getAllLawChangeHistoryForDate: getAll,
      getLawComparison,
      getLawChangeHistoryByDate: vi.fn(),
      searchAdminRulesPage: vi.fn(),
      searchAdminRulesAll: vi.fn(),
      getAdminRuleComparison: vi.fn(),
    } as any);

    const result = await syncMonitoredLawsFromChangeHistory(
      [{ itemId: 1, mst: '282333', name: '전기공사업법' }],
      {
        lookbackYears: 3,
        delayBetweenRegDtDaysMs: { min: 0, max: 0 },
      }
    );

    expect(result.collected).toBe(1);
    expect(getLawComparison).toHaveBeenCalledWith({ lawId: '282333' });
    expect(mockUpsert).toHaveBeenCalledOnce();
    const arg = mockUpsert.mock.calls[0][0];
    expect(arg.announcementNo).toMatch(/^LS-282333-20240401-20230808$/);
    expect(arg.content).toContain('신조문목록');
  });
});
