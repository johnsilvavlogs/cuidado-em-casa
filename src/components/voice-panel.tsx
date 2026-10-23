"use client";

import { useEffect, useRef, useState } from "react";
import type { CareAction, CareSessionContext, CareState } from "@/lib/contracts";

import { confirmedVoiceAction, readVoiceCommand, voiceCommandLabel, type VoiceCommand } from "@/lib/voice-command";

export default function VoicePanel({ state, onStateChange, onClose }: { state: CareState; onStateChange: (state: CareState) => void; onClose: () => void }) {
  const [status, setStatus] = useState<"idle" | "connecting" | "listening" | "error">("idle");
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [pending, setPending] = useState<VoiceCommand | null>(null);
  const [saving, setSaving] = useState(false);
  const connection = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const microphone = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const handshakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionReady = useRef(false);
  const acceptedDecisions = useRef(new Set<string>());
  const attempt = useRef(0);
  const pendingRef = useRef<VoiceCommand | null>(null);
  const latestState = useRef(state);
  const pendingSubmission = useRef<{ action: CareAction; context: CareSessionContext } | null>(null);
  useEffect(() => { latestState.current = state; }, [state]);
  useEffect(() => {
    pendingRef.current = pending;
    microphone.current?.getAudioTracks().forEach(track => { track.enabled = !pending; });
  }, [pending]);

  function stop() {
    attempt.current++;
    if (handshakeTimer.current) clearTimeout(handshakeTimer.current);
    microphone.current?.getTracks().forEach(track => track.stop());
    microphone.current = null;
    channel.current?.close(); channel.current = null;
    connection.current?.close(); connection.current = null;
  }
  useEffect(() => () => {
    attempt.current++;
    if (handshakeTimer.current) clearTimeout(handshakeTimer.current);
    microphone.current?.getTracks().forEach(track => track.stop());
    channel.current?.close(); connection.current?.close();
  }, []);

  async function connect() {
    stop();
    const thisAttempt = attempt.current;
    const connectedState = latestState.current;
    const context: CareSessionContext = { demoId: connectedState.demoId, role: connectedState.role };
    setError(""); setStatus("connecting"); sessionReady.current = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("O microfone não está disponível neste navegador. Use os botões da rotina.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (attempt.current !== thisAttempt) { stream.getTracks().forEach(track => track.stop()); return; }
      microphone.current = stream;
      const pc = new RTCPeerConnection(); connection.current = pc;
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      pc.ontrack = event => {
        if (audio.current) {
          audio.current.srcObject = event.streams[0] || new MediaStream([event.track]);
          void audio.current.play().catch(() => setError("Toque no controle de áudio para ouvir a resposta."));
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") { stop(); setStatus("error"); setError("A conexão de voz caiu. Seus registros foram preservados; tente conectar novamente."); }
      };
      const dc = pc.createDataChannel("oai-events"); channel.current = dc;
      dc.onmessage = event => {
        if (connection.current !== pc) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "session.started") { sessionReady.current = true; if (handshakeTimer.current) clearTimeout(handshakeTimer.current); handshakeTimer.current = null; setStatus("listening"); }
          if (message.type === "session.input_transcript.delta" && typeof message.delta === "string") setTranscript(t => t + message.delta);
          if (message.type === "error") { setError("A sessão de voz encontrou um erro. Você pode continuar pelos botões."); setStatus("error"); stop(); }
          const proposed = readVoiceCommand(message, crypto.randomUUID());
          if (proposed && !pendingRef.current && !acceptedDecisions.current.has(proposed.decisionId)) {
            const currentState = latestState.current;
            if (currentState.demoId !== context.demoId || currentState.role !== context.role) {
              stop(); setStatus("error"); setError("A sessão mudou. Feche a voz e atualize a página antes de continuar.");
              return;
            }
            const action = confirmedVoiceAction(proposed, currentState);
            if (!action) setError("Não consegui identificar um único cuidado. Diga o nome e o horário, ou use os botões.");
            else {
              acceptedDecisions.current.add(proposed.decisionId);
              pendingRef.current = proposed;
              pendingSubmission.current = { action, context };
              microphone.current?.getAudioTracks().forEach(track => { track.enabled = false; });
              setPending(proposed);
            }
          }
        } catch { /* Ignore events that are not JSON protocol messages. */ }
      };
      await pc.setLocalDescription(await pc.createOffer());
      if (pc.iceGatheringState !== "complete") await new Promise<void>(resolve => {
        const timeout = window.setTimeout(resolve, 5000);
        pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { window.clearTimeout(timeout); resolve(); } });
      });
      const response = await fetch("/api/voice/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sdp: pc.localDescription?.sdp, context }) });
      const result = await response.json();
      if (attempt.current !== thisAttempt) return;
      if (!response.ok) throw new Error(result.error || "Não foi possível abrir a sessão de voz.");
      if (!result.transport?.sdp) throw new Error("A sessão de voz não retornou uma conexão válida.");
      await pc.setRemoteDescription({ type: "answer", sdp: result.transport.sdp });
      if (!sessionReady.current) handshakeTimer.current = setTimeout(() => {
        stop(); setStatus("error"); setError("A conexão de voz não ficou pronta. Tente novamente ou continue pelos botões.");
      }, 20_000);
    } catch (cause) {
      stop(); setStatus("error");
      setError(cause instanceof Error && cause.name === "NotAllowedError" ? "O microfone não foi autorizado. Você pode permitir o acesso ou usar os botões." : cause instanceof Error ? cause.message : "Não foi possível conectar a voz.");
    }
  }

  const label = pending ? voiceCommandLabel(pending, state) : "";

  async function confirm() {
    if (!pending || saving) return;
    setSaving(true); setError("");
    const submission = pendingSubmission.current;
    if (!submission) { setError("O cuidado não está mais disponível. Feche e confira a rotina."); setSaving(false); return; }
    try {
      const response = await fetch("/api/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submission) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "O registro não foi salvo.");
      onStateChange(result);
      if (channel.current?.readyState === "open" && pending.delegationId) channel.current.send(JSON.stringify({ type: "session.commentary.append", delegation_id: pending.delegationId, content: "A pessoa confirmou na tela. O servidor salvou o registro com sucesso. Informe isso de forma breve, sem acrescentar orientação médica." }));
      pendingSubmission.current = null;
      setPending(null); setTranscript(""); setError("Registro salvo e compartilhado com seu cuidador.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "O registro não foi salvo. Tente novamente."); }
    finally { setSaving(false); }
  }

  return <section className="voice-panel">
    <h2>Registre com a sua voz</h2>
    <p>Diga qual cuidado fez ou não fez, como dormiu ou se conseguiu se alimentar. Você confere antes de salvar.</p>
    <p role="status" aria-live="polite">{pending ? "Microfone pausado. Confira o registro abaixo." : status === "listening" ? "Microfone ligado. Pode falar." : status === "connecting" ? "Conectando a voz…" : "Seu microfone só será ligado ao conectar."}</p>
    {error && <p role={error.startsWith("Registro salvo") ? "status" : "alert"}>{error}</p>}
    {transcript && <blockquote>{transcript}</blockquote>}
    <audio ref={audio} autoPlay controls aria-label="Resposta do assistente de voz" />
    {pending && <div className="voice-confirm"><h3>{label}</h3><button disabled={saving} onClick={confirm}>{saving ? "Salvando…" : "Confirmar registro"}</button><button disabled={saving} onClick={() => { if (channel.current?.readyState === "open" && pending.delegationId) channel.current.send(JSON.stringify({ type: "session.commentary.append", delegation_id: pending.delegationId, content: "A pessoa cancelou a ação na tela. Nada foi alterado." })); setPending(null); }}>Cancelar</button></div>}
    {(status === "idle" || status === "error") && <button onClick={connect}>Conectar microfone</button>}
    <button onClick={() => { stop(); onClose(); }}>Fechar e usar os botões</button>
  </section>;
}
