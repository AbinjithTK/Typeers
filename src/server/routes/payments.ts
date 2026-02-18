import { Hono } from 'hono';
import type { PaymentHandlerResponse } from '@devvit/web/server';
import type { Order } from '@devvit/web/shared';
import { reddit } from '@devvit/web/server';
import { creditTokens, refundToken, SKU_TO_TIER } from '../core/golden';

export const paymentRoutes = new Hono();

// Called by Reddit when a purchase is completed
paymentRoutes.post('/fulfill', async (c) => {
  try {
    const order = await c.req.json<Order>();

    if (!order.id) {
      console.error('Payment fulfill: missing order id');
      return c.json<PaymentHandlerResponse>({ success: false });
    }

    // Get the purchasing user from the server context
    const username = await reddit.getCurrentUsername();
    if (!username) {
      console.error('Payment fulfill: could not resolve username');
      return c.json<PaymentHandlerResponse>({ success: false });
    }

    // Process each product in the order
    for (const product of order.products ?? []) {
      const sku = product.sku;
      if (!sku) continue;

      const tier = SKU_TO_TIER[sku];
      if (!tier) {
        console.error(`Payment fulfill: unknown SKU "${sku}"`);
        continue;
      }

      const credited = await creditTokens(username, tier, order.id);
      if (!credited) {
        // Already fulfilled (idempotent) — not an error
      }
    }

    return c.json<PaymentHandlerResponse>({ success: true });
  } catch (err) {
    console.error('Payment fulfill error:', err);
    return c.json<PaymentHandlerResponse>({ success: false });
  }
});

// Called by Reddit when a refund is processed
paymentRoutes.post('/refund', async (c) => {
  try {
    const order = await c.req.json<Order>();

    if (!order.id) {
      console.error('Payment refund: missing order id');
      return c.json<PaymentHandlerResponse>({ success: true }); // ack anyway
    }

    const username = await reddit.getCurrentUsername();
    if (!username) {
      console.error('Payment refund: could not resolve username');
      return c.json<PaymentHandlerResponse>({ success: true });
    }

    for (const product of order.products ?? []) {
      const sku = product.sku;
      if (!sku) continue;

      const tier = SKU_TO_TIER[sku];
      if (!tier) continue;

      await refundToken(username, tier, order.id);
    }

    return c.json<PaymentHandlerResponse>({ success: true });
  } catch (err) {
    console.error('Payment refund error:', err);
    return c.json<PaymentHandlerResponse>({ success: true }); // ack to avoid retry loops
  }
});
