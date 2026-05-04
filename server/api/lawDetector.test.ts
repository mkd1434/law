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

describe('lawDetector — lsJoHstInf 연 구간 → oldAndNew·조문 메타', () => {
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

  it('해당 연도 구간에 매칭되는 조문 이력만 oldAndNew·joRevisionMeta 저장', async () => {
    const mockComparison = {
      OldAndNewService: {
        신조문_기본정보: { 시행일자: '20230808' },
        신조문목록: [],
        구조문목록: [],
      },
    };

    const getAllJo = vi.fn(async (fromStr: string, toStr: string) => {
      if (fromStr === '20240101' && toStr === '20241231') {
        return [
          {
            법령명한글: '전기공사업법',
            법령ID: '285',
            공포일자: 20240401,
            시행일자: 20230808,
            조문번호: '3',
            조문개정일: '20240401',
            조문시행일: '20230808',
            변경사유: '일부개정',
            조문정보: '제3조',
          },
        ];
      }
      return [];
    });

    const getLawComparison = vi.fn().mockResolvedValue(mockComparison);
    const mockUpsert = vi.spyOn(db, 'upsertChangeLog').mockResolvedValue(undefined as any);

    vi.spyOn(lawClient, 'lawAPIClient', 'get').mockReturnValue({
      getAllLawJoHistoryForRange: getAllJo,
      getLawComparison,
      getLawChangeHistoryByDate: vi.fn(),
      getAllLawChangeHistoryForDate: vi.fn(),
      searchAdminRulesPage: vi.fn(),
      searchAdminRulesAll: vi.fn(),
      getAdminRuleComparison: vi.fn(),
    } as any);

    const result = await syncMonitoredLawsFromChangeHistory(
      [{ itemId: 1, mst: '285', name: '전기공사업법' }],
      {
        lookbackYears: 3,
        delayAfterEachRegDtDayMs: { min: 0, max: 0 },
      }
    );

    expect(result.collected).toBe(1);
    expect(getLawComparison).toHaveBeenCalledWith({ lawId: '285' });
    expect(mockUpsert).toHaveBeenCalledOnce();
    const arg = mockUpsert.mock.calls[0][0];
    expect(arg.announcementNo).toMatch(/^JO-285-3-20240401-20240401$/);
    expect(arg.content).toContain('신조문목록');
    expect(arg.comparisonData).toMatchObject({
      joRevisionMeta: expect.objectContaining({ 조문번호: '3', 변경사유: '일부개정' }),
    });
  });

  it('법령명이 목록과 달라도 법령ID(MST)가 같으면 저장', async () => {
    const mockComparison = {
      OldAndNewService: {
        신조문_기본정보: { 시행일자: '20230808' },
        신조문목록: [],
        구조문목록: [],
      },
    };

    const getAllJo = vi.fn(async (fromStr: string, toStr: string) => {
      if (fromStr === '20240101' && toStr === '20241231') {
        return [
          {
            법령명한글: 'API에만 있는 다른 표기',
            법령MST: '271253',
            법령ID: '285',
            공포일자: 20240401,
            시행일자: 20230808,
            조문번호: '3',
            조문개정일: '20240401',
            조문시행일: '20230808',
          },
        ];
      }
      return [];
    });

    const mockUpsert = vi.spyOn(db, 'upsertChangeLog').mockResolvedValue(undefined as any);

    vi.spyOn(lawClient, 'lawAPIClient', 'get').mockReturnValue({
      getAllLawJoHistoryForRange: getAllJo,
      getLawComparison: vi.fn().mockResolvedValue(mockComparison),
      getLawChangeHistoryByDate: vi.fn(),
      getAllLawChangeHistoryForDate: vi.fn(),
      searchAdminRulesPage: vi.fn(),
      searchAdminRulesAll: vi.fn(),
      getAdminRuleComparison: vi.fn(),
    } as any);

    const result = await syncMonitoredLawsFromChangeHistory(
      [{ itemId: 1, mst: '285', name: '전기공사업법' }],
      { lookbackYears: 3, delayAfterEachRegDtDayMs: { min: 0, max: 0 } }
    );

    expect(result.collected).toBe(1);
    expect(mockUpsert).toHaveBeenCalledOnce();
  });
});
