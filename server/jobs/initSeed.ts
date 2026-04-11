/**
 * 초기 Seed 데이터 로더
 * 서버 시작 시 자동으로 CSV에서 모니터링 대상 데이터를 로드
 * 
 * 동작:
 * 1. 데이터베이스 연결 확인
 * 2. 기존 데이터 확인
 * 3. CSV 파일에서 데이터 읽기
 * 4. 중복 제거 후 새로운 데이터만 삽입
 */

import fs from 'fs';
import path from 'path';
import { getDb } from '../db';
import { monitoredItems } from '../../drizzle/schema';

interface LawRecord {
  순번: string;
  법령MST: string;
  소관부처코드: string;
  소관부처명: string;
  법령ID: string;
  법령명: string;
  공포일자: string;
  공포번호: string;
  시행일자: string;
  법령구분코드: string;
  법령구분명: string;
  법령분야코드: string;
  법령분야명: string;
}

/**
 * 법령명에 기반한 type 결정
 * 
 * 법령(Statutes): 시행규칙이 포함되면 law
 * 행정규칙(Administrative Rules): 고시가 포함되면 rule
 */
function determineType(lawName: string): 'law' | 'rule' {
  // 시행규칙은 법령으로 분류
  if (lawName.includes('시행규칙')) {
    return 'law';
  }
  
  // 고시는 행정규칙으로 분류
  if (lawName.includes('고시')) {
    return 'rule';
  }
  
  // 기본값: 법률, 대통령령, 부령 등은 모두 law
  return 'law';
}

/**
 * CSV 파일 파싱
 */
function parseCSV(filePath: string): LawRecord[] {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`[InitSeed] ⚠️  CSV 파일을 찾을 수 없습니다: ${filePath}`);
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    // 헤더 행 찾기
    let headerIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('순번') && lines[i].includes('법령MST')) {
        headerIndex = i;
        break;
      }
    }

    if (headerIndex === -1) {
      console.warn('[InitSeed] ⚠️  CSV 헤더를 찾을 수 없습니다');
      return [];
    }

    const headers = lines[headerIndex].split(',').map(h => h.trim());
    const records: LawRecord[] = [];

    for (let i = headerIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values = line.split(',').map(v => v.trim());
      const record: any = {};

      headers.forEach((header, index) => {
        record[header] = values[index] || '';
      });

      // 빈 이름 필터링 (이름이 없으면 스킵)
      if (!record['법령명'] || !record['법령명'].trim()) {
        continue;
      }

      records.push(record as LawRecord);
    }

    return records;
  } catch (error) {
    console.error('[InitSeed] ❌ CSV 파싱 오류:', error);
    return [];
  }
}

/**
 * 초기 Seed 데이터 로드
 */
export async function initializeSeedData(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) {
      console.warn('[InitSeed] ⚠️  데이터베이스 연결 불가 - Seed 데이터 로드 스킵');
      return;
    }

    // CSV 파일 경로 (프로젝트 루트 기준)
    const csvPath = path.join(process.cwd(), 'data', '법령목록.csv');

    // CSV 파일 파싱
    const records = parseCSV(csvPath);
    if (records.length === 0) {
      console.warn('[InitSeed] ⚠️  CSV 파일에서 데이터를 읽을 수 없습니다');
      return;
    }

    // 기존 데이터 확인 (데이터 보존)
    console.log('[InitSeed] 📋 기존 데이터 확인 중...');
    const existing = await db.select().from(monitoredItems);
    console.log(`[InitSeed] 📊 현재 DB에 ${existing.length}개의 모니터링 대상이 있습니다`);

    // 새로운 데이터 삽입 (중복 제거)
    let insertedCount = 0;
    let skippedCount = 0;

    for (const record of records) {
      try {
        const lawName = record.법령명.trim();
        const lawMST = record.법령MST.trim();
        const lawType = determineType(lawName);  // lawName 기반 분류

        // 중복 확인
        const isDuplicate = existing.some(
          item => item.externalId === lawMST && item.name === lawName
        );

        if (isDuplicate) {
          skippedCount++;
          continue;
        }

        // 삽입
        await db.insert(monitoredItems).values({
          name: lawName,
          type: lawType,
          isActive: 1,
          externalId: lawMST,
        });

        insertedCount++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[InitSeed] ❌ 오류: ${record.법령명} - ${errorMsg}`);
      }
    }

    if (insertedCount > 0) {
      console.log(`[InitSeed] ✅ Seed 데이터 로드 완료 (신규: ${insertedCount}개 추가)`);
    } else if (skippedCount > 0) {
      console.log(`[InitSeed] ℹ️  모든 데이터가 이미 존재합니다 (중복: ${skippedCount}개)`);
    } else {
      console.log('[InitSeed] ℹ️  추가할 새로운 데이터가 없습니다');
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[InitSeed] ❌ Seed 데이터 로드 실패: ${errorMsg}`);
  }
}
