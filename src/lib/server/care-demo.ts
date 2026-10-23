import { randomUUID } from "node:crypto";
import type { DocumentRef, DraftItem } from "../contracts";
import { dateInBrazil, ensureTodayTasks, type StoredState } from "./care-domain";

export const demoSource = `PLANO DE CUIDADOS
Pessoa cuidada: Helena Costa. Cuidadora: Marina Costa.

1. Medicamento A, 500 mg: tomar 1 comprimido por via oral às 08:00 e 20:00 por 7 dias.
2. Alimentação: fazer as refeições habituais respeitando as orientações recebidas.
3. Movimento: caminhada leve por 15 minutos, se estiver confortável. Interromper e pedir apoio se houver dificuldade.

Horários acordados com a cuidadora: medicamento às 08:00 e 20:00; alimentação às 12:00; caminhada às 16:00. Tolerância operacional: 30 minutos.
`;

export function createDemoState(demoId: string, scenario: "ready" | "setup", document: DocumentRef | null, now: Date): StoredState {
  const at = now.toISOString();
  // This synthetic scenario starts today by design, not by interpreting a prescription.
  const startDate = dateInBrazil(now);
  const end = new Date(`${startDate}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  const medicationPeriod = { startDate, endDate: end.toISOString().slice(0, 10) };
  const items: DraftItem[] = scenario === "ready" ? [
    {
      id: randomUUID(), title: "Medicamento A", category: "medication",
      instruction: "Tomar 1 comprimido de 500 mg por via oral às 08:00 e 20:00, por 7 dias.",
      fields: {
        nome: { value: "Medicamento A", state: "readable", sourceText: "Medicamento A" },
        concentração: { value: "500 mg", state: "readable", sourceText: "500 mg" },
        dose: { value: "1 comprimido", state: "readable", sourceText: "tomar 1 comprimido" },
        via: { value: "oral", state: "readable", sourceText: "por via oral" },
        frequência: { value: "às 08:00 e 20:00", state: "readable", sourceText: "às 08:00 e 20:00" },
        duração: { value: "7 dias", state: "readable", sourceText: "por 7 dias" },
        condições: { value: null, state: "missing", sourceText: null },
      },
      source: { documentId: document!.id, page: 1, quote: "Medicamento A, 500 mg: tomar 1 comprimido por via oral às 08:00 e 20:00 por 7 dias." },
      questions: [], confirmed: true, schedule: { times: ["08:00", "20:00"], priority: "important", toleranceMinutes: 30, period: medicationPeriod },
    },
    {
      id: randomUUID(), title: "Alimentação", category: "nutrition",
      instruction: "Fazer as refeições habituais respeitando as orientações recebidas.",
      fields: { orientação: { value: "Refeições habituais", state: "readable", sourceText: "fazer as refeições habituais" } },
      source: { documentId: document!.id, page: 1, quote: "Alimentação: fazer as refeições habituais respeitando as orientações recebidas." },
      questions: [], confirmed: true, schedule: { times: ["12:00"], priority: "normal", toleranceMinutes: 30, period: { startDate, endDate: null }, recurrence: { kind: "daily" } },
    },
    {
      id: randomUUID(), title: "Caminhada leve", category: "activity",
      instruction: "Caminhar por 15 minutos se estiver confortável. Interromper e pedir apoio se houver dificuldade.",
      fields: { duração: { value: "15 minutos", state: "readable", sourceText: "por 15 minutos" }, condições: { value: "Se estiver confortável; interromper se houver dificuldade", state: "readable", sourceText: "se estiver confortável. Interromper e pedir apoio se houver dificuldade" } },
      source: { documentId: document!.id, page: 1, quote: "Movimento: caminhada leve por 15 minutos, se estiver confortável. Interromper e pedir apoio se houver dificuldade." },
      questions: [], confirmed: true, schedule: { times: ["16:00"], priority: "normal", toleranceMinutes: 30, period: { startDate, endDate: null }, recurrence: { kind: "daily" } },
    },
  ] : [];
  const state: StoredState = {
    demoId, patient: { name: "Helena Costa", caregiverName: "Marina Costa" },
    plan: { status: scenario === "ready" ? "active" : "draft", items, sourceReviewed: scenario === "ready", unresolved: [], warnings: [] },
    document, tasks: [], helpRequests: [], checkIns: [],
    timeline: [{ id: randomUUID(), text: scenario === "ready" ? "Plano e horários conferidos." : "Acompanhamento iniciado. Prepare o plano de cuidados.", createdAt: at, author: "caregiver" }],
    updatedAt: at, revision: 1,
  };
  ensureTodayTasks(state, now);
  return state;
}
