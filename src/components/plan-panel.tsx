"use client";

import { useState, type FormEvent } from "react";
import { ArrowRightIcon, CaretDownIcon, CheckCircleIcon, CheckIcon, CircleIcon, FileArrowUpIcon, FileTextIcon, PencilSimpleIcon, PlusIcon, ShieldCheckIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { CareState, DraftItem, CareField, SchedulePeriod } from "@/lib/contracts";
import { batchConfirmationBlocker } from "@/lib/contracts";
import { periodLabel, validPeriod } from "@/lib/schedule-period";
import DocumentViewer from "./document-viewer";
import ManualCareDialog from "./manual-care-dialog";
import { Brand, Busy, careText, categoryLabels, EmptyState, fieldLabels, Modal, Portrait, readingLabels, type RunAction } from "./care-ui";

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
  const isCaregiver = state.role === "caregiver";
  const isActive = state.plan.status === "active";
  const confirmed = state.plan.items.filter((item) => item.confirmed).length;
  const unresolvedCount = state.plan.unresolved.length + state.plan.items.reduce((n, item) => n + item.questions.length + Object.values(item.fields).filter((f) => f.state === "ambiguous" || f.state === "illegible").length, 0);
  const periodsPending = state.plan.items.filter((item) => item.category === "medication" && !validPeriod(item.schedule?.period));
  const canActivate = state.plan.items.length > 0 && confirmed === state.plan.items.length && unresolvedCount === 0 && periodsPending.length === 0 && state.plan.sourceReviewed;
  const visibleWarnings = state.plan.warnings.map((warning) => confirmed === 0 ? warning : warning.replace(/(?:[;:]\s*)?\bnenhum (?:item|campo)(?:\s*(?:\/|ou|e)\s*(?:item|campo))?\s+(?:(?:est[aá]|foi)\s+)?confirmad[oa]s?\.?/gi, "").trim()).filter(Boolean);
  const isReadingNote = (warning: string) => /^(?:rascunho para revisão humana|transcrição baseada no texto extraído|transcrição em rascunho:)/i.test(warning) && !/(?:ilegível|ambígu|manuscrit|dúvida)/i.test(warning);
  const readingNotes = visibleWarnings.filter(isReadingNote);
  const actionWarnings = visibleWarnings.filter(warning => !isReadingNote(warning));
  const batchItems = state.plan.items.filter(item => !item.confirmed && !batchConfirmationBlocker(item, state.document));
  const unconfirmedCount = state.plan.items.length - confirmed;
  const individualReviewCount = unconfirmedCount - batchItems.length;
  const nextReviewItem = state.plan.items.find(item => !item.confirmed);
  const activationNote = !state.plan.sourceReviewed
    ? "Revise todas as páginas e confirme a conferência da fonte."
    : state.plan.unresolved.length > 0
      ? "Esclareça as dúvidas gerais antes de continuar."
      : individualReviewCount > 0
        ? `${individualReviewCount} ${individualReviewCount === 1 ? "cuidado precisa" : "cuidados precisam"} de revisão individual.`
        : periodsPending.length > 0
          ? "Confira o período dos medicamentos antes de ativar."
          : unconfirmedCount > 0
            ? "Confirme os cuidados que você conferiu com a fonte."
            : "O plano fica fixo depois da ativação.";

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
        {inputMode === "file" ? <label className="upload-zone"><FileArrowUpIcon size={32} /><strong>{file?.name ?? "Escolher PDF ou foto"}</strong><span>Documento impresso e legível · até 10 MB</span><input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={importing} /></label> : <label>Orientações recebidas<textarea value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder="Cole o texto exatamente como foi recebido…" rows={6} disabled={importing} /></label>}
        {uploadError && <p className="error-message" role="alert">{uploadError}</p>}
        <button className="button primary" disabled={importing || busy}>{importing ? <Busy>Preparando a leitura…</Busy> : <><FileTextIcon size={20} />Ler e preparar rascunho</>}</button>
      </form>
      {importing && <p className="small-note" role="status">A leitura pode levar alguns instantes. Esta etapa ainda não ativa o plano.</p>}
      <button className="text-button" onClick={() => setAdding(true)} disabled={busy || importing}><PlusIcon size={18} />Cadastrar um cuidado manualmente</button>
  </>;

  return <div className="stack" data-parity-screen="plan">
    <div className="section-heading"><div><p className="eyebrow">{isActive ? "Orientações conferidas" : "Preparação do cuidado"}</p><h2>{isActive ? "Plano de cuidado" : "Do documento à rotina"}</h2></div><span className={`badge ${isActive ? "badge-green" : "badge-amber"}`}>{isActive ? "Plano ativo" : "Rascunho"}</span></div>
    {!isActive && isCaregiver && <ol className="steps" aria-label="Etapas do plano"><li className={state.plan.items.length ? "completed" : "current"}><span>1</span>Enviar</li><li className={state.plan.items.length ? "current" : ""}><span>2</span>Conferir</li><li className={canActivate ? "current" : ""}><span>3</span>Ativar</li></ol>}
    {!isActive && !isCaregiver && <div className="notice"><ShieldCheckIcon size={25} /><div><strong>Seu cuidador está preparando o plano</strong><p>As orientações aparecem aqui depois da conferência e da ativação.</p></div></div>}
    {!isActive && isCaregiver && (state.document ? <details className="card" key={state.document.id} data-plan-source="replace">
      <summary className="source-link" style={{ minHeight: 44 }}><span className="icon-disc"><FileArrowUpIcon size={25} /></span><span><strong>Trocar a fonte</strong><small>PDF, foto legível ou texto</small></span><CaretDownIcon size={22} /></summary>
      <div className="stack-sm" style={{ marginTop: 20 }}><p className="small-note">Uma nova leitura substitui o rascunho e reinicia as confirmações.</p>{importControls}</div>
    </details> : <section className="card import-card" data-plan-source="initial"><div className="card-heading"><span className="icon-disc"><FileArrowUpIcon size={26} /></span><div><h3>Importar orientações</h3><p className="muted">PDF, foto legível ou texto. Confira a leitura antes de ativar.</p></div></div>{importControls}</section>)}
    {state.document && <button className="card source-link" onClick={() => setOriginal(true)}><span className="icon-disc"><FileTextIcon size={25} /></span><span><strong>{state.document.name}</strong><small>Documento original{state.document.pageCount ? ` · ${state.document.pageCount} página(s)` : ""}</small></span><ArrowRightIcon size={22} /></button>}
    {isActive && periodsPending.length > 0 && <div className="notice" role="status"><WarningCircleIcon size={23} /><div><strong>Período do medicamento a conferir</strong><p>As tarefas de {periodsPending.map((item) => item.title).join(", ")} estão suspensas até o cuidador conferir as datas no Plano. A orientação e os registros anteriores foram preservados.</p></div></div>}
    {actionWarnings.length > 0 && <div className="notice"><WarningCircleIcon size={23} /><div><strong>Atenção ao revisar</strong>{actionWarnings.map((warning, i) => <p key={i}>{warning}</p>)}</div></div>}
    {state.plan.unresolved.length > 0 && <section className="card attention-card"><h3><WarningCircleIcon size={23} />Dúvidas a esclarecer</h3><p>Confirme com a fonte ou com o profissional responsável. Não complete por suposição.</p>{state.plan.unresolved.map((question, i) => <div className="uncertainty-row" key={`${i}-${question}`}><span>{question}</span>{isCaregiver && !isActive && <button className="button secondary compact" onClick={() => setUncertainty(i)}>Esclarecer</button>}</div>)}</section>}
    {!isActive && isCaregiver && state.plan.items.length > 0 && <section className="card activation-card stack-sm" data-plan-review="quick" aria-label="Conferência e ativação do plano">
      <div className="section-heading small"><h3>Conferir e ativar</h3><span className="muted">{confirmed}/{state.plan.items.length} conferidos</span></div>
      <button className={`source-confirm ${state.plan.sourceReviewed ? "checked" : ""}`} style={{ margin: 0 }} onClick={() => void run({ type: "confirm_source_pages" }, "Conferência de todas as páginas registrada.")} disabled={busy || state.plan.sourceReviewed}>{state.plan.sourceReviewed ? <CheckCircleIcon size={24} /> : <CircleIcon size={24} />}<span>Revisei todas as páginas e incluí as orientações que faltavam.</span></button>
      {state.plan.unresolved.length > 0 ? <button type="button" className="button primary" data-plan-action="resolve-uncertainty" disabled={busy} onClick={() => setUncertainty(0)}><WarningCircleIcon size={21} />Esclarecer dúvida</button>
        : batchItems.length > 0 ? <button type="button" className="button primary" data-plan-action="confirm-items" disabled={busy || !state.plan.sourceReviewed} onClick={() => void run({ type: "confirm_items", itemIds: batchItems.map(item => item.id) }, `${batchItems.length} ${batchItems.length === 1 ? "cuidado confirmado" : "cuidados confirmados"} com a fonte.`)}><CheckCircleIcon size={21} />Confirmar {batchItems.length} {batchItems.length === 1 ? "item conferido" : "itens conferidos"}</button>
        : periodsPending.length > 0 ? <button type="button" className="button primary" data-plan-action="review-period" disabled={busy} onClick={() => setReview(periodsPending[0])}><PencilSimpleIcon size={21} />Conferir período</button>
        : nextReviewItem ? <button type="button" className="button primary" data-plan-action="review-item" disabled={busy} onClick={() => setReview(nextReviewItem)}><PencilSimpleIcon size={21} />Revisar cuidado pendente</button>
        : !state.plan.sourceReviewed ? <button type="button" className="button primary" data-plan-action="review-source" disabled={busy} onClick={() => setOriginal(true)}><FileTextIcon size={21} />Conferir documento original</button>
        : <button type="button" className="button primary" data-plan-action="activate" disabled={!canActivate || busy} onClick={() => void run({ type: "activate_plan" }, "Plano ativado e disponível nas duas visões.")}><CheckCircleIcon size={21} />Ativar plano</button>}
      <p className="small-note" role="status">{activationNote}{batchItems.length > 0 && individualReviewCount > 0 ? " Os itens com dúvidas continuam pendentes." : ""}</p>
      {unresolvedCount > 0 && <p className="small-note">{unresolvedCount} {unresolvedCount === 1 ? "dúvida pendente" : "dúvidas pendentes"}. A ativação só fica disponível depois da conferência completa.</p>}
    </section>}
    {readingNotes.length > 0 && <details className="card" data-plan-reading-notes="true"><summary className="source-link" style={{ minHeight: 44 }}><strong>Observações da leitura</strong><CaretDownIcon size={20} /></summary><div className="stack-sm" style={{ marginTop: 14 }}>{readingNotes.map((note, index) => <p className="small-note" key={index}>{note}</p>)}</div></details>}
    {state.plan.items.length > 0 ? <section className="stack-sm"><div className="section-heading small"><h3>{isActive ? `${state.plan.items.length} cuidados no plano` : "Confira cada cuidado"}</h3>{!isActive && <span className="muted">{confirmed} de {state.plan.items.length} confirmados</span>}</div>
      {state.plan.items.map((item) => <button className={`card plan-item ${item.confirmed ? "confirmed" : ""}`} key={item.id} onClick={() => setReview(item)}><div className="plan-item-top"><span className="eyebrow">{categoryLabels[item.category]}</span><span className={`badge ${item.confirmed ? "badge-green" : "badge-amber"}`}>{item.confirmed ? <CheckCircleIcon size={15} /> : <CircleIcon size={15} />}{item.confirmed ? "Conferido" : "A conferir"}</span></div><h3>{careText(item.title)}</h3><p>{careText(item.instruction)}</p>{item.schedule?.period && validPeriod(item.schedule.period) && <p className="small-note">Período: {periodLabel(item.schedule.period)}</p>}{item.category === "medication" && !validPeriod(item.schedule?.period) && <p className="warning-text">Período a conferir</p>}{item.questions.length > 0 && <p className="warning-text"><WarningCircleIcon size={17} />{item.questions.length} dúvida(s) neste cuidado</p>}<span className="item-action">{isActive ? "Ver orientação e fonte" : "Revisar com a fonte"}<ArrowRightIcon size={18} /></span></button>)}
      {!isActive && isCaregiver && <button className="button secondary" onClick={() => setAdding(true)}><PlusIcon size={20} />Adicionar orientação que faltou</button>}
    </section> : !isCaregiver && <EmptyState icon={<FileTextIcon size={30} />} title="Ainda não há um plano ativo">Você e seu cuidador verão as mesmas orientações aprovadas.</EmptyState>}
    {isActive && <p className="small-note"><ShieldCheckIcon size={17} />Plano conferido pelo cuidador. Os registros de rotina não alteram as orientações.</p>}
    {original && <Modal title="Documento original" subtitle="Confira todas as páginas e use o zoom para ler." wide onClose={() => setOriginal(false)}><DocumentViewer document={state.document} /></Modal>}
    {review && <ReviewDialog key={review.id + state.plan.status} item={review} state={state} busy={busy} run={run} onClose={() => setReview(null)} />}
    {adding && <ManualCareDialog state={state} busy={busy} run={run} onClose={() => setAdding(false)} />}
    {uncertainty !== null && <UncertaintyDialog question={state.plan.unresolved[uncertainty]} index={uncertainty} run={run} busy={busy} onClose={() => setUncertainty(null)} />}
  </div>;
}

function ReviewDialog({ item, state, busy, run, onClose }: { item: DraftItem; state: CareState; busy: boolean; run: RunAction; onClose: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [instruction, setInstruction] = useState(item.instruction);
  const [fields, setFields] = useState<Record<string, CareField>>(structuredClone(item.fields));
  const [questions, setQuestions] = useState(item.questions.join("\n"));
  const [times, setTimes] = useState(item.schedule?.times.join(", ") ?? "");
  const [priority, setPriority] = useState<"normal" | "important">(item.schedule?.priority ?? "normal");
  const [tolerance, setTolerance] = useState(item.schedule?.toleranceMinutes ?? 30);
  const [periodMode, setPeriodMode] = useState<"unset" | "finite" | "ongoing">(item.schedule?.period ? item.schedule.period.endDate === null ? "ongoing" : "finite" : "unset");
  const [startDate, setStartDate] = useState(item.schedule?.period?.startDate ?? "");
  const [endDate, setEndDate] = useState(item.schedule?.period?.endDate ?? "");
  const [localError, setLocalError] = useState("");
  const editable = state.role === "caregiver" && state.plan.status === "draft";
  const freshItem = state.plan.items.find((candidate) => candidate.id === item.id) ?? item;
  const legacyPeriodReview = state.role === "caregiver" && state.plan.status === "active" && freshItem.category === "medication" && !validPeriod(freshItem.schedule?.period);
  const period: SchedulePeriod | undefined = periodMode === "unset" ? undefined : { startDate, endDate: periodMode === "finite" ? endDate : null };
  const periodDirty = JSON.stringify(period) !== JSON.stringify(freshItem.schedule?.period);
  const dirty = periodDirty || title !== freshItem.title || instruction !== freshItem.instruction || JSON.stringify(fields) !== JSON.stringify(freshItem.fields) || questions !== freshItem.questions.join("\n") || times !== (freshItem.schedule?.times.join(", ") ?? "") || priority !== (freshItem.schedule?.priority ?? "normal") || tolerance !== (freshItem.schedule?.toleranceMinutes ?? 30);
  async function save(event: FormEvent) {
    event.preventDefault(); setLocalError("");
    if ((item.category === "medication" || periodMode !== "unset") && !validPeriod(period)) return setLocalError("Confira o início e o término. O término não pode ser anterior ao início.");
    if (legacyPeriodReview && period) {
      if (await run({ type: "confirm_item_period", itemId: item.id, period }, "Período conferido. As tarefas seguem as datas confirmadas.")) onClose();
      return;
    }
    const parsedTimes = times.split(",").map((time) => time.trim()).filter(Boolean);
    if (parsedTimes.some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) return setLocalError("Use horários no formato 08:00, 14:00.");
    await run({ type: "update_item", itemId: item.id, title, instruction, fields, questions: questions.split("\n").map((q) => q.trim()).filter(Boolean), schedule: { times: parsedTimes, priority, toleranceMinutes: tolerance, ...(period ? { period } : {}) } }, "Correção salva. Confira e confirme este cuidado.");
  }
  const fieldEntries = Object.entries(fields);
  const primaryField = fieldEntries.find(([, field]) => field.state === "ambiguous" || field.state === "illegible") ?? fieldEntries[0];
  const renderField = ([key, field]: [string, CareField]) => <div className="field-group" key={key}><label>{fieldLabels[key] ?? key}<input value={field.value ?? ""} placeholder="Não consta na fonte" readOnly={!editable} onChange={(event) => setFields({ ...fields, [key]: { ...field, value: event.target.value || null } })} /></label>{field.sourceText && <small className="muted">Fonte: “{field.sourceText}”</small>}{editable ? <label className="field-status">Estado da leitura<select value={field.state} onChange={(event) => setFields({ ...fields, [key]: { ...field, state: event.target.value as CareField["state"] } })}>{Object.entries(readingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : <small className="muted">{readingLabels[field.state]}</small>}</div>;
  return <Modal title={editable ? "Revisar com a fonte" : careText(title)} subtitle={`${categoryLabels[item.category]}${item.source.page ? ` · página ${item.source.page}` : ""}`} variant="review-screen" headerContent={<header className="focus-header" data-parity-anchor="app-header"><Brand /><Portrait name={state.role === "patient" ? state.patient.name : state.patient.caregiverName} role={state.role} /></header>} wide onClose={onClose}>
    <form onSubmit={save} className="review-main-form">
      <div className="review-layout" data-parity-anchor="source-editor-alignment">
        <div className="review-source"><DocumentViewer document={state.document} initialPage={item.source.page ?? 1} /></div>
        <div className="review-form stack">
          <div className="source-quote" data-parity-anchor="transcript"><span className="eyebrow">Trecho transcrito da fonte</span><blockquote tabIndex={0} aria-label="Trecho completo transcrito da fonte">{item.source.quote || "Confira a orientação completa no original."}</blockquote></div>
          <div data-parity-anchor="field-editor">{primaryField ? renderField(primaryField) : <label>Orientação completa<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={4} required readOnly={!editable} /></label>}</div>
          {(editable || questions) && <label data-parity-anchor="clarification-context">Dúvidas pendentes <span className="label-hint sr-only">Remova somente após esclarecer com a fonte.</span><textarea value={questions} readOnly={!editable} onChange={(event) => setQuestions(event.target.value)} rows={2} placeholder="Nenhuma dúvida pendente" /></label>}
          {localError && <p className="error-message" role="alert">{localError}</p>}
          {editable && <button type="submit" className="button secondary review-save" data-parity-anchor="save-action" disabled={!dirty || busy}><PencilSimpleIcon size={20} />Salvar correções</button>}
        </div>
      </div>
      <div className="review-extra stack">
      <fieldset className="stack-sm"><legend>Período da rotina</legend>
        <p className="small-note">Confira a duração na fonte e informe as datas acordadas. O aplicativo não calcula o início nem transforma o texto em tratamento. O último dia está incluído; as datas seguem o horário de Brasília.</p>
        {legacyPeriodReview && <p className="warning-text">Este plano antigo não tem período conferido. Complete apenas as datas para retomar as tarefas; a orientação permanece igual.</p>}
        <label>Validade<select value={periodMode} disabled={!editable && !legacyPeriodReview} onChange={(event) => setPeriodMode(event.target.value as typeof periodMode)}><option value="unset">Período não informado</option><option value="finite">Com data de término</option><option value="ongoing">A orientação não define término</option></select></label>
        {periodMode !== "unset" && <div className="form-columns"><label>Primeiro dia<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required readOnly={!editable && !legacyPeriodReview} /></label>{periodMode === "finite" && <label>Último dia (incluído)<input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} required readOnly={!editable && !legacyPeriodReview} /></label>}</div>}
        {periodMode === "unset" && item.category === "medication" && <p className="warning-text">Informe o período antes de confirmar este medicamento.</p>}
      </fieldset>
        {legacyPeriodReview && <button type="submit" className="button primary" disabled={busy || !validPeriod(period)}><CheckIcon size={20} />Conferi o período com a fonte</button>}
        {editable && <><p className="small-note" data-parity-anchor="support-note">{dirty ? "Salve suas alterações antes de confirmar." : "Confira todos os campos. Se houver dúvida, mantenha o cuidado pendente."}</p><button type="button" className="button primary" disabled={dirty || busy || freshItem.confirmed || (item.category === "medication" && !validPeriod(freshItem.schedule?.period))} onClick={() => void run({ type: "confirm_item", itemId: item.id }, "Cuidado conferido com a fonte.")}>{freshItem.confirmed ? <><CheckCircleIcon size={20} />Cuidado confirmado</> : <><CheckIcon size={20} />Conferi e confirmo este cuidado</>}</button></>}
        <details className="review-details"><summary>Conferir todos os campos e horários</summary><div className="stack"><label>Nome do cuidado<input value={title} onChange={(event) => setTitle(event.target.value)} required readOnly={!editable} /></label><label>Orientação completa<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={3} required readOnly={!editable} /></label>{fieldEntries.filter(([key]) => key !== primaryField?.[0]).map(renderField)}<fieldset className="stack-sm"><legend>Organização da rotina</legend><p className="small-note">Preserve a frequência prescrita. Os horários abaixo organizam o acompanhamento.</p><label>Horários da rotina<input value={times} onChange={(event) => setTimes(event.target.value)} placeholder="08:00, 14:00" readOnly={!editable} /></label><div className="form-columns"><label>Prioridade<select value={priority} onChange={(event) => setPriority(event.target.value as "normal" | "important")} disabled={!editable}><option value="normal">Normal</option><option value="important">Importante</option></select></label><label>Tolerância em minutos<input type="number" min="0" max="1440" value={tolerance} onChange={(event) => setTolerance(Number(event.target.value))} readOnly={!editable} /></label></div></fieldset></div></details>
      </div>
    </form>
  </Modal>;

}

function UncertaintyDialog({ question, index, run, busy, onClose }: { question: string; index: number; run: RunAction; busy: boolean; onClose: () => void }) {
  const [explanation, setExplanation] = useState("");
  return <Modal title="Esclarecer dúvida" subtitle={question} onClose={onClose}><form className="stack" onSubmit={async (event) => { event.preventDefault(); if (await run({ type: "resolve_uncertainty", index, explanation }, "Esclarecimento registrado. Confira os cuidados relacionados.")) onClose(); }}><div className="notice"><WarningCircleIcon size={24} /><p>Se a fonte não permite responder, mantenha a dúvida e consulte o profissional responsável.</p></div><label>O que foi esclarecido e qual foi a fonte?<textarea rows={5} value={explanation} onChange={(event) => setExplanation(event.target.value)} minLength={8} required /></label><button className="button primary" disabled={busy}><CheckIcon size={20} />Registrar esclarecimento</button></form></Modal>;
}
