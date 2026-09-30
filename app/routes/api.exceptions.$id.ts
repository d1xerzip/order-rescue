import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { exceptionRequest, exactKeys, jsonBody, revision } from "../exception-http.server";
import { actOnException, ExceptionError, getException } from "../exceptions.server";

export function loader({ request, params }: LoaderFunctionArgs) {
  return exceptionRequest(request, "GET", (principal) => getException(principal, params.id || ""));
}

export function action({ request, params }: ActionFunctionArgs) {
  return exceptionRequest(request, "POST", async (principal) => {
    const body = await jsonBody(request);
    exactKeys(body, ["action", "reason", "expectedRevision"]);
    const action = body.action;
    const reason = body.reason;
    if ((action !== "acknowledge" && action !== "resolve" && action !== "ignore") ||
        (reason !== "REVIEW_STARTED" && reason !== "REVIEW_COMPLETED" && reason !== "NOT_RELEVANT"))
      throw new ExceptionError(400, "INVALID_REQUEST");
    return actOnException(principal, params.id || "", { action, reason, expectedRevision: revision(body.expectedRevision) });
  });
}
