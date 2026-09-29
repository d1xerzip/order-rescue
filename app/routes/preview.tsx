import { localPreviewEnabled } from "../config.server";
import Foundation from "../components/Foundation";
export function loader() {
  if (!localPreviewEnabled()) throw new Response(null, { status: 404 });
  return null;
}
export default function Preview() {
  return (
    <Foundation
      shopLabel="Example store · synthetic preview"
      connected={false}
      preview
    />
  );
}
