import { describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { databaseLoading } from "./loading";
import { createRule1DataClient, Rule1WorkerRpc, type WorkerMessage, type WorkerRequest } from "./rpc";

class FakeWorker extends EventTarget {
  postMessage = vi.fn();
  terminate = vi.fn();

  reply(response: WorkerMessage): void {
    this.dispatchEvent(new MessageEvent("message", { data: response }));
  }
}

describe("Rule1 worker RPC", () => {
  it("only sends a named query and resolves its matching response", async () => {
    const worker = new FakeWorker();
    const rpc = new Rule1WorkerRpc(worker as unknown as Worker);
    const pending = rpc.query<{ name: string }[]>("frameworks", {});
    const request = worker.postMessage.mock.calls[0]?.[0] as WorkerRequest;

    expect(request).toMatchObject({ id: 1, type: "query", method: "frameworks", params: {} });
    expect(request).not.toHaveProperty("sql");
    worker.reply({ id: 1, ok: true, result: [{ name: "ISM" }] });
    await expect(pending).resolves.toEqual([{ name: "ISM" }]);
  });

  it("maps the typed data client to fixed worker methods", async () => {
    const worker = new FakeWorker();
    const client = createRule1DataClient(new Rule1WorkerRpc(worker as unknown as Worker));
    const pending = client.stats({ framework: "ce" });
    const request = worker.postMessage.mock.calls[0]?.[0] as WorkerRequest;
    expect(request).toMatchObject({ type: "query", method: "stats", params: { framework: "ce" } });
    worker.reply({ id: 1, ok: true, result: { framework: "cyber-essentials", controls: 33 } });
    await expect(pending).resolves.toMatchObject({ framework: "cyber-essentials", controls: 33 });
  });

  it("maps ATT&CK requests to the fixed reviewed-mapping worker method", async () => {
    const worker = new FakeWorker();
    const client = createRule1DataClient(new Rule1WorkerRpc(worker as unknown as Worker));
    const pending = client.attackMappings({ framework: "ism", id: "ism-1173" });
    const request = worker.postMessage.mock.calls[0]?.[0] as WorkerRequest;
    expect(request).toMatchObject({
      type: "query",
      method: "attackMappings",
      params: { framework: "ism", id: "ism-1173" },
    });
    worker.reply({
      id: 1,
      ok: true,
      result: { ismCatalogVersion: null, attackVersion: null, mappings: [], procedures: [] },
    });
    await expect(pending).resolves.toEqual({
      ismCatalogVersion: null,
      attackVersion: null,
      mappings: [],
      procedures: [],
    });
  });

  it("forwards database progress and clears it when initialization finishes", async () => {
    const worker = new FakeWorker();
    const rpc = new Rule1WorkerRpc(worker as unknown as Worker);
    const pending = rpc.initialize({ moduleUrl: "/module", manifestUrl: "/manifest", databaseUrl: "/database" });

    expect(get(databaseLoading)).toEqual({ visible: true, stage: "opening" });

    worker.reply({ id: 1, type: "progress", progress: { stage: "downloading", receivedBytes: 10, totalBytes: 100 } });
    expect(get(databaseLoading)).toEqual({
      visible: true,
      stage: "downloading",
      receivedBytes: 10,
      totalBytes: 100,
    });

    worker.reply({ id: 1, ok: true, result: { storage: "opfs", sqliteVersion: "3.53.0" } });
    await expect(pending).resolves.toMatchObject({ storage: "opfs" });
    expect(get(databaseLoading)).toEqual({ visible: false });
  });

  it("covers worker startup and cache opening even when no download progress is reported", async () => {
    const worker = new FakeWorker();
    const rpc = new Rule1WorkerRpc(worker as unknown as Worker);
    const pending = rpc.initialize({ moduleUrl: "/module", manifestUrl: "/manifest", databaseUrl: "/database" });

    expect(get(databaseLoading)).toEqual({ visible: true, stage: "opening" });
    worker.reply({ id: 1, ok: true, result: { storage: "opfs", sqliteVersion: "3.53.0" } });
    await expect(pending).resolves.toMatchObject({ storage: "opfs" });
    expect(get(databaseLoading)).toEqual({ visible: false });
  });

  it("does not let an older route initialization clear a newer route's cover", async () => {
    const oldWorker = new FakeWorker();
    const newWorker = new FakeWorker();
    const oldPending = new Rule1WorkerRpc(oldWorker as unknown as Worker).initialize({
      moduleUrl: "/module",
      manifestUrl: "/manifest",
      databaseUrl: "/database",
    });
    const newPending = new Rule1WorkerRpc(newWorker as unknown as Worker).initialize({
      moduleUrl: "/module",
      manifestUrl: "/manifest",
      databaseUrl: "/database",
    });

    oldWorker.reply({ id: 1, ok: true, result: { storage: "opfs", sqliteVersion: "3.53.0" } });
    await oldPending;
    expect(get(databaseLoading)).toEqual({ visible: true, stage: "opening" });

    newWorker.reply({ id: 1, ok: true, result: { storage: "opfs", sqliteVersion: "3.53.0" } });
    await newPending;
    expect(get(databaseLoading)).toEqual({ visible: false });
  });

  it("rejects worker-reported failures and terminates after close", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const worker = new FakeWorker();
    const rpc = new Rule1WorkerRpc(worker as unknown as Worker);
    const pending = rpc.query("control", { framework: "ism", id: "0001" });
    worker.reply({ id: 1, ok: false, error: "not found" });
    await expect(pending).rejects.toThrow("not found");
    expect(consoleError).toHaveBeenCalledWith("Rule1 database worker request failed:", expect.any(Error));

    const closing = rpc.close();
    worker.reply({ id: 2, ok: true, result: null });
    await closing;
    expect(worker.terminate).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
