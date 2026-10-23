import { getSessionDocument } from "@/lib/server/care-store";
import { errorResponse, privateHeaders } from "@/lib/server/care-http";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { reference, bytes } = await getSessionDocument(id);
    return new Response(new Uint8Array(bytes), { headers: { ...privateHeaders, "Content-Type": reference.mimeType, "Content-Length": String(bytes.byteLength), "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(reference.name)}`, "Content-Security-Policy": "sandbox; default-src 'none'" } });
  } catch (error) {
    return errorResponse(error);
  }
}
