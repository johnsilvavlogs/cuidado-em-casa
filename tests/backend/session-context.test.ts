import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { CareError, CareRepository } from "../../src/lib/server/care-repository";
import { parseActionRequest, parseSessionContext } from "../../src/lib/server/care-domain";
import type { CareSessionContext } from "../../src/lib/contracts";

const expectStatus = (status: number) => (error: unknown) => error instanceof CareError && error.status === status;
const help = () => ({ type: "request_help", message: "Ajuda de teste", urgent: true, requestId: randomUUID() });

test("browser actions require an explicit case and role instead of silently following a cookie", () => {
  assert.throws(() => parseActionRequest(help()), expectStatus(400));
  assert.throws(() => parseActionRequest({ action: help() }), expectStatus(400));
  assert.throws(() => parseSessionContext({ demoId: randomUUID() }), expectStatus(400));
  const request = { context: { demoId: randomUUID(), role: "patient" }, action: help() };
  assert.deepEqual(parseActionRequest(request), request);
});

test("a switched case or role rejects urgent help and check-in before any mutation; original context still succeeds", async (t) => {
  const repository = new CareRepository({ dataDir: await mkdtemp(path.join(os.tmpdir(), "care-session-context-")) });
  t.after(() => repository.close());
  const a = await repository.startDemo({ scenario: "ready", role: "patient" });
  const b = await repository.startDemo({ scenario: "ready", role: "patient" });
  const context: CareSessionContext = { demoId: a.state.demoId, role: "patient" };
  const checkIn = { type: "check_in", sleepMinutes: null, sleepQuality: "okay", food: null, mood: null, requestId: randomUUID() };
  await assert.rejects(repository.mutate(b.token, help(), context), expectStatus(409));
  await assert.rejects(repository.mutate(b.token, checkIn, context), expectStatus(409));
  const changedRole = await repository.startDemo({ scenario: "ready", role: "caregiver", demoId: a.state.demoId });
  await assert.rejects(repository.mutate(changedRole.token, help(), context), expectStatus(409));
  assert.equal((await repository.getState(a.token)).revision, a.state.revision);
  assert.equal((await repository.getState(b.token)).revision, b.state.revision);
  assert.deepEqual((await repository.getState(b.token)).helpRequests, []);
  assert.deepEqual((await repository.getState(b.token)).checkIns, []);
  assert.equal((await repository.mutate(a.token, help(), context)).helpRequests.length, 1);
  assert.equal((await repository.mutate(a.token, checkIn, context)).checkIns.length, 1);
});

test("document writes and voice state lookup reject a stale context while correct imports remain accepted", async (t) => {
  const repository = new CareRepository({ dataDir: await mkdtemp(path.join(os.tmpdir(), "care-session-import-")) });
  t.after(() => repository.close());
  const a = await repository.startDemo({ scenario: "setup", role: "caregiver" });
  const b = await repository.startDemo({ scenario: "setup", role: "caregiver" });
  const expected: CareSessionContext = { demoId: a.state.demoId, role: "caregiver" };
  const input = { name: "orientacao.txt", mimeType: "text/plain", bytes: new TextEncoder().encode("Texto de demonstração") };
  await assert.rejects(repository.getState(b.token, expected), expectStatus(409));
  await assert.rejects(repository.storeDocument(b.token, input, expected), expectStatus(409));
  const document = await repository.storeDocument(a.token, input, expected);
  await assert.rejects(repository.importDraft(b.token, document, { items: [], warnings: [], unresolved: [] }, expected), expectStatus(409));
  const state = await repository.importDraft(a.token, document, { items: [], warnings: [], unresolved: [] }, expected);
  assert.equal(state.document?.id, document.id);
  assert.equal((await repository.getState(b.token)).document, null);
});
