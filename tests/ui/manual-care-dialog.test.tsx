import assert from "node:assert/strict";
import { test } from "node:test";
import { buildManualCareItem } from "../../src/components/manual-care-dialog";
import { parseAction } from "../../src/lib/server/care-domain";
import type { DocumentRef } from "../../src/lib/contracts";

const document: DocumentRef = { id: "original", name: "orientacao.pdf", mimeType: "application/pdf", url: "/api/documents/original", pageCount: 3 };
const input = { id: "manual-item", title: " Medicamento informado ", instruction: "Fonte diz 500 mg, via oral, por 7 dias às 08:00.", category: "medication" as const, quote: " Trecho original preservado. ", page: 2, document, medication: {} };

test("manual medication records all structured fields without guessing from the instruction", () => {
  const item = buildManualCareItem(input);
  assert.deepEqual(Object.keys(item.fields), ["nome", "concentracao", "dose", "via", "frequencia", "duracao", "condicoes"]);
  for (const field of Object.values(item.fields)) assert.deepEqual(field, { value: null, state: "missing", sourceText: null });
  assert.equal(item.title, "Medicamento informado");
  assert.equal(item.confirmed, false);
  assert.equal(item.schedule, undefined);
  assert.deepEqual(item.source, { documentId: "original", page: 2, quote: "Trecho original preservado." });
  assert.doesNotThrow(() => parseAction({ type: "add_item", item, requestId: "manual-test-request" }));
});

test("only explicit manual field values become readable; optional absence stays distinct", () => {
  const item = buildManualCareItem({ ...input, medication: { nome: " Nome transcrito ", dose: " 1 comprimido ", via: "   ", duracao: "7 dias" } });
  assert.deepEqual(item.fields.nome, { value: "Nome transcrito", state: "readable", sourceText: "Nome transcrito" });
  assert.deepEqual(item.fields.dose, { value: "1 comprimido", state: "readable", sourceText: "1 comprimido" });
  assert.deepEqual(item.fields.via, { value: null, state: "missing", sourceText: null });
  assert.equal(item.fields.frequencia.value, null);
  assert.equal(item.schedule, undefined);
  assert.equal(item.confirmed, false);
});

test("switching to another category does not attach hidden medication values; text has no page", () => {
  const item = buildManualCareItem({ ...input, category: "activity", medication: { dose: "valor anterior" }, document: { ...document, mimeType: "text/plain" } });
  assert.deepEqual(item.fields, {});
  assert.equal(item.source.page, null);
  assert.equal(item.source.documentId, document.id);
  assert.equal(item.source.quote, "Trecho original preservado.");
  assert.equal(buildManualCareItem({ ...input, document: null }).source.page, null);
});
