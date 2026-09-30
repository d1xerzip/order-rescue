import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticateShopRequest } from "../auth.server";
import MerchantWorkspace from "../components/MerchantWorkspace";
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop } = await authenticateShopRequest(request);
  return { shopLabel: shop.domain };
}
export default function Home() {
  const data = useLoaderData<typeof loader>();
  return <MerchantWorkspace shopLabel={data.shopLabel} />;
}
