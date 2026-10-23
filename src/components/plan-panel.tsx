"use client";

import { useState, type FormEvent } from "react";
import { ArrowRightIcon, CheckCircleIcon, CheckIcon, CircleIcon, FileArrowUpIcon, FileTextIcon, PencilSimpleIcon, PlusIcon, ShieldCheckIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { CareState, DraftItem, CareField } from "@/lib/contracts";
import DocumentViewer from "./document-viewer";
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
  const canActivate = state.plan.items.length > 0 && confirmed === state.plan.items.length && unresolvedCount === 0 && state.plan.sourceReviewed;

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

  return <div className="stack" data-parity-screen="plan">
    <div className="section-heading"><div><p className="eyebrow">{isActive ? "Orientações conferidas" : "Preparação do cuidado"}</p><h2>{isActive ? "Plano de cuidado" : "Do documento à rotina"}</h2></div><span className={`badge ${isActive ? "badge-green" : "badge-amber"}`}>{isActive ? "Plano ativo" : "Rascunho"}</span></div>
    {!isActive && isCaregiver && <ol className="steps" aria-label="Etapas do plano"><li className={state.plan.items.length ? "completed" : "current"}><span>1</span>Enviar</li><li className={state.plan.items.length ? "current" : ""}><span>2</span>Conferir</li><li className={canActivate ? "current" : ""}><span>3</span>Ativar</li></ol>}
    {!isActive && !isCaregiver && <div className="notice"><ShieldCheckIcon size={25} /><div><strong>Seu cuidador está preparando o plano</strong><p>As orientações aparecem aqui depois da conferência e da ativação.</p></div></div>}
    {!isActive && isCaregiver && <section className="card import-card"><div className="card-heading"><span className="icon-disc"><FileArrowUpIcon size={26} /></span><div><h3>{state.plan.items.length ? "Trocar a fonte do rascunho" : "Importar orientações"}</h3><p className="muted">PDF, foto legível ou texto. Confira a leitura antes de ativar.</p></div></div>
      {state.plan.items.length > 0 && <p className="small-note">Uma nova leitura substitui o rascunho e reinicia as confirmações.</p>}
      <form onSubmit={importDocument} className="stack-sm">
        <div className="segmented" aria-label="Tipo de entrada"><button type="button" className={inputMode === "file" ? "selected" : ""} onClick={() => setInputMode("file")} aria-pressed={inputMode === "file"}>PDF ou foto</button><button type="button" className={inputMode === "text" ? "selected" : ""} onClick={() => setInputMode("text")} aria-pressed={inputMode === "text"}>Colar texto</button></div>
        {inputMode === "file" ? <label className="upload-zone"><FileArrowUpIcon size={32} /><strong>{file?.name ?? "Escolher PDF ou foto"}</strong><span>Documento impresso e legível · até 10 MB</span><input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={importing} /></label> : <label>Orientações recebidas<textarea value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder="Cole o texto exatamente como foi recebido…" rows={6} disabled={importing} /></label>}
        {uploadError && <p className="error-message" role="alert">{uploadError}</p>}
        <button className="button primary" disabled={importing || busy}>{importing ? <Busy>Preparando a leitura…</Busy> : <><FileTextIcon size={20} />Ler e preparar rascunho</>}</button>
      </form>
      {importing && <p className="small-note" role="status">A leitura pode levar alguns instantes. Esta etapa ainda não ativa o plano.</p>}
      <button className="text-button" onClick={() => setAdding(true)} disabled={busy || importing}><PlusIcon size={18} />Cadastrar um cuidado manualmente</button>
    </section>}
    {state.document && <button className="card source-link" onClick={() => setOriginal(true)}><span className="icon-disc"><FileTextIcon size={25} /></span><span><strong>{state.document.name}</strong><small>Documento original{state.document.pageCount ? ` · ${state.document.pageCount} página(s)` : ""}</small></span><ArrowRightIcon size={22} /></button>}
    {!isActive && state.plan.warnings.length > 0 && <div className="notice"><WarningCircleIcon size={23} /><div><strong>Atenção ao revisar</strong>{state.plan.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</div></div>}
    {state.plan.unresolved.length > 0 && <section className="card attention-card"><h3><WarningCircleIcon size={23} />Dúvidas a esclarecer</h3><p>Confirme com a fonte ou com o profissional responsável. Não complete por suposição.</p>{state.plan.unresolved.map((question, i) => <div className="uncertainty-row" key={`${i}-${question}`}><span>{question}</span>{isCaregiver && !isActive && <button className="button secondary compact" onClick={() => setUncertainty(i)}>Esclarecer</button>}</div>)}</section>}
    {state.plan.items.length > 0 ? <section className="stack-sm"><div className="section-heading small"><h3>{isActive ? `${state.plan.items.length} cuidados no plano` : "Confira cada cuidado"}</h3>{!isActive && <span className="muted">{confirmed} de {state.plan.items.length} confirmados</span>}</div>
      {state.plan.items.map((item) => <button className={`card plan-item ${item.confirmed ? "confirmed" : ""}`} key={item.id} onClick={() => setReview(item)}><div className="plan-item-top"><span className="eyebrow">{categoryLabels[item.category]}</span><span className={`badge ${item.confirmed ? "badge-green" : "badge-amber"}`}>{item.confirmed ? <CheckCircleIcon size={15} /> : <CircleIcon size={15} />}{item.confirmed ? "Conferido" : "A conferir"}</span></div><h3>{careText(item.title)}</h3><p>{careText(item.instruction)}</p>{item.questions.length > 0 && <p className="warning-text"><WarningCircleIcon size={17} />{item.questions.length} dúvida(s) neste cuidado</p>}<span className="item-action">{isActive ? "Ver orientação e fonte" : "Revisar com a fonte"}<ArrowRightIcon size={18} /></span></button>)}
      {!isActive && isCaregiver && <button className="button secondary" onClick={() => setAdding(true)}><PlusIcon size={20} />Adicionar orientação que faltou</button>}
    </section> : !isCaregiver && <EmptyState icon={<FileTextIcon size={30} />} title="Ainda não há um plano ativo">Você e seu cuidador verão as mesmas orientações aprovadas.</EmptyState>}
    {!isActive && isCaregiver && state.plan.items.length > 0 && <section className="card activation-card"><div className="card-heading"><span className="icon-disc"><ShieldCheckIcon size={26} /></span><div><h3>Pronto para compartilhar?</h3><p className="muted">O plano fica fixo depois da ativação.</p></div></div>
      <button className={`source-confirm ${state.plan.sourceReviewed ? "checked" : ""}`} onClick={() => void run({ type: "confirm_source_pages" }, "Conferência de todas as páginas registrada.")} disabled={busy || state.plan.sourceReviewed}>{state.plan.sourceReviewed ? <CheckCircleIcon size={24} /> : <CircleIcon size={24} />}<span>Revisei todas as páginas e incluí as orientações que faltavam.</span></button>
      <div className="activation-status"><span>{confirmed}/{state.plan.items.length} cuidados confirmados</span><span>{unresolvedCount ? `${unresolvedCount} dúvida(s) pendente(s)` : "Nenhuma dúvida pendente"}</span></div>
      <button className="button primary" disabled={!canActivate || busy} onClick={() => void run({ type: "activate_plan" }, "Plano ativado e disponível nas duas visões.")}><CheckCircleIcon size={21} />Ativar plano</button>{!canActivate && <p className="small-note">Confira cada cuidado, esclareça as dúvidas e revise todas as páginas para ativar.</p>}
    </section>}
    {isActive && <p className="small-note"><ShieldCheckIcon size={17} />Plano conferido pelo cuidador. Os registros de rotina não alteram as orientações.</p>}
    {original && <Modal title="Documento original" subtitle="Confira todas as páginas e use o zoom para ler." wide onClose={() => setOriginal(false)}><DocumentViewer document={state.document} /></Modal>}
    {review && <ReviewDialog key={review.id + state.plan.status} item={review} state={state} busy={busy} run={run} onClose={() => setReview(null)} />}
    {adding && <AddCareDialog state={state} busy={busy} run={run} onClose={() => setAdding(false)} />}
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
  const [localError, setLocalError] = useState("");
  const editable = state.role === "caregiver" && state.plan.status === "draft";
  const freshItem = state.plan.items.find((candidate) => candidate.id === item.id) ?? item;
  const dirty = title !== freshItem.title || instruction !== freshItem.instruction || JSON.stringify(fields) !== JSON.stringify(freshItem.fields) || questions !== freshItem.questions.join("\n") || times !== (freshItem.schedule?.times.join(", ") ?? "") || priority !== (freshItem.schedule?.priority ?? "normal") || tolerance !== (freshItem.schedule?.toleranceMinutes ?? 30);
  async function save(event: FormEvent) {
    event.preventDefault(); setLocalError("");
    const parsedTimes = times.split(",").map((time) => time.trim()).filter(Boolean);
    if (parsedTimes.some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) return setLocalError("Use horários no formato 08:00, 14:00.");
    await run({ type: "update_item", itemId: item.id, title, instruction, fields, questions: questions.split("\n").map((q) => q.trim()).filter(Boolean), schedule: { times: parsedTimes, priority, toleranceMinutes: tolerance } }, "Correção salva. Confira e confirme este cuidado.");
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
        {editable && <><p className="small-note" data-parity-anchor="support-note">{dirty ? "Salve suas alterações antes de confirmar." : "Confira todos os campos. Se houver dúvida, mantenha o cuidado pendente."}</p><button type="button" className="button primary" disabled={dirty || busy || freshItem.confirmed} onClick={() => void run({ type: "confirm_item", itemId: item.id }, "Cuidado conferido com a fonte.")}>{freshItem.confirmed ? <><CheckCircleIcon size={20} />Cuidado confirmado</> : <><CheckIcon size={20} />Conferi e confirmo este cuidado</>}</button></>}
        <details className="review-details"><summary>Conferir todos os campos e horários</summary><div className="stack"><label>Nome do cuidado<input value={title} onChange={(event) => setTitle(event.target.value)} required readOnly={!editable} /></label><label>Orientação completa<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={3} required readOnly={!editable} /></label>{fieldEntries.filter(([key]) => key !== primaryField?.[0]).map(renderField)}<fieldset className="stack-sm"><legend>Organização da rotina</legend><p className="small-note">Preserve a frequência prescrita. Os horários abaixo organizam o acompanhamento.</p><label>Horários da rotina<input value={times} onChange={(event) => setTimes(event.target.value)} placeholder="08:00, 14:00" readOnly={!editable} /></label><div className="form-columns"><label>Prioridade<select value={priority} onChange={(event) => setPriority(event.target.value as "normal" | "important")} disabled={!editable}><option value="normal">Normal</option><option value="important">Importante</option></select></label><label>Tolerância em minutos<input type="number" min="0" max="1440" value={tolerance} onChange={(event) => setTolerance(Number(event.target.value))} readOnly={!editable} /></label></div></fieldset></div></details>
      </div>
    </form>
  </Modal>;

}

function AddCareDialog({ state, busy, run, onClose }: { state: CareState; busy: boolean; run: RunAction; onClose: () => void }) {
  const [title, setTitle] = useState(""); const [instruction, setInstruction] = useState(""); const [category, setCategory] = useState<DraftItem["category"]>("other"); const [quote, setQuote] = useState(""); const [page, setPage] = useState("1");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await run({ type: "add_item", item: { id: crypto.randomUUID(), title, instruction, category, fields: {}, questions: [], confirmed: false, source: { documentId: state.document?.id ?? null, page: state.document ? Number(page) : null, quote: quote || instruction } } }, "Cuidado adicionado ao rascunho. Revise antes de confirmar.")) onClose();
  }
  return <Modal title="Adicionar um cuidado" subtitle="Transcreva a orientação recebida sem completar o que não consta." onClose={onClose}><form onSubmit={submit} className="stack"><label>Categoria<select value={category} onChange={(event) => setCategory(event.target.value as DraftItem["category"])}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Nome<input value={title} onChange={(event) => setTitle(event.target.value)} required /></label><label>Orientação completa<textarea rows={4} value={instruction} onChange={(event) => setInstruction(event.target.value)} required /></label><label>Trecho da fonte<textarea rows={3} value={quote} onChange={(event) => setQuote(event.target.value)} placeholder="Copie o trecho ou informe a origem da orientação." required /></label>{state.document && <label>Página<input type="number" min="1" value={page} onChange={(event) => setPage(event.target.value)} required /></label>}<button className="button primary" disabled={busy}><PlusIcon size={20} />Adicionar ao rascunho</button></form></Modal>;
}
function UncertaintyDialog({ question, index, run, busy, onClose }: { question: string; index: number; run: RunAction; busy: boolean; onClose: () => void }) {
  const [explanation, setExplanation] = useState("");
  return <Modal title="Esclarecer dúvida" subtitle={question} onClose={onClose}><form className="stack" onSubmit={async (event) => { event.preventDefault(); if (await run({ type: "resolve_uncertainty", index, explanation }, "Esclarecimento registrado. Confira os cuidados relacionados.")) onClose(); }}><div className="notice"><WarningCircleIcon size={24} /><p>Se a fonte não permite responder, mantenha a dúvida e consulte o profissional responsável.</p></div><label>O que foi esclarecido e qual foi a fonte?<textarea rows={5} value={explanation} onChange={(event) => setExplanation(event.target.value)} minLength={8} required /></label><button className="button primary" disabled={busy}><CheckIcon size={20} />Registrar esclarecimento</button></form></Modal>;
}
