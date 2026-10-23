import { cookies } from "next/headers";
import { DEMO_SESSION_COOKIE, logoutSession } from "@/lib/server/care-store";
import { assertSameOrigin, errorResponse, privateHeaders } from "@/lib/server/care-http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await logoutSession();
    (await cookies()).set(DEMO_SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", secure: new URL(request.url).protocol === "https:", path: "/", maxAge: 0 });
    return Response.json({ ok: true }, { headers: privateHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
