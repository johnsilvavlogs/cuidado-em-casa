import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CareAction, CareState, DraftItem, ExtractionResult, Role, TaskOccurrence } from "../contracts";
import { batchConfirmationBlocker, itemConfirmationBlockers } from "../contracts";

export class CareError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "CareError";
  }
}

// Next bundles route modules separately while the repository survives HMR on
// globalThis. A nominal instanceof check alone loses errors from that instance.
export function isCareError(error: unknown): error is CareError {
  return error instanceof Error && error.name === "CareError" && "status" in error && typeof error.status === "number" && Number.isInteger(error.status) && error.status >= 400 && error.status < 500;
}

const text = (max = 2_000) => z.string().trim().min(1).max(max);
const id = text(128);
const requestId = z.string().trim().min(8).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const fieldSchema = z.object({
  value: z.string().trim().max(4_000).nullable(),
  state: z.enum(["readable", "ambiguous", "illegible", "missing"]),
  sourceText: z.string().trim().max(4_000).nullable(),
}).strict().superRefine((field, ctx) => {
  if (field.state === "missing" && field.value) {
    ctx.addIssue({ code: "custom", message: "Um campo ausente deve ter valor nulo." });
  }
});
const fieldsSchema = z.record(z.string().min(1).max(80), fieldSchema).refine((v) => Object.keys(v).length <= 30);
const questionsSchema = z.array(text()).max(50);
const scheduleSchema = z.object({
  times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).max(24).refine((v) => new Set(v).size === v.length),
  priority: z.enum(["important", "normal"]),
  toleranceMinutes: z.number().int().min(0).max(24 * 60),
}).strict();
const itemSchema = z.object({
  id,
  title: text(200),
  category: z.enum(["medication", "activity", "nutrition", "other"]),
  instruction: text(8_000),
  fields: fieldsSchema,
  source: z.object({ documentId: id.nullable(), page: z.number().int().min(1).max(10_000).nullable(), quote: z.string().trim().max(12_000).nullable() }).strict(),
  questions: questionsSchema,
  confirmed: z.boolean(),
  schedule: scheduleSchema.optional(),
}).strict();

export const demoSchema = z.object({
  scenario: z.enum(["ready", "setup"]),
  role: z.enum(["patient", "caregiver"]),
  demoId: z.string().uuid().optional(),
}).strict();

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("record_task"), taskId: id, status: z.enum(["done", "not_done"]), informedAt: z.string().datetime({ offset: true }).optional(), requestId }).strict(),
  z.object({ type: z.literal("request_help"), taskId: id.nullable().optional(), message: z.string().trim().max(2_000), urgent: z.boolean(), requestId }).strict(),
  z.object({ type: z.literal("resolve_help"), helpId: id, requestId }).strict(),
  z.object({ type: z.literal("check_in"), id: id.optional(), referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), sleepMinutes: z.number().int().min(0).max(24 * 60).nullable(), sleepQuality: z.enum(["low", "okay", "high"]).nullable().default(null), food: z.enum(["yes", "partial", "no"]).nullable(), mood: z.enum(["good", "okay", "bad"]).nullable(), requestId }).strict(),
  z.object({ type: z.literal("update_item"), itemId: id, title: text(200), instruction: text(8_000), fields: fieldsSchema, questions: questionsSchema, schedule: scheduleSchema.optional(), requestId }).strict(),
  z.object({ type: z.literal("add_item"), item: itemSchema, requestId }).strict(),
  z.object({ type: z.literal("confirm_item"), itemId: id, requestId }).strict(),
  z.object({ type: z.literal("confirm_items"), itemIds: z.array(id).min(1).max(150).refine(ids => new Set(ids).size === ids.length), requestId }).strict(),
  z.object({ type: z.literal("confirm_source_pages"), requestId }).strict(),
  z.object({ type: z.literal("resolve_uncertainty"), index: z.number().int().min(0), explanation: z.string().trim().min(10).max(2_000), requestId }).strict(),
  z.object({ type: z.literal("activate_plan"), requestId }).strict(),
]);

function parse<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new CareError(message);
  return result.data;
}

export function parseAction(value: unknown): CareAction {
  return parse(actionSchema, value, "Ação inválida. Confira os campos e tente novamente.") as CareAction;
}

export function parseExtraction(value: unknown): ExtractionResult {
  return parse(z.object({ items: z.array(itemSchema).max(150), unresolved: questionsSchema, warnings: z.array(text()).max(100) }).strict(), value, "A leitura retornou dados incompletos ou inválidos.");
}

export type StoredState = Omit<CareState, "role">;
export type StoredTask = TaskOccurrence & { referenceDate: string; informedAt?: string; author?: Role; toleranceMinutes: number };

export function dateInBrazil(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function requireCaregiver(role: Role): void {
  if (role !== "caregiver") throw new CareError("Somente o cuidador pode preparar o plano ou resolver pedidos.", 403);
}

export function requireDraft(state: StoredState): void {
  if (state.plan.status !== "draft") throw new CareError("O plano ativo não pode ser editado.", 409);
}

function requireActive(state: StoredState): void {
  if (state.plan.status !== "active") throw new CareError("Ative um plano conferido antes de registrar a rotina.", 409);
}

export function itemBlockers(item: DraftItem, state: StoredState): string[] {
  return itemConfirmationBlockers(item, state.document);
}

export function appendEvent(state: StoredState, role: Role, now: string, text: string): void {
  state.timeline.unshift({ id: randomUUID(), text, createdAt: now, author: role });
  state.updatedAt = now;
  state.revision += 1;
}

export function ensureTodayTasks(state: StoredState, now: Date): boolean {
  if (state.plan.status !== "active") return false;
  const date = dateInBrazil(now);
  const tasks = state.tasks as StoredTask[];
  let changed = false;
  for (const item of state.plan.items) {
    // Only explicit caregiver schedules create times; clinical frequencies are never converted.
    const times = item.schedule?.times.length ? item.schedule.times : ["A combinar"];
    times.forEach((time, index) => {
      const taskId = `${date}:${item.id}:${index}`;
      if (tasks.some((task) => task.id === taskId)) return;
      tasks.push({ id: taskId, referenceDate: date, itemId: item.id, title: item.title, instruction: item.instruction, time, status: "pending", priority: item.schedule?.priority ?? "normal", toleranceMinutes: item.schedule?.toleranceMinutes ?? 0, recordedAt: null });
      changed = true;
    });
  }
  return changed;
}

function assertReferenceDate(value: string, now: Date): void {
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value > dateInBrazil(now)) throw new CareError("Informe uma data válida que não esteja no futuro.");
}

export function applyAction(state: StoredState, role: Role, action: CareAction, now: Date): void {
  const at = now.toISOString();
  const actor = role === "patient" ? "Pessoa cuidada" : "Cuidador";
  switch (action.type) {
    case "record_task": {
      requireActive(state);
      const task = state.tasks.find((entry) => entry.id === action.taskId) as StoredTask | undefined;
      if (!task) throw new CareError("Tarefa não encontrada neste cuidado.", 404);
      const informedAt = action.informedAt ?? at;
      if (new Date(informedAt).getTime() > now.getTime() + 60_000) throw new CareError("O horário informado não pode estar no futuro.");
      const previous = task.status;
      task.status = action.status;
      task.recordedAt = at;
      task.informedAt = informedAt;
      task.author = role;
      appendEvent(state, role, at, `${actor} ${previous === "pending" ? "registrou" : "corrigiu"} “${task.title}” (${task.referenceDate}, ${task.time}): ${action.status === "done" ? "feito" : "não feito"}${previous === "pending" ? "" : `; registro anterior: ${previous === "done" ? "feito" : "não feito"}`}. Horário informado: ${informedAt}.`);
      return;
    }
    case "request_help": {
      if (role !== "patient") throw new CareError("Este pedido deve ser enviado pela pessoa cuidada.", 403);
      if (action.taskId && !state.tasks.some((entry) => entry.id === action.taskId)) throw new CareError("Tarefa não encontrada neste cuidado.", 404);
      if (!action.urgent && !action.message.trim()) throw new CareError("Conte qual ajuda você precisa.");
      const message = action.urgent ? "Preciso de ajuda urgente." : action.message.trim();
      state.helpRequests.unshift({ id: randomUUID(), taskId: action.taskId ?? null, message, urgent: action.urgent, status: "open", createdAt: at, resolvedAt: null });
      appendEvent(state, role, at, action.urgent ? "Pessoa cuidada pediu ajuda urgente. Pedido salvo no aplicativo; isso não confirma atendimento." : `Pessoa cuidada pediu ajuda: ${message}`);
      return;
    }
    case "resolve_help": {
      requireCaregiver(role);
      const help = state.helpRequests.find((entry) => entry.id === action.helpId);
      if (!help) throw new CareError("Pedido de ajuda não encontrado neste cuidado.", 404);
      if (help.status === "resolved") return;
      help.status = "resolved";
      help.resolvedAt = at;
      appendEvent(state, role, at, `Cuidador marcou a ajuda${help.urgent ? " urgente" : ""} como resolvida. A tarefa mantém seu próprio registro.`);
      return;
    }
    case "check_in": {
      requireActive(state);
      const referenceDate = action.referenceDate ?? dateInBrazil(now);
      assertReferenceDate(referenceDate, now);
      if (action.sleepMinutes === null && action.sleepQuality === null && action.food === null && action.mood === null) throw new CareError("Informe ao menos um relato ou use Pular.");
      const existing = action.id ? state.checkIns.find((entry) => entry.id === action.id) : undefined;
      if (action.id && !existing) throw new CareError("Relato não encontrado neste cuidado.", 404);
      if (existing && existing.author !== role) throw new CareError("Somente o autor pode corrigir este relato.", 403);
      const record = { id: existing?.id ?? randomUUID(), sleepMinutes: action.sleepMinutes, sleepQuality: action.sleepQuality, food: action.food, mood: action.mood, referenceDate, createdAt: existing?.createdAt ?? at, updatedAt: at, author: role };
      if (existing) Object.assign(existing, record);
      else state.checkIns.unshift(record);
      appendEvent(state, role, at, `${actor} ${existing ? "corrigiu" : "salvou"} um relato opcional de ${referenceDate}${action.sleepMinutes === null ? "; sono não informado" : `; sono informado: ${Math.floor(action.sleepMinutes / 60)}h${String(action.sleepMinutes % 60).padStart(2, "0")}`}.`);
      return;
    }
    default:
      requireCaregiver(role);
      requireDraft(state);
  }

  switch (action.type) {
    case "update_item": {
      const item = state.plan.items.find((entry) => entry.id === action.itemId);
      if (!item) throw new CareError("Cuidado não encontrado neste plano.", 404);
      Object.assign(item, { title: action.title, instruction: action.instruction, fields: action.fields, questions: action.questions, ...(action.schedule ? { schedule: action.schedule } : {}), confirmed: false });
      state.plan.sourceReviewed = false;
      appendEvent(state, role, at, `Cuidador editou “${item.title}”. Confirmação revogada; a fonte precisa ser conferida novamente.`);
      return;
    }
    case "add_item": {
      if (state.plan.items.length >= 150) throw new CareError("Limite de cuidados atingido.");
      const item = structuredClone(action.item);
      item.id = randomUUID();
      item.confirmed = false;
      if (state.document && item.source.documentId !== state.document.id) throw new CareError("A origem deve pertencer ao documento deste plano.");
      state.plan.items.push(item);
      state.plan.sourceReviewed = false;
      appendEvent(state, role, at, `Cuidador acrescentou “${item.title}” para conferência.`);
      return;
    }
    case "confirm_item": {
      const item = state.plan.items.find((entry) => entry.id === action.itemId);
      if (!item) throw new CareError("Cuidado não encontrado neste plano.", 404);
      const blockers = itemBlockers(item, state);
      if (blockers.length) throw new CareError(`Não é possível confirmar: ${blockers[0]}`, 409);
      if (item.confirmed) return;
      item.confirmed = true;
      appendEvent(state, role, at, `Cuidador conferiu “${item.title}” com a fonte.`);
      return;
    }
    case "confirm_items": {
      if (!state.plan.sourceReviewed) throw new CareError("Confira todas as páginas da fonte antes de confirmar em lote.", 409);
      if (state.plan.unresolved.length) throw new CareError("Esclareça as pendências gerais antes de confirmar em lote.", 409);
      const items = action.itemIds.map(id => {
        const item = state.plan.items.find(entry => entry.id === id);
        if (!item) throw new CareError("Um cuidado do lote não foi encontrado. Nenhum item foi confirmado.", 404);
        const blocker = batchConfirmationBlocker(item, state.document);
        if (blocker) throw new CareError(`Nenhum item foi confirmado. “${item.title}”: ${blocker}`, 409);
        return item;
      });
      const pending = items.filter(item => !item.confirmed);
      if (!pending.length) return;
      for (const item of pending) item.confirmed = true;
      appendEvent(state, role, at, `Cuidador conferiu ${pending.length} ${pending.length === 1 ? "cuidado" : "cuidados"} em lote com a fonte. Os demais itens mantêm sua própria conferência.`);
      return;
    }
    case "confirm_source_pages":
      if (!state.plan.items.length) throw new CareError("Inclua ao menos um cuidado antes de concluir a conferência.", 409);
      state.plan.sourceReviewed = true;
      appendEvent(state, role, at, "Cuidador declarou ter conferido todas as páginas da fonte e incluído as orientações relevantes.");
      return;
    case "resolve_uncertainty": {
      const question = state.plan.unresolved[action.index];
      if (!question) throw new CareError("Pendência não encontrada; atualize a revisão.", 404);
      state.plan.unresolved.splice(action.index, 1);
      state.plan.sourceReviewed = false;
      appendEvent(state, role, at, `Cuidador esclareceu “${question}”: ${action.explanation}`);
      return;
    }
    case "activate_plan": {
      if (!state.plan.items.length || !state.plan.sourceReviewed || state.plan.unresolved.length || state.plan.items.some((item) => !item.confirmed || itemBlockers(item, state).length)) throw new CareError("Confira cada cuidado, todas as páginas e esclareça as pendências antes de ativar.", 409);
      state.plan.status = "active";
      ensureTodayTasks(state, now);
      appendEvent(state, role, at, "Cuidador ativou o plano conferido.");
      return;
    }
  }
}
