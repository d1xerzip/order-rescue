import type { ActionFunctionArgs } from "react-router";
import { receiveOrderCreated } from "../order-webhook.server";

export const action = ({ request }: ActionFunctionArgs) =>
  receiveOrderCreated(request);
