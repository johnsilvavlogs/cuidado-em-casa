import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const careCases = sqliteTable("care_cases", {
  id: text("id").primaryKey(),
  stateJson: text("state_json").notNull(),
});
export const demoSessions = sqliteTable("demo_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  caseId: text("case_id").notNull().references(() => careCases.id),
  role: text("role").notNull(),
  expiresAt: text("expires_at").notNull(),
}, table => [index("session_case").on(table.caseId), check("demo_role", sql`${table.role} IN ('patient', 'caregiver')`)]);
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordSalt: text("password_salt").notNull(),
  passwordHash: text("password_hash").notNull(),
  caseId: text("case_id").notNull().unique().references(() => careCases.id),
  createdAt: text("created_at").notNull(),
});
export const accountSessions = sqliteTable("account_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  expiresAt: text("expires_at").notNull(),
}, table => [index("account_session_account").on(table.accountId)]);
export const loginAttempts = sqliteTable("login_attempts", {
  emailHash: text("email_hash").primaryKey(),
  attempts: integer("attempts").notNull(),
  windowStartedAt: text("window_started_at").notNull(),
});
export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => careCases.id),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  fileName: text("file_name").notNull(),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
  pageCount: integer("page_count"),
}, table => [index("document_case").on(table.caseId)]);
export const operations = sqliteTable("operations", {
  caseId: text("case_id").notNull().references(() => careCases.id),
  requestId: text("request_id").notNull(),
  role: text("role").notNull(),
  fingerprint: text("fingerprint").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [primaryKey({ columns: [table.caseId, table.requestId] })]);
export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => careCases.id),
  role: text("role").notNull(),
  eventType: text("event_type").notNull(),
  requestId: text("request_id"),
  createdAt: text("created_at").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json").notNull(),
}, table => [index("audit_case").on(table.caseId, table.createdAt)]);
