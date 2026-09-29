import type { ActionFunctionArgs } from "react-router";
import { lifecycleWebhook } from "../webhooks.server";
export const action = ({ request }: ActionFunctionArgs) =>
  lifecycleWebhook(request, "app/scopes_update");
