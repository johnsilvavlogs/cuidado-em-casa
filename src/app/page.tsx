"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowsClockwiseIcon, CalendarDotsIcon, CheckCircleIcon, ClockCounterClockwiseIcon, CopyIcon, FileTextIcon, UsersIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { CareAction, CareState, Role } from "@/lib/contracts";
import AccessPanel, { type AccountCredentials } from "@/components/access-panel";
import DailyCare from "@/components/daily-care";
import PlanPanel from "@/components/plan-panel";
import VoicePanel from "@/components/voice-panel";
import { ActionErrorContext, ActionFeedbackContext, Brand, Busy, EmptyState, firstName, historyDateTimeLabel, historyText, Modal, Portrait, type ActionInput } from "@/components/care-ui";

type Section = "today" | "plan" | "history";
type ApiFailure = { message: string; retry: () => Promise<boolean>; session?: boolean };

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

  const authenticate = useCallback(async (mode: "register" | "login", credentials: AccountCredentials) => {
    const result = await submit(`/api/auth/${mode}`, credentials, "");
    if (result) {
      window.history.replaceState(null, "", "/");
      setSection(stateRef.current?.plan.status === "active" ? "today" : "plan");
      setAccount(false);
    }
    return result;
  }, [submit]);

  const logout = useCallback(async function execute(): Promise<boolean> {
    if (mutating.current) return false;
    mutating.current = true;
    sequence.current += 1;
    setBusy("Saindo…");
    setFailure(null);
    setNotice("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.ok !== true) throw new Error(body?.error ?? "Não foi possível sair. Tente novamente.");
      stateRef.current = null;
      retryableAction.current = null;
      setState(null);
      setAccount(false);
      setVoice(false);
      setSection("today");
      setSyncError(false);
      setCopied(false);
      window.history.replaceState(null, "", "/");
      return true;
    } catch (cause) {
      setFailure({ message: cause instanceof Error ? cause.message : "Não foi possível sair. Tente novamente.", retry: execute });
      return false;
    } finally {
      mutating.current = false;
      setBusy("");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initialize(): Promise<boolean> {
      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        const next = response.ok ? await responseState(response) : null;
        if (!response.ok && response.status !== 401) throw new Error("Não foi possível carregar a sessão. Tente novamente.");
        if (cancelled) return false;
        if (next?.account) {
          receive(next);
          window.history.replaceState(null, "", "/");
          setSection(next.plan.status === "active" ? "today" : "plan");
        } else {
          const params = new URLSearchParams(window.location.search);
          const demo = params.get("demo");
          const role = params.get("role");
          if (demo && (role === "patient" || role === "caregiver")) return await startDemo("ready", role, demo);
          if (next) receive(next);
        }
        setFailure(null);
        return true;
      } catch (cause) {
        if (!cancelled) setFailure({ message: cause instanceof Error ? cause.message : "Falha ao carregar a sessão.", retry: initialize, session: true });
        return false;
      } finally { if (!cancelled) setLoading(false); }
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
        if (currentSequence === sequence.current && !mutating.current && next.demoId === stateRef.current?.demoId) receive(next);
      } catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")) setSyncError(true); }
      finally { polling = false; }
    }
    const interval = window.setInterval(() => void sync(), 2000);
    document.addEventListener("visibilitychange", sync);
    return () => { window.clearInterval(interval); controller.abort(); document.removeEventListener("visibilitychange", sync); };
  }, [state?.demoId, receive]);

  const run = useCallback(async (action: ActionInput, success = "Alteração salva e compartilhada.") => {
    if (mutating.current) return false;
    const fingerprint = JSON.stringify(action.type === "record_task" ? { type: action.type, taskId: action.taskId, status: action.status } : action);
    const request = retryableAction.current?.fingerprint === fingerprint
      ? retryableAction.current.action
      : { ...action, requestId: crypto.randomUUID() } as CareAction;
    retryableAction.current = { fingerprint, action: request };
    const result = await submit("/api/actions", request, success);
    if (result && retryableAction.current?.action === request) retryableAction.current = null;
    return result;
  }, [submit]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const importDocument = useCallback((data: FormData) => submit("/api/import", data, "Leitura concluída. Confira cada cuidado com o original."), [submit]);
  const isCaregiver = state?.role === "caregiver";
  const otherRole = isCaregiver ? "patient" : "caregiver";
  const otherLink = state && !state.account && typeof window !== "undefined" ? `${window.location.origin}/?demo=${encodeURIComponent(state.demoId)}&role=${otherRole}` : "";

  if (loading) return <div className="loading-page"><Brand /><p className="loading-line"><Busy>Preparando seu cuidado…</Busy></p></div>;

  return <ActionErrorContext.Provider value={failure}><ActionFeedbackContext.Provider value={{ busy, notice }}><div className="app-shell">
    <header className="app-header" data-parity-anchor="app-header"><div className="header-brand"><Brand /><span className="badge badge-neutral">{state?.account || !state ? "Ambiente de avaliação" : "Demonstração · dados fictícios"}</span></div>{state && <button className="profile-control" onClick={() => setAccount(true)} aria-label={`Abrir perfil ${state.account ? "de" : "de demonstração de"} ${firstName(state.account?.name ?? (isCaregiver ? state.patient.caregiverName : state.patient.name))}`}>{state.account ? <span className="account-avatar"><span aria-hidden="true">{state.account.name.trim().charAt(0).toLocaleUpperCase("pt-BR")}</span><small>{firstName(state.account.name)}</small></span> : <Portrait name={isCaregiver ? state.patient.caregiverName : state.patient.name} role={state.role} />}</button>}</header>
    {state ? <>
      <div className="app-frame"><nav className="main-nav" aria-label="Navegação principal" data-parity-anchor="navigation"><div className="nav-items"><button aria-current={section === "today" ? "page" : undefined} className={section === "today" ? "active" : ""} onClick={() => setSection("today")}><CalendarDotsIcon size={23} /><span>{isCaregiver ? "Hoje" : "Meu dia"}</span></button><button aria-current={section === "plan" ? "page" : undefined} className={section === "plan" ? "active" : ""} onClick={() => setSection("plan")}><FileTextIcon size={23} /><span>Plano</span>{state.plan.status === "draft" && <span className="nav-mark" />}</button><button aria-current={section === "history" ? "page" : undefined} className={section === "history" ? "active" : ""} onClick={() => setSection("history")}><ClockCounterClockwiseIcon size={23} /><span>Histórico</span></button></div></nav>
      <main id="main-content" className={`main-content section-${section}`}>
        {failure && <div className="feedback error-feedback" role="alert"><WarningCircleIcon size={23} /><span>{failure.message}</span><button className="text-button" disabled={!!busy} onClick={() => void failure.retry()}>Tentar novamente</button></div>}
        {syncError && <div className="feedback error-feedback" role="status"><WarningCircleIcon size={22} /><span>Sem atualização do servidor. Reconecte para salvar ou ver novos registros.</span></div>}
        {(busy || notice) && <div className="action-toast" role="status" aria-live="polite" data-state={busy ? "saving" : "saved"}>{busy ? <Busy>{busy}</Busy> : <><CheckCircleIcon size={18} />{notice}</>}</div>}
        {section === "today" && <DailyCare state={state} run={run} busy={!!busy} onVoice={() => setVoice(true)} onHistory={() => setSection("history")} />}
        {section === "plan" && <PlanPanel state={state} run={run} busy={!!busy} onImport={importDocument} />}
        {section === "history" && <History state={state} />}
      </main></div>
      {account && (state.account ? <Modal title="Sua conta" onClose={() => setAccount(false)}><div className="stack"><div className="notice"><UsersIcon size={25} /><div><strong>{state.account.name} · cuidador</strong><p className="account-email">{state.account.email}</p></div></div><p className="small-note">Seu plano e seus registros ficam nesta conta. Use dados fictícios durante a avaliação.</p><button className="button secondary" disabled={!!busy} onClick={() => void logout()}>{busy ? <Busy>Saindo…</Busy> : "Sair da conta"}</button></div></Modal> : <Modal title="Perfis de demonstração" onClose={() => setAccount(false)}><div className="stack"><div className="notice"><UsersIcon size={25} /><div><strong>{isCaregiver ? state.patient.caregiverName : state.patient.name} · {isCaregiver ? "cuidadora" : "paciente"}</strong><p>Você está explorando um perfil fictício. Esta demonstração não cria uma conta pessoal.</p></div></div><button className="button primary" disabled={!!busy} onClick={() => void startDemo(state.plan.status === "active" ? "ready" : "setup", otherRole, state.demoId)}><ArrowsClockwiseIcon size={20} />Ver demonstração como {isCaregiver ? state.patient.name : state.patient.caregiverName}</button><div className="share-box"><h3>Demonstração em outra sessão</h3><p className="muted">Qualquer pessoa com este link pode acessar a demonstração e seus registros. Use apenas dados e documentos fictícios.</p><label>Link do outro perfil de demonstração<input readOnly value={otherLink} onFocus={(event) => event.target.select()} /></label><button className="button secondary" onClick={async () => { try { await navigator.clipboard.writeText(otherLink); setCopied(true); } catch { setCopied(false); } }}><CopyIcon size={19} />{copied ? "Link copiado" : "Copiar link"}</button></div><div className="divider" /><p className="small-note">Explore uma rotina pronta ou prepare um plano com documentos fictícios.</p><div className="button-row"><button className="button secondary" disabled={!!busy} onClick={() => void startDemo("ready", state.role)}>Explorar rotina de demonstração</button><button className="button secondary" disabled={!!busy} onClick={() => void startDemo("setup", "caregiver")}>Preparar plano de demonstração</button></div><div className="divider" /><button className="button secondary" disabled={!!busy} onClick={() => void logout()}>Sair da demonstração</button></div></Modal>)}

      {voice && <Modal title="Registrar por voz" variant="voice-dialog" onClose={() => setVoice(false)}><VoicePanel state={state} onStateChange={receive} onClose={() => setVoice(false)} /></Modal>}
    </> : <AccessPanel busy={!!busy} error={failure?.message ?? null} onRetry={failure?.session ? failure.retry : undefined} onClearError={() => setFailure(null)} onDemo={(role) => startDemo("ready", role)} onAuthenticate={authenticate} />}
  </div></ActionFeedbackContext.Provider></ActionErrorContext.Provider>;
}

function History({ state }: { state: CareState }) {
  return <div className="stack history-content"><div className="section-heading"><div><p className="eyebrow">Tudo no mesmo lugar</p><h1>Histórico do cuidado</h1><p className="muted">Registros, correções e pedidos de apoio, com autor e horário.</p></div><span className="icon-disc"><ClockCounterClockwiseIcon size={27} /></span></div>{state.timeline.length === 0 ? <EmptyState icon={<ClockCounterClockwiseIcon size={30} />} title="O histórico começa aqui">Os próximos registros e pedidos de ajuda aparecerão nesta lista.</EmptyState> : <ol className="timeline">{state.timeline.map((event) => <li key={event.id}><span className="timeline-icon"><CheckCircleIcon size={19} /></span><article><div className="timeline-meta"><strong>{event.author === "patient" ? state.patient.name : state.patient.caregiverName}</strong><span>Gravado em {historyDateTimeLabel(event.createdAt)}</span></div><p>{historyText(event.text)}</p></article></li>)}</ol>}<p className="small-note">As correções mantêm os registros anteriores para preservar o histórico.</p></div>;
}
