#!/bin/bash
# Script to create an empty secret for Katana (workaround for default secret requirement)

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Read Katana configuration
NAMESPACE=$(grep '^namespace:' katana.yaml | awk '{print $2}' | tr -d '"')
APP=$(grep '^app:' katana.yaml | awk '{print $2}' | tr -d '"')
ENVIRONMENT="dev-private-ecs"

SECRET_NAME="${NAMESPACE}/${APP}/${ENVIRONMENT}"
REGION="us-west-2"

echo "=========================================="
echo "Creating Empty Secret for Katana"
echo "=========================================="
echo ""
echo "Configuration:"
echo "  Namespace: $NAMESPACE"
echo "  App: $APP"
echo "  Environment: $ENVIRONMENT"
echo "  Secret Name: $SECRET_NAME"
echo "  Region: $REGION"
echo ""

# Check if AWS CLI is available
if ! command -v aws &> /dev/null; then
    echo "ERROR: AWS CLI is not installed or not in PATH"
    echo "Please install AWS CLI: https://aws.amazon.com/cli/"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo "ERROR: AWS credentials not configured"
    echo "Please configure AWS credentials: aws configure"
    exit 1
fi

# Check if secret already exists
if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" &> /dev/null; then
    echo -e "${YELLOW}Secret already exists: $SECRET_NAME${NC}"
    echo ""
    echo "Current secret info:"
    aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" --query '{ARN:ARN,Name:Name,Description:Description}' --output table
    echo ""
    read -p "Do you want to update it with empty JSON? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Updating secret with empty JSON..."
        aws secretsmanager update-secret \
            --secret-id "$SECRET_NAME" \
            --secret-string '{}' \
            --region "$REGION"
        echo -e "${GREEN}✓ Secret updated successfully${NC}"
    else
        echo "Skipping update."
    fi
else
    echo "Creating new secret..."
    aws secretsmanager create-secret \
        --name "$SECRET_NAME" \
        --description "Empty secret for $APP in $ENVIRONMENT (no secrets needed, required by Katana)" \
        --secret-string '{}' \
        --region "$REGION"
    
    echo -e "${GREEN}✓ Secret created successfully${NC}"
    echo ""
    echo "Secret ARN:"
    aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" --query ARN --output text
fi

echo ""
echo "=========================================="
echo "Done! The secret should now be available for Katana."
echo "This should resolve the 'Secrets Manager can't find the specified secret' error."
echo "=========================================="

