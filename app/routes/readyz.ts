import prisma from "../db.server";
import { localPreviewEnabled } from "../config.server";
export async function loader() {
  try {
    await prisma.shop.count();
    const configured =
      !localPreviewEnabled() &&
      !!process.env.SHOPIFY_API_KEY &&
      !!process.env.SHOPIFY_API_SECRET &&
      /^[A-Za-z0-9+/]{43}=$/.test(process.env.SESSION_ENCRYPTION_KEY || "");
    return Response.json(
      {
        status: configured ? "ready" : "not_ready",
        database: "reachable",
        shopify: configured ? "configured_not_verified" : "not_configured",
      },
      {
        status: configured ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return Response.json(
      { status: "not_ready" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
