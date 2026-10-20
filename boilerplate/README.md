# Your Grainstack app

This project came with four env files already in place:

| File | Used by |
|---|---|
| `.env.local` | `npm run dev` on your computer (points at your **dev** database table) |
| `.env.dev` | your **dev** function: `npm run deploy:dev` sends every variable in it |
| `.env.prod` | your **prod** function: `npm run deploy:prod` sends every variable in it |
| `.env.deploy` | the deploy script: your deploy keys and the names of your AWS resources |

Never commit them. They are in `.gitignore`.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. The page shows "Notes (local)" and stores notes in your dev table.

## Deploy

You need Node.js 20 or newer, `zip`, and a recent AWS CLI v2 (it must include the
`aws lambda-web` command). You do not need to configure the AWS CLI: the scripts use
the keys in `.env.deploy` and ignore `~/.aws`.

```bash
npm run package        # builds the app and creates lambda.zip
npm run deploy:dev     # uploads lambda.zip and deploys it to dev; prints the dev URL
```

Open the dev URL. The page should say "Notes (dev)". When it works:

```bash
npm run deploy:prod    # deploys the exact version you just tested on dev
```

Prod shows "Notes (prod)" and uses your prod table.

## Environment variables

Your app needs different settings in different places, so each has its own file. Both
`.env.dev` and `.env.prod` start with `TABLE_NAME` and `APP_ENV`. Add your own variables below them,
in the file for the place that needs them:

```
# .env.local: used by npm run dev
STRIPE_SECRET_KEY=sk_test_...

# .env.dev: sent to your dev function
TABLE_NAME=<your dev table, already filled in>
APP_ENV=dev
STRIPE_SECRET_KEY=sk_test_...

# .env.prod: sent to your prod function
TABLE_NAME=<your prod table, already filled in>
APP_ENV=prod
STRIPE_SECRET_KEY=sk_live_...
```

A variable your app needs when deployed must be in **both** `.env.dev` and `.env.prod`, or it
will be missing from the one you leave out.

**Changing only variables?** You don't need to rebuild or upload anything:

```bash
npm run deploy:dev:env     # re-deploy dev's current code with the variables in .env.dev
npm run deploy:prod:env    # re-deploy prod's current code with the variables in .env.prod
```

These reuse the code version you last deployed to that function from this folder.

How the files are read:

- One `KEY=value` per line. A `#` starts a comment only at the beginning of a line, so put
  comments on their own line. Quotes around a whole value are removed, and nothing else in a
  value is changed.
- Every deploy sends exactly what is in the file. **Remove a line and the variable is gone** from
  the new version. A missing file stops the deploy, so a deleted file can't wipe your variables.
  An empty file is fine.
- The deploy checks the file before it uploads anything, prints the variable **names** it sends
  (never the values), and tells you the line of any problem.
- **What is in the file is what runs.** `TABLE_NAME` is your table for that function. Your dev
  function can only reach your dev table, and prod only your prod table, so the deploy stops
  before uploading if `TABLE_NAME` says anything else. `APP_ENV` is just a label for your app
  (`dev` or `prod` to start) and you can change it. If you delete either line, the deploy adds it
  back and tells you.
- Names Lambda reserves are rejected: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
  and the other `AWS_*` credential, region and runtime names. Lambda provides its own.
- **`NEXT_PUBLIC_` variables** are built into the browser code when you run `npm run package`, so
  they come from the machine that builds, not from `.env.dev` or `.env.prod`. The deploy warns you.
- **Pages that read these variables must be rendered per request** (like `force-dynamic` in
  `app/page.tsx`). A page built ahead of time during `npm run package` only sees `.env.local`.
- AWS recommends keeping sensitive values such as API keys and database passwords in Secrets
  Manager or Parameter Store rather than in environment variables, because anyone who can read your
  Lambda configuration can read them.

## Good to know

- `npm run deploy:prod` only deploys what you last deployed to dev, so prod never runs code you did not test.
- Your dev and prod URLs are public. Add authentication before storing anything private.
