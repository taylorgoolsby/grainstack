#!/usr/bin/env bash
# Builds the app and zips it for your Lambda Web Functions: creates ./lambda.zip
set -euo pipefail
cd "$(dirname "$0")/.."

# 1. Build the Next.js app (output: "standalone")
npm run build

[ -f .next/standalone/server.js ] || {
  echo "ERROR: .next/standalone/server.js not found. Check output: \"standalone\" in next.config.ts." >&2
  exit 1
}

# 2. Assemble the package directory
rm -rf lambda-pkg lambda.zip
cp -r .next/standalone lambda-pkg
mkdir -p lambda-pkg/.next
cp -r .next/static lambda-pkg/.next/static
if [ -d public ]; then
  cp -r public lambda-pkg/public
fi

# 3. Entry file for Lambda Web Functions: map the address Lambda gives us
#    onto the env vars Next.js standalone reads, then start the server.
cat > lambda-pkg/index.js <<'JS'
const [host, port] = (process.env.AWS_LAMBDA_HTTP_ENDPOINT || "localhost:3000").split(":");
process.env.HOSTNAME = host;
process.env.PORT = port;
require("./server.js");
JS

# 4. Create the zip (index.js must be at the zip root)
(cd lambda-pkg && zip -qr ../lambda.zip .)

# 5. Safety check: never ship local secrets
if unzip -l lambda.zip | grep -E "(^|[ /])\.env|(^|[ /])\.aws/"; then
  echo "ERROR: lambda.zip contains env/credential files. Aborting." >&2
  rm -f lambda.zip
  exit 1
fi

# 6. Sanity check: entry file is at the root
unzip -l lambda.zip | grep -E " index\.js$" > /dev/null || {
  echo "ERROR: index.js is not at the root of lambda.zip" >&2
  exit 1
}

ls -lh lambda.zip
echo "OK: lambda.zip is ready. Next: npm run deploy:dev"
