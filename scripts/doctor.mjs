import { createClient } from "@libsql/client";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const db = createClient({ url: "file::memory:" });
try {
  const result = await db.execute("select 1 as ready");
  const ready = result.rows[0]?.ready === 1;
  console.log(JSON.stringify({
    node: process.version,
    openaiKeyPresent: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_MODEL || "gpt-6.1-sol",
    sqlite: ready ? "ok" : "failed",
  }, null, 2));
  if (!ready || !process.env.OPENAI_API_KEY) process.exitCode = 1;
} finally {
  db.close();
}
