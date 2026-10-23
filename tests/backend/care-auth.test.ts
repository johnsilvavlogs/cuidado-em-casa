import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { CareError, CareRepository } from "../../src/lib/server/care-repository";
import { createDemoState } from "../../src/lib/server/care-demo";

const password = "Uma-senha-de-teste-42";
const credentials = { name: "Ana Teste", email: "ana@example.com", password };
const expectStatus = (status: number) => (error: unknown) => error instanceof CareError && error.status === status;

async function fixture(t: TestContext) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cuidado-auth-"));
  let now = new Date("2026-10-23T15:00:00.000Z");
  const repository = new CareRepository({ dataDir, now: () => now });
  t.after(() => repository.close());
  return { repository, dataDir, setTime: (value: string) => { now = new Date(value); } };
}

function database(t: TestContext, dataDir: string) {
  const db = createClient({ url: pathToFileURL(path.join(dataDir, "care.sqlite")).href });
  t.after(() => db.close());
  return db;
}

test("registration creates an empty caregiver case with normalized identity and salted password storage", async (t) => {
  const { repository, dataDir } = await fixture(t);
  const account = await repository.register({ ...credentials, name: "  Ana Teste  ", email: " ANA@EXAMPLE.COM " });
  assert.deepEqual(account.state.account, { id: account.state.account!.id, name: "Ana Teste", email: credentials.email });
  assert.deepEqual(account.state.patient, { name: "Pessoa cuidada", caregiverName: "Ana Teste" });
  assert.equal(account.state.role, "caregiver");
  assert.equal(account.state.plan.status, "draft");
  assert.equal(account.state.document, null);
  for (const entries of [account.state.plan.items, account.state.tasks, account.state.helpRequests, account.state.checkIns, account.state.timeline]) assert.deepEqual(entries, []);
  assert.equal(account.state.plan.sourceReviewed, false);
  assert.equal(JSON.stringify(account.state).includes(password), false);
  assert.equal(JSON.stringify(account.state).includes(account.token), false);
  const row = (await database(t, dataDir).execute("SELECT * FROM accounts")).rows[0];
  assert.equal(String(row.password_salt).length, 32);
  assert.equal(String(row.password_hash).length, 128);
  assert.equal(JSON.stringify(row).includes(password), false);
  const another = await repository.register({ name: "Outro", email: "outro@example.com", password });
  const salts = (await database(t, dataDir).execute("SELECT password_salt, password_hash FROM accounts")).rows;
  assert.notEqual(salts[0].password_salt, salts[1].password_salt);
  assert.notEqual(salts[0].password_hash, salts[1].password_hash);
  assert.notEqual(another.state.demoId, account.state.demoId);
  await assert.rejects(repository.register({ ...credentials, email: "ANA@example.com" }), expectStatus(409));
});

test("registration rejects short/long passwords, malformed fields, and client-selected roles or IDs", async (t) => {
  const { repository } = await fixture(t);
  for (const input of [
    { ...credentials, password: "short" },
    { ...credentials, password: "a".repeat(129) },
    { ...credentials, email: "invalid" },
    { ...credentials, name: "\n" },
    { ...credentials, role: "patient" },
    { ...credentials, accountId: randomUUID() },
    { ...credentials, demoId: randomUUID() },
  ]) await assert.rejects(repository.register(input), expectStatus(400));
});

test("login restores persisted work and account metadata, with generic credential errors", async (t) => {
  const { repository, dataDir } = await fixture(t);
  const account = await repository.register(credentials);
  const item = { id: randomUUID(), title: "Novo cuidado", category: "other", instruction: "Conferir com a fonte.", fields: {}, source: { documentId: null, page: null, quote: "Fonte informada" }, questions: [], confirmed: false };
  const changed = await repository.mutate(account.token, { type: "add_item", item, requestId: randomUUID() });
  assert.deepEqual(changed.account, account.state.account);
  const reopened = new CareRepository({ dataDir });
  t.after(() => reopened.close());
  const login = await reopened.login({ email: " ANA@EXAMPLE.COM ", password });
  assert.equal(login.state.demoId, account.state.demoId);
  assert.deepEqual(login.state.account, account.state.account);
  assert.equal(login.state.plan.items[0].title, "Novo cuidado");
  assert.notEqual(login.token, account.token);
  const errors: string[] = [];
  for (const input of [{ email: credentials.email, password: "wrong-password" }, { email: "missing@example.com", password: "wrong-password" }, { email: credentials.email, password, role: "patient" }]) {
    await assert.rejects(reopened.login(input), (error: unknown) => {
      assert.ok(error instanceof CareError);
      assert.equal(error.status, 401);
      errors.push(error.message);
      return true;
    });
  }
  assert.equal(new Set(errors).size, 1);
});

test("logout revokes the selected account or demo token and remains safe to repeat", async (t) => {
  const { repository } = await fixture(t);
  const registered = await repository.register(credentials);
  const login = await repository.login({ email: credentials.email, password });
  await repository.logout(registered.token);
  await assert.rejects(repository.getState(registered.token), expectStatus(401));
  assert.equal((await repository.getState(login.token)).demoId, registered.state.demoId);
  await repository.logout(registered.token);
  await repository.logout(undefined);
  await repository.logout("invalid");
  const demo = await repository.startDemo({ scenario: "ready", role: "patient" });
  assert.equal(demo.state.account, undefined);
  await repository.logout(demo.token);
  await assert.rejects(repository.getState(demo.token), expectStatus(401));
});

test("account sessions expire after 24 hours without removing their saved care", async (t) => {
  const { repository, setTime } = await fixture(t);
  const registered = await repository.register(credentials);
  setTime("2026-10-24T15:00:00.001Z");
  await assert.rejects(repository.getState(registered.token), expectStatus(401));
  const login = await repository.login({ email: credentials.email, password });
  assert.equal(login.state.demoId, registered.state.demoId);
});

test("leaked case IDs, demo roles, and unrelated tokens cannot enter an account case or read its documents", async (t) => {
  const { repository, dataDir } = await fixture(t);
  const first = await repository.register(credentials);
  const second = await repository.register({ ...credentials, email: "second@example.com" });
  const demo = await repository.startDemo({ scenario: "setup", role: "caregiver" });
  const doc = await repository.storeDocument(first.token, { name: "privado.txt", mimeType: "text/plain", bytes: new TextEncoder().encode("Fonte da Ana") });
  const imported = await repository.importDraft(first.token, doc, { items: [], unresolved: [], warnings: [] });
  assert.deepEqual(imported.account, first.state.account);
  assert.equal((await repository.getDocument(first.token, doc.id)).reference.id, doc.id);
  for (const role of ["patient", "caregiver"]) await assert.rejects(repository.startDemo({ scenario: "ready", role, demoId: first.state.demoId }), expectStatus(404));
  for (const token of [demo.token, second.token]) {
    await assert.rejects(repository.getDocument(token, doc.id), expectStatus(404));
    await assert.rejects(repository.importDraft(token, doc, { items: [], unresolved: [], warnings: [] }), expectStatus(404));
  }
  // Defense in depth for a legacy or tampered demo row that points at an account.
  const forgedToken = "z".repeat(43);
  await database(t, dataDir).execute({ sql: "INSERT INTO demo_sessions (token_hash, case_id, role, expires_at) VALUES (?, ?, ?, ?)", args: [createHash("sha256").update(forgedToken).digest("hex"), first.state.demoId, "patient", "2027-01-01T00:00:00.000Z"] });
  await assert.rejects(repository.getState(forgedToken), expectStatus(401));
  await assert.rejects(repository.getDocument(forgedToken, doc.id), expectStatus(401));
  assert.equal((await repository.getState(second.token)).demoId, second.state.demoId);
  assert.equal((await repository.getState(demo.token)).account, undefined);
});

test("failed login attempts are rate limited per normalized address and recover after the window", async (t) => {
  const { repository, setTime } = await fixture(t);
  await repository.register(credentials);
  for (let attempt = 0; attempt < 10; attempt += 1) await assert.rejects(repository.login({ email: "ANA@EXAMPLE.COM", password: "wrong-password" }), expectStatus(401));
  await assert.rejects(repository.login({ email: credentials.email, password }), expectStatus(429));
  setTime("2026-10-23T15:15:00.001Z");
  const login = await repository.login({ email: credentials.email, password });
  assert.equal(login.state.account?.email, credentials.email);
  await assert.rejects(repository.login({ email: credentials.email, password: "wrong-password" }), expectStatus(401));
});

test("adding account tables preserves pre-existing demo sessions and cases", async (t) => {
  const { repository, dataDir } = await fixture(t);
  const legacy = database(t, dataDir);
  await legacy.executeMultiple("CREATE TABLE care_cases (id TEXT PRIMARY KEY, state_json TEXT NOT NULL); CREATE TABLE demo_sessions (token_hash TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES care_cases(id), role TEXT NOT NULL CHECK(role IN ('patient', 'caregiver')), expires_at TEXT NOT NULL);");
  const state = createDemoState(randomUUID(), "setup", null, new Date("2026-10-23T14:00:00.000Z"));
  const token = "A".repeat(43);
  await legacy.execute({ sql: "INSERT INTO care_cases (id, state_json) VALUES (?, ?)", args: [state.demoId, JSON.stringify(state)] });
  await legacy.execute({ sql: "INSERT INTO demo_sessions (token_hash, case_id, role, expires_at) VALUES (?, ?, ?, ?)", args: [createHash("sha256").update(token).digest("hex"), state.demoId, "caregiver", "2026-10-24T14:00:00.000Z"] });
  assert.equal((await repository.getState(token)).demoId, state.demoId);
  await repository.register(credentials);
  assert.equal((await repository.getState(token)).demoId, state.demoId);
  assert.equal((await repository.getState(token)).account, undefined);
});
