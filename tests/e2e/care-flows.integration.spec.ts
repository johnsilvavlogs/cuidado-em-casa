import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CareState } from "../../src/lib/contracts";

const base = process.env.CARE_E2E_BASE_URL || "http://127.0.0.1:3000";
const output = resolve("output/e2e/care-flows");
const displays = [
  { id: "mobile", width: 390, height: 844 },
  { id: "desktop", width: 1280, height: 800 },
] as const;
type Display = typeof displays[number];
type ActionBody = Record<string, unknown>;

async function startCase(page: Page, display: Display) {
  await page.setViewportSize({ width: display.width, height: display.height });
  const response = await page.request.post("/api/demo", { data: { scenario: "ready", role: "patient" }, headers: { Origin: base } });
  expect(response.status()).toBe(200);
  const state = await response.json() as CareState;
  await page.goto(`/?demo=${state.demoId}&role=patient`);
  await expect(page.getByRole("button", { name: "Falar com assistente", exact: true })).toBeVisible();
  return state;
}
async function readState(context: BrowserContext) {
  const response = await context.request.get("/api/state");
  expect(response.status()).toBe(200);
  return await response.json() as CareState;
}
async function caregiverFor(browser: Browser, state: CareState, display: Display) {
  const context = await browser.newContext({ baseURL: base, viewport: { width: display.width, height: display.height }, timezoneId: "America/Sao_Paulo" });
  const response = await context.request.post("/api/demo", { data: { scenario: "ready", role: "caregiver", demoId: state.demoId }, headers: { Origin: base } });
  expect(response.status()).toBe(200);
  return context;
}
async function saveClick(page: Page, button: Locator) {
  const response = page.waitForResponse((candidate) => candidate.url().endsWith("/api/actions") && candidate.request().method() === "POST");
  await button.click();
  expect((await response).status()).toBe(200);
}
async function closeModal(page: Page) {
  await page.getByRole("dialog").getByRole("button", { name: "Fechar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function keyboardReach(page: Page, target: Locator) {
  for (let i = 0; i < 35; i++) {
    if (await target.evaluate((element) => document.activeElement === element)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Target was not reachable by Tab within the active screen.");
}
function actionsFrom(page: Page) {
  const actions: ActionBody[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/actions") && request.method() === "POST") actions.push(request.postDataJSON().action as ActionBody);
  });
  return actions;
}
async function evidence(info: TestInfo, display: Display, state: CareState, details: Record<string, unknown>) {
  await mkdir(output, { recursive: true });
  const body = JSON.stringify({
    test: info.title, generatedAt: new Date().toISOString(), result: "passed",
    surface: { origin: base, width: display.width, height: display.height, headless: true },
    caseId: state.demoId,
    method: "Real UI, Next.js endpoints and SQLite persistence in isolated synthetic sessions. Only the retry test intercepts exactly one controlled HTTP 500. No AI, original-document import or live Browser session is used.",
    ...details,
  }, null, 2);
  await writeFile(resolve(output, `${info.title}.json`), `${body}\n`);
  await info.attach("care-flow-evidence", { body, contentType: "application/json" });
}

for (const display of displays) {
  test(`${display.id}-01-failed-save-retry-is-idempotent`, async ({ page, browser }, info) => {
    const initial = await startCase(page, display);
    const caregiver = await caregiverFor(browser, initial, display);
    const requests = actionsFrom(page);
    let injectedFailures = 0;
    await page.route("**/api/actions", async (route) => {
      if (!injectedFailures) {
        injectedFailures++;
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Falha de gravação controlada para testar nova tentativa." }) });
      } else await route.continue();
    });
    try {
      const pending = initial.tasks.find((task) => task.status === "pending")!;
      const before = await readState(caregiver);
      await page.locator('[data-parity-anchor="next-care"]').getByRole("button", { name: "Já fiz", exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Falha de gravação controlada" })).toBeVisible();
      expect(requests).toHaveLength(1);
      const failed = await readState(caregiver);
      expect(failed.revision).toBe(before.revision);
      expect(failed.tasks.find((task) => task.id === pending.id)?.status).toBe("pending");
      await saveClick(page, page.getByRole("button", { name: "Tentar de novo", exact: true }));
      expect(requests).toHaveLength(2);
      expect(requests[1]).toEqual(requests[0]);
      const final = await readState(caregiver);
      expect(final.tasks.find((task) => task.id === pending.id)?.status).toBe("done");
      expect(final.timeline.length).toBe(before.timeline.length + 1);
      expect(final.revision).toBe(before.revision + 1);
      await page.reload();
      await expect(page.getByRole("alert").filter({ hasText: "Falha de gravação controlada" })).toHaveCount(0);
      expect((await readState(caregiver)).tasks.find((task) => task.id === pending.id)?.status).toBe("done");
      await evidence(info, display, initial, { assertions: { controlledFailureVisible: true, failedAttemptNotSaved: true, retryRequestBodyAndIdIdentical: true, oneDurableRecord: true, caregiverReadback: true, reloadPersistence: true }, requests, finalRevision: final.revision });
    } finally { await caregiver.close(); }
  });

  test(`${display.id}-02-keyboard-dialog-escape-restores-focus`, async ({ page }, info) => {
    const initial = await startCase(page, display);
    const profile = page.getByRole("button", { name: /^Abrir perfil de / });
    await keyboardReach(page, profile);
    await expect(profile).toBeFocused();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(profile).toBeFocused();
    const plan = page.getByRole("navigation", { name: "Navegação principal" }).getByRole("button", { name: "Plano", exact: true });
    await keyboardReach(page, plan);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Plano de cuidado", exact: true })).toBeVisible();
    const history = page.getByRole("navigation").getByRole("button", { name: "Histórico", exact: true });
    await keyboardReach(page, history);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Histórico do cuidado", exact: true })).toBeVisible();
    const today = page.getByRole("navigation").getByRole("button", { name: "Meu dia", exact: true });
    await keyboardReach(page, today);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Falar com assistente", exact: true })).toBeVisible();
    const source = page.locator('[data-parity-anchor="next-care"]').getByRole("button", { name: "Ver orientação", exact: true });
    await keyboardReach(page, source);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(source).toBeFocused();
    await evidence(info, display, initial, { assertions: { profileReachableByTab: true, enterOpensDialog: true, dialogReceivesFocus: true, tabStaysInDialog: true, escapeCloses: true, focusReturnsToOpener: true, planHistoryTodayKeyboardNavigation: true, sourceDialogEscapeRestoresFocus: true } });
  });

  test(`${display.id}-03-help-and-urgent-resolution-keep-task-pending`, async ({ page, browser }, info) => {
    const initial = await startCase(page, display);
    const caregiver = await caregiverFor(browser, initial, display);
    try {
      const firstTask = initial.tasks[0];
      await page.locator(".routine-more > summary").click();
      await page.locator(".compact-task").first().click();
      await page.getByRole("dialog").getByRole("button", { name: "Pedir ajuda", exact: true }).click();
      await page.getByLabel("Como podemos ajudar?", { exact: true }).fill("Preciso de ajuda para organizar este cuidado.");
      await saveClick(page, page.getByRole("button", { name: "Enviar pedido de ajuda", exact: true }));
      let current = await readState(caregiver);
      const normal = current.helpRequests.find((help) => !help.urgent)!;
      expect(normal).toMatchObject({ taskId: firstTask.id, status: "open" });
      expect(current.tasks.find((task) => task.id === firstTask.id)?.status).toBe("pending");
      const carePage = await caregiver.newPage();
      await carePage.goto(`/?demo=${initial.demoId}&role=caregiver`);
      await carePage.getByRole("button", { name: "Ver relato", exact: true }).click();
      const normalCard = carePage.locator(".help-item").filter({ hasText: normal.message });
      await saveClick(carePage, normalCard.getByRole("button", { name: "Marcar como resolvido", exact: true }));
      current = await readState(caregiver);
      expect(current.helpRequests.find((help) => help.id === normal.id)?.status).toBe("resolved");
      expect(current.tasks.find((task) => task.id === firstTask.id)?.status).toBe("pending");
      await closeModal(carePage);

      await page.getByRole("button", { name: "Ajuda urgente", exact: true }).click();
      await expect(page.getByRole("link", { name: "Ligar para o SAMU · 192", exact: true })).toHaveAttribute("href", "tel:192");
      await saveClick(page, page.getByRole("button", { name: "Enviar pedido urgente", exact: true }));
      await expect(page.getByRole("button", { name: "Pedido urgente salvo", exact: true })).toBeDisabled();
      current = await readState(caregiver);
      const urgent = current.helpRequests.find((help) => help.urgent)!;
      expect(urgent).toMatchObject({ taskId: null, status: "open" });
      expect(current.tasks.find((task) => task.id === firstTask.id)?.status).toBe("pending");
      await carePage.reload();
      await carePage.getByRole("button", { name: "Ver relato", exact: true }).click();
      const urgentCard = carePage.locator(".help-item").filter({ hasText: urgent.message });
      await saveClick(carePage, urgentCard.getByRole("button", { name: "Marcar como resolvido", exact: true }));
      const final = await readState(caregiver);
      expect(final.helpRequests.find((help) => help.id === urgent.id)?.status).toBe("resolved");
      expect(final.helpRequests.find((help) => help.id === normal.id)?.status).toBe("resolved");
      expect(final.tasks.find((task) => task.id === firstTask.id)?.status).toBe("pending");
      await evidence(info, display, initial, { assertions: { normalHelpBoundToTask: true, normalHelpDoesNotCompleteTask: true, normalResolutionDoesNotCompleteTask: true, urgentSavedIndependently: true, emergencyTelephoneLinkPresentButNotDialed: true, urgentResolutionDoesNotCompleteTask: true, caregiverUIResolution: true }, normalHelpId: normal.id, urgentHelpId: urgent.id, taskId: firstTask.id, finalTaskStatus: "pending" });
    } finally { await caregiver.close(); }
  });

  test(`${display.id}-04-optional-skip-and-date-specific-report-correction`, async ({ page, browser }, info) => {
    const initial = await startCase(page, display);
    const caregiver = await caregiverFor(browser, initial, display);
    const requests = actionsFrom(page);
    try {
      const before = await readState(caregiver);
      await page.getByRole("button", { name: "Informar como estou", exact: true }).click();
      await page.getByRole("button", { name: "Pular", exact: true }).click();
      expect((await readState(caregiver)).checkIns).toHaveLength(0);
      expect((await readState(caregiver)).revision).toBe(before.revision);
      expect(requests).toHaveLength(0);
      await page.getByRole("button", { name: "Informar como estou", exact: true }).click();
      const today = await page.locator('input[type="date"]').inputValue();
      await page.getByLabel("Horas", { exact: true }).fill("6");
      await page.getByLabel("Minutos", { exact: true }).fill("20");
      await page.getByRole("button", { name: "Pouco", exact: true }).click();
      await page.getByRole("button", { name: "Em parte", exact: true }).click();
      await page.getByRole("button", { name: "Mais ou menos", exact: true }).click();
      await saveClick(page, page.getByRole("button", { name: "Salvar relato", exact: true }));
      const original = (await readState(caregiver)).checkIns[0];
      expect(original).toMatchObject({ referenceDate: today, sleepMinutes: 380, sleepQuality: "low", food: "partial", mood: "okay" });
      await page.getByRole("button", { name: "Atualizar relato", exact: true }).click();
      await page.getByLabel("Minutos", { exact: true }).fill("45");
      await saveClick(page, page.getByRole("button", { name: "Salvar relato", exact: true }));
      const corrected = (await readState(caregiver)).checkIns[0];
      expect(corrected).toMatchObject({ id: original.id, referenceDate: today, sleepMinutes: 405, food: "partial", mood: "okay" });
      expect(corrected.createdAt).toBe(original.createdAt);
      const priorDate = new Date(`${today}T12:00:00-03:00`); priorDate.setUTCDate(priorDate.getUTCDate() - 1);
      const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(priorDate);
      await page.getByRole("button", { name: "Atualizar relato", exact: true }).click();
      await page.locator('input[type="date"]').fill(yesterday);
      await expect(page.getByLabel("Horas", { exact: true })).toHaveValue("");
      await page.getByLabel("Horas", { exact: true }).fill("7");
      await page.getByLabel("Minutos", { exact: true }).fill("0");
      await page.getByRole("button", { name: "Suficiente", exact: true }).click();
      await page.getByRole("button", { name: "Sim", exact: true }).click();
      await page.getByRole("button", { name: "Bem", exact: true }).click();
      await saveClick(page, page.getByRole("button", { name: "Salvar relato", exact: true }));
      const dated = await readState(caregiver);
      expect(dated.checkIns).toHaveLength(2);
      expect(dated.checkIns.find((entry) => entry.id === original.id)).toMatchObject({ referenceDate: today, sleepMinutes: 405 });
      expect(dated.checkIns.find((entry) => entry.referenceDate === yesterday)).toMatchObject({ sleepMinutes: 420, sleepQuality: "okay", food: "yes", mood: "good" });
      await page.reload();
      await page.getByRole("button", { name: "Atualizar relato", exact: true }).click();
      await expect(page.locator('input[type="date"]')).toHaveValue(today);
      await expect(page.getByLabel("Minutos", { exact: true })).toHaveValue("45");
      await page.locator('input[type="date"]').fill(yesterday);
      await expect(page.getByLabel("Horas", { exact: true })).toHaveValue("7");
      await expect(page.getByLabel("Minutos", { exact: true })).toHaveValue("0");
      await evidence(info, display, initial, { assertions: { skipCreatesNoRecord: true, ownReportCorrectionKeepsIdentityAndOriginalTime: true, differentDateCreatesSeparateRecord: true, dateSelectionLoadsMatchingReport: true, otherDateRemainsUntouched: true, persistedAfterReload: true }, today, yesterday, originalReportId: original.id, finalReportCount: dated.checkIns.length, actionRequests: requests });
    } finally { await caregiver.close(); }
  });
}
