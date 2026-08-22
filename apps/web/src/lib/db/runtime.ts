import type { Database, Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import type { QueryExecutor } from "./queries";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CACHE_FILE_PREFIX = "/rule1-";

export interface DatabaseArtifactManifest {
  format_version: 1;
  database: {
    path: string;
    sha256: string;
    size_bytes: number;
  };
}

export interface RuntimeAssetUrls {
  moduleUrl: string;
  manifestUrl: string;
  databaseUrl: string;
}

export const buildRuntimeAssetUrls = (basePath: string, locationUrl: string): RuntimeAssetUrls => {
  if (basePath !== "" && !basePath.startsWith("/")) {
    throw new Error("The Rule1 application base path must be absolute.");
  }
  const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const assetUrl = (path: string): string => new URL(`${base}${path}`, locationUrl).href;
  return {
    moduleUrl: assetUrl("/vendor/sqlite/index.mjs"),
    manifestUrl: assetUrl("/data/rule1-artifact-manifest.json"),
    databaseUrl: assetUrl("/data/rule1.sqlite3"),
  };
};

export interface Rule1DatabaseRuntime {
  executor: QueryExecutor;
  storage: "opfs" | "memory";
  sqliteVersion: string;
  close: () => void;
}

export type DatabaseLoadProgress =
  | { stage: "downloading"; receivedBytes: number; totalBytes: number | null }
  | { stage: "verifying" }
  | { stage: "opening" };

export type RuntimeDependencies = {
  fetch: typeof fetch;
  subtle: SubtleCrypto;
};

type RuntimeGlobal = {
  fetch: typeof fetch;
  crypto: { subtle: SubtleCrypto };
};

export const createRuntimeDependencies = (scope: RuntimeGlobal): RuntimeDependencies => ({
  // Chromium's WorkerGlobalScope.fetch requires its global receiver. Keeping
  // the lookup on scope avoids an "Illegal invocation" from an unbound fetch.
  fetch: (input, init) => scope.fetch(input, init),
  subtle: scope.crypto.subtle,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseArtifactManifest = (value: unknown): DatabaseArtifactManifest => {
  if (!isRecord(value) || value.format_version !== 1 || !isRecord(value.database)) {
    throw new Error("The Rule1 database manifest has an unsupported format.");
  }

  const { path, sha256, size_bytes: sizeBytes } = value.database;
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    typeof sha256 !== "string" ||
    !SHA256_PATTERN.test(sha256) ||
    typeof sizeBytes !== "number" ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0
  ) {
    throw new Error("The Rule1 database manifest is invalid.");
  }

  return {
    format_version: 1,
    database: { path, sha256, size_bytes: sizeBytes },
  };
};

export const assertSameOriginAssets = (urls: RuntimeAssetUrls, locationUrl: string): void => {
  const origin = new URL(locationUrl).origin;
  for (const candidate of Object.values(urls)) {
    if (new URL(candidate, locationUrl).origin !== origin) {
      throw new Error("Rule1 database assets must be loaded from the application origin.");
    }
  }
};

const bytesToHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

export const verifyDatabaseBytes = async (
  bytes: ArrayBuffer,
  manifest: DatabaseArtifactManifest,
  subtle: SubtleCrypto,
): Promise<void> => {
  if (bytes.byteLength !== manifest.database.size_bytes) {
    throw new Error("The downloaded Rule1 database size does not match its manifest.");
  }
  const actualSha256 = bytesToHex(await subtle.digest("SHA-256", bytes));
  if (actualSha256 !== manifest.database.sha256) {
    throw new Error("The downloaded Rule1 database checksum does not match its manifest.");
  }
};

const fetchManifest = async (url: string, fetchImpl: typeof fetch): Promise<DatabaseArtifactManifest> => {
  const response = await fetchImpl(url, { cache: "no-cache", credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`Unable to load the Rule1 database manifest (${response.status}).`);
  }
  return parseArtifactManifest(await response.json());
};

const fetchDatabase = async (
  url: string,
  manifest: DatabaseArtifactManifest,
  dependencies: RuntimeDependencies,
  onProgress: (progress: DatabaseLoadProgress) => void,
): Promise<ArrayBuffer> => {
  const response = await dependencies.fetch(url, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`Unable to load the Rule1 database (${response.status}).`);
  }

  const contentLength = response.headers.get("content-length");
  const parsedContentLength = contentLength === null ? Number.NaN : Number(contentLength);
  const totalBytes = Number.isSafeInteger(parsedContentLength) && parsedContentLength > 0 ? parsedContentLength : null;
  let receivedBytes = 0;
  onProgress({ stage: "downloading", receivedBytes, totalBytes });

  let bytes: ArrayBuffer;
  if (response.body) {
    const reader = response.body.getReader();
    const destination = new Uint8Array(manifest.database.size_bytes);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (receivedBytes + value.byteLength > destination.byteLength) {
        throw new Error("The downloaded Rule1 database size does not match its manifest.");
      }
      destination.set(value, receivedBytes);
      receivedBytes += value.byteLength;
      onProgress({ stage: "downloading", receivedBytes, totalBytes });
    }
    bytes = destination.buffer.slice(0, receivedBytes);
  } else {
    bytes = await response.arrayBuffer();
    receivedBytes = bytes.byteLength;
    onProgress({ stage: "downloading", receivedBytes, totalBytes });
  }

  onProgress({ stage: "verifying" });
  await verifyDatabaseBytes(bytes, manifest, dependencies.subtle);
  return bytes;
};

const createExecutor = (db: Database): QueryExecutor => ({
  all: async <T extends Record<string, unknown>>(sql: string, bind): Promise<T[]> => db.selectObjects(sql, bind) as T[],
});

const openCachedDatabase = async (
  sqlite3: Sqlite3Static,
  manifest: DatabaseArtifactManifest,
  getBytes: () => Promise<ArrayBuffer>,
  onProgress: (progress: DatabaseLoadProgress) => void,
): Promise<Database> => {
  const pool = await sqlite3.installOpfsSAHPoolVfs({
    name: "rule1-opfs-sahpool",
    directory: ".rule1-opfs-sahpool",
    initialCapacity: 4,
  });
  const filename = `${CACHE_FILE_PREFIX}${manifest.database.sha256}.sqlite3`;

  for (const existing of pool.getFileNames()) {
    if (existing.startsWith(CACHE_FILE_PREFIX) && existing !== filename) {
      pool.unlink(existing);
    }
  }
  if (!pool.getFileNames().includes(filename)) {
    const bytes = await getBytes();
    onProgress({ stage: "opening" });
    pool.importDb(filename, bytes);
  }

  return new sqlite3.oo1.DB(filename, "r", pool.vfsName);
};

const openMemoryDatabase = (sqlite3: Sqlite3Static, bytes: ArrayBuffer): Database => {
  const db = new sqlite3.oo1.DB();
  const pointer = sqlite3.wasm.allocFromTypedArray(bytes);
  const result = sqlite3.capi.sqlite3_deserialize(
    db.pointer,
    "main",
    pointer,
    bytes.byteLength,
    bytes.byteLength,
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_READONLY,
  );
  db.checkRc(result);
  return db;
};

export const initializeRule1Database = async (
  sqlite3: Sqlite3Static,
  urls: RuntimeAssetUrls,
  dependencies: RuntimeDependencies = createRuntimeDependencies(globalThis),
  onProgress: (progress: DatabaseLoadProgress) => void = () => undefined,
): Promise<Rule1DatabaseRuntime> => {
  const manifest = await fetchManifest(urls.manifestUrl, dependencies.fetch);
  let databaseBytes: Promise<ArrayBuffer> | undefined;
  const getBytes = (): Promise<ArrayBuffer> => {
    databaseBytes ??= fetchDatabase(urls.databaseUrl, manifest, dependencies, onProgress);
    return databaseBytes;
  };

  let db: Database;
  let storage: "opfs" | "memory";
  try {
    db = await openCachedDatabase(sqlite3, manifest, getBytes, onProgress);
    storage = "opfs";
  } catch {
    const bytes = await getBytes();
    onProgress({ stage: "opening" });
    db = openMemoryDatabase(sqlite3, bytes);
    storage = "memory";
  }

  return {
    executor: createExecutor(db),
    storage,
    sqliteVersion: sqlite3.version.libVersion,
    close: () => db.close(),
  };
};
