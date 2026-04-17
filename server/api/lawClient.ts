/**
 * 국가법령정보 API 클라이언트
 * 법령(lawService.do)과 행정규칙(admRulService.do)을 엄격하게 분리
 * 
 * 1. 법령 개정 이력: target=lsHstInf (날짜별 루프)
 * 2. 신구법 비교: target=oldAndNew (상세 조회)
 * 3. 행정규칙: target=admrul (prmlYd 파라미터)
 * 
 * Rate Limiting: 1개씩, 1초 간격 (0.5초 * 2개 = 1초)
 * 재시도: 지수 백오프 (1초, 2초)
 */

import axios, { AxiosInstance } from 'axios';

const LAW_API_BASE_URL = 'http://www.law.go.kr/DRF';
const OC_ID = 'mkd1434';

/**
 * Rate Limiter: 1개씩 순차 처리, 최소 1초 간격 유지
 */
class RateLimiter {
  private lastRequestTime = 0;

  constructor(private delayMs: number = 1000) {} // 1초

  async wait(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.delayMs) {
      const waitTime = this.delayMs - timeSinceLastRequest;
      console.log(`[RateLimiter] ⏳ Waiting ${waitTime}ms before next request...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  reset(): void {
    this.lastRequestTime = 0;
  }
}

/**
 * 재시도 로직 (지수 백오프 + ECONNRESET 처리)
 */
const withRetry = async (fn: () => Promise<any>, maxRetries = 2): Promise<any> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const isLastAttempt = i === maxRetries - 1;
      const errorMsg = error?.message || String(error);
      const isNetworkError = errorMsg.includes('ECONNRESET') || errorMsg.includes('ETIMEDOUT') || errorMsg.includes('ENOTFOUND');

      if (isNetworkError && !isLastAttempt) {
        // 지수 백오프: 1초, 2초
        const delayMs = Math.pow(2, i) * 1000;
        console.warn(`[Retry] ⚠️  Network error (${errorMsg}), waiting ${delayMs}ms before retry... (attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else if (isLastAttempt) {
        console.error(`[Retry] ❌ Failed after ${maxRetries} attempts: ${errorMsg}`);
        return null; // 재시도 실패 시 null 반환 (무시)
      } else {
        throw error;
      }
    }
  }
};

export class LawAPIClient {
  private client: AxiosInstance;
  private rateLimiter: RateLimiter;

  constructor() {
    this.client = axios.create({
      baseURL: LAW_API_BASE_URL,
      timeout: 10000,
    });
    this.rateLimiter = new RateLimiter(1000); // 1초 간격
  }

  /**
   * 1. 법령 개정 이력 조회 (날짜별)
   * target=lsHstInf를 사용하여 특정 날짜의 모든 법령 변경이력 조회
   * 
   * API: http://www.law.go.kr/DRF/lawSearch.do?target=lsHstInf&OC=[인증키]&regDt=[날짜]&type=JSON
   * 
   * @param regDt - 변경일자 (YYYYMMDD 형식)
   */
  async getLawChangeHistoryByDate(regDt: string): Promise<any> {
    return withRetry(async () => {
      await this.rateLimiter.wait();

      const params = {
        target: 'lsHstInf',  // 법령 개정 이력 조회
        OC: OC_ID,
        type: 'JSON',
        regDt: regDt,
        display: 100,
        page: 1,
      };

      console.log(`[LawClient] 🔍 Fetching law change history for date: ${regDt}`);
      const response = await this.client.get('/lawSearch.do', { params });

      if (!response.data) {
        console.warn(`[LawClient] ⚠️  Empty response for date: ${regDt}`);
        return { data: [] };
      }

      if (response.data.error) {
        console.error(`[LawClient] ❌ API Error for date ${regDt}:`, response.data.error);
        return { data: [], error: response.data.error };
      }

      console.log(`[LawClient] ✅ Response for date ${regDt}: ${Array.isArray(response.data.data) ? response.data.data.length : 0} items`);
      return response.data;
    });
  }

  /**
   * 2. 신구법 비교 데이터 조회 (법령 전용)
   * target=oldAndNew를 사용하여 특정 법령의 신구법 비교 데이터 조회
   * 
   * API: http://www.law.go.kr/DRF/lawService.do?target=oldAndNew&MST=[번호]&OC=[인증키]&type=JSON
   * 
   * @param mst - 법령 MST 코드
   */
  async getLawComparison(mst: string): Promise<any> {
    return withRetry(async () => {
      await this.rateLimiter.wait();

      const params = {
        target: 'oldAndNew',  // 신구법 비교
        OC: OC_ID,
        type: 'JSON',
        MST: mst,
      };

      console.log(`[LawClient] 🔍 Fetching law comparison for MST: ${mst}`);
      const response = await this.client.get('/lawService.do', { params });

      if (!response.data) {
        console.warn(`[LawClient] ⚠️  Empty response for MST: ${mst}`);
        return null;
      }

      if (response.data.error) {
        console.error(`[LawClient] ❌ API Error for MST ${mst}:`, response.data.error);
        return null;
      }

      console.log(`[LawClient] ✅ Response for MST ${mst}: received`);
      
      // === 한글 시행일자 필드 추출 (우선순위) ===
      const extractEffectiveDate = (data: any): string | null => {
        const normalizeDate = (value: unknown): string | null => {
          if (value === null || value === undefined) return null;
          const digitsOnly = String(value).replace(/\D/g, '');
          return /^\d{8}$/.test(digitsOnly) ? digitsOnly : null;
        };

        // 1. 최우선 순위
        const prioritizedDate = normalizeDate(data?.OldAndNewService?.신조문_기본정보?.시행일자);
        if (prioritizedDate) return prioritizedDate;

        // 2. 기존 주요 경로 + 영문 키
        const fallbackCandidates = [
          data?.OldAndNewService?.구조문_기본정보?.시행일자,
          data?.OldAndNewService?.기본정보?.시행일자,
          data?.OldAndNewService?.신조문_기본정보?.efYd,
          data?.신조문_기본정보?.시행일자,
          data?.구조문_기본정보?.시행일자,
          data?.oldAndNew?.신조문_기본정보?.시행일자,
          data?.efYd,
        ];
        for (const candidate of fallbackCandidates) {
          const normalized = normalizeDate(candidate);
          if (normalized) return normalized;
        }

        // 3. 전체 응답에서 한글 키값 '시행일자'를 재귀 탐색
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

        const discoveredDates = collectEffectiveDates(data);
        if (discoveredDates.length > 0) {
          return discoveredDates[0];
        }

        return null;
      };
      
      const extractedDate = extractEffectiveDate(response.data);
      if (extractedDate) {
        console.log(`[LawClient] 📅 Extracted effective date: ${extractedDate}`);
        response.data._extractedEffectiveDate = extractedDate;
      } else {
        console.warn(`[LawClient] ⚠️  No valid effective date found in response`);
      }
      
      return response.data;
    });
  }

  /**
   * 3. 행정규칙(고시) 조회
   * target=admrul을 사용하여 기간 내 모든 고시 조회
   * 
   * API: http://www.law.go.kr/DRF/lawSearch.do?target=admrul&OC=[인증키]&prmlYd=[시작]~[종료]&type=JSON
   * 
   * @param startDate - 시작일자 (YYYYMMDD)
   * @param endDate - 종료일자 (YYYYMMDD)
   */
  async getAdminRulesByDateRange(startDate: string, endDate: string): Promise<any> {
    return withRetry(async () => {
      await this.rateLimiter.wait();

      const params = {
        target: 'admrul',
        OC: OC_ID,
        type: 'JSON',
        prmlYd: `${startDate}~${endDate}`,
        display: 100,
        page: 1,
      };

      console.log(`[LawClient] 🔍 Fetching admin rules for date range: ${startDate} ~ ${endDate}`);
      const response = await this.client.get('/lawSearch.do', { params });

      if (!response.data) {
        console.warn(`[LawClient] ⚠️  Empty response for admin rules`);
        return { data: [] };
      }

      if (response.data.error) {
        console.error(`[LawClient] ❌ API Error for admin rules:`, response.data.error);
        return { data: [], error: response.data.error };
      }

      console.log(`[LawClient] ✅ Response for admin rules: ${Array.isArray(response.data.data) ? response.data.data.length : 0} items`);
      return response.data;
    });
  }

  /**
   * 4. 행정규칙 신구법 비교 조회
   * target=admrulOldAndNew를 사용하여 특정 행정규칙의 신구법 비교 데이터 조회
   * 
   * API: http://www.law.go.kr/DRF/lawService.do?target=admrulOldAndNew&ID=[ID]&OC=[인증키]&type=JSON
   * 
   * @param lid - 행정규칙 LID
   */
  async getAdminRuleComparison(lid: string): Promise<any> {
    return withRetry(async () => {
      await this.rateLimiter.wait();

      const params = {
        target: 'admrulOldAndNew',
        OC: OC_ID,
        type: 'JSON',
        LID: lid,
      };

      console.log(`[LawClient] 🔍 Fetching admin rule comparison for LID: ${lid}`);
      const response = await this.client.get('/lawService.do', { params });

      if (!response.data) {
        console.warn(`[LawClient] ⚠️  Empty response for admin rule LID: ${lid}`);
        return null;
      }

      if (response.data.error) {
        console.error(`[LawClient] ❌ API Error for admin rule ${lid}:`, response.data.error);
        return null;
      }

      console.log(`[LawClient] ✅ Response for admin rule ${lid}: received`);
      return response.data;
    });
  }
}

export const lawAPIClient = new LawAPIClient();
