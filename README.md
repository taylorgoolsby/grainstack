# Grainstack portal

A Next.js site where people create an account. Creating the account provisions their own AWS
resources (two DynamoDB tables, IAM users and roles, a code bucket, two Lambda Web Functions), and
the portal then lets them download your boilerplate with four env files already in place:
`.env.local`, `.env.deploy`, and starter `.env.dev` and `.env.prod`.

```
signup -> user saved in DynamoDB -> provisioning runs in the background (a few minutes)
       -> account page shows progress -> "Download project" -> zip = boilerplate/ + their 4 env files
```

The username is the tenant slug, so it must be 4 to 12 lowercase letters or numbers.

## Layout

| Path | What it is |
|---|---|
| `src/` | The website and API (signup, login, status, download) |
| `infra/provision.ts`, `infra/tenant.template.yaml` | Creates and deletes a tenant's AWS resources |
| `boilerplate/` | The project customers download. **Replace its contents with your real app** (see below) |

## Try it without AWS

```bash
npm install
cp .env.example .env.local        # then set SESSION_SECRET and GRAINSTACK_MOCK=1
npm run dev
```

With `GRAINSTACK_MOCK=1` users live in memory and provisioning is faked, but the whole flow
(signup, progress, download) works. Usernames starting with `fail` simulate a failure.

## Run it for real

1. **Users table.** DynamoDB console, Create table: name `grainstack-users`, partition key `pk`
   (String), no sort key, On-demand.
2. **Credentials.** Create an IAM user for the portal with an access key. For a first test,
   `AdministratorAccess` is the quickest. Narrow it before real customers. Put the keys, region,
   `SESSION_SECRET` and `GRAINSTACK_MOCK=0` in `.env.local` (see `.env.example`).
3. **AWS CLI.** The machine running the portal needs AWS CLI v2 recent enough to include
   `aws lambda-web`. Web Functions are created through the CLI.
4. **Start it.**

```bash
npm install
npm run build
npm start          # serves on port 3000
```

Serve it over HTTPS (for example behind a load balancer or reverse proxy). The download contains
access keys, and the login cookie is only marked secure in production.

## Things to know before real customers

- **Needs a long-running Node server.** Provisioning runs inside the server process after the
  signup request returns. Do not host this on a serverless platform.
- **Run one instance.** Running jobs are tracked in memory. If the server restarts mid-setup, the
  account shows "interrupted" and the customer can press Try again, which cleans up and restarts.
  For more than one instance, move provisioning to a queue and worker first.
- **Every signup costs you money and quota.** Set `SIGNUP_INVITE_CODE`, add email verification or
  payment before opening signup, and set an AWS budget alarm. Each tenant uses 3 managed policies,
  2 roles, 2 users and a bucket, and default account quotas allow a few hundred tenants.
- **Secrets are never stored by the portal.** Each download reads the tenant's keys from Secrets
  Manager and builds the zip on the fly. Keys are long-lived: the customer's deploy key can deploy
  to their prod function.
- **No rate limiting, password reset or email verification yet.**

## Replace the boilerplate

Copy your real `myapp` into `boilerplate/`. Keep these working:

- `next.config.ts`: `output: "standalone"` and `outputFileTracingRoot: process.cwd()`.
- `scripts/package.sh` and `scripts/deploy.sh`, plus `package.json` scripts `package`, `deploy:dev`,
  `deploy:prod`.
- `.gitignore` entries for `.env.local`, `.env.deploy`, `.env.dev`, `.env.prod`, `lambda.zip`,
  `lambda-pkg/`, `.deployed-*-version`.
- `scripts/service-config.mjs`, which `deploy.sh` runs to build each deploy's configuration.
- The app reads `TABLE_NAME` (its DynamoDB table) and `APP_ENV`.

### Environment variables for deployed functions

Customers keep three kinds of variables apart:

| File | Used by |
|---|---|
| `.env.local` | `npm run dev` on their computer only |
| `.env.dev` | the dev Lambda function: `npm run deploy:dev` sends every variable in it |
| `.env.prod` | the prod Lambda function: `npm run deploy:prod` sends every variable in it |

The portal gives each customer starter `.env.dev` and `.env.prod` files made by `starterEnvFile()`
in `infra/provision.ts`. Each starts with `TABLE_NAME` (that environment's table) and `APP_ENV`
(`dev` or `prod`), followed by comments and room for the customer's own variables. `deploy.sh` validates the file before uploading
anything: AWS names that Lambda reserves are rejected, a missing file stops the deploy (so a
deleted file can't wipe a function's variables), and only variable **names** are ever printed.

Keep these in step when you change them:

- What is in the customer's file is what gets deployed. `APP_ENV` is honoured as written.
  `TABLE_NAME` must equal the table that environment's role can reach, otherwise the deploy stops
  before uploading. If either line is deleted, the deploy adds it back. These defaults live in
  `DEFAULTS` in `service-config.mjs`, and `serviceConfigFor()` in `infra/provision.ts` forces
  `TABLE_NAME` for the first revision. If you change the rule, change both.
- The runtime and timeout are defined only in `provision.ts` (`RUNTIME`, `TIMEOUT_SECONDS`) and
  reach customers through `.env.deploy` (`GRAINSTACK_RUNTIME`, `GRAINSTACK_TIMEOUT_SECONDS`).
- The reserved-name list in `service-config.mjs` comes from the Web Functions documentation.

Re-downloading a project, or running `provision.ts env <slug>`, resets `.env.dev` and
`.env.prod` to their starting contents, losing any variables the customer added. Customers should not unzip a fresh download over a project they have
already edited.

Files named `.env*`, `node_modules`, `.next`, `lambda.zip` and `lambda-pkg` are never copied into
customer zips.

## Remove a tenant

```bash
# put the portal's AWS keys in .env.provision (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION)
npx tsx infra/provision.ts deprovision <username>
```

This deletes their tables, keys, bucket contents and functions. It does not delete the user from
`grainstack-users`, and it leaves their CloudWatch log groups.
