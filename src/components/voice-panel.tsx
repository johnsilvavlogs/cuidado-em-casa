"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { MicrophoneIcon, WaveformIcon, CheckIcon, LockSimpleIcon, SpeakerHighIcon, SpeakerSlashIcon, StopIcon, WarningCircleIcon, CircleNotchIcon, CalendarBlankIcon, PersonSimpleWalkIcon, HandHeartIcon } from "@phosphor-icons/react";
import { firstName } from "./care-ui";
import type { CareAction, CareSessionContext, CareState } from "@/lib/contracts";

import { confirmedVoiceAction, readVoiceCommand, voiceCommandLabel, type VoiceCommand } from "@/lib/voice-command";
import { buildVoiceContextUpdates } from "@/lib/voice-context";

export default function VoicePanel({ state, onStateChange, onClose }: { state: CareState; onStateChange: (state: CareState) => void; onClose: () => void }) {
  const [status, setStatus] = useState<"idle" | "connecting" | "listening" | "error">("idle");
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [pending, setPending] = useState<VoiceCommand | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const saveRequest = useRef<{ decisionId: string; body: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [savedCommand, setSavedCommand] = useState<VoiceCommand | null>(null);
  const [muted, setMuted] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [interpreting, setInterpreting] = useState(false);
  const connection = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const microphone = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const handshakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionReady = useRef(false);
  const acceptedDecisions = useRef(new Set<string>());
  const proposalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestTranscript = useRef({ id: "", receivedAt: 0 });
  const dismissedTranscript = useRef("");
  const savedRef = useRef(false);
  const sentRevision = useRef<number | null>(null);
  const interpretationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interpretationAbort = useRef<AbortController | null>(null);
  const interpretationSequence = useRef(0);
  const attempt = useRef(0);
  const pendingRef = useRef<VoiceCommand | null>(null);
  const latestState = useRef(state);
  const pendingSubmission = useRef<{ action: CareAction; context: CareSessionContext } | null>(null);
  useEffect(() => { latestState.current = state; }, [state]);
  useEffect(() => {
    if (sessionReady.current && channel.current?.readyState === "open" && sentRevision.current !== state.revision) {
      for (const content of buildVoiceContextUpdates(state)) channel.current.send(JSON.stringify({ type: "session.instructions.append", delegation_id: null, content }));
      sentRevision.current = state.revision;
    }
  }, [state]);
  useEffect(() => {
    pendingRef.current = pending;
    microphone.current?.getAudioTracks().forEach(track => { track.enabled = !pending && !saved; });
  }, [pending, saved]);

  function stop() {
    attempt.current++;
    if (handshakeTimer.current) clearTimeout(handshakeTimer.current);
    if (proposalTimer.current) clearTimeout(proposalTimer.current);
    if (interpretationTimer.current) clearTimeout(interpretationTimer.current);
    interpretationAbort.current?.abort(); interpretationSequence.current++;
    microphone.current?.getTracks().forEach(track => track.stop());
    microphone.current = null;
    channel.current?.close(); channel.current = null;
    connection.current?.close(); connection.current = null;
  }
  useEffect(() => () => {
    attempt.current++;
    if (handshakeTimer.current) clearTimeout(handshakeTimer.current);
    if (proposalTimer.current) clearTimeout(proposalTimer.current);
    if (interpretationTimer.current) clearTimeout(interpretationTimer.current);
    interpretationAbort.current?.abort(); interpretationSequence.current++;
    microphone.current?.getTracks().forEach(track => track.stop());
    channel.current?.close(); connection.current?.close();
  }, []);

  async function connect() {
    stop();
    const thisAttempt = attempt.current;
    const context: CareSessionContext = { demoId: latestState.current.demoId, role: latestState.current.role };
    pendingSubmission.current = null;
    setError(""); setSaveFailed(false); saveRequest.current = null; setSaved(false); savedRef.current = false; setTranscript(""); setInterpreting(false); setStatus("connecting"); sessionReady.current = false;
    latestTranscript.current = { id: "", receivedAt: 0 }; dismissedTranscript.current = "";
    acceptedDecisions.current.clear();
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
          setAudioReady(true);
          void audio.current.play().catch(() => setPlaybackBlocked(true));
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") { stop(); setStatus("error"); setError("A conexão de voz caiu. Seus registros foram preservados; tente conectar novamente."); }
      };
      const dc = pc.createDataChannel("oai-events"); channel.current = dc;
      function prepareSubmission(proposed: VoiceCommand): CareAction | null {
        const current = latestState.current;
        if (current.demoId !== context.demoId || current.role !== context.role) {
          stop(); setStatus("error"); setError("A sessão mudou. Feche a voz e atualize a página antes de continuar.");
          return null;
        }
        const action = confirmedVoiceAction(proposed, current);
        if (action) pendingSubmission.current = { action, context };
        return action;
      }
      let utterance = "";
      let assistantContext = "";
      async function interpretUtterance(sequence: number) {
        const text = utterance.trim().slice(-6000);
        if (!text || pendingRef.current || savedRef.current || connection.current !== pc) return;
        const controller = new AbortController(); interpretationAbort.current = controller;
        setInterpreting(true);
        try {
          const response = await fetch("/api/voice/interpret", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: text, assistantContext: assistantContext.slice(-6000), context }), signal: controller.signal });
          const message = await response.json();
          if (!response.ok) throw new Error(message.error || "Não consegui preparar o registro. Faça uma pausa e diga novamente, ou use os botões.");
          if (sequence !== interpretationSequence.current || pendingRef.current || savedRef.current || connection.current !== pc) return;
          const proposed = readVoiceCommand(message, crypto.randomUUID());
          if (proposed && prepareSubmission(proposed)) {
            if (proposalTimer.current) clearTimeout(proposalTimer.current);
            pendingRef.current = proposed;
            microphone.current?.getAudioTracks().forEach(track => { track.enabled = false; });
            setPending(proposed); setError(""); utterance = "";
            if (dc.readyState === "open") dc.send(JSON.stringify({ type: "session.commentary.append", delegation_id: null, content: `A aplicação exibiu o cartão: ${voiceCommandLabel(proposed, latestState.current)}. Peça para conferir e tocar em Confirmar registro. Nada foi salvo.` }));
          }
        } catch (cause) {
          if (!controller.signal.aborted && sequence === interpretationSequence.current) setError(cause instanceof Error ? cause.message : "Não consegui preparar o registro.");
        } finally { if (sequence === interpretationSequence.current) setInterpreting(false); }
      }
      function scheduleInterpretation(delay: number) {
        if (interpretationTimer.current) clearTimeout(interpretationTimer.current);
        interpretationAbort.current?.abort();
        const sequence = ++interpretationSequence.current;
        interpretationTimer.current = setTimeout(() => void interpretUtterance(sequence), delay);
      }
      dc.onmessage = event => {
        if (connection.current !== pc) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "session.started") {
            sessionReady.current = true;
            if (handshakeTimer.current) clearTimeout(handshakeTimer.current);
            handshakeTimer.current = null;
            sentRevision.current = latestState.current.revision;
            for (const content of buildVoiceContextUpdates(latestState.current)) dc.send(JSON.stringify({ type: "session.instructions.append", delegation_id: null, content }));
            setStatus("listening");
          }
          if (message.type === "session.input_transcript.delta" && typeof message.delta === "string" && !savedRef.current && !pendingRef.current) {
            utterance = (utterance + message.delta).slice(-6000);
            latestTranscript.current = { id: message.event_id, receivedAt: Date.now() };
            if (proposalTimer.current) clearTimeout(proposalTimer.current);
            // An in-flight fragment may correct a previous phrase. Wait for its own decision.
            pendingRef.current = null; setPending(null);
            setTranscript(t => t + message.delta);
            scheduleInterpretation(900);
          }
          if (message.type === "session.output_transcript.delta" && typeof message.delta === "string") {
            assistantContext = (assistantContext + message.delta).slice(-6000);
          }
          if (message.type === "error") { setError("A sessão de voz encontrou um erro. Você pode continuar pelos botões."); setStatus("error"); stop(); }
          // Only patient-transcript triggers may create a proposal. Delegation or assistant
          // speech is not evidence that the patient performed a care task.
          if (message.type === "decision.event" && message.source_event_type === "session.input_transcript.delta"
            && message.source_event_id === latestTranscript.current.id && !savedRef.current
            && message.source_event_id !== dismissedTranscript.current) {
            if (proposalTimer.current) clearTimeout(proposalTimer.current);
            const proposed = readVoiceCommand(message, crypto.randomUUID());
            if (proposed && !pendingRef.current && !acceptedDecisions.current.has(proposed.decisionId)) {
              // Do not freeze the microphone in the middle of a sentence (e.g. "fiz... não, não fiz").
              const quietTime = Math.max(0, 1200 - (Date.now() - latestTranscript.current.receivedAt));
              proposalTimer.current = setTimeout(() => {
                if (connection.current !== pc || savedRef.current || pendingRef.current
                  || message.source_event_id !== latestTranscript.current.id) return;
                const action = prepareSubmission(proposed);
                if (!action) setError("Não consegui identificar um único cuidado. Diga o nome e o horário, ou use os botões.");
                else {
                  acceptedDecisions.current.add(proposed.decisionId);
                  pendingRef.current = proposed;
                  microphone.current?.getAudioTracks().forEach(track => { track.enabled = false; });
                  setPending(proposed);
                  utterance = "";
                  if (interpretationTimer.current) clearTimeout(interpretationTimer.current);
                  interpretationAbort.current?.abort(); interpretationSequence.current++;
                  if (dc.readyState === "open") dc.send(JSON.stringify({ type: "session.commentary.append", delegation_id: null, content: `A aplicação exibiu o cartão: ${voiceCommandLabel(proposed, latestState.current)} O microfone está pausado. Peça brevemente para conferir e tocar em Confirmar registro ou Corrigir. Nada foi salvo ainda.` }));
                }
              }, quietTime);
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
    setSaving(true); setSaveFailed(false); setError("");
    const submission = pendingSubmission.current;
    if (!submission) { setError("O cuidado não está mais disponível. Feche e confira a rotina."); setSaving(false); return; }
    if (saveRequest.current?.decisionId !== pending.decisionId) {
      saveRequest.current = { decisionId: pending.decisionId, body: JSON.stringify(submission) };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: saveRequest.current.body, signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "O registro não foi salvo.");
      onStateChange(result);
      savedRef.current = true; pendingRef.current = null; pendingSubmission.current = null;
      setSavedCommand(pending); setSaved(true); setPending(null); setTranscript(""); setError("");
      try {
        if (channel.current?.readyState === "open") channel.current.send(JSON.stringify({ type: "session.commentary.append", delegation_id: pending.delegationId, content: "A pessoa confirmou na tela. O servidor salvou o registro. Informe isso de forma breve, sem acrescentar orientação médica." }));
      } catch { /* The persisted server result remains authoritative if voice disconnects. */ }
    } catch (cause) {
      setSaveFailed(true);
      const networkFailure = controller.signal.aborted || cause instanceof TypeError || cause instanceof SyntaxError;
      setError(networkFailure || !(cause instanceof Error) ? "Não recebi a confirmação. Tente salvar de novo." : cause.message);
    } finally { clearTimeout(timeout); setSaving(false); }
  }

  const active = status === "listening" && !pending && !saved;
  const mode = pending ? "confirming" : saved ? "saved" : status;
  const recordCommand = pending ?? savedCommand;
  const task = state.tasks.find(item => item.id === recordCommand?.taskId);
  const taskItem = state.plan.items.find(item => item.id === task?.itemId);
  const isFood = recordCommand?.action.startsWith("food_");
  const isSleep = recordCommand?.action.startsWith("sleep_");
  const summaryTitle = task?.title || (isSleep ? "Seu sono" : isFood ? "Sua alimentação" : "Pedido de apoio");
  const summaryValue = recordCommand?.action === "mark_done" ? "Realizado" : recordCommand?.action === "mark_not_done" ? "Não realizado" : recordCommand?.action === "sleep_low" ? "Dormiu pouco" : recordCommand?.action === "sleep_high" ? "Dormiu muito" : recordCommand?.action === "sleep_okay" ? "Sono suficiente" : recordCommand?.action === "food_yes" ? "Conseguiu se alimentar" : recordCommand?.action === "food_partial" ? "Alimentou-se em parte" : recordCommand?.action === "food_no" ? "Ainda não se alimentou" : "Pedir ajuda";
  const headline = pending ? "É isso mesmo?" : saved ? "Registro salvo." : status === "error" ? "Vamos tentar de novo?" : active ? "Estou ouvindo…" : status === "connecting" ? "Preparando para ouvir…" : `Pode falar, ${firstName(state.patient.name)}.`;
  const statusText = saving ? "Salvando…" : pending ? "Confira o registro" : saved ? "Concluído" : status === "connecting" ? "Conectando microfone" : active ? "Microfone ligado" : "Microfone desligado";
  function correct() {
    dismissedTranscript.current = latestTranscript.current.id;
    pendingRef.current = null; pendingSubmission.current = null;
    if (channel.current?.readyState === "open") channel.current.send(JSON.stringify({ type: "session.commentary.append", delegation_id: pending?.delegationId ?? null, content: "A pessoa cancelou a proposta na tela para dizer novamente. Nada foi salvo. Aguarde o novo relato." }));
    setPending(null); setTranscript(""); setError(""); setSaveFailed(false); saveRequest.current = null;
  }
  async function playback() {
    if (playbackBlocked) {
      try { await audio.current?.play(); setPlaybackBlocked(false); } catch { setError("O áudio ainda não pôde tocar. Você pode acompanhar o registro pela tela."); }
    } else setMuted(value => !value);
  }

  return <section className="voice-panel" data-voice-state={mode} aria-busy={saving}>
    <div className={`voice-status ${active ? "is-live" : ""}`} role="status" aria-live="polite"><span aria-hidden="true" />{statusText}</div>
    <div className={`voice-orb ${active ? "is-listening" : ""}`} aria-hidden="true">
      {pending || saved ? <CheckIcon weight="bold" /> : status === "connecting" ? <CircleNotchIcon className="spin" /> : status === "error" ? <WarningCircleIcon /> : active ? <WaveformIcon weight="bold" /> : <Image src="/images/voice-microphone.png" alt="" width={144} height={144} priority />}
    </div>
    <h2>{headline}</h2>
    <p className="voice-description" aria-live="polite">{pending ? "Confira se está certo." : saved ? "Seu cuidador já pode ver este registro." : status === "error" ? "Você pode tentar novamente ou continuar pelos botões." : active && interpreting ? "Conferindo seu relato para preparar o registro…" : active ? "Conte o que você fez ou como está se sentindo." : status === "connecting" ? "Permita o microfone quando o navegador pedir." : "Conte o que você fez ou como está se sentindo."}</p>
    {error && <p className="voice-error" role="alert">{error}</p>}
    <audio ref={audio} autoPlay playsInline muted={muted} hidden aria-hidden="true" />

    {(pending || saved) ? <div className="voice-record" aria-label={pending ? label : "Registro salvo"}>
      <div className="voice-record-heading">{taskItem?.category === "activity" ? <PersonSimpleWalkIcon size={48} aria-hidden="true" /> : recordCommand?.action === "request_help" ? <HandHeartIcon size={48} aria-hidden="true" /> : <Image src={`/images/voice-${isSleep ? "sleep" : isFood || taskItem?.category === "nutrition" ? "meal" : "medicine"}.png`} alt="" width={48} height={48} />}<div><small>{isSleep ? "SONO" : isFood ? "ALIMENTAÇÃO" : taskItem?.category === "medication" ? "MEDICAMENTO" : "CUIDADO"}</small><h3>{summaryTitle}</h3></div></div>
      <div className="voice-record-detail"><span><CalendarBlankIcon size={20} />Hoje{task ? `, ${task.time}` : ""}</span><strong><CheckIcon size={18} />{summaryValue}</strong></div>
    </div> : active ? <div className="voice-transcript" aria-live="polite">{transcript ? <blockquote>“{transcript}”</blockquote> : <p>Estou aqui. Pode começar a falar.</p>}</div> : !saved && status !== "connecting" && status !== "error" ? <div className="voice-examples"><p>Você pode dizer</p><div>{[{image:"medicine",text:"Tomei meu remédio"},{image:"sleep",text:"Dormi pouco"},{image:"meal",text:"Já almocei"}].map(example=><div className="voice-example" key={example.image}><Image src={`/images/voice-${example.image}.png`} alt="" width={32} height={32} /><span>{example.text}</span></div>)}</div></div> : null}

    <div className="voice-actions">
      {pending ? <><button className="button primary" disabled={saving} onClick={confirm}>{saving ? <><CircleNotchIcon className="spin" size={20}/>Salvando…</> : saveFailed ? "Tentar salvar de novo" : "Confirmar registro"}</button><button className="button secondary" disabled={saving} onClick={correct}>Corrigir</button></> : saved ? <><p className="sr-only" role="status">Registro salvo e compartilhado com seu cuidador.</p><button className="button primary" onClick={connect}>Registrar outra coisa</button><button className="button secondary" onClick={()=>{stop();onClose();}}>Voltar para meu dia</button></> : active ? <div className="voice-live-controls"><button onClick={playback} disabled={!audioReady}><span>{muted ? <SpeakerSlashIcon size={24}/> : <SpeakerHighIcon size={24}/>}</span>{playbackBlocked ? "Ouvir resposta" : muted ? "Ativar som" : "Silenciar"}</button><button onClick={()=>{stop();setStatus("idle");setTranscript("");}}><span><StopIcon size={23} weight="fill"/></span>Parar de ouvir</button></div> : <><button className="button primary" onClick={connect} disabled={status === "connecting"}>{status === "connecting" ? <><CircleNotchIcon className="spin" size={20}/>Conectando…</> : <><MicrophoneIcon size={22}/>{status === "error" ? "Tentar novamente" : "Começar a falar"}</>}</button><button className="button secondary" onClick={()=>{stop();onClose();}}>Prefiro usar os botões</button></>}
    </div>
    <p className="voice-privacy"><LockSimpleIcon size={18}/>{saveFailed ? "Tente novamente para confirmar o registro." : pending ? "Só será salvo quando você confirmar." : saved ? "Registro disponível no seu histórico." : "Você confere antes de salvar."}</p>
  </section>;
}
