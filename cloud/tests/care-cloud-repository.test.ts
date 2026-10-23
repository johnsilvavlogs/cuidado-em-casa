import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { CloudCareRepository, CareError, type CloudD1Database, type CloudD1Result, type CloudD1Statement, type CloudR2Bucket } from "../runtime/care-cloud-repository";
import type { ExtractionResult } from "../../src/lib/contracts";

// SQLite executes the real SQL and atomic batches. This exercises the D1
// contract locally; production bindings still need a deployed smoke test.
class SqliteD1 implements CloudD1Database {
  readonly sqlite = new DatabaseSync(":memory:");
  lostSwaps = 0;
  failNextAudit = false;
  beforeNextBatch: (() => void) | undefined;

  constructor() {
    this.sqlite.exec(`
      CREATE TABLE care_cases (id TEXT PRIMARY KEY, state_json TEXT NOT NULL);
      CREATE TABLE demo_sessions (token_hash TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES care_cases(id), role TEXT NOT NULL CHECK(role IN ('patient', 'caregiver')), expires_at TEXT NOT NULL);
      CREATE TABLE accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, case_id TEXT NOT NULL UNIQUE REFERENCES care_cases(id), created_at TEXT NOT NULL);
      CREATE TABLE account_sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires_at TEXT NOT NULL);
      CREATE TABLE login_attempts (email_hash TEXT PRIMARY KEY, attempts INTEGER NOT NULL, window_started_at TEXT NOT NULL);
      CREATE TABLE documents (id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES care_cases(id), name TEXT NOT NULL, mime_type TEXT NOT NULL, file_name TEXT NOT NULL, sha256 TEXT NOT NULL, byte_length INTEGER NOT NULL, page_count INTEGER);
      CREATE TABLE operations (case_id TEXT NOT NULL REFERENCES care_cases(id), request_id TEXT NOT NULL, role TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(case_id, request_id));
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES care_cases(id), role TEXT NOT NULL, event_type TEXT NOT NULL, request_id TEXT, created_at TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL);
    `);
  }

  prepare(sql: string): SqliteStatement { return new SqliteStatement(this, sql); }
  withSession(constraint: "first-primary"): SqliteD1 { assert.equal(constraint, "first-primary"); return this; }

  async batch<T = Record<string, unknown>>(statements: CloudD1Statement[]): Promise<CloudD1Result<T>[]> {
    const hook = this.beforeNextBatch;
    this.beforeNextBatch = undefined;
    hook?.();
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => {
        const local = statement as SqliteStatement;
        if (this.failNextAudit && local.sql.startsWith("INSERT INTO audit_events")) {
          this.failNextAudit = false;
          throw new Error("Injected audit failure");
        }
        return local.execute<T>();
      });
      this.sqlite.exec("COMMIT");
      if ((statements[0] as SqliteStatement).sql.startsWith("UPDATE care_cases") && results[0].results.length === 0) this.lostSwaps += 1;
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  count(table: string, where = "1 = 1"): number {
    return Number(this.sqlite.prepare(`SELECT count(*) AS total FROM ${table} WHERE ${where}`).get()!.total);
  }
}

class SqliteStatement implements CloudD1Statement {
  constructor(private readonly owner: SqliteD1, readonly sql: string, private readonly values: SQLInputValue[] = []) {}
  bind(...values: unknown[]): SqliteStatement { return new SqliteStatement(this.owner, this.sql, values as SQLInputValue[]); }
  execute<T>(): CloudD1Result<T> {
    const results = this.owner.sqlite.prepare(this.sql).all(...this.values) as T[];
    const changes = Number(this.owner.sqlite.prepare("SELECT changes() AS changes").get()!.changes);
    return { results, success: true, meta: { changes } };
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> { return this.execute<T>().results[0] ?? null; }
  async all<T = Record<string, unknown>>(): Promise<CloudD1Result<T>> { return this.execute<T>(); }
}

class MemoryR2 implements CloudR2Bucket {
  readonly objects = new Map<string, Uint8Array>();
  puts = 0;
  async put(key: string, value: Uint8Array): Promise<object> {
    this.puts += 1;
    this.objects.set(key, new Uint8Array(value));
    return { key };
  }
  async get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> {
    const value = this.objects.get(key);
    if (!value) return null;
    return { arrayBuffer: async () => new Uint8Array(value).buffer };
  }
}

function fixture(t: TestContext) {
  const db = new SqliteD1();
  const bucket = new MemoryR2();
  let now = new Date("2026-10-23T15:00:00.000Z");
  const repository = new CloudCareRepository(db, bucket, { now: () => now });
  const second = new CloudCareRepository(db, bucket, { now: () => now });
  t.after(() => db.sqlite.close());
  return { repository, second, db, bucket, setTime: (time: string) => { now = new Date(time); } };
}

const req = () => randomUUID();
const status = (expected: number) => (error: unknown) => error instanceof CareError && error.status === expected;

test("cloud demos persist across repository instances and isolate private originals", async (t) => {
  const { repository, second, db, bucket, setTime } = fixture(t);
  const demo = await repository.startDemo({ scenario: "ready", role: "patient" });
  const caregiver = await second.startDemo({ scenario: "setup", role: "caregiver", demoId: demo.state.demoId });
  assert.equal(caregiver.state.demoId, demo.state.demoId);
  assert.equal((await second.getState(demo.token)).plan.status, "active");
  const document = await second.getDocument(demo.token, demo.state.document!.id);
  assert.match(new TextDecoder().decode(document.bytes), /PLANO DE CUIDADOS/);
  assert.equal(bucket.puts, 1);
  const unrelated = await repository.startDemo({ scenario: "setup", role: "caregiver" });
  await assert.rejects(repository.getDocument(unrelated.token, document.reference.id), status(404));
  await assert.rejects(repository.getDocument(undefined, document.reference.id), status(401));
  await assert.rejects(repository.getState(demo.token, { demoId: unrelated.state.demoId, role: "patient" }), status(409));
  const key = String(db.sqlite.prepare("SELECT file_name FROM documents WHERE id = ?").get(document.reference.id)!.file_name);
  bucket.objects.set(key, new Uint8Array([1, 2, 3]));
  await assert.rejects(repository.getDocument(demo.token, document.reference.id), status(409));
  setTime("2026-10-24T15:00:00.001Z");
  await assert.rejects(repository.getState(demo.token), status(401));
});

test("concurrent duplicate requests commit one operation and audit; independent writes are retained", async (t) => {
  const { repository, second, db } = fixture(t);
  const demo = await repository.startDemo({ scenario: "ready", role: "patient" });
  const action = { type: "record_task", taskId: demo.state.tasks[0].id, status: "done", requestId: req() };
  const states = await Promise.all([repository.mutate(demo.token, action), second.mutate(demo.token, action)]);
  assert.ok(db.lostSwaps > 0);
  assert.ok(states.every((state) => state.revision === demo.state.revision + 1));
  assert.equal(db.count("operations"), 1);
  assert.equal(db.count("audit_events", "event_type = 'record_task'"), 1);
  await assert.rejects(repository.mutate(demo.token, { ...action, status: "not_done" }), status(409));
  await Promise.all([
    repository.mutate(demo.token, { type: "request_help", message: "Primeiro pedido", urgent: false, requestId: req() }),
    second.mutate(demo.token, { type: "request_help", message: "Segundo pedido", urgent: false, requestId: req() }),
  ]);
  assert.equal((await repository.getState(demo.token)).helpRequests.length, 2);
  assert.equal(db.count("operations"), 3);
});

test("an audit failure rolls back state and operation atomically", async (t) => {
  const { repository, db } = fixture(t);
  const demo = await repository.startDemo({ scenario: "ready", role: "patient" });
  const action = { type: "record_task", taskId: demo.state.tasks[0].id, status: "done", requestId: req() };
  db.failNextAudit = true;
  await assert.rejects(repository.mutate(demo.token, action), /Injected audit failure/);
  assert.equal((await repository.getState(demo.token)).revision, demo.state.revision);
  assert.equal(db.count("operations"), 0);
  assert.equal(db.count("audit_events", "event_type = 'record_task'"), 0);
  assert.equal((await repository.mutate(demo.token, action)).revision, demo.state.revision + 1);
});

test("logout during a write prevents the stale authorized snapshot from committing", async (t) => {
  const { repository, db } = fixture(t);
  const demo = await repository.startDemo({ scenario: "ready", role: "patient" });
  db.beforeNextBatch = () => { db.sqlite.exec("DELETE FROM demo_sessions"); };
  await assert.rejects(repository.mutate(demo.token, { type: "record_task", taskId: demo.state.tasks[0].id, status: "done", requestId: req() }), status(401));
  assert.equal(db.count("operations"), 0);
  const state = JSON.parse(String(db.sqlite.prepare("SELECT state_json FROM care_cases").get()!.state_json));
  assert.equal(state.revision, demo.state.revision);
});

test("exhausted document CAS retries do not repeat R2 uploads or commit metadata", async (t) => {
  const { repository, db, bucket } = fixture(t);
  await repository.startDemo({ scenario: "setup", role: "caregiver" }).then(async (demo) => {
    let conflicts = 0;
    const changeSnapshot = () => {
      const row = db.sqlite.prepare("SELECT state_json FROM care_cases WHERE id = ?").get(demo.state.demoId)!;
      const state = JSON.parse(String(row.state_json));
      state.revision += 1;
      db.sqlite.prepare("UPDATE care_cases SET state_json = ? WHERE id = ?").run(JSON.stringify(state), demo.state.demoId);
      conflicts += 1;
      db.beforeNextBatch = changeSnapshot;
    };
    db.beforeNextBatch = changeSnapshot;
    await assert.rejects(repository.storeDocument(demo.token, { name: "fonte.txt", mimeType: "text/plain", bytes: new TextEncoder().encode("Orientação de teste.") }), status(409));
    assert.equal(conflicts, 8);
    assert.equal(bucket.puts, 1);
    assert.equal(db.count("documents"), 0);
  });
});

test("accounts register, log in, log out, and cannot be joined through a demo link", async (t) => {
  const { repository, second, db } = fixture(t);
  const input = { name: "Marina", email: "marina@example.com", password: "test-password-123" };
  const outcomes = await Promise.allSettled([repository.register(input), second.register(input)]);
  const created = outcomes.find((result) => result.status === "fulfilled");
  assert.ok(created && created.status === "fulfilled");
  const rejected = outcomes.find((result) => result.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected" && status(409)(rejected.reason));
  assert.equal(db.count("accounts"), 1);
  assert.equal(db.count("care_cases"), 1);
  await assert.rejects(repository.startDemo({ scenario: "ready", role: "patient", demoId: created.value.state.demoId }), status(404));
  await repository.logout(created.value.token);
  await assert.rejects(repository.getState(created.value.token), status(401));
  await assert.rejects(repository.login({ email: input.email, password: "wrong-password" }), status(401));
  const loggedIn = await second.login({ email: input.email, password: input.password });
  assert.equal(loggedIn.state.demoId, created.value.state.demoId);
  assert.equal(loggedIn.state.account!.email, input.email);
  assert.equal(db.count("login_attempts"), 0);
});

test("concurrent login attempts cannot exceed the configured window", async (t) => {
  const { repository, second, db, setTime } = fixture(t);
  const input = { email: "missing@example.com", password: "wrong-password" };
  const attempts = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => (index % 2 ? repository : second).login(input)));
  assert.equal(attempts.filter((result) => result.status === "rejected" && status(429)(result.reason)).length, 2);
  assert.equal(Number(db.sqlite.prepare("SELECT attempts FROM login_attempts").get()!.attempts), 10);
  setTime("2026-10-23T15:15:00.001Z");
  await assert.rejects(repository.login(input), status(401));
  assert.equal(Number(db.sqlite.prepare("SELECT attempts FROM login_attempts").get()!.attempts), 1);
});

test("private import, review, no-op deduplication, activation and day rollover preserve domain behavior", async (t) => {
  const { repository, second, db, bucket, setTime } = fixture(t);
  const demo = await repository.startDemo({ scenario: "setup", role: "caregiver" });
  const bytes = new TextEncoder().encode("Beber água às 12:00 conforme a orientação recebida.");
  const document = await repository.storeDocument(demo.token, { name: "orientacao.txt", mimeType: "text/plain", bytes });
  assert.equal(bucket.puts, 1);
  const extraction: ExtractionResult = { items: [{ id: req(), title: "Água", category: "nutrition", instruction: "Beber água conforme a orientação recebida.", fields: { orientação: { value: "Beber água", state: "readable", sourceText: "Beber água" } }, source: { documentId: null, page: 1, quote: "Beber água às 12:00 conforme a orientação recebida." }, questions: [], confirmed: false }], unresolved: [], warnings: [] };
  let state = await second.importDraft(demo.token, document, extraction);
  assert.equal(state.document!.id, document.id);
  const item = state.plan.items[0];
  state = await repository.mutate(demo.token, { type: "update_item", itemId: item.id, title: item.title, instruction: item.instruction, fields: item.fields, questions: [], schedule: { times: ["12:00"], priority: "normal", toleranceMinutes: 30, period: { startDate: "2026-10-23", endDate: null }, recurrence: { kind: "daily" } }, requestId: req() });
  await repository.mutate(demo.token, { type: "confirm_item", itemId: item.id, requestId: req() });
  const noOp = { type: "confirm_item", itemId: item.id, requestId: req() };
  await Promise.all([repository.mutate(demo.token, noOp), second.mutate(demo.token, noOp)]);
  assert.equal(db.count("operations", `request_id = '${noOp.requestId}'`), 1);
  await repository.mutate(demo.token, { type: "confirm_source_pages", requestId: req() });
  state = await repository.mutate(demo.token, { type: "activate_plan", requestId: req() });
  assert.equal(state.plan.status, "active");
  assert.equal(state.tasks.length, 1);
  await assert.rejects(repository.storeDocument(demo.token, { name: "novo.txt", mimeType: "text/plain", bytes }), status(409));
  assert.equal(bucket.puts, 1);
  setTime("2026-10-24T14:00:00.000Z");
  const [next, same] = await Promise.all([repository.getState(demo.token), second.getState(demo.token)]);
  assert.equal(next.tasks.length, 1);
  assert.equal(next.tasks[0].id, same.tasks[0].id);
  assert.equal(next.revision, state.revision + 1);
  assert.equal(same.revision, next.revision);
});
