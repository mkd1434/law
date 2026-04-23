/**
 * 국가법령정보 API 클라이언트
 *
 * 가이드 기준:
 * - 조문 개정 이력: lawSearch.do?target=lsJoHstInf&fromRegDt=&toRegDt= (기간 조회)
 * - (레거시) 법령 변경이력 lsHstInf — 유지만 하고 동기화는 lsJoHstInf 사용
 * - 신구법 본문(법령): lawService.do?target=oldAndNew (ID 또는 MST)
 * - 행정규칙 목록: lawSearch.do?target=admrul (query, prmlYd 등)
 * - 신구법 본문(행정규칙): lawService.do?target=admrulOldAndNew (ID=일련번호 또는 LID)
 *
 * Rate Limiting: 요청 간 최소 1초
 */

import http from "node:http";
import https from "node:https";
import axios, { AxiosInstance } from "axios";
import {
  normalizeAdmrulList,
  normalizeLsHstInfList,
  normalizeLsJoHstInfList,
  readAdmrulTotalCnt,
  readLsHstInfTotalCnt,
  readLsJoHstInfTotalCnt,
} from './lawApiNormalize';

/** 명세 예시는 http이나, 리다이렉트/게이트웨이에서 첫 연결이 ECONNRESET 나는 경우가 있어 https 기본값 */
const LAW_API_BASE_URL =
  process.env.LAW_API_BASE_URL?.trim() || "https://www.law.go.kr/DRF";
const OC_ID = "mkd1434";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

class RateLimiter {
  private lastRequestTime = 0;

  constructor(private delayMs: number = 1000) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.delayMs) {
      const waitTime = this.delayMs - timeSinceLastRequest;
      console.log(`[RateLimiter] ⏳ Waiting ${waitTime}ms before next request...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  reset(): void {
    this.lastRequestTime = 0;
  }
}

const withRetry = async (fn: () => Promise<any>, maxRetries = 4): Promise<any> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const isLastAttempt = i === maxRetries - 1;
      const errorMsg = error?.message || String(error);
      const causeCode = error?.cause?.code ?? error?.code;
      const isNetworkError =
        errorMsg.includes("ECONNRESET") ||
        errorMsg.includes("ECONNREFUSED") ||
        errorMsg.includes("ETIMEDOUT") ||
        errorMsg.includes("ENOTFOUND") ||
        errorMsg.includes("EPIPE") ||
        causeCode === "ECONNRESET";

      if (isNetworkError && !isLastAttempt) {
        const delayMs = Math.pow(2, i) * 1000 + Math.floor(Math.random() * 400);
        console.warn(
          `[Retry] ⚠️  Network error (${errorMsg}), waiting ${delayMs}ms before retry... (attempt ${i + 1}/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else if (isLastAttempt) {
        console.error(`[Retry] ❌ Failed after ${maxRetries} attempts: ${errorMsg}`);
        return null;
      } else {
        throw error;
      }
    }
  }
};

export type LawComparisonParams = { mst?: string; lawId?: string };

export type AdminRuleComparisonParams = { id?: string; lid?: string };

export class LawAPIClient {
  private client: AxiosInstance;
  private rateLimiter: RateLimiter;

  constructor() {
    const httpsAgent = new https.Agent({ keepAlive: false, maxSockets: 8 });
    const httpAgent = new http.Agent({ keepAlive: false, maxSockets: 8 });
    this.client = axios.create({
      baseURL: LAW_API_BASE_URL,
      timeout: 60000,
      httpAgent,
      httpsAgent,
      headers: {
        "User-Agent": process.env.LAW_API_USER_AGENT?.trim() || DEFAULT_UA,
        Accept: "application/json, application/xml;q=0.9, */*;q=0.8",
      },
      maxRedirects: 5,
    });
    this.rateLimiter = new RateLimiter(1000);
    if (process.env.NODE_ENV === "development") {
      console.log(`[LawClient] baseURL=${LAW_API_BASE_URL}`);
    }
  }

  /**
   * 법령 변경이력 목록 (특정 변경일 regDt, 페이지네이션)
   * @see lawSearch.do?target=lsHstInf&regDt=YYYYMMDD&type=JSON
   */
  async getLawChangeHistoryByDate(regDt: string, page: number = 1): Promise<any> {
    return withRetry(async () => {
      await this.rateLimiter.wait();

      const params = {
        target: 'lsHstInf',
        OC: OC_ID,
        type: 'JSON',
        regDt,
        display: 100,
        page,
      };

      console.log(`[LawClient] lsHstInf regDt=${regDt} page=${page}`);
      const response = await this.client.get('/lawSearch.do', { params });

      if (!response.data) {
        console.warn(`[LawClient] ⚠️  Empty lsHstInf response for ${regDt}`);
        return { data: [], totalCnt: 0 };
      }

      if (response.data.error) {
        console.error(`[LawClient] ❌ lsHstInf API Error ${regDt}:`, response.data.error);
        return { data: [], error: response.data.error, totalCnt: 0 };
      }

      const rows = normalizeLsHstInfList(response.data);
      const totalCnt = readLsHstInfTotalCnt(response.data);
      console.log(`[LawClient] ✅ lsHstInf ${regDt} page ${page}: ${rows.length} rows (totalCnt≈${totalCnt})`);
      return { ...response.data, data: rows, totalCnt };
    });
  }

  /** regDt 하루치 변경이력 (totalCnt·page 순회) */
  async getAllLawChangeHistoryForDate(regDt: string): Promise<any[]> {
    const all: any[] = [];
    let page = 1;
    let totalCnt = 0;

    while (true) {
      const res = await this.getLawChangeHistoryByDate(regDt, page);
      if (!res || res.error) break;
      const chunk = Array.isArray(res.data) ? res.data : normalizeLsHstInfList(res);
      if (chunk.length === 0) break;
      all.push(...chunk);
      totalCnt = res.totalCnt ?? readLsHstInfTotalCnt(res) ?? totalCnt;
      if (totalCnt > 0 && all.length >= totalCnt) break;
      if (chunk.length < 100) break;
      page += 1;
    }

    return all;
  }

  /**
   * 조문 개정 이력 (기간). fromRegDt/toRegDt: YYYYMMDD
   * @see lawSearch.do?target=lsJoHstInf&fromRegDt=&toRegDt=&type=JSON
   */
  async getLawJoChangeHistoryRange(
    fromRegDt: string,
    toRegDt: string,
    page: number = 1
  ): Promise<any> {
    return withRetry(async () => {
      await this.rateLimiter.wait();

      const params: Record<string, string | number> = {
        target: "lsJoHstInf",
        OC: OC_ID,
        type: "JSON",
        fromRegDt,
        toRegDt,
        display: 100,
        page,
      };

      console.log(
        `[LawClient] lsJoHstInf from=${fromRegDt} to=${toRegDt} page=${page}`
      );
      const response = await this.client.get("/lawSearch.do", { params });

      if (!response.data) {
        console.warn(
          `[LawClient] ⚠️  Empty lsJoHstInf ${fromRegDt}~${toRegDt} p${page}`
        );
        return { data: [], totalCnt: 0 };
      }

      if (response.data.error) {
        console.error(
          `[LawClient] ❌ lsJoHstInf API Error ${fromRegDt}~${toRegDt}:`,
          response.data.error
        );
        return { data: [], error: response.data.error, totalCnt: 0 };
      }

      const rows = normalizeLsJoHstInfList(response.data);
      const totalCnt = readLsJoHstInfTotalCnt(response.data);
      console.log(
        `[LawClient] ✅ lsJoHstInf ${fromRegDt}~${toRegDt} p${page}: ${rows.length} rows (totalCnt≈${totalCnt})`
      );
      return { ...response.data, data: rows, totalCnt };
    });
  }

  /** fromRegDt~toRegDt 구간 전체 페이지 순회 */
  async getAllLawJoHistoryForRange(
    fromRegDt: string,
    toRegDt: string
  ): Promise<any[]> {
    const all: any[] = [];
    let page = 1;
    let totalCnt = 0;

    while (true) {
      const res = await this.getLawJoChangeHistoryRange(
        fromRegDt,
        toRegDt,
        page
      );
      if (!res || res.error) break;
      const chunk = Array.isArray(res.data)
        ? res.data
        : normalizeLsJoHstInfList(res);
      if (chunk.length === 0) break;
      all.push(...chunk);
      totalCnt = res.totalCnt ?? readLsJoHstInfTotalCnt(res) ?? totalCnt;
      if (totalCnt > 0 && all.length >= totalCnt) break;
      if (chunk.length < 100) break;
      page += 1;
    }

    return all;
  }

  /**
   * 신구법 본문 조회 (법령)
   * ID(법령ID) 또는 MST 중 하나 필수
   */
  async getLawComparison(params: LawComparisonParams): Promise<any> {
    return withRetry(async () => {
      await this.rateLimiter.wait();

      const q: Record<string, string> = {
        target: 'oldAndNew',
        OC: OC_ID,
        type: 'JSON',
      };
      if (params.lawId) {
        q.ID = params.lawId;
      } else if (params.mst) {
        q.MST = params.mst;
      } else {
        console.warn('[LawClient] getLawComparison: lawId와 mst가 모두 없음');
        return null;
      }

      console.log(`[LawClient] oldAndNew ${params.lawId ? `ID=${params.lawId}` : `MST=${params.mst}`}`);
      const response = await this.client.get('/lawService.do', { params: q });

      if (!response.data) {
        console.warn(`[LawClient] ⚠️  Empty oldAndNew response`);
        return null;
      }

      if (response.data.error) {
        console.error(`[LawClient] ❌ oldAndNew API Error:`, response.data.error);
        return null;
      }

      this.attachExtractedEffectiveDate(response.data);
      return response.data;
    });
  }

  private attachExtractedEffectiveDate(data: any): void {
    const extracted = this.extractEffectiveDateFromPayload(data);
    if (extracted) {
      console.log(`[LawClient] 📅 Extracted effective date: ${extracted}`);
      data._extractedEffectiveDate = extracted;
    } else {
      console.warn(`[LawClient] ⚠️  No valid effective date in oldAndNew response`);
    }
  }

  private extractEffectiveDateFromPayload(data: any): string | null {
    const normalizeDate = (value: unknown): string | null => {
      if (value === null || value === undefined) return null;
      const digitsOnly = String(value).replace(/\D/g, '');
      return /^\d{8}$/.test(digitsOnly) ? digitsOnly : null;
    };

    const root = data?.OldAndNewService ?? data?.OldAndNew ?? data;
    const prioritizedDate = normalizeDate(root?.신조문_기본정보?.시행일자);
    if (prioritizedDate) return prioritizedDate;

    const fallbackCandidates = [
      root?.구조문_기본정보?.시행일자,
      root?.기본정보?.시행일자,
      root?.신조문_기본정보?.efYd,
      data?.신조문_기본정보?.시행일자,
      data?.efYd,
    ];
    for (const candidate of fallbackCandidates) {
      const normalized = normalizeDate(candidate);
      if (normalized) return normalized;
    }

    const visited = new Set<any>();
    const collectEffectiveDates = (node: any): string[] => {
      if (!node || typeof node !== 'object') return [];
      if (visited.has(node)) return [];
      visited.add(node);
      const found: string[] = [];
      if (Array.isArray(node)) {
        for (const item of node) {
          found.push(...collectEffectiveDates(item));
        }
        return found;
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === '시행일자') {
          const normalized = normalizeDate(value);
          if (normalized) found.push(normalized);
        }
        if (value && typeof value === 'object') {
          found.push(...collectEffectiveDates(value));
        }
      }
      return found;
    };

    const discovered = collectEffectiveDates(data);
    return discovered.length > 0 ? discovered[0] : null;
  }

  /**
   * 행정규칙 목록 조회
   * 가이드: query(행정규칙명), prmlYd(발령일 기간), date(단일 발령일) 등
   */
  async searchAdminRulesPage(input: {
    query: string;
    prmlYd?: string;
    date?: string;
    page?: number;
    display?: number;
    /** 1=현행, 2=연혁 (가이드 nw) */
    nw?: number;
  }): Promise<any> {
    return withRetry(async () => {
      await this.rateLimiter.wait();

      const params: Record<string, string | number> = {
        target: 'admrul',
        OC: OC_ID,
        type: 'JSON',
        query: input.query,
        display: input.display ?? 100,
        page: input.page ?? 1,
      };
      if (input.prmlYd) params.prmlYd = input.prmlYd;
      if (input.date) params.date = input.date;
      if (input.nw !== undefined) params.nw = input.nw;

      console.log(
        `[LawClient] admrul query="${input.query}" page=${params.page}${input.prmlYd ? ` prmlYd=${input.prmlYd}` : ''}${input.nw != null ? ` nw=${input.nw}` : ''}`
      );
      const response = await this.client.get('/lawSearch.do', { params });

      if (!response.data) {
        return { data: [], totalCnt: 0 };
      }
      if (response.data.error) {
        console.error(`[LawClient] ❌ admrul error:`, response.data.error);
        return { data: [], error: response.data.error, totalCnt: 0 };
      }

      const rows = normalizeAdmrulList(response.data);
      const totalCnt = readAdmrulTotalCnt(response.data);
      return { ...response.data, data: rows, totalCnt };
    });
  }

  /** prmlYd(발령 기간)~query·nw 로 행정규칙 목록 전체 페이지 */
  async searchAdminRulesAll(input: { query: string; prmlYd: string; nw?: number }): Promise<any[]> {
    const all: any[] = [];
    let page = 1;

    while (true) {
      const res = await this.searchAdminRulesPage({
        query: input.query,
        prmlYd: input.prmlYd,
        nw: input.nw,
        page,
        display: 100,
      });
      if (!res || res.error) break;
      const chunk = Array.isArray(res.data) ? res.data : [];
      if (chunk.length === 0) break;
      all.push(...chunk);
      const totalCnt = res.totalCnt ?? readAdmrulTotalCnt(res) ?? 0;
      if (totalCnt > 0 && all.length >= totalCnt) break;
      if (chunk.length < 100) break;
      page += 1;
    }

    return all;
  }

  /**
   * 행정규칙 신구법 본문
   * ID = 행정규칙 일련번호, LID = 행정규칙 ID (하나 필수)
   */
  async getAdminRuleComparison(params: AdminRuleComparisonParams): Promise<any> {
    return withRetry(async () => {
      await this.rateLimiter.wait();

      const q: Record<string, string> = {
        target: 'admrulOldAndNew',
        OC: OC_ID,
        type: 'JSON',
      };
      if (params.id) {
        q.ID = params.id;
      } else if (params.lid) {
        q.LID = params.lid;
      } else {
        console.warn('[LawClient] admrulOldAndNew: id와 lid가 모두 없음');
        return null;
      }

      console.log(`[LawClient] admrulOldAndNew ${params.id ? `ID=${params.id}` : `LID=${params.lid}`}`);
      const response = await this.client.get('/lawService.do', { params: q });

      if (!response.data) {
        return null;
      }
      if (response.data.error) {
        console.error(`[LawClient] ❌ admrulOldAndNew error:`, response.data.error);
        return null;
      }

      return response.data;
    });
  }

  /**
   * @deprecated 목록은 searchAdminRulesAll({ query, prmlYd }) 사용.
   * 빈 query는 API에서 거절될 수 있음.
   */
  async getAdminRulesByDateRange(startDate: string, endDate: string): Promise<any> {
    console.warn('[LawClient] getAdminRulesByDateRange는 비권장입니다. searchAdminRulesAll을 사용하세요.');
    return { data: [], totalCnt: 0 };
  }
}

export const lawAPIClient = new LawAPIClient();
