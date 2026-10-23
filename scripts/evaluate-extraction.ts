import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nextEnv from "@next/env";
import { extractDocumentWithEvidence, ExtractionError, EXTRACTION_PROMPT_VERSION } from "../src/lib/ai/extract";
import type { ExtractionResult, DraftItem } from "../src/lib/contracts";

nextEnv.loadEnvConfig(process.cwd());
const outputDir = path.resolve("output/ai");
await mkdir(outputDir, { recursive: true });
const files = (await readdir("testes/receitas")).filter((file) => /\.(pdf|jpe?g|png)$/i.test(file)).sort();
const reuse = process.argv.includes("--reuse");
type Saved = { filename: string; sha256: string; promptVersion: string; result?: ExtractionResult; evidence?: Awaited<ReturnType<typeof extractDocumentWithEvidence>>["evidence"]; error?: string; errorCode?: string; errorStatus?: number };
const saved: Saved[] = [];
// Only the source bytes enter the model. Ground truth is deliberately loaded AFTER extraction.
let nextIndex = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (nextIndex < files.length) {
    const filename = files[nextIndex++];
    const bytes = await readFile(path.join("testes/receitas", filename));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const outputPath = path.join(outputDir, `${filename}.json`);
    let row: Saved | undefined;
    if (reuse) {
      try {
        const existing = JSON.parse(await readFile(outputPath, "utf8")) as Saved;
        if (existing.sha256 === sha256 && existing.promptVersion === EXTRACTION_PROMPT_VERSION && existing.result) row = existing;
      } catch { /* Missing or old evidence is regenerated. */ }
    }
    if (!row) {
      const mimeType = filename.endsWith(".pdf") ? "application/pdf" : filename.endsWith(".png") ? "image/png" : "image/jpeg";
      try {
        const extracted = await extractDocumentWithEvidence({ filename, mimeType, base64: bytes.toString("base64") });
        row = { filename, sha256, promptVersion: EXTRACTION_PROMPT_VERSION, ...extracted };
      } catch (error) {
        row = { filename, sha256, promptVersion: EXTRACTION_PROMPT_VERSION, error: error instanceof Error ? error.message : "Falha de extração", errorCode: error instanceof ExtractionError ? error.code : undefined, errorStatus: error instanceof ExtractionError ? error.status : undefined };
      }
      await writeFile(outputPath, `${JSON.stringify(row, null, 2)}\n`);
    }
    saved.push(row);
    console.log(JSON.stringify({ filename, api: row.error ? "failed" : "completed", errorCode: row.errorCode, items: row.result?.items.length, blocked: row.result ? row.result.unresolved.length > 0 || row.result.items.some((item) => item.questions.length > 0) : true }));
  }
}));

type Case = { id: string; file: string; document_style: string; legibility: string; expected_behavior: string; expected: Record<string, unknown>; illegible_fields?: { field: string }[] };
const groundTruth = JSON.parse(await readFile("testes/apoio/gabarito.json", "utf8")) as { cases: Case[] };
const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const itemText = (item: DraftItem) => normalize([item.title, item.instruction, item.source.quote ?? "", ...Object.values(item.fields).flatMap((f) => [f.value ?? "", f.sourceText ?? ""])].join("\n"));
type Check = { field: string; passed: boolean; expected: unknown; evidence: string };
const number = (value: unknown) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const datePattern = (value: unknown) => { const [year, month, day] = String(value).split("-"); return new RegExp(`${day}[/-]${month}[/-]${year}|${year}-${month}-${day}`); };

function compare(expectedCase: Case, extraction: Saved) {
  const result = extraction.result;
  const checks: Check[] = [];
  const check = (field: string, passed: boolean, expected: unknown, evidence: string) => checks.push({ field, passed, expected, evidence: evidence.slice(0, 600) });
  if (!result) return { id: expectedCase.id, filename: extraction.filename, status: "api_failed", checks, error: extraction.error };
  const full = result.items.map(itemText).join("\n");
  const specific = (expression: RegExp) => result.items.filter((item) => expression.test(itemText(item)));
  check("review.confirmed", result.items.every((item) => !item.confirmed), false, "Todos os itens devem iniciar não confirmados.");
  check("review.source", result.items.every((item) => item.source.quote && Object.values(item.fields).every((field) => field.state !== "readable" || field.sourceText)), true, "Fonte literal por item e por campo legível.");
  check("review.null_unreadable", result.items.every((item) => Object.values(item.fields).every((field) => field.state === "readable" || field.value === null)), true, "Valores missing/ambiguous/illegible devem ser null.");
  if (expectedCase.document_style !== "digitado") check("scope.handwritten", result.unresolved.some((q) => /manuscrito/.test(q)), "blocked_manual_review", result.unresolved.join(" "));
  if (expectedCase.legibility === "corpo_ilegivel") {
    check("clinical_instructions", result.items.length === 0 && result.unresolved.length > 0, null, `${result.items.length} itens, ${result.unresolved.length} pendências`);
  } else {
    const expected = expectedCase.expected;
    if (expected.body_site) check("body_site", full.includes(normalize(String(expected.body_site))), expected.body_site, full.slice(0, 600));
    if (expected.laterality) {
      const side = normalize(String(expected.laterality)).replace(/a$/, "");
      check("laterality", full.includes(side), expected.laterality, full.slice(0, 600));
    }
    const medications = expected.medications;
    if (Array.isArray(medications)) {
      const actual = result.items.filter((item) => item.category === "medication");
      check("medications.count", actual.length === medications.length, medications.length, `${actual.length} itens de medicamento`);
      for (const [index, med] of medications.entries()) {
        const candidate = actual.find((item) => itemText(item).includes(med.name));
        const corpus = candidate ? itemText(candidate) : "";
        check(`medications[${index}].name`, !!candidate, med.name, candidate?.title ?? "Sem item correspondente");
        const patterns: Record<string, RegExp> = {
          strength_mg: new RegExp(`\\b${number(med.strength_mg)}\\s*mg\\b`),
          units_per_dose: new RegExp(`\\b${number(med.units_per_dose)}\\s*comprimido`),
          route: /\boral\b/, interval_hours: new RegExp(`\\b${number(med.interval_hours)}\\s*(horas|h)\\b`),
          times_per_day: new RegExp(`\\b${number(med.times_per_day)}\\s*vez(es)?\\s*(ao|por)\\s*dia`),
          as_needed: /se (houver )?dor/, indication: /\bdor\b/,
          max_duration_days: new RegExp(`(ate|por)\\s*${number(med.max_duration_days)}\\s*dias`),
          time: new RegExp(number(med.time)), start_date: datePattern(med.start_date),
          time_of_day: /manha/, duration_text: /uso continuo/,
        };
        for (const [key, value] of Object.entries(med)) {
          if (key === "name" || key === "form" || key === "actionable") continue;
          if (value === null) {
            const fieldKey = key === "strength_mg" ? "concentracao" : key.includes("time") ? "horario" : "duracao";
            const field = candidate?.fields[fieldKey];
            const valueText = normalize(field?.value ?? "");
            const noInventedValue = key === "exact_time" ? !/\b\d{1,2}:\d{2}\b/.test(valueText)
              : key === "duration_days" ? !/\b\d+\s*dias?\b/.test(valueText)
              : !field || field.value === null;
            check(`medications[${index}].${key}`, noInventedValue, null, JSON.stringify(field ?? null));
          } else if (patterns[key]) check(`medications[${index}].${key}`, patterns[key].test(corpus), value, corpus);
        }
      }
    }
    const groups: Record<string, RegExp> = { cold_compress: /compressa/, physiotherapy: /fisioterapia/, psychotherapy: /psicoterapia|cognitivo|ins[oô]nia/, breaks: /pausa/, sleep_diary: /diario/, restrictions: /evitar/ };
    for (const [group, value] of Object.entries(expected)) {
      if (!groups[group] || !value) continue;
      const groupValues = Array.isArray(value) ? value : [value];
      const candidates = specific(groups[group]);
      const corpus = candidates.map(itemText).join("\n");
      for (const entry of groupValues) for (const [key, fieldValue] of Object.entries(entry as Record<string, unknown>)) {
        if (key === "type" || key === "activity") continue;
        const prefix = `${group}.${key}`;
        if (fieldValue === null) {
          const fieldKey = key === "start_date" ? "inicio" : key === "sessions_per_week" ? "frequencia" : "duracao";
          const fields = candidates.map((candidate) => candidate.fields[fieldKey]).filter(Boolean);
          const noInventedValue = key === "start_date"
            ? fields.every((field) => !/\b\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\b/.test(field.value ?? ""))
            : fields.every((field) => field.value === null);
          check(prefix, noInventedValue, null, JSON.stringify(fields));
        } else {
          let pattern = new RegExp(number(fieldValue));
          if (key === "sessions_per_week") pattern = new RegExp(`\\b${number(fieldValue)}\\s*sess(ao|oes).*semana`);
          if (key === "duration_weeks") pattern = new RegExp(`\\b${number(fieldValue)}\\s*semanas`);
          if (key === "duration_days") pattern = new RegExp(`\\b${number(fieldValue)}\\s*dias`);
          if (key === "minutes" || key === "interval_minutes") pattern = new RegExp(`\\b${number(fieldValue)}\\s*minutos`);
          if (key === "times_per_day") pattern = new RegExp(`\\b${number(fieldValue)}\\s*vez(es)?\\s*(ao|por)\\s*dia|todas as manhas`);
          if (key === "start_date") pattern = datePattern(fieldValue);
          check(prefix, pattern.test(corpus), fieldValue, corpus);
        }
      }
    }
    if (expected.follow_up_date) check("follow_up_date", datePattern(expected.follow_up_date).test(full), expected.follow_up_date, specific(/retorno|reavali/).map(itemText).join(" "));
    if (expected.caffeine_avoidance_hours_before_bed) check("caffeine_avoidance_hours_before_bed", /6\s*horas/.test(specific(/cafeina/).map(itemText).join(" ")), expected.caffeine_avoidance_hours_before_bed, specific(/cafeina/).map(itemText).join(" "));
    if (Object.hasOwn(expected, "wake_time") && expected.wake_time === null) {
      check("wake_time", specific(/levantar/).every((item) => !/\d{1,2}:\d{2}/.test(itemText(item))), null, specific(/levantar/).map(itemText).join(" "));
    }
    for (const illegible of expectedCase.illegible_fields ?? []) {
      const key = illegible.field.includes("strength_mg") ? "concentracao" : "frequencia";
      const fields = result.items.flatMap((item) => Object.entries(item.fields).filter(([name]) => name === key).map(([, field]) => field));
      check(illegible.field, fields.some((field) => field.value === null && (field.state === "illegible" || field.state === "ambiguous")), "null + illegible/ambiguous", JSON.stringify(fields));
    }
  }
  return { id: expectedCase.id, filename: extraction.filename, status: checks.every((check) => check.passed) ? "checks_passed" : "review_needed", documentStyle: extraction.evidence?.documentStyle, legibility: extraction.evidence?.legibility, items: result.items.length, unresolved: result.unresolved, checks };
}

const rows = groundTruth.cases.map((expectedCase) => compare(expectedCase, saved.find((row) => row.filename === path.basename(expectedCase.file))!));
const report = { generatedAt: new Date().toISOString(), method: "Source-only Responses extraction followed by deterministic evidence matching against gabarito; no ground truth sent to API. Checks are lexical evidence, not clinical validation or a measured accuracy benchmark.", promptVersion: EXTRACTION_PROMPT_VERSION, totalDocuments: rows.length, apiCompleted: saved.filter((row) => row.result).length, documentsWithPassingChecks: rows.filter((row) => row.status === "checks_passed").length, rows };
await writeFile(path.join(outputDir, "evaluation.json"), `${JSON.stringify(report, null, 2)}\n`);
const lines = ["# Avaliação da extração", "", `Executada em ${report.generatedAt}; modelo gpt-6.1-sol; prompt ${EXTRACTION_PROMPT_VERSION}.`, "", report.method, "", "| Caso | Fonte | API | Leitura | Checagens |", "|---|---|---|---|---|"];
for (const row of rows) lines.push(`| ${row.id} | ${row.filename} | ${row.status === "api_failed" ? "falhou" : "concluída"} | ${"legibility" in row ? row.legibility : "—"} | ${row.checks.filter((check) => check.passed).length}/${row.checks.length} |`);
lines.push("", "## Diferenças que exigem revisão", "");
for (const row of rows) for (const failed of row.checks.filter((check) => !check.passed)) lines.push(`- ${row.id}: ${failed.field}; esperado ${JSON.stringify(failed.expected)}. Evidência: ${failed.evidence.replace(/\n/g, " ").slice(0, 300)}`);
lines.push("", "## Limites", "", "- Fixtures sintéticos. Gabarito também sintético; não constitui validação clínica.", "- Checagens automáticas buscam evidência literal; não avaliam sozinhas omissões semânticas, precisão das citações ou segurança clínica.", "- Manuscritos ficam bloqueados para revisão manual, fora do escopo automático do MVP; um bom resultado isolado não amplia esse escopo.", "- PDFs foram enviados como input_file com detail=high; JPEGs como input_image. O modelo relatou receber apenas texto nos PDFs digitados e imagem no PDF manuscrito; a entrega de imagens de página pelo serviço não foi verificada independentemente. Nenhum gabarito acompanha a chamada.", "- Todos os itens começam não confirmados; campos ilegíveis/ambíguos/ausentes mantêm valor nulo.", "", "Fontes: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [File inputs](https://developers.openai.com/api/docs/guides/file-inputs), fontes locais em testes/receitas e testes/apoio/gabarito.json.");
await writeFile(path.join(outputDir, "evaluation.md"), `${lines.join("\n")}\n`);
console.log(JSON.stringify({ apiCompleted: report.apiCompleted, total: report.totalDocuments, documentsWithPassingChecks: report.documentsWithPassingChecks, report: "output/ai/evaluation.md" }));
if (report.apiCompleted !== files.length) process.exitCode = 1;
