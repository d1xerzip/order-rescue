import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { Session } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { privacyBlocked } from "./privacy-guard.server";
import { authOperation } from "./auth-lock.server";

// Keep Shopify's own row mapping. During authentication its Session delegate is
// bound to the transaction owning the mutex: expiry rolls back/rejects writes.
function transactionSessionClient(client: PrismaClient): PrismaClient {
  return new Proxy(client, { get(target, property, receiver) {
    if (property === "session") return authOperation()?.tx.session ?? target.session;
    return Reflect.get(target, property, receiver);
  } });
}

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
  private readonly privacyDb: PrismaClient;
  constructor(client: PrismaClient = prisma) {
    super(transactionSessionClient(client));
    this.privacyDb = client;
  }

  async storeSession(session: Session) {
    const operation = authOperation(session.shop);
    if (!operation && !(process.env.RUN_MODE === "test" && process.env.ORDER_RESCUE_DISPOSABLE_TEST_DB === "1"))
      throw new Error("AUTH_OPERATION_REQUIRED");
    const clone = new Session(session.toObject());
    if (clone.onlineAccessInfo) {
      const info = clone.onlineAccessInfo;
      clone.onlineAccessInfo = { ...info, associated_user: {
        id: info.associated_user.id,
        account_owner: info.associated_user.account_owner,
        collaborator: info.associated_user.collaborator,
        first_name: "", last_name: "", email: "", email_verified: false, locale: "",
      } };
    }
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
    if (session) authOperation(session.shop);
    if (session && await this.blocked(session.shop)) return undefined;
    return session ? this.decodeSession(session) : undefined;
  }

  private async blocked(domain: string) {
    const check = async (tx: import("@prisma/client").Prisma.TransactionClient) => {
      const shop = await tx.shop.findUnique({ where: { domain } });
      return privacyBlocked(tx, domain, undefined, shop?.installedAt ?? new Date(0));
    };
    const operation = authOperation(domain);
    return operation ? check(operation.tx) : this.privacyDb.$transaction(check);
  }

  async findSessionsByShop(shop: string) {
    if (await this.blocked(shop)) return [];
    return (await super.findSessionsByShop(shop)).map((session) =>
      this.decodeSession(session),
    );
  }
}
