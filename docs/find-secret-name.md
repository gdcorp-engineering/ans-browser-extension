# Finding the Correct Secret Name

The error doesn't tell us the exact secret name Katana is looking for. Here's how to find it:

## Option 1: Check Katana UI (Recommended)

1. Go to: https://katana.int.gdcorp.tools
2. Navigate to: `ansmarketp/ans-browser-extension`
3. Click on the `dev-private-ecs` environment
4. Look for "Secrets" or "Environment Secrets" section
5. Note the exact secret name/ARN configured there

## Option 2: List All Secrets in AWS

```bash
# List all secrets to see what exists
aws secretsmanager list-secrets --region us-west-2 | grep -i "ans-browser-extension"

# Or list all secrets and search
aws secretsmanager list-secrets --region us-west-2 --query 'SecretList[].Name' --output table
```

## Option 3: Check ECS Task Definition

The task definition might show the secret ARN:
```bash
# Get the task definition (replace with actual task definition name)
aws ecs describe-task-definition \
  --task-definition dev-private-ecs-ans-browser-extension-125125 \
  --region us-west-2 \
  --query 'taskDefinition.containerDefinitions[0].secrets' \
  --output json
```

## Common Secret Name Patterns

Katana might be looking for:
- `ansmarketp/ans-browser-extension/dev-private-ecs`
- `ans-browser-extension/dev-private-ecs`
- `ansmarketp-ans-browser-extension-dev-private-ecs`
- Something with the artifact ID: `ans-browser-extension-125125`

Once you find the exact name, create it with:
```bash
aws secretsmanager create-secret \
  --name "<exact-secret-name>" \
  --description "Secrets for ans-browser-extension dev-private-ecs" \
  --secret-string '{}' \
  --region us-west-2
```
