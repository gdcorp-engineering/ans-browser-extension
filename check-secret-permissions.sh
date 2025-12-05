#!/bin/bash
# Check secret permissions and resource policy

SECRET_NAME="ansmarketp/ans-browser-extension/dev-private-ecs"
REGION="us-west-2"

echo "Checking secret: $SECRET_NAME"
echo ""

# Check if resource policy exists
echo "Checking resource policy..."
aws secretsmanager get-resource-policy \
  --secret-id "$SECRET_NAME" \
  --region "$REGION" 2>&1 | head -20

echo ""
echo ""
echo "Note: If the secret doesn't have a resource policy, Katana's service role"
echo "needs IAM permissions to access it. This is usually handled by Katana's"
echo "service role having SecretsManager permissions."
echo ""
echo "The secret exists, so the issue is likely:"
echo "1. Katana service role doesn't have permissions"
echo "2. Secret is in wrong account (Katana might be looking in a different account)"
echo "3. There's a timing/caching issue"
