import type { CareAction, CareState } from "./contracts";

export type VoiceCommand = { action: string; taskId: string; delegationId: string | null; decisionId: string; requestId: string };
const supported = new Set(["mark_done", "mark_not_done", "request_help", "sleep_low", "sleep_okay", "sleep_high", "food_yes", "food_partial", "food_no"]);

/** A completed decision proposes a change. Only an explicit confirmation may submit it. */
export function readVoiceCommand(message: unknown, requestId: string): VoiceCommand | null {
  if (!message || typeof message !== "object") return null;
  const value = message as { type?: string; event_id?: string; delegation_id?: string; event?: { type?: string; decision?: { id?: string; answers?: { name?: string; choice?: string }[] } } };
  if (value.type !== "decision.event" || value.event?.type !== "decision.completed") return null;
  const decision = value.event.decision;
  const action = decision?.answers?.find(answer => answer.name === "action")?.choice;
  if (!action || !supported.has(action)) return null;
  const taskId = decision?.answers?.find(answer => answer.name === "task")?.choice || "none";
  if ((action === "mark_done" || action === "mark_not_done") && taskId === "none") return null;
  return { action, taskId, delegationId: value.delegation_id ?? null, decisionId: value.event_id ?? decision?.id ?? requestId, requestId };
}

export function voiceCommandLabel(command: VoiceCommand, state: CareState): string {
  const task = state.tasks.find(task => task.id === command.taskId);
  switch (command.action) {
    case "mark_done": return `Registrar “${task?.title || "este cuidado"}” como feito${task ? ` às ${task.time}` : ""}?`;
    case "mark_not_done": return `Registrar que você não realizou “${task?.title || "este cuidado"}”${task ? ` às ${task.time}` : ""}?`;
    case "request_help": return `Pedir ajuda${task ? ` com ${task.title}` : " ao cuidador"}?`;
    case "sleep_low": return "Registrar que você dormiu pouco?";
    case "sleep_high": return "Registrar que você dormiu muito?";
    case "sleep_okay": return "Registrar que você dormiu o suficiente?";
    case "food_yes": return "Registrar que você conseguiu se alimentar?";
    case "food_partial": return "Registrar que você se alimentou em parte?";
    case "food_no": return "Registrar que você ainda não se alimentou?";
    default: return "Confira o registro.";
  }
}

export function confirmedVoiceAction(command: VoiceCommand, state: CareState, date = new Date().toLocaleDateString("en-CA")): CareAction | null {
  if (state.role !== "patient" || state.plan.status !== "active") return null;
  const task = state.tasks.find(task => task.id === command.taskId);
  const { requestId } = command;
  if (command.action === "mark_done" || command.action === "mark_not_done") {
    if (!task) return null;
    return { type: "record_task", taskId: task.id, status: command.action === "mark_done" ? "done" : "not_done", requestId };
  }
  if (command.action === "request_help") return { type: "request_help", taskId: task?.id ?? null, message: "Pedido de apoio por voz.", urgent: false, requestId };
  if (!supported.has(command.action) || (!command.action.startsWith("sleep_") && !command.action.startsWith("food_"))) return null;
  const current = state.checkIns.find(item => item.author === state.role && (item.referenceDate || item.createdAt.slice(0, 10)) === date);
  return {
    type: "check_in", ...(current ? { id: current.id } : {}), referenceDate: date,
    sleepMinutes: current?.sleepMinutes ?? null,
    ...(current?.sleepRange ? { sleepRange: current.sleepRange } : {}),
    sleepQuality: command.action.startsWith("sleep_") ? command.action === "sleep_low" ? "low" : command.action === "sleep_high" ? "high" : "okay" : current?.sleepQuality ?? null,
    food: command.action.startsWith("food_") ? command.action === "food_yes" ? "yes" : command.action === "food_partial" ? "partial" : "no" : current?.food ?? null,
    mood: current?.mood ?? null, requestId,
  };
}
