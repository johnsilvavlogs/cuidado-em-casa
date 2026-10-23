"use client";

import { useRef, useState, type FormEvent } from "react";
import { PlusIcon } from "@phosphor-icons/react";
import type { CareField, CareState, DocumentRef, DraftItem } from "@/lib/contracts";
import { Busy, categoryLabels, fieldLabels, Modal, type RunAction } from "./care-ui";

const medicationFields = ["nome", "concentracao", "dose", "via", "frequencia", "duracao", "condicoes"] as const;
type MedicationField = typeof medicationFields[number];
type Props = { state: CareState; busy: boolean; run: RunAction; onClose: () => void };
type ManualCareInput = {
  id: string;
  title: string;
  instruction: string;
  category: DraftItem["category"];
  quote: string;
  page: number | null;
  document: DocumentRef | null;
  medication: Partial<Record<MedicationField, string>>;
};

export function buildManualCareItem(input: ManualCareInput): DraftItem {
  const fields: Record<string, CareField> = {};
  if (input.category === "medication") {
    for (const key of medicationFields) {
      const value = input.medication[key]?.trim() || null;
      fields[key] = { value, state: value === null ? "missing" : "readable", sourceText: value };
    }
  }
  return {
    id: input.id,
    title: input.title.trim(),
    instruction: input.instruction.trim(),
    category: input.category,
    fields,
    questions: [],
    confirmed: false,
    source: {
      documentId: input.document?.id ?? null,
      page: input.document && input.document.mimeType !== "text/plain" ? input.page : null,
      quote: input.quote.trim() || input.instruction.trim(),
    },
  };
}

export default function ManualCareDialog({ state, busy, run, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [category, setCategory] = useState<DraftItem["category"]>("other");
  const [quote, setQuote] = useState("");
  const [page, setPage] = useState("1");
  const [medication, setMedication] = useState<Partial<Record<MedicationField, string>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);
  const disabled = busy || saving;
  const pagedSource = state.document && state.document.mimeType !== "text/plain";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || sending.current) return;
    setError("");
    if (!title.trim() || !instruction.trim()) return setError("Preencha o nome e a orientação.");
    if (!quote.trim()) return setError("Copie o trecho ou diga de onde veio a orientação.");
    const sourcePage = pagedSource ? Number(page) : null;
    if (pagedSource && (!Number.isInteger(sourcePage) || sourcePage! < 1 || (state.document?.pageCount && sourcePage! > state.document.pageCount))) {
      return setError("Informe uma página válida do documento.");
    }
    sending.current = true;
    setSaving(true);
    try {
      const item = buildManualCareItem({ id: crypto.randomUUID(), title, instruction, category, quote, page: sourcePage, document: state.document, medication });
      if (await run({ type: "add_item", item }, "Cuidado adicionado. Falta conferir.")) onClose();
    } finally {
      sending.current = false;
      setSaving(false);
    }
  }

  return <Modal title="Adicionar um cuidado" subtitle="Copie a orientação como você a recebeu." onClose={onClose}>
    <form onSubmit={submit} className="stack" aria-busy={disabled}>
      <label>Categoria<select value={category} disabled={disabled} onChange={(event) => setCategory(event.target.value as DraftItem["category"])}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Nome do cuidado<input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} required disabled={disabled} /></label>
      <label>Orientação completa<textarea rows={4} value={instruction} maxLength={8000} onChange={(event) => setInstruction(event.target.value)} required disabled={disabled} /></label>
      {category === "medication" && <fieldset className="stack-sm" disabled={disabled}>
        <legend>Sobre o medicamento</legend>
        <p className="small-note">Preencha o que está na orientação. Deixe o restante em branco.</p>
        {medicationFields.map(key => <label key={key}>{key === "nome" ? "Nome do medicamento" : fieldLabels[key] ?? key} (opcional)
          {key === "condicoes"
            ? <textarea rows={2} maxLength={4000} value={medication[key] ?? ""} onChange={(event) => setMedication(current => ({ ...current, [key]: event.target.value }))} placeholder="Não consta na fonte" />
            : <input maxLength={4000} value={medication[key] ?? ""} onChange={(event) => setMedication(current => ({ ...current, [key]: event.target.value }))} placeholder="Não consta na fonte" />}
        </label>)}
        <p className="small-note">Você confere as datas e os horários na próxima etapa.</p>
      </fieldset>}
      <label>De onde veio a orientação?<textarea rows={3} value={quote} maxLength={12000} onChange={(event) => setQuote(event.target.value)} placeholder="Copie o trecho ou informe quem orientou." required disabled={disabled} /></label>
      {pagedSource && <label>Página<input type="number" min="1" max={state.document?.pageCount ?? 10000} step="1" value={page} onChange={(event) => setPage(event.target.value)} required disabled={disabled} /></label>}
      {error && <p className="error-message" role="alert">{error}</p>}
      <button type="submit" className="button primary" disabled={disabled}>{saving ? <Busy>Adicionando…</Busy> : <><PlusIcon size={20} />Adicionar ao rascunho</>}</button>
    </form>
  </Modal>;
}
