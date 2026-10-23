import { parseActionRequest } from "@/lib/server/care-domain";
import { applySessionAction } from "@/lib/server/care-store";
import { errorResponse, privateHeaders, readJson } from "@/lib/server/care-http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { context, action } = parseActionRequest(await readJson(request));
    return Response.json(await applySessionAction(action, context), { headers: privateHeaders });
  }
  catch (error) { return errorResponse(error); }
}
