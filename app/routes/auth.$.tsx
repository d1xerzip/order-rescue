import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticateShopRequest } from "../auth.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticateShopRequest(request);

  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
