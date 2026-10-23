import OpenAI from "openai";

/** Server and verification scripts only. Never import this module in a client component. */
export function createAIClient() {
  if (typeof window !== "undefined") throw new Error("A IA só pode ser acessada pelo servidor.");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY não configurada no servidor.");
  return new OpenAI({ timeout: 120_000, maxRetries: 0 });
}

export function safeAPIError(error: unknown) {
  if (error instanceof OpenAI.APIError) {
    return { code: error.code ?? "api_error", status: error.status ?? null, requestId: error.requestID ?? null };
  }
  return { code: error instanceof Error ? error.name : "unknown_error", status: null, requestId: null };
}
