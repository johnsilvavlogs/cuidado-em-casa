import { createLiveSession } from "@/lib/ai/live";
import { getSessionState } from "@/lib/server/care-store";
import { assertSameOrigin, privateHeaders } from "@/lib/server/care-http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const state = await getSessionState();
    if (state.role !== "patient" || state.plan.status !== "active") return Response.json({ error: "A voz fica disponível para a pessoa cuidada depois de ativar o plano." }, { status: 403 });
    if (Number(request.headers.get("content-length") || 0) > 70_000) return Response.json({ error: "Solicitação de áudio inválida." }, { status: 413 });
    const input = await request.json();
    if (typeof input.sdp !== "string" || !input.sdp.startsWith("v=0") || input.sdp.length > 65_536) return Response.json({ error: "Não foi possível preparar a conexão do microfone." }, { status: 400 });
    return Response.json(await createLiveSession({ sdp: input.sdp, state }), { headers: privateHeaders });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 502;
    if (status === 401) return Response.json({ error: "Entre antes de usar a voz." }, { status: 401 });
    return Response.json({ error: "A voz não está disponível agora. Seus registros estão preservados; continue pelos botões ou tente novamente." }, { status: 503 });
  }
}
