#!/usr/bin/env node
// Builds the --service-config JSON that scripts/deploy.sh sends to Lambda.
//
//   node scripts/service-config.mjs <dev|prod>
//
// The environment variables for the function come from .env.dev or .env.prod. The role and
// table come from GS_ROLE_ARN and GS_TABLE, and the timeout from GRAINSTACK_TIMEOUT_SECONDS
// (deploy.sh takes them from .env.deploy, where the provisioner put them).
// The JSON goes to stdout. Notes, warnings and errors go to stderr, and only ever show
// variable NAMES, never values.
import { existsSync, readFileSync } from "node:fs";

function fail(lines) {
  for (const l of lines) console.error(`error: ${l}`);
  process.exit(1);
}

const target = process.argv[2];
if (target !== "dev" && target !== "prod") fail(["usage: service-config.mjs <dev|prod>"]);
const roleArn = process.env.GS_ROLE_ARN;
const table = process.env.GS_TABLE;
if (!roleArn || !table) fail(["GS_ROLE_ARN and GS_TABLE must be set (they come from .env.deploy)"]);
const timeoutSeconds = Number(process.env.GRAINSTACK_TIMEOUT_SECONDS);
if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1) {
  fail(["GRAINSTACK_TIMEOUT_SECONDS is missing or not a whole number in .env.deploy"]);
}

// The starter files contain both of these, and what is in the file is what gets deployed.
// If you delete one, the deploy adds it back with this value.
const DEFAULTS = { TABLE_NAME: table, APP_ENV: target };

// Names Lambda rejects for Web Functions.
const RESERVED = new Set([
  "AWS_ACCESS_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SECRET_KEY",
  "AWS_SECURITY_TOKEN", "AWS_SESSION_TOKEN", "AWS_DEFAULT_REGION", "AWS_REGION",
  "AWS_LAMBDA_HTTP_ENDPOINT", "AWS_LAMBDA_RUNTIME_API", "AWS_LAMBDA_INITIALIZATION_TYPE",
  "AWS_LAMBDA_FUNCTION_MEMORY_SIZE", "AWS_LAMBDA_METADATA_API", "AWS_LAMBDA_METADATA_TOKEN",
]);

const file = `.env.${target}`;
if (!existsSync(file)) {
  fail([
    `${file} not found. Create it (an empty file is fine). A missing file would silently remove ` +
      `every variable from your ${target} function on the next deploy.`,
  ]);
}

// KEY=value per line. "#" starts a comment only at the beginning of a line. A value is taken
// literally, except that one pair of matching quotes around the whole value is removed.
const vars = {};
const problems = [];
const warnings = [];
readFileSync(file, "utf8")
  .split(/\r?\n/)
  .forEach((raw, i) => {
    let line = raw.trim();
    if (!line || line.startsWith("#")) return;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    const where = `${file} line ${i + 1}`;
    if (eq < 1) return problems.push(`${where}: expected KEY=value`);
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return problems.push(`${where}: "${key}" is not a valid variable name`);
    if (RESERVED.has(key)) return problems.push(`${where}: ${key} is reserved by Lambda and can't be set. Remove it from ${file}.`);
    if (key.startsWith("NEXT_PUBLIC_")) {
      warnings.push(`${key} is built into the browser code by "npm run package", so changing it in ${file} has no effect.`);
    }
    if (key in vars) warnings.push(`${key} appears more than once in ${file}; the last one is used.`);
    vars[key] = value;
  });

// Your ${target} function's role can only reach one table. Any other TABLE_NAME would fail at runtime
// with an access error, so stop here instead.
if ("TABLE_NAME" in vars && vars.TABLE_NAME !== table) {
  problems.push(
    `${file}: TABLE_NAME is "${vars.TABLE_NAME}", but your ${target} function can only use "${table}". ` +
      `Change it back, or delete the line and the deploy will add it.`,
  );
}
if (problems.length) fail(problems);

const names = Object.keys(vars);
console.error(
  names.length
    ? `Environment for ${target}, from ${file}: ${names.join(", ")}`
    : `Environment for ${target}: no variables in ${file}`,
);
const added = Object.keys(DEFAULTS).filter((k) => !(k in vars));
if (added.length) console.error(`  Not in ${file}, so added automatically: ${added.join(", ")}`);
for (const w of warnings) console.error(`warning: ${w}`);

// Defaults come first, so anything in your file overrides them (TABLE_NAME was checked above).
process.stdout.write(
  JSON.stringify({
    executionRoleArn: roleArn,
    timeoutSeconds,
    environmentVariables: { ...DEFAULTS, ...vars },
  }),
);
