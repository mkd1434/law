import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, monitoredItems, InsertMonitoredItem, changeLogs, InsertChangeLog } from "../drizzle/schema";
import { ENV } from './_core/env';

/** INSERT 시 객체를 그대로 넣을 수 있게 comparisonData/rawData는 unknown 허용 */
export type ChangeLogWritePayload = Omit<InsertChangeLog, "comparisonData" | "rawData"> & {
  comparisonData?: unknown;
  rawData?: unknown;
};

function serializeLongTextJsonField(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function parseStoredJsonField(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function mapChangeLogRow<T extends Record<string, unknown>>(row: T): T {
  return {
    ...row,
    comparisonData: parseStoredJsonField(row.comparisonData),
    rawData: parseStoredJsonField(row.rawData),
  } as T;
}

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/**
 * 모니터링 대상 목록 조회
 */
export async function getMonitoredItems(filters?: { type?: 'law' | 'rule'; isActive?: boolean }) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters?.type) {
    conditions.push(eq(monitoredItems.type, filters.type));
  }
  if (filters?.isActive !== undefined) {
    conditions.push(eq(monitoredItems.isActive, filters.isActive ? 1 : 0));
  }
  const base = db.select().from(monitoredItems);
  const q = conditions.length > 0 ? base.where(and(...conditions)) : base;
  return q.execute();
}

/**
 * 모니터링 대상 추가
 */
export async function addMonitoredItem(item: InsertMonitoredItem) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  return db.insert(monitoredItems).values(item);
}

/**
 * 모니터링 대상 업데이트
 */
export async function updateMonitoredItem(id: number, updates: Partial<InsertMonitoredItem>) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  return db.update(monitoredItems).set(updates).where(eq(monitoredItems.id, id));
}

/**
 * 모니터링 대상 삭제
 */
export async function deleteMonitoredItem(id: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  return db.delete(monitoredItems).where(eq(monitoredItems.id, id));
}

type ChangeLogSelectFilters = { itemId?: number; status?: 'current' | 'upcoming'; limit?: number };

async function executeChangeLogSelect(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  filters: ChangeLogSelectFilters | undefined,
  limitVal: number,
  includeContent: boolean
) {
  const conditions = [];
  if (filters?.itemId !== undefined) {
    conditions.push(eq(changeLogs.itemId, filters.itemId));
  }
  if (filters?.status) {
    conditions.push(eq(changeLogs.status, filters.status));
  }

  const base = includeContent
    ? db.select().from(changeLogs)
    : db
        .select({
          id: changeLogs.id,
          itemId: changeLogs.itemId,
          announcementNo: changeLogs.announcementNo,
          effectiveDate: changeLogs.effectiveDate,
          status: changeLogs.status,
          comparisonData: changeLogs.comparisonData,
          rawData: changeLogs.rawData,
          createdAt: changeLogs.createdAt,
          updatedAt: changeLogs.updatedAt,
        })
        .from(changeLogs);

  const filtered = conditions.length > 0 ? base.where(and(...conditions)) : base;
  return filtered.orderBy(desc(changeLogs.effectiveDate)).limit(limitVal).execute();
}

function isMysqlUnknownContentColumn(err: unknown): boolean {
  const e = err as { cause?: { errno?: number; sqlMessage?: string } };
  const msg = String(e?.cause?.sqlMessage ?? "");
  return e?.cause?.errno === 1054 && msg.includes("content");
}

/**
 * 변경 로그 조회
 * content 컬럼이 없는 구 DB면 content 제외 SELECT로 한 번 더 시도(목록 표시용).
 */
export async function getChangeLogs(filters?: ChangeLogSelectFilters) {
  const db = await getDb();
  if (!db) return [];

  const parsed = Number(filters?.limit);
  const limitVal = Math.min(Math.max(Number.isFinite(parsed) && parsed > 0 ? parsed : 100, 1), 2000);

  try {
    const rows = await executeChangeLogSelect(db, filters, limitVal, true);
    return (rows as any[]).map((row) => mapChangeLogRow(row));
  } catch (err) {
    if (isMysqlUnknownContentColumn(err)) {
      console.warn(
        "[DB] getChangeLogs: `content` 컬럼 없음 — content 제외로 재조회합니다. 마이그레이션(0002/0004) 적용을 권장합니다."
      );
      try {
        const rows = await executeChangeLogSelect(db, filters, limitVal, false);
        return (rows as any[]).map((row) => mapChangeLogRow({ ...row, content: null } as any));
      } catch (err2) {
        console.error("[DB] getChangeLogs 재조회 실패:", err2);
        throw err2;
      }
    }
    console.error("[DB] getChangeLogs SQL error:", err);
    console.error(
      "[DB] If the message mentions unknown column, run pnpm db:push (schema sync) or pnpm db:ensure-content, or drizzle 0004."
    );
    throw err;
  }
}

/**
 * 변경 로그 추가
 */
export async function addChangeLog(log: ChangeLogWritePayload) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const row: InsertChangeLog = {
    ...log,
    comparisonData: serializeLongTextJsonField(log.comparisonData),
    rawData: serializeLongTextJsonField(log.rawData),
  };
  return db.insert(changeLogs).values(row);
}

/**
 * 변경 로그 Upsert (이미 있으면 업데이트, 없으면 추가)
 * announcementNo 기반으로 중복 체크
 */
export async function upsertChangeLog(log: ChangeLogWritePayload) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  
  // Delete then Insert 방식: 기존 데이터 삭제 후 새로 삽입 (무조건 덮어쓰기)
  console.log(`[DB] 🔄 Delete then Insert: ${log.announcementNo}`);
  
  try {
    const row: InsertChangeLog = {
      ...log,
      comparisonData: serializeLongTextJsonField(log.comparisonData),
      rawData: serializeLongTextJsonField(log.rawData),
    };
    // 기존 데이터 삭제
    const deleteResult = await db.delete(changeLogs)
      .where(eq(changeLogs.announcementNo, log.announcementNo));
    console.log(`[DB] 🗑️  Deleted existing records for: ${log.announcementNo}`);
    
    // 새로운 데이터 삽입
    console.log(`[DB] ✨ Inserting new change log: ${log.announcementNo}`);
    console.log(`[DB] ✨ effectiveDate: ${log.effectiveDate?.toISOString()}`);
    if (typeof row.content === 'string') {
      const content = row.content;
      console.log(`[DB] ✨ contentLength: ${content.length}`);
      console.log(`[DB] ✨ contentPreview: ${content.slice(0, 300)}${content.length > 300 ? '...' : ''}`);
    } else {
      console.warn(`[DB] ⚠️ content field is missing or not a string for ${log.announcementNo}`);
    }
    const result = await db.insert(changeLogs).values(row);
    console.log(`[DB] ✅ Successfully saved: ${log.announcementNo}`);
    return result;
  } catch (error) {
    if (isMysqlUnknownContentColumn(error)) {
      console.warn(
        "[DB] upsertChangeLog: `content` 컬럼 없음 — content 없이 재삽입합니다. drizzle 0004 또는 pnpm db:ensure-content 권장."
      );
      try {
        const row: InsertChangeLog = {
          ...log,
          comparisonData: serializeLongTextJsonField(log.comparisonData),
          rawData: serializeLongTextJsonField(log.rawData),
          content: null,
        };
        await db.delete(changeLogs).where(eq(changeLogs.announcementNo, log.announcementNo));
        const result = await db.insert(changeLogs).values(row);
        console.log(`[DB] ✅ Successfully saved (no content column): ${log.announcementNo}`);
        return result;
      } catch (e2) {
        console.error(`[DB] ❌ upsertChangeLog 재시도 실패: ${e2}`);
        throw e2;
      }
    }
    console.error(`[DB] ❌ Error in upsertChangeLog: ${error}`);
    throw error;
  }
}


/**
 * 변경 로그 업데이트
 */
export async function updateChangeLog(id: number, updates: Partial<ChangeLogWritePayload>) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const { comparisonData, rawData, ...rest } = updates;
  const set: Partial<InsertChangeLog> = { ...rest };
  if (comparisonData !== undefined) {
    set.comparisonData = serializeLongTextJsonField(comparisonData) as InsertChangeLog["comparisonData"];
  }
  if (rawData !== undefined) {
    set.rawData = serializeLongTextJsonField(rawData) as InsertChangeLog["rawData"];
  }
  return db.update(changeLogs).set(set).where(eq(changeLogs.id, id));
}

/**
 * 특정 항목의 최신 변경 로그 조회
 */
export async function getLatestChangeLogForItem(itemId: number) {
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = await executeChangeLogSelect(db, { itemId }, 1, true);
    const row = rows[0];
    return row ? mapChangeLogRow(row as Record<string, unknown>) : null;
  } catch (err) {
    if (isMysqlUnknownContentColumn(err)) {
      console.warn(
        "[DB] getLatestChangeLogForItem: `content` 컬럼 없음 — content 제외로 재조회합니다."
      );
      const rows = await executeChangeLogSelect(db, { itemId }, 1, false);
      const row = rows[0];
      return row ? mapChangeLogRow({ ...row, content: null } as Record<string, unknown>) : null;
    }
    throw err;
  }
}

// TODO: add feature queries here as your schema grows.
