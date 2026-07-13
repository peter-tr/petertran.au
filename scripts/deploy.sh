#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

aws login

npm run build --workspace=api
npm run build --workspace=web

npm run cdk --workspace=infra -- deploy --all --concurrency 4 --require-approval never

BUCKET=$(aws cloudformation describe-stacks --stack-name PetertranSiteStack --region ap-southeast-2 \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text)
aws s3 sync web/dist "s3://$BUCKET" --delete
# The prerendered /resume route has no file extension, so S3 can't
# content-type-sniff it from sync alone - see deploy.yml for the full note.
aws s3 cp web/dist/resume "s3://$BUCKET/resume" --content-type text/html

DIST_ID=$(aws cloudformation describe-stacks --stack-name PetertranSiteStack --region ap-southeast-2 \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text)
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*"
