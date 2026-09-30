import { authenticateShopRequest } from "./auth.server";
import { ExceptionError, type Principal } from "./exceptions.server";

const headers = { "Cache-Control": "no-store" };
const bodyLimit = 8192;
export const emptyResponse = (status: number) => new Response(null, { status, headers });

/** Resource endpoints accept App Bridge bearer requests, never cookie/query-token actions. */
export async function exceptionRequest(
  request: Request,
  method: "GET" | "POST" | "PUT",
  operation: (principal: Principal) => Promise<unknown>,
) {
  if (request.method !== method) return emptyResponse(405);
  if (!/^Bearer [^\s]+$/i.test(request.headers.get("authorization") || ""))
    return emptyResponse(401);
  try {
    const { shop, context } = await authenticateShopRequest(request);
    const actor = context.sessionToken.sub;
    if (typeof actor !== "string" || actor !== actor.trim() || !/^[1-9][0-9]*$/.test(actor)) return emptyResponse(401);
    const result = await operation({ shopId: shop.id, generation: shop.generation, actor });
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof ExceptionError) {
      if (error.status === 404) return emptyResponse(404);
      return Response.json({ error: error.code }, { status: error.status, headers });
    }
    // Auth redirects/errors must not leak token-bearing URLs or upstream response bodies.
    if (error instanceof Response)
      return emptyResponse(error.status >= 400 ? error.status : 401);
    return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers });
  }
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    throw new ExceptionError(415, "JSON_REQUIRED");
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > bodyLimit))
    throw new ExceptionError(413, "BODY_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) throw new ExceptionError(400, "INVALID_REQUEST");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    let reading = true;
    while (reading) {
      const { done, value } = await reader.read();
      if (done) { reading = false; break; }
      size += value.byteLength;
      if (size > bodyLimit) {
        await reader.cancel();
        throw new ExceptionError(413, "BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new ExceptionError(400, "INVALID_REQUEST");
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ExceptionError) throw error;
    throw new ExceptionError(400, "INVALID_REQUEST");
  } finally {
    reader.releaseLock();
  }
}

export function exactKeys(body: Record<string, unknown>, keys: string[]) {
  if (Object.keys(body).some((key) => !keys.includes(key)) || keys.some((key) => !(key in body)))
    throw new ExceptionError(400, "INVALID_REQUEST");
}

export function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new ExceptionError(400, "INVALID_REQUEST");
  return value as number;
}
