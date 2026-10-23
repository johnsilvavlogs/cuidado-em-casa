import assert from "node:assert/strict";
import test from "node:test";
import { buildLiveSessionConfig, buildVoiceQuestions, VOICE_ACTIONS } from "../../src/lib/ai/live";
import type { CareState } from "../../src/lib/contracts";

const state = { role: "patient", tasks: [] } as unknown as CareState;
test("an empty routine never submits an invalid one-option choice question", () => {
  const questions = buildVoiceQuestions(state);
  assert.equal(questions.length, 1);
  for (const question of questions) if (question.type === "choice") assert.ok(question.choices.length >= 2);
});
test("Live does not store audio and requires confirmation before a claimed action", () => {
  const config = buildLiveSessionConfig(state);
  assert.equal(config.store, false);
  assert.equal(config.delegation?.type, "decisions");
  assert.match(config.instructions ?? "", /confirmar na tela/);
  assert.match(config.instructions ?? "", /Nunca diagnostique/);
});

test("action choices expose food reports and only current routine IDs are selectable", () => {
  const withTasks = { ...state, tasks: [
    { id: "med-am", title: "Medicamento da manhã", time: "08:00", instruction: "Conforme plano confirmado." },
    { id: "med-pm", title: "Medicamento da noite", time: "20:00", instruction: "Conforme plano confirmado." },
  ] } as unknown as CareState;
  const [action, task] = buildVoiceQuestions(withTasks);
  assert.equal(action.type, "choice");
  assert.equal(task.type, "choice");
  if (action.type !== "choice" || task.type !== "choice") return;
  assert.deepEqual(action.choices.map((choice) => choice.value), [...VOICE_ACTIONS]);
  assert.deepEqual(task.choices.map((choice) => choice.value), ["med-am", "med-pm", "none"]);
  assert.equal(new Set(action.choices.map((choice) => choice.value)).size, action.choices.length);
  assert.ok(["food_yes", "food_partial", "food_no"].every((choice) => action.choices.some((option) => option.value === choice)));
});
