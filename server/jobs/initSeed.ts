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
import { eq } from 'drizzle-orm';
import { splitCsvLine } from './lawListCsvParse';

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

interface SeedOptions {
  /** CSV에서 가져올 법령(law) 최대 개수. 행정규칙 1건은 `fixedRuleName`으로 별도 추가됨. */
  targetCount?: number;
  fixedRuleName?: string;
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
export async function initializeSeedData(options: SeedOptions = {}): Promise<void> {
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

    /** 모니터링할 법령 개수(행정규칙 1건은 별도 추가) */
    const targetCount = options.targetCount ?? 20;
    const TARGET_RULE_NAME = options.fixedRuleName ?? '전기안전관리자의 직무에 관한 고시';
    const lawRecords = records.filter((record) => determineType(record.법령명.trim()) === 'law');
    const targetRule = records.find((record) => record.법령명.trim() === TARGET_RULE_NAME);
    const targetRecords: LawRecord[] = [
      ...lawRecords.slice(0, targetCount),
      ...(targetRule ? [targetRule] : []),
    ];
    const totalTargetSlots = targetCount + (targetRule ? 1 : 0);

    if (!targetRule) {
      console.warn(`[InitSeed] ⚠️ 지정된 행정규칙("${TARGET_RULE_NAME}")을 CSV에서 찾지 못했습니다.`);
    }

    const existingItems = await db.select().from(monitoredItems);
    console.log(`[InitSeed] 📊 existing monitored item count: ${existingItems.length}`);
    const shouldRestrictToUpsertOnly = existingItems.length >= targetCount;
    if (shouldRestrictToUpsertOnly) {
      console.log(`[InitSeed] 🔒 기존 항목이 ${targetCount}개 이상이라 신규 난삽입 없이 Upsert 중심으로 동작합니다.`);
    }

    // 이름 중복 제거 후 최신 1개만 유지하여 과증식(80+)을 원복
    const groupedByName = new Map<string, any[]>();
    for (const item of existingItems) {
      const name = (item.name || '').trim();
      const list = groupedByName.get(name) || [];
      list.push(item);
      groupedByName.set(name, list);
    }

    const duplicateDeleteIds: number[] = [];
    for (const sameNameItems of Array.from(groupedByName.values())) {
      const sorted = [...sameNameItems].sort((a, b) => a.id - b.id);
      duplicateDeleteIds.push(...sorted.slice(1).map((item) => item.id));
    }
    for (const id of duplicateDeleteIds) {
      await db.delete(monitoredItems).where(eq(monitoredItems.id, id));
    }
    if (duplicateDeleteIds.length > 0) {
      console.log(`[InitSeed] 🧹 중복 항목 ${duplicateDeleteIds.length}개 삭제 완료`);
    }

    const refreshedItems = await db.select().from(monitoredItems);
    const targetNameSet = new Set(targetRecords.map((record) => record.법령명.trim()));
    const extraItems = refreshedItems.filter((item) => !targetNameSet.has((item.name || '').trim()));
    for (const item of extraItems) {
      await db.delete(monitoredItems).where(eq(monitoredItems.id, item.id));
    }
    if (extraItems.length > 0) {
      console.log(`[InitSeed] 🧹 대상 외 항목 ${extraItems.length}개 삭제 (${totalTargetSlots}개 원복 정책)`);
    }

    const currentItems = await db.select().from(monitoredItems);
    const existingByName = new Map<string, any>();
    currentItems.forEach((item) => {
      existingByName.set((item.name || '').trim(), item);
    });

    let insertedCount = 0;
    let updatedCount = 0;

    for (const record of targetRecords) {
      try {
        const lawName = record.법령명.trim();
        const lawMST = record.법령MST.trim();
        /** lsJoHstInf 등 목록 API는 법령ID 기준이라 external_id에 법령ID를 둔다(MST와 숫자가 다름). */
        const lawApiId =
          record.법령ID && String(record.법령ID).trim() !== ""
            ? String(record.법령ID).trim()
            : lawMST;
        const lawType = determineType(lawName); // lawName 기반 분류

        const existing = existingByName.get(lawName);
        if (existing) {
          await db
            .update(monitoredItems)
            .set({
              type: lawType,
              isActive: 1,
              externalId: lawApiId,
            })
            .where(eq(monitoredItems.id, existing.id));
          updatedCount++;
          continue;
        }

        if (shouldRestrictToUpsertOnly && existingByName.size >= totalTargetSlots) {
          console.log(`[InitSeed] ⏭️ 신규 삽입 스킵(${totalTargetSlots}개 제한): ${lawName}`);
          continue;
        }

        await db.insert(monitoredItems).values({
          name: lawName,
          type: lawType,
          isActive: 1,
          externalId: lawApiId,
        });
        insertedCount++;
        existingByName.set(lawName, { name: lawName });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[InitSeed] ❌ 오류: ${record.법령명} - ${errorMsg}`);
      }
    }

    const finalItems = await db.select().from(monitoredItems);
    if (insertedCount > 0 || updatedCount > 0) {
      console.log(`[InitSeed] ✅ Seed 데이터 로드 완료 (inserted=${insertedCount}, updated=${updatedCount}, finalCount=${finalItems.length})`);
    } else {
      console.log('[InitSeed] ℹ️  추가할 데이터가 없습니다');
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[InitSeed] ❌ Seed 데이터 로드 실패: ${errorMsg}`);
  }
}
