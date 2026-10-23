"use client";

import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from "react";
import Image from "next/image";
import { XIcon, HandHeartIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import type { CareAction, CareState } from "@/lib/contracts";

export function careText(text: string): string {
  return text.replace(/\s*\(fictício\)/gi, "").replaceAll("Exemplo fictício, sem uso real.", "").trim();
}
export const firstName = (name: string) => name.trim().split(/\s+/)[0];
export function Portrait({ name, role }: { name: string; role: "patient" | "caregiver" }) {
  return <span className="portrait" data-parity-anchor="identity"><Image src={role === "caregiver" ? "/images/marina-avatar.png" : "/images/helena-avatar.png"} alt="" width={72} height={72} priority /><span>{firstName(name)}</span></span>;
}

export const ActionErrorContext = createContext<{ message: string; retry: () => Promise<boolean> } | null>(null);
export const ActionFeedbackContext = createContext({ busy: "", notice: "" });

export type ActionInput = CareAction extends infer T ? T extends CareAction ? Omit<T, "requestId"> : never : never;
export type RunAction = (action: ActionInput, message?: string) => Promise<boolean>;
export const timeLabel = (date: string) => new Date(date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
export const dateLabel = (date: string) => new Date(date).toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
export const todayString = () => new Date().toLocaleDateString("en-CA");
export const roleLabel = (state: CareState) => state.role === "patient" ? state.patient.name : state.patient.caregiverName;
export const sleepLabel = (minutes: number | null) => minutes === null ? "Sono não informado" : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
export const foodLabels = { yes: "Conseguiu se alimentar", partial: "Alimentou-se em parte", no: "Ainda não se alimentou" };
export const moodLabels = { good: "Sentindo-se bem", okay: "Sentindo-se mais ou menos", bad: "Não está se sentindo bem" };
export const sleepQualityLabels = { low: "Relatou pouco sono", okay: "Relatou sono suficiente", high: "Relatou muito sono" };
export const categoryLabels = { medication: "Medicamento", activity: "Atividade", nutrition: "Alimentação", other: "Outro cuidado" };
export const fieldLabels: Record<string, string> = { nome: "Nome", concentracao: "Concentração", via: "Via", frequencia: "Frequência", duracao: "Duração", condicoes: "Condições", horario: "Horário na fonte", inicio: "Início", local: "Local", lateralidade: "Lateralidade", retorno: "Retorno", name: "Nome", medication: "Medicamento", concentration: "Concentração", dose: "Dose", route: "Via", frequency: "Frequência", duration: "Duração", conditions: "Condições", schedule: "Horário na fonte", time: "Horário na fonte", quantity: "Quantidade", notes: "Observações" };
export const readingLabels = { readable: "Legível", missing: "Não consta na fonte", ambiguous: "Leitura ambígua", illegible: "Ilegível" };

export function Brand() {
  return <div className="brand"><HandHeartIcon size={33} weight="regular" aria-hidden="true" /><span>Cuidado em Casa</span></div>;
}

export function Busy({ children = "Salvando…" }: { children?: ReactNode }) {
  return <><SpinnerGapIcon className="spin" size={20} aria-hidden="true" />{children}</>;
}

export function Modal({ title, subtitle, children, onClose, wide = false, variant = "", headerContent, headingContent }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean; variant?: string; headerContent?: ReactNode; headingContent?: ReactNode }) {
  const id = useId();
  const error = useContext(ActionErrorContext);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => { element.close(); opener?.focus(); };
  }, []);
  return <dialog ref={dialog} className={`modal ${wide ? "modal-wide" : ""} ${variant}`} data-parity-screen={variant || undefined} aria-labelledby={id} onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    {headerContent}
    <div className="modal-header" data-parity-anchor="heading-group"><div>{headingContent ? <><h2 id={id} data-parity-anchor="heading-type">{title}</h2>{headingContent}</> : <><h2 id={id} data-parity-anchor="heading-type">{title}</h2>{subtitle && <p className="muted">{subtitle}</p>}</>}</div><button className="icon-button" aria-label="Fechar" onClick={onClose}><XIcon size={24} /></button></div>
    {error && <div className="error-message modal-error" role="alert"><p>{error.message}</p><button className="button secondary compact" onClick={() => void error.retry()}>Tentar novamente</button></div>}
    {children}
  </dialog>;
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <div className="empty-state"><span className="icon-disc">{icon}</span><h3>{title}</h3><p className="muted">{children}</p></div>;
}
