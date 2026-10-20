import { join } from "node:path";
import type { ProvisionProgress } from "../../infra/provision";

export interface Provisioned {
  endpoints: { dev: string; prod: string };
}
export interface EnvFiles {
  envLocal: string;
  envDeploy: string;
  envDev: string;
  envProd: string;
}

const MOCK = () => process.env.GRAINSTACK_MOCK === "1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function real() {
  // The template path is read when the module loads, so set it first.
  process.env.GRAINSTACK_TEMPLATE ??= join(process.cwd(), "infra", "tenant.template.yaml");
  return import("../../infra/provision");
}

/** Creates all AWS resources for a tenant (slug = username). Takes minutes. */
export async function provision(slug: string, onProgress: (p: ProvisionProgress) => void): Promise<Provisioned> {
  if (MOCK()) {
    const labels = ["Tables, keys and storage", "Dev function", "Prod function", "Credentials"];
    for (let i = 0; i < labels.length; i++) {
      onProgress({ step: i + 1, total: 4, label: labels[i] });
      await sleep(Number(process.env.MOCK_STEP_MS ?? 1500));
    }
    if (slug.startsWith("fail")) throw new Error("Mock provisioning failure");
    return { endpoints: { dev: `https://${slug}-dev.mock.invalid`, prod: `https://${slug}-prod.mock.invalid` } };
  }
  const r = await (await real()).provisionTenant(slug, { onProgress });
  return { endpoints: r.endpoints };
}

/** Removes everything for a tenant. Safe to call when nothing exists. */
export async function deprovision(slug: string): Promise<void> {
  if (MOCK()) return;
  await (await real()).deprovisionTenant(slug);
}

/** Builds the tenant's four env files (.env.local, .env.deploy, and starter .env.dev / .env.prod). Nothing is cached here. */
export async function envFiles(slug: string): Promise<EnvFiles> {
  if (MOCK()) {
    return {
      envLocal: `TABLE_NAME=gs-${slug}-dev-table\nAPP_ENV=local\nAWS_REGION=us-east-1\nAWS_ACCESS_KEY_ID=AKIAMOCKMOCKMOCKMOCK\nAWS_SECRET_ACCESS_KEY=mock-secret-not-a-real-key\n`,
      envDeploy: `AWS_ACCESS_KEY_ID=AKIAMOCKMOCKMOCKMOCK\nAWS_SECRET_ACCESS_KEY=mock-secret-not-a-real-key\nAWS_REGION=us-east-1\nGRAINSTACK_RUNTIME=nodejs24.x\nGRAINSTACK_TIMEOUT_SECONDS=30\nGRAINSTACK_BUCKET=gs-${slug}-deploy-mock\nGRAINSTACK_DEV_FUNCTION=gs-${slug}-dev\nGRAINSTACK_PROD_FUNCTION=gs-${slug}-prod\nGRAINSTACK_DEV_ROLE_ARN=arn:aws:iam::000000000000:role/gs-${slug}-dev-lambda-role\nGRAINSTACK_PROD_ROLE_ARN=arn:aws:iam::000000000000:role/gs-${slug}-prod-lambda-role\nGRAINSTACK_DEV_TABLE=gs-${slug}-dev-table\nGRAINSTACK_PROD_TABLE=gs-${slug}-prod-table\n`,
      envDev: `# Mock .env.dev: variables for the dev function\nTABLE_NAME=gs-${slug}-dev-table\nAPP_ENV=dev\n`,
      envProd: `# Mock .env.prod: variables for the prod function\nTABLE_NAME=gs-${slug}-prod-table\nAPP_ENV=prod\n`,
    };
  }
  return (await real()).getTenantEnvFiles(slug);
}
