import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import nextEnv from "@next/env";
import { createAIClient, safeAPIError } from "../src/lib/ai/client";
import { buildVoiceQuestions, DECISIONS_MODEL, VOICE_POLICY_VERSION, type VoiceAction } from "../src/lib/ai/live";
import type { CareState } from "../src/lib/contracts";
import type { Decision } from "openai/resources/decisions";

nextEnv.loadEnvConfig(process.cwd());
const directory = "output/ai/voice-decisions";
await mkdir(directory, { recursive: true });
const state: CareState = {
  demoId: "voice-decisions-synthetic", role: "patient",
  patient: { name: "Pessoa sintética", caregiverName: "Cuidador sintético" },
  plan: { status: "active", items: [], unresolved: [], warnings: [], sourceReviewed: true },
  document: null, helpRequests: [], checkIns: [], timeline: [], revision: 1, updatedAt: new Date().toISOString(),
  tasks: [
    { id: "sertralina-0800", itemId: "med-a", title: "Sertralina", instruction: "Conforme orientação previamente confirmada.", time: "08:00", status: "pending", priority: "important", recordedAt: null },
    { id: "paracetamol-2000", itemId: "med-b", title: "Paracetamol", instruction: "Conforme orientação previamente confirmada.", time: "20:00", status: "pending", priority: "important", recordedAt: null },
    { id: "almoco-1200", itemId: "meal", title: "Almoço", instruction: "Conforme rotina previamente confirmada.", time: "12:00", status: "pending", priority: "normal", recordedAt: null },
  ],
};
type VoiceCase = { id: string; phrase: string; expected: { action: VoiceAction; task: string } };
const cases: VoiceCase[] = [
  { id: "medication_done", phrase: "Já tomei a sertralina das oito horas.", expected: { action: "mark_done", task: "sertralina-0800" } },
  { id: "medication_not_done", phrase: "Não tomei o paracetamol das vinte horas.", expected: { action: "mark_not_done", task: "paracetamol-2000" } },
  { id: "sleep_low", phrase: "Esta noite eu dormi pouco.", expected: { action: "sleep_low", task: "none" } },
  { id: "sleep_okay", phrase: "Dormi bem esta noite.", expected: { action: "sleep_okay", task: "none" } },
  { id: "sleep_high", phrase: "Hoje eu dormi demais.", expected: { action: "sleep_high", task: "none" } },
  { id: "food_yes_general", phrase: "Hoje me alimentei, já almocei.", expected: { action: "food_yes", task: "none" } },
  { id: "food_partial", phrase: "Hoje só consegui me alimentar em parte, comi só um pouco.", expected: { action: "food_partial", task: "none" } },
  { id: "food_no", phrase: "Hoje eu não me alimentei, não comi nada.", expected: { action: "food_no", task: "none" } },
  { id: "food_routine_done", phrase: "Concluí a tarefa de Almoço das doze horas da minha rotina.", expected: { action: "mark_done", task: "almoco-1200" } },
  { id: "dose_question", phrase: "Qual dose de sertralina eu devo tomar?", expected: { action: "none", task: "none" } },
  { id: "hypothesis", phrase: "Se eu tivesse tomado a sertralina, teria concluído essa tarefa?", expected: { action: "none", task: "none" } },
  { id: "future_intention", phrase: "Vou tomar a sertralina das oito daqui a pouco.", expected: { action: "none", task: "none" } },
  { id: "two_medications_ambiguous", phrase: "Já tomei o remédio, mas não lembro qual dos dois.", expected: { action: "none", task: "none" } },
];
type Row = VoiceCase & { fingerprint: string; durationMs: number; model?: string; requestId?: string | null; answers?: Decision["answers"]; usage?: Decision["usage"]; actual?: { action: string; task: string }; passed: boolean; error?: ReturnType<typeof safeAPIError> };
const questions = buildVoiceQuestions(state);
const client = createAIClient();
const rows: Row[] = [];
const reuse = process.argv.includes("--reuse");
const requestedIds = process.argv.find((arg) => arg.startsWith("--cases="))?.split("=")[1].split(",");
const selected = requestedIds ? cases.filter((testCase) => requestedIds.includes(testCase.id)) : cases;
if (selected.length === 0) throw new Error("Nenhum caso de avaliação selecionado.");
let nextIndex = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (nextIndex < selected.length) {
    const testCase = selected[nextIndex++];
    const fingerprint = createHash("sha256").update(JSON.stringify({ model: DECISIONS_MODEL, questions, input: testCase.phrase })).digest("hex");
    const outputPath = `${directory}/${testCase.id}.json`;
    let row: Row | undefined;
    if (reuse) {
      try {
        const previous = JSON.parse(await readFile(outputPath, "utf8")) as Row;
        if (previous.fingerprint === fingerprint && previous.answers) row = previous;
      } catch { /* No matching prior evidence. */ }
    }
    if (!row) {
      const start = Date.now();
      try {
        // Expected outputs stay local; the API receives only the synthetic phrase and application questions.
        const decision = await client.decisions.create({ model: DECISIONS_MODEL, input: testCase.phrase, questions });
        const answer = (name: string) => decision.answers.find((entry) => entry.type === "choice" && entry.name === name);
        const action = answer("action"); const task = answer("task");
        const actual = { action: action?.type === "choice" ? String(action.choice) : "missing", task: task?.type === "choice" ? String(task.choice) : "missing" };
        row = { ...testCase, fingerprint, durationMs: Date.now() - start, model: decision.model, requestId: decision._request_id, answers: decision.answers, usage: decision.usage, actual, passed: actual.action === testCase.expected.action && actual.task === testCase.expected.task };
      } catch (error) {
        row = { ...testCase, fingerprint, durationMs: Date.now() - start, passed: false, error: safeAPIError(error) };
      }
      await writeFile(outputPath, `${JSON.stringify(row, null, 2)}\n`);
    }
    rows.push(row);
    console.log(JSON.stringify({ id: row.id, passed: row.passed, expected: row.expected, actual: row.actual, error: row.error }));
  }
}));
rows.sort((a, b) => cases.findIndex((testCase) => testCase.id === a.id) - cases.findIndex((testCase) => testCase.id === b.id));
const report = {
  generatedAt: new Date().toISOString(), policyVersion: VOICE_POLICY_VERSION, model: DECISIONS_MODEL,
  method: "API Decisions real com frases sintéticas em pt-BR. Cada resposta é comparada por igualdade de action e task. Nenhuma ação foi executada e nenhum valor esperado foi enviado à API.",
  selectedCases: rows.length, completed: rows.filter((row) => row.answers).length, passed: rows.filter((row) => row.passed).length,
  routine: state.tasks.map(({ id, title, time }) => ({ id, title, time })), rows,
  limitations: ["Conjunto pequeno e dirigido; não é estimativa de acurácia em produção.", "A transcrição de microfone e a integração nativa Live/WebRTC não são exercitadas neste teste de texto.", "O aplicativo deve exigir confirmação visual e validar permissões e IDs antes de toda gravação.", "Sono e alimentação são autorrelatos; o modelo não estima horas, nutrientes ou gravidade clínica."],
  sources: ["https://developers.openai.com/api/docs/guides/decisions", "https://developers.openai.com/api/docs/guides/decisions-voice"],
};
await writeFile(`${directory}/evaluation.json`, `${JSON.stringify(report, null, 2)}\n`);
const markdown = ["# Decisões de voz — registros da rotina e bem-estar", "", `${report.passed}/${report.selectedCases} casos passaram; ${report.completed}/${report.selectedCases} chamadas concluídas. Modelo ${report.model}; política ${report.policyVersion}; ${report.generatedAt}.`, "", report.method, "", "| Caso | Frase | Esperado | Observado | Resultado |", "|---|---|---|---|---|"];
for (const row of rows) markdown.push(`| ${row.id} | ${row.phrase} | ${row.expected.action} / ${row.expected.task} | ${row.actual ? `${row.actual.action} / ${row.actual.task}` : row.error?.code} | ${row.passed ? "Passou" : "Falhou"} |`);
markdown.push("", "## Limites", "", ...report.limitations.map((line) => `- ${line}`), "", "Fontes: [Decisions](https://developers.openai.com/api/docs/guides/decisions) e [integração nativa com GPT-Live](https://developers.openai.com/api/docs/guides/decisions-voice).", "");
await writeFile(`${directory}/evaluation.md`, markdown.join("\n"));
if (report.passed !== report.selectedCases) process.exitCode = 1;
