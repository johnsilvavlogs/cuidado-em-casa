import { extractDocument } from "@/lib/ai/extract";
import { getSessionState, importDraft, storeDocument } from "@/lib/server/care-store";
import { assertSameOrigin, errorResponse, privateHeaders } from "@/lib/server/care-http";
import { assertSessionContext, CareError, isCareError, parseSessionContext } from "@/lib/server/care-domain";

export const runtime = "nodejs";
export const maxDuration = 120;

function detectedType(bytes: Uint8Array): string | null {
  if (Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-") return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  return null;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionState();
    if (session.role !== "caregiver") return Response.json({ error: "Somente o cuidador pode preparar o plano." }, { status: 403 });
    if (session.plan.status === "active") return Response.json({ error: "O plano já foi ativado. Inicie outro acompanhamento para preparar um plano." }, { status: 409 });
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 11 * 1024 * 1024) return Response.json({ error: "Use um arquivo de até 10 MB." }, { status: 413 });
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "multipart/form-data" && contentType !== "application/x-www-form-urlencoded") throw new CareError("Envie as orientações em um formulário com arquivo ou texto.", 415);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new CareError("O formulário enviado é inválido. Confira o arquivo ou texto e envie novamente.");
    }
    let contextInput: unknown;
    try { contextInput = JSON.parse(String(form.get("context"))); } catch { contextInput = null; }
    const context = parseSessionContext(contextInput);
    assertSessionContext({ demoId: session.demoId, role: session.role }, context);
    const file = form.get("file");
    const text = String(form.get("text") ?? "").trim();
    let bytes: Uint8Array;
    let filename: string;
    let mimeType: string;
    if (file instanceof File && file.size > 0) {
      if (file.size > 10 * 1024 * 1024) return Response.json({ error: "Use um arquivo de até 10 MB." }, { status: 413 });
      bytes = new Uint8Array(await file.arrayBuffer());
      const detected = detectedType(bytes);
      if (!detected) return Response.json({ error: "Envie um PDF, JPEG ou PNG válido, ou cole o texto." }, { status: 415 });
      mimeType = detected;
      filename = file.name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "orientacoes";
    } else {
      if (!text || text.length > 50_000) return Response.json({ error: "Cole as orientações em até 50 mil caracteres." }, { status: 400 });
      bytes = Buffer.from(text, "utf8");
      filename = "orientacoes.txt";
      mimeType = "text/plain";
    }
    const extraction = await extractDocument({ filename, mimeType, ...(mimeType === "text/plain" ? { text } : { base64: Buffer.from(bytes).toString("base64") }) });
    const document = await storeDocument({ name: filename, mimeType, bytes }, context);
    return Response.json(await importDraft(document, extraction, context), { headers: privateHeaders });
  } catch (error) {
    if (isCareError(error)) return errorResponse(error);
    return Response.json({ error: "Não foi possível ler este documento. Tente novamente, envie uma imagem mais legível ou cadastre as orientações manualmente." }, { status: 502 });
  }
}
