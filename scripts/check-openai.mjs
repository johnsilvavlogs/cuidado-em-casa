import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY ausente no ambiente do servidor.");
  process.exit(1);
}
const model = process.env.OPENAI_MODEL || "gpt-6.1-sol";
const client = new OpenAI({ timeout: 60_000, maxRetries: 0 });
try {
  const response = await client.responses.parse({
    model,
    store: false,
    reasoning: { effort: "low" },
    max_output_tokens: 512,
    input: "Teste técnico sem dados pessoais. Responda com ok igual a true.",
    text: { format: zodTextFormat(z.object({ ok: z.literal(true) }), "connection_check") },
  });
  if (response.status !== "completed" || response.output_parsed?.ok !== true) {
    console.error(JSON.stringify({ status: response.status, structuredOutput: false }));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ status: "ok", model: response.model, structuredOutput: true, usage: response.usage }));
  }
} catch (error) {
  console.error(JSON.stringify({ status: "failed", httpStatus: error.status ?? null, code: error.code ?? error.name }));
  process.exitCode = 1;
}
