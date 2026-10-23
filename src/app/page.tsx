"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRightIcon, ArrowsClockwiseIcon, CalendarDotsIcon, CheckCircleIcon, ClockCounterClockwiseIcon, CopyIcon, FileTextIcon, HandHeartIcon, ShieldCheckIcon, UsersIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { CareAction, CareSessionContext, CareState, Role } from "@/lib/contracts";
import DailyCare from "@/components/daily-care";
import PlanPanel from "@/components/plan-panel";
import VoicePanel from "@/components/voice-panel";
import { ActionErrorContext, ActionFeedbackContext, Brand, Busy, EmptyState, firstName, historyDateTimeLabel, historyText, Modal, Portrait, type ActionInput } from "@/components/care-ui";

type Section = "today" | "plan" | "history";
type ApiFailure = { message: string; retry: () => Promise<boolean> };

async function responseState(response: Response): Promise<CareState> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? (response.status === 401 ? "Sua sessão terminou. Entre novamente no cuidado." : "Não foi possível salvar. Confira a conexão e tente novamente."));
  return body as CareState;
}

export default function Home() {
  const [state, setState] = useState<CareState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [notice, setNotice] = useState("");
  const [syncError, setSyncError] = useState(false);
  const [section, setSection] = useState<Section>("today");
  const [account, setAccount] = useState(false);
  const [voice, setVoice] = useState(false);
  const [entryRole, setEntryRole] = useState<Role>("patient");
  const [copied, setCopied] = useState(false);
  const stateRef = useRef<CareState | null>(null);
  const sequence = useRef(0);
  const mutating = useRef(false);
  const retryableAction = useRef<{ fingerprint: string; action: CareAction } | null>(null);

  const receive = useCallback((next: CareState) => {
    stateRef.current = next;
    setState(next);
    setSyncError(false);
  }, []);

  const submit = useCallback(async function execute(endpoint: string, body: FormData | object, success: string): Promise<boolean> {
    if (mutating.current) return false;
    mutating.current = true;
    sequence.current += 1;
    setBusy(endpoint === "/api/import" ? "Lendo documento…" : "Salvando…");
    setFailure(null);
    setNotice("");
    try {
      const response = await fetch(endpoint, { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body), ...(body instanceof FormData ? {} : { headers: { "Content-Type": "application/json" } }) });
      const next = await responseState(response);
      receive(next);
      setNotice(success);
      return true;
    } catch (cause) {
      setFailure({ message: cause instanceof TypeError || !(cause instanceof Error) ? "Não foi possível confirmar se foi salvo. Confira sua conexão com a internet e tente novamente." : cause.message, retry: () => execute(endpoint, body, success) });
      return false;
    } finally {
      mutating.current = false;
      setBusy("");
    }
  }, [receive]);

  const startDemo = useCallback(async (scenario: "ready" | "setup", role: Role, demoId?: string) => {
    const result = await submit("/api/demo", { scenario, role, ...(demoId ? { demoId } : {}) }, "");
    if (result) {
      const next = stateRef.current;
      if (next) window.history.replaceState(null, "", `/?demo=${encodeURIComponent(next.demoId)}&role=${next.role}`);
      setSection(scenario === "setup" ? "plan" : "today");
      setAccount(false);
    }
    return result;
  }, [submit]);

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const params = new URLSearchParams(window.location.search);
        const demo = params.get("demo");
        const role = params.get("role");
        if (demo && (role === "patient" || role === "caregiver")) {
          if (!cancelled) await startDemo("ready", role, demo);
        } else {
          const response = await fetch("/api/state", { cache: "no-store" });
          if (response.ok) { const next = await responseState(response); if (!cancelled) receive(next); }
          else if (response.status !== 401) throw new Error("Não foi possível carregar a sessão. Tente iniciar novamente.");
        }
      } catch (cause) { if (!cancelled) setFailure({ message: cause instanceof Error ? cause.message : "Falha ao carregar a sessão.", retry: () => startDemo("ready", "patient") }); }
      finally { if (!cancelled) setLoading(false); }
    }
    void initialize();
    return () => { cancelled = true; };
  }, [receive, startDemo]);

  useEffect(() => {
    if (!state?.demoId) return;
    const controller = new AbortController();
    let polling = false;
    async function sync() {
      if (document.hidden || mutating.current || polling) return;
      polling = true;
      const currentSequence = sequence.current;
      try {
        const response = await fetch("/api/state", { cache: "no-store", signal: controller.signal });
        const next = await responseState(response);
        if (currentSequence === sequence.current && !mutating.current && next.demoId === stateRef.current?.demoId && next.role === stateRef.current?.role) receive(next);
      } catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")) setSyncError(true); }
      finally { polling = false; }
    }
    const interval = window.setInterval(() => void sync(), 2000);
    document.addEventListener("visibilitychange", sync);
    return () => { window.clearInterval(interval); controller.abort(); document.removeEventListener("visibilitychange", sync); };
  }, [state?.demoId, receive]);

  const run = useCallback(async (action: ActionInput, success = "Alteração salva e compartilhada.") => {
    if (mutating.current || !stateRef.current) return false;
    const context: CareSessionContext = { demoId: stateRef.current.demoId, role: stateRef.current.role };
    const fingerprint = JSON.stringify({ context, action: action.type === "record_task" ? { type: action.type, taskId: action.taskId, status: action.status } : action });
    const request = retryableAction.current?.fingerprint === fingerprint
      ? retryableAction.current.action
      : { ...action, requestId: crypto.randomUUID() } as CareAction;
    retryableAction.current = { fingerprint, action: request };
    const result = await submit("/api/actions", { context, action: request }, success);
    if (result && retryableAction.current?.action === request) retryableAction.current = null;
    return result;
  }, [submit]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const importDocument = useCallback((data: FormData) => {
    if (!stateRef.current) return Promise.resolve(false);
    data.set("context", JSON.stringify({ demoId: stateRef.current.demoId, role: stateRef.current.role }));
    return submit("/api/import", data, "Leitura concluída. Confira cada cuidado com o original.");
  }, [submit]);
  const isCaregiver = state?.role === "caregiver";
  const otherRole = isCaregiver ? "patient" : "caregiver";
  const otherLink = state && typeof window !== "undefined" ? `${window.location.origin}/?demo=${encodeURIComponent(state.demoId)}&role=${otherRole}` : "";

  if (loading) return <div className="loading-page"><Brand /><p className="loading-line"><Busy>Preparando seu cuidado…</Busy></p></div>;

  return <ActionErrorContext.Provider value={failure}><ActionFeedbackContext.Provider value={{ busy, notice, actionId: sequence.current }}><div className="app-shell">
    <header className="app-header" data-parity-anchor="app-header"><Brand />{state && <button className="profile-control" onClick={() => setAccount(true)} aria-label={`Abrir perfil de ${firstName(isCaregiver ? state.patient.caregiverName : state.patient.name)}`}><Portrait name={isCaregiver ? state.patient.caregiverName : state.patient.name} role={state.role} /></button>}</header>
    {state ? <>
      <div className="app-frame"><nav className="main-nav" aria-label="Navegação principal" data-parity-anchor="navigation"><div className="nav-items"><button aria-current={section === "today" ? "page" : undefined} className={section === "today" ? "active" : ""} onClick={() => setSection("today")}><CalendarDotsIcon size={23} /><span>{isCaregiver ? "Hoje" : "Meu dia"}</span></button><button aria-current={section === "plan" ? "page" : undefined} className={section === "plan" ? "active" : ""} onClick={() => setSection("plan")}><FileTextIcon size={23} /><span>Plano</span>{state.plan.status === "draft" && <span className="nav-mark" />}</button><button aria-current={section === "history" ? "page" : undefined} className={section === "history" ? "active" : ""} onClick={() => setSection("history")}><ClockCounterClockwiseIcon size={23} /><span>Histórico</span></button></div></nav>
      <main id="main-content" className={`main-content section-${section}`}>
        {failure && <div className="feedback error-feedback" role="alert"><WarningCircleIcon size={23} /><span>{failure.message}</span><button className="text-button" disabled={!!busy} onClick={() => void failure.retry()}>Tentar novamente</button></div>}
        {syncError && <div className="feedback error-feedback" role="status"><WarningCircleIcon size={22} /><span>Sem atualização do servidor. Última atualização confirmada: <time dateTime={state.updatedAt}>{historyDateTimeLabel(state.updatedAt)}</time> (Brasília). Reconecte para salvar ou ver novos registros.</span></div>}
        {(busy || notice) && <div className="action-toast" role="status" aria-live="polite" data-state={busy ? "saving" : "saved"}>{busy ? <Busy>{busy}</Busy> : <><CheckCircleIcon size={18} />{notice}</>}</div>}
        {section === "today" && <DailyCare state={state} run={run} busy={!!busy} onVoice={() => setVoice(true)} onHistory={() => setSection("history")} />}
        {section === "plan" && <PlanPanel state={state} run={run} busy={!!busy} onImport={importDocument} />}
        {section === "history" && <History state={state} />}
      </main></div>
      {account && <Modal title="Perfis de demonstração" onClose={() => setAccount(false)}><div className="stack"><div className="notice"><UsersIcon size={25} /><div><strong>{isCaregiver ? state.patient.caregiverName : state.patient.name} · {isCaregiver ? "cuidadora" : "paciente"}</strong><p>Você está explorando um perfil fictício. Esta demonstração não cria uma conta pessoal.</p></div></div><button className="button primary" disabled={!!busy} onClick={() => void startDemo(state.plan.status === "active" ? "ready" : "setup", otherRole, state.demoId)}><ArrowsClockwiseIcon size={20} />Ver demonstração como {isCaregiver ? state.patient.name : state.patient.caregiverName}</button><div className="share-box"><h3>Demonstração em outra sessão</h3><p className="muted">Qualquer pessoa com este link pode acessar a demonstração e seus registros. Use apenas dados e documentos fictícios.</p><label>Link do outro perfil de demonstração<input readOnly value={otherLink} onFocus={(event) => event.target.select()} /></label><button className="button secondary" onClick={async () => { try { await navigator.clipboard.writeText(otherLink); setCopied(true); } catch { setCopied(false); } }}><CopyIcon size={19} />{copied ? "Link copiado" : "Copiar link"}</button></div><div className="divider" /><p className="small-note">Explore uma rotina pronta ou prepare um plano com documentos fictícios.</p><div className="button-row"><button className="button secondary" disabled={!!busy} onClick={() => void startDemo("ready", state.role)}>Explorar rotina de demonstração</button><button className="button secondary" disabled={!!busy} onClick={() => void startDemo("setup", "caregiver")}>Preparar plano de demonstração</button></div></div></Modal>}
      {voice && <Modal title="Registrar por voz" variant="voice-dialog" onClose={() => setVoice(false)}><VoicePanel state={state} onStateChange={receive} onClose={() => setVoice(false)} /></Modal>}
    </> : <main className="entry-page"><div className="entry-copy"><span className="eyebrow">Cuidado que aproxima</span><h1>Conheça uma rotina<br />de demonstração.</h1><p>Explore o dia de Helena ou acompanhe o cuidado como Marina, em uma demonstração com dados fictícios.</p><div className="entry-promise"><ShieldCheckIcon size={21} />Orientações conferidas. Registros compartilhados.</div></div><section className="entry-card card"><h2>Escolha um perfil fictício</h2><p className="muted">Veja a demonstração como paciente ou cuidadora.</p><div className="role-options"><button className={entryRole === "patient" ? "role-option selected" : "role-option"} aria-pressed={entryRole === "patient"} onClick={() => setEntryRole("patient")}><span className="icon-disc"><HandHeartIcon size={32} /></span><span><strong>Helena · paciente</strong><small>Ver o dia e registrar a rotina</small></span><CheckCircleIcon className="role-check" size={23} /></button><button className={entryRole === "caregiver" ? "role-option caregiver selected" : "role-option caregiver"} aria-pressed={entryRole === "caregiver"} onClick={() => setEntryRole("caregiver")}><span className="icon-disc blue"><UsersIcon size={32} /></span><span><strong>Marina · cuidadora</strong><small>Preparar o plano e acompanhar</small></span><CheckCircleIcon className="role-check" size={23} /></button></div>{failure && <p className="error-message" role="alert">{failure.message}</p>}<button className="button primary" disabled={!!busy} onClick={() => void startDemo("ready", entryRole)}>{busy ? <Busy>Iniciando…</Busy> : <>Explorar rotina de demonstração<ArrowRightIcon size={20} /></>}</button><button className="button secondary" disabled={!!busy} onClick={() => void startDemo("setup", "caregiver")}><FileTextIcon size={20} />Preparar plano de demonstração</button><p className="small-note">Esta demonstração não cria uma conta pessoal. Use apenas dados e documentos fictícios.</p></section></main>}
  </div></ActionFeedbackContext.Provider></ActionErrorContext.Provider>;
}

function History({ state }: { state: CareState }) {
  return <div className="stack history-content"><div className="section-heading"><div><p className="eyebrow">Tudo no mesmo lugar</p><h1>Histórico do cuidado</h1><p className="muted">Registros, correções e pedidos de apoio, com autor e horário.</p></div><span className="icon-disc"><ClockCounterClockwiseIcon size={27} /></span></div>{state.timeline.length === 0 ? <EmptyState icon={<ClockCounterClockwiseIcon size={30} />} title="O histórico começa aqui">Os próximos registros e pedidos de ajuda aparecerão nesta lista.</EmptyState> : <ol className="timeline">{state.timeline.map((event) => <li key={event.id}><span className="timeline-icon"><CheckCircleIcon size={19} /></span><article><div className="timeline-meta"><strong>{event.author === "patient" ? state.patient.name : state.patient.caregiverName}</strong><span>Gravado em {historyDateTimeLabel(event.createdAt)}</span></div><p>{historyText(event.text)}</p></article></li>)}</ol>}<p className="small-note">As correções mantêm os registros anteriores para preservar o histórico.</p></div>;
}
