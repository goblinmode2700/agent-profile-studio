import { createTwoFilesPatch } from "diff";
import cors from "cors";
import express from "express";

import type { DocKind } from "../src/core/types";
import { isOriginAllowed, loadConfig } from "./config";
import { applyInstall, planInstall } from "./install";
import { Store, StoreError, docRelPath } from "./store";

const config = loadConfig();
const store = new Store(config.storePath, config.targetsFile);

const app = express();

// Reject a disallowed browser Origin outright — do not serve the response without CORS headers.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!isOriginAllowed(origin, config.allowedOrigins)) {
    res.status(403).json({
      error: `origin ${String(origin)} is not allowed by this local server. Add it to allowedOrigins in studio.config.json.`,
    });
    return;
  }
  next();
});
app.use(
  cors({
    origin: (origin, callback) =>
      callback(null, isOriginAllowed(origin ?? undefined, config.allowedOrigins)),
  }),
);
app.use(express.json({ limit: "4mb" }));

const KINDS: DocKind[] = ["profile", "fragment", "partial", "helper", "targets"];
function kindOf(value: unknown): DocKind {
  if (typeof value !== "string" || !KINDS.includes(value as DocKind)) {
    throw new StoreError(`unknown document kind "${String(value)}"`);
  }
  return value as DocKind;
}
function nameOf(value: unknown, kind: DocKind): string {
  if (kind === "targets") return "targets";
  if (typeof value !== "string") throw new StoreError("document name must be a string");
  return value;
}
const relOf = (kind: DocKind, name: string) => docRelPath(kind, name, config.targetsFile);

const wrap =
  (handler: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) => {
    handler(req, res).catch((error: unknown) => {
      const status = error instanceof StoreError ? error.status : 500;
      res.status(status).json({ error: (error as Error).message });
    });
  };

app.get(
  "/api/health",
  wrap(async (_req, res) => {
    res.json({
      ok: true,
      mode: "local",
      storePath: store.root,
      targetsFile: config.targetsFile,
      targetsExternal: store.targetsExternal,
      port: config.port,
      host: config.host,
    });
  }),
);

app.get(
  "/api/store",
  wrap(async (_req, res) => {
    const [profiles, fragments, partials, helpers] = await Promise.all([
      store.list("profile"),
      store.list("fragment"),
      store.list("partial"),
      store.list("helper"),
    ]);
    const targets = await store.read("targets", "targets").catch(() => "");
    res.json({
      storePath: store.root,
      mode: "local",
      profiles,
      fragments,
      partials,
      helpers,
      targets,
      targetsFile: config.targetsFile,
      targetsExternal: store.targetsExternal,
    });
  }),
);

app.put(
  "/api/doc",
  wrap(async (req, res) => {
    const { kind, name, content } = req.body as { kind: string; name: string; content: string };
    if (typeof content !== "string") throw new StoreError("content must be a string");
    const k = kindOf(kind);
    const n = nameOf(name, k);
    const commit = await store.write(k, n, content);
    res.json({ commit, path: relOf(k, n) });
  }),
);

app.delete(
  "/api/doc",
  wrap(async (req, res) => {
    const { kind, name } = req.query as { kind: string; name: string };
    const k = kindOf(kind);
    const commit = await store.remove(k, nameOf(name, k));
    res.json({ commit });
  }),
);

app.get(
  "/api/history",
  wrap(async (req, res) => {
    const { kind, name } = req.query as { kind: string; name: string };
    const k = kindOf(kind);
    res.json({ commits: await store.history(k, nameOf(name, k)) });
  }),
);

app.get(
  "/api/version",
  wrap(async (req, res) => {
    const { kind, name, oid } = req.query as { kind: string; name: string; oid: string };
    const k = kindOf(kind);
    res.json({ content: await store.readAt(k, nameOf(name, k), oid) });
  }),
);

app.get(
  "/api/diff",
  wrap(async (req, res) => {
    const { kind, name, a, b } = req.query as { kind: string; name: string; a: string; b?: string };
    const k = kindOf(kind);
    const n = nameOf(name, k);
    const left = await store.readAt(k, n, a);
    const right = b ? await store.readAt(k, n, b) : await store.read(k, n);
    const rel = relOf(k, n);
    res.json({
      diff: createTwoFilesPatch(
        `${rel}@${a.slice(0, 8)}`,
        `${rel}@${b ? b.slice(0, 8) : "working"}`,
        left,
        right,
      ),
    });
  }),
);

app.post(
  "/api/restore",
  wrap(async (req, res) => {
    const { kind, name, oid } = req.body as { kind: string; name: string; oid: string };
    const k = kindOf(kind);
    const n = nameOf(name, k);
    const commit = await store.restore(k, n, oid);
    res.json({ commit, content: await store.read(k, n) });
  }),
);

app.post(
  "/api/install/preview",
  wrap(async (req, res) => {
    const { role } = req.body as { role: string };
    res.json(await planInstall(store, config.targetsFile, role));
  }),
);

app.post(
  "/api/install/apply",
  wrap(async (req, res) => {
    const { role, entries } = req.body as {
      role: string;
      entries: Array<{ target: string; expectedHash: string | null; proposedHash?: string; filePath?: string }>;
    };
    const result = await applyInstall(store, config.targetsFile, role, entries ?? []);
    res.status(result.conflicts.length ? 409 : 200).json(result);
  }),
);

await store.init();
app.listen(config.port, config.host, () => {
  console.log(`Agent Profile Studio server`);
  console.log(`  store   : ${store.root}`);
  console.log(`  targets : ${config.targetsFile}${store.targetsExternal ? " (external, no git history)" : ""}`);
  console.log(`  api     : http://${config.host}:${config.port}/api/health (loopback only)`);
  console.log(`  origins : ${config.allowedOrigins.join(", ")}`);
});
