import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { CareSessionContext, CareState, DocumentRef, ExtractionResult, Role } from "../../src/lib/contracts";
import { hasExecutableTimes, withProposedTimes } from "../../src/lib/schedule-times";
import { scheduledOnDate } from "../../src/lib/schedule-period";
import { appendEvent, applyAction, assertSessionContext, CareError, dateInBrazil, demoSchema, ensureTodayTasks, parseAction, parseExtraction, requireCaregiver, requireDraft, type StoredState, type StoredTask } from "../../src/lib/server/care-domain";
import { createDemoState, demoSource } from "../../src/lib/server/care-demo";
import { hashPassword, parseLogin, parseRegistration, verifyPassword } from "../../src/lib/server/care-auth";

export { CareError } from "../../src/lib/server/care-domain";

type Row = Record<string, unknown>;
export interface CloudD1Result<T = Row> {
  results: T[];
  success: boolean;
  error?: string;
  meta?: { changes?: number };
}
export interface CloudD1Statement {
  bind(...values: unknown[]): CloudD1Statement;
  first<T = Row>(): Promise<T | null>;
  all<T = Row>(): Promise<CloudD1Result<T>>;
}
export interface CloudD1Database {
  prepare(sql: string): CloudD1Statement;
  batch<T = Row>(statements: CloudD1Statement[]): Promise<CloudD1Result<T>[]>;
  withSession?(constraint: "first-primary"): CloudD1Database;
}
export interface CloudR2Bucket {
  put(key: string, value: Uint8Array, options?: { sha256?: string; httpMetadata?: { contentType: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

type Session = { caseId: string; role: Role; state: StoredState; stateJson: string; account?: CareState["account"] };
type DocumentInput = { name: string; mimeType: string; bytes: Uint8Array };
type StoredDocument = { reference: DocumentRef; caseId: string; key: string; sha256: string; byteLength: number };
const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const MAX_LOGIN_ATTEMPTS = 10;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_CAS_ATTEMPTS = 8;

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function publicState(state: StoredState, role: Role, now: Date, account?: CareState["account"]): CareState {
  const date = dateInBrazil(now);
  const taskHistory = new Map(state.tasks.map((task) => [task.id, task]));
  const helpRequests = state.helpRequests.map((help) => {
    const task = help.taskId ? taskHistory.get(help.taskId) : undefined;
    return { ...help, task: task ? { itemId: task.itemId, title: task.title, instruction: task.instruction, time: task.time, referenceDate: task.referenceDate ?? null } : null };
  });
  const tasks = state.tasks.filter((task) => {
    if ((task as StoredTask).referenceDate !== date) return false;
    return task.status !== "pending" || state.plan.items.some((item) => item.id === task.itemId && scheduledOnDate(item, date) && hasExecutableTimes(item));
  }).sort((a, b) => a.time.localeCompare(b.time));
  return structuredClone({ ...state, ...(account ? { account } : {}), role, tasks, helpRequests });
}

/** D1 owns state and authorization; a private R2 binding owns original documents. */
export class CloudCareRepository {
  private readonly clock: () => Date;

  constructor(private readonly db: CloudD1Database, private readonly bucket: CloudR2Bucket, options: { now?: () => Date } = {}) {
    this.clock = options.now ?? (() => new Date());
  }

  // A fresh primary read is needed on each optimistic retry, including when
  // a deployment enables D1 read replicas. No schema is created by requests.
  private database(): CloudD1Database {
    return this.db.withSession?.("first-primary") ?? this.db;
  }

  private statement(db: CloudD1Database, sql: string, ...args: unknown[]): CloudD1Statement {
    return db.prepare(sql).bind(...args);
  }

  private async batch(db: CloudD1Database, statements: CloudD1Statement[]): Promise<CloudD1Result[]> {
    const results = await db.batch(statements);
    const failed = results.find((result) => !result.success);
    if (failed) throw new Error(failed.error ?? "Falha na transação do cuidado.");
    return results;
  }

  private async session(db: CloudD1Database, token: string | undefined, expected?: CareSessionContext): Promise<Session> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new CareError("Entre para continuar.", 401);
    const tokenHash = hash(token);
    const now = this.clock().toISOString();
    const account = await this.statement(db, "SELECT a.id, a.email, a.name, a.case_id, c.state_json FROM account_sessions s JOIN accounts a ON a.id = s.account_id JOIN care_cases c ON c.id = a.case_id WHERE s.token_hash = ? AND s.expires_at > ?", tokenHash, now).first();
    let session: Session;
    if (account) {
      const stateJson = String(account.state_json);
      session = { caseId: String(account.case_id), role: "caregiver", stateJson, state: JSON.parse(stateJson) as StoredState, account: { id: String(account.id), name: String(account.name), email: String(account.email) } };
    } else {
      const row = await this.statement(db, "SELECT s.case_id, s.role, c.state_json FROM demo_sessions s JOIN care_cases c ON c.id = s.case_id LEFT JOIN accounts a ON a.case_id = c.id WHERE s.token_hash = ? AND s.expires_at > ? AND a.id IS NULL", tokenHash, now).first();
      if (!row) throw new CareError("Sessão expirada. Entre novamente.", 401);
      const stateJson = String(row.state_json);
      session = { caseId: String(row.case_id), role: row.role as Role, stateJson, state: JSON.parse(stateJson) as StoredState };
    }
    assertSessionContext({ demoId: session.caseId, role: session.role }, expected);
    return session;
  }

  private audit(db: CloudD1Database, caseId: string, role: Role, type: string, before: StoredState | null, after: StoredState, requestId: string | null = null): CloudD1Statement {
    return this.statement(db, "INSERT INTO audit_events (id, case_id, role, event_type, request_id, created_at, before_json, after_json) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0", randomUUID(), caseId, role, type, requestId, this.clock().toISOString(), before === null ? null : JSON.stringify(before), JSON.stringify(after));
  }

  private async compareAndSwap(db: CloudD1Database, session: Session, token: string, following: CloudD1Statement[] = [], requestId: string | null = null): Promise<boolean> {
    const tokenHash = hash(token);
    const now = this.clock().toISOString();
    // Every following statement must preserve the changes()>0 chain. A lost
    // compare-and-swap therefore writes neither an operation nor an audit row.
    // Authorization is checked again in the atomic batch, covering logout races.
    const update = this.statement(db, `UPDATE care_cases SET state_json = ? WHERE id = ? AND state_json = ? AND (
      EXISTS (SELECT 1 FROM account_sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ? AND a.case_id = care_cases.id)
      OR EXISTS (SELECT 1 FROM demo_sessions s WHERE s.token_hash = ? AND s.expires_at > ? AND s.case_id = care_cases.id AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.case_id = care_cases.id))
    ) AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM operations WHERE case_id = care_cases.id AND request_id = ?))
    RETURNING id`, JSON.stringify(session.state), session.caseId, session.stateJson, tokenHash, now, tokenHash, now, requestId, requestId);
    const results = await this.batch(db, [update, ...following]);
    return results[0].results.length === 1;
  }

  private conflict(): never {
    throw new CareError("O cuidado mudou durante a gravação. Tente novamente.", 409);
  }

  private sessionInsert(db: CloudD1Database, kind: "demo" | "account", token: string, ownerId: string, role?: Role): CloudD1Statement {
    const expiresAt = new Date(this.clock().getTime() + SESSION_LIFETIME_MS).toISOString();
    return kind === "demo"
      ? this.statement(db, "INSERT INTO demo_sessions (token_hash, case_id, role, expires_at) SELECT ?, ?, ?, ? WHERE changes() > 0", hash(token), ownerId, role, expiresAt)
      : this.statement(db, "INSERT INTO account_sessions (token_hash, account_id, expires_at) SELECT ?, ?, ? WHERE changes() > 0", hash(token), ownerId, expiresAt);
  }

  async startDemo(input: unknown): Promise<{ token: string; state: CareState }> {
    const parsed = demoSchema.safeParse(input);
    if (!parsed.success) throw new CareError("Escolha um perfil válido para continuar.");
    const { scenario, role, demoId } = parsed.data;
    const token = randomBytes(32).toString("base64url");
    if (demoId) {
      for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
        const db = this.database();
        const row = await this.statement(db, "SELECT c.state_json FROM care_cases c LEFT JOIN accounts a ON a.case_id = c.id WHERE c.id = ? AND a.id IS NULL", demoId).first();
        if (!row) throw new CareError("Acompanhamento não encontrado.", 404);
        const stateJson = String(row.state_json);
        const state = JSON.parse(stateJson) as StoredState;
        const now = this.clock();
        ensureTodayTasks(state, now);
        const result = await this.batch(db, [
          this.statement(db, "UPDATE care_cases SET state_json = ? WHERE id = ? AND state_json = ? AND NOT EXISTS (SELECT 1 FROM accounts WHERE case_id = ?) RETURNING id", JSON.stringify(state), demoId, stateJson, demoId),
          this.sessionInsert(db, "demo", token, demoId, role),
        ]);
        if (result[0].results.length) return { token, state: publicState(state, role, now) };
      }
      return this.conflict();
    }
    const caseId = randomUUID();
    const document = scenario === "ready" ? await this.uploadDocument(caseId, { name: "plano-de-cuidados.txt", mimeType: "text/plain", bytes: new TextEncoder().encode(demoSource) }, 1) : null;
    const now = this.clock();
    const state = createDemoState(caseId, scenario, document?.reference ?? null, now);
    const db = this.database();
    await this.batch(db, [
      this.statement(db, "INSERT INTO care_cases (id, state_json) VALUES (?, ?)", caseId, JSON.stringify(state)),
      ...(document ? [this.documentInsert(db, document)] : []),
      this.audit(db, caseId, role, "demo_created", null, state),
      this.sessionInsert(db, "demo", token, caseId, role),
    ]);
    return { token, state: publicState(state, role, now) };
  }

  async register(input: unknown): Promise<{ token: string; state: CareState }> {
    const { name, email, password } = parseRegistration(input);
    const db = this.database();
    if (await this.statement(db, "SELECT id FROM accounts WHERE email = ?", email).first()) throw new CareError("Já existe uma conta com este e-mail. Entre com sua senha.", 409);
    const passwordRecord = await hashPassword(password);
    const now = this.clock();
    const account = { id: randomUUID(), name, email };
    const state = createDemoState(randomUUID(), "setup", null, now);
    state.patient = { name: "Pessoa cuidada", caregiverName: name };
    state.timeline = [];
    const token = randomBytes(32).toString("base64url");
    try {
      await this.batch(db, [
        this.statement(db, "INSERT INTO care_cases (id, state_json) VALUES (?, ?)", state.demoId, JSON.stringify(state)),
        this.statement(db, "INSERT INTO accounts (id, email, name, password_salt, password_hash, case_id, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0", account.id, email, name, passwordRecord.salt, passwordRecord.hash, state.demoId, now.toISOString()),
        this.audit(db, state.demoId, "caregiver", "account_created", null, state),
        this.sessionInsert(db, "account", token, account.id),
      ]);
    } catch (error) {
      if (/accounts\.email/i.test(String(error))) throw new CareError("Já existe uma conta com este e-mail. Entre com sua senha.", 409);
      throw error;
    }
    return { token, state: publicState(state, "caregiver", now, account) };
  }

  async login(input: unknown): Promise<{ token: string; state: CareState }> {
    const { email, password } = parseLogin(input);
    const emailHash = hash(email);
    const now = this.clock();
    const cutoff = new Date(now.getTime() - LOGIN_WINDOW_MS).toISOString();
    const db = this.database();
    // A single conditional UPSERT prevents concurrent attempts losing increments.
    const allowed = await this.statement(db, `INSERT INTO login_attempts (email_hash, attempts, window_started_at) VALUES (?, 1, ?)
      ON CONFLICT(email_hash) DO UPDATE SET
        attempts = CASE WHEN window_started_at <= ? THEN 1 ELSE attempts + 1 END,
        window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END
      WHERE window_started_at <= ? OR attempts < ? RETURNING email_hash`, emailHash, now.toISOString(), cutoff, cutoff, cutoff, MAX_LOGIN_ATTEMPTS).all();
    if (!allowed.results.length) throw new CareError("Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.", 429);
    const account = await this.statement(db, "SELECT id, password_salt, password_hash FROM accounts WHERE email = ?", email).first();
    const valid = await verifyPassword(password, account ? String(account.password_salt) : undefined, account ? String(account.password_hash) : undefined);
    if (!valid || !account) throw new CareError("E-mail ou senha inválidos.", 401);
    const token = randomBytes(32).toString("base64url");
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const currentDb = this.database();
      const row = await this.statement(currentDb, "SELECT a.id, a.name, a.email, a.case_id, c.state_json FROM accounts a JOIN care_cases c ON c.id = a.case_id WHERE a.id = ?", account.id).first();
      if (!row) throw new CareError("E-mail ou senha inválidos.", 401);
      const stateJson = String(row.state_json);
      const state = JSON.parse(stateJson) as StoredState;
      const currentTime = this.clock();
      ensureTodayTasks(state, currentTime);
      const result = await this.batch(currentDb, [
        this.statement(currentDb, "UPDATE care_cases SET state_json = ? WHERE id = ? AND state_json = ? AND EXISTS (SELECT 1 FROM accounts WHERE id = ? AND case_id = care_cases.id) RETURNING id", JSON.stringify(state), row.case_id, stateJson, account.id),
        this.sessionInsert(currentDb, "account", token, String(account.id)),
        this.statement(currentDb, "DELETE FROM login_attempts WHERE email_hash = ? AND changes() > 0", emailHash),
      ]);
      if (result[0].results.length) return { token, state: publicState(state, "caregiver", currentTime, { id: String(row.id), name: String(row.name), email: String(row.email) }) };
    }
    return this.conflict();
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const db = this.database();
    await this.batch(db, [
      this.statement(db, "DELETE FROM account_sessions WHERE token_hash = ?", hash(token)),
      this.statement(db, "DELETE FROM demo_sessions WHERE token_hash = ?", hash(token)),
    ]);
  }

  async getState(token: string | undefined, expected?: CareSessionContext): Promise<CareState> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const db = this.database();
      const session = await this.session(db, token, expected);
      const now = this.clock();
      if (!ensureTodayTasks(session.state, now)) return publicState(session.state, session.role, now, session.account);
      session.state.updatedAt = now.toISOString();
      session.state.revision += 1;
      if (await this.compareAndSwap(db, session, token!)) return publicState(session.state, session.role, now, session.account);
    }
    return this.conflict();
  }

  async mutate(token: string | undefined, input: unknown, expected?: CareSessionContext): Promise<CareState> {
    const action = parseAction(input);
    const fingerprint = hash(stableJson(action));
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const db = this.database();
      const session = await this.session(db, token, expected);
      const previous = await this.statement(db, "SELECT role, fingerprint FROM operations WHERE case_id = ? AND request_id = ?", session.caseId, action.requestId).first();
      if (previous) {
        if (previous.role !== session.role || previous.fingerprint !== fingerprint) throw new CareError("Este identificador de envio já foi usado para outra ação.", 409);
        const latest = await this.session(this.database(), token, expected);
        return publicState(latest.state, latest.role, this.clock(), latest.account);
      }
      const before = structuredClone(session.state);
      const now = this.clock();
      ensureTodayTasks(session.state, now);
      applyAction(session.state, session.role, action, now);
      if (await this.compareAndSwap(db, session, token!, [
        this.statement(db, "INSERT INTO operations (case_id, request_id, role, fingerprint, created_at) SELECT ?, ?, ?, ?, ? WHERE changes() > 0", session.caseId, action.requestId, session.role, fingerprint, now.toISOString()),
        this.audit(db, session.caseId, session.role, action.type, before, session.state, action.requestId),
      ], action.requestId)) return publicState(session.state, session.role, now, session.account);
    }
    return this.conflict();
  }

  private async uploadDocument(caseId: string, input: DocumentInput, pageCount: number | null): Promise<StoredDocument> {
    const bytes = new Uint8Array(input.bytes);
    const mimeType = input.mimeType.toLowerCase().split(";")[0].trim();
    if (!input.name.trim() || input.name.length > 255 || /[\x00-\x1f]/.test(input.name)) throw new CareError("Nome de arquivo inválido.");
    if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES) throw new CareError("O arquivo deve ter entre 1 byte e 15 MB.", 413);
    const signatures: Record<string, number[]> = { "application/pdf": [0x25, 0x50, 0x44, 0x46, 0x2d], "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image/jpeg": [0xff, 0xd8, 0xff] };
    if (mimeType !== "text/plain" && (!signatures[mimeType] || !signatures[mimeType].every((value, index) => bytes[index] === value))) throw new CareError("Envie um PDF, JPEG, PNG válido ou texto.", 415);
    if (mimeType === "text/plain") {
      try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new CareError("O texto deve usar UTF-8."); }
    }
    const id = randomUUID();
    const key = `documents/${caseId}/${id}.bin`;
    const sha256 = hash(bytes);
    const stored = await this.bucket.put(key, bytes, { sha256, httpMetadata: { contentType: mimeType } });
    if (!stored) throw new Error("Não foi possível armazenar o documento original.");
    const name = input.name.split(/[\\/]/).pop()!.trim();
    return { caseId, key, sha256, byteLength: bytes.byteLength, reference: { id, name, mimeType, url: `/api/documents/${id}`, pageCount } };
  }

  private documentInsert(db: CloudD1Database, document: StoredDocument): CloudD1Statement {
    const { reference } = document;
    return this.statement(db, "INSERT INTO documents (id, case_id, name, mime_type, file_name, sha256, byte_length, page_count) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0", reference.id, document.caseId, reference.name, reference.mimeType, document.key, document.sha256, document.byteLength, reference.pageCount);
  }

  async storeDocument(token: string | undefined, input: DocumentInput, expected?: CareSessionContext): Promise<DocumentRef> {
    const initial = await this.session(this.database(), token, expected);
    requireCaregiver(initial.role);
    requireDraft(initial.state);
    // R2 is outside the CAS retry. A failed/ambiguous D1 write may leave a
    // private unreferenced object, never a missing committed original or a
    // repeated upload. Do not delete it after an uncertain commit.
    const document = await this.uploadDocument(initial.caseId, input, input.mimeType === "text/plain" || input.mimeType.startsWith("image/") ? 1 : null);
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const db = this.database();
      const session = await this.session(db, token, expected);
      requireCaregiver(session.role);
      requireDraft(session.state);
      if (session.caseId !== document.caseId) throw new CareError("O acompanhamento mudou. Envie o documento novamente.", 409);
      if (await this.compareAndSwap(db, session, token!, [this.documentInsert(db, document)])) return document.reference;
    }
    return this.conflict();
  }

  async importDraft(token: string | undefined, document: DocumentRef, extraction: ExtractionResult, expected?: CareSessionContext): Promise<CareState> {
    const parsed = parseExtraction(extraction);
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const db = this.database();
      const session = await this.session(db, token, expected);
      requireCaregiver(session.role);
      requireDraft(session.state);
      const row = await this.statement(db, "SELECT id, name, mime_type, page_count FROM documents WHERE id = ? AND case_id = ?", document.id, session.caseId).first();
      if (!row) throw new CareError("Documento não encontrado neste cuidado.", 404);
      const pageCount = Number.isInteger(document.pageCount) && document.pageCount! > 0 ? document.pageCount : row.page_count === null ? null : Number(row.page_count);
      if (pageCount !== null && pageCount > 10_000) throw new CareError("Quantidade de páginas inválida.");
      const before = structuredClone(session.state);
      session.state.document = { id: document.id, name: String(row.name), mimeType: String(row.mime_type), pageCount, url: `/api/documents/${document.id}` };
      session.state.plan = { status: "draft", items: parsed.items.map((item) => withProposedTimes({ ...item, id: randomUUID(), confirmed: false, schedule: undefined, source: { ...item.source, documentId: document.id } })), sourceReviewed: false, unresolved: parsed.unresolved.length || parsed.items.length ? parsed.unresolved : ["Nenhum cuidado foi identificado. Confira a leitura ou envie outra fonte."], warnings: parsed.warnings };
      session.state.tasks = [];
      appendEvent(session.state, session.role, this.clock().toISOString(), `Novo documento recebido: “${session.state.document.name}”. O rascunho precisa de conferência humana; nenhuma orientação foi ativada.`);
      if (await this.compareAndSwap(db, session, token!, [
        this.statement(db, "UPDATE documents SET page_count = ? WHERE id = ? AND case_id = ? AND changes() > 0", pageCount, document.id, session.caseId),
        this.audit(db, session.caseId, session.role, "import_draft", before, session.state),
      ])) return publicState(session.state, session.role, this.clock(), session.account);
    }
    return this.conflict();
  }

  async getDocument(token: string | undefined, id: string): Promise<{ reference: DocumentRef; bytes: Uint8Array }> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new CareError("Documento não encontrado.", 404);
    const db = this.database();
    const { caseId } = await this.session(db, token);
    const row = await this.statement(db, "SELECT id, name, mime_type, file_name, page_count, sha256, byte_length FROM documents WHERE id = ? AND case_id = ?", id, caseId).first();
    if (!row) throw new CareError("Documento não encontrado neste cuidado.", 404);
    const object = await this.bucket.get(String(row.file_name));
    if (!object) throw new CareError("O documento original não está disponível. Envie o arquivo novamente.", 409);
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.byteLength !== Number(row.byte_length) || hash(bytes) !== row.sha256) throw new CareError("O original não passou na verificação de integridade. Envie o arquivo novamente.", 409);
    return { reference: { id, name: String(row.name), mimeType: String(row.mime_type), pageCount: row.page_count === null ? null : Number(row.page_count), url: `/api/documents/${id}` }, bytes };
  }

  async close(): Promise<void> {
    // D1/R2 bindings are owned by the Worker runtime and have no local handles.
  }
}
