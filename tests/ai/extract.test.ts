import assert from "node:assert/strict";
import test from "node:test";
import { buildDocumentContent, ExtractionError, normalizeExtraction, type RawExtraction } from "../../src/lib/ai/extract";

const draft = (overrides: Partial<RawExtraction> = {}): RawExtraction => ({
  documentStyle: "printed", legibility: "readable", unresolved: [], warnings: [],
  items: [{ title: "Medicamento", category: "medication", instruction: "Tomar 1 comprimido.", page: 1, quote: "Tomar 1 comprimido.", questions: [], fields: [
    { key: "dose", value: "1 comprimido", state: "readable", sourceText: "Tomar 1 comprimido." },
    { key: "concentracao", value: "50 mg", state: "illegible", sourceText: "Sertralina [ilegível] mg" },
    { key: "horario", value: "08:00", state: "missing", sourceText: "" },
  ] }], ...overrides,
});

test("an illegible/missing value never becomes a usable instruction field", () => {
  const result = normalizeExtraction(draft());
  assert.equal(result.items[0].confirmed, false);
  assert.equal(result.items[0].source.documentId, null);
  assert.equal(result.items[0].fields.dose.value, "1 comprimido");
  assert.deepEqual(result.items[0].fields.concentracao, { value: null, state: "illegible", sourceText: "Sertralina [ilegível] mg" });
  assert.deepEqual(result.items[0].fields.horario, { value: null, state: "missing", sourceText: null });
  assert.equal(result.items[0].fields.via.state, "missing");
  assert.ok(result.items[0].questions.some((question) => question.includes("concentracao")));
});

test("readable fields require a source and handwritten documents require manual review", () => {
  const raw = draft({ documentStyle: "handwritten" });
  raw.items[0].fields[0].sourceText = null;
  const result = normalizeExtraction(raw);
  assert.equal(result.items[0].fields.dose.state, "ambiguous");
  assert.equal(result.items[0].fields.dose.value, null);
  assert.ok(result.unresolved.some((question) => question.includes("manuscrito")));
});

test("illegible document cannot expose guessed care items", () => {
  const result = normalizeExtraction(draft({ legibility: "illegible" }));
  assert.equal(result.items.length, 0);
  assert.ok(result.unresolved.length > 0);
});

test("input contract rejects mixed inputs, unsupported media and malformed base64", () => {
  for (const input of [
    { filename: "x", mimeType: "text/plain", text: "x", base64: "eA==" },
    { filename: "x", mimeType: "application/zip", base64: "eA==" },
    { filename: "x", mimeType: "image/png", base64: "invalid" },
  ]) assert.throws(() => buildDocumentContent(input), ExtractionError);
  assert.equal(buildDocumentContent({ filename: "x.pdf", mimeType: "application/pdf", base64: "eA==" })[1].type, "input_file");
  assert.equal(buildDocumentContent({ filename: "x.jpg", mimeType: "image/jpeg", base64: "eA==" })[1].type, "input_image");
});

test("duplicate keys cannot silently replace a field with a different reading", () => {
  const raw = draft();
  raw.items[0].fields.push({ key: "dose", value: "2 comprimidos", state: "readable", sourceText: "2 comprimidos" });
  assert.equal(normalizeExtraction(raw).items[0].fields.dose.state, "ambiguous");
});
