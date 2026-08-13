import { Hono } from "hono";
import { cors } from "hono/cors";

import { processExpiredOrders } from "./lib/escrow";
import type { AppEnv, Env } from "./types";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { bidRoutes } from "./routes/bids";
import { mediaRoutes } from "./routes/media";
import { notificationRoutes } from "./routes/notifications";
import { orderRoutes } from "./routes/orders";
import { productBidRoutes } from "./routes/product-bids";
import { productRoutes } from "./routes/products";
import { uploadRoutes } from "./routes/uploads";
import { walletRoutes } from "./routes/wallet";
import { webhookRoutes } from "./routes/webhooks";

const app = new Hono<AppEnv>();

app.use("*", cors());

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/auth", authRoutes);
app.route("/uploads", uploadRoutes);
app.route("/media", mediaRoutes);
app.route("/products", productRoutes);
app.route("/products", productBidRoutes);
app.route("/bids", bidRoutes);
app.route("/orders", orderRoutes);
app.route("/wallet", walletRoutes);
app.route("/webhooks", webhookRoutes);
app.route("/notifications", notificationRoutes);
app.route("/admin", adminRoutes);

app.get("/", (c) =>
  c.json({ name: "marketloop-workers", message: "API is running" }),
);

export default app;

/**
 * Cron Trigger (hourly, see wrangler.toml): auto-refunds orders still held
 * past their delivery deadline without both parties confirming. Exported
 * separately so the Hono app stays the default export (tests call app.request).
 */
export const scheduled = (controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
  ctx.waitUntil(processExpiredOrders(env));
};
