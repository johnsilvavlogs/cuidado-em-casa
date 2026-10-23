"use client";

import { useState, type FormEvent } from "react";
import { ArrowRightIcon, CheckCircleIcon, HandHeartIcon, UsersIcon } from "@phosphor-icons/react";
import type { Role } from "@/lib/contracts";
import { Busy } from "@/components/care-ui";

type AccessMode = "demo" | "register" | "login";
export type AccountCredentials = { name?: string; email: string; password: string };

type Props = {
  busy: boolean;
  error: string | null;
  onRetry?: () => Promise<boolean>;
  onClearError: () => void;
  onDemo: (role: Role) => Promise<boolean>;
  onAuthenticate: (mode: "register" | "login", credentials: AccountCredentials) => Promise<boolean>;
};

export default function AccessPanel({ busy, error, onRetry, onClearError, onDemo, onAuthenticate }: Props) {
  const [mode, setMode] = useState<AccessMode>("demo");
  const [role, setRole] = useState<Role>("patient");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function selectMode(next: AccessMode) {
    setMode(next);
    setPassword("");
    onClearError();
  }

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "demo" || busy) return;
    await onAuthenticate(mode, { ...(mode === "register" ? { name: name.trim() } : {}), email: email.trim(), password });
  }

  return <main id="main-content" className="entry-page">
    <div className="entry-copy"><span className="eyebrow">Cuidado que aproxima</span><h1>Um cuidado<br />de cada vez.</h1><p>Acompanhe o dia de quem você cuida.</p></div>
    <section className="entry-card card" aria-labelledby="access-title">
      <div className="access-heading"><h2 id="access-title">Como quer começar?</h2><p className="muted">Explore uma rotina pronta ou prepare seu plano.</p></div>
      <div className="segmented access-modes" role="group" aria-label="Forma de acesso">
        <button type="button" className={mode === "demo" ? "selected" : ""} aria-pressed={mode === "demo"} disabled={busy} onClick={() => selectMode("demo")}>Ver demonstração</button>
        <button type="button" className={mode !== "demo" ? "selected" : ""} aria-pressed={mode !== "demo"} disabled={busy} onClick={() => selectMode("register")}>Começar do zero</button>
      </div>
      {mode === "demo" ? <>
        <p className="muted access-description">Escolha um perfil. Você pode trocar depois.</p>
        <div className="role-options">
          <button type="button" className={role === "patient" ? "role-option selected" : "role-option"} aria-pressed={role === "patient"} disabled={busy} onClick={() => setRole("patient")}><span className="icon-disc"><HandHeartIcon size={30} /></span><span><strong>Helena · paciente</strong><small>Ver o dia e contar como está</small></span><CheckCircleIcon className="role-check" size={23} /></button>
          <button type="button" className={role === "caregiver" ? "role-option caregiver selected" : "role-option caregiver"} aria-pressed={role === "caregiver"} disabled={busy} onClick={() => setRole("caregiver")}><span className="icon-disc blue"><UsersIcon size={30} /></span><span><strong>Marina · cuidadora</strong><small>Preparar o plano e acompanhar o dia</small></span><CheckCircleIcon className="role-check" size={23} /></button>
        </div>
        {error && <div className="access-error" role="alert"><p className="error-message">{error}</p>{onRetry && <button type="button" className="text-button" disabled={busy} onClick={() => void onRetry()}>Tentar de novo</button>}</div>}
        <button type="button" className="button primary" disabled={busy} onClick={() => void onDemo(role)}>{busy ? <Busy>Iniciando…</Busy> : <>Entrar na demonstração<ArrowRightIcon size={20} /></>}</button>
      </> : <form className="access-form" onSubmit={(event) => void authenticate(event)}>
        <div><h3>{mode === "register" ? "Crie sua conta" : "Entre na sua conta"}</h3><p className="muted access-description">{mode === "register" ? "Crie uma conta de cuidador para preparar o plano." : "Continue de onde parou."}</p></div>
        {mode === "register" && <label htmlFor="access-name">Seu nome<input id="access-name" name="name" autoComplete="name" required maxLength={100} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>}
        <label htmlFor="access-email">E-mail<input id="access-email" name="email" type="email" autoComplete="username" required maxLength={254} value={email} disabled={busy} onChange={(event) => setEmail(event.target.value)} /></label>
        <label htmlFor="access-password">Senha<input id="access-password" name="password" type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} required minLength={8} maxLength={128} aria-describedby={mode === "register" ? "password-hint" : undefined} value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} />{mode === "register" && <span id="password-hint" className="label-hint">Use pelo menos 8 caracteres.</span>}</label>
        {error && <div className="access-error" role="alert"><p className="error-message">{error}</p>{onRetry && <button type="button" className="text-button" disabled={busy} onClick={() => void onRetry()}>Tentar de novo</button>}</div>}
        <button type="submit" className="button primary" disabled={busy}>{busy ? <Busy>{mode === "register" ? "Criando conta…" : "Entrando…"}</Busy> : <>{mode === "register" ? "Criar conta" : "Entrar"}<ArrowRightIcon size={20} /></>}</button>
        <button type="button" className="text-button access-switch" disabled={busy} onClick={() => selectMode(mode === "register" ? "login" : "register")}>{mode === "register" ? "Já tenho uma conta" : "Ainda não tenho uma conta"}</button>
      </form>}
      <p className="small-note access-privacy">Demonstração para avaliação. Use apenas dados fictícios.</p>
    </section>
  </main>;
}
