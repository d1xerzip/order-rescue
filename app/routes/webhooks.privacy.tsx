import type { ActionFunctionArgs } from "react-router";
import { lifecycleWebhook } from "../webhooks.server";
export const action = ({ request }: ActionFunctionArgs) => {
  const topic = request.headers.get("x-shopify-topic") || "";
  if (
    !["customers/data_request", "customers/redact", "shop/redact"].includes(
      topic,
    )
  )
    return new Response(null, { status: 400 });
  return lifecycleWebhook(request, topic);
};
