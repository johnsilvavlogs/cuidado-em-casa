import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { CareRepository } from "../src/lib/server/care-repository";
import { applyAction, dateInBrazil, ensureTodayTasks, parseAction, type StoredState } from "../src/lib/server/care-domain";
import { scheduledOnDate } from "../src/lib/schedule-period";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "care-plan-period-"));
let now = new Date("2026-10-24T02:59:59.999Z");
let repository = new CareRepository({ dataDir, now: () => now });
const sql = createClient({ url: pathToFileURL(path.join(dataDir, "care.sqlite")).href });
const requestId = () => crypto.randomUUID();
const readStored = async (id: string) => JSON.parse(String((await sql.execute({ sql: "SELECT state_json FROM care_cases WHERE id = ?", args: [id] })).rows[0].state_json)) as StoredState;
try {
  let session = await repository.startDemo({ scenario: "ready", role: "caregiver" });
  const caseId = session.state.demoId;
  const medication = session.state.plan.items.find((item) => item.category === "medication")!;
  assert.deepEqual(medication.schedule?.period, { startDate: "2026-10-23", endDate: "2026-10-29" });
  assert.equal(session.state.tasks.length, 4);
  assert.equal(dateInBrazil(now), "2026-10-23");
  now = new Date("2026-10-30T02:59:59.999Z");
  session = await repository.startDemo({ scenario: "ready", role: "caregiver", demoId: caseId });
  assert.equal(session.state.tasks.filter((task) => task.itemId === medication.id).length, 2, "inclusive seventh day");
  now = new Date("2026-10-30T03:00:00.000Z");
  const ended = await repository.getState(session.token);
  assert.equal(ended.tasks.filter((task) => task.itemId === medication.id).length, 0, "no medication after final local date");
  assert.equal(ended.tasks.length, 2, "unrelated nutrition/activity remain");
  assert.equal((await readStored(caseId)).tasks.filter((task) => task.itemId === medication.id).length, 4, "prior records preserved");
  now = new Date("2026-10-31T15:00:00Z");
  session = await repository.startDemo({ scenario: "ready", role: "caregiver", demoId: caseId });
  assert.equal(session.state.tasks.filter((task) => task.itemId === medication.id).length, 0, "reported ninth-day regression");
  const repeat = await repository.getState(session.token);
  assert.deepEqual(repeat.tasks, session.state.tasks, "same-day generation is idempotent");

  // Emulate an old persisted active plan, including an already generated unsafe task.
  const legacy = await readStored(caseId);
  delete legacy.plan.items[0].schedule!.period;
  const pending = { ...legacy.tasks.find((task) => task.itemId === medication.id)!, id: `2026-10-31:${medication.id}:0`, referenceDate: "2026-10-31", status: "pending" as const };
  legacy.tasks.push(pending);
  await sql.execute({ sql: "UPDATE care_cases SET state_json = ? WHERE id = ?", args: [JSON.stringify(legacy), caseId] });
  const originalInstruction = legacy.plan.items[0].instruction;
  assert.equal((await repository.getState(session.token)).tasks.length, 2, "legacy missing period hides pending medication only");
  await assert.rejects(repository.mutate(session.token, { type: "record_task", taskId: pending.id, status: "done", requestId: requestId() }), /fora do período/);
  assert.deepEqual(await readStored(caseId), legacy, "suppression does not rewrite or delete legacy records");
  const patient = await repository.startDemo({ scenario: "ready", role: "patient", demoId: caseId });
  const periodAction = { type: "confirm_item_period", itemId: medication.id, period: { startDate: "2026-10-23", endDate: "2026-10-29" }, requestId: requestId() };
  await assert.rejects(repository.mutate(patient.token, periodAction), /Somente o cuidador/);
  await repository.mutate(session.token, periodAction);
  const repaired = await readStored(caseId);
  assert.equal(repaired.plan.items[0].instruction, originalInstruction);
  assert.deepEqual(repaired.tasks, legacy.tasks, "period review retains every original occurrence");
  assert.match(repaired.timeline[0].text, /período.*23\/10\/2026 a 29\/10\/2026/);
  await assert.rejects(repository.mutate(session.token, { ...periodAction, requestId: requestId() }), /Somente o período ainda não conferido/);
  const audit = await sql.execute({ sql: "SELECT before_json, after_json FROM audit_events WHERE case_id = ? AND event_type = 'confirm_item_period'", args: [caseId] });
  assert.equal(audit.rows.length, 1);
  assert.deepEqual(JSON.parse(String(audit.rows[0].before_json)).tasks, legacy.tasks);
  await repository.close();
  repository = new CareRepository({ dataDir, now: () => now });
  assert.equal((await repository.getState(session.token)).tasks.length, 2, "cold persistence still enforces expiry");

  for (const period of [{ startDate: "2026-02-30", endDate: null }, { startDate: "2026-10-24", endDate: "2026-10-23" }]) {
    assert.throws(() => parseAction({ ...periodAction, period }), /Ação inválida/);
  }
  const beforeStart = structuredClone(repaired);
  beforeStart.tasks = [];
  beforeStart.plan.items[0].schedule!.period = { startDate: "2026-12-31", endDate: "2027-01-01" };
  ensureTodayTasks(beforeStart, new Date("2026-12-31T02:59:59Z"));
  assert.equal(beforeStart.tasks.filter((task) => task.itemId === medication.id).length, 0);
  ensureTodayTasks(beforeStart, new Date("2026-12-31T03:00:00Z"));
  assert.equal(beforeStart.tasks.filter((task) => task.itemId === medication.id).length, 2, "first day inclusive across year boundary");
  assert.equal(scheduledOnDate(beforeStart.plan.items[0], "2027-01-01"), true);
  assert.equal(scheduledOnDate(beforeStart.plan.items[0], "2027-01-02"), false);
  beforeStart.plan.items[0].schedule!.period = { startDate: "2028-02-29", endDate: null };
  assert.equal(scheduledOnDate(beforeStart.plan.items[0], "2028-02-28"), false);
  assert.equal(scheduledOnDate(beforeStart.plan.items[0], "2028-02-29"), true, "explicit ongoing period accepts leap date");
  assert.equal(scheduledOnDate(beforeStart.plan.items[0], "2030-01-01"), true);

  const draft = structuredClone(legacy);
  draft.plan.status = "draft";
  draft.plan.items[0].confirmed = false;
  assert.throws(() => applyAction(draft, "caregiver", { type: "confirm_item", itemId: medication.id, requestId: requestId() }, now), /início e o término/);
  assert.throws(() => applyAction(draft, "caregiver", { type: "activate_plan", requestId: requestId() }, now), /Confira cada cuidado/);
  console.log("PASS: seven-day expiry, São Paulo midnight, inclusive start/end, year/leap dates, explicit ongoing, invalid dates, legacy suppression/review/lock, authorization, history/audit, persistence and unrelated tasks.");
} finally {
  await repository.close();
  sql.close();
}
