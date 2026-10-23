import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";

const origin = new URL(process.env.CLOUD_APP_ORIGIN || "https://cuidado-em-casa.johnsilvabr.chatgpt.site").origin;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const directory = `output/cloud-proof/ai-${stamp}`;
await mkdir(directory, { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const receipt = {
  origin, startedAt: new Date().toISOString(), result: "running", requests: [], checks: [],
  expectedModels: { decisions: "gpt-6-luna", responses: "gpt-6.1-sol" },
  limitations: [
    "HTTP API verification, not browser, microphone, WebRTC or acoustic verification.",
    "The import response does not expose the provider response ID or model; the model pin is recorded from the local source prepared for deployment.",
    "Synthetic test cases remain in hosted storage; no cleanup or real patient data is used.",
  ],
};
for (const source of ["src/lib/ai/live.ts", "src/lib/ai/interpret-voice.ts", "src/lib/ai/extract.ts", "src/app/api/import/route.ts"]) {
  receipt.sourceHashes ??= {};
  receipt.sourceHashes[source] = hash(await readFile(source));
}

function client(label) {
  let cookie = "";
  return async (path, { json, form, binary = false, allowError = false } = {}) => {
    const headers = { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) };
    const init = { headers, signal: AbortSignal.timeout(130_000) };
    if (json !== undefined) {
      init.method = "POST"; init.body = JSON.stringify(json); headers["Content-Type"] = "application/json";
    } else if (form) { init.method = "POST"; init.body = form; }
    const started = Date.now();
    const response = await fetch(origin + path, init);
    const session = response.headers.getSetCookie().find((value) => value.startsWith("care_demo_session="));
    if (session) cookie = session.split(";", 1)[0];
    let body;
    if (binary) body = Buffer.from(await response.arrayBuffer());
    else {
      const text = await response.text();
      try { body = JSON.parse(text); } catch { body = text; }
    }
    receipt.requests.push({ client: label, path, method: init.method || "GET", status: response.status, durationMs: Date.now() - started, cacheControl: response.headers.get("cache-control"), ...(!response.ok && typeof body?.error === "string" ? { error: body.error } : {}) });
    if (!allowError) assert.ok(response.ok, `${label} ${path}: HTTP ${response.status}`);
    return { status: response.status, body, headers: response.headers };
  };
}

async function check(name, action) {
  try { await action(); receipt.checks.push({ name, passed: true }); }
  catch (error) {
    receipt.checks.push({ name, passed: false, error: { name: error.name, message: error.message } });
  }
}

async function waitForStorage() {
  const deadline = Date.now() + Number(process.env.CLOUD_AI_HEALTH_WAIT_MS || 180_000);
  do {
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(10_000) });
      let body; try { body = await response.json(); } catch { body = null; }
      receipt.healthAttempts ??= [];
      receipt.healthAttempts.push({ at: new Date().toISOString(), status: response.status, body });
      if (response.ok && body?.storage === "d1-r2") { receipt.health = body; return; }
    } catch (error) {
      receipt.healthAttempts ??= [];
      receipt.healthAttempts.push({ at: new Date().toISOString(), error: error.name });
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  } while (Date.now() < deadline);
  throw new Error("Hosted /api/health did not confirm storage=d1-r2 within the bounded wait.");
}

try {
  await waitForStorage();
  console.log(JSON.stringify({ stage: "storage-ready", directory, storage: receipt.health.storage }));
  const patient = client("patient"), caregiver = client("setup-caregiver"), stranger = client("unrelated-patient"), anonymous = client("anonymous");
  await Promise.all([
    check("hosted Decisions proposes the correct task without writing", async () => {
      const initial = (await patient("/api/demo", { json: { scenario: "ready", role: "patient" } })).body;
      const task = initial.tasks.find((item) => item.title === "Caminhada leve");
      assert.ok(task, "Synthetic ready case must contain Caminhada leve");
      const transcript = `Já concluí a caminhada leve das ${task.time}.`;
      const response = await patient("/api/voice/interpret", { json: { context: { demoId: initial.demoId, role: "patient" }, transcript, assistantContext: "" } });
      const event = response.body;
      assert.equal(event.type, "decision.event");
      assert.equal(event.event?.type, "decision.completed");
      const decision = event.event.decision;
      const answer = (name) => decision.answers.find((item) => item.type === "choice" && item.name === name)?.choice;
      const actual = { action: answer("action"), task: answer("task") };
      receipt.decisions = { caseId: initial.demoId, taskId: task.id, transcript, eventId: event.event_id, model: decision.model, actual, usage: decision.usage };
      assert.equal(decision.model, receipt.expectedModels.decisions);
      assert.deepEqual(actual, { action: "mark_done", task: task.id });
      const after = (await patient("/api/state")).body;
      assert.equal(after.revision, initial.revision);
      assert.deepEqual(after.tasks, initial.tasks);
      assert.deepEqual(after.timeline, initial.timeline);
      assert.equal(after.tasks.find((item) => item.id === task.id).status, "pending");
      assert.match(response.headers.get("cache-control") || "", /private.*no-store/);
      receipt.decisions.stateUnchanged = true;
      receipt.decisions.actionsExecuted = false;
    }),
    check("hosted Responses returns an editable draft and private original", async () => {
      const initial = (await caregiver("/api/demo", { json: { scenario: "setup", role: "caregiver" } })).body;
      const fixture = "testes/receitas/01_marina_duarte_falcao.pdf";
      const bytes = await readFile(fixture);
      const form = new FormData();
      form.append("context", JSON.stringify({ demoId: initial.demoId, role: "caregiver" }));
      form.append("file", new Blob([bytes], { type: "application/pdf" }), "orientacoes-sinteticas-impressas.pdf");
      const imported = (await caregiver("/api/import", { form })).body;
      receipt.responses = { caseId: initial.demoId, fixture, fixtureSha256: hash(bytes), document: imported.document, itemCount: imported.plan?.items?.length, unresolved: imported.plan?.unresolved, warnings: imported.plan?.warnings };
      assert.equal(imported.plan.status, "draft");
      assert.ok(imported.plan.items.length > 0);
      assert.equal(imported.plan.sourceReviewed, false);
      assert.ok(imported.plan.items.every((item) => item.confirmed === false));
      assert.equal(imported.tasks.length, 0);
      assert.equal(imported.document.mimeType, "application/pdf");
      assert.ok(imported.plan.items.every((item) => item.source.documentId === imported.document.id && item.source.quote));
      const original = await caregiver(imported.document.url, { binary: true });
      assert.equal(hash(original.body), hash(bytes));
      assert.match(original.headers.get("cache-control") || "", /private.*no-store/);
      const unauthenticated = await anonymous(imported.document.url, { allowError: true });
      assert.equal(unauthenticated.status, 401);
      await stranger("/api/demo", { json: { scenario: "ready", role: "patient" } });
      const unrelated = await stranger(imported.document.url, { allowError: true });
      assert.equal(unrelated.status, 404);
      const item = imported.plan.items[0];
      const title = `${item.title} (revisão sintética)`;
      const edited = (await caregiver("/api/actions", { json: {
        context: { demoId: initial.demoId, role: "caregiver" },
        action: { type: "update_item", itemId: item.id, title, instruction: item.instruction, fields: item.fields, questions: item.questions, schedule: item.schedule, requestId: randomUUID() },
      } })).body;
      assert.equal(edited.plan.items.find((entry) => entry.id === item.id)?.title, title);
      const reloaded = (await caregiver("/api/state")).body;
      assert.equal(reloaded.plan.status, "draft");
      assert.equal(reloaded.plan.items.find((entry) => entry.id === item.id)?.title, title);
      assert.ok(reloaded.plan.items.every((entry) => entry.confirmed === false));
      assert.equal(reloaded.tasks.length, 0);
      receipt.responses.originalBytesMatch = true;
      receipt.responses.privateOriginal = { anonymousStatus: unauthenticated.status, unrelatedStatus: unrelated.status };
      receipt.responses.draftEditPersisted = true;
      receipt.responses.activated = false;
    }),
  ]);
} catch (error) {
  receipt.checks.push({ name: "cloud readiness", passed: false, error: { name: error.name, message: error.message } });
}
receipt.finishedAt = new Date().toISOString();
receipt.result = receipt.checks.length === 2 && receipt.checks.every((item) => item.passed) ? "passed" : "failed";
await writeFile(`${directory}/receipt.json`, JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ result: receipt.result, directory, checks: receipt.checks }));
if (receipt.result !== "passed") process.exitCode = 1;
