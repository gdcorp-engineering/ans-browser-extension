#!/bin/bash
# Verify the secret exists and check its details

SECRET_NAME="ansmarketp/ans-browser-extension/dev-private-ecs"
REGION="us-west-2"

echo "Checking secret: $SECRET_NAME"
echo ""

# Check if secret exists
if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" &> /dev/null; then
    echo "✓ Secret exists!"
    echo ""
    echo "Secret details:"
    aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" --query '{ARN:ARN,Name:Name,Description:Description}' --output table
    echo ""
    echo "Secret value (first 100 chars):"
    aws secretsmanager get-secret-value --secret-id "$SECRET_NAME" --region "$REGION" --query SecretString --output text | head -c 100
    echo ""
else
    echo "✗ Secret does not exist!"
    echo ""
    echo "Creating it now..."
    aws secretsmanager create-secret \
        --name "$SECRET_NAME" \
        --description "Empty secret for ans-browser-extension (no secrets needed, required by Katana)" \
        --secret-string '{}' \
        --region "$REGION"
    echo "✓ Secret created!"
fi

echo ""
echo "Checking for other potential secret names..."
aws secretsmanager list-secrets --region "$REGION" --query 'SecretList[?contains(Name, `ans-browser-extension`)].Name' --output table
