import assert from "node:assert/strict";
import { test } from "node:test";

const base = process.env.TEST_BASE_URL;
if (!base) throw new Error("Set TEST_BASE_URL to a running local application (for example http://127.0.0.1:3125).");
const origin = new URL(base).origin;

async function demo(scenario: "ready" | "setup", role: "patient" | "caregiver") {
  const response = await fetch(`${base}/api/demo`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify({ scenario, role }),
  });
  assert.equal(response.status, 200);
  return { cookie: response.headers.get("set-cookie")!.split(";")[0], state: await response.json() };
}

test("import rejects incompatible or malformed forms before document reading", async (t) => {
  const caregiver = await demo("setup", "caregiver");
  const patient = await demo("setup", "patient");
  const active = await demo("ready", "caregiver");
  const emptyBoundForm = new FormData();
  emptyBoundForm.set("context", JSON.stringify({ demoId: caregiver.state.demoId, role: caregiver.state.role }));
  const cases = [
    { name: "valid context with no source", body: emptyBoundForm, status: 400 },
    { name: "JSON content", body: "{}", type: "application/json", status: 415 },
    { name: "plain text content", body: "text", type: "text/plain", status: 415 },
    { name: "missing multipart boundary", body: "invalid", type: "multipart/form-data", status: 400 },
    { name: "malformed multipart body", body: "invalid", type: "multipart/form-data; boundary=test", status: 400 },
    { name: "valid empty multipart form", body: new FormData(), status: 400 },
    { name: "valid empty URL-encoded form", body: "", type: "application/x-www-form-urlencoded", status: 400 },
    { name: "forbidden origin", body: "{}", type: "application/json", origin: "https://other.invalid", status: 403 },
    { name: "unauthenticated", body: "{}", type: "application/json", cookie: "", status: 401 },
    { name: "patient role", body: "{}", type: "application/json", cookie: patient.cookie, status: 403 },
    { name: "active plan", body: "{}", type: "application/json", cookie: active.cookie, status: 409 },
  ];
  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const response = await fetch(`${base}/api/import`, {
        method: "POST",
        headers: {
          ...(entry.type ? { "Content-Type": entry.type } : {}),
          cookie: entry.cookie ?? caregiver.cookie,
          origin: entry.origin ?? origin,
        },
        body: entry.body,
      });
      assert.equal(response.status, entry.status);
      const body = await response.json();
      assert.equal(typeof body.error, "string");
      assert.doesNotMatch(body.error, /Não foi possível ler este documento/);
    });
  }
  const state = await fetch(`${base}/api/state`, { headers: { cookie: caregiver.cookie } });
  assert.equal(state.status, 200);
  assert.deepEqual(await state.json(), caregiver.state, "invalid forms must leave the draft unchanged");
});
