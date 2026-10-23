import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { CareRepository } from "../../src/lib/server/care-repository";

const now = () => new Date("2026-10-23T15:00:00Z");
type WorkerInput = { dataDir: string; token: string; documentId: string; taskId: string; worker: number };

async function worker(input: WorkerInput) {
  const repository = new CareRepository({ dataDir: input.dataDir, now });
  process.send?.({ ready: true });
  await new Promise<void>(resolve => process.once("message", () => resolve()));
  try {
    for (let index = 0; index < 6; index++) {
      await Promise.all([repository.getState(input.token), repository.getDocument(input.token, input.documentId)]);
      await repository.mutate(input.token, { type: "record_task", taskId: input.taskId, status: "done", requestId: "same-request-all-processes" });
      await repository.mutate(input.token, { type: "request_help", message: `worker ${input.worker}, request ${index}`, urgent: false, requestId: `worker-${input.worker}-request-${index}` });
      if (index === 0) await repository.startDemo({ scenario: "ready", role: "patient" });
    }
    process.send?.({ completed: true });
  } catch (error) {
    process.send?.({ error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  } finally {
    await repository.close().catch(() => {});
    process.disconnect?.();
  }
}

if (process.env.CARE_CONCURRENCY_WORKER) {
  await worker(JSON.parse(process.env.CARE_CONCURRENCY_WORKER));
} else {
  test("read-only state and originals remain available while another connection owns the writer lock", async t => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "care-readers-"));
    const repository = new CareRepository({ dataDir, now });
    t.after(() => repository.close());
    const demo = await repository.startDemo({ scenario: "ready", role: "patient" });
    const writer = createClient({ url: pathToFileURL(path.join(dataDir, "care.sqlite")).href, concurrency: 1 });
    t.after(() => writer.close());
    const transaction = await writer.transaction("write");
    t.after(() => transaction.close());
    await transaction.execute("UPDATE care_cases SET state_json = state_json");
    const [state, document] = await Promise.all([repository.getState(demo.token), repository.getDocument(demo.token, demo.state.document!.id)]);
    assert.equal(state.demoId, demo.state.demoId);
    assert.equal(state.revision, demo.state.revision);
    assert.equal(document.reference.id, demo.state.document!.id);
  });

  test("separate repository instances serialize local access to the same file", async t => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "care-local-queues-"));
    const repositories = Array.from({ length: 6 }, () => new CareRepository({ dataDir, now }));
    t.after(async () => { await Promise.all(repositories.map(repository => repository.close())); });
    const demos = await Promise.all(repositories.map(repository => repository.startDemo({ scenario: "ready", role: "patient" })));
    await Promise.all(repositories.map(async (repository, index) => {
      const token = demos[index].token;
      await Promise.all([repository.getState(token), repository.getDocument(token, demos[index].state.document!.id)]);
      await repository.mutate(token, { type: "request_help", message: "Local instance", urgent: false, requestId: `local-instance-${index}` });
    }));
    for (let index = 0; index < repositories.length; index++) assert.equal((await repositories[index].getState(demos[index].token)).helpRequests.length, 1);
  });

  test("a failed first database open does not poison later requests", async t => {
    const root = await mkdtemp(path.join(tmpdir(), "care-open-retry-"));
    const dataDir = path.join(root, "data");
    await writeFile(dataDir, "temporary obstruction");
    const repository = new CareRepository({ dataDir, now });
    t.after(() => repository.close());
    await assert.rejects(repository.startDemo({ scenario: "setup", role: "patient" }));
    await rename(dataDir, path.join(root, "obstruction-preserved"));
    const demo = await repository.startDemo({ scenario: "setup", role: "patient" });
    assert.equal((await repository.getState(demo.token)).demoId, demo.state.demoId);
  });

  test("a simulated commit failure is not retried and the next request uses a clean connection", async t => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "care-commit-recovery-"));
    const repository = new CareRepository({ dataDir, now });
    t.after(() => repository.close());
    const demo = await repository.startDemo({ scenario: "ready", role: "patient" });
    const client = await (repository as unknown as { database(): Promise<ReturnType<typeof createClient>> }).database();
    const begin = client.transaction.bind(client);
    let commitAttempts = 0;
    client.transaction = async mode => {
      const transaction = await begin(mode);
      transaction.commit = async () => {
        commitAttempts++;
        throw Object.assign(new Error("SQLITE_BUSY: cannot commit transaction - SQL statements in progress"), { code: "SQLITE_BUSY" });
      };
      return transaction;
    };
    const action = { type: "request_help", message: "Retry only after readback", urgent: false, requestId: "commit-failure-recovery" };
    await assert.rejects(repository.mutate(demo.token, action), /cannot commit/);
    assert.equal(commitAttempts, 1);
    assert.equal((await repository.getState(demo.token)).helpRequests.length, 0);
    const state = await repository.mutate(demo.token, action);
    assert.equal(state.helpRequests.length, 1);
    assert.equal((await repository.mutate(demo.token, action)).revision, state.revision);
  });

  test("a lost commit acknowledgement does not replay an already committed action", async t => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "care-commit-ack-"));
    const repository = new CareRepository({ dataDir, now });
    t.after(() => repository.close());
    const demo = await repository.startDemo({ scenario: "ready", role: "patient" });
    const client = await (repository as unknown as { database(): Promise<ReturnType<typeof createClient>> }).database();
    const begin = client.transaction.bind(client);
    let attempts = 0;
    client.transaction = async mode => {
      const transaction = await begin(mode);
      const commit = transaction.commit.bind(transaction);
      transaction.commit = async () => { attempts++; await commit(); throw new Error("commit acknowledgement lost"); };
      return transaction;
    };
    const action = { type: "request_help", message: "Committed exactly once", urgent: false, requestId: "lost-commit-acknowledgement" };
    await assert.rejects(repository.mutate(demo.token, action), /acknowledgement lost/);
    assert.equal(attempts, 1);
    const before = await repository.getState(demo.token);
    assert.equal(before.helpRequests.length, 1);
    const after = await repository.mutate(demo.token, action);
    assert.equal(after.revision, before.revision);
    assert.equal(after.helpRequests.length, 1);
  });

  test("four processes share SQLite while reads, session creation and idempotent writes remain consistent", { timeout: 20_000 }, async t => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "care-multiprocess-"));
    const seed = new CareRepository({ dataDir, now });
    const demo = await seed.startDemo({ scenario: "ready", role: "patient" });
    await seed.close();
    const children = Array.from({ length: 4 }, (_, index) => {
      const child = fork(fileURLToPath(import.meta.url), [], { execArgv: ["--import", "tsx"], env: { ...process.env, CARE_CONCURRENCY_WORKER: JSON.stringify({ dataDir, token: demo.token, documentId: demo.state.document!.id, taskId: demo.state.tasks[0].id, worker: index }) }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
      t.after(() => { if (child.exitCode === null) child.kill(); });
      let stderr = "";
      child.stderr?.on("data", chunk => { stderr += chunk; });
      const ready = new Promise<void>((resolve, reject) => {
        child.on("message", message => { if ((message as { ready?: boolean }).ready) resolve(); });
        child.once("error", reject);
        child.once("exit", code => { if (code) reject(new Error(stderr || `worker exited ${code}`)); });
      });
      const completed = new Promise<void>((resolve, reject) => {
        child.on("message", message => { if ((message as { error?: string }).error) reject(new Error((message as { error: string }).error)); });
        child.once("error", reject);
        child.once("exit", code => { if (code === 0) resolve(); else reject(new Error(stderr || `worker exited ${code}`)); });
      });
      // Observe immediate failure while waiting for the other workers' readiness.
      void completed.catch(() => {});
      return { child, ready, completed };
    });
    await Promise.all(children.map(child => child.ready));
    children.forEach(({ child }) => child.send("start"));
    await Promise.all(children.map(child => child.completed));
    const repository = new CareRepository({ dataDir, now });
    t.after(() => repository.close());
    const state = await repository.getState(demo.token);
    assert.equal(state.helpRequests.length, 24);
    assert.equal(state.revision, demo.state.revision + 25);
    const client = createClient({ url: pathToFileURL(path.join(dataDir, "care.sqlite")).href });
    t.after(() => client.close());
    assert.equal((await client.execute("SELECT count(*) AS n FROM operations WHERE request_id = 'same-request-all-processes'")).rows[0].n, 1);
    assert.equal((await client.execute("SELECT count(*) AS n FROM audit_events WHERE request_id = 'same-request-all-processes'")).rows[0].n, 1);
  });
}
