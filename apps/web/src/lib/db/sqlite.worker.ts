import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { dispatchRule1Query } from "./queries";
import type { WorkerMessage, WorkerRequest, WorkerResponse } from "./rpc";
import { assertSameOriginAssets, initializeRule1Database, type Rule1DatabaseRuntime } from "./runtime";

type SqliteModule = { default: () => Promise<Sqlite3Static> };

let runtime: Rule1DatabaseRuntime | undefined;

const respond = (response: WorkerResponse): void => self.postMessage(response);
const reportProgress = (response: WorkerMessage): void => self.postMessage(response);

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : "Unknown database error.");

const initialize = async (request: Extract<WorkerRequest, { type: "initialize" }>): Promise<unknown> => {
  if (runtime) return { storage: runtime.storage, sqliteVersion: runtime.sqliteVersion };
  assertSameOriginAssets(request.assets, self.location.href);

  // The concurrent OPFS VFS needs headers GitHub Pages cannot set. SAH-pool is
  // worker-only, persistent, and header-free, so avoid loading the proxy VFSes.
  const sqliteGlobal = globalThis as typeof globalThis & {
    sqlite3ApiConfig?: { disable: { vfs: Record<string, boolean> } };
  };
  sqliteGlobal.sqlite3ApiConfig = { disable: { vfs: { opfs: true, "opfs-wl": true } } };
  const sqliteModule = (await import(/* @vite-ignore */ request.assets.moduleUrl)) as SqliteModule;
  const sqlite3 = await sqliteModule.default();
  runtime = await initializeRule1Database(sqlite3, request.assets, undefined, (progress) =>
    reportProgress({ id: request.id, type: "progress", progress }),
  );
  return { storage: runtime.storage, sqliteVersion: runtime.sqliteVersion };
};

self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    let result: unknown;
    if (request.type === "initialize") {
      result = await initialize(request);
    } else if (request.type === "close") {
      runtime?.close();
      runtime = undefined;
      result = null;
    } else {
      if (!runtime) throw new Error("The Rule1 database is not initialized.");
      result = await dispatchRule1Query(runtime.executor, request.method, request.params);
    }
    respond({ id: request.id, ok: true, result });
  } catch (error) {
    console.error("Rule1 database worker operation failed:", error);
    respond({ id: request.id, ok: false, error: errorMessage(error) });
  }
});
