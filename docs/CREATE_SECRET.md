# Create the Correct Secret

Based on the agent-marketplace-v1 configuration, the secret name pattern is:
`${namespace}/${app}/${environment}`

For your app, this means:
- Namespace: `ansmarketp`
- App: `ans-browser-extension`
- Environment: `dev-private-ecs`
- **Secret Name: `ansmarketp/ans-browser-extension/dev-private-ecs`**

## Quick Command

```bash
aws secretsmanager create-secret \
  --name "ansmarketp/ans-browser-extension/dev-private-ecs" \
  --description "Empty secret for ans-browser-extension (no secrets needed, required by Katana)" \
  --secret-string '{}' \
  --region us-west-2
```

## Or Use the Script

```bash
cd /Users/mcahill/ans-browser-extension
./scripts/create-empty-secret.sh
```

## Verify It Exists

```bash
aws secretsmanager describe-secret \
  --secret-id "ansmarketp/ans-browser-extension/dev-private-ecs" \
  --region us-west-2
```

If you already created secrets with different names, you can delete them:
```bash
# Delete the incorrectly named secrets
aws secretsmanager delete-secret \
  --secret-id "ans-browser-extension/dev-private-ecs" \
  --force-delete-without-recovery \
  --region us-west-2

aws secretsmanager delete-secret \
  --secret-id "ansmarketp/ans-browser-extension/dev-private-ecs" \
  --force-delete-without-recovery \
  --region us-west-2
```

Then create the correct one with the command above.
