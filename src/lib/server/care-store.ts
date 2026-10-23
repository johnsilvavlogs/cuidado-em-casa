import "server-only";
import { cookies } from "next/headers";
import type { CareSessionContext, CareState, DocumentRef, ExtractionResult } from "../contracts";
import { CareRepository } from "./care-repository";

export { CareError } from "./care-domain";
export const DEMO_SESSION_COOKIE = "care_demo_session";

const globalStore = globalThis as typeof globalThis & { careRepository?: CareRepository };
const repository = globalStore.careRepository ??= new CareRepository();

async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(DEMO_SESSION_COOKIE)?.value;
}

export async function startDemo(input: unknown): Promise<{ token: string; state: CareState }> {
  return repository.startDemo(input);
}

export async function getSessionState(expected?: CareSessionContext): Promise<CareState> {
  return repository.getState(await sessionToken(), expected);
}

export async function applySessionAction(action: unknown, expected: CareSessionContext): Promise<CareState> {
  return repository.mutate(await sessionToken(), action, expected);
}

export async function storeDocument(input: { name: string; mimeType: string; bytes: Uint8Array }, expected: CareSessionContext): Promise<DocumentRef> {
  return repository.storeDocument(await sessionToken(), input, expected);
}

export async function importDraft(document: DocumentRef, extraction: ExtractionResult, expected: CareSessionContext): Promise<CareState> {
  return repository.importDraft(await sessionToken(), document, extraction, expected);
}

export async function getSessionDocument(id: string): Promise<{ reference: DocumentRef; bytes: Uint8Array }> {
  return repository.getDocument(await sessionToken(), id);
}
