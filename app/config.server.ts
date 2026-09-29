export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required configuration: ${name}`);
  return value;
}
export function localPreviewEnabled() {
  return (
    process.env.RUN_MODE === "local-preview" &&
    process.env.NODE_ENV !== "production"
  );
}
export function shopifyConfig() {
  const preview = localPreviewEnabled();
  const apiKey = preview
    ? "local-preview-not-a-shopify-app"
    : requiredEnv("SHOPIFY_API_KEY");
  const apiSecretKey = preview
    ? "local-preview-no-real-credential"
    : requiredEnv("SHOPIFY_API_SECRET");
  const appUrl = preview
    ? "http://127.0.0.1:3000"
    : requiredEnv("SHOPIFY_APP_URL");
  const parsed = new URL(appUrl);
  if (!preview && parsed.protocol !== "https:")
    throw new Error("SHOPIFY_APP_URL must use HTTPS");
  return { apiKey, apiSecretKey, appUrl };
}
