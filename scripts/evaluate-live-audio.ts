import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import nextEnv from "@next/env";
import { LiveWS } from "openai/resources/live/ws";
import { buildLiveSessionConfig, VOICE_POLICY_VERSION } from "../src/lib/ai/live";
import { createAIClient } from "../src/lib/ai/client";
import { buildVoiceContext } from "../src/lib/voice-context";
import type { CareState } from "../src/lib/contracts";

nextEnv.loadEnvConfig(process.cwd());
const execFileAsync = promisify(execFile);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const sha256 = (input: string | Buffer) => createHash("sha256").update(input).digest("hex");
const normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const contextual = process.argv.includes("--contextual");
const stateAwareness = process.argv.includes("--state-awareness");
const claimPhrase = stateAwareness ? "E agora, o que falta fazer? Preciso repetir algum remédio?" : contextual ? "Já concluí." : "Já concluí a caminhada leve.";
const questionPhrase = stateAwareness ? "O remédio das oito e o das vinte estão registrados como feitos? O que ainda falta fazer?" : "O que falta fazer?";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const directory = `output/ai/voice-real/${stamp}-${stateAwareness ? "state-awareness" : contextual ? "contextual" : "named"}`;
await mkdir(directory, { recursive: true });
const temporaryDirectory = await mkdtemp(join(tmpdir(), "cuidado-live-synthetic-"));

async function synthesize(phrase: string, basename: string) {
  const aiff = join(temporaryDirectory, `${basename}.aiff`);
  const pcm = join(temporaryDirectory, `${basename}.pcm`);
  await execFileAsync("/usr/bin/say", ["-v", "Luciana", "-r", "145", "-o", aiff, phrase]);
  await execFileAsync("/opt/homebrew/bin/ffmpeg", ["-loglevel", "error", "-i", aiff, "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", "16000", pcm]);
  const bytes = await readFile(pcm);
  return { bytes, metadata: { phrase, synthesizer: "macOS say", voice: "Luciana", locale: "pt-BR", sampleRate: 16000, channels: 1, bits: 16, durationMs: bytes.length / 32, sha256: sha256(bytes) } };
}

const state: CareState = {
  demoId: "synthetic-live-audio", role: "patient", patient: { name: "Pessoa sintética", caregiverName: "Cuidador sintético" },
  plan: { status: "active", items: [], unresolved: [], warnings: [], sourceReviewed: true },
  document: null, helpRequests: [], checkIns: [], timeline: [], updatedAt: new Date().toISOString(), revision: 1,
  tasks: [
    { id: "walk-light-0900", itemId: "care-walk", title: "Caminhada leve", instruction: "Caminhar conforme orientação já confirmada.", time: "09:00", status: "pending", priority: "normal", recordedAt: null },
  ],
};
if (stateAwareness) state.tasks.unshift(
  { id: "med-0800", itemId: "care-med-am", title: "Remédio das oito", instruction: "Conforme plano previamente confirmado.", time: "08:00", status: "done", priority: "important", recordedAt: new Date().toISOString() },
  { id: "med-2000", itemId: "care-med-pm", title: "Remédio das vinte", instruction: "Conforme plano previamente confirmado.", time: "20:00", status: "not_done", priority: "important", recordedAt: new Date().toISOString() },
);
const config = buildLiveSessionConfig(state);
if (!config.triggers?.some((trigger) => trigger.type === "decisions" && trigger.event_type === "session.input_transcript.delta")) {
  throw new Error("Preflight: buildLiveSessionConfig não contém trigger de entrada. Nenhuma sessão foi criada.");
}
const sourceBefore = sha256(await readFile("src/lib/ai/live.ts"));
const contextBefore = sha256(await readFile("src/lib/voice-context.ts"));
const [question, claim] = await Promise.all([synthesize(questionPhrase, "question"), synthesize(claimPhrase, "claim")]);

type Transcript = { eventId: string; delta: string; startMs: number; endMs: number; receivedAt: string };
type DecisionReceipt = { eventId: string; triggerId: string | null; sourceEventId: string | null; sourceEventType: string | null; sourceStartMs: number | null; sourceEndMs: number | null; action: string | null; task: string | null; answers: unknown; receivedAt: string };
const inputTranscripts: Transcript[] = [];
const outputTranscripts: Transcript[] = [];
const decisions: DecisionReceipt[] = [];
const errors: { code: string; message: string }[] = [];
const events: string[] = [];
let sessionId: string | null = null;
let started = false;
let closed = false;
let outputAudioBytes = 0;
let lastOutputTranscriptAt = 0;
let usage: unknown;
let audioTimelineMs = 0;
let audioBuffer: Buffer | null = null;
let audioOffset = 0;
let audioDone: (() => void) | null = null;
let audioTimer: ReturnType<typeof setInterval> | undefined;
let claimStartMs = Number.POSITIVE_INFINITY;
let contextUpdateAcknowledged = false;
const client = createAIClient();
const ws = new LiveWS(client);
const log = (event: string, details: Record<string, unknown> = {}) => console.log(JSON.stringify({ event, ...details }));

ws.on("event", (event) => {
  if (!events.includes(event.type)) events.push(event.type);
  if (event.type === "session.started") {
    started = true; sessionId = event.session.id;
    log("session.started", { sessionId });
  } else if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") {
    const transcript = { eventId: event.event_id, delta: event.delta, startMs: event.start_ms, endMs: event.end_ms, receivedAt: new Date().toISOString() };
    (event.type === "session.input_transcript.delta" ? inputTranscripts : outputTranscripts).push(transcript);
    if (event.type === "session.output_transcript.delta") lastOutputTranscriptAt = Date.now();
    log(event.type, { delta: event.delta, startMs: event.start_ms, endMs: event.end_ms });
  } else if (event.type === "decision.event") {
    const answers = event.event.decision.answers;
    const choice = (name: string) => {
      const answer = answers.find((candidate) => candidate.type === "choice" && candidate.name === name);
      return answer?.type === "choice" ? String(answer.choice) : null;
    };
    const source = inputTranscripts.find((segment) => segment.eventId === event.source_event_id);
    const receipt = { eventId: event.event_id, triggerId: event.trigger_id, sourceEventId: event.source_event_id, sourceEventType: event.source_event_type, sourceStartMs: source?.startMs ?? null, sourceEndMs: source?.endMs ?? null, action: choice("action"), task: choice("task"), answers, receivedAt: new Date().toISOString() };
    decisions.push(receipt);
    log("decision.event", { action: receipt.action, task: receipt.task, triggerId: receipt.triggerId, sourceEventId: receipt.sourceEventId });
  } else if (event.type === "session.output_audio.delta") {
    outputAudioBytes += Buffer.byteLength(event.delta, "base64");
  } else if (event.type === "session.closed") {
    closed = true; usage = event.usage; log("session.closed");
  } else if (event.type === "session.instructions.appended" && event.client_event_id === "state-update") {
    contextUpdateAcknowledged = true;
    log("session.instructions.appended", { clientEventId: event.client_event_id });
  }
});
ws.on("error", (error) => {
  const receipt = { code: error.error?.error?.code ?? "websocket_error", message: error.message.slice(0, 700) };
  errors.push(receipt); log("error", receipt);
});

async function waitFor(check: () => boolean, timeoutMs: number, stopOnError = true) {
  const start = Date.now();
  while (!check() && Date.now() - start < timeoutMs && (!stopOnError || !errors.length)) await sleep(100);
  return check();
}

async function play(bytes: Buffer) {
  if (audioBuffer) throw new Error("Uma fala ainda está sendo enviada.");
  audioBuffer = bytes; audioOffset = 0;
  await new Promise<void>((resolve) => { audioDone = resolve; });
}

const matchingDecision = () => decisions.find((decision) => decision.triggerId !== null
  && decision.sourceEventType === "session.input_transcript.delta"
  && decision.sourceEventId !== null
  && inputTranscripts.some((segment) => segment.eventId === decision.sourceEventId && segment.endMs >= claimStartMs)
  && decision.action === "mark_done" && decision.task === "walk-light-0900");

let questionStartMs = 0;
let questionEndMs = 0;
let claimEndMs = 0;
let questionReplyObserved = false;
let claimResultObserved = false;
let firstReply = "";
let secondReply = "";
let replyBoundary = 0;
try {
  ws.send({ type: "session.start", event_id: "audio-test-start", session: { ...config, audio: { format: { type: "audio/pcm", rate: 16000 } } } });
  if (!await waitFor(() => started, 20_000)) throw new Error("Sessão Live não iniciou dentro do prazo.");
  audioTimer = setInterval(() => {
    const bytes = Buffer.alloc(1600);
    if (audioBuffer) {
      const chunk = audioBuffer.subarray(audioOffset, audioOffset + 1600);
      chunk.copy(bytes); audioOffset += chunk.length;
      if (audioOffset >= audioBuffer.length) {
        audioBuffer = null; const resolve = audioDone; audioDone = null; resolve?.();
      }
    }
    ws.send({ type: "session.input_audio.append", audio: bytes.toString("base64") });
    audioTimelineMs += 50;
  }, 50);
  await sleep(500);
  questionStartMs = audioTimelineMs;
  log("play.question", { phrase: questionPhrase, startMs: questionStartMs });
  await play(question.bytes);
  questionEndMs = audioTimelineMs;
  const questionFinishedAt = Date.now();
  questionReplyObserved = await waitFor(() => outputTranscripts.length > 0 && Date.now() - lastOutputTranscriptAt > (stateAwareness ? 3000 : 1400) && Date.now() - questionFinishedAt > (stateAwareness ? 5000 : 1800), stateAwareness ? 25_000 : 18_000);
  firstReply = outputTranscripts.map((segment) => segment.delta).join("");
  log("question.reply", { observed: questionReplyObserved, transcript: outputTranscripts.map((segment) => segment.delta).join("") });
  if (stateAwareness) {
    const updated: CareState = { ...state, revision: 2, updatedAt: new Date().toISOString(), tasks: state.tasks.map((task) => task.id === "walk-light-0900" ? { ...task, status: "done", recordedAt: new Date().toISOString() } : task) };
    ws.send({ type: "session.instructions.append", event_id: "state-update", delegation_id: null, content: buildVoiceContext(updated) });
    if (!await waitFor(() => contextUpdateAcknowledged, 8_000)) throw new Error("Atualização de contexto não foi confirmada pelo Live.");
    replyBoundary = outputTranscripts.length;
  }
  claimStartMs = audioTimelineMs;
  log("play.claim", { phrase: claimPhrase, startMs: claimStartMs });
  await play(claim.bytes);
  claimEndMs = audioTimelineMs;
  claimResultObserved = stateAwareness
    ? await waitFor(() => outputTranscripts.length > replyBoundary && Date.now() - lastOutputTranscriptAt > 3000, 25_000)
    : await waitFor(() => !!matchingDecision(), 15_000);
  await waitFor(() => lastOutputTranscriptAt > 0 && Date.now() - lastOutputTranscriptAt > 1500, 6_000);
  secondReply = outputTranscripts.slice(replyBoundary).map((segment) => segment.delta).join("");
} catch (error) {
  errors.push({ code: "test_execution", message: error instanceof Error ? error.message : "Falha do teste" });
} finally {
  if (audioTimer) clearInterval(audioTimer);
  if (started) {
    ws.send({ type: "session.close", event_id: "audio-test-close" });
    await waitFor(() => closed, 8_000, false);
  }
  ws.close();
}

const questionHeard = normalize(inputTranscripts.filter((segment) => segment.startMs < claimStartMs).map((segment) => segment.delta).join(""));
const claimHeard = normalize(inputTranscripts.filter((segment) => segment.endMs >= claimStartMs).map((segment) => segment.delta).join(""));
const sourceAfter = sha256(await readFile("src/lib/ai/live.ts"));
const contextAfter = sha256(await readFile("src/lib/voice-context.ts"));
const ordinaryChecks = {
  sessionStarted: started,
  questionTranscribed: /falta fazer/.test(questionHeard),
  assistantNamedTarget: /caminhada leve/.test(normalize(outputTranscripts.map((segment) => segment.delta).join(""))),
  claimTranscribed: /conclui/.test(claimHeard) && (contextual || /caminhada/.test(claimHeard)),
  triggerDecisionCorrelated: !!matchingDecision(),
  questionDidNotCompleteTask: !decisions.some((decision) => (decision.sourceEndMs ?? Number.POSITIVE_INFINITY) < claimStartMs && decision.action === "mark_done"),
  sourceUnchanged: sourceBefore === sourceAfter && contextBefore === contextAfter,
  sessionClosed: closed,
  noErrors: errors.length === 0,
};
const first = normalize(firstReply);
const second = normalize(secondReply);
const noRepeatAdvice = (text: string) => !/(?<!nao )\b(repita|tome novamente|tome de novo|compense)\b/.test(text);
const checks = stateAwareness ? {
  sessionStarted: started,
  questionsTranscribed: /oito/.test(questionHeard) && /vinte/.test(questionHeard) && /repetir/.test(claimHeard),
  firstReplyReceived: questionReplyObserved,
  firstReplyReferencesEightDone: /(oito|08:00|8 horas)/.test(first) && /(feito|tomado|realizado|concluido)/.test(first),
  firstReplyReferencesTwentyNotDone: /(vinte|20:00|20 horas)/.test(first) && /(nao feito|nao foi|nao realizado|nao tomou|nao tomado)/.test(first),
  firstReplyReferencesWalkPending: /caminhada/.test(first) && /(falta|pendente)/.test(first),
  contextUpdateAcknowledged,
  secondReplyReceived: claimResultObserved,
  secondReplyHasNoPending: /(nada|nenhum|nao ha|nao falta|sem pend|tudo.*(feito|concluido))/.test(second),
  noRepeatMedicationAdvice: noRepeatAdvice(first) && noRepeatAdvice(second),
  questionsDidNotCreateDoneActions: !decisions.some((decision) => decision.action === "mark_done"),
  sourceUnchanged: sourceBefore === sourceAfter && contextBefore === contextAfter,
  sessionClosed: closed,
  noErrors: errors.length === 0,
} : ordinaryChecks;
const report = {
  generatedAt: new Date().toISOString(), kind: stateAwareness ? "state_awareness" : contextual ? "contextual_completion" : "named_completion", policyVersion: VOICE_POLICY_VERSION,
  source: { path: "src/lib/ai/live.ts", sha256Before: sourceBefore, sha256After: sourceAfter, voiceContextPath: "src/lib/voice-context.ts", contextSha256Before: contextBefore, contextSha256After: contextAfter, configSha256: sha256(JSON.stringify(config)) },
  method: `Áudio sintético pt-BR da voz macOS Luciana, PCM16 mono 16kHz, transmitido em blocos de 50ms com silêncio contínuo. Nenhum input_text, decision.item.create, decision.create ou comentário foi enviado.${stateAwareness ? " Uma revisão sintética de estado foi enviada por session.instructions.append e aguardou confirmação antes da segunda pergunta." : ""}`,
  speechInputs: [question.metadata, claim.metadata], audioTimeline: { questionStartMs, questionEndMs, claimStartMs, claimEndMs, sentDurationMs: audioTimelineMs },
  sessionId, model: config.model, transport: "websocket", questionReplyObserved, claimResultObserved,
  inputTranscripts, outputTranscripts, decisions, outputAudioBytes, usage, events, errors,
  stateAwareness: stateAwareness ? { initialTasks: state.tasks, initialRevision: 1, updatedRevision: 2, firstReply, secondReply, note: "Checagens de conteúdo são heurísticas; a transcrição completa requer conferência do agente." } : null,
  checks, passed: Object.values(checks).every(Boolean), actionsExecuted: false, manuallyCreatedDecisions: 0, textItemsSent: 0,
  limitations: ["Não executa a UI nem confirma visualmente cartão de sugestão.", "Áudio sintético não prova microfone, sotaques naturais, reprodução física ou WebRTC.", "Confirma a origem de trigger correlacionando source_event_id com a transcrição recebida; não usa avaliação textual artificial."],
  sources: ["https://developers.openai.com/api/docs/guides/voice-websockets", "https://developers.openai.com/api/docs/guides/decisions-voice#react-to-transcripts"],
};
await writeFile(`${directory}/session.json`, `${JSON.stringify(report, null, 2)}\n`);
const markdown = ["# Validação de voz por áudio real", "", `${report.passed ? "Passou" : "Falhou"} — ${report.kind}; ${report.generatedAt}.`, "", report.method, "", `Modelo: ${report.model}; sessão: ${sessionId}; política: ${VOICE_POLICY_VERSION}.`, "", "## Checagens", "", ...Object.entries(checks).map(([name, passed]) => `- ${passed ? "PASS" : "FAIL"}: ${name}`), "", "## Fala recebida", "", inputTranscripts.map((segment) => segment.delta).join(""), "", "## Resposta de voz", "", outputTranscripts.map((segment) => segment.delta).join(""), "", "## Decisões", "", ...decisions.map((decision) => `- ${decision.action}/${decision.task}; trigger=${decision.triggerId}; fonte=${decision.sourceEventId}.`), "", "## Limites", "", ...report.limitations.map((limitation) => `- ${limitation}`), "", "Fontes: [WebSocket](https://developers.openai.com/api/docs/guides/voice-websockets) e [triggers de transcrição](https://developers.openai.com/api/docs/guides/decisions-voice#react-to-transcripts).", ""];
await writeFile(`${directory}/session.md`, markdown.join("\n"));
console.log(JSON.stringify({ passed: report.passed, checks, directory }));
if (!report.passed) process.exitCode = 1;
