import { createOrder } from './order.js';

export function postOrder(catalog, request) {
  return createOrder(catalog, request.id, request.quantity);
}
