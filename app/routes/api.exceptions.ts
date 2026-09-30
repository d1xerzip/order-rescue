import type { LoaderFunctionArgs } from "react-router";
import { exceptionRequest } from "../exception-http.server";
import { listExceptionsPage, pageOptions } from "../exceptions.server";

export function loader({ request }: LoaderFunctionArgs) {
  return exceptionRequest(request, "GET", principal => listExceptionsPage(principal, pageOptions(request)));
}
