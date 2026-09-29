import { redirect, type LoaderFunctionArgs } from "react-router";
import { localPreviewEnabled } from "../../config.server";
export function loader({ request }: LoaderFunctionArgs) {
  if (localPreviewEnabled()) return redirect("/preview");
  const url = new URL(request.url);
  return redirect(`/app${url.search}`);
}
export default function Index() {
  return null;
}
