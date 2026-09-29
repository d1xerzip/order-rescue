import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticateShopRequest } from "../auth.server";
import Foundation from "../components/Foundation";
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop } = await authenticateShopRequest(request);
  return { shopLabel: shop.domain };
}
export default function Home() {
  const data = useLoaderData<typeof loader>();
  return <Foundation shopLabel={data.shopLabel} connected />;
}
