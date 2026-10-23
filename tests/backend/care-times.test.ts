import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import { pathToFileURL } from "node:url";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DraftItem } from "../../src/lib/contracts";
import { hasExecutableTimes, proposeTimes, timeBlocker, withProposedTimes } from "../../src/lib/schedule-times";
import { CareRepository } from "../../src/lib/server/care-repository";

function item(instruction: string, overrides: Partial<DraftItem> = {}): DraftItem {
  return { id: randomUUID(), title: "Cuidado", category: "medication", instruction, fields: {}, source: { documentId: null, page: null, quote: instruction }, questions: [], confirmed: false, ...overrides };
}
test("source clocks win, intervals keep spacing, frequency keeps count, and vague times are labelled suggestions", () => {
  assert.deepEqual(proposeTimes(item("Tomar às 07:30 e 19:30.")).times, ["07:30", "19:30"]);
  assert.equal(proposeTimes(item("Tomar às 07:30 e 19:30.")).origin, "source");
  assert.deepEqual(proposeTimes(item("Tomar às 08:30 e às 19:45.")).times, ["08:30", "19:45"]);
  assert.deepEqual(proposeTimes(item("Tomar a cada 12 horas iniciando às 07:30.")).times, ["07:30", "19:30"]);
  assert.deepEqual(proposeTimes(item("Tomar às 8 horas.")).times, ["08:00"]);
  assert.deepEqual(proposeTimes(item("Tomar 12/12 horas.")).times, ["08:00", "20:00"]);
  assert.deepEqual(proposeTimes(item("Tomar pela manhã e à noite.")).times, ["08:00", "21:00"]);
  assert.deepEqual(proposeTimes(item("Tomar 1 comprimido de 8 em 8 horas.")).times, ["00:00", "08:00", "16:00"]);
  assert.deepEqual(proposeTimes(item("Tomar 1 comprimido 12/12h.")).times, ["08:00", "20:00"]);
  assert.deepEqual(proposeTimes(item("Aplicar três vezes ao dia.")).times, ["08:00", "14:00", "20:00"]);
  assert.deepEqual(proposeTimes(item("Tomar à noite.")).times, ["21:00"]);
  assert.equal(proposeTimes(item("Caminhar.", { category: "activity" })).origin, "suggested");
  assert.ok(timeBlocker({ ...withProposedTimes(item("Tomar 8/8h.")), schedule: { times: ["08:00", "14:00", "20:00"], priority: "normal", toleranceMinutes: 0 } }));
});
test("conditional care stays optional and unsupported intervals cannot silently become daily", () => {
  assert.deepEqual(proposeTimes(item("Tomar às 08:00 se necessário por dor.")).times, []);
  assert.equal(hasExecutableTimes(withProposedTimes(item("Tomar se necessário."))), false);
  assert.deepEqual(proposeTimes(item("Tomar a cada 36 horas.")).times, []);
  assert.ok(timeBlocker(withProposedTimes(item("Tomar a cada 36 horas."))));
});
test("suggestions are adopted through existing confirmation, edited clocks persist across roles and days", async t => {
  let now = new Date("2026-10-23T12:00:00Z");
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cuidado-times-"));
  const repository = new CareRepository({ dataDir, now: () => now });
  t.after(() => repository.close());
  const caregiver = await repository.startDemo({ scenario: "setup", role: "caregiver" });
  const document = await repository.storeDocument(caregiver.token, { name: "rotina.txt", mimeType: "text/plain", bytes: new TextEncoder().encode("Caminhar. Tomar às 07:30 e 19:30.") });
  let state = await repository.importDraft(caregiver.token, document, { items: [item("Caminhar.", { category: "activity" }), item("Tomar às 07:30 e 19:30.")], unresolved: [], warnings: [] });
  assert.deepEqual(state.plan.items[0].schedule?.times, ["09:00"]);
  assert.deepEqual(state.plan.items[1].schedule?.times, ["07:30", "19:30"]);
  for (const entry of state.plan.items) {
    const schedule = { ...entry.schedule!, period: { startDate: "2026-10-23", endDate: "2026-10-24" }, ...(entry.category !== "medication" ? { recurrence: { kind: "daily" as const } } : {}) };
    state = await repository.mutate(caregiver.token, { type: "update_item", itemId: entry.id, title: entry.title, instruction: entry.instruction, fields: entry.fields, questions: [], schedule, requestId: randomUUID() });
    await repository.mutate(caregiver.token, { type: "confirm_item", itemId: entry.id, requestId: randomUUID() });
  }
  await repository.mutate(caregiver.token, { type: "confirm_source_pages", requestId: randomUUID() });
  state = await repository.mutate(caregiver.token, { type: "activate_plan", requestId: randomUUID() });
  assert.deepEqual(state.tasks.map(task => task.time), ["07:30", "09:00", "19:30"]);
  const patient = await repository.startDemo({ scenario: "ready", role: "patient", demoId: state.demoId });
  assert.deepEqual(patient.state.tasks, state.tasks);
  assert.deepEqual((await repository.getState(patient.token)).plan.items[0].schedule?.times, ["09:00"]);
  now = new Date("2026-10-24T10:00:00Z");
  assert.deepEqual((await repository.getState(patient.token)).tasks.map(task => task.time), ["07:30", "09:00", "19:30"]);
  now = new Date("2026-10-25T10:00:00Z");
  assert.equal((await repository.startDemo({ scenario: "ready", role: "patient", demoId: state.demoId })).state.tasks.length, 0);
});

test("legacy untimed tasks stay suspended until the caregiver confirms times; history is retained", async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cuidado-legacy-times-"));
  const repository = new CareRepository({ dataDir, now: () => new Date("2026-10-23T12:00:00Z") });
  t.after(() => repository.close());
  const session = await repository.startDemo({ scenario: "ready", role: "caregiver" });
  const db = createClient({ url: pathToFileURL(path.join(dataDir, "care.sqlite")).href });
  t.after(() => db.close());
  const stored = JSON.parse(String((await db.execute({ sql: "SELECT state_json FROM care_cases WHERE id = ?", args: [session.state.demoId] })).rows[0].state_json));
  const medication = stored.plan.items.find((entry: DraftItem) => entry.category === "medication");
  medication.schedule.times = [];
  const occurrences = stored.tasks.filter((task: { itemId: string }) => task.itemId === medication.id);
  occurrences[0].time = "A combinar";
  occurrences[1].status = "done";
  occurrences[1].time = "A combinar";
  await db.execute({ sql: "UPDATE care_cases SET state_json = ? WHERE id = ?", args: [JSON.stringify(stored), stored.demoId] });
  const suspended = await repository.getState(session.token);
  assert.deepEqual(suspended.plan.items.find(entry => entry.id === medication.id)?.schedule?.times, []);
  assert.equal(suspended.tasks.filter(task => task.itemId === medication.id && task.status === "pending").length, 0);
  const patient = await repository.startDemo({ scenario: "ready", role: "patient", demoId: stored.demoId });
  await assert.rejects(repository.mutate(patient.token, { type: "confirm_item_times", itemId: medication.id, times: ["07:30", "19:30"], requestId: randomUUID() }), /Somente o cuidador/);
  const resumed = await repository.mutate(session.token, { type: "confirm_item_times", itemId: medication.id, times: ["07:30", "19:30"], requestId: randomUUID() });
  assert.equal(resumed.tasks.find(task => task.id === occurrences[0].id)?.time, "07:30");
  assert.equal(resumed.tasks.find(task => task.id === occurrences[1].id)?.time, "A combinar", "past record remains intact");
  assert.equal(resumed.plan.items.find(entry => entry.id === medication.id)?.instruction, medication.instruction);
  await assert.rejects(repository.mutate(session.token, { type: "confirm_item_times", itemId: medication.id, times: ["06:00"], requestId: randomUUID() }), /Somente horários ausentes/);
});
