import { getFirestoreAccessToken } from "./jwt";

const FIRESTORE_API = "https://firestore.googleapis.com/v1";

export interface FirestoreOptions {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  /** Override the Firestore REST base URL (used in tests). */
  apiUrl?: string;
  /** Override access-token acquisition (used in tests). */
  accessTokenProvider?: () => Promise<string>;
}

/** Env fields the Firestore client needs (plus test overrides). */
export interface FirestoreEnv {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_CLIENT_EMAIL: string;
  FIREBASE_PRIVATE_KEY: string;
  /** Test override: Firestore REST base URL. */
  FIRESTORE_API_URL?: string;
  /** Test override: fixed access token instead of a signed service-account JWT. */
  FIRESTORE_ACCESS_TOKEN?: string;
}

/** Builds a FirestoreClient from Worker bindings / `.dev.vars`. */
export function firestoreFromEnv(env: FirestoreEnv): FirestoreClient {
  return new FirestoreClient({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY,
    apiUrl: env.FIRESTORE_API_URL,
    accessTokenProvider: env.FIRESTORE_ACCESS_TOKEN
      ? async () => env.FIRESTORE_ACCESS_TOKEN!
      : undefined,
  });
}

export interface FirestoreField {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  timestampValue?: string;
  mapValue?: { fields: Record<string, FirestoreField> };
  arrayValue?: { values: FirestoreField[] };
  referenceValue?: string;
}

export interface FirestoreDocument {
  name: string;
  fields?: Record<string, FirestoreField>;
  createTime?: string;
  updateTime?: string;
}

export class FirestoreError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Firestore request failed (${status}): ${body}`);
  }
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

export type WithId<T> = T & { id: string };

export type FieldOperator =
  | "<"
  | "<="
  | "=="
  | "!="
  | ">="
  | ">"
  | "array-contains"
  | "in";

export interface QueryFilter {
  field: string;
  op: FieldOperator;
  value: unknown;
}

export interface QueryOptions {
  filters?: QueryFilter[];
  orderBy?: { field: string; direction?: "ASCENDING" | "DESCENDING" };
  /** Number of matching documents to skip (for pagination). */
  offset?: number;
  limit?: number;
}

const OP_MAP: Record<FieldOperator, string> = {
  "<": "LESS_THAN",
  "<=": "LESS_THAN_OR_EQUAL",
  "==": "EQUAL",
  "!=": "NOT_EQUAL",
  ">=": "GREATER_THAN_OR_EQUAL",
  ">": "GREATER_THAN",
  "array-contains": "ARRAY_CONTAINS",
  "in": "IN",
};

function docId(name: string): string {
  return name.split("/").pop() ?? name;
}

function fieldFilter(filter: QueryFilter) {
  return {
    fieldFilter: {
      field: { fieldPath: filter.field },
      op: OP_MAP[filter.op],
      value: encodeValue(filter.value),
    },
  };
}

function buildStructuredQuery(collectionId: string, opts: QueryOptions) {
  const query: Record<string, unknown> = { from: [{ collectionId }] };
  const filters = opts.filters ?? [];
  if (filters.length > 0) {
    query.where =
      filters.length === 1
        ? fieldFilter(filters[0]!)
        : { compositeFilter: { op: "AND", filters: filters.map(fieldFilter) } };
  }
  if (opts.orderBy) {
    query.orderBy = [
      {
        field: { fieldPath: opts.orderBy.field },
        direction: opts.orderBy.direction ?? "ASCENDING",
      },
    ];
  }
  if (opts.limit) query.limit = opts.limit;
  if (opts.offset) query.offset = opts.offset;
  return query;
}

function normalizePrivateKey(key: string): string {
  return key.replace(/\\n/g, "\n");
}

function encodeValue(value: unknown): FirestoreField {
  if (value === null || value === undefined) return { nullValue: null };
  switch (typeof value) {
    case "string":
      return { stringValue: value };
    case "boolean":
      return { booleanValue: value };
    case "number":
      return Number.isInteger(value)
        ? { integerValue: String(value) }
        : { doubleValue: value };
    case "object":
      if (Array.isArray(value)) {
        return { arrayValue: { values: value.map(encodeValue) } };
      }
      if (value instanceof Date) {
        return { timestampValue: value.toISOString() };
      }
      return { mapValue: { fields: encodeFields(value as Record<string, unknown>) } };
    default:
      throw new Error(`Unsupported Firestore value: ${typeof value}`);
  }
}

function encodeFields(data: Record<string, unknown>): Record<string, FirestoreField> {
  const fields: Record<string, FirestoreField> = {};
  for (const [key, value] of Object.entries(data)) {
    fields[key] = encodeValue(value);
  }
  return fields;
}

export { encodeFields };

export function decodeValue(field: FirestoreField): unknown {
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.integerValue !== undefined) return Number(field.integerValue);
  if (field.doubleValue !== undefined) return field.doubleValue;
  if (field.booleanValue !== undefined) return field.booleanValue;
  if (field.nullValue !== undefined) return null;
  if (field.timestampValue !== undefined) return field.timestampValue;
  if (field.arrayValue !== undefined) return field.arrayValue.values.map(decodeValue);
  if (field.referenceValue !== undefined) return field.referenceValue;
  if (field.mapValue !== undefined) return decodeFields(field.mapValue.fields);
  return undefined;
}

export function decodeDocument(doc: FirestoreDocument): Record<string, unknown> {
  return decodeFields(doc.fields ?? {});
}

function decodeFields(fields: Record<string, FirestoreField>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = decodeValue(value);
  }
  return out;
}

/**
 * Minimal Firestore REST client for the Workers runtime.
 * The Admin SDK cannot run on Workers, so this talks to the Firestore REST API
 * directly, authenticating with a manually-signed service account JWT
 * (see `lib/jwt.ts` — Web Crypto, no Node crypto dependency).
 */
export class FirestoreClient {
  private tokenCache: TokenCache | null = null;

  constructor(private readonly options: FirestoreOptions) {}

  private get root(): string {
    const apiUrl = this.options.apiUrl ?? FIRESTORE_API;
    return `${apiUrl}/projects/${this.options.projectId}/databases/(default)/documents`;
  }

  private async accessToken(): Promise<string> {
    if (this.options.accessTokenProvider) {
      return this.options.accessTokenProvider();
    }
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60_000) {
      return this.tokenCache.token;
    }
    const token = await getFirestoreAccessToken(
      this.options.clientEmail,
      normalizePrivateKey(this.options.privateKey),
    );
    this.tokenCache = { token, expiresAt: Date.now() + 55 * 60_000 };
    return token;
  }

  private async requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await this.accessToken()}`);
    headers.set("Content-Type", "application/json");

    const res = await fetch(`${this.root}${path}`, { ...init, headers });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new FirestoreError(res.status, await res.text());
    }
    if (res.status === 204) return null;
    return res.json();
  }

  private async request(path: string, init: RequestInit = {}): Promise<FirestoreDocument | null> {
    return (await this.requestJson(path, init)) as FirestoreDocument | null;
  }

  async get(path: string): Promise<FirestoreDocument | null> {
    return this.request(`/${path}`);
  }

  async getData(path: string): Promise<Record<string, unknown> | null> {
    const doc = await this.get(path);
    return doc ? decodeDocument(doc) : null;
  }

  async create(
    path: string,
    documentId: string | undefined,
    data: Record<string, unknown>,
  ): Promise<FirestoreDocument> {
    const params = documentId ? new URLSearchParams({ documentId }) : new URLSearchParams();
    const qs = params.toString();
    return this.request(`/${path}${qs ? `?${qs}` : ""}`, {
      method: "POST",
      body: JSON.stringify({ fields: encodeFields(data) }),
    }) as Promise<FirestoreDocument>;
  }

  async update(path: string, data: Record<string, unknown>): Promise<FirestoreDocument> {
    const fieldPaths = Object.keys(data).map(
      (key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`,
    );
    return this.request(`/${path}?${fieldPaths.join("&")}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: `${this.root}/${path}`,
        fields: encodeFields(data),
      }),
    }) as Promise<FirestoreDocument>;
  }

  async remove(path: string): Promise<void> {
    await this.request(`/${path}`, { method: "DELETE" });
  }

  // ---- Typed helpers -------------------------------------------------------

  /** Reads one document and decodes its fields. Returns null if not found. */
  async getDoc<T extends object>(path: string): Promise<WithId<T> | null> {
    const doc = await this.get(path);
    if (!doc) return null;
    return { id: docId(doc.name), ...(decodeDocument(doc) as T) };
  }

  /** Creates a document under `path` with the given `documentId`
   * (or lets Firestore generate one when `documentId` is undefined). */
  async createDoc<T extends object>(
    path: string,
    documentId: string | undefined,
    data: T,
  ): Promise<WithId<T>> {
    const doc = await this.create(path, documentId, data as Record<string, unknown>);
    return { id: docId(doc.name), ...(decodeDocument(doc) as T) };
  }

  /** Updates the given fields of an existing document. */
  async updateDoc<T extends object>(
    path: string,
    data: Partial<T>,
  ): Promise<WithId<T>> {
    const doc = await this.update(path, data as Record<string, unknown>);
    return { id: docId(doc.name), ...(decodeDocument(doc) as T) };
  }

  /** Queries a collection via the Firestore `runQuery` endpoint. */
  async queryCollection<T extends object>(
    collectionPath: string,
    opts: QueryOptions = {},
  ): Promise<WithId<T>[]> {
    const structuredQuery = buildStructuredQuery(collectionPath, opts);
    const results = (await this.requestJson(`/${collectionPath}:runQuery`, {
      method: "POST",
      body: JSON.stringify({ structuredQuery }),
    })) as Array<{ document?: FirestoreDocument }> | null;
    if (!results) return [];
    return results
      .filter((r) => r.document)
      .map((r) => ({
        id: docId(r.document!.name),
        ...(decodeDocument(r.document!) as T),
      }));
  }
}
