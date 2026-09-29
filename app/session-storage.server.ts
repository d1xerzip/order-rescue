import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { Session } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

function encryptionKey() {
  const encoded = process.env.SESSION_ENCRYPTION_KEY;
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded))
    throw new Error("SESSION_ENCRYPTION_KEY must encode 32 bytes in base64");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32)
    throw new Error("SESSION_ENCRYPTION_KEY must encode 32 bytes in base64");
  return key;
}

function encrypt(value: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

function decrypt(value: string, context: string) {
  const [version, iv, tag, encrypted, extra] = value.split(":");
  if (
    version !== "v1" ||
    !iv ||
    !tag ||
    encrypted === undefined ||
    extra !== undefined
  )
    throw new Error("Invalid encrypted session credential");
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(iv, "base64"),
    );
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Session credential decryption failed");
  }
}

export class EncryptedSessionStorage extends PrismaSessionStorage<PrismaClient> {
  constructor(client: PrismaClient = prisma) {
    super(client);
  }

  async storeSession(session: Session) {
    const clone = new Session(session.toObject());
    const context = `${clone.id}:${clone.shop}`;
    if (clone.accessToken !== undefined)
      clone.accessToken = encrypt(clone.accessToken, `${context}:access`);
    if (clone.refreshToken !== undefined)
      clone.refreshToken = encrypt(clone.refreshToken, `${context}:refresh`);
    return super.storeSession(clone);
  }

  private decodeSession(session: Session) {
    const clone = new Session(session.toObject());
    const context = `${clone.id}:${clone.shop}`;
    if (clone.accessToken !== undefined)
      clone.accessToken = decrypt(clone.accessToken, `${context}:access`);
    if (clone.refreshToken !== undefined)
      clone.refreshToken = decrypt(clone.refreshToken, `${context}:refresh`);
    return clone;
  }

  async loadSession(id: string) {
    const session = await super.loadSession(id);
    return session ? this.decodeSession(session) : undefined;
  }

  async findSessionsByShop(shop: string) {
    return (await super.findSessionsByShop(shop)).map((session) =>
      this.decodeSession(session),
    );
  }
}
