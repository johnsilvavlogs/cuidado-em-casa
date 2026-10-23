import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DecisionCreateParams } from "openai/resources/decisions";
import type { CareState } from "../contracts";
import { createAIClient } from "./client";
import { buildVoiceQuestions, DECISIONS_MODEL } from "./live";

export const voiceInterpretInputSchema = z.object({
  transcript: z.string().trim().min(1).max(6000),
  assistantContext: z.string().max(6000).optional().default(""),
}).strict();

/** Interpret a complete spoken turn. It proposes a decision; it never writes care records. */
export async function interpretVoice(input: z.infer<typeof voiceInterpretInputSchema>, state: CareState) {
  const parsed = voiceInterpretInputSchema.parse(input);
  const messages: DecisionCreateParams["input"] = [];
  if (parsed.assistantContext.trim()) messages.push({ role: "assistant", content: [{ type: "output_text", text: parsed.assistantContext }] });
  messages.push({ role: "user", content: [{ type: "input_text", text: parsed.transcript }] });
  const decision = await createAIClient().decisions.create({
    model: DECISIONS_MODEL,
    input: messages,
    questions: buildVoiceQuestions(state),
  });
  return {
    type: "decision.event" as const,
    event_id: randomUUID(),
    delegation_id: null,
    trigger_id: null,
    source_event_id: null,
    source_event_type: null,
    event: { type: "decision.completed" as const, decision },
  };
}
