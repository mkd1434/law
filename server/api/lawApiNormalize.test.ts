import { describe, it, expect } from 'vitest';
import { normalizeLsJoHstInfList, readLsJoHstInfTotalCnt } from './lawApiNormalize';

describe('normalizeLsJoHstInfList', () => {
  it('rows only under LawSearch.law (no lsJoHstInf block)', () => {
    const payload = {
      LawSearch: {
        target: 'lsJoHstInf',
        totalCnt: 217,
        page: 1,
        law: [
          { 법령ID: '1', 법령명한글: '테스트법', 조문번호: '1', 조문개정일: '20260403' },
          { 법령ID: '2', 법령명한글: '테스트법2', 조문번호: '2', 조문개정일: '20260404' },
        ],
      },
    };
    const rows = normalizeLsJoHstInfList(payload);
    expect(rows).toHaveLength(2);
    expect(rows[0].법령명한글).toBe('테스트법');
    expect(readLsJoHstInfTotalCnt(payload)).toBe(217);
  });

  it('single law object under LawSearch.law', () => {
    const payload = {
      LawSearch: {
        totalCnt: 1,
        law: { 법령ID: '9', 법령명한글: '단일', 조문번호: '3' },
      },
    };
    expect(normalizeLsJoHstInfList(payload)).toEqual([
      { 법령ID: '9', 법령명한글: '단일', 조문번호: '3' },
    ]);
  });

  it('rows under lsJoHstInf.law', () => {
    const payload = {
      LawSearch: {
        lsJoHstInf: {
          law: [{ 법령ID: '5', 조문링크: '/x' }],
        },
      },
    };
    expect(normalizeLsJoHstInfList(payload)).toEqual([{ 법령ID: '5', 조문링크: '/x' }]);
  });

  it('JSON string payload', () => {
    const inner = {
      LawSearch: {
        totalCnt: 3,
        law: [{ 법령ID: '1', 조문제개정일: '20260101' }],
      },
    };
    const rows = normalizeLsJoHstInfList(JSON.stringify(inner));
    expect(rows).toHaveLength(1);
  });
});
