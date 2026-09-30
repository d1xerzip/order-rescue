import type { LoaderFunctionArgs } from "react-router";
import { exceptionRequest } from "../exception-http.server";
import { listEvaluations } from "../exceptions.server";

export function loader({ request }: LoaderFunctionArgs) {
  return exceptionRequest(request, "GET", listEvaluations);
}
