import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
// @ts-expect-error The executable helper is deliberately plain Node.js.
import { previewCommand } from "./care-preview.mjs";

function readConfig(directory: string | undefined) {
  const env = { ...process.env };
  delete env.CARE_DIST_DIR;
  if (directory !== undefined) env.CARE_DIST_DIR = directory;
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", "import config from './next.config.ts'; console.log(config.distDir)"], { cwd: process.cwd(), env, encoding: "utf8" });
}

test("build directory defaults stay compatible; named local outputs are independent", () => {
  for (const [directory, expected] of [[undefined, ".next"], [".next-preview", ".next-preview"], [".next-stable", ".next-stable"]]) {
    const result = readConfig(directory);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), expected);
  }
});

test("build directory rejects absolute, traversal, nested and unrelated paths", () => {
  for (const directory of ["", "/tmp/build", "../.next-preview", ".next/preview", ".next-preview/../.next", ".data", ".next-"]) {
    const result = readConfig(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CARE_DIST_DIR/);
  }
});

test("preview commands pin their own output and port without executing a server", () => {
  const root = path.resolve(".");
  const build = previewCommand("build", root);
  const start = previewCommand("start", root);
  assert.equal(build.distDir, ".next-preview");
  assert.equal(start.distDir, ".next-preview");
  assert.deepEqual(build.args.slice(1), ["build", "--webpack"]);
  assert.deepEqual(start.args.slice(1), ["start", "--hostname", "127.0.0.1", "--port", "3002"]);
  assert.throws(() => previewCommand("dev", root), /Uso:/);
});
