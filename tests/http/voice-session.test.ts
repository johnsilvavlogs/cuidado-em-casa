import assert from "node:assert/strict";
import { test } from "node:test";

const base = process.env.TEST_BASE_URL;
if (!base) throw new Error("Set TEST_BASE_URL to a running local application (for example http://127.0.0.1:3125).");
const origin = new URL(base).origin;

test("voice rejects invalid requests with client errors before calling the provider", async (t) => {
  const demo = await fetch(`${base}/api/demo`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify({ scenario: "ready", role: "patient" }),
  });
  assert.equal(demo.status, 200);
  const cookie = demo.headers.get("set-cookie")!.split(";")[0];
  const initial = await demo.json();
  const cases = [
    { name: "null", body: "null", status: 400 },
    { name: "malformed JSON", body: "{", status: 400 },
    { name: "array", body: "[]", status: 400 },
    { name: "primitive", body: '"text"', status: 400 },
    { name: "missing SDP", body: "{}", status: 400 },
    { name: "invalid SDP", body: '{"sdp":"bad"}', status: 400 },
    { name: "unsupported content type", body: "{}", type: "text/plain", status: 415 },
    { name: "forbidden origin", body: "{}", origin: "https://other.invalid", status: 403 },
    { name: "cross-site fetch", body: "{}", site: "cross-site", status: 403 },
    { name: "unauthenticated", body: "{}", authenticated: false, status: 401 },
  ];
  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const response = await fetch(`${base}/api/voice/session`, {
        method: "POST",
        headers: {
          "Content-Type": entry.type ?? "application/json",
          origin: entry.origin ?? origin,
          ...(entry.site ? { "Sec-Fetch-Site": entry.site } : {}),
          ...(entry.authenticated === false ? {} : { cookie }),
        },
        body: entry.body,
      });
      assert.equal(response.status, entry.status);
      const body = await response.json();
      assert.equal(typeof body.error, "string");
      assert.doesNotMatch(body.error, /voz não está disponível/);
    });
  }
  const state = await fetch(`${base}/api/state`, { headers: { cookie } });
  assert.equal(state.status, 200);
  assert.deepEqual(await state.json(), initial, "invalid voice requests must leave the care state unchanged");
});
