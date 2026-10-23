export const runtime = "nodejs";

export function GET() {
  return Response.json({ status: "ok", service: "cuidado-em-casa", stage: "development-scaffold" });
}
