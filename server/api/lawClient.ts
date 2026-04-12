/**
 * 국가법령정보 API 클라이언트
 * 법령(lawService.do)과 행정규칙(admRulService.do)을 엄격하게 분리
 * 
 * 1. 법령 개정 이력: target=lsHstInf (날짜별 루프)
 * 2. 신구법 비교: target=oldAndNew (상세 조회)
 * 3. 행정규칙: target=admrul (prmlYd 파라미터)
 * 
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

      // 전체 요청 URL 출력
      const fullUrl = `${LAW_API_BASE_URL}/lawSearch.do?${Object.entries(params)
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&')}`;
      console.log(`[LawClient] 📡 Full Request URL (lsHstInf):\n${fullUrl}\n`);

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

      // 전체 요청 URL 출력
      const fullUrl = `${LAW_API_BASE_URL}/lawService.do?${Object.entries(params)
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&')}`;
      console.log(`[LawClient] 📡 Full Request URL (oldAndNew):\n${fullUrl}\n`);

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

      console.log(`[LawClient] ✅ Response for MST ${mst}: ${JSON.stringify(response.data).substring(0, 100)}`);
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
        target: 'admrul',  // 행정규칙(고시)
        OC: OC_ID,
        type: 'JSON',
        prmlYd: `${startDate}~${endDate}`,  // 발령일자 범위
        display: 100,
        page: 1,
      };

      // 전체 요청 URL 출력
      const fullUrl = `${LAW_API_BASE_URL}/lawSearch.do?${Object.entries(params)
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&')}`;
      console.log(`[LawClient] 📡 Full Request URL (admrul):\n${fullUrl}\n`);

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
   * 4. 행정규칙 신구규칙 비교 (행정규칙 전용)
   * target=admrulOldAndNew를 사용하여 특정 고시의 신구규칙 비교
   * 
   * API: http://www.law.go.kr/DRF/lawService.do?target=admrulOldAndNew&LID=[번호]&OC=[인증키]&type=JSON
   * 
   * @param lid - 행정규칙 LID 코드
   */
  async getAdminRuleComparison(lid: string): Promise<any> {
    return withRetry(async () => {
      await this.rateLimiter.wait();

      const params = {
        target: 'admrulOldAndNew',  // 행정규칙 신구규칙 비교
        OC: OC_ID,
        type: 'JSON',
        LID: lid,
      };

      // 전체 요청 URL 출력
      const fullUrl = `${LAW_API_BASE_URL}/lawService.do?${Object.entries(params)
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&')}`;
      console.log(`[LawClient] 📡 Full Request URL (admrulOldAndNew):\n${fullUrl}\n`);

      console.log(`[LawClient] 🔍 Fetching admin rule comparison for LID: ${lid}`);
      const response = await this.client.get('/lawService.do', { params });

      if (!response.data) {
        console.warn(`[LawClient] ⚠️  Empty response for LID: ${lid}`);
        return null;
      }

      if (response.data.error) {
        console.error(`[LawClient] ❌ API Error for LID ${lid}:`, response.data.error);
        return null;
      }

      console.log(`[LawClient] ✅ Response for LID ${lid}: ${JSON.stringify(response.data).substring(0, 100)}`);
      return response.data;
    });
  }
}

export const lawAPIClient = new LawAPIClient();
