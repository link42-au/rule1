import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { describe, expect, it, vi } from "vitest";
import {
  assertSameOriginAssets,
  buildRuntimeAssetUrls,
  createRuntimeDependencies,
  initializeRule1Database,
  parseArtifactManifest,
  verifyDatabaseBytes,
} from "./runtime";

const SHA = "11".repeat(32);
const urls = {
  moduleUrl: "https://wan0.net/rule1/vendor/sqlite/index.mjs",
  manifestUrl: "https://wan0.net/rule1/data/rule1-artifact-manifest.json",
  databaseUrl: "https://wan0.net/rule1/data/rule1.sqlite3",
};
const manifest = {
  format_version: 1 as const,
  database: { path: "rule1.sqlite3", sha256: SHA, size_bytes: 3 },
};

const digest = (hex: string): ArrayBuffer =>
  Uint8Array.from(hex.match(/../g) ?? [], (part) => Number.parseInt(part, 16)).buffer;

class FakeDatabase {
  pointer = 7;
  close = vi.fn();
  checkRc = vi.fn();
  exec = vi.fn((options: { resultRows?: Record<string, unknown>[] }) => {
    options.resultRows?.push({ value: "ok" });
    return this;
  });
  selectObjects = vi.fn(() => [{ value: "ok" }]);
}

const sqliteMock = (install: () => Promise<unknown>) => {
  const databases: FakeDatabase[] = [];
  class DB extends FakeDatabase {
    constructor(..._args: unknown[]) {
      super();
      databases.push(this);
    }
  }
  const deserialize = vi.fn(() => 0);
  const sqlite = {
    version: { libVersion: "3.53.0" },
    installOpfsSAHPoolVfs: install,
    oo1: { DB },
    wasm: { allocFromTypedArray: vi.fn(() => 99) },
    capi: {
      SQLITE_DESERIALIZE_FREEONCLOSE: 1,
      SQLITE_DESERIALIZE_READONLY: 4,
      sqlite3_deserialize: deserialize,
    },
  } as unknown as Sqlite3Static;
  return { sqlite, databases, deserialize };
};

const response = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    json: vi.fn(async () => body),
    arrayBuffer: vi.fn(async () => body),
  }) as unknown as Response;

describe("browser SQLite runtime", () => {
  it("strictly validates the artifact manifest", () => {
    expect(parseArtifactManifest(manifest)).toEqual(manifest);
    expect(() => parseArtifactManifest({ ...manifest, database: { ...manifest.database, sha256: "bad" } })).toThrow(
      "manifest is invalid",
    );
  });

  it("rejects cross-origin runtime assets", () => {
    expect(() => assertSameOriginAssets(urls, "https://wan0.net/rule1/")).not.toThrow();
    expect(() =>
      assertSameOriginAssets({ ...urls, databaseUrl: "https://example.com/rule1.sqlite3" }, "https://wan0.net/rule1/"),
    ).toThrow("application origin");
  });

  it("builds all static assets beneath the configured Pages base path", () => {
    expect(buildRuntimeAssetUrls("/rule1", "https://wan0.net/rule1/explorer/")).toEqual(urls);
  });

  it("keeps the WorkerGlobalScope receiver when calling fetch", async () => {
    const subtle = { digest: vi.fn() } as unknown as SubtleCrypto;
    const scope = {
      crypto: { subtle },
      fetch(this: unknown) {
        if (this !== scope) throw new TypeError("Illegal invocation");
        return Promise.resolve(response({ ok: true }));
      },
    };
    const unboundFetch = scope.fetch;
    expect(() => unboundFetch()).toThrow("Illegal invocation");

    const dependencies = createRuntimeDependencies(scope as unknown as typeof globalThis);
    await expect(dependencies.fetch("https://wan0.net/rule1/data/manifest.json")).resolves.toBeDefined();
  });

  it("checks both database size and SHA-256", async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const subtle = { digest: vi.fn(async () => digest(SHA)) } as unknown as SubtleCrypto;
    await expect(verifyDatabaseBytes(bytes, manifest, subtle)).resolves.toBeUndefined();
    await expect(verifyDatabaseBytes(new Uint8Array([1]).buffer, manifest, subtle)).rejects.toThrow("size");
  });

  it("reuses the checksum-keyed OPFS database without downloading it", async () => {
    const filename = `/rule1-${SHA}.sqlite3`;
    const pool = {
      getFileNames: vi.fn(() => [filename]),
      unlink: vi.fn(),
      importDb: vi.fn(),
      vfsName: "rule1-opfs-sahpool",
    };
    const { sqlite } = sqliteMock(async () => pool);
    const fetchMock = vi.fn(async () => response(manifest));

    const runtime = await initializeRule1Database(sqlite, urls, {
      fetch: fetchMock as unknown as typeof fetch,
      subtle: { digest: vi.fn() } as unknown as SubtleCrypto,
    });

    expect(runtime.storage).toBe("opfs");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pool.importDb).not.toHaveBeenCalled();
    await expect(runtime.executor.all("select 1")).resolves.toEqual([{ value: "ok" }]);
  });

  it("downloads, verifies, and deserializes read-only when OPFS is unavailable", async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const { sqlite, deserialize } = sqliteMock(async () => {
      throw new Error("OPFS unavailable");
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(response(manifest)).mockResolvedValueOnce(response(bytes));
    const subtle = { digest: vi.fn(async () => digest(SHA)) } as unknown as SubtleCrypto;

    const runtime = await initializeRule1Database(sqlite, urls, {
      fetch: fetchMock as unknown as typeof fetch,
      subtle,
    });

    expect(runtime.storage).toBe("memory");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(deserialize).toHaveBeenCalledWith(7, "main", 99, 3, 3, 5);
    runtime.close();
  });
});
