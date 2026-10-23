import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { CareError, CareRepository } from "../../src/lib/server/care-repository";

test("CARE_DATA_DIR selects persistent storage and explicit dataDir takes precedence", async () => {
  const original = process.env.CARE_DATA_DIR;
  const environmentDirectory = await mkdtemp(path.join(os.tmpdir(), "care-data-environment-"));
  const explicitDirectory = await mkdtemp(path.join(os.tmpdir(), "care-data-explicit-"));
  const now = () => new Date("2026-10-23T15:00:00.000Z");
  let repository: CareRepository | undefined;
  let explicitRepository: CareRepository | undefined;

  try {
    process.env.CARE_DATA_DIR = environmentDirectory;
    repository = new CareRepository({ now });
    const demo = await repository.startDemo({ scenario: "ready", role: "caregiver" });
    const originalDocument = await repository.getDocument(demo.token, demo.state.document!.id);
    assert.ok((await stat(path.join(environmentDirectory, "care.sqlite"))).isFile());
    await repository.close();

    repository = new CareRepository({ now });
    assert.equal((await repository.getState(demo.token)).demoId, demo.state.demoId);
    const reopenedDocument = await repository.getDocument(demo.token, demo.state.document!.id);
    assert.deepEqual(reopenedDocument.bytes, originalDocument.bytes);

    explicitRepository = new CareRepository({ dataDir: explicitDirectory, now });
    const separateDemo = await explicitRepository.startDemo({ scenario: "setup", role: "caregiver" });
    assert.ok((await stat(path.join(explicitDirectory, "care.sqlite"))).isFile());
    assert.notEqual(separateDemo.state.demoId, demo.state.demoId);
    await assert.rejects(explicitRepository.getState(demo.token), (error: unknown) => error instanceof CareError && error.status === 401);
    await assert.rejects(repository.getState(separateDemo.token), (error: unknown) => error instanceof CareError && error.status === 401);
  } finally {
    if (original === undefined) delete process.env.CARE_DATA_DIR;
    else process.env.CARE_DATA_DIR = original;
    await Promise.all([repository?.close(), explicitRepository?.close()]);
  }
});
