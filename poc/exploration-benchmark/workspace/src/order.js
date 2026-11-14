import { totalPrice } from './math.js';

export function createOrder(catalog, id, quantity) {
  const item = catalog.find(id);
  return { id, total: totalPrice(item.price, quantity) };
}
