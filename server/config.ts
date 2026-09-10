import fs from "node:fs";
import path from "node:path";

export interface StudioConfig {
  /** Absolute path of the git-backed document store. */
  storePath: string;
  /** Path of the targets file, relative to the store or absolute. */
  targetsFile: string;
  port: number;
  /** Interface to bind. Loopback only by default: this server writes files and runs helpers. */
  host: string;
  /** Origins allowed to talk to this local server. Disallowed origins are rejected. */
  allowedOrigins: string[];
}

/**
 * Local-only defaults. The server binds to loopback and accepts only the local studio UI
 * origins; anything else is rejected outright rather than merely served without CORS headers.
 */
const DEFAULTS = {
  storePath: "./store",
  targetsFile: "targets.yaml",
  port: 4319,
  host: "127.0.0.1",
  allowedOrigins: [
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ],
};

/**
 * The store path and the targets file are configuration, not code:
 * studio.config.json in the project root, overridable by environment variables.
 */
export function loadConfig(root = process.cwd()): StudioConfig {
  let fileConfig: Partial<StudioConfig> = {};
  const configPath = path.join(root, "studio.config.json");
  if (fs.existsSync(configPath)) {
    fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8")) as Partial<StudioConfig>;
  }
  const storePath = path.resolve(
    root,
    process.env.STUDIO_STORE ?? fileConfig.storePath ?? DEFAULTS.storePath,
  );
  const envOrigins = process.env.STUDIO_ORIGINS?.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return {
    storePath,
    targetsFile: process.env.STUDIO_TARGETS ?? fileConfig.targetsFile ?? DEFAULTS.targetsFile,
    port: Number(process.env.STUDIO_PORT ?? fileConfig.port ?? DEFAULTS.port),
    host: process.env.STUDIO_HOST ?? fileConfig.host ?? DEFAULTS.host,
    allowedOrigins: envOrigins ?? fileConfig.allowedOrigins ?? DEFAULTS.allowedOrigins,
  };
}

/**
 * Origin policy for a local tool. Requests without an Origin header (curl, tests, the
 * server's own health probe) are allowed; a browser Origin must be on the list.
 * "*" is honoured only if the user opts into it explicitly in studio.config.json.
 */
export function isOriginAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true;
  if (allowed.includes("*")) return true;
  return allowed.includes(origin);
}
