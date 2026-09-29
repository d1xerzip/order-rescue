import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key() {
  const value = process.env.SESSION_ENCRYPTION_KEY || "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value))
    throw new Error("ORDER_KEY_UNAVAILABLE");
  return Buffer.from(value, "base64");
}

export function sealOrder(value: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`order-snapshot:v1:${context}`));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    body.toString("base64"),
  ].join(":");
}

export function openOrder(value: string, context: string) {
  try {
    const [version, iv, tag, body, extra] = value.split(":");
    if (version !== "v1" || !iv || !tag || !body || extra !== undefined)
      throw new Error();
    const cipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      Buffer.from(iv, "base64"),
    );
    cipher.setAAD(Buffer.from(`order-snapshot:v1:${context}`));
    cipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      cipher.update(Buffer.from(body, "base64")),
      cipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("ORDER_DECRYPTION_FAILED");
  }
}
