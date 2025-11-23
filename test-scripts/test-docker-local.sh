#!/bin/bash

# Script to test Docker build and run locally
# This helps validate the container before deploying to ECS

set -e

# Find Docker binary and set PATH for credential helper
if command -v docker &> /dev/null; then
    DOCKER_CMD="docker"
elif [ -f "/usr/local/bin/docker" ]; then
    DOCKER_CMD="/usr/local/bin/docker"
elif [ -f "/Applications/Docker.app/Contents/Resources/bin/docker" ]; then
    DOCKER_CMD="/Applications/Docker.app/Contents/Resources/bin/docker"
    # Add Docker's bin directory to PATH for credential helper
    export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
else
    echo "❌ Docker not found. Please ensure Docker Desktop is installed and running."
    echo "   On macOS, Docker Desktop should be in /Applications/Docker.app"
    exit 1
fi

# Ensure Docker credential helper is in PATH
if [ -d "/Applications/Docker.app/Contents/Resources/bin" ]; then
    export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
fi

echo "🐳 Testing Docker build locally..."
echo "Using Docker: $DOCKER_CMD"
echo ""

# Build the Docker image
echo "Step 1: Building Docker image..."
$DOCKER_CMD build --platform linux/amd64 \
  --build-arg BUILD_ENV=dev \
  -f Dockerfile.vite \
  -t ans-browser-extension:test \
  .

if [ $? -ne 0 ]; then
  echo "❌ Docker build failed"
  exit 1
fi

echo "✅ Docker build successful"
echo ""

# Stop and remove any existing container
echo "Step 2: Cleaning up any existing containers..."
$DOCKER_CMD stop ans-extension-test 2>/dev/null || true
$DOCKER_CMD rm ans-extension-test 2>/dev/null || true

# Run the container
echo "Step 3: Starting container on port 8443..."
$DOCKER_CMD run -d \
  --name ans-extension-test \
  -p 8443:8443 \
  ans-browser-extension:test

if [ $? -ne 0 ]; then
  echo "❌ Failed to start container"
  exit 1
fi

echo "✅ Container started"
echo ""

# Wait a moment for nginx to start
echo "Step 4: Waiting for nginx to start..."
sleep 3

# Check container logs
echo "Step 5: Checking container logs..."
$DOCKER_CMD logs ans-extension-test

echo ""
echo "Step 6: Testing health endpoint..."
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8443/health || echo "000")

if [ "$HEALTH_RESPONSE" = "200" ]; then
  echo "✅ Health check passed (HTTP $HEALTH_RESPONSE)"
else
  echo "❌ Health check failed (HTTP $HEALTH_RESPONSE)"
fi

echo ""
echo "Step 7: Testing root endpoint..."
ROOT_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8443/ || echo "000")

if [ "$ROOT_RESPONSE" = "200" ]; then
  echo "✅ Root endpoint works (HTTP $ROOT_RESPONSE)"
else
  echo "❌ Root endpoint failed (HTTP $ROOT_RESPONSE)"
fi

echo ""
echo "Step 8: Testing downloads endpoint..."
DOWNLOAD_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8443/downloads/ans-extension-dev-latest.zip || echo "000")

if [ "$DOWNLOAD_RESPONSE" = "200" ]; then
  echo "✅ Download endpoint works (HTTP $DOWNLOAD_RESPONSE)"
  DOWNLOAD_SIZE=$(curl -s -I http://localhost:8443/downloads/ans-extension-dev-latest.zip | grep -i content-length | awk '{print $2}' | tr -d '\r')
  echo "   ZIP file size: $DOWNLOAD_SIZE bytes"
else
  echo "❌ Download endpoint failed (HTTP $DOWNLOAD_RESPONSE)"
fi

echo ""
echo "Step 9: Checking container status..."
$DOCKER_CMD ps --filter name=ans-extension-test --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "📋 Summary:"
echo "   - Container: ans-extension-test"
echo "   - Health endpoint: http://localhost:8443/health"
echo "   - Root endpoint: http://localhost:8443/"
echo "   - Download: http://localhost:8443/downloads/ans-extension-dev-latest.zip"
echo ""
echo "To stop the container: $DOCKER_CMD stop ans-extension-test"
echo "To remove the container: $DOCKER_CMD rm ans-extension-test"
echo "To view logs: $DOCKER_CMD logs -f ans-extension-test"

