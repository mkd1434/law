/**
 * Seed Data 로더
 * CSV 파일에서 법령 데이터를 읽어 monitored_items 테이블에 저장
 * 
 * 데이터 매핑:
 * - 법령명 → name
 * - 법령구분명이 '법률', '대통령령', '부령' → type: 'law'
 * - 그 외 (고시, 지침 등) → type: 'rule'
 * - 법령MST → externalId
 */

import fs from 'fs';

import { getDb } from '../db';
import { splitCsvLine } from './lawListCsvParse';
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
 * 법령구분명에서 type 결정
 */
function determineType(lawClassification: string): 'law' | 'rule' {
  const lawTypes = ['법률', '대통령령', '부령'];
  return lawTypes.includes(lawClassification) ? 'law' : 'rule';
}

/**
 * CSV 파일 파싱
 */
function parseCSV(filePath: string): LawRecord[] {
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
    throw new Error('CSV 헤더를 찾을 수 없습니다');
  }

  const headers = splitCsvLine(lines[headerIndex]).map((h) => h.trim());
  const records: LawRecord[] = [];

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = splitCsvLine(line);
    const record: any = {};

    headers.forEach((header, index) => {
      record[header] = values[index] || '';
    });

    if (record.법령명 && record.법령MST) {
      records.push(record as LawRecord);
    }
  }

  return records;
}

/**
 * Seed Data 로드 및 DB 저장
 */
async function seedMonitoredItems(csvFilePath: string): Promise<void> {
  console.log('[SeedData] 📂 CSV 파일 파싱 시작...\n');

  try {
    // CSV 파싱
    const records = parseCSV(csvFilePath);
    console.log(`[SeedData] ✅ CSV 파싱 완료: ${records.length}개 항목\n`);

    // DB 연결
    const db = await getDb();
    if (!db) {
      throw new Error('데이터베이스 연결 실패');
    }

    // 기존 데이터 확인
    const existing = await db.select().from(monitoredItems);
    console.log(`[SeedData] 📊 기존 데이터: ${existing.length}개\n`);

    // 새로운 데이터 삽입
    let insertedCount = 0;
    let skippedCount = 0;

    for (const record of records) {
      try {
        const lawName = record.법령명.trim();
        const lawMST = record.법령MST.trim();
        const lawType = determineType(record.법령구분명);

        // 중복 확인
        const isDuplicate = existing.some(
          item => item.externalId === lawMST && item.name === lawName
        );

        if (isDuplicate) {
          console.log(`[SeedData] ⏭️  스킵 (중복): ${lawName} (MST: ${lawMST})`);
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

        const typeBadge = lawType === 'law' ? '📜' : '📋';
        console.log(`[SeedData] ${typeBadge} 삽입: ${lawName} (MST: ${lawMST}, Type: ${lawType})`);
        insertedCount++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[SeedData] ❌ 오류: ${record.법령명} - ${errorMsg}`);
      }
    }

    console.log(`\n[SeedData] ✅ Seed Data 로드 완료`);
    console.log(`  - 삽입: ${insertedCount}개`);
    console.log(`  - 스킵: ${skippedCount}개`);
    console.log(`  - 총합: ${insertedCount + skippedCount}개\n`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[SeedData] ❌ Seed Data 로드 실패: ${errorMsg}`);
    throw error;
  }
}

// 실행
const csvPath = '/home/ubuntu/upload/법령목록.csv';
seedMonitoredItems(csvPath).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
