import { CareError, isCareError } from "./care-domain";

export const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  // Next's development server can normalize request.url to localhost while the
  // browser correctly sends 127.0.0.1 in Host and Origin.
  const expectedOrigin = `${url.protocol}//${request.headers.get("host") || url.host}`;
  if ((origin && origin !== expectedOrigin) || request.headers.get("sec-fetch-site") === "cross-site") throw new CareError("A origem desta solicitação não é permitida.", 403);
}

export async function readJson(request: Request): Promise<unknown> {
  assertSameOrigin(request);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new CareError("Envie o conteúdo em JSON.", 415);
  if (Number(request.headers.get("content-length")) > 512_000) throw new CareError("Solicitação muito grande.", 413);
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 512_000) throw new CareError("Solicitação muito grande.", 413);
  try { return JSON.parse(body); } catch { throw new CareError("O conteúdo enviado não é um JSON válido."); }
}

export function errorResponse(error: unknown): Response {
  if (isCareError(error)) return Response.json({ error: error.message }, { status: error.status, headers: privateHeaders });
  console.error("Falha no armazenamento do cuidado:", error instanceof Error ? error.message : "erro desconhecido");
  return Response.json({ error: "Não foi possível confirmar a gravação. Tente novamente." }, { status: 500, headers: privateHeaders });
}
