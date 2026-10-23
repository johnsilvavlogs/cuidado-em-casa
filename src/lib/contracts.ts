export type Role = "patient" | "caregiver";
export type CareSessionContext = { demoId: string; role: Role };
export type ReadingState = "readable" | "ambiguous" | "illegible" | "missing";
export type CareField = { value: string | null; state: ReadingState; sourceText: string | null };
export type DraftItem = {
  id: string;
  title: string;
  category: "medication" | "activity" | "nutrition" | "other";
  instruction: string;
  fields: Record<string, CareField>;
  source: { documentId: string | null; page: number | null; quote: string | null };
  questions: string[];
  confirmed: boolean;
  schedule?: { times: string[]; priority: "important" | "normal"; toleranceMinutes: number };
};
export type ExtractionResult = { items: DraftItem[]; unresolved: string[]; warnings: string[] };
export type DocumentRef = { id: string; name: string; mimeType: string; url: string; pageCount: number | null };
export type TaskOccurrence = { id: string; itemId: string; title: string; instruction: string; time: string; status: "pending" | "done" | "not_done"; priority: "important" | "normal"; recordedAt: string | null; referenceDate?: string; informedAt?: string; author?: Role; toleranceMinutes?: number };
export type HelpRequest = { id: string; taskId: string | null; message: string; urgent: boolean; status: "open" | "resolved"; createdAt: string; resolvedAt: string | null };
export type CheckIn = { id: string; sleepMinutes: number | null; sleepQuality: "low" | "okay" | "high" | null; food: "yes" | "partial" | "no" | null; mood: "good" | "okay" | "bad" | null; referenceDate?: string; createdAt: string; updatedAt?: string; author: Role };
export type TimelineEvent = { id: string; text: string; createdAt: string; author: Role };
export type CareState = {
  demoId: string;
  role: Role;
  patient: { name: string; caregiverName: string };
  plan: { status: "draft" | "active"; items: DraftItem[]; unresolved: string[]; warnings: string[]; sourceReviewed: boolean };
  document: DocumentRef | null;
  tasks: TaskOccurrence[];
  helpRequests: HelpRequest[];
  checkIns: CheckIn[];
  timeline: TimelineEvent[];
  updatedAt: string;
  revision: number;
};
export type CareAction =
  | { type: "record_task"; taskId: string; status: "done" | "not_done"; informedAt?: string; requestId: string }
  | { type: "request_help"; taskId?: string | null; message: string; urgent: boolean; requestId: string }
  | { type: "resolve_help"; helpId: string; requestId: string }
  | { type: "check_in"; id?: string; referenceDate?: string; sleepMinutes: number | null; sleepQuality: CheckIn["sleepQuality"]; food: CheckIn["food"]; mood: CheckIn["mood"]; requestId: string }
  | { type: "update_item"; itemId: string; title: string; instruction: string; fields: Record<string, CareField>; questions: string[]; schedule?: DraftItem["schedule"]; requestId: string }
  | { type: "add_item"; item: DraftItem; requestId: string }
  | { type: "confirm_source_pages"; requestId: string }
  | { type: "confirm_item"; itemId: string; requestId: string }
  | { type: "resolve_uncertainty"; index: number; explanation: string; requestId: string }
  | { type: "activate_plan"; requestId: string };
