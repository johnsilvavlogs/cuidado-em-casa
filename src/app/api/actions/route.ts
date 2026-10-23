import { applySessionAction } from "@/lib/server/care-store";
import { errorResponse, privateHeaders, readJson } from "@/lib/server/care-http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try { return Response.json(await applySessionAction(await readJson(request)), { headers: privateHeaders }); }
  catch (error) { return errorResponse(error); }
}
