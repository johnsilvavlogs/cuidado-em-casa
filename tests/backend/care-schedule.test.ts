import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import type { DraftItem } from "../../src/lib/contracts";
import { CareRepository } from "../../src/lib/server/care-repository";
import { parseAction, type StoredState } from "../../src/lib/server/care-domain";
import { hasReviewedSchedule, scheduledOnDate } from "../../src/lib/schedule-period";

const physiotherapy: DraftItem = {
  id: "physiotherapy", title: "Fisioterapia", category: "activity",
  instruction: "2 sessões por semana, durante 3 semanas. Início em 26/10/2026.",
  fields: { inicio: { value: "26/10/2026", state: "readable", sourceText: "Início em 26/10/2026" } },
  source: { documentId: null, page: 1, quote: "Fisioterapia: 2 sessões por semana, durante 3 semanas. Início em 26/10/2026." },
  questions: [], confirmed: false,
};
const req = () => randomUUID();
const times = { times: [], priority: "normal" as const, toleranceMinutes: 0 };

test("future physiotherapy and return need reviewed dates; weekly care never becomes daily", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "care-future-"));
  let now = new Date("2026-10-23T15:00:00Z");
  const repository = new CareRepository({ dataDir, now: () => now });
  t.after(() => repository.close());
  const session = await repository.startDemo({ scenario: "setup", role: "caregiver" });
  const doc = await repository.storeDocument(session.token, { name: "future.txt", mimeType: "text/plain", bytes: new TextEncoder().encode(physiotherapy.source.quote!) });
  const state = await repository.importDraft(session.token, doc, { items: [physiotherapy, { ...physiotherapy, id: "return", title: "Retorno", category: "other", instruction: "Retorno em 30/10/2026.", source: { ...physiotherapy.source, quote: "Retorno em 30/10/2026." } }], unresolved: [], warnings: [] });
  const [physio, followup] = state.plan.items;
  assert.equal(hasReviewedSchedule(physio), false);
  assert.equal(scheduledOnDate(physio, "2026-10-23"), false, "source text alone never creates today's task");
  await assert.rejects(repository.mutate(session.token, { type: "confirm_item", itemId: physio.id, requestId: req() }), /dias da rotina/);
  for (const [item, schedule] of [
    [physio, { ...times, period: { startDate: "2026-10-26", endDate: "2026-11-15" }, recurrence: { kind: "weekly", weekdays: [1, 4] } }],
    [followup, { ...times, recurrence: { kind: "dates", dates: ["2026-10-30"] } }],
  ] as const) {
    await repository.mutate(session.token, { type: "update_item", itemId: item.id, title: item.title, instruction: item.instruction, fields: item.fields, questions: [], schedule, requestId: req() });
    await repository.mutate(session.token, { type: "confirm_item", itemId: item.id, requestId: req() });
  }
  await repository.mutate(session.token, { type: "confirm_source_pages", requestId: req() });
  const active = await repository.mutate(session.token, { type: "activate_plan", requestId: req() });
  assert.equal(active.tasks.length, 0, "23 Oct has neither the future treatment nor return");
  for (const [date, titles] of [["2026-10-26", ["Fisioterapia"]], ["2026-10-27", []], ["2026-10-29", ["Fisioterapia"]], ["2026-10-30", ["Retorno"]], ["2026-10-31", []], ["2026-11-16", []]] as const) {
    now = new Date(`${date}T15:00:00Z`);
    const renewed = await repository.startDemo({ scenario: "ready", role: "caregiver", demoId: active.demoId });
    assert.deepEqual(renewed.state.tasks.map((task) => task.title), titles, date);
    if (date === "2026-10-26") {
      await repository.mutate(renewed.token, { type: "record_task", taskId: renewed.state.tasks[0].id, status: "done", requestId: req() });
    }
  }
  const db = createClient({ url: pathToFileURL(path.join(dataDir, "care.sqlite")).href });
  t.after(() => db.close());
  const stored = JSON.parse(String((await db.execute({ sql: "SELECT state_json FROM care_cases WHERE id = ?", args: [active.demoId] })).rows[0].state_json)) as StoredState;
  assert.equal(stored.plan.items[0].instruction, physiotherapy.instruction);
  assert.deepEqual(stored.plan.items[0].fields, physiotherapy.fields);
  assert.equal(stored.tasks.find((task) => task.referenceDate === "2026-10-26")?.status, "done");
  assert.equal(stored.tasks.filter((task) => task.itemId === followup.id).length, 1);
});

test("legacy pending tasks and future IDs cannot be completed; history and human recovery survive", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "care-legacy-schedule-"));
  const now = new Date("2026-10-23T15:00:00Z");
  const repository = new CareRepository({ dataDir, now: () => now });
  t.after(() => repository.close());
  const session = await repository.startDemo({ scenario: "ready", role: "caregiver" });
  const db = createClient({ url: pathToFileURL(path.join(dataDir, "care.sqlite")).href });
  t.after(() => db.close());
  const stored = JSON.parse(String((await db.execute({ sql: "SELECT state_json FROM care_cases WHERE id = ?", args: [session.state.demoId] })).rows[0].state_json)) as StoredState;
  const item = stored.plan.items.find((entry) => entry.category === "activity")!;
  delete item.schedule!.recurrence;
  const staleTask = stored.tasks.find((entry) => entry.itemId === item.id)!;
  stored.tasks.push({ ...staleTask, id: "future-forged", referenceDate: "2026-10-26" });
  const historical = { ...staleTask, id: "past-record", referenceDate: "2026-10-22", status: "done" as const };
  stored.tasks.push(historical);
  await db.execute({ sql: "UPDATE care_cases SET state_json = ? WHERE id = ?", args: [JSON.stringify(stored), stored.demoId] });
  assert.equal((await repository.getState(session.token)).tasks.some((task) => task.itemId === item.id), false);
  await assert.rejects(repository.mutate(session.token, { type: "record_task", taskId: staleTask.id, status: "done", requestId: req() }), /fora do período ou dos dias/);
  await assert.rejects(repository.mutate(session.token, { type: "record_task", taskId: "future-forged", status: "done", requestId: req() }), /não esteja no futuro/);
  const schedule = { ...item.schedule!, recurrence: { kind: "reference" as const } };
  const patient = await repository.startDemo({ scenario: "ready", role: "patient", demoId: stored.demoId });
  await assert.rejects(repository.mutate(patient.token, { type: "confirm_item_schedule", itemId: item.id, schedule, requestId: req() }), /Somente o cuidador/);
  await assert.rejects(repository.mutate(session.token, { type: "confirm_item_schedule", itemId: item.id, schedule: { ...schedule, period: { startDate: "2026-10-24", endDate: null } }, requestId: req() }), /Preserve o período/);
  const repaired = await repository.mutate(session.token, { type: "confirm_item_schedule", itemId: item.id, schedule, requestId: req() });
  assert.equal(repaired.tasks.some((task) => task.itemId === item.id), false);
  await assert.rejects(repository.mutate(session.token, { type: "confirm_item_schedule", itemId: item.id, schedule, requestId: req() }), /ainda não conferida/);
  const persisted = JSON.parse(String((await db.execute({ sql: "SELECT state_json FROM care_cases WHERE id = ?", args: [stored.demoId] })).rows[0].state_json)) as StoredState;
  assert.deepEqual(persisted.tasks, stored.tasks, "repair must not delete or rewrite any occurrence");
  assert.equal(persisted.plan.items.find((entry) => entry.id === item.id)?.instruction, item.instruction);
});

test("recurrence validates actual dates and days; daily and reference are explicit choices", () => {
  for (const recurrence of [{ kind: "weekly", weekdays: [] }, { kind: "weekly", weekdays: [1, 1] }, { kind: "weekly", weekdays: [7] }, { kind: "dates", dates: ["2026-02-30"] }, { kind: "dates", dates: ["2026-10-30", "2026-10-30"] }]) {
    assert.throws(() => parseAction({ type: "update_item", itemId: "x", title: "x", instruction: "x", fields: {}, questions: [], schedule: { ...times, recurrence }, requestId: req() }), /Ação inválida/);
  }
  const daily: DraftItem = { ...physiotherapy, schedule: { ...times, period: { startDate: "2026-10-23", endDate: "2026-10-24" }, recurrence: { kind: "daily" } } };
  assert.equal(scheduledOnDate(daily, "2026-10-23"), true);
  assert.equal(scheduledOnDate(daily, "2026-10-25"), false);
  assert.equal(scheduledOnDate({ ...daily, schedule: { ...times, recurrence: { kind: "daily" } } }, "2026-10-23"), false);
  assert.equal(scheduledOnDate({ ...daily, schedule: { ...times, recurrence: { kind: "reference" } } }, "2026-10-23"), false);
});
