import { authenticatedBackground } from "./auth.server";
import type { OrderGraphql } from "./order-snapshot.server";

// One pacing stream per installation in this process; credentials remain in SDK
// storage and are refreshed/revalidated for every request, never cached here.
const clients = new Map<string, { generation: number; graphql: OrderGraphql }>();
export function shopOrderGraphql(domain: string, generation: number) {
  const existing = clients.get(domain);
  if (existing?.generation === generation) return existing.graphql;
  const graphql: OrderGraphql = async (query, options) => {
    const { admin } = await authenticatedBackground(domain, generation);
    return admin.graphql(query, { ...options, signal: AbortSignal.timeout(10_000) });
  };
  clients.set(domain, { generation, graphql });
  return graphql;
}
