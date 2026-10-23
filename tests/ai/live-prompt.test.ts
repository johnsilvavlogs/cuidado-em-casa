import assert from "node:assert/strict";
import test from "node:test";
import type { CareState } from "../../src/lib/contracts";
import { buildLiveSessionConfig, buildVoiceQuestions } from "../../src/lib/ai/live";
import { buildVoiceContext, buildVoiceContextUpdates } from "../../src/lib/voice-context";

const state: CareState = {
  demoId: "prompt-test", plan: { status: "active", items: [], unresolved: [], warnings: [], sourceReviewed: true }, document: null, helpRequests: [], timeline: [],
  role: "patient", patient: { name: "Pessoa", caregiverName: "Cuidador" }, revision: 2, updatedAt: "2026-10-23T15:00:00Z", checkIns: [],
  tasks: [
    { id: "past", itemId: "past-item", title: "Cuidado registrado", instruction: "Fonte confirmada", recordedAt: "2026-10-23T11:00:00Z", time: "08:00", status: "done", priority: "important", referenceDate: "2026-10-23" },
    { id: "future", itemId: "future-item", title: "Próximo cuidado", instruction: "Fonte confirmada", recordedAt: null, time: "20:00", status: "pending", priority: "normal", referenceDate: "2026-10-23" },
  ],
};

test("full context exposes the current Brazil clock, explicit priorities and unchanged task statuses", () => {
  const context = JSON.parse(buildVoiceContext(state, new Date("2026-10-23T16:00:00Z")).split("\n")[1]);
  assert.deepEqual(context.clock, { timeZone: "America/Sao_Paulo", localDate: "2026-10-23", localTime: "13:00:00" });
  assert.deepEqual(context.tasks.map(({ id, priority, status }: { id: string; priority: string; status: string }) => ({ id, priority, status })), [
    { id: "past", priority: "important", status: "done" },
    { id: "future", priority: "normal", status: "pending" },
  ]);
});

test("context updates preserve IDs and priority within the existing chunk bound", () => {
  const updates = buildVoiceContextUpdates({ ...state, tasks: Array.from({ length: 30 }, (_, index) => ({ ...state.tasks[index % 2], id: `id-${index}`, title: `Cuidado ${index} ${"á".repeat(180)}` })) }, new Date("2026-10-23T16:00:00Z"));
  assert.ok(updates.every((chunk) => chunk.length < 850));
  assert.match(updates.join("\n"), /2026-10-23 13:00:00/);
  assert.match(updates.join("\n"), /"id":"id-29"/);
  assert.match(updates.join("\n"), /"priority":"important"/);
  assert.match(updates.join("\n"), /"status":"done"/);
});

test("full and incremental voice context preserve approximate sleep and select the newest report", () => {
  const ranged: CareState = { ...state, checkIns: [
    { id: "newest", author: "patient", createdAt: "2026-10-23T15:00:00Z", referenceDate: "2026-10-23", sleepRange: "around6", sleepMinutes: null, sleepQuality: "okay", food: null, mood: null },
    { id: "older", author: "patient", createdAt: "2026-10-22T15:00:00Z", referenceDate: "2026-10-22", sleepMinutes: 480, sleepQuality: "high", food: "yes", mood: null },
  ] };
  const full = buildVoiceContext(ranged, new Date("2026-10-23T16:00:00Z"));
  const data = JSON.parse(full.split("\n")[1]);
  assert.equal(data.checkIns[0].sleepRange, "around6");
  assert.equal(data.checkIns[0].sleepMinutes, null);
  assert.equal(data.checkIns[0].sleepDurationLabel, "Cerca de 6 horas");
  assert.equal(data.checkIns[1].sleepDurationLabel, "8h00");
  assert.match(full, /sem converter em minutos exatos/);
  const updates = buildVoiceContextUpdates(ranged, new Date("2026-10-23T16:00:00Z"));
  assert.ok(updates.every((chunk) => chunk.length < 850));
  const joined = updates.join("\n");
  assert.match(joined, /"data":"2026-10-23"/);
  assert.match(joined, /"faixaSono":"around6"/);
  assert.match(joined, /"duracaoSono":"Cerca de 6 horas"/);
  assert.match(joined, /"minutos":null/);
  assert.doesNotMatch(joined, /"minutos":480/);
  assert.match(joined, /não converta em minutos exatos/);
});

test("conversational guidance keeps the same Decisions delegation and trigger contracts", () => {
  const config = buildLiveSessionConfig(state);
  const questions = buildVoiceQuestions(state);
  assert.equal(config.delegation?.type, "decisions");
  if (config.delegation?.type === "decisions") assert.deepEqual(config.delegation.decisions.questions, questions);
  assert.deepEqual(config.triggers?.[0].decisions.questions, questions);
  assert.match(config.instructions ?? "", /UM único cuidado pending/);
  assert.match(config.instructions ?? "", /lista completa somente se a pessoa pedir explicitamente/);
  assert.match(config.instructions ?? "", /ainda está sem registro/);
  assert.match(config.instructions ?? "", /Nunca sugira repetir done nem compensar not_done/);
});
