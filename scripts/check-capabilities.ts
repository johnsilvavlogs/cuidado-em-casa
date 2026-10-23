import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { LiveWS } from "openai/resources/live/ws";
import nextEnv from "@next/env";
import { createAIClient, safeAPIError } from "../src/lib/ai/client";
import { EXTRACTION_MODEL } from "../src/lib/ai/extract";
import { buildLiveSessionConfig, buildVoiceQuestions, DECISIONS_MODEL, LIVE_MODEL } from "../src/lib/ai/live";
import type { CareState } from "../src/lib/contracts";

nextEnv.loadEnvConfig(process.cwd());
const client = createAIClient();
const state: CareState = {
  demoId: "capability-check", role: "patient", patient: { name: "Pessoa sintética", caregiverName: "Cuidador sintético" },
  plan: { status: "active", items: [], unresolved: [], warnings: [], sourceReviewed: true }, document: null, helpRequests: [], checkIns: [], timeline: [], revision: 1, updatedAt: new Date().toISOString(),
  tasks: [{ id: "task-walk", itemId: "care-walk", title: "Caminhada", instruction: "Caminhar conforme orientação já confirmada.", time: "09:00", status: "pending", priority: "normal", recordedAt: null }],
};
const liveOnly = process.argv.includes("--live-only");
const results: Record<string, unknown> = liveOnly ? JSON.parse(await readFile("output/ai/capabilities.json", "utf8")) : { generatedAt: new Date().toISOString(), input: "Dados sintéticos; nenhuma alteração na aplicação.", sdk: "openai 7.43.0" };
if (!liveOnly) {

try {
  const response = await client.responses.parse({
    model: EXTRACTION_MODEL, store: false, reasoning: { effort: "low" }, max_output_tokens: 500,
    input: "Teste técnico sintético: devolva ok=true.", text: { format: zodTextFormat(z.object({ ok: z.literal(true) }), "capability") },
  });
  results.responses = { supported: response.status === "completed" && response.output_parsed?.ok === true, model: response.model, id: response.id, status: response.status, usage: response.usage };
} catch (error) { results.responses = { supported: false, ...safeAPIError(error) }; }

try {
  const response = await client.decisions.create({ model: DECISIONS_MODEL, input: "Acabei de fazer a caminhada das nove horas.", questions: buildVoiceQuestions(state) });
  results.decisions = { supported: true, model: response.model, requestId: response._request_id, answers: response.answers, usage: response.usage, actionsExecuted: false };
} catch (error) { results.decisions = { supported: false, ...safeAPIError(error) }; }
}

results.live = await new Promise<Record<string, unknown>>((resolve) => {
  const ws = new LiveWS(client);
  const result: Record<string, unknown> = { supported: false, model: LIVE_MODEL, transport: "websocket", started: false, nativeDecisionReceived: false, audioBytesReceived: 0, outputTranscript: "", sessionClosed: false, actionsExecuted: false };
  const eventTypes = new Set<string>();
  let finished = false;
  let closing = false;
  let audioTimer: ReturnType<typeof setInterval> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let settledTimer: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout); clearTimeout(closeTimer); clearTimeout(settledTimer); clearInterval(audioTimer);
    ws.close();
    result.eventTypes = [...eventTypes];
    resolve(result);
  };
  const closeGracefully = () => {
    if (closing) return;
    closing = true;
    clearInterval(audioTimer);
    ws.send({ type: "session.close", event_id: "cap-close" });
    closeTimer = setTimeout(() => { result.closeTimedOut = true; finish(); }, 8_000);
  };
  const closeAfterSpeech = () => {
    if (!settledTimer) settledTimer = setTimeout(closeGracefully, 3_000);
  };
  const timeout = setTimeout(() => {
    result.timedOut = true;
    if (result.started) closeGracefully(); else finish();
  }, 25_000);
  ws.on("event", (event) => {
    eventTypes.add(event.type);
    if (event.type === "session.started") {
      result.started = true; result.supported = true; result.sessionId = event.session.id;
      const silence = Buffer.alloc(1600).toString("base64");
      audioTimer = setInterval(() => ws.send({ type: "session.input_audio.append", audio: silence }), 50);
      ws.send({ type: "decision.item.create", event_id: "cap-input", item: { role: "user", content: "Acabei de fazer a caminhada das nove horas." } });
      ws.send({ type: "session.commentary.append", event_id: "cap-greeting", delegation_id: null, content: "Teste técnico: diga apenas Conexão de voz funcionando, sem executar ações. Depois aguarde em silêncio." });
    } else if (event.type === "decision.item.created") {
      ws.send({ type: "decision.create", event_id: "cap-decision" });
    } else if (event.type === "decision.event") {
      result.nativeDecisionReceived = true; result.nativeDecision = event.event.decision;
      if (Number(result.audioBytesReceived) > 0 && String(result.outputTranscript).includes("funcionando")) closeAfterSpeech();
    } else if (event.type === "session.output_audio.delta") {
      result.audioBytesReceived = Number(result.audioBytesReceived) + Buffer.byteLength(event.delta, "base64");
      if (result.nativeDecisionReceived && String(result.outputTranscript).includes("funcionando")) closeAfterSpeech();
    } else if (event.type === "session.output_transcript.delta") {
      result.outputTranscript = String(result.outputTranscript) + event.delta;
      if (result.nativeDecisionReceived && Number(result.audioBytesReceived) > 0 && String(result.outputTranscript).includes("funcionando")) closeAfterSpeech();
    } else if (event.type === "session.closed") {
      result.sessionClosed = true; result.usage = event.usage; finish();
    }
  });
  ws.on("error", (error) => {
    result.error = { code: error.error?.error?.code ?? "websocket_error", message: error.message.slice(0, 500) };
    if (result.started) closeGracefully(); else finish();
  });
  ws.on("close", () => { if (!finished) finish(); });
  ws.send({ type: "session.start", event_id: "cap-start", session: { ...buildLiveSessionConfig(state), audio: { format: { type: "audio/pcm", rate: 16000 } } } });
});

results.limitations = [
  "Responses: resposta estruturada real; acurácia de extração avaliada separadamente.",
  "Decisions: classificação real de uma frase sintética; nenhuma ação executada.",
  "Live: sessão WebSocket, decisão nativa e bytes/transcrição de saída quando disponíveis. Não prova o microfone, reprodução física, WebRTC ou latência no navegador.",
  "Conferir resultados por etapa: acesso a um modelo não implica suporte validado a toda a integração.",
];
results.sources = ["https://developers.openai.com/api/docs/guides/structured-outputs", "https://developers.openai.com/api/docs/guides/decisions", "https://developers.openai.com/api/docs/guides/decisions-voice", "https://developers.openai.com/api/docs/guides/voice-websockets", "https://developers.openai.com/api/docs/guides/voice-webrtc"];
await mkdir("output/ai", { recursive: true });
await writeFile("output/ai/capabilities.json", `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
