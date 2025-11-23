# Katana Path Configuration Issue

## Problem

The Katana configuration has a "Path" field set to `/deploy`, but this is a Docker/ECS deployment, not a file-based deployment.

## Why This Might Be a Problem

For **ECS deployments**, Katana should:
- Use the Docker image from ECR
- Not look for files in a repository path

The `/deploy` path is typically used for:
- Static site deployments (S3, CloudFront)
- File-based deployments
- Monorepo deployments where you need to specify a subdirectory

## Solution

### Option 1: Remove the Path (Recommended)

In the Katana UI:
1. Go to: `ansmarketp/ans-browser-extension`
2. Edit the app configuration
3. Remove or clear the "Path" field (set it to empty or `/`)
4. Save the changes

### Option 2: Set Path to Root

If the field is required, set it to `/` (root of the repository)

## Why This Matters

If Katana is trying to use the `/deploy` path for ECS deployments, it might be:
- Looking for files that don't exist in the repo
- Causing confusion in the deployment process
- Interfering with the Docker image deployment

## Verification

After removing/clearing the path:
1. The deployment should use only the Docker image
2. No file path lookups should occur
3. The container should deploy normally

## Note

The `/deploy` directory in the Dockerfile is **internal to the Docker build** - it's created during the build process and copied into the container. Katana should not be looking for this path in the repository.

