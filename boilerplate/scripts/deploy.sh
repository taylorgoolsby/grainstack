#!/usr/bin/env bash
# Deploys to your dev or prod Web Function.
#
#   ./scripts/deploy.sh dev                     upload lambda.zip and deploy it to dev
#   ./scripts/deploy.sh prod                    deploy the version last deployed to dev
#   ./scripts/deploy.sh <dev|prod> --env-only   same code as that function's last deploy, with the
#                                               current variables (no rebuild or upload)
#
# The function's environment variables come from .env.dev (dev) and .env.prod (prod).
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-}"
FLAG="${2:-}"
if [[ "$TARGET" != "dev" && "$TARGET" != "prod" ]] || [[ -n "$FLAG" && "$FLAG" != "--env-only" ]]; then
  echo "Usage: ./scripts/deploy.sh <dev|prod> [--env-only]" >&2
  exit 1
fi
ENV_ONLY=false
if [ "$FLAG" = "--env-only" ]; then ENV_ONLY=true; fi

ENV_FILE=".env.deploy"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE in the project root." >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js is required to run this script." >&2; exit 1; }

# Use ONLY the credentials in .env.deploy: drop any AWS_* variables already in this shell,
# and ignore ~/.aws entirely.
for v in $(env | grep -o '^AWS_[A-Za-z_]*' || true); do unset "$v"; done
set -a; source "$ENV_FILE"; set +a
export AWS_SHARED_CREDENTIALS_FILE=/dev/null AWS_CONFIG_FILE=/dev/null AWS_EC2_METADATA_DISABLED=true

AWS="aws --region ${AWS_REGION:?AWS_REGION missing in $ENV_FILE}"
RUNTIME="${GRAINSTACK_RUNTIME:?GRAINSTACK_RUNTIME missing in $ENV_FILE}"   # defined by the provisioner, with the timeout

$AWS lambda-web help >/dev/null 2>&1 || {
  echo "Your AWS CLI has no 'lambda-web' command. Update to the latest AWS CLI v2." >&2
  exit 1
}

if [ "$TARGET" = "dev" ]; then
  FN="$GRAINSTACK_DEV_FUNCTION"; ROLE="$GRAINSTACK_DEV_ROLE_ARN"; TABLE="$GRAINSTACK_DEV_TABLE"
else
  FN="$GRAINSTACK_PROD_FUNCTION"; ROLE="$GRAINSTACK_PROD_ROLE_ARN"; TABLE="$GRAINSTACK_PROD_TABLE"
fi

# Read and check .env.dev / .env.prod BEFORE uploading anything, so a typo fails fast.
# A revision is a complete, immutable snapshot, so every variable is sent on every deploy.
SERVICE_CONFIG=$(GS_ROLE_ARN="$ROLE" GS_TABLE="$TABLE" node scripts/service-config.mjs "$TARGET")

# Decide which code version to deploy.
if [ "$TARGET" = "dev" ] && [ "$ENV_ONLY" = false ]; then
  [ -f lambda.zip ] || { echo "lambda.zip not found. Run: npm run package" >&2; exit 1; }
  echo "Uploading lambda.zip..."
  VID=$($AWS s3api put-object --bucket "$GRAINSTACK_BUCKET" --key lambda.zip \
        --body lambda.zip --query VersionId --output text)
else
  if [ "$TARGET" = "prod" ] && [ "$ENV_ONLY" = false ]; then SOURCE="dev"; else SOURCE="$TARGET"; fi
  [ -f ".deployed-$SOURCE-version" ] || {
    if [ "$ENV_ONLY" = true ]; then
      echo "No $SOURCE deploy recorded from this folder yet, so there is no code version to reuse." >&2
      echo "Run a normal deploy first: npm run deploy:$TARGET" >&2
    else
      echo "Nothing to promote yet. Deploy to dev first: npm run deploy:dev" >&2
    fi
    exit 1
  }
  VID=$(cat ".deployed-$SOURCE-version")
fi

if [ "$TARGET" = "prod" ]; then
  read -r -p "Deploy code version $VID with the variables in .env.prod to PROD? Type 'prod' to confirm: " CONFIRM
  [ "$CONFIRM" = "prod" ] || { echo "Cancelled."; exit 1; }
fi

echo "Creating a new revision of $FN..."
REV=$($AWS lambda-web create-web-function-revision \
  --function-name "$FN" \
  --build-config "{\"codeConfig\":{\"s3Object\":{\"bucket\":\"$GRAINSTACK_BUCKET\",\"key\":\"lambda.zip\",\"versionId\":\"$VID\"}},\"runtimeConfig\":{\"runtime\":\"$RUNTIME\"}}" \
  --service-config "$SERVICE_CONFIG" \
  --query revisionId --output text)
[ -n "$REV" ] && [ "$REV" != "None" ] || { echo "Could not read the new revision ID." >&2; exit 1; }

echo "Waiting for revision $REV to become active..."
$AWS lambda-web wait web-function-revision-active --function-name "$FN" --revision-id "$REV"

# Remember what is running, only now that the revision is active.
echo "$VID" > ".deployed-$TARGET-version"

DOMAIN=$($AWS lambda-web get-web-function-endpoint --function-name "$FN" \
  --endpoint-name live --query domainName --output text)
echo "Deployed to $TARGET: https://$DOMAIN"
echo "An active revision can still fail to serve requests, so open the URL to check."
