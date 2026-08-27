import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { describe, expect, it, vi } from "vitest";
import {
  assertSameOriginAssets,
  buildRuntimeAssetUrls,
  createRuntimeDependencies,
  initializeRule1Database,
  parseArtifactManifest,
  verifyDatabaseBytes,
  type DatabaseLoadProgress,
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
  selectValue: ReturnType<typeof vi.fn>;
  exec = vi.fn((options: { resultRows?: Record<string, unknown>[] }) => {
    options.resultRows?.push({ value: "ok" });
    return this;
  });
  selectObjects = vi.fn(() => [{ value: "ok" }]);

  constructor(
    readonly filename: string,
    quickCheck: (filename: string) => unknown,
  ) {
    this.selectValue = vi.fn((sql: string) => (sql === "PRAGMA quick_check" ? quickCheck(filename) : undefined));
  }
}

const sqliteMock = (install: () => Promise<unknown>, quickCheck: (filename: string) => unknown = () => "ok") => {
  const databases: FakeDatabase[] = [];
  class DB extends FakeDatabase {
    constructor(filename = ":memory:") {
      super(filename, quickCheck);
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

const opfsPool = (initialFilenames: string[]) => {
  const filenames = [...initialFilenames];
  const pool = {
    getFileNames: vi.fn(() => [...filenames]),
    unlink: vi.fn((filename: string) => {
      const index = filenames.indexOf(filename);
      if (index === -1) return false;
      filenames.splice(index, 1);
      return true;
    }),
    importDb: vi.fn(async (filename: string, bytes: ArrayBuffer) => {
      if (!filenames.includes(filename)) filenames.push(filename);
      return bytes.byteLength;
    }),
    vfsName: "rule1-opfs-sahpool",
  };
  return { filenames, pool };
};

const response = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    json: vi.fn(async () => body),
    arrayBuffer: vi.fn(async () => body),
    body: null,
    headers: new Headers(),
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
    const { pool } = opfsPool([filename]);
    const { sqlite } = sqliteMock(async () => pool);
    const fetchMock = vi.fn(async () => response(manifest));

    const onProgress = vi.fn();
    const runtime = await initializeRule1Database(
      sqlite,
      urls,
      {
        fetch: fetchMock as unknown as typeof fetch,
        subtle: { digest: vi.fn() } as unknown as SubtleCrypto,
      },
      onProgress,
    );

    expect(runtime.storage).toBe("opfs");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pool.importDb).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
    await expect(runtime.executor.all("select 1")).resolves.toEqual([{ value: "ok" }]);
  });

  it("replaces a cached database which fails its integrity check", async () => {
    const filename = `/rule1-${SHA}.sqlite3`;
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const { filenames, pool } = opfsPool([filename]);
    let checks = 0;
    const { sqlite, databases } = sqliteMock(
      async () => pool,
      () => (++checks === 1 ? "database disk image is malformed" : "ok"),
    );
    const fetchMock = vi.fn().mockResolvedValueOnce(response(manifest)).mockResolvedValueOnce(response(bytes));

    const runtime = await initializeRule1Database(sqlite, urls, {
      fetch: fetchMock as unknown as typeof fetch,
      subtle: { digest: vi.fn(async () => digest(SHA)) } as unknown as SubtleCrypto,
    });

    expect(databases[0]?.close).toHaveBeenCalledOnce();
    expect(pool.unlink).toHaveBeenCalledWith(filename);
    expect(pool.importDb).toHaveBeenCalledWith(filename, bytes);
    expect(filenames).toEqual([filename]);
    expect(runtime.storage).toBe("opfs");
  });

  it("retires the previous catalogue only after its replacement is verified and opened", async () => {
    const previousFilename = `/rule1-${"22".repeat(32)}.sqlite3`;
    const replacementFilename = `/rule1-${SHA}.sqlite3`;
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const { filenames, pool } = opfsPool([previousFilename]);
    pool.importDb.mockImplementationOnce(async (filename: string, imported: ArrayBuffer) => {
      expect(filenames).toContain(previousFilename);
      expect(pool.unlink).not.toHaveBeenCalledWith(previousFilename);
      filenames.push(filename);
      return imported.byteLength;
    });
    const { sqlite, databases } = sqliteMock(async () => pool);
    const fetchMock = vi.fn().mockResolvedValueOnce(response(manifest)).mockResolvedValueOnce(response(bytes));

    const runtime = await initializeRule1Database(sqlite, urls, {
      fetch: fetchMock as unknown as typeof fetch,
      subtle: { digest: vi.fn(async () => digest(SHA)) } as unknown as SubtleCrypto,
    });

    expect(pool.importDb).toHaveBeenCalledWith(replacementFilename, bytes);
    expect(databases.find((database) => database.filename === previousFilename)?.close).toHaveBeenCalledOnce();
    expect(pool.unlink).toHaveBeenCalledWith(previousFilename);
    expect(filenames).toEqual([replacementFilename]);
    expect(runtime.storage).toBe("opfs");
  });

  it("keeps serving the previous verified catalogue when a replacement download fails", async () => {
    const previousFilename = `/rule1-${"22".repeat(32)}.sqlite3`;
    const { filenames, pool } = opfsPool([previousFilename]);
    const { sqlite, databases } = sqliteMock(async () => pool);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(manifest))
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response);

    const runtime = await initializeRule1Database(sqlite, urls, {
      fetch: fetchMock as unknown as typeof fetch,
      subtle: { digest: vi.fn() } as unknown as SubtleCrypto,
    });

    expect(pool.importDb).not.toHaveBeenCalled();
    expect(pool.unlink).not.toHaveBeenCalledWith(previousFilename);
    expect(filenames).toEqual([previousFilename]);
    expect(databases.find((database) => database.filename === previousFilename)?.close).not.toHaveBeenCalled();
    expect(runtime.storage).toBe("opfs");
    await expect(runtime.executor.all("select 1")).resolves.toEqual([{ value: "ok" }]);
  });

  it("keeps serving the previous verified catalogue when replacement import fails", async () => {
    const previousFilename = `/rule1-${"22".repeat(32)}.sqlite3`;
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const { filenames, pool } = opfsPool([previousFilename]);
    pool.importDb.mockRejectedValueOnce(new Error("OPFS write failed"));
    const { sqlite } = sqliteMock(async () => pool);
    const fetchMock = vi.fn().mockResolvedValueOnce(response(manifest)).mockResolvedValueOnce(response(bytes));

    const runtime = await initializeRule1Database(sqlite, urls, {
      fetch: fetchMock as unknown as typeof fetch,
      subtle: { digest: vi.fn(async () => digest(SHA)) } as unknown as SubtleCrypto,
    });

    expect(pool.unlink).not.toHaveBeenCalledWith(previousFilename);
    expect(filenames).toEqual([previousFilename]);
    expect(runtime.storage).toBe("opfs");
    await expect(runtime.executor.all("select 1")).resolves.toEqual([{ value: "ok" }]);
  });

  it("rejects an invalid imported replacement without retiring the previous catalogue", async () => {
    const previousFilename = `/rule1-${"22".repeat(32)}.sqlite3`;
    const replacementFilename = `/rule1-${SHA}.sqlite3`;
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const { filenames, pool } = opfsPool([previousFilename]);
    const { sqlite, databases } = sqliteMock(
      async () => pool,
      (filename) => (filename === replacementFilename ? "database disk image is malformed" : "ok"),
    );
    const fetchMock = vi.fn().mockResolvedValueOnce(response(manifest)).mockResolvedValueOnce(response(bytes));

    const runtime = await initializeRule1Database(sqlite, urls, {
      fetch: fetchMock as unknown as typeof fetch,
      subtle: { digest: vi.fn(async () => digest(SHA)) } as unknown as SubtleCrypto,
    });

    expect(databases.find((database) => database.filename === replacementFilename)?.close).toHaveBeenCalledOnce();
    expect(pool.unlink).toHaveBeenCalledWith(replacementFilename);
    expect(pool.unlink).not.toHaveBeenCalledWith(previousFilename);
    expect(filenames).toEqual([previousFilename]);
    expect(runtime.storage).toBe("opfs");
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

  it("reports streamed download bytes, verification, and opening without a timer", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 2));
        controller.enqueue(bytes.slice(2));
        controller.close();
      },
    });
    const { sqlite } = sqliteMock(async () => {
      throw new Error("OPFS unavailable");
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(manifest))
      .mockResolvedValueOnce(new Response(stream, { headers: { "content-length": "3" } }));
    const progress: DatabaseLoadProgress[] = [];

    await initializeRule1Database(
      sqlite,
      urls,
      {
        fetch: fetchMock as unknown as typeof fetch,
        subtle: { digest: vi.fn(async () => digest(SHA)) } as unknown as SubtleCrypto,
      },
      (event) => progress.push(event),
    );

    expect(progress).toEqual([
      { stage: "downloading", receivedBytes: 0, totalBytes: 3 },
      { stage: "downloading", receivedBytes: 2, totalBytes: 3 },
      { stage: "downloading", receivedBytes: 3, totalBytes: 3 },
      { stage: "verifying" },
      { stage: "opening" },
    ]);
  });

  it("reports an unknown total when Content-Length is absent", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { sqlite } = sqliteMock(async () => {
      throw new Error("OPFS unavailable");
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(response(manifest)).mockResolvedValueOnce(new Response(bytes));
    const progress: DatabaseLoadProgress[] = [];

    await initializeRule1Database(
      sqlite,
      urls,
      {
        fetch: fetchMock as unknown as typeof fetch,
        subtle: { digest: vi.fn(async () => digest(SHA)) } as unknown as SubtleCrypto,
      },
      (event) => progress.push(event),
    );

    expect(progress[0]).toEqual({ stage: "downloading", receivedBytes: 0, totalBytes: null });
    expect(progress).toContainEqual({ stage: "downloading", receivedBytes: 3, totalBytes: null });
  });
});
