/**
 * 국가법령정보 API 클라이언트
 * 법령(lawService.do)과 행정규칙(admRulService.do)을 엄격하게 분리
 * Rate Limiting: 2개씩, 1.5초 간격
 */

import axios, { AxiosInstance } from 'axios';

const LAW_API_BASE_URL = 'http://www.law.go.kr/DRF';
const OC_ID = 'mkd1434';

/**
 * Rate Limiter: 지정된 개수씩 순차 처리, 일정 간격 유지
 */
class RateLimiter {
  private lastRequestTime = 0;
  private requestCount = 0;

  constructor(
    private delayMs: number = 1500, // 1.5초
    private batchSize: number = 2   // 2개씩
  ) {}

  async wait(): Promise<void> {
    this.requestCount++;

    // batchSize마다 지연 적용
    if (this.requestCount % this.batchSize === 0) {
      const now = Date.now();
      const timeSinceLastDelay = now - this.lastRequestTime;

      if (timeSinceLastDelay < this.delayMs) {
        const waitTime = this.delayMs - timeSinceLastDelay;
        console.log(`[RateLimiter] Batch ${Math.ceil(this.requestCount / this.batchSize)} - Waiting ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      this.lastRequestTime = Date.now();
    }
  }

  reset(): void {
    this.requestCount = 0;
    this.lastRequestTime = 0;
  }
}

/**
 * 자동 재시도 로직
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      console.warn(`[Retry] Attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

/**
 * 법령 API 클라이언트
 */
class LawAPIClient {
  private client: AxiosInstance;
  private rateLimiter: RateLimiter;

  constructor() {
    this.client = axios.create({
      baseURL: LAW_API_BASE_URL,
      timeout: 15000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'LawMonitoringSystem/1.0',
      },
    });

    // Rate Limiter: 2개씩, 1.5초 간격
    this.rateLimiter = new RateLimiter(1500, 2);
  }

  /**
   * 법령 변경이력 목록 조회 API
   * 최근 1년 ~ 미래 시행 예정 건을 조회
   * 
   * API: http://www.law.go.kr/DRF/lawSearch.do?target=lsHstInf
   * 
   * @param regDt - 법령 변경일 (YYYYMMDD 형식)
   * @param options - 조회 옵션 (소관부처, 페이지 등)
   */
  async getLawChangeHistory(
    regDt: string,
    options?: { org?: string; display?: number; page?: number }
  ): Promise<any> {
    return withRetry(async () => {
      await this.rateLimiter.wait();

      const params = {
        target: 'lsHstInf',
        OC: OC_ID,
        type: 'JSON',
        regDt: regDt,
        org: options?.org,
        display: options?.display || 100,
        page: options?.page || 1,
      };

      // undefined 제거
      Object.keys(params).forEach(key => {
        if ((params as any)[key] === undefined) {
          delete (params as any)[key];
        }
      });

      console.log(`[LawClient] Fetching law change history for ${regDt}`);
      const response = await this.client.get('/lawSearch.do', { params });

      if (response.data && typeof response.data === 'object') {
        return response.data;
      }

      throw new Error('Invalid response format');
    });
  }

  /**
   * 개별 법령의 시행법령 변경이력 조회
   * target=efLaw를 사용하여 시행법령 포함 조회
   * 
   * API: http://www.law.go.kr/DRF/lawSearch.do?target=efLaw
   * 
   * @param mst - 법령 MST 코드
   * @param regDt - 변경일 (YYYYMMDD 형식)
   */
  async getLawChangesByMST(
    mst: string,
    regDt: string
  ): Promise<any> {
    return withRetry(async () => {
      await this.rateLimiter.wait();

      const params = {
        target: 'law',  // 'efLaw' 대신 'law' 사용
        OC: OC_ID,
        type: 'JSON',
        MST: mst,
        regDt: regDt,
        display: 100,
        page: 1,
      };

      // 전체 요청 URL 출력 (인증키 포함)
      const fullUrl = `${LAW_API_BASE_URL}/lawSearch.do?${Object.entries(params)
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&')}`;
      console.log(`[LawClient] 📡 Full Request URL:\n${fullUrl}\n`);

      console.log(`[LawClient] 🔍 Fetching law changes for MST: ${mst}, regDt: ${regDt}`);
      const response = await this.client.get('/lawSearch.do', { params });

      if (!response.data) {
        console.warn(`[LawClient] ⚠️  Empty response for MST: ${mst}`);
        return { data: [] };
      }

      if (response.data.error) {
        console.error(`[LawClient] ❌ API Error for MST ${mst}:`, response.data.error);
        return { data: [], error: response.data.error };
      }

      console.log(`[LawClient] ✅ Response for MST ${mst}:`, JSON.stringify(response.data).substring(0, 200));
      return response.data;
    });
  }

  /**
   * 신구법 본문 조회 API (법령 전용)
   * lawService.do 엔드포인트 사용
   * 
   * API: http://www.law.go.kr/DRF/lawService.do?target=oldAndNew
   * 
   * @param params - ID 또는 MST 중 하나는 필수
   */
  async getLawComparison(params: {
    ID?: string;
    MST?: string;
    LM?: string;
    LD?: number;
    LN?: number;
  }): Promise<any> {
    return withRetry(async () => {
      await this.rateLimiter.wait();

      const requestParams = {
        target: 'oldAndNew',
        OC: OC_ID,
        type: 'JSON',
        ...params,
      };

      // undefined 제거
      Object.keys(requestParams).forEach(key => {
        if ((requestParams as any)[key] === undefined) {
          delete (requestParams as any)[key];
        }
      });

      console.log(`[LawClient] Fetching law comparison for MST/ID: ${params.MST || params.ID}`);
      const response = await this.client.get('/lawService.do', { params: requestParams });

      if (response.data && typeof response.data === 'object') {
        return response.data;
      }

      throw new Error('Invalid response format');
    });
  }

  /**
   * 행정규칙 목록 조회 API
   * lawSearch.do 엔드포인트 사용 (target=admrul)
   * 
   * API: http://www.law.go.kr/DRF/lawSearch.do?target=admrul
   * 
   * @param date - 행정규칙 발령일자 (YYYYMMDD 형식)
   * @param options - 조회 옵션
   */
  async getAdminRuleList(
    date?: string,
    options?: { org?: string; knd?: string; display?: number; page?: number }
  ): Promise<any> {
    return withRetry(async () => {
      await this.rateLimiter.wait();

      const params: any = {
        target: 'admrul',
        OC: OC_ID,
        type: 'JSON',
        nw: 1, // 1: 현행
        display: options?.display || 100,
        page: options?.page || 1,
      };

      // 날짜 필수 (date: all 대신 정확한 시작일자 사용)
      if (date) {
        params.date = date;
      } else {
        params.date = '20230411';  // 기본값: 3년 전
      }
      if (options?.org) {
        params.org = options.org;
      }
      if (options?.knd) {
        params.knd = options.knd;
      }

      console.log(`[LawClient] Fetching admin rule list for date: ${date || 'all'}`);
      const response = await this.client.get('/lawSearch.do', { params });

      if (response.data && typeof response.data === 'object') {
        return response.data;
      }

      throw new Error('Invalid response format');
    });
  }

  /**
   * 행정규칙 신구규칙 비교 본문 조회 API (행정규칙 전용)
   * lawService.do 엔드포인트 사용 (target=admrulOldAndNew)
   * 
   * API: http://www.law.go.kr/DRF/lawService.do?target=admrulOldAndNew
   * 
   * @param params - ID 또는 LID 중 하나는 필수
   */
  async getAdminRuleComparison(params: {
    ID?: string;
    LID?: string;
    LM?: string;
  }): Promise<any> {
    return withRetry(async () => {
      await this.rateLimiter.wait();

      const requestParams = {
        target: 'admrulOldAndNew',
        OC: OC_ID,
        type: 'JSON',
        ...params,
      };

      // undefined 제거
      Object.keys(requestParams).forEach(key => {
        if ((requestParams as any)[key] === undefined) {
          delete (requestParams as any)[key];
        }
      });

      console.log(`[LawClient] Fetching admin rule comparison for ID/LID: ${params.ID || params.LID}`);
      const response = await this.client.get('/lawService.do', { params: requestParams });

      if (response.data && typeof response.data === 'object') {
        return response.data;
      }

      throw new Error('Invalid response format');
    });
  }
}

export const lawAPIClient = new LawAPIClient();
