import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createClient } from "@libsql/client";
import type { CareState } from "../../src/lib/contracts";
import { CareError, CareRepository } from "../../src/lib/server/care-repository";

test("help retains its historical task and source across midnight, resolution and case isolation", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cuidado-help-rollover-"));
  let now = new Date("2026-10-24T02:50:00Z"); // October 23 in Brazil.
  const repository = new CareRepository({ dataDir, now: () => now });
  t.after(() => repository.close());
  const patient = await repository.startDemo({ scenario: "ready", role: "patient" });
  const caregiver = await repository.startDemo({ scenario: "ready", role: "caregiver", demoId: patient.state.demoId });
  const foreign = await repository.startDemo({ scenario: "ready", role: "patient" });
  const task = patient.state.tasks[0];
  const expected = { itemId: task.itemId, title: task.title, instruction: task.instruction, time: task.time, referenceDate: "2026-10-23" };
  const action = { type: "request_help", taskId: task.id, message: "Preciso de ajuda com esta orientação.", urgent: false, requestId: randomUUID() };
  const saved = await repository.mutate(patient.token, action);
  const helpId = saved.helpRequests[0].id;
  assert.deepEqual(saved.helpRequests[0].task, expected);
  const retried = await repository.mutate(patient.token, action);
  assert.equal(retried.revision, saved.revision);
  assert.equal(retried.helpRequests.length, 1);

  now = new Date("2026-10-24T03:05:00Z"); // October 24 in Brazil.
  const reopened = new CareRepository({ dataDir, now: () => now });
  t.after(() => reopened.close());
  const assertContext = (state: CareState) => {
    assert.ok(state.tasks.every((entry) => entry.referenceDate === "2026-10-24"));
    assert.ok(!state.tasks.some((entry) => entry.id === task.id));
    const help = state.helpRequests.find((entry) => entry.id === helpId)!;
    assert.deepEqual(help.task, expected);
    const source = state.plan.items.find((item) => item.id === help.task!.itemId)!.source;
    assert.equal(source.documentId, patient.state.document!.id);
    assert.equal(source.page, 1);
    assert.ok(source.quote);
    return help;
  };
  assert.equal(assertContext(await reopened.getState(caregiver.token)).status, "open");
  assert.equal(assertContext(await reopened.getState(patient.token)).status, "open");
  assert.equal(assertContext(await reopened.mutate(patient.token, action)).id, helpId);
  assert.ok((await reopened.getDocument(caregiver.token, patient.state.document!.id)).bytes.byteLength);

  const resolve = { type: "resolve_help", helpId, requestId: randomUUID() };
  const resolved = await reopened.mutate(caregiver.token, resolve);
  assert.equal(assertContext(resolved).status, "resolved");
  assert.equal(assertContext(resolved).resolvedAt, now.toISOString());
  const resolutionRetry = await reopened.mutate(caregiver.token, resolve);
  assert.equal(resolutionRetry.revision, resolved.revision);
  assert.equal(assertContext(await reopened.getState(patient.token)).status, "resolved");
  assert.ok(resolved.tasks.every((entry) => entry.status === "pending"));

  const db = createClient({ url: pathToFileURL(path.join(dataDir, "care.sqlite")).href });
  t.after(() => db.close());
  const row = (await db.execute({ sql: "SELECT state_json FROM care_cases WHERE id = ?", args: [patient.state.demoId] })).rows[0];
  const stored = JSON.parse(String(row.state_json)) as CareState;
  assert.equal(Object.hasOwn(stored.helpRequests[0], "task"), false, "context must remain derived, not copied into persisted help");
  assert.equal(stored.tasks.find((entry) => entry.id === task.id)!.status, "pending");
  assert.deepEqual((await reopened.getState(foreign.token)).helpRequests, []);
  await assert.rejects(reopened.mutate(foreign.token, { ...action, requestId: randomUUID() }), (error: unknown) => error instanceof CareError && error.status === 404);
  const foreignCaregiver = await reopened.startDemo({ scenario: "ready", role: "caregiver", demoId: foreign.state.demoId });
  await assert.rejects(reopened.mutate(foreignCaregiver.token, resolve), (error: unknown) => error instanceof CareError && error.status === 404);
  await assert.rejects(reopened.getDocument(foreign.token, patient.state.document!.id), (error: unknown) => error instanceof CareError && error.status === 404);
});
