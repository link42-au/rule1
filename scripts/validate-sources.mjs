import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const LEDGER_KEYS = ["date", "framework", "origin", "path", "sha256", "version"];

async function sourceFiles(directory, root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(absolute, root)));
    else if (entry.name !== "source-ledger.json" && entry.name !== "manifest.json")
      files.push(relative(root, absolute));
  }
  return files;
}

export async function validateSourceLedger(root = process.cwd()) {
  const ledgerPath = join(root, "data/source-ledger.json");
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  if (!Array.isArray(ledger.sources) || ledger.sources.length === 0) throw new Error("Source ledger is empty");

  const seen = new Set();
  for (const source of ledger.sources) {
    if (JSON.stringify(Object.keys(source).sort()) !== JSON.stringify(LEDGER_KEYS)) {
      throw new Error(`Unexpected source fields for ${source.path ?? "unknown source"}`);
    }
    if (seen.has(source.path)) throw new Error(`Duplicate source path: ${source.path}`);
    seen.add(source.path);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(source.date)) throw new Error(`Invalid source date: ${source.path}`);
    if (!/^https:\/\//.test(source.origin)) throw new Error(`Invalid source origin: ${source.path}`);
    if (!/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error(`Invalid SHA-256: ${source.path}`);

    const absolute = resolve(root, source.path);
    if (!absolute.startsWith(`${resolve(root, "data")}${sep}`))
      throw new Error(`Source escapes data directory: ${source.path}`);
    const actual = createHash("sha256")
      .update(await readFile(absolute))
      .digest("hex");
    if (actual !== source.sha256) throw new Error(`Checksum mismatch: ${source.path}`);
  }

  const archived = (await sourceFiles(join(root, "data"), root)).sort();
  const recorded = [...seen].sort();
  if (JSON.stringify(archived) !== JSON.stringify(recorded))
    throw new Error("Source ledger file set does not match data archive");

  for (const manifestPath of ["data/nist-csf/versions/manifest.json", "data/nist-800-53/versions/manifest.json"]) {
    const manifest = JSON.parse(await readFile(join(root, manifestPath), "utf8"));
    const directory = manifestPath.slice(0, manifestPath.lastIndexOf("/"));
    for (const version of manifest) {
      const sourcePath = `${directory}/${version.file}`;
      const source = ledger.sources.find((entry) => entry.path === sourcePath);
      if (!source || source.version !== version.version || source.date !== version.date) {
        throw new Error(`Version manifest is not represented in source ledger: ${sourcePath}`);
      }
    }
  }
  return ledger.sources.length;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const count = await validateSourceLedger();
  console.log(`Validated ${count} committed framework sources.`);
}
