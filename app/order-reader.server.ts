import { createOrderApi, type OrderApiGraphql } from "./order-api.server";
const readers = new WeakMap<OrderApiGraphql, ReturnType<typeof createOrderApi>>();
export function orderReader(graphql: OrderApiGraphql) {
  let reader = readers.get(graphql);
  if (!reader) { reader = createOrderApi(graphql); readers.set(graphql, reader); }
  return reader;
}
