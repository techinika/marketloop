import type { AuthUser } from "./lib/firebase-auth";

export interface Env {
  IMAGES: R2Bucket;
  /** Custom S3 API credentials for R2 presigned uploads (secrets). */
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_CLIENT_EMAIL: string;
  FIREBASE_PRIVATE_KEY: string;
  /** Test override: Firestore REST base URL. */
  FIRESTORE_API_URL?: string;
  /** Test override: fixed access token instead of a signed service-account JWT. */
  FIRESTORE_ACCESS_TOKEN?: string;
  PAYPACK_CLIENT_ID: string;
  PAYPACK_CLIENT_SECRET: string;
  /** API base for Paypack (defaults to https://api.paypack.ph). */
  PAYPACK_BASE_URL?: string;
  /** "production" | "development" — sent on every cashin/cashout. */
  PAYPACK_ENVIRONMENT?: string;
  /** Shared secret used to verify X-Paypack-Signature on webhooks. */
  PAYPACK_WEBHOOK_SECRET?: string;
  PESAPAL_CONSUMER_KEY: string;
  PESAPAL_CONSUMER_SECRET: string;
  /** API base for Pesapal (defaults to https://pay.pesapal.com/v3). */
  PESAPAL_BASE_URL?: string;
  /** Optional pre-registered Pesapal IPN id; otherwise registered once into Firestore. */
  PESAPAL_IPN_ID?: string;
  /** Public frontend origin used for Pesapal callbacks (defaults to http://localhost:3000). */
  FRONTEND_URL?: string;
  /** Override the Google JWKS endpoint (used in tests). */
  FIREBASE_JWKS_URL?: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: AuthUser };
};
