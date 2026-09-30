import type { LoaderFunctionArgs } from "react-router";
import { exceptionRequest } from "../exception-http.server";
import { listEvaluationsPage, pageOptions } from "../exceptions.server";

export function loader({ request }: LoaderFunctionArgs) {
  return exceptionRequest(request, "GET", principal => listEvaluationsPage(principal, pageOptions(request)));
}
