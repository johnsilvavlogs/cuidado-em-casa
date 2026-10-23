import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { CareState } from "../../src/lib/contracts";

const base = process.env.CARE_E2E_BASE_URL || "http://127.0.0.1:3000";
const presetNames = ["Menos de 4 horas", "Cerca de 6 horas", "8 horas ou mais"];

async function readState(context: BrowserContext): Promise<CareState> {
  const response = await context.request.get("/api/state");
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

async function openReport(page: Page) {
  await page.locator('[data-parity-anchor="wellbeing-action"]').click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

async function keyboardReach(page: Page, target: Locator) {
  for (let index = 0; index < 40; index++) {
    if (await target.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Sleep preset is not reachable by Tab within the dialog.");
}

async function checkPresetLayout(page: Page, dialog: Locator, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await expect(dialog.getByRole("group", { name: "Tempo de sono" }).getByRole("button")).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: "Outro tempo", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("spinbutton")).toHaveCount(0);
  const sleepCard = dialog.locator('.sleep-card');
  const layout = await sleepCard.evaluate(card => ({
    bottom: card.getBoundingClientRect().bottom,
    contentBottom: Math.max(...Array.from(card.children, child => child.getBoundingClientRect().bottom)),
  }));
  expect(layout.contentBottom, 'sleep choices stay inside their card').toBeLessThanOrEqual(layout.bottom);
  for (const name of presetNames) {
    const button = dialog.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    const bounds = await button.boundingBox();
    expect(bounds, name).not.toBeNull();
    expect(bounds!.x, `${name}: left edge`).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width, `${name}: right edge`).toBeLessThanOrEqual(width + 1);
    expect(bounds!.height, `${name}: touch target`).toBeGreaterThanOrEqual(44);
  }
}

async function saveReport(page: Page, dialog: Locator) {
  const saved = page.waitForResponse(response => response.url().endsWith("/api/actions") && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Salvar relato", exact: true }).click();
  const response = await saved;
  expect(response.status(), await response.text()).toBe(200);
  await expect(dialog).toHaveCount(0);
}

for (const width of [390, 320]) {
  test(`mobile-sleep-presets-${width}-shared-persistence-and-keyboard`, async ({ page, browser }, info) => {
    await page.setViewportSize({ width, height: 844 });
    const started = await page.request.post("/api/demo", { data: { scenario: "ready", role: "patient" }, headers: { Origin: base } });
    expect(started.status(), await started.text()).toBe(200);
    const initial = await started.json() as CareState;
    await page.goto(`/?demo=${initial.demoId}&role=patient`);
    await expect(page.locator('[data-parity-screen="patient-routine"]')).toBeVisible();

    const caregiver = await browser.newContext({ baseURL: base, viewport: { width, height: 844 }, timezoneId: "America/Sao_Paulo" });
    const actions: Record<string, unknown>[] = [];
    page.on("request", request => {
      if (request.url().endsWith("/api/actions") && request.method() === "POST") actions.push(request.postDataJSON().action);
    });
    try {
      const linked = await caregiver.request.post("/api/demo", { data: { scenario: "ready", role: "caregiver", demoId: initial.demoId }, headers: { Origin: base } });
      expect(linked.status(), await linked.text()).toBe(200);
      const carePage = await caregiver.newPage();
      await carePage.goto(`/?demo=${initial.demoId}&role=caregiver`);
      await expect(carePage.locator('[data-parity-screen="caregiver-routine"]')).toBeVisible();
      const caregiverSummary = carePage.locator('[data-parity-anchor="wellbeing-summary"]');

      let dialog = await openReport(page);
      await expect(dialog.getByRole("spinbutton", { name: "Horas", exact: true })).toHaveCount(0);
      await expect(dialog.getByRole("spinbutton", { name: "Minutos", exact: true })).toHaveCount(0);
      await checkPresetLayout(page, dialog, width);
      const lessThanFour = dialog.getByRole("button", { name: "Menos de 4 horas", exact: true });
      await keyboardReach(page, lessThanFour);
      await page.keyboard.press("Enter");
      await expect(lessThanFour).toHaveAttribute("aria-pressed", "true");
      for (const name of ["Pouco", "Suficiente", "Muito"]) {
        await expect(dialog.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "false");
      }
      expect((await readState(caregiver)).checkIns).toHaveLength(0);
      await page.screenshot({ path: info.outputPath(`sleep-${width}-under4-before-save.png`), scale: "css" });
      await saveReport(page, dialog);
      await expect(caregiverSummary).toContainText("Menos de 4 horas");
      const first = (await readState(caregiver)).checkIns[0];
      expect(first).toMatchObject({ author: "patient", sleepRange: "under4", sleepMinutes: null, sleepQuality: null, food: null, mood: null });

      await page.reload();
      await carePage.reload();
      await expect(caregiverSummary).toContainText("Menos de 4 horas");
      expect((await readState(page.context())).checkIns[0]).toEqual(first);
      dialog = await openReport(page);
      await expect(dialog.getByRole("button", { name: "Menos de 4 horas", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(dialog.getByRole("spinbutton", { name: "Horas", exact: true })).toHaveCount(0);
      await dialog.getByRole("button", { name: "Cerca de 6 horas", exact: true }).click();
      await dialog.getByRole("button", { name: "Suficiente", exact: true }).click();
      await saveReport(page, dialog);
      await expect(caregiverSummary).toContainText("Cerca de 6 horas");
      await expect(caregiverSummary).not.toContainText("Menos de 4 horas");
      const secondState = await readState(caregiver);
      expect(secondState.checkIns).toHaveLength(1);
      const second = secondState.checkIns[0];
      expect(second).toMatchObject({ id: first.id, createdAt: first.createdAt, sleepRange: "around6", sleepMinutes: null, sleepQuality: "okay", food: null, mood: null });

      await page.reload();
      await carePage.reload();
      await expect(caregiverSummary).toContainText("Cerca de 6 horas");
      dialog = await openReport(page);
      await expect(dialog.getByRole("button", { name: "Cerca de 6 horas", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(dialog.getByRole("button", { name: "Suficiente", exact: true })).toHaveAttribute("aria-pressed", "true");
      const eightOrMore = dialog.getByRole("button", { name: "8 horas ou mais", exact: true });
      await keyboardReach(page, eightOrMore);
      await page.keyboard.press("Space");
      await expect(eightOrMore).toHaveAttribute("aria-pressed", "true");
      await expect(dialog.getByRole("button", { name: "Cerca de 6 horas", exact: true })).toHaveAttribute("aria-pressed", "false");
      await checkPresetLayout(page, dialog, width);
      await page.screenshot({ path: info.outputPath(`sleep-${width}-three-options.png`), scale: "css" });
      expect((await readState(caregiver)).checkIns[0]).toEqual(second);
      await dialog.getByRole("button", { name: "Pular", exact: true }).click();
      expect((await readState(caregiver)).checkIns[0]).toEqual(second);
      expect(actions).toHaveLength(2);
      expect(actions.map(action => action.sleepRange)).toEqual(["under4", "around6"]);
      await carePage.screenshot({ path: info.outputPath(`sleep-${width}-caregiver.png`), scale: "css" });
      await info.attach("sleep-presets-evidence", { contentType: "application/json", body: JSON.stringify({
        result: "passed", origin: base, viewport: { width, height: 844 }, caseId: initial.demoId,
        method: "Real UI, API and SQLite in isolated synthetic patient/caregiver sessions; no network or model mocks.",
        assertions: ["presets fit without horizontal overflow", "presets have 44px targets", "keyboard selects presets", "duration does not force sleep quality", "caregiver sees saved range", "range and selected quality persist after reload", "editing preserves report identity", "exactly three choices and no exact inputs", "unsaved choice leaves saved range intact"],
        first, second, actions,
      }, null, 2) });
    } finally { await caregiver.close(); }
  });
}


test("editing other report fields preserves historical exact sleep minutes", async ({ page }) => {
  const started = await page.request.post("/api/demo", { data: { scenario: "ready", role: "patient" }, headers: { Origin: base } });
  expect(started.status(), await started.text()).toBe(200);
  const initial = await started.json() as CareState;
  const seeded = await page.request.post("/api/actions", { headers: { Origin: base }, data: {
    context: { demoId: initial.demoId, role: "patient" },
    action: { type: "check_in", sleepMinutes: 437, sleepQuality: null, food: null, mood: null, requestId: randomUUID() },
  } });
  expect(seeded.status(), await seeded.text()).toBe(200);
  const legacy = (await seeded.json() as CareState).checkIns[0];
  await page.goto(`/?demo=${initial.demoId}&role=patient`);
  let dialog = await openReport(page);
  await expect(dialog.getByRole("spinbutton")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Outro tempo", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Sim", exact: true }).click();
  await saveReport(page, dialog);
  expect((await readState(page.context())).checkIns[0]).toMatchObject({ id: legacy.id, sleepMinutes: 437, sleepRange: null, food: "yes" });

  dialog = await openReport(page);
  await dialog.getByRole("button", { name: "Cerca de 6 horas", exact: true }).click();
  await saveReport(page, dialog);
  expect((await readState(page.context())).checkIns[0]).toMatchObject({ id: legacy.id, sleepMinutes: null, sleepRange: "around6", food: "yes" });
});
