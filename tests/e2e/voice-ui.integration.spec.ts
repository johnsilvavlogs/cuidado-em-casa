import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { resolve } from "node:path";
import type { CareState } from "../../src/lib/contracts";

type DecisionAnswer = { type: string; name: string; choice?: string };
type EvaluatedRow = { id: string; phrase: string; answers?: DecisionAnswer[]; actual?: { action: string; task: string }; passed: boolean };
type CapturedDecisionReport = { generatedAt: string; model: string; policyVersion: string; rows: EvaluatedRow[] };
type ActionBody = Record<string, unknown> & { type?: string };
type VoiceEvent = { type: "decision.event"; event_id: string; delegation_id: null; source_event_id: string; source_event_type: "session.input_transcript.delta"; trigger_id: string; event: { type: string; decision: { model: string; answers: DecisionAnswer[] } } };

declare global {
  interface Window {
    __voiceHarness: {
      emit: (event: unknown) => void;
      sent: string[];
      track: { enabled: boolean; stopped: boolean };
      connections: number;
      getUserMediaCalls: number;
    };
  }
}

const evidencePath = resolve("output/ai/voice-decisions/evaluation.json");
const evidenceBytes = await readFile(evidencePath);
const captured = JSON.parse(evidenceBytes.toString("utf8")) as CapturedDecisionReport;
const evaluationHash = createHash("sha256").update(evidenceBytes).digest("hex");
const reportDirectory = resolve("output/e2e/voice-ui");
const base = process.env.CARE_E2E_BASE_URL || "http://127.0.0.1:3000";
const captureEnabled = process.env.CARE_E2E_CAPTURE === "1";
const displays = [{ id: "mobile", width: 390, height: 844 }, { id: "desktop", width: 1280, height: 800 }] as const;
type Display = typeof displays[number];

async function captureVoice(page: Page, display: Display, expectedState: string) {
  if (!captureEnabled) return;
  await access(resolve("public/images/voice-microphone.png"));
  const panel = page.locator(`.voice-panel[data-voice-state="${expectedState}"]`);
  await expect(panel).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForFunction(() => Array.from(document.querySelectorAll("dialog[open] img")).every((node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0));
  const directory = resolve("output/iterate/voice");
  await mkdir(directory, { recursive: true });
  const filename = `${display.id}-${expectedState}.png`;
  const path = resolve(directory, filename);
  const screenshot = await page.screenshot({ path, fullPage: false, scale: "css", animations: "disabled" });
  const dom = await panel.innerText();
  const details = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, assets: Array.from(document.querySelectorAll("dialog[open] img")).filter((node): node is HTMLImageElement => node instanceof HTMLImageElement).map((node) => ({ src: node.getAttribute("src"), naturalWidth: node.naturalWidth, naturalHeight: node.naturalHeight })) }));
  await writeFile(resolve(directory, `${display.id}-${expectedState}.json`), JSON.stringify({ capturedAt: new Date().toISOString(), state: expectedState, display: display.id, screenshot: filename, sha256: createHash("sha256").update(screenshot).digest("hex"), ...details, captureScale: "css", animations: "disabled", route: "/", baseURL: base, implementationSource: "src/components/voice-panel.tsx", implementationSha256: createHash("sha256").update(await readFile(resolve("src/components/voice-panel.tsx"))).digest("hex"), renderedText: dom, limitation: "Real browser-rendered UI with simulated microphone/WebRTC/SDP transport and real UI→backend actions. This PNG does not prove a native Live audio session." }, null, 2) + "\n");
}

const decisionPhrases = new Map<string, string>();
const emittedSources = new WeakMap<Page, Set<string>>();

function decision(caseId: string, taskId?: string, id = randomUUID()): VoiceEvent {
  const row = captured.rows.find((candidate) => candidate.id === caseId);
  if (!row?.passed || !row.answers?.length) throw new Error(`No successful real Decisions evidence for ${caseId}`);
  // Replay the returned action. Task choices are mapped from the evaluator's synthetic task IDs
  // to the new isolated server case, not represented as a fresh model prediction.
  const answers = row.answers.map(({ type, name, choice }) => ({ type, name, choice: name === "task" && taskId ? taskId : choice }));
  decisionPhrases.set(id, row.phrase);
  return { type: "decision.event", event_id: id, delegation_id: null, source_event_id: `source-${id}`, source_event_type: "session.input_transcript.delta", trigger_id: `trigger-${id}`, event: { type: "decision.completed", decision: { model: captured.model, answers } } };
}

async function installSimulatedTransport(page: Page, denyMicrophone = false) {
  await page.addInitScript(({ deny }) => {
    const track = { enabled: true, stopped: false, stop() { this.stopped = true; } };
    const harness = {
      sent: [] as string[], track, connections: 0, getUserMediaCalls: 0,
      emit: (event: unknown): void => { void event; throw new Error("Data channel is not initialized"); },
    };
    Object.defineProperty(window, "__voiceHarness", { value: harness, configurable: true });
    const media = { getTracks: () => [track], getAudioTracks: () => [track] };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => {
        harness.getUserMediaCalls++;
        track.stopped = false;
        track.enabled = true;
        if (deny) throw new DOMException("Permission denied by deterministic test", "NotAllowedError");
        return media;
      } },
    });
    class SimulatedChannel {
      readyState = "open";
      onmessage: ((event: MessageEvent) => void) | null = null;
      send(value: string) { harness.sent.push(value); }
      close() { this.readyState = "closed"; }
    }
    class SimulatedPeerConnection extends EventTarget {
      localDescription: { type: string; sdp: string } | null = null;
      iceGatheringState = "complete";
      connectionState = "connected";
      channel: SimulatedChannel | null = null;
      ontrack = null;
      onconnectionstatechange = null;
      constructor() { super(); harness.connections++; }
      addTrack() { return {}; }
      createDataChannel() {
        const channel = new SimulatedChannel();
        this.channel = channel;
        harness.emit = (event: unknown) => channel.onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) }));
        return channel;
      }
      async createOffer() { return { type: "offer", sdp: "v=0\r\ns=SIMULATED-TRANSPORT-ONLY\r\n" }; }
      async setLocalDescription(description: { type: string; sdp: string }) { this.localDescription = description; }
      async setRemoteDescription() { harness.emit({ type: "session.started" }); }
      close() { this.connectionState = "closed"; this.channel?.close(); }
    }
    Object.defineProperty(window, "RTCPeerConnection", { value: SimulatedPeerConnection, configurable: true });
  }, { deny: denyMicrophone });
  await page.route("**/api/voice/interpret", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ type: "decision.event", event_id: "simulated-none", source_event_id: null, source_event_type: null, event: { type: "decision.completed", decision: { answers: [{ type: "choice", name: "action", choice: "none" }, { type: "choice", name: "task", choice: "none" }] } } }),
  }));
  await page.route("**/api/voice/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "simulated-sdp-session", transport: { sdp: "v=0\r\ns=SIMULATED-ANSWER\r\n" } }),
  }));
}

async function startCase(page: Page): Promise<CareState> {
  const response = await page.request.post("/api/demo", { data: { scenario: "ready", role: "patient" }, headers: { Origin: base } });
  expect(response.status()).toBe(200);
  const state = await response.json() as CareState;
  await page.goto(`/?demo=${state.demoId}&role=patient`);
  await expect(page.getByRole("button", { name: "Falar com assistente", exact: true })).toBeVisible();
  return state;
}

async function caregiverFor(browser: Browser, state: CareState): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: base, timezoneId: "America/Sao_Paulo" });
  const response = await context.request.post("/api/demo", { data: { scenario: "ready", role: "caregiver", demoId: state.demoId }, headers: { Origin: base } });
  expect(response.status()).toBe(200);
  return context;
}

async function readState(context: BrowserContext) {
  const response = await context.request.get("/api/state");
  expect(response.status()).toBe(200);
  return await response.json() as CareState;
}

async function openVoice(page: Page, display: Display, capture = false) {
  await page.getByRole("button", { name: "Falar com assistente", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Registrar por voz", exact: true })).toBeVisible();
  if (capture) await captureVoice(page, display, "idle");
  await page.getByRole("button", { name: "Começar a falar", exact: true }).click();
  await expect(page.getByText("Microfone ligado", { exact: true })).toBeVisible();
  if (capture) await captureVoice(page, display, "listening");
}

async function emit(page: Page, event: VoiceEvent) {
  const sent = emittedSources.get(page) ?? new Set<string>();
  emittedSources.set(page, sent);
  if (!sent.has(event.source_event_id)) {
    sent.add(event.source_event_id);
    await page.evaluate((payload) => window.__voiceHarness.emit(payload), transcriptEvent(event.source_event_id, decisionPhrases.get(event.event_id) ?? "Relato de um cuidado.", sent.size));
  }
  await page.evaluate((payload) => window.__voiceHarness.emit(payload), event);
}

async function emitNative(page: Page, event: unknown) {
  await page.evaluate((payload) => window.__voiceHarness.emit(payload), event);
}

function transcriptEvent(id: string, delta: string, sequence: number) {
  return { type: "session.input_transcript.delta", event_id: id, delta, start_ms: sequence * 1000, end_ms: sequence * 1000 + 800 };
}

function nativeDecision(sourceId: string, triggerId: string, taskId: string, action: string, eventId = randomUUID()) {
  return {
    type: "decision.event", event_id: eventId, delegation_id: null,
    source_event_id: sourceId, source_event_type: "session.input_transcript.delta", trigger_id: triggerId,
    event: { type: "decision.completed", decision: { model: captured.model, answers: [{ type: "choice", name: "action", choice: action }, { type: "choice", name: "task", choice: taskId }] } },
  };
}

async function confirmVoice(page: Page, manualReady?: () => Promise<void>, buttonName = "Confirmar registro") {
  const response = page.waitForResponse((candidate) => candidate.url().endsWith("/api/actions") && candidate.request().method() === "POST", { timeout: manualReady ? 90_000 : 12_000 });
  if (manualReady) await manualReady();
  else await page.getByRole("button", { name: buttonName, exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.locator(".voice-panel .sr-only[role=status]")).toHaveText("Registro salvo e compartilhado com seu cuidador.");
  await expect(page.locator('.voice-panel[data-voice-state="saved"]')).toBeVisible();
  expect(await page.evaluate(() => {
    if (window.__voiceHarness) return window.__voiceHarness.track.enabled;
    const live = (window as unknown as { __liveAudio: { destination: MediaStreamAudioDestinationNode } }).__liveAudio;
    return live.destination.stream.getAudioTracks().some((track) => track.enabled);
  })).toBe(false);
  await expect(page.getByRole("button", { name: "Confirmar registro", exact: true })).toHaveCount(0);
}

async function recoverLostSaveResponse(page: Page, caregiver: BrowserContext, task: CareState["tasks"][number], options: { manual?: boolean; runId?: string; caseId?: string } = {}) {
  const before = await readState(caregiver);
  const requests: unknown[] = [];
  let committedStatus = 0;
  let announceCommit!: () => void;
  const committed = new Promise<void>((resolve) => { announceCommit = resolve; });
  let releaseResponse!: () => void;
  const release = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const pattern = "**/api/actions";
  await page.route(pattern, async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length > 1) return route.continue();
    const response = await route.fetch(); // The actual backend commits before its response is lost.
    committedStatus = response.status();
    announceCommit();
    await release;
    await route.abort("failed");
  });
  const signal = async (status: string, button: string) => {
    await writeFile(resolve(reportDirectory, "manual-ready.json"), JSON.stringify({ status, runId: options.runId, createdAt: new Date().toISOString(), caseId: options.caseId, taskId: task.id, taskTitle: task.title, taskTime: task.time, browser: "Google Chrome for Testing", appPID: null, runnerPID: process.pid, viewport: { width: 390, height: 844 }, url: page.url(), action: `Root must click ${button} through native Computer Use. The test does not click in manual mode.` }, null, 2) + "\n");
    console.log("MANUAL_SAVE_RECOVERY", status, options.runId);
  };
  try {
    if (options.manual) await signal("ready", "Confirmar registro");
    else await page.getByRole("button", { name: "Confirmar registro", exact: true }).click();
    await committed;
    expect(committedStatus).toBe(200);
    await expect(page.locator(".voice-status")).toHaveText("Salvando…");
    await expect(page.locator(".voice-panel")).toHaveAttribute("aria-busy", "true");
    await page.screenshot({ path: resolve(reportDirectory, "recovery-saving.png"), scale: "css", animations: "disabled" });
    releaseResponse();
    await expect(page.getByRole("button", { name: "Tentar salvar de novo", exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveText("Não recebi a confirmação. Tente salvar de novo.");
    await expect(page.locator('.voice-panel[data-voice-state="confirming"] .voice-record')).toContainText(task.title);
    await expect(page.locator(".voice-panel .sr-only[role=status]")).toHaveCount(0);
    const afterLostResponse = await readState(caregiver);
    expect(afterLostResponse.tasks.find((entry) => entry.id === task.id)?.status).toBe("done");
    expect(afterLostResponse.timeline.length).toBe(before.timeline.length + 1);
    await page.screenshot({ path: resolve(reportDirectory, "recovery-failed.png"), scale: "css", animations: "disabled" });
    await page.waitForTimeout(1200); // A lost response must not trigger any automatic retry.
    expect(requests).toHaveLength(1);
    await confirmVoice(page, options.manual ? () => signal("retry-ready", "Tentar salvar de novo") : undefined, "Tentar salvar de novo");
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    const final = await readState(caregiver);
    expect(final.tasks.find((entry) => entry.id === task.id)?.status).toBe("done");
    expect(final.timeline.length).toBe(before.timeline.length + 1);
    await page.screenshot({ path: resolve(reportDirectory, "recovery-saved.png"), scale: "css", animations: "disabled" });
    return { firstResponseStatus: committedStatus, backendCommittedBeforeResponseLoss: true, localizedNetworkError: true, proposalPreserved: true, noAutomaticRetry: true, identicalRequestBodyAndId: true, durableEventsAdded: final.timeline.length - before.timeline.length, requests };
  } finally { releaseResponse(); await page.unroute(pattern); }
}

type InstructionSnapshot = { content: string; tasks: { cuidado: string; hora: string; status: string }[] };

async function readInstructionSnapshots(page: Page): Promise<InstructionSnapshot[]> {
  const sent = await page.evaluate(() => {
    if (window.__voiceHarness) return window.__voiceHarness.sent;
    return (window as unknown as { __liveAudio: { sent: string[] } }).__liveAudio.sent;
  });
  return sent.flatMap((raw) => {
    const message = JSON.parse(raw) as { type: string; content?: string };
    if (message.type !== "session.instructions.append" || !message.content) return [];
    const rows = message.content.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line) as { cuidado?: string; hora?: string; status?: string });
    const tasks = rows.filter((row): row is { cuidado: string; hora: string; status: string } => typeof row.cuidado === "string" && typeof row.hora === "string" && typeof row.status === "string");
    return [{ content: message.content, tasks }];
  });
}

async function expectInstructionStatus(page: Page, target: { title: string; time: string }, status: string, afterCount = 0) {
  const matches = (snapshot: InstructionSnapshot) => snapshot.tasks.some((task) => task.cuidado === target.title && task.hora === target.time && task.status === status);
  await expect.poll(async () => (await readInstructionSnapshots(page)).slice(afterCount).some(matches)).toBe(true);
  return (await readInstructionSnapshots(page)).slice(afterCount).find(matches)!;
}

function observeActions(page: Page) {
  const actions: ActionBody[] = [];
  page.on("request", (request) => { if (request.url().endsWith("/api/actions") && request.method() === "POST") actions.push(request.postDataJSON() as ActionBody); });
  return actions;
}

async function receipt(testInfo: TestInfo, details: Record<string, unknown>) {
  await mkdir(reportDirectory, { recursive: true });
  const value = {
    test: testInfo.title,
    generatedAt: new Date().toISOString(),
    scope: "Headless UI → real Next.js backend/database integration. WebRTC, microphone and SDP session response are simulated; this does NOT prove a Live audio session or speech recognition.",
    realDecisionsSource: { path: evidencePath, sha256: evaluationHash, model: captured.model, generatedAt: captured.generatedAt, policyVersion: captured.policyVersion },
    modifications: "Only replay task choice IDs are rebound to the new synthetic case. No /api/actions or /api/state response is mocked.",
    ...details,
  };
  const body = JSON.stringify(value, null, 2);
  const path = resolve(reportDirectory, `${testInfo.title.split(" ")[0]}.json`);
  await writeFile(path, `${body}\n`);
  await testInfo.attach("integration-evidence", { body, contentType: "application/json" });
}

for (const display of displays) {
test.describe(display.id, () => {
test.use({ viewport: { width: display.width, height: display.height } });

test(`${display.id}-01-confirmation-cancel-duplicate-and-caregiver-readback`, async ({ page, browser }, testInfo) => {
  await installSimulatedTransport(page);
  const initial = await startCase(page);
  const caregiver = await caregiverFor(browser, initial);
  const medicationItem = initial.plan.items.find((item) => item.category === "medication")!;
  const medicationTasks = initial.tasks.filter((task) => task.itemId === medicationItem.id);
  expect(medicationTasks).toHaveLength(2);
  const first = medicationTasks[0];
  const second = medicationTasks[1];
  const actions = observeActions(page);
  try {
    await openVoice(page, display, true);
    const before = await readState(caregiver);
    const cancelled = decision("medication_done", first.id);
    await emit(page, { ...cancelled, event: { ...cancelled.event, type: "decision.in_progress" } });
    await expect(page.getByRole("button", { name: "Confirmar registro", exact: true })).toHaveCount(0);
    await emit(page, cancelled);
    await expect(page.getByRole("button", { name: "Confirmar registro", exact: true })).toBeVisible();
    expect((await readState(caregiver)).revision).toBe(before.revision);
    expect(actions).toHaveLength(0);
    expect(await page.evaluate(() => window.__voiceHarness.track.enabled)).toBe(false);
    await page.getByRole("button", { name: "Corrigir", exact: true }).click();
    await expect(page.getByRole("button", { name: "Confirmar registro", exact: true })).toHaveCount(0);
    expect((await readState(caregiver)).revision).toBe(before.revision);
    expect(actions).toHaveLength(0);
    await emit(page, cancelled);
    await expect(page.getByRole("button", { name: "Confirmar registro", exact: true })).toHaveCount(0);

    const completed = decision("medication_done", first.id);
    await emit(page, completed);
    await expect(page.getByRole("button", { name: "Confirmar registro", exact: true })).toBeVisible();
    expect((await readState(caregiver)).tasks.find((task) => task.id === first.id)?.status).toBe("pending");
    await captureVoice(page, display, "confirming");
    await confirmVoice(page);
    await captureVoice(page, display, "saved");
    const afterDone = await readState(caregiver);
    expect(afterDone.tasks.find((task) => task.id === first.id)?.status).toBe("done");
    expect(actions).toHaveLength(1);
    await emit(page, completed);
    await expect(page.getByRole("button", { name: "Confirmar registro", exact: true })).toHaveCount(0);
    expect(actions).toHaveLength(1);

    await page.getByRole("button", { name: "Registrar outra coisa", exact: true }).click();
    await expect(page.getByText("Microfone ligado", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__voiceHarness.track.enabled)).toBe(true);
    const notDone = decision("medication_not_done", second.id);
    await emit(page, notDone);
    await expect(page.getByRole("button", { name: "Confirmar registro", exact: true })).toBeVisible();
    expect((await readState(caregiver)).tasks.find((task) => task.id === second.id)?.status).toBe("pending");
    await confirmVoice(page);
    const final = await readState(caregiver);
    expect(final.tasks.find((task) => task.id === first.id)?.status).toBe("done");
    expect(final.tasks.find((task) => task.id === second.id)?.status).toBe("not_done");
    expect(actions).toHaveLength(2);
    expect(new Set(actions.map((action) => action.requestId)).size).toBe(2);
    expect(final.timeline.length - before.timeline.length).toBe(2);
    await page.getByRole("button", { name: "Voltar para meu dia", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "Falar com assistente", exact: true })).toBeVisible();
    const afterReload = await readState(caregiver);
    expect(afterReload.tasks.filter((task) => medicationTasks.some((medication) => medication.id === task.id)).map((task) => task.status)).toEqual(["done", "not_done"]);
    await receipt(testInfo, { result: "passed", caseId: initial.demoId, assertions: { incompleteEventIgnored: true, completedEventNeedsConfirmation: true, cancelSavedNothing: true, cancelledDecisionReplayIgnored: true, confirmedDoneReadByCaregiver: true, confirmedNotDoneReadByCaregiver: true, acceptedDecisionReplayIgnored: true, microphonePausedForConfirmation: true, persistedAfterReload: true }, actionRequests: actions, caregiverFinal: { revision: final.revision, statuses: medicationTasks.map((task) => ({ taskId: task.id, status: final.tasks.find((entry) => entry.id === task.id)?.status })) } });
  } finally { await caregiver.close(); }
});

test(`${display.id}-02-voice-sleep-and-food-preserve-existing-report`, async ({ page, browser }, testInfo) => {
  await installSimulatedTransport(page);
  const initial = await startCase(page);
  const caregiver = await caregiverFor(browser, initial);
  const actions = observeActions(page);
  try {
    await page.getByRole("button", { name: "Informar como estou", exact: true }).click();
    await page.getByLabel("Horas", { exact: true }).fill("7");
    await page.getByLabel("Minutos", { exact: true }).fill("15");
    await page.getByRole("button", { name: "Suficiente", exact: true }).click();
    await page.getByRole("button", { name: "Em parte", exact: true }).click();
    await page.getByRole("button", { name: "Bem", exact: true }).click();
    const initialSave = page.waitForResponse((response) => response.url().endsWith("/api/actions") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Salvar relato", exact: true }).click();
    expect((await initialSave).status()).toBe(200);
    await expect(page.getByRole("button", { name: "Falar com assistente", exact: true })).toBeVisible();
    const original = (await readState(caregiver)).checkIns[0];
    expect(original).toMatchObject({ sleepMinutes: 435, sleepQuality: "okay", food: "partial", mood: "good", author: "patient" });

    await openVoice(page, display);
    await emit(page, decision("sleep_low"));
    await expect(page.locator(".voice-record")).toHaveAttribute("aria-label", "Registrar que você dormiu pouco?");
    expect((await readState(caregiver)).checkIns[0]).toMatchObject(original);
    await confirmVoice(page);
    const afterSleep = (await readState(caregiver)).checkIns[0];
    expect(afterSleep).toMatchObject({ id: original.id, sleepMinutes: 435, sleepQuality: "low", food: "partial", mood: "good" });

    await page.getByRole("button", { name: "Registrar outra coisa", exact: true }).click();
    await expect(page.getByText("Microfone ligado", { exact: true })).toBeVisible();
    await emit(page, decision("food_yes_general"));
    await expect(page.locator(".voice-record")).toHaveAttribute("aria-label", "Registrar que você conseguiu se alimentar?");
    await confirmVoice(page);
    const final = (await readState(caregiver)).checkIns[0];
    expect(final).toMatchObject({ id: original.id, sleepMinutes: 435, sleepQuality: "low", food: "yes", mood: "good" });
    expect((await readState(caregiver)).checkIns).toHaveLength(1);
    expect(actions).toHaveLength(3);
    expect(actions[1]).toMatchObject({ type: "check_in", id: original.id, sleepMinutes: 435, food: "partial", mood: "good", sleepQuality: "low" });
    expect(actions[2]).toMatchObject({ type: "check_in", id: original.id, sleepMinutes: 435, food: "yes", mood: "good", sleepQuality: "low" });
    await page.getByRole("button", { name: "Voltar para meu dia", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "Atualizar relato", exact: true }).click();
    await expect(page.getByLabel("Horas", { exact: true })).toHaveValue("7");
    await expect(page.getByLabel("Minutos", { exact: true })).toHaveValue("15");
    await expect(page.getByRole("button", { name: "Pouco", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Sim", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Bem", exact: true })).toHaveAttribute("aria-pressed", "true");
    await receipt(testInfo, { result: "passed", caseId: initial.demoId, assertions: { preexistingReportCreatedThroughUI: true, sleepConfirmationPreservesHoursFoodMood: true, foodConfirmationPreservesHoursSleepMood: true, caregiverReadsSameReportId: true, persistedAfterReload: true }, originalReport: original, finalReport: final, actionRequests: actions });
  } finally { await caregiver.close(); }
});

test(`${display.id}-03-denied-microphone-keeps-manual-buttons-working`, async ({ page, browser }, testInfo) => {
  await installSimulatedTransport(page, true);
  const initial = await startCase(page);
  const caregiver = await caregiverFor(browser, initial);
  const actions = observeActions(page);
  let voiceSessionRequests = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/voice/session")) voiceSessionRequests++; });
  try {
    await page.getByRole("button", { name: "Falar com assistente", exact: true }).click();
    await page.getByRole("button", { name: "Começar a falar", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "O microfone não foi autorizado" })).toBeVisible();
    expect(actions).toHaveLength(0);
    expect(voiceSessionRequests).toBe(0);
    await captureVoice(page, display, "error");
    await page.getByRole("button", { name: "Prefiro usar os botões", exact: true }).click();
    const primary = page.locator('[data-parity-anchor="next-care"]');
    const title = await primary.locator("h2").innerText();
    const before = await readState(caregiver);
    const next = before.tasks.find((task) => task.status === "pending")!;
    await expect(primary.getByRole("button", { name: "Já fiz", exact: true })).toBeEnabled();
    const saved = page.waitForResponse((response) => response.url().endsWith("/api/actions") && response.request().method() === "POST");
    await primary.getByRole("button", { name: "Já fiz", exact: true }).click();
    expect((await saved).status()).toBe(200);
    const final = await readState(caregiver);
    expect(final.tasks.find((task) => task.id === next.id)?.status).toBe("done");
    expect(actions).toHaveLength(1);
    await receipt(testInfo, { result: "passed", caseId: initial.demoId, assertions: { permissionErrorVisible: true, voiceTransportNotRequested: true, noVoiceActionSaved: true, manualButtonStillEnabledAndSaved: true, caregiverReadback: true }, manualTask: { title, id: next.id, status: "done" }, actionRequests: actions });
  } finally { await caregiver.close(); }
});

test(`${display.id}-04-native-transcript-trigger-ordering-and-correlation`, async ({ page, browser }, testInfo) => {
  await installSimulatedTransport(page);
  const initial = await startCase(page);
  const caregiver = await caregiverFor(browser, initial);
  const walkItem = initial.plan.items.find((item) => item.category === "activity")!;
  const walk = initial.tasks.find((task) => task.itemId === walkItem.id)!;
  const actions = observeActions(page);
  try {
    await openVoice(page, display);
    const before = await readState(caregiver);
    const instructionsBefore = await expectInstructionStatus(page, walk, "pending");
    const instructionCount = (await readInstructionSnapshots(page)).length;
    const oldSource = `transcript-old-${randomUUID()}`;
    const latestSource = `transcript-latest-${randomUUID()}`;
    await emitNative(page, transcriptEvent(oldSource, "Já concluí a caminhada leve.", 0));
    await emitNative(page, transcriptEvent(latestSource, "Qual é a minha próxima tarefa?", 1));
    await emitNative(page, nativeDecision(oldSource, `old-trigger-${randomUUID()}`, walk.id, "mark_done"));
    await expect(page.getByRole("button", { name: "Confirmar registro", exact: true })).toHaveCount(0);
    await emitNative(page, nativeDecision(latestSource, `queued-trigger-${randomUUID()}`, walk.id, "mark_done"));
    await emitNative(page, nativeDecision(latestSource, `none-trigger-${randomUUID()}`, "none", "none"));
    await page.waitForTimeout(1350); // Explicitly exceed the 1200ms proposal quiet-time to prove cancellation.
    await expect(page.getByRole("button", { name: "Confirmar registro", exact: true })).toHaveCount(0);
    expect(actions).toHaveLength(0);
    expect((await readState(caregiver)).revision).toBe(before.revision);

    const validSource = `transcript-valid-${randomUUID()}`;
    const validTrigger = `valid-trigger-${randomUUID()}`;
    const valid = nativeDecision(validSource, validTrigger, walk.id, "mark_done");
    expect("id" in valid.event.decision).toBe(false);
    await emitNative(page, transcriptEvent(validSource, "Pode concluir a caminhada leve.", 2));
    await emitNative(page, valid);
    await expect(page.getByRole("button", { name: "Confirmar registro", exact: true })).toBeVisible();
    const fillerSource = `transcript-filler-${randomUUID()}`;
    await emitNative(page, transcriptEvent(fillerSource, "Aparece um cartão onde eu confirmo o registro?", 3));
    await emitNative(page, nativeDecision(fillerSource, `filler-trigger-${randomUUID()}`, "none", "none"));
    await expect(page.getByRole("button", { name: "Confirmar registro", exact: true })).toBeVisible();
    await expect(page.locator(".voice-record")).toHaveAttribute("aria-label", new RegExp(walk.title));
    expect(actions).toHaveLength(0);
    expect((await readState(caregiver)).tasks.find((task) => task.id === walk.id)?.status).toBe("pending");
    await emitNative(page, valid);
    await expect(page.getByRole("button", { name: "Confirmar registro", exact: true })).toHaveCount(1);
    await confirmVoice(page);
    const instructionsAfter = await expectInstructionStatus(page, walk, "done", instructionCount);
    expect(actions).toHaveLength(1);
    const final = await readState(caregiver);
    expect(final.tasks.find((task) => task.id === walk.id)?.status).toBe("done");
    expect(final.timeline.length).toBe(before.timeline.length + 1);
    await expect(page.locator('.voice-panel[data-voice-state="saved"] .voice-record')).toContainText(walk.title);
    await emitNative(page, valid);
    await expect(page.getByRole("button", { name: "Confirmar registro", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Registrar outra coisa", exact: true }).click();
    await expect(page.getByText("Microfone ligado", { exact: true })).toBeVisible();
    await emitNative(page, { ...valid, event_id: randomUUID() });
    await page.waitForTimeout(1350); // Replayed old source must remain ignored in the newly connected session.
    await expect(page.getByRole("button", { name: "Confirmar registro", exact: true })).toHaveCount(0);
    expect(actions).toHaveLength(1);
    await page.getByRole("button", { name: "Parar de ouvir", exact: true }).click();
    await page.getByRole("button", { name: "Prefiro usar os botões", exact: true }).click();
    await page.reload();
    expect((await readState(caregiver)).tasks.find((task) => task.id === walk.id)?.status).toBe("done");
    await receipt(testInfo, { result: "passed", caseId: initial.demoId, assertions: { nativeEnvelopeWithoutDecisionId: true, olderTranscriptDecisionIgnored: true, noneProducesNoProposal: true, latestTranscriptCorrelated: true, explicitRequestSurvivesContinuousFiller: true, proposalNeedsConfirmation: true, exactAndTriggerReplayIgnored: true, savedCardShowsActualCare: true, confirmedRecordPersists: true, confirmationSendsUpdatedInstructions: true }, instructionsBefore, instructionsAfter, nativeDecision: valid, actionRequests: actions });
  } finally { await caregiver.close(); }
});


test(`${display.id}-05-lost-save-response-retries-without-duplicate`, async ({ page, browser }, testInfo) => {
  await installSimulatedTransport(page);
  const initial = await startCase(page);
  const caregiver = await caregiverFor(browser, initial);
  const item = initial.plan.items.find((entry) => entry.category === "activity")!;
  const task = initial.tasks.find((entry) => entry.itemId === item.id)!;
  try {
    await openVoice(page, display);
    await emit(page, decision("medication_done", task.id));
    await expect(page.getByRole("button", { name: "Confirmar registro", exact: true })).toBeVisible();
    const recovery = await recoverLostSaveResponse(page, caregiver, task);
    await receipt(testInfo, { result: "passed", caseId: initial.demoId, assertions: recovery });
  } finally { await caregiver.close(); }
});

});
}

// Opt-in integration: synthetic audio source, native WebRTC and a real /api/voice/session.
// No transport, SDP, transcript or Decisions event is mocked in this test.
test("real-live-webrtc-continuous-request-then-confirmed-walk", async ({ page, browser }) => {
  test.skip(process.env.CARE_E2E_LIVE !== "1", "Set CARE_E2E_LIVE=1 to use the authorized real Live API.");
  const manualAcceptance = process.env.CARE_E2E_MANUAL_ACCEPT === "1";
  const recoverLostResponse = process.env.CARE_E2E_LOST_RESPONSE === "1";
  test.setTimeout(manualAcceptance ? (recoverLostResponse ? 240_000 : 180_000) : 120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mkdir(reportDirectory, { recursive: true });
  const audioDirectory = process.env.CARE_E2E_AUDIO_DIR || "/private/tmp/cuidado-live-audio";
  const questionBytes = await readFile(resolve(audioDirectory, "question.wav"));
  const statementFile = process.env.CARE_E2E_LIVE_STATEMENT || "continuous-walk.wav";
  const statementPhrase = statementFile === "completed-walk.wav" ? "Já concluí a caminhada leve." : "Pode concluir a caminhada leve. Aparece um cartão onde eu posso confirmar o registro, certo?";
  const statementBytes = await readFile(resolve(audioDirectory, statementFile));
  await page.addInitScript(() => {
    type NativeEventLog = { receivedAt: number; type: string; delta?: string; event_id?: string; source_event_id?: string | null; source_event_type?: string | null; trigger_id?: string | null; event?: unknown; error?: unknown };
    const state = { context: null as AudioContext | null, destination: null as MediaStreamAudioDestinationNode | null, events: [] as NativeEventLog[], sent: [] as string[] };
    Object.defineProperty(window, "__liveAudio", { value: state });
    const createDataChannel = RTCPeerConnection.prototype.createDataChannel;
    RTCPeerConnection.prototype.createDataChannel = function (...args) {
      const channel = createDataChannel.apply(this, args);
      const send = channel.send.bind(channel);
      channel.send = ((data: string) => { state.sent.push(data); return send(data); }) as typeof channel.send;
      channel.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(event.data);
          if (["session.started", "session.input_transcript.delta", "session.output_transcript.delta", "decision.event", "error"].includes(message.type)) state.events.push({ receivedAt: Date.now(), ...message });
        } catch { /* Native binary/audio messages are not text evidence. */ }
      });
      return channel;
    };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => {
      const context = new AudioContext({ sampleRate: 24000 });
      const destination = context.createMediaStreamDestination();
      await context.resume();
      state.context = context; state.destination = destination;
      return destination.stream;
    } } });
    // Chromium's headless --mute-audio also suppresses output. Keep any native media
    // element muted; synthetic input connects only to the MediaStream destination.
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { this.muted = true; return originalPlay.call(this); };
  });
  const initial = await startCase(page);
  const caregiver = await caregiverFor(browser, initial);
  const walkItem = initial.plan.items.find((item) => item.category === "activity")!;
  const walk = initial.tasks.find((task) => task.itemId === walkItem.id)!;
  const requests = observeActions(page);
  const interpretationRequests: unknown[] = [];
  page.on("request", (request) => { if (request.url().endsWith("/api/voice/interpret") && request.method() === "POST") interpretationRequests.push(request.postDataJSON()); });
  const manualRunId = randomUUID();
  let passed = false;
  let questionResponse = "";
  let recoveryEvidence: unknown = null;
  try {
    for (const task of initial.tasks.filter((entry) => entry.id !== walk.id)) {
      const seeded = await page.request.post("/api/actions", { data: { type: "record_task", taskId: task.id, status: "done", requestId: randomUUID() }, headers: { Origin: base } });
      expect(seeded.status()).toBe(200);
    }
    await page.reload();
    await expect(page.getByRole("button", { name: "Falar com assistente", exact: true })).toBeVisible();
    const setup = await readState(caregiver);
    expect(setup.tasks.filter((entry) => entry.status === "pending").map((entry) => entry.id)).toEqual([walk.id]);
    await page.getByRole("button", { name: "Falar com assistente", exact: true }).click();
    await page.getByRole("button", { name: "Começar a falar", exact: true }).click();
    await expect(page.getByText("Microfone ligado", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expectInstructionStatus(page, walk, "pending");
    const instructionCount = (await readInstructionSnapshots(page)).length;
    const feed = async (bytes: Buffer) => page.evaluate(async (encoded) => {
      const state = (window as unknown as { __liveAudio: { context: AudioContext; destination: MediaStreamAudioDestinationNode } }).__liveAudio;
      const data = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      const buffer = await state.context.decodeAudioData(data.buffer);
      await state.context.resume();
      const source = state.context.createBufferSource();
      source.buffer = buffer; source.connect(state.destination);
      await new Promise<void>((resolve) => { source.onended = () => resolve(); source.start(); });
    }, bytes.toString("base64"));
    const previousOutputCount = await page.evaluate(() => (window as unknown as { __liveAudio: { events: { type: string }[] } }).__liveAudio.events.filter((event) => event.type === "session.output_transcript.delta").length);
    await feed(questionBytes);
    await expect.poll(async () => page.evaluate((beforeCount) => {
      const events = (window as unknown as { __liveAudio: { events: { type: string; receivedAt: number }[] } }).__liveAudio.events;
      const output = events.filter((event) => event.type === "session.output_transcript.delta");
      return output.length > beforeCount && Date.now() - output[output.length - 1].receivedAt > 1500;
    }, previousOutputCount), { timeout: 30_000, intervals: [300, 500, 800] }).toBe(true);
    questionResponse = await page.evaluate((beforeCount) => (window as unknown as { __liveAudio: { events: { type: string; delta?: string }[] } }).__liveAudio.events.filter((event) => event.type === "session.output_transcript.delta").slice(beforeCount).map((event) => event.delta ?? "").join(""), previousOutputCount);
    expect(questionResponse).toMatch(/caminhada/i);
    await expect(page.getByRole("button", { name: "Confirmar registro", exact: true })).toHaveCount(0);
    expect(requests).toHaveLength(0);
    await feed(statementBytes);
    await expect(page.getByRole("button", { name: "Confirmar registro", exact: true })).toBeVisible({ timeout: 45_000 });
    await expect(page.locator(".voice-record")).toContainText(walk.title);
    expect((await readState(caregiver)).tasks.find((task) => task.id === walk.id)?.status).toBe("pending");
    await page.screenshot({ path: resolve(reportDirectory, "real-live-confirming.png"), scale: "css" });
    if (recoverLostResponse) recoveryEvidence = await recoverLostSaveResponse(page, caregiver, walk, { manual: manualAcceptance, runId: manualRunId, caseId: initial.demoId });
    else {
    await confirmVoice(page, manualAcceptance ? async () => {
      await writeFile(resolve(reportDirectory, "manual-ready.json"), JSON.stringify({ status: "ready", runId: manualRunId, createdAt: new Date().toISOString(), caseId: initial.demoId, taskId: walk.id, taskTitle: walk.title, taskTime: walk.time, browser: "Google Chrome for Testing", appPID: null, runnerPID: process.pid, viewport: { width: 390, height: 844 }, url: page.url(), action: "Root must click Confirmar registro through native Computer Use. The test does not click in manual mode." }, null, 2) + "\n");
      console.log("MANUAL_CONFIRMATION_READY", manualRunId);
    } : undefined);
    }
    await expectInstructionStatus(page, walk, "done", instructionCount);
    const final = await readState(caregiver);
    expect(final.tasks.find((task) => task.id === walk.id)?.status).toBe("done");
    expect(requests).toHaveLength(recoverLostResponse ? 2 : 1);
    await expect(page.locator('.voice-panel[data-voice-state="saved"] .voice-record')).toContainText(walk.title);
    await expect(page.getByRole("button", { name: "Registrar outra coisa", exact: true })).toBeEnabled();
    await page.screenshot({ path: resolve(reportDirectory, "real-live-saved.png"), scale: "css", animations: "disabled" });
    passed = true;
    if (manualAcceptance) await writeFile(resolve(reportDirectory, "manual-ready.json"), JSON.stringify({ status: "confirmed", runId: manualRunId, confirmedAt: new Date().toISOString(), caseId: initial.demoId, taskId: walk.id, persistedStatus: final.tasks.find((task) => task.id === walk.id)?.status, actionCount: requests.length }, null, 2) + "\n");
  } finally {
    const events = await page.evaluate(() => (window as unknown as { __liveAudio?: { events: unknown[] } }).__liveAudio?.events ?? []).catch(() => []);
    const instructions = await readInstructionSnapshots(page).catch(() => []);
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(resolve(reportDirectory, "real-live-webrtc.json"), JSON.stringify({ result: passed ? "passed" : "failed", generatedAt: new Date().toISOString(), caseId: initial.demoId, taskId: walk.id, method: "Native RTCPeerConnection, real /api/voice/session and provider events. Only getUserMedia is replaced by synthetic pt-BR speech through WebAudio MediaStreamDestination; no speaker output.", syntheticAudio: [{ phrase: "O que falta eu fazer hoje?", sha256: createHash("sha256").update(questionBytes).digest("hex") }, { phrase: statementPhrase, sha256: createHash("sha256").update(statementBytes).digest("hex") }], questionResponse, setup: "All non-walk tasks explicitly recorded done before connecting; only walk remained pending.", actionRequests: requests, interpretationRequests, instructions, recoveryEvidence, manualAcceptance, manualRunId, viewport: { width: 390, height: 844 }, events, limitation: "Synthetic TTS audio is not a physical microphone or human speech-quality evaluation." }, null, 2) + "\n");
    await caregiver.close();
  }
});
