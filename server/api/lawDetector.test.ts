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

describe('lawDetector — lsHstInf 기간 조회 → oldAndNew', () => {
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

  it('startDt~endDt 범위에 매칭되는 행만 oldAndNew 저장', async () => {
    const mockComparison = {
      OldAndNewService: {
        신조문_기본정보: { 시행일자: '20230808' },
        신조문목록: [],
        구조문목록: [],
      },
    };

    const getAllRange = vi.fn(async (startDt: string, endDt: string) => {
      if (startDt <= '20240401' && endDt >= '20240401') {
        return [
          {
            법령명한글: '전기공사업법',
            법령ID: '282333',
            공포일자: 20240401,
            시행일자: 20230808,
          },
        ];
      }
      return [];
    });

    const getLawComparison = vi.fn().mockResolvedValue(mockComparison);
    const mockUpsert = vi.spyOn(db, 'upsertChangeLog').mockResolvedValue(undefined as any);

    vi.spyOn(lawClient, 'lawAPIClient', 'get').mockReturnValue({
      getAllLawChangeHistoryForRange: getAllRange,
      getLawComparison,
      getLawChangeHistoryByRange: vi.fn(),
      getLawChangeHistoryByDate: vi.fn(),
      getAllLawChangeHistoryForDate: vi.fn(),
      searchAdminRulesPage: vi.fn(),
      searchAdminRulesAll: vi.fn(),
      getAdminRuleComparison: vi.fn(),
    } as any);

    const result = await syncMonitoredLawsFromChangeHistory(
      [{ itemId: 1, mst: '282333', name: '전기공사업법' }],
      {
        lookbackYears: 3,
        rangeChunkDays: 400,
        delayBetweenRangeChunksMs: { min: 0, max: 0 },
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
