import { localPreviewEnabled } from "../config.server";
import Foundation from "../components/Foundation";
import MerchantWorkspace from "../components/MerchantWorkspace";
import { authenticateShopRequest } from "../auth.server";
import { useLoaderData, type LoaderFunctionArgs } from "react-router";
export async function loader({ request }: LoaderFunctionArgs) {
  // This route never bypasses authentication. The separate loopback QA server
  // supplies a signed synthetic token; deployed /preview remains unavailable.
  if (process.env.RUN_MODE === "test" && process.env.UI_TEST_MODE === "1" && process.env.ORDER_RESCUE_DISPOSABLE_TEST_DB === "1") {
    const { shop } = await authenticateShopRequest(request);
    return { shopLabel: shop.domain };
  }
  if (!localPreviewEnabled()) throw new Response(null, { status: 404 });
  return null;
}
export default function Preview() {
  const data = useLoaderData<typeof loader>();
  if (data) return <MerchantWorkspace shopLabel={data.shopLabel} synthetic />;
  return (
    <Foundation
      shopLabel="Example store · synthetic preview"
      connected={false}
      preview
    />
  );
}
