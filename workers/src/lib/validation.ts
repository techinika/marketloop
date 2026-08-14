/**
 * Small hand-rolled request validators (deliberately no zod dependency).
 * They throw `BadRequestError`, which route handlers catch and translate into
 * 400 responses via `httpError`.
 */

export class BadRequestError extends Error {}

export function asString(value: unknown, label: string, max: number, min = 1): string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new BadRequestError(`${label} must be a string of ${min}-${max} characters`);
  }
  return value;
}

export function asBoolean(value: unknown, label: string, fallback?: boolean): boolean {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "boolean") throw new BadRequestError(`${label} must be a boolean`);
  return value;
}

export function asNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new BadRequestError(`${label} must be a number between ${min} and ${max}`);
  }
  return value;
}

export function asOneOf<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new BadRequestError(`${label} is not supported: ${String(value)}`);
  }
  return value as T;
}
