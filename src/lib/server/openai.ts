import "server-only";
import OpenAI from "openai";

export const extractionModel = process.env.OPENAI_MODEL || "gpt-6.1-sol";

export function createOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY não configurada no servidor.");
  }
  return new OpenAI({ timeout: 60_000, maxRetries: 1 });
}
