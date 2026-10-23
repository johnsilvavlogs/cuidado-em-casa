import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PlanPanel, { completeCareConfirmation, ReviewDialog } from "../../src/components/plan-panel";
import { createDemoState } from "../../src/lib/server/care-demo";
import type { CareState } from "../../src/lib/contracts";

function draft(): CareState {
  const state: CareState = { ...createDemoState("plan-flow", "ready", { id: "source", name: "Orientações.pdf", mimeType: "application/pdf", pageCount: 1, url: "/api/documents/source" }, new Date("2026-10-23T15:00:00Z")), role: "caregiver" };
  state.plan.status = "draft";
  state.plan.sourceReviewed = false;
  state.plan.items.forEach(item => { item.confirmed = false; });
  return state;
}
function render(state: CareState) {
  return renderToStaticMarkup(createElement(PlanPanel, { state, busy: false, run: async () => true, onImport: async () => true }));
}
function activateTag(html: string) {
  return html.match(/<button[^>]*data-plan-action="activate"[^>]*>/)?.[0] ?? "";
}

test("imported draft places collapsed individual review before batch confirmation and replacement last", () => {
  const html = render(draft());
  assert.match(html, /Encontramos 3 cuidados/);
  const individual = html.match(/<details[^>]*data-plan-review="individual"[^>]*>/)?.[0] ?? "";
  assert.ok(individual);
  assert.doesNotMatch(individual, /\bopen(?:=|\s|>)/);
  assert.ok(html.indexOf("Ver documento original") < html.indexOf('data-plan-summary="found"'));
  assert.ok(html.indexOf('data-plan-review="individual"') < html.indexOf('data-plan-review="quick"'));
  assert.ok(html.indexOf('data-plan-action="activate"') < html.indexOf('data-plan-source="replace"'));
  assert.equal((html.match(/data-plan-action="confirm-items"/g) ?? []).length, 1);
  assert.match(activateTag(html), /disabled/);
});

test("batch count excludes doubtful items and activation retains source and schedule gates", () => {
  const state = draft();
  state.plan.items[0].questions = ["Conferir a dose no original."];
  const pending = render(state);
  assert.match(pending, /Confirmar 2 itens conferidos/);
  assert.match(pending, /Os itens com dúvidas continuam pendentes/);
  assert.match(pending.match(/<button[^>]*data-plan-action="confirm-items"[^>]*>/)?.[0] ?? "", /disabled/);
  state.plan.items[0].questions = [];
  state.plan.items.forEach(item => { item.confirmed = true; });
  state.plan.sourceReviewed = true;
  assert.doesNotMatch(activateTag(render(state)), /disabled/);
  state.plan.items[1].schedule = undefined;
  assert.match(activateTag(render(state)), /disabled/);
});

test("active plan keeps its care list available without draft confirmation controls", () => {
  const state = draft();
  state.plan.status = "active";
  const html = render(state);
  assert.match(html, /3 cuidados no plano/);
  assert.doesNotMatch(html, /data-plan-review="individual"|data-plan-review="quick"|data-plan-source="replace"/);
  assert.match(html, /Ver orientação e fonte/);
});

test("successful confirmation saves first, confirms once, then closes", async () => {
  const calls: string[] = [];
  assert.equal(await completeCareConfirmation({ save: async () => { calls.push("save"); return true; }, confirm: async () => { calls.push("confirm"); return true; }, onClose: () => { calls.push("close"); } }), true);
  assert.deepEqual(calls, ["save", "confirm", "close"]);
});

test("failed save never confirms and failed confirmation keeps the dialog open", async () => {
  const calls: string[] = [];
  assert.equal(await completeCareConfirmation({ save: async () => false, confirm: async () => { calls.push("confirm"); return true; }, onClose: () => calls.push("close") }), false);
  assert.deepEqual(calls, []);
  assert.equal(await completeCareConfirmation({ confirm: async () => false, onClose: () => calls.push("close") }), false);
  assert.deepEqual(calls, []);
});

test("review exposes one confirmation action and no separate save button, including collapsed content", () => {
  const state = draft();
  const html = renderToStaticMarkup(createElement(ReviewDialog, { item: state.plan.items[0], state, busy: false, run: async () => true, onClose: () => {} }));
  assert.match(html, /Confirmar cuidado/);
  assert.match(html, /Corrigir informações/);
  assert.match(html, /Ver no documento/);
  assert.doesNotMatch(html, /Salvar correções/);
  const confirmed = state.plan.items[0]; confirmed.confirmed = true;
  const reviewed = renderToStaticMarkup(createElement(ReviewDialog, { item: confirmed, state, busy: false, run: async () => true, onClose: () => {} }));
  assert.match(reviewed, /Voltar para os cuidados/);
  assert.doesNotMatch(reviewed, /Confirmar cuidado/);
});
