import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import type { CareAction, SleepRange } from "../../src/lib/contracts";
import { parseAction, parseActionRequest } from "../../src/lib/server/care-domain";
import { CareError, CareRepository } from "../../src/lib/server/care-repository";
import { sleepDurationLabel, sleepRangeLabels } from "../../src/lib/sleep-duration";

async function fixture(t: TestContext) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cuidado-sleep-range-"));
  const repository = new CareRepository({ dataDir, now: () => new Date("2026-10-23T15:00:00Z") });
  t.after(() => repository.close());
  const patient = await repository.startDemo({ scenario: "ready", role: "patient" });
  return { repository, patient, dataDir };
}

function report(overrides: Partial<Extract<CareAction, { type: "check_in" }>> = {}): Extract<CareAction, { type: "check_in" }> {
  return { type: "check_in", sleepMinutes: null, sleepQuality: null, food: null, mood: null, referenceDate: "2026-10-23", requestId: randomUUID(), ...overrides };
}

test("each approximate duration persists without invented minutes and is visible to the caregiver", async (t) => {
  const { repository, patient, dataDir } = await fixture(t);
  for (const range of Object.keys(sleepRangeLabels) as SleepRange[]) {
    const action = report({ sleepRange: range });
    const saved = await repository.mutate(patient.token, action);
    assert.equal(saved.checkIns[0].sleepRange, range);
    assert.equal(saved.checkIns[0].sleepMinutes, null);
    assert.ok(saved.timeline[0].text.includes(sleepRangeLabels[range]));
    assert.doesNotMatch(saved.timeline[0].text, /sono não informado/);
    const retry = await repository.mutate(patient.token, action);
    assert.equal(retry.revision, saved.revision);
    assert.equal(retry.checkIns.length, saved.checkIns.length);
  }
  const reopened = new CareRepository({ dataDir, now: () => new Date("2026-10-23T16:00:00Z") });
  t.after(() => reopened.close());
  const caregiver = await reopened.startDemo({ scenario: "ready", role: "caregiver", demoId: patient.state.demoId });
  assert.deepEqual(caregiver.state.checkIns.map(({ sleepRange, sleepMinutes }) => ({ sleepRange, sleepMinutes })), [
    { sleepRange: "8plus", sleepMinutes: null },
    { sleepRange: "around6", sleepMinutes: null },
    { sleepRange: "under4", sleepMinutes: null },
  ]);
});

test("correcting a range to exact minutes and back replaces the duration on the same report", async (t) => {
  const { repository, patient } = await fixture(t);
  let state = await repository.mutate(patient.token, report({ sleepRange: "under4" }));
  const { id, createdAt } = state.checkIns[0];
  // Legacy callers omit sleepRange. Their exact value must clear the old range.
  state = await repository.mutate(patient.token, report({ id, sleepMinutes: 390 }));
  assert.equal(state.checkIns.length, 1);
  assert.equal(state.checkIns[0].sleepRange, null);
  assert.equal(state.checkIns[0].sleepMinutes, 390);
  assert.equal(sleepDurationLabel(state.checkIns[0]), "6h30");
  assert.match(state.timeline[0].text, /corrigiu.*6h30/);
  state = await repository.mutate(patient.token, report({ id, sleepRange: "around6" }));
  assert.equal(state.checkIns.length, 1);
  assert.equal(state.checkIns[0].sleepRange, "around6");
  assert.equal(state.checkIns[0].sleepMinutes, null);
  assert.equal(state.checkIns[0].createdAt, createdAt);
  assert.equal(sleepDurationLabel(state.checkIns[0]), "Cerca de 6 horas");
  assert.match(state.timeline[0].text, /corrigiu.*Cerca de 6 horas/);
});

test("invalid mixed durations and empty reports cannot mutate state", async (t) => {
  const { repository, patient } = await fixture(t);
  const invalid = [
    report({ sleepRange: "under4", sleepMinutes: 0 }),
    report({ sleepRange: "around6", sleepMinutes: 360 }),
    { ...report(), sleepRange: "exactly6" },
    report({ sleepRange: null }),
  ];
  for (const action of invalid) {
    await assert.rejects(repository.mutate(patient.token, action), (error: unknown) => error instanceof CareError && error.status === 400);
  }
  assert.equal((await repository.getState(patient.token)).revision, patient.state.revision);
  assert.throws(() => parseActionRequest({ context: { demoId: patient.state.demoId, role: "patient" }, action: invalid[0] }), CareError);
  const legacyInput = report({ sleepMinutes: 0 });
  const legacy = parseAction(legacyInput);
  assert.ok(legacy.type === "check_in");
  // Keeping omitted fields omitted preserves fingerprints of pre-upgrade retries.
  assert.deepEqual(legacy, legacyInput);
  assert.equal(legacy.sleepRange, undefined);
  const saved = await repository.mutate(patient.token, legacy);
  assert.equal(saved.checkIns[0].sleepMinutes, 0);
  assert.equal(saved.checkIns[0].sleepRange, null);
});
