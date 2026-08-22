import type { DatabaseLoadProgress, RuntimeAssetUrls } from "./runtime";
import { buildRuntimeAssetUrls } from "./runtime";
import { databaseLoading } from "./loading";
import type {
  CompareParams,
  ControlParams,
  E8Mapping,
  E8MappingParams,
  FrameworkParams,
  PrinciplesResult,
  Rule1DataClient,
  TermsResult,
} from "./contracts";
import type { Rule1QueryMethod } from "./queries";

export interface RuntimeInfo {
  storage: "opfs" | "memory";
  sqliteVersion: string;
}

export type WorkerRequest =
  | { id: number; type: "initialize"; assets: RuntimeAssetUrls }
  | { id: number; type: "query"; method: Rule1QueryMethod; params: unknown }
  | { id: number; type: "close" };

export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
export type WorkerProgressResponse = { id: number; type: "progress"; progress: DatabaseLoadProgress };
export type WorkerMessage = WorkerResponse | WorkerProgressResponse;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

type RequestWithoutId = WorkerRequest extends infer Request
  ? Request extends { id: number }
    ? Omit<Request, "id">
    : never
  : never;

export class Rule1WorkerRpc {
  readonly #worker: Worker;
  readonly #pending = new Map<number, PendingRequest>();
  #nextId = 1;
  #reportedProgress = false;

  constructor(worker: Worker) {
    this.#worker = worker;
    worker.addEventListener("message", this.#handleMessage);
    worker.addEventListener("error", this.#handleWorkerError);
  }

  initialize(assets: RuntimeAssetUrls): Promise<RuntimeInfo> {
    return this.#request({ type: "initialize", assets }) as Promise<RuntimeInfo>;
  }

  query<T>(method: Rule1QueryMethod, params: unknown): Promise<T> {
    return this.#request({ type: "query", method, params }) as Promise<T>;
  }

  async close(): Promise<void> {
    try {
      await this.#request({ type: "close" });
    } finally {
      this.terminate();
    }
  }

  terminate(): void {
    this.#worker.removeEventListener("message", this.#handleMessage);
    this.#worker.removeEventListener("error", this.#handleWorkerError);
    this.#worker.terminate();
    this.#finishProgress();
  }

  #request(request: RequestWithoutId): Promise<unknown> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({ ...request, id } satisfies WorkerRequest);
    });
  }

  #handleMessage = (event: MessageEvent<WorkerMessage>): void => {
    if ("type" in event.data) {
      this.#reportedProgress = true;
      databaseLoading.report(event.data.progress);
      return;
    }
    const pending = this.#pending.get(event.data.id);
    if (!pending) return;
    this.#pending.delete(event.data.id);
    if (event.data.ok) {
      pending.resolve(event.data.result);
      this.#finishProgress();
    } else if ("error" in event.data) {
      const error = new Error(event.data.error);
      console.error("Rule1 database worker request failed:", error);
      pending.reject(error);
      this.#finishProgress();
    }
  };

  #handleWorkerError = (event: ErrorEvent): void => {
    const error = new Error(event.message || "The Rule1 database worker failed.");
    console.error("Rule1 database worker crashed:", error);
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    this.#finishProgress();
  };

  #finishProgress = (): void => {
    if (!this.#reportedProgress) return;
    databaseLoading.finish();
    this.#reportedProgress = false;
  };
}

export const createRule1WorkerRpc = (): Rule1WorkerRpc =>
  new Rule1WorkerRpc(new Worker(new URL("./sqlite.worker.ts", import.meta.url), { type: "module" }));

export const createRule1DataClient = (rpc: Rule1WorkerRpc): Rule1DataClient => ({
  frameworks: () => rpc.query("frameworks", {}),
  stats: (params: FrameworkParams) => rpc.query("stats", params),
  versions: (params: FrameworkParams) => rpc.query("versions", params),
  guidelines: (params: FrameworkParams) => rpc.query("guidelines", params),
  principles: (params: FrameworkParams): Promise<PrinciplesResult> => rpc.query("principles", params),
  sections: (params: FrameworkParams) => rpc.query("sections", params),
  groups: (params: FrameworkParams) => rpc.query("groups", params),
  controls: (params: FrameworkParams) => rpc.query("controls", params),
  control: (params: ControlParams) => rpc.query("control", params),
  controlHistory: (params: ControlParams) => rpc.query("controlHistory", params),
  e8Mappings: (params: E8MappingParams): Promise<E8Mapping[]> => rpc.query("e8Mappings", params),
  graph: (params: ControlParams) => rpc.query("graph", params),
  compare: (params: CompareParams) => rpc.query("compare", params),
  terms: (params: FrameworkParams): Promise<TermsResult> => rpc.query("terms", params),
  term: (params: ControlParams) => rpc.query("term", params),
});

export interface OpenRule1DataClient {
  client: Rule1DataClient;
  runtime: RuntimeInfo;
  close: () => Promise<void>;
}

export const openRule1DataClient = async (
  basePath: string,
  locationUrl: string = window.location.href,
): Promise<OpenRule1DataClient> => {
  const rpc = createRule1WorkerRpc();
  try {
    const runtime = await rpc.initialize(buildRuntimeAssetUrls(basePath, locationUrl));
    return { client: createRule1DataClient(rpc), runtime, close: () => rpc.close() };
  } catch (error) {
    rpc.terminate();
    throw error;
  }
};
