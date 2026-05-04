import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractEffectiveDateFromComparison,
  flattenLsJoRowForMatching,
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

/** lsJoHstInf는 페이지 단위로 조회하므로 getLawJoChangeHistoryRange를 목업한다 */
function mockLsJoChangeHistoryRange(rows: any[]) {
  return vi.fn(async (_from: string, _to: string, page: number) => {
    if (page === 1) {
      return { data: rows, totalCnt: rows.length };
    }
    return { data: [], totalCnt: rows.length };
  });
}

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

    const lsJoRows = [
      {
        법령명한글: '전기공사업법',
        법령ID: '285',
        조문번호: '3',
        조문개정일: '20240401',
        변경사유: '일부개정',
        조문정보: '제3조',
      },
    ];

    const getLawComparison = vi.fn().mockResolvedValue(mockComparison);
    const mockUpsert = vi.spyOn(db, 'upsertChangeLog').mockResolvedValue(undefined as any);

    vi.spyOn(lawClient, 'lawAPIClient', 'get').mockReturnValue({
      getLawJoChangeHistoryRange: mockLsJoChangeHistoryRange(lsJoRows),
      getAllLawJoHistoryForRange: vi.fn(),
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
    expect(arg.announcementNo).toMatch(/^JO-285-3-20240401-unk$/);
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

    const lsJoRows = [
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

    const mockUpsert = vi.spyOn(db, 'upsertChangeLog').mockResolvedValue(undefined as any);

    vi.spyOn(lawClient, 'lawAPIClient', 'get').mockReturnValue({
      getLawJoChangeHistoryRange: mockLsJoChangeHistoryRange(lsJoRows),
      getAllLawJoHistoryForRange: vi.fn(),
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

  it('법령ID·조문번호가 법령정보·조문정보 중첩에만 있어도 매칭·저장', async () => {
    const mockComparison = {
      OldAndNewService: {
        신조문_기본정보: { 시행일자: '20230808' },
        신조문목록: [],
        구조문목록: [],
      },
    };

    const lsJoRows = [
      {
        id: 999,
        법령정보: { 법령ID: '285', 법령명한글: '전기공사업법' },
        조문정보: {
          조문번호: '3',
          조문개정일: '20240401',
          조문시행일: '20230808',
          변경사유: '일부개정',
        },
      },
    ];

    const getLawComparison = vi.fn().mockResolvedValue(mockComparison);
    const mockUpsert = vi.spyOn(db, 'upsertChangeLog').mockResolvedValue(undefined as any);

    vi.spyOn(lawClient, 'lawAPIClient', 'get').mockReturnValue({
      getLawJoChangeHistoryRange: mockLsJoChangeHistoryRange(lsJoRows),
      getAllLawJoHistoryForRange: vi.fn(),
      getLawComparison,
      getLawChangeHistoryByDate: vi.fn(),
      getAllLawChangeHistoryForDate: vi.fn(),
      searchAdminRulesPage: vi.fn(),
      searchAdminRulesAll: vi.fn(),
      getAdminRuleComparison: vi.fn(),
    } as any);

    const flat = flattenLsJoRowForMatching(lsJoRows[0]);
    expect(flat.법령ID).toBe('285');
    expect(flat.조문번호).toBe('3');

    const result = await syncMonitoredLawsFromChangeHistory(
      [{ itemId: 1, mst: '285', name: '전기공사업법' }],
      { lookbackYears: 3, delayAfterEachRegDtDayMs: { min: 0, max: 0 } }
    );

    expect(result.collected).toBe(1);
    expect(getLawComparison).not.toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalledOnce();
    const arg = mockUpsert.mock.calls[0][0];
    expect(arg.announcementNo).toMatch(/^JO-285-3-20240401-/);
    expect(arg.comparisonData).toMatchObject({
      joRevisionMeta: expect.objectContaining({
        조문번호: '3',
        법령ID: '285',
        변경사유: '일부개정',
      }),
    });
  });

  it('법령ID가 법령정보 이중 중첩에만 있어도 매칭·저장 (MST 앞자리 0)', async () => {
    const mockComparison = {
      OldAndNewService: {
        신조문_기본정보: { 시행일자: '20230808' },
        신조문목록: [],
        구조문목록: [],
      },
    };

    const lsJoRows = [
      {
        id: 42,
        법령정보: { 법령기본정보: { 법령ID: '0285', 법령명한글: '전기공사업법' } },
        조문정보: { 조문번호: '3', 조문개정일: '20240401', 조문시행일: '20230808' },
      },
    ];

    const mockUpsert = vi.spyOn(db, 'upsertChangeLog').mockResolvedValue(undefined as any);

    vi.spyOn(lawClient, 'lawAPIClient', 'get').mockReturnValue({
      getLawJoChangeHistoryRange: mockLsJoChangeHistoryRange(lsJoRows),
      getAllLawJoHistoryForRange: vi.fn(),
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
