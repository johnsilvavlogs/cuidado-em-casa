import { getSessionState } from "@/lib/server/care-store";
import { errorResponse, privateHeaders } from "@/lib/server/care-http";

export const runtime = "nodejs";

export async function GET() {
  try { return Response.json(await getSessionState(), { headers: privateHeaders }); }
  catch (error) { return errorResponse(error); }
}
