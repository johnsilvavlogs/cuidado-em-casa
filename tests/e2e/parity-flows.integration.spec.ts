import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { CareState, ExtractionResult } from "../../src/lib/contracts";
import { CareRepository } from "../../src/lib/server/care-repository";

test.use({ trace: "off", actionTimeout: 15_000, navigationTimeout: 20_000 }); // Per-state trace chunks below own their lifecycle.

const base = process.env.CARE_E2E_BASE_URL || "http://127.0.0.1:3000";
const runId = process.env.CARE_PARITY_RUN_ID || `run-${Date.now()}`;
const root = resolve("output/iterate/receipts/ux", runId);
await mkdir(root, { recursive: true });
await writeFile(resolve("output/iterate/receipts/ux/latest-run.json"), JSON.stringify({ run_id: runId, root, started_at: new Date().toISOString() }) + "\n");
const displays = [{ id: "mobile", width: 390, height: 844 }, { id: "desktop", width: 1280, height: 800 }] as const;
type Display = typeof displays[number];
type Check = { kind: string; target: string; expected: unknown; actual: unknown; passed: boolean };
type CaseAction = { target: { selector?: string; role?: string; name?: string }; kind: "click" | "keyboard" | "submit"; description: string };
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

function check(target: string, expected: unknown, actual: unknown): Check {
  expect(actual, target).toEqual(expected);
  return { kind: "observed-state", target, expected, actual, passed: true };
}
async function json(path: string, value: unknown) { await writeFile(path, JSON.stringify(value, null, 2) + "\n"); }
async function state(context: BrowserContext): Promise<CareState> {
  const response = await context.request.get("/api/state"); expect(response.status(), await response.text()).toBe(200); return response.json();
}
async function clickSave(page: Page, selector: ReturnType<Page["getByRole"]>) {
  const response = page.waitForResponse(r => r.url().endsWith("/api/actions") && r.request().method() === "POST", { timeout: 15_000 });
  await selector.click(); expect((await response).status()).toBe(200);
}
async function close(page: Page) {
  await page.getByRole("dialog").getByRole("button", { name: "Fechar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function plan(page: Page) { await page.getByRole("navigation").getByRole("button", { name: "Plano", exact: true }).click(); }
async function keyboardTo(page: Page, selector: ReturnType<Page["getByRole"]>) {
  for (let index = 0; index < 50; index++) {
    if (await selector.evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Target not reached by keyboard");
}

class Proof {
  constructor(readonly page: Page, readonly context: BrowserContext, readonly screen: string, readonly display: Display) {}
  async record(id: string, setup: string, action: CaseAction, perform: () => Promise<Check[]>, replay: () => Promise<Check[]>) {
    const dir = resolve(root, this.screen, this.display.id, id); await mkdir(dir, { recursive: true });
    await this.context.tracing.startChunk({ title: `${this.screen}/${this.display.id}/${id}` });
    const started = new Date().toISOString();
    const before = await state(this.context);
    const pre = [check("session.role", this.screen === "caregiver-routine" || this.screen === "document-review" ? "caregiver" : "patient", before.role)];
    await this.page.screenshot({ path: resolve(dir, "before.png") });
    await json(resolve(dir, "before.json"), { captured_at: started, state: before, visibleText: await this.page.locator("body").innerText() });
    const afterChecks = await perform();
    const after = await state(this.context);
    await this.page.screenshot({ path: resolve(dir, "after.png") });
    await json(resolve(dir, "after.json"), { captured_at: new Date().toISOString(), state: after, visibleText: await this.page.locator("body").innerText(), checks: afterChecks });
    await this.page.reload();
    await this.page.waitForLoadState("domcontentloaded");
    const replayChecks = await replay();
    await this.page.screenshot({ path: resolve(dir, "replay.png") });
    await json(resolve(dir, "replay.json"), { captured_at: new Date().toISOString(), state: await state(this.context), visibleText: await this.page.locator("body").innerText(), checks: replayChecks });
    await this.context.tracing.stopChunk({ path: resolve(dir, "trace.zip") });
    const result = `${this.screen}/${id}: assertions observed in UI/server and replayed after a clean reload.`;
    await json(resolve(dir, "observation.json"), {
      schema_version: 1, screen_id: this.screen, state_id: id, viewport_id: this.display.id,
      route: this.page.url(), captured_at: new Date().toISOString(), performed_at: started,
      surface: { headless: true, width_css: this.display.width, height_css: this.display.height, dpr: await this.page.evaluate(() => devicePixelRatio), timezone: "America/Sao_Paulo" },
      provenance: "Headless Playwright interaction evidence using real Next.js routes and local SQLite. Canonical visual capture/acceptance remains with root/IAB. Controlled failures and source replay are explicitly labelled per scenario.",
      setup, action, observed_result: result,
      pre_state: { description: setup, assertions: pre },
      post_state: { observed_result: result, assertions: afterChecks },
      replay: { clean_reload: true, observed_result: result, assertions: replayChecks },
      supporting_files: ["trace.zip", "before.json", "after.json", "replay.json", "before.png", "after.png", "replay.png"],
    });
  }
}

async function start(browser: Browser, display: Display, role: "patient" | "caregiver", scenario: "ready" | "setup" = "ready", demoId?: string) {
  const context = await browser.newContext({ baseURL: base, viewport: { width: display.width, height: display.height }, deviceScaleFactor: 1, timezoneId: "America/Sao_Paulo" });
  const response = await context.request.post("/api/demo", { data: { scenario, role, ...(demoId ? { demoId } : {}) }, headers: { Origin: base } });
  expect(response.status()).toBe(200); const initial = await response.json() as CareState;
  const page = await context.newPage();
  await page.goto(`/?demo=${initial.demoId}&role=${role}`);
  await expect(page.locator(".daily-heading")).toBeVisible();
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  return { context, page, initial };
}

for (const display of displays) {
  test(`parity-${display.id}-patient-required-states`, async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page, initial } = await start(browser, display, "patient");
    const proof = new Proof(page, context, "patient-routine", display);
    try {
      await proof.record("source_open", "Ready patient case, next care has a private original.", { target: { role: "button", name: "Ver orientação do plano" }, kind: "click", description: "Open original and close back to next care." }, async () => {
        await page.locator('[data-parity-anchor="next-care"]').getByRole("button", { name: "Ver orientação do plano", exact: true }).click();
        await expect(page.getByRole("dialog").getByRole("region", { name: "Documento original" })).toBeVisible();
        const original = await context.request.get(initial.document!.url);
        await expect(page.locator(".document-stage pre")).toHaveText(await original.text());
        const actual = await page.locator(".document-stage pre").innerText();
        const checks = [check("private original bytes rendered", await original.text(), actual)];
        await close(page); checks.push(check("return to next care", true, await page.locator('[data-parity-anchor="next-care"]').isVisible())); return checks;
      }, async () => [check("same document after reload", initial.document!.id, (await state(context)).document!.id)]);

      // Root is redesigning voice in parallel. Re-enable only after its new controls are ready.
      if (process.env.CARE_PARITY_VOICE_READY === "1") await proof.record("voice_open", "Real headless browser has no granted microphone permission; no voice transport is mocked.", { target: { role: "button", name: "Falar com assistente" }, kind: "click", description: "Open voice and attempt actual microphone access; inspect explicit permission/device failure." }, async () => {
        await page.getByRole("button", { name: "Falar com assistente", exact: true }).click();
        await page.getByRole("button", { name: "Conectar microfone", exact: true }).click();
        const alert = page.getByRole("alert"); await expect(alert).toBeVisible();
        const text = await alert.innerText(); expect(text).toMatch(/microfone|Requested device|Permission|not found|denied|dispositivo/i);
        const checks = [check("explicit microphone/device failure displayed", true, text.length > 0), check("voice did not record task", 1, (await state(context)).revision)];
        await page.getByRole("button", { name: "Fechar e usar os botões", exact: true }).click(); return checks;
      }, async () => [check("manual controls after reload", true, await page.getByRole("button", { name: "Falar com assistente", exact: true }).isVisible())]);

      await proof.record("wellbeing_open", "Optional wellbeing has no report.", { target: { role: "button", name: "Informar como estou" }, kind: "click", description: "Open optional form and return without saving." }, async () => {
        await page.getByRole("button", { name: "Informar como estou", exact: true }).click();
        const checks = [check("sleep remains empty", "", await page.getByLabel("Horas", { exact: true }).inputValue())];
        await page.getByRole("button", { name: "Pular", exact: true }).click();
        checks.push(check("no report on skip", 0, (await state(context)).checkIns.length)); return checks;
      }, async () => [check("absent sleep label", true, await page.getByText("Sono não informado", { exact: true }).isVisible())]);

      await proof.record("navigation_keyboard", "Patient routine with all keyboard controls available.", { target: { role: "navigation", name: "Navegação principal" }, kind: "keyboard", description: "Tab/Enter through primary care, Plano, Histórico, and return." }, async () => {
        const primary = page.getByRole("button", { name: "Registrar como feito", exact: true }); await keyboardTo(page, primary);
        const focused = await primary.evaluate(el => el === document.activeElement && getComputedStyle(el).outlineStyle !== "none");
        const nav = page.getByRole("navigation");
        await keyboardTo(page, nav.getByRole("button", { name: "Plano", exact: true })); await page.keyboard.press("Enter");
        await expect(page.getByRole("heading", { name: "Plano de cuidado", exact: true })).toBeVisible();
        await keyboardTo(page, nav.getByRole("button", { name: "Histórico", exact: true })); await page.keyboard.press("Enter");
        await expect(page.getByRole("heading", { name: "Histórico do cuidado", exact: true })).toBeVisible();
        await keyboardTo(page, nav.getByRole("button", { name: "Meu dia", exact: true })); await page.keyboard.press("Enter");
        return [check("focus visibly outlined", true, focused), check("return to current case", initial.demoId, (await state(context)).demoId)];
      }, async () => [check("routine controls return", true, await page.getByRole("button", { name: "Falar com assistente", exact: true }).isVisible())]);

      let pendingId = initial.tasks[0].id;
      await proof.record("support_flow", "Pending next task; no help requests.", { target: { role: "button", name: "Ajuda urgente" }, kind: "click", description: "Create normal help; inspect independent emergency link; save urgent help without dialing." }, async () => {
        await page.locator(".routine-more>summary").click(); await page.locator(".compact-task").first().click();
        await page.getByRole("dialog").getByRole("button", { name: "Pedir ajuda", exact: true }).click();
        await page.getByLabel("Como podemos ajudar?", { exact: true }).fill("Preciso de apoio para organizar este cuidado.");
        await clickSave(page, page.getByRole("button", { name: "Enviar pedido de ajuda", exact: true }));
        await page.getByRole("button", { name: "Ajuda urgente", exact: true }).click();
        const href = await page.getByRole("link", { name: "Ligar para o SAMU · 192", exact: true }).getAttribute("href");
        await clickSave(page, page.getByRole("button", { name: "Avisar meu cuidador agora", exact: true }));
        const saved = await state(context); await close(page);
        return [check("independent emergency link; not dialed", "tel:192", href), check("normal help saved", true, saved.helpRequests.some(h => !h.urgent && h.taskId === pendingId)), check("urgent help saved", true, saved.helpRequests.some(h => h.urgent)), check("help does not conclude task", "pending", saved.tasks.find(t => t.id === pendingId)!.status)];
      }, async () => [check("two help requests persisted", 2, (await state(context)).helpRequests.length)]);

      await proof.record("save_failure_retry", "One controlled HTTP failure before the real write; same request ID is retried.", { target: { role: "button", name: "Tentar novamente" }, kind: "click", description: "Fail one write at HTTP boundary, inspect visible error, retry manually, compare request IDs and SQLite revision." }, async () => {
        pendingId = (await state(context)).tasks.find(t => t.status === "pending")!.id;
        const revision = (await state(context)).revision; const requests: unknown[] = []; let failed = false;
        const listener = (request: { url(): string; method(): string; postDataJSON(): unknown }) => { if (request.url().endsWith("/api/actions") && request.method() === "POST") requests.push(request.postDataJSON()); };
        page.on("request", listener);
        await page.route("**/api/actions", async route => { if (!failed) { failed = true; await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Falha controlada de gravação para verificar recuperação." }) }); } else await route.continue(); });
        await page.getByRole("button", { name: "Registrar como feito", exact: true }).click();
        await expect(page.getByRole("alert").filter({ hasText: "Falha controlada" })).toBeVisible();
        const afterFailure = await state(context);
        await clickSave(page, page.getByRole("button", { name: "Tentar novamente", exact: true }));
        await page.unroute("**/api/actions"); page.off("request", listener);
        const saved = await state(context);
        return [check("failed request not saved", revision, afterFailure.revision), check("identical retry payload and request ID", requests[0], requests[1]), check("one durable write", revision + 1, saved.revision), check("task saved once", "done", saved.tasks.find(t => t.id === pendingId)!.status)];
      }, async () => [check("retried write survives reload", "done", (await state(context)).tasks.find(t => t.id === pendingId)!.status)]);

      let correctedId = "";
      await proof.record("primary_action", "Next pending care; a prior completed care remains in history.", { target: { role: "button", name: "Registrar como feito" }, kind: "click", description: "Record next task, then correct that same occurrence through its task dialog." }, async () => {
        correctedId = (await state(context)).tasks.find(t => t.status === "pending")!.id;
        await clickSave(page, page.getByRole("button", { name: "Registrar como feito", exact: true }));
        await page.locator(".routine-more>summary").click();
        const current = await state(context); const task = current.tasks.find(t => t.id === correctedId)!;
        await page.locator(".compact-task").filter({ hasText: task.title.replace(/\s*\(fictício\)/g, "") }).filter({ hasText: task.time }).first().click();
        await page.getByRole("button", { name: "Corrigir registro", exact: true }).click();
        await page.getByRole("button", { name: "Não consegui fazer", exact: true }).click();
        await clickSave(page, page.getByRole("button", { name: "Salvar registro", exact: true }));
        const saved = await state(context);
        return [check("same occurrence corrected", "not_done", saved.tasks.find(t => t.id === correctedId)!.status), check("prior completion preserved in history", true, saved.timeline.some(e => e.text.includes("registro anterior: feito")))];
      }, async () => [check("correction survives reload", "not_done", (await state(context)).tasks.find(t => t.id === correctedId)!.status)]);
    } finally { await context.close(); }
  });

  test(`parity-${display.id}-caregiver-required-states`, async ({ browser }) => {
    test.setTimeout(180_000);
    const patient = await start(browser, display, "patient");
    const caregiver = await start(browser, display, "caregiver", "ready", patient.initial.demoId);
    const { page, context } = caregiver; const proof = new Proof(page, context, "caregiver-routine", display);
    try {
      const pending = patient.initial.tasks[0];
      await proof.record("primary_action", "Caregiver sees the overdue 08:00 occurrence after its 30-minute tolerance.", { target: { role: "button", name: "Ver pendência" }, kind: "click", description: "Open overdue care without changing its pending status." }, async () => {
        await page.getByRole("button", { name: "Ver pendência", exact: true }).click();
        const visible = await page.getByRole("dialog").innerText(); await close(page);
        return [check("correct task and source action visible", true, visible.includes(pending.title.replace(/\s*\(fictício\)/g, "")) && visible.includes("Ver orientação do plano")), check("reading does not complete task", "pending", (await state(context)).tasks.find(t => t.id === pending.id)!.status)];
      }, async () => [check("pending state after reload", "pending", (await state(context)).tasks.find(t => t.id === pending.id)!.status)]);

      await proof.record("source_open", "An overdue care points to a private original.", { target: { role: "button", name: "Ver orientação do plano" }, kind: "click", description: "Open the care's original then return to the caregiver routine." }, async () => {
        await page.getByRole("button", { name: "Ver pendência", exact: true }).click(); await page.getByRole("button", { name: "Ver orientação do plano", exact: true }).click();
        const original = await context.request.get(patient.initial.document!.url);
        await expect(page.locator(".document-stage pre")).toHaveText(await original.text()); const actual = await page.locator(".document-stage pre").innerText(); await close(page);
        return [check("correct private original", await original.text(), actual)];
      }, async () => [check("source binding persisted", patient.initial.document!.id, (await state(context)).document!.id)]);

      await proof.record("keyboard_navigation", "Caregiver initial routine and source action.", { target: { role: "button", name: "Ver pendência" }, kind: "keyboard", description: "Reach attention by Tab, activate with Enter, Escape returns focus; navigate Plano/Histórico/Hoje." }, async () => {
        const button = page.getByRole("button", { name: "Ver pendência", exact: true }); await keyboardTo(page, button); await page.keyboard.press("Enter");
        await expect(page.getByRole("dialog")).toBeVisible(); await page.keyboard.press("Escape"); await expect(button).toBeFocused();
        const focused = await button.evaluate(el => getComputedStyle(el).outlineStyle !== "none");
        for (const name of ["Plano", "Histórico", "Hoje"]) { const next = page.getByRole("navigation").getByRole("button", { name, exact: true }); await keyboardTo(page, next); await page.keyboard.press("Enter"); }
        return [check("visible keyboard focus restored", true, focused), check("routine reachable after keyboard navigation", true, await button.isVisible())];
      }, async () => [check("same caregiver case retained", patient.initial.demoId, (await state(context)).demoId)]);

      let helpId = "";
      await proof.record("help_resolution", "Patient sends an open normal help request tied to a pending care.", { target: { role: "button", name: "Ajuda resolvida" }, kind: "click", description: "Read reason and resolve request in caregiver UI; check both sessions and task independence." }, async () => {
        await patient.page.locator(".routine-more>summary").click(); await patient.page.locator(".compact-task").first().click();
        await patient.page.getByRole("button", { name: "Pedir ajuda", exact: true }).click(); await patient.page.getByLabel("Como podemos ajudar?", { exact: true }).fill("Preciso de apoio neste cuidado.");
        await clickSave(patient.page, patient.page.getByRole("button", { name: "Enviar pedido de ajuda", exact: true }));
        await expect(page.getByRole("button", { name: "Ver relato", exact: true })).toBeVisible(); await page.getByRole("button", { name: "Ver relato", exact: true }).click();
        const before = await state(context); helpId = before.helpRequests[0].id;
        await clickSave(page, page.getByRole("button", { name: "Ajuda resolvida", exact: true })); await close(page);
        return [check("caregiver sees resolution", "resolved", (await state(context)).helpRequests.find(h => h.id === helpId)!.status), check("patient sees resolution", "resolved", (await state(patient.context)).helpRequests.find(h => h.id === helpId)!.status), check("resolution does not complete task", "pending", (await state(context)).tasks.find(t => t.id === pending.id)!.status)];
      }, async () => [check("resolution persists", "resolved", (await state(context)).helpRequests.find(h => h.id === helpId)!.status)]);

      await proof.record("new_patient_record", "Caregiver remains open while patient records a task in a separate session.", { target: { selector: ".caregiver-progress strong" }, kind: "click", description: "Patient records care through real UI; caregiver receives normal polling update then reloads." }, async () => {
        await clickSave(patient.page, patient.page.getByRole("button", { name: "Registrar como feito", exact: true }));
        await expect(page.locator(".caregiver-progress strong")).toContainText("1 de 4");
        const saved = await state(context);
        return [check("polling shows patient record", true, (await page.locator(".caregiver-progress strong").innerText()).includes("1 de 4")), check("author is patient", "patient", saved.tasks.find(t => t.id === pending.id)!.author)];
      }, async () => { await expect(page.locator(".caregiver-progress strong")).toContainText("1 de 4"); return [check("record survives caregiver reload", "done", (await state(context)).tasks.find(t => t.id === pending.id)!.status)]; });
    } finally { await context.close(); await patient.context.close(); }
  });

  test(`parity-${display.id}-checkin-required-states`, async ({ browser }) => {
    test.setTimeout(150_000);
    const { context, page } = await start(browser, display, "patient"); const proof = new Proof(page, context, "optional-checkin", display);
    const open = async () => { await page.getByRole("button", { name: /^(Informar como estou|Atualizar relato)$/ }).click(); await expect(page.getByLabel("Horas", { exact: true })).toBeVisible(); };
    try {
      await proof.record("optional_skip", "No optional reports exist.", { target: { role: "button", name: "Pular" }, kind: "click", description: "Leave an empty optional report without saving." }, async () => { const revision = (await state(context)).revision; await open(); await page.getByRole("button", { name: "Pular", exact: true }).click(); return [check("skip writes no record", 0, (await state(context)).checkIns.length), check("skip does not change revision", revision, (await state(context)).revision)]; }, async () => [check("sleep remains absent after reload", true, await page.getByText("Sono não informado", { exact: true }).isVisible())]);
      await proof.record("keyboard_and_validation", "Empty check-in opened with keyboard and invalid minutes entered.", { target: { role: "spinbutton", name: "Minutos" }, kind: "keyboard", description: "Focus inputs, reject 65 minutes, correct to 20, select food/mood, Escape without saving." }, async () => {
        await open(); const minutes = page.getByLabel("Minutos", { exact: true }); await keyboardTo(page, minutes); await minutes.fill("65");
        await page.getByRole("button", { name: "Salvar relato", exact: true }).click();
        const valid = await minutes.evaluate((el: HTMLInputElement) => el.validity.rangeOverflow);
        const validationMessage = await minutes.evaluate((el: HTMLInputElement) => el.validationMessage);
        await minutes.fill("20"); await page.getByRole("button", { name: "Em parte", exact: true }).click(); await page.getByRole("button", { name: "Mais ou menos", exact: true }).click();
        const selected = await page.getByRole("button", { name: "Mais ou menos", exact: true }).getAttribute("aria-pressed");
        const height = (await page.getByRole("button", { name: "Mais ou menos", exact: true }).boundingBox())!.height;
        await page.keyboard.press("Escape");
        return [check("native validation rejects invalid minutes", true, valid), check("native validation supplies a readable message", true, validationMessage.length > 0), check("selected state exposed", "true", selected), check("target at least 44 CSS pixels", true, height >= 44), check("escape did not save", 0, (await state(context)).checkIns.length)];
      }, async () => [check("no accidental save persisted", 0, (await state(context)).checkIns.length)]);
      let reportId = "";
      await proof.record("primary_action", "Sleep stays unfilled; food and mood are explicitly selected.", { target: { role: "button", name: "Salvar relato" }, kind: "click", description: "Save partial optional wellbeing; verify no fabricated sleep and server confirmation." }, async () => {
        await open(); await page.getByRole("button", { name: "Em parte", exact: true }).click(); await page.getByRole("button", { name: "Mais ou menos", exact: true }).click();
        await clickSave(page, page.getByRole("button", { name: "Salvar relato", exact: true }));
        const report = (await state(context)).checkIns[0]; reportId = report.id;
        return [check("sleep remains unknown", null, report.sleepMinutes), check("food and mood saved", ["partial", "okay"], [report.food, report.mood])];
      }, async () => { await open(); return [check("saved choices restored", "true", await page.getByRole("button", { name: "Mais ou menos", exact: true }).getAttribute("aria-pressed")), check("same report after reload", reportId, (await state(context)).checkIns[0].id)]; });
      await close(page);
      const otherAuthor = await start(browser, display, "caregiver", "ready", (await state(context)).demoId);
      const otherSaved = await otherAuthor.context.request.post("/api/actions", { data: { context: { demoId: (await state(otherAuthor.context)).demoId, role: "caregiver" }, action: { type: "check_in", sleepMinutes: null, sleepQuality: null, food: "yes", mood: "good", requestId: randomUUID() } }, headers: { Origin: base } });
      expect(otherSaved.status()).toBe(200);
      const otherReport = (await state(otherAuthor.context)).checkIns.find(entry => entry.author === "caregiver")!;
      await otherAuthor.context.close();
      await proof.record("correct_own_report", "Current patient edits their existing report; another role's record is protected by server ownership.", { target: { role: "button", name: "Salvar relato" }, kind: "click", description: "Edit manual sleep and preserve report identity/creation time; inspect history and reload." }, async () => {
        const before = (await state(context)).checkIns.find(entry => entry.id === reportId)!; await open(); await page.getByLabel("Horas", { exact: true }).fill("6"); await page.getByLabel("Minutos", { exact: true }).fill("20");
        await page.getByRole("button", { name: "Suficiente", exact: true }).click(); await clickSave(page, page.getByRole("button", { name: "Salvar relato", exact: true }));
        const after = await state(context); const edited = after.checkIns.find(entry => entry.id === reportId)!;
        return [check("own report identity retained", reportId, edited.id), check("original timestamp retained", before.createdAt, edited.createdAt), check("manual sleep saved", 380, edited.sleepMinutes), check("other author's record untouched", otherReport, after.checkIns.find(entry => entry.id === otherReport.id)), check("history records correction", true, after.timeline.some(e => e.text.includes("corrigiu um relato")))];
      }, async () => { await open(); return [check("corrected hours restored", "6", await page.getByLabel("Horas", { exact: true }).inputValue()), check("corrected minutes restored", "20", await page.getByLabel("Minutos", { exact: true }).inputValue())]; });
    } finally { await context.close(); }
  });

  test(`parity-${display.id}-review-required-states`, async ({ browser }) => {
    test.setTimeout(240_000);
    const repository = new CareRepository();
    await mkdir(resolve(root, "source-fixture"), { recursive: true });
    const original = resolve(root, "source-fixture", `two-page-${display.id}.pdf`);
    execFileSync("pdfunite", [resolve("testes/receitas/01_marina_duarte_falcao.pdf"), resolve("testes/receitas/02_rafael_nogueira_lins.pdf"), original]);
    const cachedBytes = await readFile("output/ai/01_marina_duarte_falcao.pdf.json");
    const cached = JSON.parse(cachedBytes.toString()) as { result: ExtractionResult };
    const secondCachedBytes = await readFile("output/ai/02_rafael_nogueira_lins.pdf.json");
    const secondCached = JSON.parse(secondCachedBytes.toString()) as { result: ExtractionResult };
    const extraction = structuredClone(cached.result);
    extraction.items.push(...structuredClone(secondCached.result.items).map(item => ({ ...item, source: { ...item.source, page: 2 } })));
    extraction.unresolved.push(...secondCached.result.unresolved);
    extraction.warnings.push(...secondCached.result.warnings);
    const first = extraction.items[0]; const originalDose = first.fields.dose.value!;
    first.fields.dose.state = "ambiguous"; first.questions = ["Confira a dose na página original."];
    const seeded = await repository.startDemo({ scenario: "setup", role: "caregiver" });
    const stored = await repository.storeDocument(seeded.token, { name: "duas-paginas-originais-de-teste.pdf", mimeType: "application/pdf", bytes: await readFile(original) });
    stored.pageCount = 2;
    const draft = await repository.importDraft(seeded.token, stored, extraction);
    await json(resolve(root, "source-fixture", `provenance-${display.id}.json`), { cached_extractions: [{ path: "output/ai/01_marina_duarte_falcao.pdf.json", sha256: hash(cachedBytes), source_page: 1 }, { path: "output/ai/02_rafael_nogueira_lins.pdf.json", sha256: hash(secondCachedBytes), source_page: 2 }], original_pdf: original, original_sha256: hash(await readFile(original)), method: "Replay of two previously recorded real Responses results; original contains their two existing synthetic fixture PDF pages concatenated with pdfunite. All 14 extracted care items are retained with page remapping. Injected ambiguity on first dose exercises the gate. This is not a new model extraction or accuracy evidence." });
    const current = await start(browser, display, "caregiver", "setup", draft.demoId); const { page, context } = current;
    const proof = new Proof(page, context, "document-review", display);
    const openReview = async () => { await plan(page); await page.locator(".plan-item").first().click(); await expect(page.getByRole("dialog")).toBeVisible(); await expect(page.getByText("Página 1 de 2", { exact: true })).toBeVisible(); };
    const dose = () => page.getByLabel("Dose", { exact: true });
    const reading = () => page.locator('[data-parity-anchor="field-editor"] select');
    try {
      await openReview();
      await proof.record("uncertainty_gate", "Replay draft with intentionally ambiguous dose and unresolved item question.", { target: { role: "button", name: "Conferi e confirmo este cuidado" }, kind: "click", description: "Attempt confirmation and activation while ambiguity remains; both must stay blocked." }, async () => {
        const response = page.waitForResponse(r => r.url().endsWith("/api/actions") && r.request().method() === "POST");
        await page.getByRole("button", { name: "Conferi e confirmo este cuidado", exact: true }).click(); expect((await response).status()).toBe(409);
        await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible(); await close(page);
        const disabled = await page.getByRole("button", { name: "Ativar plano", exact: true }).isDisabled();
        return [check("activation disabled", true, disabled), check("plan remains draft", "draft", (await state(context)).plan.status), check("ambiguous item remains unconfirmed", false, (await state(context)).plan.items[0].confirmed)];
      }, async () => { await openReview(); return [check("ambiguity persisted", "ambiguous", (await state(context)).plan.items[0].fields.dose.state)]; });

      await proof.record("primary_action", "Original dose value is readable in stored fixture; ambiguity was a labelled test injection.", { target: { role: "button", name: "Salvar correções" }, kind: "click", description: "Restore the dose's exact source value, mark reading legible, clear test question, save without confirming." }, async () => {
        await dose().fill(originalDose); await reading().selectOption("readable"); await page.getByLabel("Dúvidas pendentes", { exact: false }).fill("");
        await expect(page.getByRole("button", { name: "Salvar correções", exact: true })).toBeEnabled();
        await clickSave(page, page.getByRole("button", { name: "Salvar correções", exact: true }));
        const saved = await state(context); const fetched = await context.request.get(stored.url);
        return [check("saved exact source dose", originalDose, saved.plan.items[0].fields.dose.value), check("saving does not confirm", false, saved.plan.items[0].confirmed), check("private original unchanged", hash(await readFile(original)), hash(await fetched.body()))];
      }, async () => { await openReview(); return [check("correction restored after reload", originalDose, await dose().inputValue()), check("still not auto-confirmed", false, (await state(context)).plan.items[0].confirmed)]; });

      await proof.record("source_page_zoom", "Two-page private PDF made from approved existing synthetic originals.", { target: { role: "button", name: "Próxima página" }, kind: "click", description: "Switch real rendered PDF page, zoom to 120%, then restore page and zoom." }, async () => {
        const canvas = page.locator(".document-stage canvas"); const before = await canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL());
        await page.getByRole("button", { name: "Próxima página", exact: true }).click(); await expect(page.getByText("Página 2 de 2", { exact: true })).toBeVisible();
        await expect.poll(async () => canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL())).not.toBe(before);
        const width = (await canvas.boundingBox())!.width;
        await page.getByRole("button", { name: "Ampliar documento", exact: true }).click(); await expect(page.getByText("120%", { exact: true })).toBeVisible();
        await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(width);
        const checks = [check("page pixels changed", true, (await canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL())) !== before), check("zoom enlarged real canvas", true, (await canvas.boundingBox())!.width > width)];
        await page.getByRole("button", { name: "Diminuir zoom", exact: true }).click(); await page.getByRole("button", { name: "Página anterior", exact: true }).click(); return checks;
      }, async () => { await openReview(); return [check("source opens at original page", true, await page.getByText("Página 1 de 2", { exact: true }).isVisible())]; });

      await proof.record("error_keyboard_recovery", "Review has editable operational time; one write is deliberately rejected before persistence.", { target: { role: "button", name: "Salvar correções" }, kind: "keyboard", description: "Keyboard opens remaining fields; controlled save failure retains edit; manual retry saves; Escape returns context." }, async () => {
        const more = page.locator(".review-details>summary"); await keyboardTo(page, more); await page.keyboard.press("Enter");
        await page.getByLabel("Horários da rotina", { exact: true }).fill("08:00"); let failed = false;
        await page.route("**/api/actions", async route => { if (!failed) { failed = true; await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Falha controlada na correção." }) }); } else await route.continue(); });
        await page.getByRole("button", { name: "Salvar correções", exact: true }).click();
        await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
        const retained = await page.getByLabel("Horários da rotina", { exact: true }).inputValue();
        await clickSave(page, page.getByRole("dialog").getByRole("button", { name: "Tentar novamente", exact: true }));
        await page.unroute("**/api/actions"); await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
        return [check("failed edit retained", "08:00", retained), check("manual retry saved operational time", ["08:00"], (await state(context)).plan.items[0].schedule!.times), check("no silent activation", "draft", (await state(context)).plan.status)];
      }, async () => { await openReview(); return [check("time persists after reload", ["08:00"], (await state(context)).plan.items[0].schedule!.times)]; });
      await close(page);

      await proof.record("confirm_then_activate", "All replayed source fields are legible and test ambiguity has been explicitly corrected.", { target: { role: "button", name: "Ativar plano" }, kind: "click", description: "Confirm every included care through UI, acknowledge all pages, activate, verify linked patient and reload." }, async () => {
        for (let index = 0; index < draft.plan.items.length; index++) {
          await page.locator(".plan-item").nth(index).click(); await clickSave(page, page.getByRole("button", { name: "Conferi e confirmo este cuidado", exact: true })); await close(page);
        }
        await clickSave(page, page.getByRole("button", { name: "Revisei todas as páginas e incluí as orientações que faltavam.", exact: true }));
        await clickSave(page, page.getByRole("button", { name: "Ativar plano", exact: true }));
        const linked = await start(browser, display, "patient", "ready", draft.demoId); const linkedState = await state(linked.context); await linked.context.close();
        return [check("all included care confirmed", true, (await state(context)).plan.items.every(i => i.confirmed)), check("shared active plan", "active", linkedState.plan.status), check("same source retained", stored.id, linkedState.document!.id)];
      }, async () => { await plan(page); return [check("active plan after reload", "active", (await state(context)).plan.status), check("active plan read-only", true, await page.getByText("Plano conferido pelo cuidador.", { exact: false }).isVisible())]; });
    } finally { await context.close(); await repository.close(); }
  });
}
