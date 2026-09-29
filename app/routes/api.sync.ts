import type { LoaderFunctionArgs } from "react-router";
import { authenticateShopRequest } from "../auth.server";
import { getOrderSyncStatus } from "../order-sync.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { shop } = await authenticateShopRequest(request);
  return Response.json(await getOrderSyncStatus(shop.id), {
    headers: { "Cache-Control": "no-store" },
  });
}
