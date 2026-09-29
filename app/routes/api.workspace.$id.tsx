import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { authenticateShopRequest } from "../auth.server";
import { getWorkspaceRecord, updateWorkspaceRecord } from "../storage.server";
const headers = { "Cache-Control": "no-store" };
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { shop } = await authenticateShopRequest(request);
  const record = await getWorkspaceRecord(shop.id, params.id || "");
  return record
    ? Response.json(
        { id: record.id, displayName: record.displayName },
        { headers },
      )
    : new Response(null, { status: 404, headers });
}
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "PATCH") return new Response(null, { status: 405 });
  // Shopify App Bridge fetch supplies a signed bearer ID token. Do not accept cookie-only mutation.
  if (!request.headers.get("authorization")?.startsWith("Bearer "))
    return new Response(null, { status: 401 });
  const { shop } = await authenticateShopRequest(request);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return new Response(null, { status: 415 });
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  if (
    !body ||
    typeof body !== "object" ||
    Object.keys(body).some((k) => k !== "displayName") ||
    typeof body.displayName !== "string" ||
    !body.displayName.trim() ||
    body.displayName.length > 80
  )
    return new Response(null, { status: 400 });
  const record = await updateWorkspaceRecord(
    shop.id,
    params.id || "",
    body.displayName.trim(),
  );
  return record
    ? Response.json(
        { id: record.id, displayName: record.displayName },
        { headers },
      )
    : new Response(null, { status: 404, headers });
}
