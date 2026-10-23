import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import type { CareState, DraftItem, ExtractionResult } from "../../src/lib/contracts";
import { CareError, CareRepository } from "../../src/lib/server/care-repository";
import { assertSameOrigin, errorResponse, readJson } from "../../src/lib/server/care-http";
import { itemBlockers } from "../../src/lib/server/care-domain";

async function fixture(t: TestContext) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cuidado-backend-"));
  let now = new Date("2026-10-23T15:00:00.000Z");
  const repository = new CareRepository({ dataDir, now: () => now });
  t.after(() => repository.close());
  return { repository, dataDir, setTime: (value: string) => { now = new Date(value); } };
}

const req = () => randomUUID();
const expectStatus = (status: number) => (error: unknown) => error instanceof CareError && error.status === status;

test("same-origin follows the actual Host when Next normalizes its internal URL", () => {
  assert.doesNotThrow(() => assertSameOrigin(new Request("http://localhost:3000/api/demo", { headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } })));
  assert.throws(() => assertSameOrigin(new Request("http://localhost:3000/api/demo", { headers: { host: "127.0.0.1:3000", origin: "http://unrelated.example" } })), expectStatus(403));
});

function extractedItem(overrides: Partial<DraftItem> = {}): DraftItem {
  return {
    id: randomUUID(), title: "Cuidado da fonte", category: "medication", instruction: "Seguir a orientação impressa três vezes ao dia.",
    fields: { nome: { value: "Exemplo", state: "readable", sourceText: "Exemplo" }, frequência: { value: "três vezes ao dia", state: "readable", sourceText: "três vezes ao dia" }, duração: { value: null, state: "missing", sourceText: null } },
    source: { documentId: null, page: 1, quote: "Exemplo: seguir a orientação impressa três vezes ao dia." }, questions: [], confirmed: false,
    ...overrides,
  };
}

async function importOne(repository: CareRepository, token: string, extraction: ExtractionResult = { items: [extractedItem()], unresolved: [], warnings: [] }) {
  const document = await repository.storeDocument(token, { name: "orientacao.txt", mimeType: "text/plain", bytes: new TextEncoder().encode("Exemplo: seguir a orientação impressa três vezes ao dia.") });
  return repository.importDraft(token, document, extraction);
}

async function reviewMedicationPeriod(repository: CareRepository, token: string, item: DraftItem) {
  if (item.category !== "medication" || item.schedule?.period) return;
  await repository.mutate(token, { type: "update_item", itemId: item.id, title: item.title, instruction: item.instruction, fields: item.fields, questions: item.questions,
    schedule: { times: item.schedule?.times ?? [], priority: item.schedule?.priority ?? "normal", toleranceMinutes: item.schedule?.toleranceMinutes ?? 0, period: { startDate: "2026-10-23", endDate: "2026-10-29" } }, requestId: req() });
}

async function activate(repository: CareRepository, token: string, state: CareState) {
  for (const item of state.plan.items) {
    await reviewMedicationPeriod(repository, token, item);
    await repository.mutate(token, { type: "confirm_item", itemId: item.id, requestId: req() });
  }
  await repository.mutate(token, { type: "confirm_source_pages", requestId: req() });
  return repository.mutate(token, { type: "activate_plan", requestId: req() });
}

test("opaque sessions expire, persist across clients, and do not expose a token in state", async (t) => {
  const { repository, dataDir, setTime } = await fixture(t);
  await assert.rejects(repository.getState(undefined), expectStatus(401));
  await assert.rejects(repository.getState("forged"), expectStatus(401));
  const demo = await repository.startDemo({ scenario: "ready", role: "patient" });
  assert.equal(demo.token.length, 43);
  assert.equal(JSON.stringify(demo.state).includes(demo.token), false);
  const reopened = new CareRepository({ dataDir, now: () => new Date("2026-10-23T16:00:00Z") });
  t.after(() => reopened.close());
  assert.equal((await reopened.getState(demo.token)).demoId, demo.state.demoId);
  setTime("2026-10-24T15:00:00.001Z");
  await assert.rejects(repository.getState(demo.token), expectStatus(401));
});

test("demo joining shares only the requested synthetic case and does not reset its plan", async (t) => {
  const { repository } = await fixture(t);
  const patient = await repository.startDemo({ scenario: "ready", role: "patient" });
  const caregiver = await repository.startDemo({ scenario: "setup", role: "caregiver", demoId: patient.state.demoId });
  assert.equal(caregiver.state.plan.status, "active");
  assert.deepEqual(caregiver.state.tasks, patient.state.tasks);
  const unrelated = await repository.startDemo({ scenario: "ready", role: "patient" });
  assert.notEqual(unrelated.state.demoId, patient.state.demoId);
  await assert.rejects(repository.mutate(unrelated.token, { type: "record_task", taskId: patient.state.tasks[0].id, status: "done", requestId: req() }), expectStatus(404));
  await assert.rejects(repository.getDocument(unrelated.token, patient.state.document!.id), expectStatus(404));
  await assert.rejects(repository.startDemo({ scenario: "ready", role: "patient", demoId: randomUUID() }), expectStatus(404));
});

test("concurrent retries are idempotent and request IDs cannot be reused for another action or role", async (t) => {
  const { repository, dataDir } = await fixture(t);
  const demo = await repository.startDemo({ scenario: "ready", role: "patient" });
  const action = { type: "record_task", taskId: demo.state.tasks[0].id, status: "done", requestId: req() };
  const results = await Promise.all([repository.mutate(demo.token, action), repository.mutate(demo.token, action), repository.mutate(demo.token, action)]);
  assert.equal(results[0].revision, demo.state.revision + 1);
  assert.equal(results[2].revision, results[0].revision);
  assert.equal(results[2].timeline.length, demo.state.timeline.length + 1);
  await assert.rejects(repository.mutate(demo.token, { ...action, status: "not_done" }), expectStatus(409));
  const caregiver = await repository.startDemo({ scenario: "ready", role: "caregiver", demoId: demo.state.demoId });
  await assert.rejects(repository.mutate(caregiver.token, action), expectStatus(409));
  const db = createClient({ url: pathToFileURL(path.join(dataDir, "care.sqlite")).href });
  t.after(() => db.close());
  assert.equal((await db.execute("SELECT count(*) AS total FROM operations")).rows[0].total, 1);
  assert.equal((await db.execute("SELECT count(*) AS total FROM audit_events WHERE event_type = 'record_task'")).rows[0].total, 1);
});

test("task corrections retain original data in durable audit and appear to the caregiver", async (t) => {
  const { repository, dataDir, setTime } = await fixture(t);
  const patient = await repository.startDemo({ scenario: "ready", role: "patient" });
  const taskId = patient.state.tasks[0].id;
  const informedAt = "2026-10-23T14:45:00.000Z";
  await repository.mutate(patient.token, { type: "record_task", taskId, status: "done", informedAt, requestId: req() });
  setTime("2026-10-23T15:05:00Z");
  await repository.mutate(patient.token, { type: "record_task", taskId, status: "not_done", requestId: req() });
  const caregiver = await repository.startDemo({ scenario: "ready", role: "caregiver", demoId: patient.state.demoId });
  const corrected = caregiver.state.tasks.find((entry) => entry.id === taskId)!;
  assert.equal(corrected.status, "not_done");
  assert.equal(corrected.author, "patient");
  assert.match(caregiver.state.timeline[0].text, /registro anterior: feito/);
  const db = createClient({ url: pathToFileURL(path.join(dataDir, "care.sqlite")).href });
  t.after(() => db.close());
  const rows = (await db.execute("SELECT before_json, after_json FROM audit_events WHERE event_type = 'record_task' ORDER BY created_at")).rows;
  const original = JSON.parse(String(rows[0].after_json)) as CareState;
  assert.equal(original.tasks.find((entry) => entry.id === taskId)!.informedAt, informedAt);
  assert.equal((JSON.parse(String(rows[1].before_json)) as CareState).tasks.find((entry) => entry.id === taskId)!.status, "done");
  assert.equal((await repository.getState(patient.token)).tasks.find((entry) => entry.id === taskId)!.status, "not_done");
});

test("role restrictions are enforced at the mutation and original-storage boundaries", async (t) => {
  const { repository } = await fixture(t);
  const patient = await repository.startDemo({ scenario: "setup", role: "patient" });
  for (const action of [{ type: "activate_plan", requestId: req() }, { type: "confirm_source_pages", requestId: req() }, { type: "add_item", item: extractedItem(), requestId: req() }]) {
    await assert.rejects(repository.mutate(patient.token, action), expectStatus(403));
  }
  await assert.rejects(repository.storeDocument(patient.token, { name: "file.txt", mimeType: "text/plain", bytes: new TextEncoder().encode("Texto") }), expectStatus(403));
  const caregiver = await repository.startDemo({ scenario: "setup", role: "caregiver", demoId: patient.state.demoId });
  await assert.rejects(repository.mutate(caregiver.token, { type: "request_help", message: "Teste", urgent: false, requestId: req() }), expectStatus(403));
});

test("import strips AI confirmations and schedules, retains absence, and never infers an interval", async (t) => {
  const { repository } = await fixture(t);
  const caregiver = await repository.startDemo({ scenario: "setup", role: "caregiver" });
  const imported = await importOne(repository, caregiver.token, { items: [extractedItem({ confirmed: true, schedule: { times: ["08:00", "16:00", "23:00"], priority: "important", toleranceMinutes: 10 } })], unresolved: [], warnings: [] });
  assert.equal(imported.plan.items[0].confirmed, false);
  assert.equal(imported.plan.items[0].schedule, undefined);
  assert.equal(imported.plan.sourceReviewed, false);
  assert.equal(imported.plan.items[0].source.documentId, imported.document!.id);
  assert.equal(imported.plan.items[0].fields.duração.value, null);
  await assert.rejects(repository.mutate(caregiver.token, { type: "activate_plan", requestId: req() }), expectStatus(409));
  await assert.rejects(repository.mutate(caregiver.token, { type: "confirm_item", itemId: imported.plan.items[0].id, requestId: req() }), /início e o término/);
  const active = await activate(repository, caregiver.token, imported);
  assert.equal(active.tasks.length, 1);
  assert.equal(active.tasks[0].time, "A combinar");
  assert.equal(active.tasks[0].priority, "normal");
});

test("pasted text without a page retains its source and can be confirmed and activated", async (t) => {
  const { repository } = await fixture(t);
  const caregiver = await repository.startDemo({ scenario: "setup", role: "caregiver" });
  const quote = "Exemplo: seguir a orientação impressa três vezes ao dia.";
  const imported = await importOne(repository, caregiver.token, {
    items: [extractedItem({ source: { documentId: null, page: null, quote } })], unresolved: [], warnings: [],
  });
  assert.equal(imported.document!.mimeType, "text/plain");
  assert.deepEqual(imported.plan.items[0].source, { documentId: imported.document!.id, page: null, quote });
  assert.equal(Buffer.from((await repository.getDocument(caregiver.token, imported.document!.id)).bytes).toString("utf8"), quote);
  const active = await activate(repository, caregiver.token, imported);
  assert.equal(active.plan.status, "active");
  assert.equal(active.plan.items[0].confirmed, true);
  assert.deepEqual((await repository.getState(caregiver.token)).plan, active.plan);
});

test("text confirmation keeps document and quote checks, while paged sources require a valid page", async (t) => {
  const { repository } = await fixture(t);
  const caregiver = await repository.startDemo({ scenario: "setup", role: "caregiver" });
  const state = await importOne(repository, caregiver.token);
  const item = state.plan.items[0];
  const withSource = (source: Partial<DraftItem["source"]>) => ({ ...item, schedule: { times: [], priority: "normal" as const, toleranceMinutes: 0, period: { startDate: "2026-10-23", endDate: "2026-10-29" } }, source: { ...item.source, ...source } });
  assert.deepEqual(itemBlockers(withSource({ page: null }), state), []);
  assert.ok(itemBlockers(withSource({ page: null, documentId: randomUUID() }), state).length);
  assert.ok(itemBlockers(withSource({ page: null, quote: " " }), state).length);
  assert.ok(itemBlockers(withSource({ page: 2 }), state).length);
  for (const mimeType of ["application/pdf", "image/png"]) {
    const pagedState = { ...state, document: { ...state.document!, mimeType, pageCount: 1 } };
    assert.ok(itemBlockers(withSource({ page: null }), pagedState).length);
    assert.ok(itemBlockers(withSource({ page: 2 }), pagedState).length);
    assert.deepEqual(itemBlockers(withSource({ page: 1 }), pagedState), []);
  }
});

test("ambiguity blocks confirmation and activation; edits and imports revoke review", async (t) => {
  const { repository } = await fixture(t);
  const caregiver = await repository.startDemo({ scenario: "setup", role: "caregiver" });
  const sourceItem = extractedItem({ fields: { dose: { value: "1 ou 2", state: "ambiguous", sourceText: "1?2" } }, questions: ["Qual é a dose?"] });
  let state = await importOne(repository, caregiver.token, { items: [sourceItem], unresolved: ["A página tem um trecho incompleto."], warnings: [] });
  const itemId = state.plan.items[0].id;
  await assert.rejects(repository.mutate(caregiver.token, { type: "confirm_item", itemId, requestId: req() }), expectStatus(409));
  await repository.mutate(caregiver.token, { type: "confirm_source_pages", requestId: req() });
  state = await repository.mutate(caregiver.token, { type: "update_item", itemId, title: sourceItem.title, instruction: sourceItem.instruction, fields: { dose: { value: "1", state: "readable", sourceText: "1" } }, questions: [], requestId: req() });
  assert.equal(state.plan.items[0].confirmed, false);
  assert.equal(state.plan.sourceReviewed, false);
  await reviewMedicationPeriod(repository, caregiver.token, state.plan.items[0]);
  await repository.mutate(caregiver.token, { type: "confirm_item", itemId, requestId: req() });
  await repository.mutate(caregiver.token, { type: "confirm_source_pages", requestId: req() });
  await assert.rejects(repository.mutate(caregiver.token, { type: "activate_plan", requestId: req() }), expectStatus(409));
  await assert.rejects(repository.mutate(caregiver.token, { type: "resolve_uncertainty", index: 0, explanation: "ok", requestId: req() }), expectStatus(400));
  state = await repository.mutate(caregiver.token, { type: "resolve_uncertainty", index: 0, explanation: "Conferido com a fonte original completa.", requestId: req() });
  assert.equal(state.plan.sourceReviewed, false);
  assert.match(state.timeline[0].text, /fonte original completa/);
  await repository.mutate(caregiver.token, { type: "confirm_source_pages", requestId: req() });
  assert.equal((await repository.mutate(caregiver.token, { type: "activate_plan", requestId: req() })).plan.status, "active");
});

test("explicit operational times create occurrences and the active plan is immutable", async (t) => {
  const { repository } = await fixture(t);
  const caregiver = await repository.startDemo({ scenario: "setup", role: "caregiver" });
  let state = await importOne(repository, caregiver.token);
  const item = state.plan.items[0];
  state = await repository.mutate(caregiver.token, { type: "update_item", itemId: item.id, title: item.title, instruction: item.instruction, fields: item.fields, questions: [], schedule: { times: ["07:00", "19:00"], priority: "important", toleranceMinutes: 45 }, requestId: req() });
  state = await activate(repository, caregiver.token, state);
  assert.deepEqual(state.tasks.map((entry) => entry.time), ["07:00", "19:00"]);
  assert.ok(state.tasks.every((entry) => entry.toleranceMinutes === 45));
  await assert.rejects(repository.mutate(caregiver.token, { type: "update_item", itemId: item.id, title: "Mudou", instruction: item.instruction, fields: item.fields, questions: [], requestId: req() }), expectStatus(409));
  await assert.rejects(repository.mutate(caregiver.token, { type: "add_item", item: extractedItem(), requestId: req() }), expectStatus(409));
  await assert.rejects(repository.storeDocument(caregiver.token, { name: "outro.txt", mimeType: "text/plain", bytes: new TextEncoder().encode("Outro") }), expectStatus(409));
  await assert.rejects(repository.importDraft(caregiver.token, state.document!, { items: [], unresolved: [], warnings: [] }), expectStatus(409));
});

test("help and urgent help persist without completing a task; urgent flow also works before activation", async (t) => {
  const { repository } = await fixture(t);
  const patient = await repository.startDemo({ scenario: "ready", role: "patient" });
  const helpAction = { type: "request_help", taskId: patient.state.tasks[0].id, message: "Preciso de ajuda para ler a orientação", urgent: false, requestId: req() };
  let state = await repository.mutate(patient.token, helpAction);
  await repository.mutate(patient.token, helpAction);
  assert.equal(state.helpRequests.length, 1);
  assert.equal(state.tasks[0].status, "pending");
  await assert.rejects(repository.mutate(patient.token, { type: "resolve_help", helpId: state.helpRequests[0].id, requestId: req() }), expectStatus(403));
  const caregiver = await repository.startDemo({ scenario: "ready", role: "caregiver", demoId: patient.state.demoId });
  state = await repository.mutate(caregiver.token, { type: "resolve_help", helpId: state.helpRequests[0].id, requestId: req() });
  assert.equal(state.helpRequests[0].status, "resolved");
  assert.equal(state.tasks[0].status, "pending");
  const draftPatient = await repository.startDemo({ scenario: "setup", role: "patient" });
  state = await repository.mutate(draftPatient.token, { type: "request_help", message: "", urgent: true, requestId: req() });
  assert.equal(state.helpRequests[0].message, "Preciso de ajuda urgente.");
  assert.equal(state.helpRequests[0].urgent, true);
  assert.equal(state.plan.status, "draft");
});

test("optional well-being distinguishes absent sleep from zero, supports author corrections, and validates dates", async (t) => {
  const { repository, setTime } = await fixture(t);
  const patient = await repository.startDemo({ scenario: "ready", role: "patient" });
  assert.deepEqual(patient.state.checkIns, []);
  const checkIn = { type: "check_in", sleepMinutes: null, sleepQuality: null, food: "partial", mood: null, referenceDate: "2026-10-22", requestId: req() };
  let state = await repository.mutate(patient.token, checkIn);
  const recordId = state.checkIns[0].id;
  assert.equal(state.checkIns[0].sleepMinutes, null);
  setTime("2026-10-23T15:10:00Z");
  state = await repository.mutate(patient.token, { ...checkIn, id: recordId, sleepMinutes: 0, sleepQuality: "low", requestId: req() });
  assert.equal(state.checkIns.length, 1);
  assert.equal(state.checkIns[0].sleepMinutes, 0);
  assert.notEqual(state.checkIns[0].updatedAt, state.checkIns[0].createdAt);
  const caregiver = await repository.startDemo({ scenario: "ready", role: "caregiver", demoId: patient.state.demoId });
  await assert.rejects(repository.mutate(caregiver.token, { ...checkIn, id: recordId, requestId: req() }), expectStatus(403));
  for (const invalid of [{ sleepMinutes: -1 }, { sleepMinutes: 1_441 }, { referenceDate: "2026-02-31" }, { referenceDate: "2026-10-24" }, { food: null }]) {
    await assert.rejects(repository.mutate(patient.token, { ...checkIn, ...invalid, requestId: req() }), expectStatus(400));
  }
});

test("private originals are byte-identical, access-controlled, and reject disguised unsupported files", async (t) => {
  const { repository, dataDir } = await fixture(t);
  const caregiver = await repository.startDemo({ scenario: "setup", role: "caregiver" });
  const bytes = new TextEncoder().encode("Orientação original com acentuação.");
  const document = await repository.storeDocument(caregiver.token, { name: "original.txt", mimeType: "text/plain", bytes });
  assert.deepEqual((await repository.getDocument(caregiver.token, document.id)).bytes, Buffer.from(bytes));
  await assert.rejects(repository.getDocument(undefined, document.id), expectStatus(401));
  await assert.rejects(repository.getDocument(caregiver.token, "../../etc/passwd"), expectStatus(404));
  await assert.rejects(repository.storeDocument(caregiver.token, { name: "disfarce.pdf", mimeType: "application/pdf", bytes }), expectStatus(415));
  await assert.rejects(repository.storeDocument(caregiver.token, { name: "arquivo.html", mimeType: "text/html", bytes }), expectStatus(415));
  assert.equal((await stat(dataDir)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(dataDir, "care.sqlite"))).mode & 0o777, 0o600);
  assert.equal((await stat(path.join(dataDir, "documents", `${document.id}.bin`))).mode & 0o777, 0o600);
});

test("empty/invalid-page readings remain blocked, and reimport revokes all confirmations", async (t) => {
  const { repository } = await fixture(t);
  const caregiver = await repository.startDemo({ scenario: "setup", role: "caregiver" });
  let state = await importOne(repository, caregiver.token, { items: [], unresolved: [], warnings: [] });
  assert.equal(state.plan.status, "draft");
  assert.equal(state.plan.unresolved.length, 1);
  await assert.rejects(repository.mutate(caregiver.token, { type: "activate_plan", requestId: req() }), expectStatus(409));
  state = await importOne(repository, caregiver.token, { items: [extractedItem({ source: { documentId: null, page: 2, quote: "Uma página inválida" } })], unresolved: [], warnings: [] });
  await assert.rejects(repository.mutate(caregiver.token, { type: "confirm_item", itemId: state.plan.items[0].id, requestId: req() }), expectStatus(409));
  state = await importOne(repository, caregiver.token);
  await reviewMedicationPeriod(repository, caregiver.token, state.plan.items[0]);
  await repository.mutate(caregiver.token, { type: "confirm_item", itemId: state.plan.items[0].id, requestId: req() });
  await repository.mutate(caregiver.token, { type: "confirm_source_pages", requestId: req() });
  state = await repository.importDraft(caregiver.token, state.document!, { items: [extractedItem({ confirmed: true })], unresolved: [], warnings: [] });
  assert.equal(state.plan.items[0].confirmed, false);
  assert.equal(state.plan.sourceReviewed, false);
});

test("new days get separate occurrences while prior task records remain auditable", async (t) => {
  const { repository, dataDir, setTime } = await fixture(t);
  const patient = await repository.startDemo({ scenario: "ready", role: "patient" });
  await repository.mutate(patient.token, { type: "record_task", taskId: patient.state.tasks[0].id, status: "done", requestId: req() });
  setTime("2026-10-24T14:59:00Z");
  const nextDay = await repository.getState(patient.token);
  assert.equal(nextDay.tasks.length, 4);
  assert.ok(nextDay.tasks.every((task) => task.referenceDate === "2026-10-24" && task.status === "pending"));
  assert.ok(!nextDay.tasks.some((task) => task.id === patient.state.tasks[0].id));
  const db = createClient({ url: pathToFileURL(path.join(dataDir, "care.sqlite")).href });
  t.after(() => db.close());
  const stored = JSON.parse(String((await db.execute("SELECT state_json FROM care_cases")).rows[0].state_json)) as CareState;
  assert.equal(stored.tasks.length, 8);
  assert.equal(stored.tasks.find((task) => task.id === patient.state.tasks[0].id)!.status, "done");
});

test("JSON endpoints reject cross-origin writes, invalid JSON, and unsupported content types", async () => {
  assert.throws(() => assertSameOrigin(new Request("http://localhost/api/actions", { headers: { origin: "https://other.example" } })), expectStatus(403));
  assert.throws(() => assertSameOrigin(new Request("http://localhost/api/actions", { headers: { "sec-fetch-site": "cross-site" } })), expectStatus(403));
  await assert.rejects(readJson(new Request("http://localhost/api/actions", { method: "POST", body: "{}" })), expectStatus(415));
  await assert.rejects(readJson(new Request("http://localhost/api/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })), expectStatus(400));
  assert.deepEqual(await readJson(new Request("http://localhost/api/actions", { method: "POST", headers: { "Content-Type": "application/json", origin: "http://localhost" }, body: '{"valid":true}' })), { valid: true });
});

test("HTTP errors retain their status across separate route bundles and hot reloads", async () => {
  const anotherBundleError = Object.assign(new Error("Sessão expirada."), { name: "CareError", status: 401 });
  const response = errorResponse(anotherBundleError);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Sessão expirada." });
});
