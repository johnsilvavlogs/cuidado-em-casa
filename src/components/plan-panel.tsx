"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRightIcon, CaretDownIcon, CheckCircleIcon, CheckIcon, CircleIcon, FileArrowUpIcon, FileTextIcon, PencilSimpleIcon, PlusIcon, ShieldCheckIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { CareState, DraftItem, CareField, SchedulePeriod, ScheduleRecurrence } from "@/lib/contracts";
import { batchConfirmationBlocker, itemConfirmationBlockers } from "@/lib/contracts";
import { hasExecutableTimes, isReferenceCare, proposeTimes, timeBlocker } from "@/lib/schedule-times";
import { periodLabel, validPeriod, hasReviewedSchedule, recurrenceLabel, weekdayLabels } from "@/lib/schedule-period";
import { endDateForDuration, suggestMedicationPeriod } from "@/lib/schedule-suggestion";
import DocumentViewer from "./document-viewer";
import ManualCareDialog from "./manual-care-dialog";
import { Busy, careText, categoryLabels, EmptyState, fieldLabels, Modal, readingLabels, type RunAction } from "./care-ui";

type Props = { state: CareState; run: RunAction; busy: boolean; onImport: (data: FormData) => Promise<boolean> };

export default function PlanPanel({ state, run, busy, onImport }: Props) {
  const [review, setReview] = useState<DraftItem | null>(null);
  const [original, setOriginal] = useState(false);
  const [adding, setAdding] = useState(false);
  const [uncertainty, setUncertainty] = useState<number | null>(null);
  const [inputMode, setInputMode] = useState<"file" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [importing, setImporting] = useState(false);
  const [confirmingSource, setConfirmingSource] = useState(false);
  const sourceInFlight = useRef(false);
  const currentState = useRef(state);
  useEffect(() => { currentState.current = state; }, [state]);
  const isCaregiver = state.role === "caregiver";
  const isActive = state.plan.status === "active";
  const readyForPlan = (item: DraftItem) => item.confirmed && itemConfirmationBlockers(item, state.document).length === 0;
  const confirmed = state.plan.items.filter(readyForPlan).length;
  const unresolvedCount = state.plan.unresolved.length + state.plan.items.reduce((n, item) => n + item.questions.length + Object.values(item.fields).filter((f) => f.state === "ambiguous" || f.state === "illegible").length, 0);
  const periodsPending = state.plan.items.filter((item) => !hasReviewedSchedule(item) || (!isReferenceCare(item) && !hasExecutableTimes(item)));
  const canActivate = state.plan.items.length > 0 && confirmed === state.plan.items.length && unresolvedCount === 0 && periodsPending.length === 0 && state.plan.sourceReviewed;
  const visibleWarnings = state.plan.warnings.map((warning) => confirmed === 0 ? warning : warning.replace(/(?:[;:]\s*)?\bnenhum (?:item|campo)(?:\s*(?:\/|ou|e)\s*(?:item|campo))?\s+(?:(?:est[aá]|foi)\s+)?confirmad[oa]s?\.?/gi, "").trim()).filter(Boolean);
  const isReadingNote = (warning: string) => /^(?:rascunho para revisão humana|transcrição baseada no texto extraído|transcrição em rascunho:)/i.test(warning) && !/(?:ilegível|ambígu|manuscrit|dúvida)/i.test(warning);
  const needsNoAction = (warning: string) => isReadingNote(warning) || /não foi atribuíd[oa].*inferência|não foi inferid[oa]/i.test(warning);
  const readingNotes = visibleWarnings.filter(needsNoAction);
  const actionWarnings = visibleWarnings.filter(warning => !needsNoAction(warning));
  const batchItems = state.plan.items.filter(item => !item.confirmed && !batchConfirmationBlocker(item, state.document));
  const unconfirmedCount = state.plan.items.length - confirmed;
  const individualReviewCount = unconfirmedCount - batchItems.length;
  const nextReviewItem = state.plan.items.find(item => !readyForPlan(item));
  const activationNote = !state.plan.sourceReviewed
    ? "Confira o documento e marque “Conferi todas as páginas”."
    : state.plan.unresolved.length > 0
      ? "Esclareça as dúvidas abaixo para continuar."
      : individualReviewCount > 0
        ? `${individualReviewCount} ${individualReviewCount === 1 ? "cuidado precisa" : "cuidados precisam"} de revisão individual.`
        : periodsPending.length > 0
          ? "Confira os dias e o período dos cuidados antes de ativar."
          : unconfirmedCount > 0
            ? "Confirme os cuidados que já conferiu."
            : "Após ativar, este plano não poderá ser editado.";

  async function confirmSource() {
    if (busy || sourceInFlight.current) return;
    sourceInFlight.current = true;
    setConfirmingSource(true);
    try {
      await confirmReviewedSource({ getState: () => currentState.current, run });
    } finally {
      sourceInFlight.current = false;
      setConfirmingSource(false);
    }
  }

  async function importDocument(event: FormEvent) {
    event.preventDefault();
    setUploadError("");
    const data = new FormData();
    if (inputMode === "file") {
      if (!file) return setUploadError("Escolha um PDF ou uma foto legível.");
      if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) return setUploadError("Use um PDF ou uma imagem JPEG/PNG.");
      if (file.size > 10 * 1024 * 1024) return setUploadError("O arquivo deve ter até 10 MB.");
      data.append("file", file);
    } else {
      if (!pasted.trim()) return setUploadError("Cole as orientações antes de continuar.");
      data.append("text", pasted);
    }
    setImporting(true);
    try { if (await onImport(data)) { setPasted(""); setFile(null); } } finally { setImporting(false); }
  }

  const importControls = <>
    <form onSubmit={importDocument} className="stack-sm">
        <div className="segmented" aria-label="Tipo de entrada"><button type="button" className={inputMode === "file" ? "selected" : ""} onClick={() => setInputMode("file")} aria-pressed={inputMode === "file"}>PDF ou foto</button><button type="button" className={inputMode === "text" ? "selected" : ""} onClick={() => setInputMode("text")} aria-pressed={inputMode === "text"}>Colar texto</button></div>
        {inputMode === "file" ? <label className="upload-zone"><FileArrowUpIcon size={32} /><strong>{file?.name ?? "Escolher PDF ou foto"}</strong><span>Documento impresso e legível · até 10 MB</span><input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={importing} /></label> : <label>Orientações recebidas<textarea value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder="Cole a orientação recebida" rows={6} disabled={importing} /></label>}
        {uploadError && <p className="error-message" role="alert">{uploadError}</p>}
        <button className="button primary" disabled={importing || busy}>{importing ? <Busy>Lendo documento…</Busy> : <><FileTextIcon size={20} />Ler documento</>}</button>
      </form>
      {importing && <p className="small-note" role="status">Isso pode levar alguns instantes. Depois, você confere os cuidados.</p>}
      <button className="text-button" onClick={() => setAdding(true)} disabled={busy || importing}><PlusIcon size={18} />Adicionar cuidado à mão</button>
  </>;

  const renderCareItems = (items: DraftItem[]) => <div className="plan-care-items">
    {items.map((item) => <button className={`card plan-item ${readyForPlan(item) ? "confirmed" : ""}`} key={item.id} onClick={() => setReview(item)}><div className="plan-item-top"><span className="eyebrow">{categoryLabels[item.category]}</span><span className={`badge ${readyForPlan(item) ? "badge-green" : "badge-amber"}`}>{readyForPlan(item) ? <CheckCircleIcon size={15} /> : <CircleIcon size={15} />}{readyForPlan(item) ? "Conferido" : "A conferir"}</span></div><h3>{careText(item.title)}</h3><p>{careText(item.instruction)}</p>{item.schedule?.period && validPeriod(item.schedule.period) && <p className="small-note">Período: {periodLabel(item.schedule.period)}</p>}{item.category === "medication" && !validPeriod(item.schedule?.period) && <p className="warning-text">Confira as datas</p>}{item.schedule?.recurrence && <p className="small-note">Agenda: {recurrenceLabel(item.schedule.recurrence)}</p>}{item.category !== "medication" && !hasReviewedSchedule(item) && <p className="warning-text">Escolha os dias</p>}{!isReferenceCare(item) && item.schedule?.times.length ? <p className="small-note">Horários: {item.schedule.times.join(", ")}{item.schedule.timeOrigin === "suggested" ? " · sugestão de rotina" : ""}</p> : !isReferenceCare(item) && <p className="warning-text">Confira os horários</p>}{item.questions.length > 0 && <p className="warning-text"><WarningCircleIcon size={17} />{item.questions.length} {item.questions.length === 1 ? "dúvida" : "dúvidas"} para esclarecer</p>}<span className="item-action">{isActive ? "Ver orientação" : "Conferir cuidado"}<ArrowRightIcon size={18} /></span></button>)}
  </div>;
  const careItems = renderCareItems(state.plan.items);
  const pendingItems = state.plan.items.filter(item => !readyForPlan(item));
  const confirmedItems = state.plan.items.filter(readyForPlan);
  const hasDraft = !!state.document || state.plan.items.length > 0;

  return <div className={`stack plan-flow ${!isActive && isCaregiver ? "plan-preparation" : ""}`} data-parity-screen="plan">
    <div className="section-heading"><div><h2>{isActive ? "Plano de cuidado" : "Preparar plano"}</h2></div><span className={`badge ${isActive ? "badge-green" : "badge-amber"}`}>{isActive ? "Plano ativo" : "Rascunho"}</span></div>
    {!isActive && !isCaregiver && <div className="notice"><ShieldCheckIcon size={25} /><div><strong>Seu cuidador está preparando o plano</strong><p>As orientações vão aparecer aqui quando estiverem prontas.</p></div></div>}
    {!isActive && isCaregiver && !hasDraft && <section className="card import-card" data-plan-source="initial"><div className="card-heading"><span className="icon-disc"><FileArrowUpIcon size={26} /></span><div><h3>Enviar orientações</h3><p className="muted">Envie um PDF, uma foto legível ou cole o texto.</p></div></div>{importControls}</section>}
    {state.document && <button className="plan-original-link" onClick={() => setOriginal(true)}><FileTextIcon size={22} aria-hidden="true" /><span><strong>Ver documento original</strong><small>{state.document.name}{state.document.pageCount ? ` · ${state.document.pageCount} ${state.document.pageCount === 1 ? "página" : "páginas"}` : ""}</small></span><ArrowRightIcon size={20} aria-hidden="true" /></button>}
    {!isActive && isCaregiver && state.plan.items.length > 0 && <div className="plan-found" data-plan-summary="found"><h3>Encontramos {state.plan.items.length} {state.plan.items.length === 1 ? "cuidado" : "cuidados"}</h3><p className="muted">Confira antes de começar.</p></div>}
    {isActive && periodsPending.length > 0 && <div className="notice" role="status"><WarningCircleIcon size={23} /><div><strong>Falta conferir a rotina</strong><p>{isCaregiver ? <>Confira os dias e horários de {periodsPending.map((item) => careText(item.title)).join(", ")}. As tarefas ficam pausadas até lá.</> : "Peça ao seu cuidador para conferir os dias e horários. Essas tarefas ficam pausadas até lá."}</p></div></div>}
    {actionWarnings.length > 0 && <div className="notice"><WarningCircleIcon size={23} /><div><strong>Atenção ao revisar</strong>{actionWarnings.map((warning, i) => <p key={i}>{warning}</p>)}</div></div>}
    {state.plan.items.length > 0 && (!isActive && isCaregiver
      ? <details className="plan-review-disclosure" data-plan-review="individual"><summary><span><strong>Conferir um a um</strong><small>{confirmed} de {state.plan.items.length} conferidos</small></span><CaretDownIcon size={22} aria-hidden="true" /></summary><div className="plan-review-content">{pendingItems.length ? renderCareItems(pendingItems) : <p className="small-note">Todos os cuidados estão conferidos.</p>}{confirmedItems.length > 0 && <details className="plan-secondary-disclosure"><summary><strong>Cuidados conferidos ({confirmedItems.length})</strong><CaretDownIcon size={18} aria-hidden="true" /></summary>{renderCareItems(confirmedItems)}</details>}<button className="text-button" onClick={() => setAdding(true)} disabled={busy}><PlusIcon size={18} />Adicionar cuidado que faltou</button></div></details>
      : <section className="stack-sm"><h3>{state.plan.items.length} cuidados no plano</h3>{careItems}</section>)}
    {state.plan.unresolved.length > 0 && <section className="plan-issues stack-sm"><h3><WarningCircleIcon size={22} />Dúvidas a esclarecer</h3><p className="muted">Confira no documento ou pergunte ao profissional responsável.</p>{state.plan.unresolved.map((question, i) => <div className="uncertainty-row" key={`${i}-${question}`}><span>{question}</span>{isCaregiver && !isActive && <button className="button secondary compact" onClick={() => setUncertainty(i)} disabled={busy}>Esclarecer</button>}</div>)}</section>}
    {!isActive && isCaregiver && state.plan.items.length > 0 && <section className="plan-confirmation stack-sm" data-plan-review="quick" aria-label="Conferência e ativação do plano">
      <div><h3>Confirmar os cuidados</h3><p className="muted">Conferiu o documento? Confirme os cuidados de uma vez.</p></div>
      <button className={`plan-source-check ${state.plan.sourceReviewed ? "checked" : ""}`} aria-pressed={state.plan.sourceReviewed} onClick={() => void confirmSource()} disabled={busy || confirmingSource || state.plan.sourceReviewed}>{state.plan.sourceReviewed ? <CheckCircleIcon size={24} aria-hidden="true" /> : <CircleIcon size={24} aria-hidden="true" />}<span>{confirmingSource ? <Busy>Confirmando cuidados…</Busy> : "Conferi todas as páginas e incluí o que faltava."}</span></button>
      {state.plan.sourceReviewed && <div className="stack-sm" data-plan-source-result="true"><p className="small-note" role="status">{confirmed} de {state.plan.items.length} cuidados confirmados.{canActivate ? " Pronto para ativar." : unconfirmedCount > 0 ? ` Falta conferir ${unconfirmedCount} ${unconfirmedCount === 1 ? "cuidado" : "cuidados"}.` : " Esclareça as dúvidas antes de ativar."}</p>{state.plan.unresolved.length > 0 && <p className="warning-text">Esclareça as dúvidas acima para confirmar os demais cuidados.</p>}{pendingItems.filter(item => batchConfirmationBlocker(item, state.document)).map(item => <div className="uncertainty-row" key={item.id}><span><strong>{careText(item.title)}</strong><br /><small>{itemConfirmationBlockers(item, state.document)[0] ?? batchConfirmationBlocker(item, state.document)}</small></span><button type="button" className="button secondary compact" disabled={busy || confirmingSource} onClick={() => setReview(item)}>Conferir cuidado</button></div>)}</div>}
      {batchItems.length > 0 && <><button type="button" className="button primary" data-plan-action="confirm-items" disabled={busy || confirmingSource || !state.plan.sourceReviewed || state.plan.unresolved.length > 0} onClick={() => void run({ type: "confirm_items", itemIds: batchItems.map(item => item.id) }, `${batchItems.length} ${batchItems.length === 1 ? "cuidado confirmado" : "cuidados confirmados"} com a fonte.`)}><CheckCircleIcon size={21} />Confirmar {batchItems.length} {batchItems.length === 1 ? "cuidado" : "cuidados"}</button><p className="small-note">Cuidados com dúvidas ficam para revisão.</p></>}
      {!state.plan.sourceReviewed && individualReviewCount > 0 && <div className="plan-individual-needed"><p>{individualReviewCount} {individualReviewCount === 1 ? "cuidado precisa" : "cuidados precisam"} de revisão individual.</p><button type="button" className="text-button" data-plan-action="review-item" disabled={busy} onClick={() => setReview(state.plan.items.find(item => !readyForPlan(item) && !!batchConfirmationBlocker(item, state.document)) ?? nextReviewItem ?? null)}><PencilSimpleIcon size={18} />Conferir próximo cuidado</button></div>}
      <div className="plan-activation"><p className="small-note" role="status">{activationNote}</p><button type="button" className={`button ${canActivate ? "primary" : "secondary"}`} data-plan-action="activate" disabled={!canActivate || busy} onClick={() => void run({ type: "activate_plan" }, "Plano ativado.")}><ShieldCheckIcon size={21} />Ativar plano</button></div>
    </section>}
    {readingNotes.length > 0 && <details className="plan-secondary-disclosure" data-plan-reading-notes="true"><summary><strong>Observações da leitura</strong><CaretDownIcon size={20} aria-hidden="true" /></summary><div className="stack-sm">{readingNotes.map((note, index) => <p className="small-note" key={index}>{note}</p>)}</div></details>}
    {!isActive && isCaregiver && hasDraft && <details className="plan-secondary-disclosure plan-replace-source" key={state.document?.id ?? "manual"} data-plan-source="replace"><summary><span>Trocar documento</span><CaretDownIcon size={20} aria-hidden="true" /></summary><div className="stack-sm"><p className="small-note">Ao trocar o documento, você precisará conferir os cuidados novamente.</p>{importControls}</div></details>}
    {!isActive && isCaregiver && hasDraft && state.plan.items.length === 0 && <button className="button secondary" onClick={() => setAdding(true)} disabled={busy}><PlusIcon size={20} />Adicionar cuidado à mão</button>}
    {!state.plan.items.length && !isCaregiver && <EmptyState icon={<FileTextIcon size={30} />} title="Ainda não há um plano ativo">Seu cuidador está preparando as orientações.</EmptyState>}
    {isActive && <p className="small-note"><ShieldCheckIcon size={17} />Orientações conferidas pelo cuidador.</p>}
    {original && <Modal title="Documento original" subtitle="Amplie o documento se precisar." wide onClose={() => setOriginal(false)}><DocumentViewer document={state.document} /></Modal>}
    {review && <ReviewDialog key={review.id + state.plan.status} item={review} state={state} busy={busy} run={run} onClose={() => setReview(null)} />}
    {adding && <ManualCareDialog state={state} busy={busy} run={run} onClose={() => setAdding(false)} />}
    {uncertainty !== null && <UncertaintyDialog question={state.plan.unresolved[uncertainty]} index={uncertainty} run={run} busy={busy} onClose={() => setUncertainty(null)} />}
  </div>;
}

export async function confirmReviewedSource({ getState, run }: { getState: () => CareState; run: RunAction }): Promise<boolean> {
  if (!await run({ type: "confirm_source_pages" }, "Páginas conferidas.")) return false;
  const latest = getState();
  if (latest.plan.unresolved.length > 0) return true;
  const eligible = latest.plan.items.filter(item => !item.confirmed && !batchConfirmationBlocker(item, latest.document));
  if (eligible.length === 0) return true;
  return run({ type: "confirm_items", itemIds: eligible.map(item => item.id) }, `${eligible.length} ${eligible.length === 1 ? "cuidado confirmado" : "cuidados confirmados"}.`);
}

export async function completeCareConfirmation({ save, confirm, onClose }: { save?: () => Promise<boolean>; confirm: () => Promise<boolean>; onClose: () => void }): Promise<boolean> {
  if (save && !await save()) return false;
  if (!await confirm()) return false;
  onClose();
  return true;
}

export function ReviewDialog({ item, state, busy, run, onClose }: { item: DraftItem; state: CareState; busy: boolean; run: RunAction; onClose: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [instruction, setInstruction] = useState(item.instruction);
  const [fields, setFields] = useState<Record<string, CareField>>(structuredClone(item.fields));
  const [questions, setQuestions] = useState(item.questions.join("\n"));
  const initialProposal = proposeTimes(item);
  const [times, setTimes] = useState(item.schedule?.times.length ? item.schedule.times.join(", ") : initialProposal.times.join(", "));
  const [priority, setPriority] = useState<"normal" | "important">(item.schedule?.priority ?? "normal");
  const [tolerance, setTolerance] = useState(item.schedule?.toleranceMinutes ?? 30);
  const [suggestion] = useState(() => state.role === "caregiver" ? suggestMedicationPeriod(item) : null);
  const initialPeriod = validPeriod(item.schedule?.period) ? item.schedule.period : suggestion?.period;
  const [periodMode, setPeriodMode] = useState<"unset" | "finite" | "ongoing">(initialPeriod ? initialPeriod.endDate === null ? "ongoing" : "finite" : "unset");
  const [startDate, setStartDate] = useState(initialPeriod?.startDate ?? "");
  const [endDate, setEndDate] = useState(initialPeriod?.endDate ?? "");
  const [endManuallyEdited, setEndManuallyEdited] = useState(false);
  const [recurrenceKind, setRecurrenceKind] = useState<ScheduleRecurrence["kind"] | "unset">(item.schedule?.recurrence?.kind ?? "unset");
  const [weekdays, setWeekdays] = useState<number[]>(item.schedule?.recurrence?.kind === "weekly" ? item.schedule.recurrence.weekdays : []);
  const [dates, setDates] = useState<string[]>(item.schedule?.recurrence?.kind === "dates" ? item.schedule.recurrence.dates : [""]);
  const [localError, setLocalError] = useState("");
  const [saving, setSaving] = useState(false);
  const [documentOpen, setDocumentOpen] = useState(false);
  const inFlight = useRef(false);
  const corrections = useRef<HTMLDetailsElement>(null);
  const periodChoiceRef = useRef<HTMLSelectElement>(null);
  const firstDay = useRef<HTMLInputElement>(null);
  const lastDay = useRef<HTMLInputElement>(null);
  const agenda = useRef<HTMLSelectElement>(null);
  const timeInput = useRef<HTMLInputElement>(null);
  const editable = state.role === "caregiver" && state.plan.status === "draft";
  const freshItem = state.plan.items.find((candidate) => candidate.id === item.id) ?? item;
  const legacyPeriodReview = state.role === "caregiver" && state.plan.status === "active" && freshItem.category === "medication" && !validPeriod(freshItem.schedule?.period);
  const legacyScheduleReview = state.role === "caregiver" && state.plan.status === "active" && freshItem.category !== "medication" && !hasReviewedSchedule(freshItem);
  const legacyTimeReview = state.role === "caregiver" && state.plan.status === "active" && !isReferenceCare(freshItem) && !freshItem.schedule?.times.length;
  const timesEditable = editable || legacyTimeReview;
  const timeOrigin = times === (freshItem.schedule?.times.length ? freshItem.schedule.times.join(", ") : initialProposal.times.join(", ")) ? freshItem.schedule?.timeOrigin ?? initialProposal.origin : "caregiver";
  const agendaEditable = editable || legacyScheduleReview;
  const periodEditable = editable || legacyPeriodReview || (legacyScheduleReview && !validPeriod(freshItem.schedule?.period));
  const disabled = busy || saving;
  const recurrence: ScheduleRecurrence | undefined = recurrenceKind === "unset" ? undefined : recurrenceKind === "weekly" ? { kind: "weekly", weekdays } : recurrenceKind === "dates" ? { kind: "dates", dates: dates.filter(Boolean).sort() } : { kind: recurrenceKind };
  const period: SchedulePeriod | undefined = periodMode === "unset" ? undefined : { startDate, endDate: periodMode === "finite" ? endDate : null };
  const parsedTimes = times.split(",").map((time) => time.trim()).filter(Boolean);
  const schedule: NonNullable<DraftItem["schedule"]> = { times: parsedTimes, timeOrigin, priority, toleranceMinutes: tolerance, ...(period ? { period } : {}), ...(recurrence ? { recurrence } : {}) };
  const proposed: DraftItem = { ...freshItem, title, instruction, fields, questions: questions.split("\n").map(q => q.trim()).filter(Boolean), schedule };
  const dirty = JSON.stringify(period) !== JSON.stringify(freshItem.schedule?.period) || JSON.stringify(recurrence) !== JSON.stringify(freshItem.schedule?.recurrence) || title !== freshItem.title || instruction !== freshItem.instruction || JSON.stringify(fields) !== JSON.stringify(freshItem.fields) || questions !== freshItem.questions.join("\n") || times !== (freshItem.schedule?.times.join(", ") ?? "") || priority !== (freshItem.schedule?.priority ?? "normal") || tolerance !== (freshItem.schedule?.toleranceMinutes ?? 30);
  const backOnly = !legacyPeriodReview && !legacyScheduleReview && !legacyTimeReview && (!editable || (freshItem.confirmed && !dirty));
  const blockers = [...new Set(itemConfirmationBlockers(proposed, state.document))];
  const fieldEntries = Object.entries(fields);
  const fieldLabel = (key: string) => fieldLabels[key] ?? fieldLabels[key.normalize("NFD").replace(/[\u0300-\u036f]/g, "")] ?? key;
  const keyFields = fieldEntries.filter(([key]) => ["concentracao", "concentration", "dose", "via", "route", "frequencia", "frequency"].includes(key.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()));

  function changeStartDate(value: string) {
    setStartDate(value);
    if (suggestion && !endManuallyEdited && periodMode === "finite") {
      const suggestedEnd = endDateForDuration(value, suggestion.days);
      if (suggestedEnd) setEndDate(suggestedEnd);
    }
  }
  function validationError() {
    if (!title.trim()) return "Informe o nome do cuidado.";
    if (!instruction.trim()) return "Informe a orientação completa.";
    if ((item.category === "medication" || periodMode !== "unset") && !validPeriod(period)) return "Confira o início e o término. O término não pode ser anterior ao início.";
    if (parsedTimes.some(time => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) return "Use horários no formato 08:00, 14:00.";
    return blockers[0];
  }
  function revealProblem(message: string) {
    setLocalError(message);
    if (!validPeriod(period) && item.category === "medication") {
      (periodMode === "unset" ? periodChoiceRef.current : startDate ? lastDay.current : firstDay.current)?.focus();
    } else if (item.category !== "medication" && !hasReviewedSchedule(proposed)) {
      agenda.current?.focus();
    } else if (timeBlocker(proposed)) {
      timeInput.current?.focus();
    } else {
      if (corrections.current) corrections.current.open = true;
      requestAnimationFrame(() => corrections.current?.querySelector<HTMLElement>('textarea[name="review-questions"], input, textarea')?.focus());
    }
  }
  async function saveChanges() {
    if (legacyScheduleReview) return run({ type: "confirm_item_schedule", itemId: item.id, schedule }, "Agenda conferida.");
    if (legacyPeriodReview && period && !await run({ type: "confirm_item_period", itemId: item.id, period }, "Período conferido.")) return false;
    if (legacyTimeReview) return run({ type: "confirm_item_times", itemId: item.id, times: parsedTimes }, "Horários conferidos.");
    if (legacyPeriodReview) return true;
    return run({ type: "update_item", itemId: item.id, title, instruction, fields, questions: proposed.questions, schedule }, "Correções salvas.");
  }
  async function confirmCare(event: FormEvent) {
    event.preventDefault();
    if (backOnly) return onClose();
    if (disabled || inFlight.current) return;
    const error = validationError();
    if (error) return revealProblem(error);
    setLocalError(""); inFlight.current = true; setSaving(true);
    try {
      if (legacyPeriodReview || legacyScheduleReview || legacyTimeReview) {
        if (await saveChanges()) onClose();
      } else {
        await completeCareConfirmation({ save: dirty ? saveChanges : undefined, confirm: () => run({ type: "confirm_item", itemId: item.id }, "Cuidado confirmado."), onClose });
      }
    } finally { inFlight.current = false; setSaving(false); }
  }

  const periodChoice = <label>Validade<select ref={periodChoiceRef} value={periodMode} disabled={!periodEditable || disabled} onChange={(event) => setPeriodMode(event.target.value as typeof periodMode)}><option value="unset">Período não informado</option><option value="finite">Com data de término</option><option value="ongoing">A orientação não define término</option></select></label>;
  return <Modal title={editable || legacyPeriodReview || legacyScheduleReview || legacyTimeReview ? "Revisar cuidado" : "Cuidado conferido"} variant="review-screen" onClose={onClose}>
    <form onSubmit={confirmCare} className="review-simple" noValidate>
      <section className="review-care-summary"><p className="eyebrow">{categoryLabels[item.category]}</p><h3>{careText(title)}</h3><p className="review-instruction">{careText(instruction)}</p>
        {keyFields.length > 0 && <dl className="review-key-fields">{keyFields.map(([key, field]) => <div key={key}><dt>{fieldLabel(key)}</dt><dd>{field.value || readingLabels[field.state]}</dd></div>)}</dl>}
        <details className="review-source-disclosure" onToggle={event => setDocumentOpen(event.currentTarget.open)}><summary><FileTextIcon size={20} />Ver no documento<CaretDownIcon size={18} /></summary>{documentOpen && <div className="review-original"><DocumentViewer document={state.document} initialPage={item.source.page ?? 1} /><blockquote>{item.source.quote || "Confira a orientação no documento."}</blockquote></div>}</details>
      </section>
      {item.category !== "medication" && <fieldset className="review-schedule stack-sm"><legend>Dias da rotina</legend><label>Quando acompanhar<select ref={agenda} value={recurrenceKind} disabled={!agendaEditable || disabled} onChange={event => setRecurrenceKind(event.target.value as typeof recurrenceKind)}><option value="unset">Escolha os dias</option><option value="daily">Todos os dias do período</option><option value="weekly">Dias da semana</option><option value="dates">Datas específicas</option><option value="reference">Só para consulta</option></select></label>
        {recurrenceKind === "weekly" && <div className="recurrence-days">{weekdayLabels.map((label, day) => <label key={day}><input type="checkbox" checked={weekdays.includes(day)} disabled={!agendaEditable || disabled} onChange={event => setWeekdays(event.target.checked ? [...weekdays, day].sort() : weekdays.filter(value => value !== day))} />{label}</label>)}</div>}
        {recurrenceKind === "dates" && <div className="stack-sm">{dates.map((date, index) => <label key={index}>Data {index + 1}<input type="date" value={date} readOnly={!agendaEditable} disabled={disabled} onChange={event => setDates(dates.map((value, current) => current === index ? event.target.value : value))} /></label>)}{agendaEditable && <button type="button" className="text-button" onClick={() => setDates([...dates, ""])}>Adicionar data</button>}</div>}
      </fieldset>}
      <fieldset className="review-schedule stack-sm"><legend>Horários</legend>
        {isReferenceCare(proposed) ? <p className="small-note">Sem tarefa na rotina. Consulte quando precisar.</p> : <>
          <p className="small-note">{timeOrigin === "source" ? "Horários do documento." : timeOrigin === "suggested" ? initialProposal.note : "Horários escolhidos pelo cuidador."}</p>
          <label>Horários da rotina<input ref={timeInput} value={times} onChange={event => setTimes(event.target.value)} placeholder="08:00, 14:00" readOnly={!timesEditable} disabled={disabled} /></label>
          {(editable || legacyTimeReview) && <p className="small-note">Confira os horários antes de confirmar.</p>}
        </>}
      </fieldset>
      <fieldset className="review-period stack-sm"><legend>Por quanto tempo?</legend>
        {suggestion ? <div className="review-suggestion"><p>{endManuallyEdited ? "Você ajustou as datas. Confira com o documento." : `Sugestão: ${suggestion.durationLabel}${startDate === suggestion.period.startDate ? ", contando hoje" : ""}. Ajuste o início se precisar.`}</p><small>Fonte: “{suggestion.sourceText}”</small></div> : <p className="muted">Confira as datas antes de confirmar.</p>}
        {periodMode === "unset" && periodChoice}
        {periodMode !== "unset" && <div className="form-columns"><label>Primeiro dia<input ref={firstDay} type="date" value={startDate} onChange={event => changeStartDate(event.target.value)} readOnly={!periodEditable} disabled={disabled} /></label>{periodMode === "finite" ? <label>Último dia (incluído)<input ref={lastDay} type="date" value={endDate} min={startDate || undefined} onChange={event => { setEndDate(event.target.value); setEndManuallyEdited(true); }} readOnly={!periodEditable} disabled={disabled} /></label> : <p className="small-note">Sem término definido na orientação.</p>}</div>}
      </fieldset>
      {blockers.length > 0 && !backOnly && <div className="review-blockers" role="status"><strong>Antes de confirmar</strong><ul>{blockers.map(message => <li key={message}>{message}</li>)}</ul></div>}
      <details className="review-corrections" ref={corrections}><summary><PencilSimpleIcon size={20} />{editable ? "Corrigir informações" : "Ver todas as informações"}<CaretDownIcon size={18} /></summary><div className="stack-sm">
        <label>Nome do cuidado<input value={title} onChange={event => setTitle(event.target.value)} maxLength={200} readOnly={!editable} /></label><label>Orientação completa<textarea value={instruction} onChange={event => setInstruction(event.target.value)} rows={3} maxLength={8000} readOnly={!editable} /></label>
        {fieldEntries.map(([key, field]) => <div className="field-group" key={key}><label>{fieldLabel(key)}<input value={field.value ?? ""} placeholder="Não informado no documento" readOnly={!editable} onChange={event => setFields({ ...fields, [key]: { ...field, value: event.target.value || null } })} /></label>{field.sourceText && <small className="muted">Fonte: “{field.sourceText}”</small>}{editable ? <label>Leitura do documento<select value={field.state} onChange={event => setFields({ ...fields, [key]: { ...field, state: event.target.value as CareField["state"] } })}>{Object.entries(readingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : <small>{readingLabels[field.state]}</small>}</div>)}
        {(editable || questions) && <label>Dúvidas pendentes<textarea name="review-questions" value={questions} readOnly={!editable} onChange={event => setQuestions(event.target.value)} rows={2} placeholder="Escreva aqui se algo precisa ser esclarecido" /><small>Apague a dúvida só depois de esclarecer.</small></label>}
        {periodMode !== "unset" && periodChoice}
        <div className="form-columns"><label>Prioridade<select value={priority} onChange={event => setPriority(event.target.value as "normal" | "important")} disabled={!editable}><option value="normal">Normal</option><option value="important">Importante</option></select></label><label>Margem de horário (minutos)<input type="number" min="0" max="1440" value={tolerance} onChange={event => setTolerance(Number(event.target.value))} readOnly={!editable} /></label></div>
      </div></details>
      <footer className="review-confirm-footer">{localError && !blockers.includes(localError) && <p className="error-message" role="alert">{localError}</p>}<button type="submit" className="button primary" disabled={disabled}>{saving ? <Busy>Salvando…</Busy> : backOnly ? "Voltar para os cuidados" : <><CheckCircleIcon size={21} />Confirmar cuidado</>}</button></footer>
    </form>
  </Modal>;
}

function UncertaintyDialog({ question, index, run, busy, onClose }: { question: string; index: number; run: RunAction; busy: boolean; onClose: () => void }) {
  const [explanation, setExplanation] = useState("");
  return <Modal title="Esclarecer dúvida" subtitle={question} onClose={onClose}><form className="stack" onSubmit={async (event) => { event.preventDefault(); if (await run({ type: "resolve_uncertainty", index, explanation }, "Dúvida esclarecida.")) onClose(); }}><div className="notice"><WarningCircleIcon size={24} /><p>Se o documento não esclarece, consulte o profissional antes de confirmar.</p></div><label>Qual foi a resposta e quem orientou?<textarea rows={5} value={explanation} onChange={(event) => setExplanation(event.target.value)} minLength={8} required /></label><button className="button primary" disabled={busy}><CheckIcon size={20} />Salvar resposta</button></form></Modal>;
}
