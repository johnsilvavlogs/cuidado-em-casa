import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const base = process.env.TEST_BASE_URL;
if (!base) throw new Error("Set TEST_BASE_URL to a running local application.");
const origin = new URL(base).origin;

async function demo(role: "patient" | "caregiver", scenario: "ready" | "setup" = "ready", demoId?: string) {
  const response = await fetch(`${base}/api/demo`, { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify({ role, scenario, ...(demoId ? { demoId } : {}) }) });
  assert.equal(response.status, 200);
  return { cookie: response.headers.get("set-cookie")!.split(";")[0], state: await response.json() };
}

async function post(route: string, body: object | FormData, cookie: string) {
  const response = await fetch(`${base}${route}`, { method: "POST", headers: { cookie, origin, ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) }, body: body instanceof FormData ? body : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

async function read(cookie: string) {
  const response = await fetch(`${base}/api/state`, { headers: { cookie } });
  assert.equal(response.status, 200);
  return response.json();
}

test("a request initiated in A never writes to B after the browser session switches", async () => {
  const a = await demo("patient");
  const b = await demo("patient");
  const context = { demoId: a.state.demoId, role: "patient" };
  const action = { type: "request_help", message: "Pedido iniciado no caso A", urgent: true, requestId: randomUUID() };
  const wrongCase = await post("/api/actions", { context, action }, b.cookie);
  assert.equal(wrongCase.status, 409);
  assert.match(wrongCase.body.error, /sessão mudou.*Nada foi salvo/i);
  const checkIn = await post("/api/actions", { context, action: { type: "check_in", sleepMinutes: null, sleepQuality: "okay", food: null, mood: null, requestId: randomUUID() } }, b.cookie);
  assert.equal(checkIn.status, 409);
  const caregiver = await demo("caregiver", "ready", a.state.demoId);
  assert.equal((await post("/api/actions", { context, action }, caregiver.cookie)).status, 409);
  assert.equal((await post("/api/actions", action, a.cookie)).status, 400);
  assert.deepEqual((await read(a.cookie)).helpRequests, []);
  assert.deepEqual((await read(b.cookie)).helpRequests, []);
  assert.deepEqual((await read(b.cookie)).checkIns, []);
  assert.equal((await post("/api/actions", { context, action }, a.cookie)).status, 200);
  assert.equal((await read(a.cookie)).helpRequests.length, 1);
  assert.deepEqual((await read(b.cookie)).helpRequests, []);
});

test("stale imports and voice setup are rejected before document storage or provider calls", async () => {
  const a = await demo("caregiver", "setup");
  const b = await demo("caregiver", "setup");
  const form = new FormData();
  form.set("context", JSON.stringify({ demoId: a.state.demoId, role: "caregiver" }));
  form.set("text", "Orientação sintética para teste.");
  assert.equal((await post("/api/import", form, b.cookie)).status, 409);
  assert.equal((await read(b.cookie)).document, null);
  const patient = await demo("patient");
  const otherPatient = await demo("patient");
  assert.equal((await post("/api/voice/session", { context: { demoId: patient.state.demoId, role: "patient" }, sdp: "v=0\r\n" }, otherPatient.cookie)).status, 409);
});
