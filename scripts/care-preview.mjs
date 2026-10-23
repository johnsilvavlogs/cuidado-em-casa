#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function previewCommand(mode, root) {
  if (mode !== "build" && mode !== "start") throw new Error("Uso: node scripts/care-preview.mjs build|start");
  return {
    executable: process.execPath,
    args: [path.join(root, "node_modules/next/dist/bin/next"), ...(mode === "build" ? ["build", "--webpack"] : ["start", "--hostname", "127.0.0.1", "--port", "3002"])],
    cwd: root,
    distDir: ".next-preview",
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === "--help" || mode === "-h") {
    console.log("Uso: node scripts/care-preview.mjs build|start\nBuild isolado: .next-preview. Servidor de prévia: http://127.0.0.1:3002.\nNão inicia, encerra ou reconstrói a aplicação da porta 3000. Use um contexto de navegador isolado.");
  } else {
    const root = fileURLToPath(new URL("../", import.meta.url));
    let command;
    try { command = previewCommand(mode, root); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
    if (command) {
      const child = spawn(command.executable, command.args, {
        cwd: command.cwd,
        env: { ...process.env, CARE_DIST_DIR: command.distDir },
        stdio: "inherit",
      });
      child.on("error", error => { console.error(error.message); process.exitCode = 1; });
      child.on("exit", code => { process.exitCode = code ?? 1; });
    }
  }
}
