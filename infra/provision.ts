/**
 * Grainstack tenant provisioning (CloudFormation edition).
 *
 * One CloudFormation stack per tenant ("gs-<slug>") owns the stateful and security-relevant
 * infrastructure: 2 DynamoDB tables, IAM policies/roles/users/access keys, the versioned code
 * bucket (+ policy), and a Secrets Manager secret holding the generated access keys.
 *
 * The two Lambda Web Functions are created by this script (via the AWS CLI) AFTER the stack,
 * because `grainstack deploy` creates revisions outside CloudFormation.
 *
 * Secrets: the stack writes the access keys into Secrets Manager (never into stack outputs).
 * This script reads that secret and builds the tenant's .env.local and .env.deploy.
 *
 * Usage:
 *   npx tsx provision.ts provision [slug]     create a tenant, write its env files to ./provisioned/<slug>/
 *   npx tsx provision.ts env <slug>           re-generate the env files for an existing tenant
 *                                             (.env.dev and .env.prod are reset to their starting contents)
 *   npx tsx provision.ts deprovision <slug>   DELETE everything for that tenant
 *
 * Credentials (CLI mode): read ONLY from ./.env.provision (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
 * AWS_REGION). ~/.aws and any AWS_* variables already in your shell are ignored. When this file is
 * imported as a library (no CLI, no GRAINSTACK_ENV_FILE) the normal AWS credential chain is used,
 * e.g. an IAM role on the server.
 *
 * Env vars:
 *   GRAINSTACK_ENV_FILE      credentials file, default ./.env.provision
 *   GRAINSTACK_REGION        default: AWS_REGION from the credentials file, else us-east-1
 *   GRAINSTACK_TEMPLATE      path to tenant.template.yaml, default ./tenant.template.yaml
 *   GRAINSTACK_CFN_ROLE_ARN  optional CloudFormation service role; if set, CloudFormation (not
 *                            the caller) needs the IAM permissions, so the provisioner's own
 *                            credentials can be much narrower.
 *
 * Requires an AWS CLI v2 that includes `aws lambda-web` (Web Functions are created through it).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { zipSync, strToU8 } from "fflate";
import {
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStacksCommand,
  DescribeStackEventsCommand,
  DescribeStackResourceCommand,
  waitUntilStackCreateComplete,
  waitUntilStackDeleteComplete,
} from "@aws-sdk/client-cloudformation";
import { SecretsManagerClient, GetSecretValueCommand, DeleteSecretCommand } from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient, UpdateTableCommand } from "@aws-sdk/client-dynamodb";
import {
  S3Client,
  PutObjectCommand,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------
// Credentials: from a local file only (never ~/.aws), when run as a CLI
// ---------------------------------------------------------------------------
const IS_CLI = ["provision.ts", "provision.js"].includes(basename(process.argv[1] ?? ""));
const ENV_FILE = process.env.GRAINSTACK_ENV_FILE ?? ".env.provision";

function loadCredentialsFile(): { accessKeyId: string; secretAccessKey: string; sessionToken?: string } {
  if (!existsSync(/*turbopackIgnore: true*/ ENV_FILE)) {
    throw new Error(
      `Credentials file not found: ${resolve(/*turbopackIgnore: true*/ ENV_FILE)}\nCreate it with AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION, and run from that folder.`,
    );
  }
  const vars: Record<string, string> = {};
  for (const raw of readFileSync(/*turbopackIgnore: true*/ ENV_FILE, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    let v = line.slice(i + 1).trim();
    if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
    vars[line.slice(0, i).trim()] = v;
  }
  const accessKeyId = vars.AWS_ACCESS_KEY_ID;
  const secretAccessKey = vars.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) throw new Error(`${ENV_FILE} must define AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY`);

  // The file is the single source of truth: drop anything stale from the shell...
  for (const k of Object.keys(process.env)) if (k.startsWith("AWS_")) delete process.env[k];
  // ...and make both the SDK and the AWS CLI child processes ignore ~/.aws entirely.
  const nul = process.platform === "win32" ? "NUL" : "/dev/null";
  process.env.AWS_SHARED_CREDENTIALS_FILE = nul;
  process.env.AWS_CONFIG_FILE = nul;
  process.env.AWS_EC2_METADATA_DISABLED = "true";
  process.env.AWS_ACCESS_KEY_ID = accessKeyId;
  process.env.AWS_SECRET_ACCESS_KEY = secretAccessKey;
  if (vars.AWS_SESSION_TOKEN) process.env.AWS_SESSION_TOKEN = vars.AWS_SESSION_TOKEN;
  if (vars.AWS_REGION) process.env.AWS_REGION = vars.AWS_REGION;
  return { accessKeyId, secretAccessKey, ...(vars.AWS_SESSION_TOKEN ? { sessionToken: vars.AWS_SESSION_TOKEN } : {}) };
}

const USE_FILE = IS_CLI || process.env.GRAINSTACK_ENV_FILE !== undefined;
let credentials: ReturnType<typeof loadCredentialsFile> | undefined;
try {
  credentials = USE_FILE ? loadCredentialsFile() : undefined;
} catch (e) {
  if (!IS_CLI) throw e;
  console.error(`\n${(e as Error).message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const REGION = process.env.GRAINSTACK_REGION ?? process.env.AWS_REGION ?? "us-east-1";
if (USE_FILE) process.env.AWS_REGION = REGION; // the AWS CLI child processes read this
const TEMPLATE_PATH = process.env.GRAINSTACK_TEMPLATE ?? "./tenant.template.yaml";
const CFN_ROLE_ARN = process.env.GRAINSTACK_CFN_ROLE_ARN;
const RUNTIME = "nodejs24.x";
const TIMEOUT_SECONDS = 30;
const ENDPOINT_NAME = "live";
const CODE_KEY = "lambda.zip";

type Env = "dev" | "prod";

const cfn = new CloudFormationClient({ region: REGION, credentials });
const sm = new SecretsManagerClient({ region: REGION, credentials });
const ddb = new DynamoDBClient({ region: REGION, credentials });
const s3 = new S3Client({ region: REGION, credentials });
const sts = new STSClient({ region: REGION, credentials });

// Names the provisioner (not the template) decides. They are passed to the template as
// parameters so the IAM policies can be scoped to them.
const stackNameFor = (slug: string) => `gs-${slug}`;
const functionNameFor = (slug: string, env: Env) => `gs-${slug}-${env}`;
const secretNameFor = (slug: string) => `grainstack/tenants/${slug}/credentials`;

function assertSlug(slug: string) {
  if (!/^[a-z0-9]{4,12}$/.test(slug)) throw new Error("slug must be 4-12 chars of a-z0-9");
}

/**
 * The runtime config of a revision.
 *
 * The provisioner uses it for a tenant's FIRST revision (a placeholder, so no customer variables).
 * Every later deploy happens on the customer's machine: boilerplate/scripts/service-config.mjs
 * builds the same shape from the variables in .env.dev / .env.prod, passed here as `extraVars`.
 * Revisions are immutable and omitted settings fall back to defaults, so every deploy restates all.
 *
 * Kept in sync between the two places:
 *   - the runtime and timeout are written into .env.deploy (GRAINSTACK_RUNTIME,
 *     GRAINSTACK_TIMEOUT_SECONDS), so they are defined only here;
 *   - TABLE_NAME and APP_ENV start every customer file (see starterEnvFile). The deploy honours
 *     what the file says, adds either back if deleted, and refuses a TABLE_NAME other than the
 *     table the function's role can reach. Here TABLE_NAME is always forced to the tenant's table.
 *     If you change this rule, change DEFAULTS in service-config.mjs too.
 */
export function serviceConfigFor(
  env: Env,
  t: { table: string; roleArn: string },
  extraVars: Record<string, string> = {},
) {
  return {
    executionRoleArn: t.roleArn,
    timeoutSeconds: TIMEOUT_SECONDS,
    environmentVariables: { APP_ENV: env, ...extraVars, TABLE_NAME: t.table },
  };
}

/**
 * The starting .env.dev / .env.prod a customer receives. `npm run deploy:dev` sends every variable
 * in .env.dev to the dev function, and `deploy:prod` sends .env.prod to the prod function.
 * It starts with the two variables the app already relies on; the customer adds the rest.
 */
export function starterEnvFile(env: Env, table: string): string {
  return [
    `# Environment variables for your ${env.toUpperCase()} Lambda function.`,
    `# \`npm run deploy:${env}\` sends every variable in this file to that function.`,
    `#`,
    `# - One KEY=value per line. Put comments on their own line, not after a value.`,
    `# - TABLE_NAME is your ${env} table. Your ${env} function can only use that table, so the deploy`,
    `#   stops if you change it. If you delete the line, the deploy adds it back.`,
    `# - APP_ENV is a label your app can read. Change it if you like.`,
    `# - AWS_* names such as AWS_REGION and AWS_ACCESS_KEY_ID are reserved by Lambda and rejected.`,
    `# - Local development (\`npm run dev\`) reads .env.local instead. This file is not used there.`,
    `# - Anyone who can read your Lambda configuration can read these values. For real secrets,`,
    `#   prefer AWS Secrets Manager or Parameter Store.`,
    ``,
    `TABLE_NAME=${table}`,
    `APP_ENV=${env}`,
    ``,
    `# Add your own below, for example:`,
    `# LOG_LEVEL=info`,
    ``,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const log = (m: string) => console.log(m);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Verifies the credentials once, with a plain-language error instead of an SDK stack trace. */
let whoamiPromise: Promise<{ account: string; arn: string }> | undefined;
function whoami() {
  whoamiPromise ??= (async () => {
    try {
      const r = await sts.send(new GetCallerIdentityCommand({}));
      log(`AWS identity: ${r.Arn}`);
      return { account: r.Account!, arn: r.Arn! };
    } catch (e) {
      const name = (e as Error).name ?? "";
      if (/InvalidClientTokenId|SignatureDoesNotMatch|ExpiredToken|UnrecognizedClient/.test(name)) {
        throw new Error(
          `AWS rejected the access keys${USE_FILE ? ` in ${resolve(/*turbopackIgnore: true*/ ENV_FILE)}` : ""} (${name}). ` +
            `Check that the file is saved, the values have no quotes or spaces, and the key is Active in IAM.`,
        );
      }
      throw e;
    }
  })();
  return whoamiPromise;
}

async function retry<T>(fn: () => Promise<T>, label: string, tries = 6, delayMs = 5000): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      log(`  ${label}: attempt ${i}/${tries} failed: ${String((e as Error).message ?? e).split("\n")[0]}`);
      if (i < tries) await sleep(delayMs * Math.min(i, 3));
    }
  }
  throw last;
}

/** Runs the AWS CLI with the same credentials/region as this process. */
async function awsCli(args: string[]): Promise<any> {
  const { stdout } = await execFileP("aws", [...args, "--region", REGION, "--output", "json"], {
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  try {
    return stdout.trim() ? JSON.parse(stdout) : {};
  } catch {
    return {};
  }
}

async function preflight() {
  try {
    await execFileP("aws", ["lambda-web", "help"], { env: process.env });
  } catch {
    throw new Error("The AWS CLI on this machine has no `lambda-web` command. Update AWS CLI v2 and retry.");
  }
}

/** Minimal server uploaded as the first revision so the Web Function can be created. */
const PLACEHOLDER_INDEX = `const http = require("http");
const [host, port] = (process.env.AWS_LAMBDA_HTTP_ENDPOINT || "localhost:3000").split(":");
http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Nothing deployed yet. Run: grainstack deploy dev");
}).listen(Number(port), host);
`;

// ---------------------------------------------------------------------------
// CloudFormation helpers
// ---------------------------------------------------------------------------
async function stackExists(StackName: string): Promise<boolean> {
  try {
    await cfn.send(new DescribeStacksCommand({ StackName }));
    return true;
  } catch (e) {
    if (/does not exist/i.test((e as Error).message)) return false;
    throw e;
  }
}

async function stackOutputs(StackName: string): Promise<Record<string, string>> {
  const r = await cfn.send(new DescribeStacksCommand({ StackName }));
  const out: Record<string, string> = {};
  for (const o of r.Stacks?.[0]?.Outputs ?? []) out[o.OutputKey!] = o.OutputValue!;
  return out;
}

/** Physical ID (e.g. the real bucket name) of a stack resource; undefined if it doesn't exist. */
async function physicalId(StackName: string, LogicalResourceId: string): Promise<string | undefined> {
  try {
    const r = await cfn.send(new DescribeStackResourceCommand({ StackName, LogicalResourceId }));
    return r.StackResourceDetail?.PhysicalResourceId;
  } catch {
    return undefined;
  }
}

/** Root cause of a failed stack operation: the oldest failure that wasn't just a cancellation. */
async function stackFailureReason(StackName: string): Promise<string> {
  try {
    const ev = await cfn.send(new DescribeStackEventsCommand({ StackName }));
    const oldestFirst = [...(ev.StackEvents ?? [])].reverse();
    const f = oldestFirst.find(
      (e) => /_FAILED$/.test(e.ResourceStatus ?? "") && e.ResourceStatusReason && !/cancel/i.test(e.ResourceStatusReason),
    );
    return f ? `${f.LogicalResourceId}: ${f.ResourceStatusReason}` : "unknown reason";
  } catch {
    return "unknown reason";
  }
}

// ---------------------------------------------------------------------------
// Web Functions (created via CLI, after the stack)
// ---------------------------------------------------------------------------
async function waitForEndpoint(fn: string): Promise<string> {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const e = await awsCli(["lambda-web", "get-web-function-endpoint", "--function-name", fn, "--endpoint-name", ENDPOINT_NAME]);
    if (e.state === "Active" && e.domainName) return e.domainName as string;
    if (e.state === "Failed") throw new Error(`Endpoint for ${fn} failed`);
    await sleep(5000);
  }
  throw new Error(`Timed out waiting for ${fn} endpoint to become Active`);
}

async function waitForHttp(url: string) {
  const deadline = Date.now() + 3 * 60_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (r.ok) return;
    } catch {
      /* not ready yet */
    }
    await sleep(5000);
  }
  throw new Error(`${url} never returned 200 (revision may be Active while the server failed to start)`);
}

async function createWebFunction(
  fn: string,
  env: Env,
  bucket: string,
  versionId: string,
  t: { table: string; roleArn: string },
): Promise<string> {
  log(`Lambda: creating Web Function ${fn}`);
  const revisionConfig = {
    buildConfig: {
      codeConfig: { s3Object: { bucket, key: CODE_KEY, versionId } },
      runtimeConfig: { runtime: RUNTIME },
    },
    serviceConfig: serviceConfigFor(env, t),
  };
  const endpointConfig = {
    endpointName: ENDPOINT_NAME,
    endpointType: "HomeRegion",
    authType: "ApplicationManaged",
    autoDeploymentMode: "LatestRevision",
  };
  // Retries cover IAM propagation of the new role.
  await retry(
    () =>
      awsCli([
        "lambda-web",
        "create-web-function",
        "--function-name",
        fn,
        "--revision-config",
        JSON.stringify(revisionConfig),
        "--endpoint-config",
        JSON.stringify(endpointConfig),
      ]),
    `create ${fn}`,
    6,
    8000,
  );
  const url = `https://${await waitForEndpoint(fn)}`;
  await waitForHttp(url + "/");
  return url;
}

// ---------------------------------------------------------------------------
// Env files (secrets come from Secrets Manager, resource names from stack outputs)
// ---------------------------------------------------------------------------
export interface TenantEnvFiles {
  /** Contents of the tenant's .env.local (dev table + dev-only keys). Contains a secret. */
  envLocal: string;
  /** Contents of the tenant's .env.deploy (deployer keys + resource names). Contains a secret. */
  envDeploy: string;
  /** Starter .env.dev: the variables sent to the dev function. The customer edits it. */
  envDev: string;
  /** Starter .env.prod: the variables sent to the prod function. The customer edits it. */
  envProd: string;
}

/** Builds both env files for an existing tenant. Safe to call again to re-issue the files. */
export async function getTenantEnvFiles(slug: string): Promise<TenantEnvFiles> {
  assertSlug(slug);
  await whoami();
  const o = await stackOutputs(stackNameFor(slug));
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: o.SecretArn }));
  const k = JSON.parse(secret.SecretString ?? "{}") as Record<string, string>;
  for (const f of ["localAccessKeyId", "localSecretAccessKey", "deployAccessKeyId", "deploySecretAccessKey"]) {
    if (!k[f]) throw new Error(`Secret for tenant ${slug} is missing ${f}`);
  }

  const envLocal =
    [
      `TABLE_NAME=${o.DevTable}`,
      `APP_ENV=local`,
      `AWS_REGION=${REGION}`,
      `AWS_ACCESS_KEY_ID=${k.localAccessKeyId}`,
      `AWS_SECRET_ACCESS_KEY=${k.localSecretAccessKey}`,
    ].join("\n") + "\n";

  const envDeploy =
    [
      `AWS_ACCESS_KEY_ID=${k.deployAccessKeyId}`,
      `AWS_SECRET_ACCESS_KEY=${k.deploySecretAccessKey}`,
      `AWS_REGION=${REGION}`,
      `GRAINSTACK_RUNTIME=${RUNTIME}`,
      `GRAINSTACK_TIMEOUT_SECONDS=${TIMEOUT_SECONDS}`,
      `GRAINSTACK_BUCKET=${o.Bucket}`,
      `GRAINSTACK_DEV_FUNCTION=${o.DevFunctionName}`,
      `GRAINSTACK_PROD_FUNCTION=${o.ProdFunctionName}`,
      `GRAINSTACK_DEV_ROLE_ARN=${o.DevRoleArn}`,
      `GRAINSTACK_PROD_ROLE_ARN=${o.ProdRoleArn}`,
      `GRAINSTACK_DEV_TABLE=${o.DevTable}`,
      `GRAINSTACK_PROD_TABLE=${o.ProdTable}`,
    ].join("\n") + "\n";

  return { envLocal, envDeploy, envDev: starterEnvFile("dev", o.DevTable), envProd: starterEnvFile("prod", o.ProdTable) };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export interface ProvisionResult extends TenantEnvFiles {
  slug: string;
  stackName: string;
  endpoints: { dev: string; prod: string };
}

export interface ProvisionProgress {
  step: number;
  total: number;
  label: string;
}
export interface ProvisionOptions {
  /** Called as provisioning moves through its 4 stages (1-based). */
  onProgress?: (p: ProvisionProgress) => void;
}

export async function provisionTenant(
  slug: string = randomBytes(4).toString("hex"),
  options: ProvisionOptions = {},
): Promise<ProvisionResult> {
  assertSlug(slug);
  const progress = (step: number, label: string) => {
    log(label);
    options.onProgress?.({ step, total: 4, label });
  };
  const { account } = await whoami();
  await preflight();
  const StackName = stackNameFor(slug);

  // Refuse to touch an existing tenant. This is OUTSIDE the try/catch below on purpose: the
  // rollback deletes by name, so it must never run against a tenant that already existed.
  if (await stackExists(StackName)) throw new Error(`Tenant "${slug}" already exists`);

  const TemplateBody = readFileSync(/*turbopackIgnore: true*/ TEMPLATE_PATH, "utf8");
  const devFn = functionNameFor(slug, "dev");
  const prodFn = functionNameFor(slug, "prod");

  log(`Provisioning tenant ${slug} in account ${account} (${REGION})`);
  try {
    progress(1, "Creating tables, access keys and storage");
    log(`CloudFormation: creating stack ${StackName}`);
    await cfn.send(
      new CreateStackCommand({
        StackName,
        TemplateBody,
        Parameters: [
          { ParameterKey: "TenantSlug", ParameterValue: slug },
          { ParameterKey: "DevFunctionName", ParameterValue: devFn },
          { ParameterKey: "ProdFunctionName", ParameterValue: prodFn },
        ],
        Capabilities: ["CAPABILITY_NAMED_IAM"],
        Tags: [{ Key: "grainstack:tenant", Value: slug }],
        ...(CFN_ROLE_ARN ? { RoleARN: CFN_ROLE_ARN } : {}),
      }),
    );
    try {
      await waitUntilStackCreateComplete({ client: cfn, maxWaitTime: 900 }, { StackName });
    } catch {
      throw new Error(`Stack creation failed: ${await stackFailureReason(StackName)}`);
    }

    const o = await stackOutputs(StackName);

    // First revision needs code, so upload the placeholder now that the versioned bucket exists.
    const put = await s3.send(
      new PutObjectCommand({
        Bucket: o.Bucket,
        Key: CODE_KEY,
        Body: zipSync({ "index.js": strToU8(PLACEHOLDER_INDEX) }),
        ContentType: "application/zip",
      }),
    );
    if (!put.VersionId) throw new Error("Bucket versioning is not active (no VersionId returned)");

    progress(2, "Starting your dev function");
    const dev = await createWebFunction(devFn, "dev", o.Bucket, put.VersionId, { table: o.DevTable, roleArn: o.DevRoleArn });
    progress(3, "Starting your prod function");
    const prod = await createWebFunction(prodFn, "prod", o.Bucket, put.VersionId, { table: o.ProdTable, roleArn: o.ProdRoleArn });

    progress(4, "Collecting your credentials");
    const files = await getTenantEnvFiles(slug);
    log(`Done. dev: ${dev}  prod: ${prod}`);
    return { slug, stackName: StackName, endpoints: { dev, prod }, ...files };
  } catch (e) {
    log(`Provisioning failed: ${(e as Error).message}. Rolling back tenant ${slug}...`);
    await deprovisionTenant(slug).catch((err) =>
      log(`Rollback incomplete: ${err}. Orphans may remain; look for stack ${StackName} / tag grainstack:tenant=${slug}`),
    );
    throw e;
  }
}

/** Deletes everything for a tenant. Idempotent: missing pieces are skipped. */
export async function deprovisionTenant(slug: string): Promise<void> {
  assertSlug(slug);
  await whoami();
  const StackName = stackNameFor(slug);

  const attempt = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      const err = e as Error & { name?: string };
      const msg = `${err.name ?? ""} ${err.message ?? ""}`;
      if (/NotFound|NoSuchBucket|ResourceNotFound|does not exist|not found/i.test(msg)) return;
      log(`  cleanup ${label}: ${err.message}`);
    }
  };

  // 1. Web Functions first (their revisions reference the bucket objects and the roles)
  for (const env of ["dev", "prod"] as Env[]) {
    await attempt(`web function ${env}`, () =>
      awsCli(["lambda-web", "delete-web-function", "--function-name", functionNameFor(slug, env)]),
    );
  }

  if (await stackExists(StackName)) {
    // 2. CloudFormation cannot delete a non-empty bucket: remove every version and delete marker
    const bucket = await physicalId(StackName, "CodeBucket");
    if (bucket) {
      await attempt("empty bucket", async () => {
        let keyMarker: string | undefined;
        let versionMarker: string | undefined;
        do {
          const r = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, KeyMarker: keyMarker, VersionIdMarker: versionMarker }));
          const objects = [...(r.Versions ?? []), ...(r.DeleteMarkers ?? [])].map((o) => ({ Key: o.Key!, VersionId: o.VersionId }));
          if (objects.length) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } }));
          keyMarker = r.IsTruncated ? r.NextKeyMarker : undefined;
          versionMarker = r.IsTruncated ? r.NextVersionIdMarker : undefined;
        } while (keyMarker || versionMarker);
      });
    }

    // 3. The prod table has deletion protection, which would make stack deletion fail
    const prodTable = await physicalId(StackName, "ProdTable");
    if (prodTable) {
      await attempt("prod deletion protection", () =>
        ddb.send(new UpdateTableCommand({ TableName: prodTable, DeletionProtectionEnabled: false })),
      );
    }

    // 4. Delete the stack (tables, IAM, keys, bucket, secret)
    log(`CloudFormation: deleting stack ${StackName}`);
    await cfn.send(new DeleteStackCommand({ StackName, ...(CFN_ROLE_ARN ? { RoleARN: CFN_ROLE_ARN } : {}) }));
    try {
      await waitUntilStackDeleteComplete({ client: cfn, maxWaitTime: 900 }, { StackName });
    } catch {
      throw new Error(`Stack deletion failed: ${await stackFailureReason(StackName)}`);
    }
  }

  // 5. Stack deletion only schedules the secret for deletion (30-day recovery window) and keeps
  //    the name reserved. Remove it now so no copy of the keys lingers.
  await attempt("secret", () =>
    sm.send(new DeleteSecretCommand({ SecretId: secretNameFor(slug), ForceDeleteWithoutRecovery: true })),
  );
  log(`Deprovisioned tenant ${slug}. CloudWatch log groups /aws/lambda/web/${functionNameFor(slug, "dev")} and -prod are NOT deleted.`);
}

// ---------------------------------------------------------------------------
// CLI entry point (for testing; the real service calls the functions directly)
// ---------------------------------------------------------------------------
function writeEnvFiles(slug: string, f: TenantEnvFiles) {
  const dir = `./provisioned/${slug}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/.env.local`, f.envLocal, { mode: 0o600 });
  writeFileSync(`${dir}/.env.deploy`, f.envDeploy, { mode: 0o600 });
  writeFileSync(`${dir}/.env.dev`, f.envDev, { mode: 0o600 });
  writeFileSync(`${dir}/.env.prod`, f.envProd, { mode: 0o600 });
  console.log(`Wrote .env.local, .env.deploy, .env.dev and .env.prod to ${dir} (never commit them).`);
}

if (IS_CLI) {
  const [cmd, arg] = process.argv.slice(2);
  (async () => {
    if (cmd === "provision") {
      const r = await provisionTenant(arg);
      writeEnvFiles(r.slug, r);
      console.log(JSON.stringify(r.endpoints, null, 2));
    } else if (cmd === "env" && arg) {
      writeEnvFiles(arg, await getTenantEnvFiles(arg));
    } else if (cmd === "deprovision" && arg) {
      await deprovisionTenant(arg);
    } else {
      console.log("Usage: provision.ts provision [slug] | env <slug> | deprovision <slug>");
      process.exit(1);
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
