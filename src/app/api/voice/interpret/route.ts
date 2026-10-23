import { interpretVoice, voiceInterpretInputSchema } from "@/lib/ai/interpret-voice";
import { getSessionState } from "@/lib/server/care-store";
import { assertSameOrigin, errorResponse, privateHeaders } from "@/lib/server/care-http";

import { assertSessionContext, isCareError, parseSessionContext } from "@/lib/server/care-domain";

export const runtime = "nodejs";
export const maxDuration = 60;

const invalidInput = () => Response.json({ error: "Não foi possível interpretar essa fala. Use até 6 mil caracteres e tente novamente." }, { status: 400, headers: privateHeaders });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const state = await getSessionState();
    if (state.role !== "patient" || state.plan.status !== "active") {
      return Response.json({ error: "A voz fica disponível para a pessoa cuidada depois de ativar o plano." }, { status: 403, headers: privateHeaders });
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json") || Number(request.headers.get("content-length") || 0) > 60_000) return invalidInput();
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 60_000) return invalidInput();
    let json: unknown;
    try { json = JSON.parse(body); } catch { return invalidInput(); }
    if (!json || typeof json !== "object" || Array.isArray(json)) return invalidInput();
    const { context, ...input } = json as Record<string, unknown>;
    const parsed = voiceInterpretInputSchema.safeParse(input);
    if (!parsed.success) return invalidInput();
    assertSessionContext({ demoId: state.demoId, role: state.role }, parseSessionContext(context));
    const decision = await interpretVoice(parsed.data, state);
    return Response.json(decision, { headers: privateHeaders });
  } catch (error) {
    if (isCareError(error) && (error.status === 400 || error.status === 409)) return errorResponse(error);
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : null;
    if (status === 401 || status === 403) return Response.json({ error: "Entre como pessoa cuidada para usar a voz neste acompanhamento." }, { status: 403, headers: privateHeaders });
    return Response.json({ error: "Não foi possível interpretar a fala agora. Seus registros estão preservados; use os botões ou tente novamente." }, { status: 503, headers: privateHeaders });
  }
}
