/**
 * 법제처 공개 API 클라이언트
 * 국가법령정보 공동활용 API를 통해 법령 및 행정규칙 데이터를 조회
 * 
 * Rate Limiting: 2~3개씩 순차 호출, 1초 지연 (법제처 서버 보호)
 * API 분리: 법령(신구법 본문) vs 행정규칙(신구규칙 비교 본문)
 */

import axios, { AxiosInstance } from 'axios';

// 법제처 API 설정
const LAW_API_BASE_URL = 'http://www.law.go.kr/DRF';
const OC_ID = 'mkd1434'; // 국가법령정보 공동활용 OC

/**
 * Rate Limiter 클래스
 * 요청 간 지연을 관리하여 법제처 서버 부하 방지
 * - 배치 크기: 2~3개
 * - 지연: 1초
 */
class RateLimiter {
  private lastRequestTime: number = 0;
  private delayMs: number;
  private batchSize: number;
  private requestCount: number = 0;

  constructor(delayMs: number = 1000, batchSize: number = 2) {
    this.delayMs = delayMs;
    this.batchSize = batchSize;
  }

  /**
   * Rate Limiter 대기
   * 마지막 요청 이후 지정된 시간이 경과할 때까지 대기
   */
  async wait(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.delayMs) {
      const waitTime = this.delayMs - timeSinceLastRequest;
      console.log(`[RateLimiter] Waiting ${waitTime}ms before next request...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  reset(): void {
    this.requestCount = 0;
    this.lastRequestTime = 0;
  }

  getBatchSize(): number {
    return this.batchSize;
  }
}

/**
 * 자동 재시도 로직
 * 네트워크 오류에 대비한 지수 백오프 재시도
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries - 1) {
        const backoffDelay = delayMs * Math.pow(2, attempt);
        console.warn(`[Retry] Attempt ${attempt + 1}/${maxRetries} failed. Retrying in ${backoffDelay}ms...`);
        console.warn(`[Retry] Error: ${lastError.message}`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

/**
 * 법령 API 클라이언트
 */
export class LawAPIClient {
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

    // Rate Limiter: 2~3개씩, 1초 지연
    this.rateLimiter = new RateLimiter(1000, 2);
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

      console.log(`[LawClient] Fetching law change history for ${regDt}`, params);
      const response = await this.client.get('/lawSearch.do', { params });
      
      // 응답 파싱
      if (response.data && typeof response.data === 'object') {
        return response.data;
      }
      
      throw new Error('Invalid response format');
    });
  }

  /**
   * 신구법 본문 조회 API (법령 전용)
   * 법령의 구법과 신법 본문을 조회
   * 
   * API: http://www.law.go.kr/DRF/lawService.do?target=oldAndNew
   * 
   * @param options - 조회 옵션 (ID 또는 MST, 법령명, 공포일자 등)
   */
  async getLawComparison(options: {
    ID?: string;
    MST?: string;
    LM?: string;
    LD?: number;
    LN?: number;
  }): Promise<any> {
    return withRetry(async () => {
      await this.rateLimiter.wait();

      const params: any = {
        target: 'oldAndNew',
        OC: OC_ID,
        type: 'JSON',
        ...options,
      };

      // undefined 제거
      Object.keys(params).forEach(key => {
        if (params[key] === undefined) {
          delete params[key];
        }
      });

      console.log(`[LawClient] Fetching law comparison`, params);
      const response = await this.client.get('/lawService.do', { params });
      return response.data;
    });
  }

  /**
   * 행정규칙 목록 조회 API
   * 모든 행정규칙 목록을 조회 (페이짱 지원)
   * 
   * API: http://www.law.go.kr/DRF/lawSearch.do?target=admrul
   * 
   * @param options - 조회 옵션 (query, date, prmlYd, modYd, page, display 등)
   */
  async getAdminRuleList(options?: {
    query?: string;
    date?: string;
    prmlYd?: string;
    modYd?: string;
    nw?: number;
    search?: number;
    org?: string;
    knd?: string;
    sort?: string;
    page?: number;
    display?: number;
  }): Promise<any> {
    return withRetry(async () => {
      await this.rateLimiter.wait();

      const params: any = {
        target: 'admrul',
        OC: OC_ID,
        type: 'JSON',
        page: options?.page || 1,
        display: options?.display || 100,
        ...options,
      };

      // undefined 제거
      Object.keys(params).forEach(key => {
        if (params[key] === undefined) {
          delete params[key];
        }
      });

      console.log(`[LawClient] Fetching admin rule list`, params);
      const response = await this.client.get('/lawSearch.do', { params });
      return response.data;
    });
  }

  /**
   * 행정규칙 신구규칙 비교 본문 조회 API (행정규칙 전용)
   * 행정규칙의 구규칙과 신규칙 본문을 조회
   * 
   * API: http://www.law.go.kr/DRF/lawService.do?target=admrulOldAndNew
   * 
   * @param options - 조회 옵션 (ID 또는 LID, LM)
   */
  async getAdminRuleComparison(options: {
    ID?: string;
    LID?: string;
    LM?: string;
  }): Promise<any> {
    return withRetry(async () => {
      await this.rateLimiter.wait();

      const params: any = {
        target: 'admrulOldAndNew',
        OC: OC_ID,
        type: 'JSON',
        ...options,
      };

      // undefined 제거
      Object.keys(params).forEach(key => {
        if (params[key] === undefined) {
          delete params[key];
        }
      });

      console.log(`[LawClient] Fetching admin rule comparison`, params);
      const response = await this.client.get('/lawService.do', { params });
      return response.data;
    });
  }

  /**
   * 배치 요청: 여러 항목을 순차적으로 처리 (Rate Limiting 적용)
   * 2~3개씩 묶어서 처리하고 각 배치 간 1초 지연
   * 
   * @param items - 처리할 항목 배열
   * @param processor - 각 항목을 처리하는 함수
   * @param batchSize - 배치 크기 (기본값: 2)
   */
  async processBatch<T>(
    items: T[],
    processor: (item: T) => Promise<any>,
    batchSize: number = 2
  ): Promise<any[]> {
    const results: any[] = [];
    const totalItems = items.length;

    console.log(`[LawClient] Processing ${totalItems} items in batches of ${batchSize}`);

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(items.length / batchSize);

      console.log(`[LawClient] Processing batch ${batchNum}/${totalBatches} (${batch.length} items)`);

      for (const item of batch) {
        try {
          const result = await processor(item);
          results.push(result);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`[LawClient] Error processing item:`, errorMsg);
          results.push({ error: errorMsg });
        }
      }
    }

    console.log(`[LawClient] Batch processing completed. Total requests: ${this.rateLimiter.getRequestCount()}`);
    return results;
  }

  /**
   * 유틸리티: 1년 전 날짜 반환 (YYYYMMDD 형식)
   */
  getDateOneYearAgo(): string {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 1);
    return this.formatDate(date);
  }

  /**
   * 유틸리티: 미래 날짜 반환 (days 일 후, YYYYMMDD 형식)
   */
  getFutureDate(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return this.formatDate(date);
  }

  /**
   * 유틸리티: 날짜를 YYYYMMDD 형식으로 포맷
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /**
   * 유틸리티: 날짜 범위의 모든 날짜 생성 (월 단위)
   * 최근 1년을 월 단위로 분할하여 API 호출 최적화
   */
  getMonthlyDateRange(): string[] {
    const dates: string[] = [];
    const now = new Date();
    
    // 최근 1년 + 미래 1년 = 2년 범위
    for (let i = 0; i < 24; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - 12 + i, 1);
      dates.push(this.formatDate(date));
    }
    
    return dates;
  }

  /**
   * Rate Limiter 상태 조회
   */
  getStats(): { requestCount: number; batchSize: number } {
    return {
      requestCount: this.rateLimiter.getRequestCount(),
      batchSize: this.rateLimiter.getBatchSize(),
    };
  }

  /**
   * Rate Limiter 리셋
   */
  resetStats(): void {
    this.rateLimiter.reset();
  }
}

/**
 * 싱글톤 인스턴스
 */
export const lawAPIClient = new LawAPIClient();
