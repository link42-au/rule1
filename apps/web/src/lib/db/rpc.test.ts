import { describe, expect, it, vi } from "vitest";
import { createRule1DataClient, Rule1WorkerRpc, type WorkerRequest, type WorkerResponse } from "./rpc";

class FakeWorker extends EventTarget {
  postMessage = vi.fn();
  terminate = vi.fn();

  reply(response: WorkerResponse): void {
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
