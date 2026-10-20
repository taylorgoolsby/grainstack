import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { zipSync, strToU8, type Zippable } from "fflate";

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "lambda-pkg", "provisioned", "out"]);
const SKIP_FILES = new Set(["lambda.zip", ".DS_Store", "tsconfig.tsbuildinfo", "next-env.d.ts"]);

// Keep Unix permissions (so scripts/*.sh stay executable after unzipping).
const unix = (mode: number) => ({ os: 3, attrs: ((0o100000 | (mode & 0o777)) << 16) >>> 0 });

function walk(dir: string, root: string, top: string, out: Zippable) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, root, top, out);
    } else if (entry.isFile()) {
      // Never copy secrets from the template folder; each customer gets their own, added below.
      if (SKIP_FILES.has(entry.name) || entry.name.startsWith(".deployed-") || /^\.env(\.|$)/.test(entry.name)) continue;
      const rel = relative(root, full).split(sep).join("/");
      out[`${top}/${rel}`] = [readFileSync(full), unix(statSync(full).mode)];
    }
  }
}

/** The boilerplate folder plus this customer's four env files, as one zip with a single top folder. */
export function buildBoilerplateZip(
  slug: string,
  files: { envLocal: string; envDeploy: string; envDev: string; envProd: string },
): Uint8Array {
  const root = process.env.BOILERPLATE_DIR ?? join(process.cwd(), "boilerplate");
  const top = `grainstack-${slug}`;
  const out: Zippable = {};
  walk(root, root, top, out);
  out[`${top}/.env.local`] = [strToU8(files.envLocal), unix(0o600)];
  out[`${top}/.env.deploy`] = [strToU8(files.envDeploy), unix(0o600)];
  out[`${top}/.env.dev`] = [strToU8(files.envDev), unix(0o600)];
  out[`${top}/.env.prod`] = [strToU8(files.envProd), unix(0o600)];
  return zipSync(out);
}
