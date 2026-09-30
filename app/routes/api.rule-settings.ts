import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { exceptionRequest, exactKeys, jsonBody, revision } from "../exception-http.server";
import { ExceptionError, listRuleSettings, saveRuleSettings } from "../exceptions.server";

export function loader({ request }: LoaderFunctionArgs) {
  return exceptionRequest(request, "GET", listRuleSettings);
}

export function action({ request }: ActionFunctionArgs) {
  return exceptionRequest(request, "PUT", async (principal) => {
    const body = await jsonBody(request);
    exactKeys(body, ["ruleKey", "settings", "expectedRevision"]);
    if (body.ruleKey !== "high_order_value" && body.ruleKey !== "high_line_quantity")
      throw new ExceptionError(400, "INVALID_REQUEST");
    return saveRuleSettings(principal, body.ruleKey, body.settings, revision(body.expectedRevision));
  });
}
