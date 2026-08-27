import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const DEFAULT_ATTEMPTS = 6;
const DEFAULT_DELAY_MS = 10_000;
const REQUEST_TIMEOUT_MS = 120_000;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const withCacheBuster = (url, attempt) => {
  const result = new URL(url);
  result.searchParams.set("rule1-canary", `${Date.now()}-${attempt}`);
  return result;
};

const fetchRequired = async (url, description) => {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "cache-control": "no-cache" },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${description} returned HTTP ${response.status} at ${response.url || url}.`);
  }
  return response;
};

const normaliseManifest = (manifest) => ({
  format_version: manifest?.format_version,
  database: {
    path: manifest?.database?.path,
    sha256: manifest?.database?.sha256,
    size_bytes: manifest?.database?.size_bytes,
  },
  validation_contract: {
    path: manifest?.validation_contract?.path,
    sha256: manifest?.validation_contract?.sha256,
  },
});

const assertManifest = (manifest, description) => {
  const value = normaliseManifest(manifest);
  if (value.format_version !== 1) throw new Error(`${description} has an unsupported format version.`);
  if (value.database.path !== "rule1.sqlite3") {
    throw new Error(`${description} does not reference the expected database path.`);
  }
  if (!/^[a-f0-9]{64}$/.test(value.database.sha256)) {
    throw new Error(`${description} has an invalid database SHA-256 digest.`);
  }
  if (!Number.isSafeInteger(value.database.size_bytes) || value.database.size_bytes <= 0) {
    throw new Error(`${description} has an invalid database size.`);
  }
  if (value.validation_contract.path !== "ingestion/validation-contract.json") {
    throw new Error(`${description} does not reference the expected validation contract.`);
  }
  if (!/^[a-f0-9]{64}$/.test(value.validation_contract.sha256)) {
    throw new Error(`${description} has an invalid validation-contract SHA-256 digest.`);
  }
  return value;
};

const assertMatchingManifests = (deployed, expected) => {
  const actualJson = JSON.stringify(assertManifest(deployed, "Deployed artifact manifest"));
  const expectedJson = JSON.stringify(assertManifest(expected, "Verified artifact manifest"));
  if (actualJson !== expectedJson) {
    throw new Error("Deployed artifact manifest does not match the verified build artifact.");
  }
};

const immutableAssetsFromHtml = (html, documentUrl) => {
  const assets = new Set();
  const reference = /\b(?:href|src)\s*=\s*["']([^"']+)["']/g;
  for (const match of html.matchAll(reference)) {
    const asset = new URL(match[1], documentUrl);
    if (!asset.pathname.includes("/_app/immutable/")) continue;
    if (asset.origin !== new URL(documentUrl).origin) {
      throw new Error(`HTML references a cross-origin immutable asset: ${asset}.`);
    }
    assets.add(asset.href);
  }
  if (assets.size === 0) throw new Error("Deployed HTML does not reference any immutable application assets.");
  return [...assets];
};

const consumeNonEmpty = async (response, description) => {
  let bytes = 0;
  for await (const chunk of response.body) bytes += chunk.byteLength;
  if (bytes === 0) throw new Error(`${description} returned an empty response body.`);
};

const digestResponse = async (response) => {
  const digest = createHash("sha256");
  let size = 0;
  for await (const chunk of response.body) {
    digest.update(chunk);
    size += chunk.byteLength;
  }
  return { sha256: digest.digest("hex"), size };
};

const checkDeployment = async (deploymentUrl, expectedManifest, attempt) => {
  const pageResponse = await fetchRequired(withCacheBuster(deploymentUrl, attempt), "Deployed HTML");
  const pageUrl = new URL(pageResponse.url);
  const html = await pageResponse.text();
  const immutableAssets = immutableAssetsFromHtml(html, pageUrl);

  await Promise.all(
    immutableAssets.map(async (asset) => {
      const response = await fetchRequired(asset, "Immutable application asset");
      await consumeNonEmpty(response, `Immutable application asset ${asset}`);
    }),
  );

  const manifestUrl = withCacheBuster(new URL("data/rule1-artifact-manifest.json", pageUrl), attempt);
  const manifestResponse = await fetchRequired(manifestUrl, "Deployed artifact manifest");
  const deployedManifest = await manifestResponse.json();
  assertMatchingManifests(deployedManifest, expectedManifest);

  const databaseUrl = withCacheBuster(new URL(deployedManifest.database.path, new URL("data/", pageUrl)), attempt);
  if (databaseUrl.origin !== pageUrl.origin) {
    throw new Error("Deployed artifact manifest references a cross-origin database.");
  }
  const databaseResponse = await fetchRequired(databaseUrl, "Deployed database");
  const database = await digestResponse(databaseResponse);
  if (database.size !== deployedManifest.database.size_bytes || database.sha256 !== deployedManifest.database.sha256) {
    throw new Error("Deployed database does not match its artifact manifest.");
  }

  return { assets: immutableAssets.length, database };
};

export const runDeploymentCanary = async (
  deploymentUrl,
  expectedManifest,
  { attempts = DEFAULT_ATTEMPTS, delayMs = DEFAULT_DELAY_MS } = {},
) => {
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error("Canary attempts must be a positive integer.");
  const baseUrl = new URL(deploymentUrl);
  if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await checkDeployment(baseUrl, expectedManifest, attempt);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(delayMs);
    }
  }
  throw new Error(`Deployment canary failed after ${attempts} attempt(s): ${lastError?.message}`, {
    cause: lastError,
  });
};

if (process.argv[1]?.endsWith("post-deploy-canary.mjs")) {
  const [, , deploymentUrl, expectedManifestPath] = process.argv;
  if (!deploymentUrl || !expectedManifestPath) {
    throw new Error("usage: post-deploy-canary.mjs DEPLOYMENT_URL EXPECTED_MANIFEST");
  }
  const expectedManifest = JSON.parse(await readFile(expectedManifestPath, "utf8"));
  const result = await runDeploymentCanary(deploymentUrl, expectedManifest, {
    attempts: Number(process.env.RULE1_CANARY_ATTEMPTS ?? DEFAULT_ATTEMPTS),
    delayMs: Number(process.env.RULE1_CANARY_DELAY_MS ?? DEFAULT_DELAY_MS),
  });
  console.log(
    `Verified ${result.assets} current immutable asset(s) and ${result.database.size} database bytes at ${deploymentUrl}.`,
  );
}
