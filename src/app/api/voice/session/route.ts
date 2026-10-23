import { createLiveSession } from "@/lib/ai/live";
import { getSessionState } from "@/lib/server/care-store";
import { assertSameOrigin, errorResponse, privateHeaders, readJson } from "@/lib/server/care-http";
import { assertSessionContext, CareError, isCareError, parseSessionContext } from "@/lib/server/care-domain";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const state = await getSessionState();
    if (Number(request.headers.get("content-length") || 0) > 70_000) return Response.json({ error: "Solicitação de áudio inválida." }, { status: 413 });
    const input = await readJson(request);
    if (!input || typeof input !== "object" || Array.isArray(input) || !("sdp" in input) || typeof input.sdp !== "string" || !input.sdp.startsWith("v=0") || input.sdp.length > 65_536) throw new CareError("Não foi possível ligar o microfone. Tente de novo.");
    assertSessionContext({ demoId: state.demoId, role: state.role }, parseSessionContext("context" in input ? input.context : undefined));
    if (state.role !== "patient" || state.plan.status !== "active") return Response.json({ error: "Ative o plano para a pessoa cuidada usar a voz." }, { status: 403 });
    try {
      return Response.json(await createLiveSession({ sdp: input.sdp, state }), { headers: privateHeaders });
    } catch {
      return Response.json({ error: "A voz está indisponível. Tente de novo ou use os botões." }, { status: 503, headers: privateHeaders });
    }
  } catch (error) {
    if (isCareError(error) && error.status === 401) return Response.json({ error: "Entre antes de usar a voz." }, { status: 401, headers: privateHeaders });
    return errorResponse(error);
  }
}
