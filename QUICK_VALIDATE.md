# Quick Local Validation

## Step 1: Start Docker Desktop

Make sure Docker Desktop is running on your Mac.

## Step 2: Run the Test Script

```bash
./test-docker-local.sh
```

This will:
- Build the Docker image
- Start a container
- Test all endpoints
- Show you the results

## Step 3: Manual Commands (if script doesn't work)

```bash
# Build
docker build --platform linux/amd64 --build-arg BUILD_ENV=dev -f Dockerfile.vite -t ans-browser-extension:test .

# Run
docker run -d --name ans-extension-test -p 8443:8443 ans-browser-extension:test

# Check logs
docker logs -f ans-extension-test

# Test health
curl http://localhost:8443/health

# Test root
curl http://localhost:8443/

# Clean up
docker stop ans-extension-test && docker rm ans-extension-test
```

## What to Look For

✅ **Success indicators:**
- Build completes without errors
- Container stays running (check with `docker ps`)
- Health endpoint returns "healthy" with HTTP 200
- Root endpoint returns HTML with HTTP 200
- Download endpoint returns ZIP file with HTTP 200

❌ **Failure indicators:**
- Container exits immediately
- Health check returns non-200 status
- Nginx errors in logs
- Files missing in container

