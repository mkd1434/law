import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, monitoredItems, InsertMonitoredItem, changeLogs, InsertChangeLog } from "../drizzle/schema";
import { ENV } from './_core/env';

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

  let query = db.select().from(monitoredItems) as any;
  if (filters?.type) {
    query = query.where(eq(monitoredItems.type, filters.type));
  }
  if (filters?.isActive !== undefined) {
    query = query.where(eq(monitoredItems.isActive, filters.isActive ? 1 : 0));
  }
  return query.execute();
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

/**
 * 변경 로그 조회 (최근 1년 및 미래 시행 예정)
 */
export async function getChangeLogs(filters?: { itemId?: number; status?: 'current' | 'upcoming'; limit?: number }) {
  const db = await getDb();
  if (!db) return [];

  let query = db.select().from(changeLogs) as any;
  if (filters?.itemId) {
    query = query.where(eq(changeLogs.itemId, filters.itemId));
  }
  if (filters?.status) {
    query = query.where(eq(changeLogs.status, filters.status));
  }
  query = query.orderBy(desc(changeLogs.effectiveDate));
  if (filters?.limit) {
    query = query.limit(filters.limit);
  }
  return query.execute();
}

/**
 * 변경 로그 추가
 */
export async function addChangeLog(log: InsertChangeLog) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  return db.insert(changeLogs).values(log);
}

/**
 * 변경 로그 Upsert (이미 있으면 업데이트, 없으면 추가)
 * announcementNo 기반으로 중복 체크
 */
export async function upsertChangeLog(log: InsertChangeLog) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  
  // announcementNo로 기존 데이터 확인
  const existing = await db
    .select()
    .from(changeLogs)
    .where(eq(changeLogs.announcementNo, log.announcementNo))
    .limit(1);
  
  if (existing.length > 0) {
    // 기존 데이터 업데이트
    console.log(`[DB] 📝 Updating existing change log: ${log.announcementNo}`);
    return db.update(changeLogs)
      .set({
        effectiveDate: log.effectiveDate,
        status: log.status,
        comparisonData: log.comparisonData,
        rawData: log.rawData,
      })
      .where(eq(changeLogs.announcementNo, log.announcementNo));
  } else {
    // 새로운 데이터 추가
    console.log(`[DB] ✨ Adding new change log: ${log.announcementNo}`);
    return db.insert(changeLogs).values(log);
  }
}


/**
 * 변경 로그 업데이트
 */
export async function updateChangeLog(id: number, updates: Partial<InsertChangeLog>) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  return db.update(changeLogs).set(updates).where(eq(changeLogs.id, id));
}

/**
 * 특정 항목의 최신 변경 로그 조회
 */
export async function getLatestChangeLogForItem(itemId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(changeLogs)
    .where(eq(changeLogs.itemId, itemId))
    .orderBy(desc(changeLogs.effectiveDate))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

// TODO: add feature queries here as your schema grows.
