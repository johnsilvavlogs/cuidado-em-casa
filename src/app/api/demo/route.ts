import { cookies } from "next/headers";
import { DEMO_SESSION_COOKIE, startDemo } from "@/lib/server/care-store";
import { errorResponse, privateHeaders, readJson } from "@/lib/server/care-http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { token, state } = await startDemo(await readJson(request));
    (await cookies()).set(DEMO_SESSION_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: new URL(request.url).protocol === "https:", path: "/", maxAge: 24 * 60 * 60 });
    return Response.json(state, { headers: privateHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
