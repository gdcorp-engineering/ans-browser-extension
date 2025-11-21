# Local Docker Validation Guide

This guide helps you validate the Docker build and container locally before deploying to ECS.

## Prerequisites

- Docker installed and running
- Port 8443 available on your machine

## Quick Test Script

Run the provided test script:

```bash
./test-docker-local.sh
```

This will:
1. Build the Docker image
2. Start a container on port 8443
3. Test the health endpoint
4. Test the root endpoint
5. Test the download endpoint
6. Show container logs

## Manual Testing Steps

### 1. Build the Docker Image

```bash
docker build --platform linux/amd64 \
  --build-arg BUILD_ENV=dev \
  -f Dockerfile.vite \
  -t ans-browser-extension:test \
  .
```

### 2. Run the Container

```bash
docker run -d \
  --name ans-extension-test \
  -p 8443:8443 \
  ans-browser-extension:test
```

### 3. Check Container Logs

```bash
docker logs -f ans-extension-test
```

Look for:
- "Starting nginx..."
- "✓ index.html exists"
- "Nginx configuration is valid"
- "Starting nginx in foreground..."

### 4. Test Health Endpoint

```bash
curl http://localhost:8443/health
```

Expected response: `healthy` with HTTP 200

### 5. Test Root Endpoint

```bash
curl -I http://localhost:8443/
```

Expected: HTTP 200

### 6. Test Download Endpoint

```bash
curl -I http://localhost:8443/downloads/ans-extension-dev-latest.zip
```

Expected: HTTP 200 with Content-Type: application/zip

### 7. Open in Browser

Open http://localhost:8443/ in your browser to see the installer page.

### 8. Clean Up

```bash
docker stop ans-extension-test
docker rm ans-extension-test
docker rmi ans-browser-extension:test
```

## Troubleshooting

### Container exits immediately

Check logs:
```bash
docker logs ans-extension-test
```

Common issues:
- Nginx configuration error
- Missing files
- Port conflict

### Health check fails

1. Check if nginx is running:
   ```bash
   docker exec ans-extension-test ps aux | grep nginx
   ```

2. Test health endpoint from inside container:
   ```bash
   docker exec ans-extension-test wget -qO- http://localhost:8443/health
   ```

3. Check nginx error logs:
   ```bash
   docker exec ans-extension-test cat /var/log/nginx/error.log
   ```

### Files missing

Check what's in the container:
```bash
docker exec ans-extension-test ls -la /usr/share/nginx/html/
docker exec ans-extension-test ls -la /usr/share/nginx/html/downloads/
```

## Expected File Structure in Container

```
/usr/share/nginx/html/
├── index.html
├── downloads/
│   └── ans-extension-dev-latest.zip
```

## Common Issues

1. **Port 8443 already in use**: Change the port mapping: `-p 8444:8443`
2. **Permission errors**: Check file permissions in the container
3. **Nginx won't start**: Check nginx config with `docker exec ans-extension-test nginx -t`

