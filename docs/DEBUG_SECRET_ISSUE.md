# Debugging Secret Issue

The secret `ansmarketp/ans-browser-extension/dev-private-ecs` exists, but Katana is still reporting it can't find it.

## Possible Causes

1. **Wrong Secret Name**: Katana might be looking for a different secret name
2. **Permissions Issue**: Katana service role might not have access to the secret
3. **Region Mismatch**: Secret might be in wrong region
4. **Account Mismatch**: Secret might be in wrong AWS account

## How to Find the Exact Secret Name

### Option 1: Check ECS Task Definition

The task definition will show the exact secret ARN/name:

```bash
# List recent task definitions
aws ecs list-task-definitions \
  --region us-west-2 \
  --query 'taskDefinitionArns[?contains(@, `ans-browser-extension`)].@' \
  --output table

# Get the latest one and check secrets
aws ecs describe-task-definition \
  --task-definition dev-private-ecs-ans-browser-extension-125125 \
  --region us-west-2 \
  --query 'taskDefinition.containerDefinitions[0].secrets' \
  --output json
```

### Option 2: Check CloudFormation Stack

The CloudFormation stack might show the secret configuration:

```bash
aws cloudformation describe-stack-resources \
  --stack-name KatanaEnvironment6869Artifact125125 \
  --region us-west-2 \
  --query 'StackResources[?ResourceType==`AWS::ECS::TaskDefinition`]' \
  --output json
```

### Option 3: Check Katana Environment Configuration

1. Go to Katana UI: https://katana.int.gdcorp.tools
2. Navigate to: `ansmarketp/ans-browser-extension/dev-private-ecs`
3. Check the environment configuration for any secret references
4. Look at the raw JSON/YAML if available

## Verify Secret Access

Check if the secret is accessible:

```bash
# Verify secret exists and is accessible
aws secretsmanager describe-secret \
  --secret-id "ansmarketp/ans-browser-extension/dev-private-ecs" \
  --region us-west-2

# Check the secret value
aws secretsmanager get-secret-value \
  --secret-id "ansmarketp/ans-browser-extension/dev-private-ecs" \
  --region us-west-2 \
  --query SecretString \
  --output text
```

## Check IAM Permissions

The Katana service role needs permissions to access the secret. Check if there's a resource policy:

```bash
aws secretsmanager get-resource-policy \
  --secret-id "ansmarketp/ans-browser-extension/dev-private-ecs" \
  --region us-west-2
```

## Alternative: Check All Secrets

List all secrets to see what exists:

```bash
aws secretsmanager list-secrets \
  --region us-west-2 \
  --filters Key=name,Values=ans-browser-extension \
  --query 'SecretList[].Name' \
  --output table
```

## Next Steps

Once you find the exact secret name from the task definition or CloudFormation stack, create it with that exact name.

