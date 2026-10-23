import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DailyCare from "../../src/components/daily-care";
import { createDemoState } from "../../src/lib/server/care-demo";
import type { CareState, Role } from "../../src/lib/contracts";

function renderRoutine(role: Role) {
  const state: CareState = {
    ...createDemoState("role-check", "ready", { id: "source", name: "Plano fictício", mimeType: "text/plain", url: "/api/documents/source", pageCount: 1 }, new Date()),
    role,
  };
  return renderToStaticMarkup(createElement(DailyCare, {
    state, busy: false, run: async () => true, onVoice: () => {}, onHistory: () => {},
  }));
}

test("only the patient can open a new support request from the routine", () => {
  const caregiver = renderRoutine("caregiver");
  const patient = renderRoutine("patient");
  assert.doesNotMatch(caregiver, />Pedir ajuda<\/button>/);
  assert.match(patient, />Pedir ajuda<\/button>/);
  assert.match(caregiver, />Ver pedidos de ajuda<\/button>/);
  assert.match(caregiver, />Ver pedidos<\/button>/);
});
