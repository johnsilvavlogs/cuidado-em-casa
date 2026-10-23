import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const origin = new URL(process.env.CLOUD_APP_ORIGIN || "https://cuidado-em-casa.johnsilvabr.chatgpt.site").origin;
function client() {
  let cookie = "";
  return async (path, data, options = {}) => {
    const headers = { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) };
    const init = { headers, signal: AbortSignal.timeout(130_000), ...options };
    if (data !== undefined) { init.method = "POST"; init.body = JSON.stringify(data); headers["Content-Type"] = "application/json"; }
    const response = await fetch(origin + path, init);
    const session = response.headers.getSetCookie().find(value => value.startsWith("care_demo_session="));
    if (session) cookie = session.split(";", 1)[0];
    const text = await response.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    if (!options.allowError) assert.ok(response.ok, `${path}: ${response.status}: ${JSON.stringify(body)}`);
    return { status: response.status, body, headers: response.headers };
  };
}

const patient = client(), caregiver = client(), stranger = client();
const health = await patient("/api/health");
assert.equal(health.body.storage, "d1-r2");
const entry = await patient("/play-demo", undefined, { redirect: "manual", allowError: true });
assert.equal(entry.status, 303);
assert.equal(new URL(entry.headers.get("location"), origin).pathname, "/app");
const initial = (await patient("/api/state")).body;
const caseId = initial.demoId;
await caregiver("/api/demo", { scenario: "ready", role: "caregiver", demoId: caseId });
const task = initial.tasks[0];
const action = { type: "record_task", taskId: task.id, status: "done", requestId: randomUUID() };
const input = { context: { demoId: caseId, role: "patient" }, action };
const results = await Promise.all([patient("/api/actions", input), patient("/api/actions", input)]);
assert.equal(results[0].body.revision, results[1].body.revision);
await patient("/api/actions", { context: input.context, action: { type: "check_in", sleepMinutes: null, sleepRange: "under4", sleepQuality: "low", food: null, mood: null, requestId: randomUUID() } });
const shared = (await caregiver("/api/state")).body;
assert.equal(shared.tasks.find(value => value.id === task.id).status, "done");
assert.equal(shared.checkIns[0].sleepRange, "under4");
assert.equal(shared.checkIns[0].sleepMinutes, null);
const document = await caregiver(shared.document.url);
assert.equal(typeof document.body, "string");
assert.ok(document.body.length > 20);
const denied = await stranger(shared.document.url, undefined, { allowError: true });
assert.equal(denied.status, 401);
const separate = (await stranger("/api/demo", { scenario: "ready", role: "patient" })).body;
assert.notEqual(separate.demoId, caseId);
assert.equal((await stranger(shared.document.url, undefined, { allowError: true })).status, 404);

const account = client();
const email = `cloud-${randomUUID()}@example.test`, password = `Test-${randomUUID()}`;
const registered = (await account("/api/auth/register", { name: "Marina Teste", email, password })).body;
assert.equal(registered.account.name, "Marina Teste");
await account("/api/auth/logout", {});
assert.equal((await account("/api/state", undefined, { allowError: true })).status, 401);
const logged = (await account("/api/auth/login", { email, password })).body;
assert.equal(logged.account.name, "Marina Teste");
await account("/api/auth/logout", {});

const receipt = { result: "passed", origin, at: new Date().toISOString(), caseId, checks: ["hosted D1/R2 health", "fresh shared demo", "concurrent duplicate saved once", "caregiver reads completion and sleep range", "private R2 original accessible to case", "unauthenticated and unrelated case denied", "cloud account registration, logout and login"] };
await mkdir("output/cloud-proof", { recursive: true });
await writeFile("output/cloud-proof/production-smoke.json", JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt));
