/**
 * 통합 데이터 수집 테스트 스크립트
 * 1. CSV에서 Seed Data 로드
 * 2. 모니터링 대상 조회
 * 3. 법령 변동 감지 및 수집 (Rate Limiting 적용)
 */

import fs from 'fs';
import path from 'path';
import { getDb } from '../db';
import { monitoredItems } from '../../drizzle/schema';
import { detectAndCollectLawChanges } from '../api/lawDetector';
import { eq } from 'drizzle-orm';

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

    if (record.법령명 && record.법령MST) {
      records.push(record as LawRecord);
    }
  }

  return records;
}

/**
 * Seed Data 로드
 */
async function loadSeedData(csvFilePath: string): Promise<number> {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📂 STEP 1: CSV Seed Data 로드');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    // CSV 파싱
    const records = parseCSV(csvFilePath);
    console.log(`✅ CSV 파싱 완료: ${records.length}개 항목\n`);

    // DB 연결
    const db = await getDb();
    if (!db) {
      throw new Error('데이터베이스 연결 실패');
    }

    // 기존 데이터 확인
    const existing = await db.select().from(monitoredItems);
    console.log(`📊 기존 데이터: ${existing.length}개\n`);

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
          console.log(`⏭️  스킵 (중복): ${lawName} (MST: ${lawMST})`);
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
        console.log(`${typeBadge} 삽입: ${lawName} (MST: ${lawMST}, Type: ${lawType})`);
        insertedCount++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`❌ 오류: ${record.법령명} - ${errorMsg}`);
      }
    }

    console.log(`\n✅ Seed Data 로드 완료`);
    console.log(`  - 삽입: ${insertedCount}개`);
    console.log(`  - 스킵: ${skippedCount}개`);
    console.log(`  - 총합: ${insertedCount + skippedCount}개\n`);

    return insertedCount;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Seed Data 로드 실패: ${errorMsg}`);
    throw error;
  }
}

/**
 * 법령 데이터 수집
 */
async function collectLawData(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🔍 STEP 2: 법령 데이터 수집 (Rate Limiting 적용)');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    const db = await getDb();
    if (!db) {
      throw new Error('데이터베이스 연결 실패');
    }

    // 활성화된 법령 조회
    const laws = await db
      .select()
      .from(monitoredItems)
      .where(eq(monitoredItems.type, 'law'));

    console.log(`📊 처리할 법령: ${laws.length}개\n`);

    if (laws.length === 0) {
      console.log('ℹ️  처리할 법령이 없습니다.\n');
      return;
    }

    let totalDetected = 0;
    let totalCollected = 0;
    const allErrors: string[] = [];

    // Rate Limiting: 2개씩 처리
    const batchSize = 2;
    for (let i = 0; i < laws.length; i += batchSize) {
      const batch = laws.slice(i, i + batchSize);
      console.log(`\n📦 배치 ${Math.floor(i / batchSize) + 1}/${Math.ceil(laws.length / batchSize)}`);
      console.log('─'.repeat(50));

      for (const law of batch) {
        try {
          const result = await detectAndCollectLawChanges(
            law.id,
            law.externalId || '',
            law.name
          );

          totalDetected += result.detected;
          totalCollected += result.collected;
          allErrors.push(...result.errors);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`❌ 오류: ${law.name} - ${errorMsg}`);
          allErrors.push(`Error processing ${law.name}: ${errorMsg}`);
        }
      }

      // 배치 간 1.5초 지연
      if (i + batchSize < laws.length) {
        console.log('\n⏳ 배치 간 지연 (1.5초)...');
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('✅ 데이터 수집 완료');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  총 감지: ${totalDetected}개`);
    console.log(`  총 수집: ${totalCollected}개`);
    if (allErrors.length > 0) {
      console.log(`  에러: ${allErrors.length}개`);
      console.log('\n⚠️  에러 목록:');
      allErrors.slice(0, 10).forEach((err, idx) => console.log(`  ${idx + 1}. ${err}`));
    }
    console.log('═══════════════════════════════════════════════════════════\n');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`❌ 법령 수집 실패: ${errorMsg}`);
    throw error;
  }
}

/**
 * 메인 실행
 */
async function main(): Promise<void> {
  console.log('\n🚀 법령 모니터링 시스템 - 통합 데이터 수집\n');

  try {
    const csvPath = '/home/ubuntu/upload/법령목록.csv';

    // 파일 존재 여부 확인
    if (!fs.existsSync(csvPath)) {
      console.error(`❌ CSV 파일을 찾을 수 없습니다: ${csvPath}`);
      throw new Error(`CSV 파일을 찾을 수 없습니다: ${csvPath}`);
    }

    // Step 1: Seed Data 로드
    await loadSeedData(csvPath);

    // Step 2: 법령 데이터 수집
    await collectLawData();

    console.log('🎉 모든 작업 완료!\n');
  } catch (error) {
    console.error('❌ 작업 실패:', error);
    process.exit(1);
  }
}

// 실행
main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
