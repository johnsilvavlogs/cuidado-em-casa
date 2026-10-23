import { hasExecutableTimes, withProposedTimes } from "../schedule-times";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type Client, type Transaction } from "@libsql/client";
import type { CareSessionContext, CareState, DocumentRef, ExtractionResult, Role } from "../contracts";
import { appendEvent, applyAction, assertSessionContext, CareError, dateInBrazil, demoSchema, ensureTodayTasks, parseAction, parseExtraction, requireCaregiver, requireDraft, type StoredState, type StoredTask } from "./care-domain";
import { scheduledOnDate } from "../schedule-period";
import { createDemoState, demoSource } from "./care-demo";
import { hashPassword, parseLogin, parseRegistration, verifyPassword } from "./care-auth";

export { CareError } from "./care-domain";

const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const MAX_LOGIN_ATTEMPTS = 10;
const SQLITE_BUSY_TIMEOUT_MS = 1_000;
const SQLITE_ACQUIRE_LIMIT_MS = 5_000;
// Next route bundles and separate repository instances share one in-process queue per file.
const localQueues = (globalThis as typeof globalThis & { careSqliteQueues?: Map<string, Promise<void>> }).careSqliteQueues ??= new Map<string, Promise<void>>();

async function acquireWhenAvailable<T>(operation: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + SQLITE_ACQUIRE_LIMIT_MS;
  for (;;) {
    try { return await operation(); }
    catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "SQLITE_BUSY") || Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
}
type Session = { caseId: string; role: Role; state: StoredState; account?: CareState["account"] };
type DocumentInput = { name: string; mimeType: string; bytes: Uint8Array };
type SqlExecutor = Pick<Client, "execute"> | Pick<Transaction, "execute">;

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
  // Hide invalid pending occurrences without deleting the original records or audit.
  const tasks = state.tasks.filter((task) => {
    if ((task as StoredTask).referenceDate !== date) return false;
    return task.status !== "pending" || state.plan.items.some((item) => item.id === task.itemId && scheduledOnDate(item, date) && hasExecutableTimes(item));
  }).sort((a, b) => a.time.localeCompare(b.time));
  return structuredClone({ ...state, ...(account ? { account } : {}), role, tasks });
}

/** Local persistence for isolated accounts and synthetic, shareable demo cases. */
export class CareRepository {
  private clientPromise: Promise<Client> | undefined;
  private queue: Promise<void> = Promise.resolve();
  private readonly directory: string;
  private readonly clock: () => Date;

  constructor(options: { dataDir?: string; now?: () => Date } = {}) {
    this.directory = path.resolve(options.dataDir ?? path.join(process.cwd(), ".data"));
    this.clock = options.now ?? (() => new Date());
  }

  private async database(): Promise<Client> {
    this.clientPromise ??= (async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await chmod(this.directory, 0o700);
      const databasePath = path.join(this.directory, "care.sqlite");
      const client = createClient({ url: pathToFileURL(databasePath).href, concurrency: 1, timeout: SQLITE_BUSY_TIMEOUT_MS });
      try {
      await acquireWhenAvailable(() => client.executeMultiple(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS care_cases (id TEXT PRIMARY KEY, state_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS demo_sessions (token_hash TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES care_cases(id), role TEXT NOT NULL CHECK(role IN ('patient', 'caregiver')), expires_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, case_id TEXT NOT NULL UNIQUE REFERENCES care_cases(id), created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS account_sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS login_attempts (email_hash TEXT PRIMARY KEY, attempts INTEGER NOT NULL, window_started_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES care_cases(id), name TEXT NOT NULL, mime_type TEXT NOT NULL, file_name TEXT NOT NULL, sha256 TEXT NOT NULL, byte_length INTEGER NOT NULL, page_count INTEGER);
        CREATE TABLE IF NOT EXISTS operations (case_id TEXT NOT NULL REFERENCES care_cases(id), request_id TEXT NOT NULL, role TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(case_id, request_id));
        CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES care_cases(id), role TEXT NOT NULL, event_type TEXT NOT NULL, request_id TEXT, created_at TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS account_session_account ON account_sessions(account_id);
        CREATE INDEX IF NOT EXISTS session_case ON demo_sessions(case_id);
        CREATE INDEX IF NOT EXISTS document_case ON documents(case_id);
        CREATE INDEX IF NOT EXISTS audit_case ON audit_events(case_id, created_at);
      `));
      await chmod(databasePath, 0o600);
      return client;
      } catch (error) { client.close(); throw error; }
    })().catch(error => {
      // A transient lock during startup must not poison every later request.
      this.clientPromise = undefined;
      throw error;
    });
    return this.clientPromise;
  }

  private async serialized<T>(work: () => Promise<T>): Promise<T> {
    const key = path.join(this.directory, "care.sqlite");
    const previous = localQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    localQueues.set(key, pending);
    this.queue = pending;
    await previous;
    try { return await work(); }
    finally {
      release();
      if (localQueues.get(key) === pending) localQueues.delete(key);
    }
  }

  private async transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.serialized(async () => {
      const client = await this.database();
      // Only BEGIN acquisition is retried. The callback and COMMIT are never replayed.
      const transaction = await acquireWhenAvailable(() => client.transaction("write"));
      try {
        const result = await work(transaction);
        try { await transaction.commit(); }
        catch (error) {
          // Roll back before closing a native handle: close alone can leave an
          // active transaction locked while outstanding statements retain it.
          try { if (!transaction.closed) await transaction.rollback(); } catch { /* preserve the commit error */ }
          try { transaction.close(); } catch { /* the client is discarded below */ }
          client.close();
          this.clientPromise = undefined;
          throw error;
        }
        return result;
      } finally {
        try { transaction.close(); }
        catch (error) {
          client.close();
          this.clientPromise = undefined;
          throw error;
        }
      }
    });
  }

  private async session(executor: SqlExecutor, token: string | undefined): Promise<Session> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new CareError("Entre para continuar.", 401);
    const tokenHash = hash(token);
    const now = this.clock().toISOString();
    const accountResult = await executor.execute({ sql: "SELECT a.id, a.email, a.name, a.case_id, c.state_json FROM account_sessions s JOIN accounts a ON a.id = s.account_id JOIN care_cases c ON c.id = a.case_id WHERE s.token_hash = ? AND s.expires_at > ?", args: [tokenHash, now] });
    const account = accountResult.rows[0];
    if (account) return { caseId: String(account.case_id), role: "caregiver", state: JSON.parse(String(account.state_json)) as StoredState, account: { id: String(account.id), name: String(account.name), email: String(account.email) } };
    const result = await executor.execute({ sql: "SELECT s.case_id, s.role, c.state_json FROM demo_sessions s JOIN care_cases c ON c.id = s.case_id LEFT JOIN accounts a ON a.case_id = c.id WHERE s.token_hash = ? AND s.expires_at > ? AND a.id IS NULL", args: [tokenHash, now] });
    const row = result.rows[0];
    if (!row) throw new CareError("Sessão expirada. Entre novamente.", 401);
    return { caseId: String(row.case_id), role: row.role as Role, state: JSON.parse(String(row.state_json)) as StoredState };
  }

  private async boundSession(executor: SqlExecutor, token: string | undefined, expected?: CareSessionContext): Promise<Session> {
    const session = await this.session(executor, token);
    assertSessionContext({ demoId: session.caseId, role: session.role }, expected);
    return session;
  }

  private async save(executor: SqlExecutor, state: StoredState): Promise<void> {
    await executor.execute({ sql: "UPDATE care_cases SET state_json = ? WHERE id = ?", args: [JSON.stringify(state), state.demoId] });
  }

  private async audit(executor: SqlExecutor, caseId: string, role: Role, type: string, before: StoredState | null, after: StoredState, requestId: string | null = null): Promise<void> {
    await executor.execute({ sql: "INSERT INTO audit_events (id, case_id, role, event_type, request_id, created_at, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", args: [randomUUID(), caseId, role, type, requestId, this.clock().toISOString(), before === null ? null : JSON.stringify(before), JSON.stringify(after)] });
  }

  async startDemo(input: unknown): Promise<{ token: string; state: CareState }> {
    const parsed = demoSchema.safeParse(input);
    if (!parsed.success) throw new CareError("Escolha um perfil válido para continuar.");
    const { scenario, role, demoId } = parsed.data;
    return this.transaction(async (transaction) => {
      const now = this.clock();
      const caseId = demoId ?? randomUUID();
      let state: StoredState;
      if (demoId) {
        const existing = await transaction.execute({ sql: "SELECT c.state_json FROM care_cases c LEFT JOIN accounts a ON a.case_id = c.id WHERE c.id = ? AND a.id IS NULL", args: [caseId] });
        if (!existing.rows[0]) throw new CareError("Acompanhamento não encontrado.", 404);
        state = JSON.parse(String(existing.rows[0].state_json)) as StoredState;
      } else {
        state = createDemoState(caseId, "setup", null, now);
        await transaction.execute({ sql: "INSERT INTO care_cases (id, state_json) VALUES (?, ?)", args: [caseId, JSON.stringify(state)] });
        const document = scenario === "ready" ? await this.writeDocument(transaction, caseId, { name: "plano-de-cuidados.txt", mimeType: "text/plain", bytes: new TextEncoder().encode(demoSource) }, 1) : null;
        state = createDemoState(caseId, scenario, document, now);
        await this.save(transaction, state);
        await this.audit(transaction, caseId, role, "demo_created", null, state);
      }
      if (ensureTodayTasks(state, now)) await this.save(transaction, state);
      const token = randomBytes(32).toString("base64url");
      await transaction.execute({ sql: "INSERT INTO demo_sessions (token_hash, case_id, role, expires_at) VALUES (?, ?, ?, ?)", args: [hash(token), caseId, role, new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString()] });
      return { token, state: publicState(state, role, now) };
    });
  }

  private async createAccountSession(executor: SqlExecutor, accountId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await executor.execute({ sql: "INSERT INTO account_sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)", args: [hash(token), accountId, new Date(this.clock().getTime() + SESSION_LIFETIME_MS).toISOString()] });
    return token;
  }

  async register(input: unknown): Promise<{ token: string; state: CareState }> {
    const { name, email, password } = parseRegistration(input);
    const passwordRecord = await hashPassword(password);
    return this.transaction(async (transaction) => {
      const existing = await transaction.execute({ sql: "SELECT id FROM accounts WHERE email = ?", args: [email] });
      if (existing.rows[0]) throw new CareError("Já existe uma conta com este e-mail. Entre com sua senha.", 409);
      const now = this.clock();
      const account = { id: randomUUID(), name, email };
      const state = createDemoState(randomUUID(), "setup", null, now);
      state.patient = { name: "Pessoa cuidada", caregiverName: name };
      state.timeline = [];
      await transaction.execute({ sql: "INSERT INTO care_cases (id, state_json) VALUES (?, ?)", args: [state.demoId, JSON.stringify(state)] });
      await transaction.execute({ sql: "INSERT INTO accounts (id, email, name, password_salt, password_hash, case_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", args: [account.id, email, name, passwordRecord.salt, passwordRecord.hash, state.demoId, now.toISOString()] });
      await this.audit(transaction, state.demoId, "caregiver", "account_created", null, state);
      const token = await this.createAccountSession(transaction, account.id);
      return { token, state: publicState(state, "caregiver", now, account) };
    });
  }

  async login(input: unknown): Promise<{ token: string; state: CareState }> {
    const { email, password } = parseLogin(input);
    const emailHash = hash(email);
    const allowed = await this.transaction(async (transaction) => {
      const now = this.clock();
      const result = await transaction.execute({ sql: "SELECT attempts, window_started_at FROM login_attempts WHERE email_hash = ?", args: [emailHash] });
      const previous = result.rows[0];
      const active = previous && now.getTime() - Date.parse(String(previous.window_started_at)) < LOGIN_WINDOW_MS;
      if (active && Number(previous.attempts) >= MAX_LOGIN_ATTEMPTS) return false;
      await transaction.execute({ sql: "INSERT INTO login_attempts (email_hash, attempts, window_started_at) VALUES (?, ?, ?) ON CONFLICT(email_hash) DO UPDATE SET attempts = excluded.attempts, window_started_at = excluded.window_started_at", args: [emailHash, active ? Number(previous.attempts) + 1 : 1, active ? String(previous.window_started_at) : now.toISOString()] });
      return true;
    });
    if (!allowed) throw new CareError("Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.", 429);
    const result = await this.serialized(async () => (await this.database()).execute({ sql: "SELECT id, password_salt, password_hash FROM accounts WHERE email = ?", args: [email] }));
    const account = result.rows[0];
    const valid = await verifyPassword(password, account ? String(account.password_salt) : undefined, account ? String(account.password_hash) : undefined);
    if (!valid || !account) throw new CareError("E-mail ou senha inválidos.", 401);
    return this.transaction(async (transaction) => {
      await transaction.execute({ sql: "DELETE FROM login_attempts WHERE email_hash = ?", args: [emailHash] });
      const token = await this.createAccountSession(transaction, String(account.id));
      const session = await this.session(transaction, token);
      const now = this.clock();
      if (ensureTodayTasks(session.state, now)) await this.save(transaction, session.state);
      return { token, state: publicState(session.state, session.role, now, session.account) };
    });
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    await this.transaction(async (transaction) => {
      await transaction.execute({ sql: "DELETE FROM account_sessions WHERE token_hash = ?", args: [hash(token)] });
      await transaction.execute({ sql: "DELETE FROM demo_sessions WHERE token_hash = ?", args: [hash(token)] });
    });
  }

  async getState(token: string | undefined, expected?: CareSessionContext): Promise<CareState> {
    const snapshot = await this.serialized(async () => {
      const session = await this.boundSession(await this.database(), token, expected);
      const now = this.clock();
      return { ...session, now, needsTasks: ensureTodayTasks(session.state, now) };
    });
    if (!snapshot.needsTasks) return publicState(snapshot.state, snapshot.role, snapshot.now, snapshot.account);
    // Materialize a new day's tasks under a write lock, rereading after acquisition.
    return this.transaction(async (transaction) => {
      const { state, role, account } = await this.boundSession(transaction, token, expected);
      const now = this.clock();
      if (ensureTodayTasks(state, now)) {
        state.updatedAt = now.toISOString();
        state.revision += 1;
        await this.save(transaction, state);
      }
      return publicState(state, role, now, account);
    });
  }

  async mutate(token: string | undefined, input: unknown, expected?: CareSessionContext): Promise<CareState> {
    const action = parseAction(input);
    return this.transaction(async (transaction) => {
      const { caseId, state, role, account } = await this.boundSession(transaction, token, expected);
      const fingerprint = hash(stableJson(action));
      const existing = await transaction.execute({ sql: "SELECT role, fingerprint FROM operations WHERE case_id = ? AND request_id = ?", args: [caseId, action.requestId] });
      const previousOperation = existing.rows[0];
      if (previousOperation) {
        if (previousOperation.role !== role || previousOperation.fingerprint !== fingerprint) throw new CareError("Este identificador de envio já foi usado para outra ação.", 409);
        return publicState(state, role, this.clock(), account);
      }
      const before = structuredClone(state);
      const now = this.clock();
      ensureTodayTasks(state, now);
      applyAction(state, role, action, now);
      await this.save(transaction, state);
      await transaction.execute({ sql: "INSERT INTO operations (case_id, request_id, role, fingerprint, created_at) VALUES (?, ?, ?, ?, ?)", args: [caseId, action.requestId, role, fingerprint, now.toISOString()] });
      await this.audit(transaction, caseId, role, action.type, before, state, action.requestId);
      return publicState(state, role, now, account);
    });
  }

  private async writeDocument(transaction: Transaction, caseId: string, input: DocumentInput, pageCount: number | null = null): Promise<DocumentRef> {
    const { bytes } = input;
    const mimeType = input.mimeType.toLowerCase().split(";")[0].trim();
    if (!input.name.trim() || input.name.length > 255 || /[\x00-\x1f]/.test(input.name)) throw new CareError("Nome de arquivo inválido.");
    if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES) throw new CareError("O arquivo deve ter entre 1 byte e 15 MB.", 413);
    const signatures: Record<string, number[]> = { "application/pdf": [0x25, 0x50, 0x44, 0x46, 0x2d], "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image/jpeg": [0xff, 0xd8, 0xff] };
    if (mimeType !== "text/plain" && (!signatures[mimeType] || !signatures[mimeType].every((value, index) => bytes[index] === value))) throw new CareError("Envie um PDF, JPEG, PNG válido ou texto.", 415);
    if (mimeType === "text/plain") {
      try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new CareError("O texto deve usar UTF-8."); }
    }
    const documentId = randomUUID();
    const directory = path.join(this.directory, "documents");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const fileName = `${documentId}.bin`;
    await writeFile(path.join(directory, fileName), bytes, { flag: "wx", mode: 0o600 });
    const name = path.basename(input.name).trim();
    await transaction.execute({ sql: "INSERT INTO documents (id, case_id, name, mime_type, file_name, sha256, byte_length, page_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", args: [documentId, caseId, name, mimeType, fileName, hash(bytes), bytes.byteLength, pageCount] });
    return { id: documentId, name, mimeType, url: `/api/documents/${documentId}`, pageCount };
  }

  async storeDocument(token: string | undefined, input: DocumentInput, expected?: CareSessionContext): Promise<DocumentRef> {
    return this.transaction(async (transaction) => {
      const { caseId, role, state } = await this.boundSession(transaction, token, expected);
      requireCaregiver(role);
      requireDraft(state);
      return this.writeDocument(transaction, caseId, input, input.mimeType === "text/plain" || input.mimeType.startsWith("image/") ? 1 : null);
    });
  }

  async importDraft(token: string | undefined, document: DocumentRef, extraction: ExtractionResult, expected?: CareSessionContext): Promise<CareState> {
    const parsed = parseExtraction(extraction);
    return this.transaction(async (transaction) => {
      const { caseId, state, role, account } = await this.boundSession(transaction, token, expected);
      requireCaregiver(role);
      requireDraft(state);
      const stored = await transaction.execute({ sql: "SELECT id, name, mime_type, page_count FROM documents WHERE id = ? AND case_id = ?", args: [document.id, caseId] });
      const row = stored.rows[0];
      if (!row) throw new CareError("Documento não encontrado neste cuidado.", 404);
      const pageCount = Number.isInteger(document.pageCount) && document.pageCount! > 0 ? document.pageCount : row.page_count === null ? null : Number(row.page_count);
      if (pageCount !== null && pageCount > 10_000) throw new CareError("Quantidade de páginas inválida.");
      const before = structuredClone(state);
      state.document = { id: document.id, name: String(row.name), mimeType: String(row.mime_type), pageCount, url: `/api/documents/${document.id}` };
      state.plan = { status: "draft", items: parsed.items.map((item) => withProposedTimes({ ...item, id: randomUUID(), confirmed: false, schedule: undefined, source: { ...item.source, documentId: document.id } })), sourceReviewed: false, unresolved: parsed.unresolved.length || parsed.items.length ? parsed.unresolved : ["Nenhum cuidado foi identificado. Confira a leitura ou envie outra fonte."], warnings: parsed.warnings };
      state.tasks = [];
      appendEvent(state, role, this.clock().toISOString(), `Novo documento recebido: “${state.document.name}”. O rascunho precisa de conferência humana; nenhuma orientação foi ativada.`);
      await transaction.execute({ sql: "UPDATE documents SET page_count = ? WHERE id = ?", args: [pageCount, document.id] });
      await this.save(transaction, state);
      await this.audit(transaction, caseId, role, "import_draft", before, state);
      return publicState(state, role, this.clock(), account);
    });
  }

  async getDocument(token: string | undefined, id: string): Promise<{ reference: DocumentRef; bytes: Uint8Array }> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new CareError("Documento não encontrado.", 404);
    const row = await this.serialized(async () => {
      const client = await this.database();
      const { caseId } = await this.session(client, token);
      const result = await client.execute({ sql: "SELECT id, name, mime_type, file_name, page_count, sha256 FROM documents WHERE id = ? AND case_id = ?", args: [id, caseId] });
      return result.rows[0];
    });
    if (!row) throw new CareError("Documento não encontrado neste cuidado.", 404);
    const bytes = await readFile(path.join(this.directory, "documents", String(row.file_name)));
    if (hash(bytes) !== row.sha256) throw new CareError("O original não passou na verificação de integridade. Envie o arquivo novamente.", 409);
    return { reference: { id, name: String(row.name), mimeType: String(row.mime_type), pageCount: row.page_count === null ? null : Number(row.page_count), url: `/api/documents/${id}` }, bytes };
  }

  async close(): Promise<void> {
    await this.queue;
    if (this.clientPromise) (await this.clientPromise).close();
  }
}
