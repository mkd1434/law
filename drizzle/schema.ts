import { int, longtext, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * 모니터링 대상 법령/행정규칙 목록
 * 감시 대상이 되는 법령 및 행정규칙을 관리하는 테이블
 */
export const monitoredItems = mysqlTable("monitored_items", {
  id: int("id").autoincrement().primaryKey(),
  /** 법령/규칙 이름 */
  name: varchar("name", { length: 500 }).notNull(),
  /** 타입: 'law' (법령) 또는 'rule' (행정규칙) */
  type: mysqlEnum("type", ["law", "rule"]).notNull(),
  /** 모니터링 활성화 여부 */
  isActive: int("is_active").default(1).notNull(),
  /** 국가법령정보 연동용 ID: CSV 법령ID(lsJoHstInf·oldAndNew lawId). 구 데이터는 법령MST만 있을 수 있음. */
  externalId: varchar("external_id", { length: 255 }),
  /** 생성 일시 */
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /** 수정 일시 */
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type MonitoredItem = typeof monitoredItems.$inferSelect;
export type InsertMonitoredItem = typeof monitoredItems.$inferInsert;

/**
 * 변경 로그 테이블
 * 감지된 법령/행정규칙의 변경 사항을 저장
 */
export const changeLogs = mysqlTable("change_logs", {
  id: int("id").autoincrement().primaryKey(),
  /** monitored_items 테이블의 외래키 */
  itemId: int("item_id").notNull(),
  /** 공고 번호 (법제처 API에서 제공) */
  announcementNo: varchar("announcement_no", { length: 255 }).notNull(),
  /** 시행 예정 날짜 */
  effectiveDate: timestamp("effective_date").notNull(),
  /** 상태: 'current' (현행) 또는 'upcoming' (시행 예정) */
  status: mysqlEnum("status", ["current", "upcoming"]).notNull(),
  /** 신구법 비교 데이터 (대용량 JSON 문자열, LONGTEXT) */
  comparisonData: longtext("comparison_data"),
  /** 법령 조문 원문(HTML 포함) */
  content: longtext("content"),
  /** 원문 데이터 (대용량 JSON 문자열, LONGTEXT) */
  rawData: longtext("raw_data"),
  /** 생성 일시 */
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /** 수정 일시 */
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type ChangeLog = typeof changeLogs.$inferSelect;
export type InsertChangeLog = typeof changeLogs.$inferInsert;

/**
 * 관계 정의
 */
export const monitoredItemsRelations = relations(monitoredItems, ({ many }) => ({
  changeLogs: many(changeLogs),
}));

export const changeLogsRelations = relations(changeLogs, ({ one }) => ({
  monitoredItem: one(monitoredItems, {
    fields: [changeLogs.itemId],
    references: [monitoredItems.id],
  }),
}));