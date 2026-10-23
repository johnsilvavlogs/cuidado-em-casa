import assert from "node:assert/strict";
import test from "node:test";
import type { CareState } from "../../src/lib/contracts";
import { confirmedVoiceAction, readVoiceCommand } from "../../src/lib/voice-command";
const state = {
  role: "patient", plan: { status: "active" },
  tasks: [{ id: "med-08", title: "Medicamento A", time: "08:00" }, { id: "med-20", title: "Medicamento A", time: "20:00" }],
  checkIns: [{ id: "today", referenceDate: "2026-10-23", author: "patient", sleepMinutes: 390, sleepQuality: "okay", food: null, mood: "good" }],
} as unknown as CareState;
const event = (action: string, task = "none") => ({ type: "decision.event", delegation_id: "delegation-1", event: { type: "decision.completed", decision: { id: "decision-1", answers: [{ name: "action", choice: action }, { name: "task", choice: task }] } } });
test("only completed, supported and unambiguous decisions can propose a record", () => {
  assert.equal(readVoiceCommand(event("none"), "r"), null);
  assert.equal(readVoiceCommand(event("mark_done"), "r"), null);
  assert.equal(readVoiceCommand(event("change_dose", "med-08"), "r"), null);
  assert.equal(readVoiceCommand({ ...event("mark_done", "med-08"), type: "decision.created" }, "r"), null);
});
test("native trigger decisions use the server event ID without inventing a decision ID", () => {
  const native = { ...event("mark_done", "med-08"), event_id: "evt-real", delegation_id: null, source_event_type: "session.input_transcript.delta", source_event_id: "input-1", trigger_id: "trigger-1" };
  delete (native.event.decision as { id?: string }).id;
  const first = readVoiceCommand(native, "request-1")!;
  const duplicate = readVoiceCommand(native, "request-2")!;
  assert.equal(first.decisionId, "evt-real");
  assert.equal(duplicate.decisionId, first.decisionId);
  assert.equal(first.delegationId, null);
});
test("confirmation binds medication to the exact occurrence and reuses the request ID", () => {
  const proposed = readVoiceCommand(event("mark_not_done", "med-20"), "stable-request")!;
  assert.deepEqual(confirmedVoiceAction(proposed, state), { type: "record_task", taskId: "med-20", status: "not_done", requestId: "stable-request" });
  assert.equal(confirmedVoiceAction({ ...proposed, taskId: "unknown" }, state), null);
  assert.equal(confirmedVoiceAction(proposed, { ...state, role: "caregiver" }), null);
});
test("food voice updates preserve sleep and mood from the same person's daily report", () => {
  const proposed = readVoiceCommand(event("food_partial"), "food-request")!;
  assert.deepEqual(confirmedVoiceAction(proposed, state, "2026-10-23"), { type: "check_in", id: "today", referenceDate: "2026-10-23", sleepMinutes: 390, sleepQuality: "okay", food: "partial", mood: "good", requestId: "food-request" });
  const tomorrow = confirmedVoiceAction(proposed, state, "2026-10-24");
  assert.ok(tomorrow?.type === "check_in");
  assert.equal(tomorrow.sleepMinutes, null);
  assert.equal(tomorrow.id, undefined);
});
test("sleep quality remains a reported observation and does not invent hours", () => {
  const proposed = readVoiceCommand(event("sleep_low"), "sleep-request")!;
  const action = confirmedVoiceAction(proposed, { ...state, checkIns: [] }, "2026-10-23");
  assert.ok(action?.type === "check_in");
  assert.equal(action.sleepQuality, "low");
  assert.equal(action.sleepMinutes, null);
  assert.equal(action.food, null);
});
