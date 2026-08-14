/**
 * Startup configuration validation.
 *
 * Workers have no boot hook, so required-bindings checks run on `/health` (and
 * could run in the scheduled handler) instead of on every request. Missing
 * configuration fails fast with a clear list of problems rather than surfacing
 * as confusing 500s deep inside a route.
 */

export interface EnvProblem {
  key: string;
  detail: string;
}

const REQUIRED_STRINGS: Array<[key: string, detail: string]> = [
  ["FIREBASE_PROJECT_ID", "Firestore project + auth token audience"],
  ["FIREBASE_CLIENT_EMAIL", "Firestore service-account client email"],
  ["FIREBASE_PRIVATE_KEY", "Firestore service-account private key"],
  ["PAYPACK_CLIENT_ID", "Paypack API credentials"],
  ["PAYPACK_CLIENT_SECRET", "Paypack API credentials"],
  ["PESAPAL_CONSUMER_KEY", "Pesapal API credentials"],
  ["PESAPAL_CONSUMER_SECRET", "Pesapal API credentials"],
];

const REQUIRED_BINDINGS: Array<[key: string, detail: string]> = [
  ["IMAGES", "R2 bucket serving product media"],
  ["OTP_KV", "KV namespace for phone-verification codes"],
];

export function validateEnv(env: object): EnvProblem[] {
  const problems: EnvProblem[] = [];
  const bindings = env as Record<string, unknown>;

  for (const [key, detail] of REQUIRED_STRINGS) {
    const value = bindings[key];
    if (typeof value !== "string" || value.trim() === "") {
      problems.push({ key, detail: `${detail}: missing ${key}` });
    }
  }

  for (const [key, detail] of REQUIRED_BINDINGS) {
    if (!bindings[key]) {
      problems.push({ key, detail: `${detail}: missing ${key} binding` });
    }
  }

  return problems;
}
