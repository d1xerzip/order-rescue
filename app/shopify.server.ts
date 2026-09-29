import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { LogSeverity, shopifyApi } from "@shopify/shopify-api";
import { shopifyConfig } from "./config.server";
import { EncryptedSessionStorage } from "./session-storage.server";
import { activateShop } from "./storage.server";
import prisma from "./db.server";

const config = shopifyConfig();
// Do not log SDK messages: errors may contain credential-bearing request details.
const logger = { level: LogSeverity.Error, log: () => {} };
export const apiVersion = ApiVersion.July26;
export const sessionStorage = new EncryptedSessionStorage();
const shopify = shopifyApp({
  ...config,
  apiVersion,
  scopes: ["read_orders"],
  authPathPrefix: "/auth",
  sessionStorage,
  distribution: AppDistribution.AppStore,
  logger,
  future: { expiringOfflineAccessTokens: true },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      try {
        const response = await admin.graphql(
          "query FoundationShop { shop { id myshopifyDomain } }",
        );
        const body = (await response.json()) as {
          errors?: unknown[];
          data?: { shop?: { id: string; myshopifyDomain: string } };
        };
        if (
          !response.ok ||
          body.errors?.length ||
          !body.data?.shop ||
          body.data.shop.myshopifyDomain !== session.shop
        )
          throw new Error("SHOP_IDENTITY_UNAVAILABLE");
        await activateShop(session.shop, body.data.shop.id);
        await prisma.shop.update({
          where: { domain: session.shop },
          data: {
            jobsEnabled: (session.scope || "")
              .split(",")
              .includes("read_orders"),
          },
        });
      } catch (error) {
        await sessionStorage.deleteSession(session.id);
        throw error;
      }
    },
  },
});
// Session-independent official verifier: revoked/expired access tokens must not block uninstall/privacy.
export const webhookApi = shopifyApi({
  apiKey: config.apiKey,
  apiSecretKey: config.apiSecretKey,
  apiVersion,
  hostName: new URL(config.appUrl).host,
  isEmbeddedApp: true,
  scopes: ["read_orders"],
  logger,
});
export default shopify;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
