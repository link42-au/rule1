import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";

import { runDeploymentCanary } from "./post-deploy-canary.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const CONTRACT_SHA = sha256("validation contract");

const createManifest = (database) => ({
  format_version: 1,
  database: {
    path: "rule1.sqlite3",
    sha256: sha256(database),
    size_bytes: database.length,
  },
  validation_contract: {
    path: "ingestion/validation-contract.json",
    sha256: CONTRACT_SHA,
  },
});

const startDeployment = async ({ database, manifest = createManifest(database), missingAsset = false }) => {
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(
        '<link rel="stylesheet" href="./_app/immutable/assets/app.ABC123.css"><script src="./_app/immutable/entry/start.DEF456.js"></script>',
      );
      return;
    }
    if (path === "/_app/immutable/assets/app.ABC123.css") {
      if (missingAsset) {
        response.writeHead(404).end("missing");
      } else {
        response.end("body { color: black; }");
      }
      return;
    }
    if (path === "/_app/immutable/entry/start.DEF456.js") {
      response.end("export const started = true;");
      return;
    }
    if (path === "/data/rule1-artifact-manifest.json") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(manifest));
      return;
    }
    if (path === "/data/rule1.sqlite3") {
      response.end(database);
      return;
    }
    response.writeHead(404).end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
    url: `http://127.0.0.1:${address.port}/`,
  };
};

test("deployment canary verifies current immutable assets and database bytes", async (t) => {
  const database = Buffer.from("verified sqlite bytes");
  const deployment = await startDeployment({ database });
  t.after(deployment.close);

  const result = await runDeploymentCanary(deployment.url.replace(/\/$/, ""), createManifest(database), {
    attempts: 1,
    delayMs: 0,
  });

  assert.equal(result.assets, 2);
  assert.deepEqual(result.database, { sha256: sha256(database), size: database.length });
});

test("deployment canary rejects a missing immutable asset", async (t) => {
  const database = Buffer.from("verified sqlite bytes");
  const deployment = await startDeployment({ database, missingAsset: true });
  t.after(deployment.close);

  await assert.rejects(
    runDeploymentCanary(deployment.url, createManifest(database), { attempts: 1, delayMs: 0 }),
    /Immutable application asset returned HTTP 404/,
  );
});

test("deployment canary rejects a manifest from a different build", async (t) => {
  const database = Buffer.from("verified sqlite bytes");
  const deployment = await startDeployment({
    database,
    manifest: createManifest(Buffer.from("different sqlite bytes")),
  });
  t.after(deployment.close);

  await assert.rejects(
    runDeploymentCanary(deployment.url, createManifest(database), { attempts: 1, delayMs: 0 }),
    /Deployed artifact manifest does not match the verified build artifact/,
  );
});

test("deployment canary rejects database bytes that do not match the manifest", async (t) => {
  const database = Buffer.from("deployed sqlite bytes");
  const expectedDatabase = Buffer.from("verified sqlite bytes");
  const expectedManifest = createManifest(expectedDatabase);
  const deployment = await startDeployment({ database, manifest: expectedManifest });
  t.after(deployment.close);

  await assert.rejects(
    runDeploymentCanary(deployment.url, expectedManifest, { attempts: 1, delayMs: 0 }),
    /Deployed database does not match its artifact manifest/,
  );
});
