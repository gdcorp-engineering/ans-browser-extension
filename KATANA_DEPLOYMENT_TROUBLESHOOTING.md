# Katana ECS Deployment Troubleshooting

## Current Issues

### 1. Health Check Failures

**Error:**
```
Task failed ELB health checks in (target-group ...)
(task ...) (port 8443) is unhealthy due to (reason Health checks failed)
```

**Possible Causes:**
1. Container not starting properly
2. Nginx not responding on port 8443
3. Health check path `/health` not accessible
4. Timing issue (container needs more time to start)

**Solutions:**

#### Check Health Check Configuration
- Health check path: `/health` (configured in workflow)
- Health check grace period: 60 seconds (configured in workflow)
- Port: 8443 (configured in Dockerfile and workflow)
- Protocol: HTTPS (ALB handles termination)

#### Verify Dockerfile Health Endpoint
The Dockerfile includes:
```nginx
location /health {
    access_log off;
    default_type text/plain;
    return 200 "healthy\n";
}
```

#### Debug Steps:
1. Check ECS task logs in CloudWatch
2. Verify the container is running: `docker ps` (if testing locally)
3. Test health endpoint locally:
   ```bash
   docker run -p 8443:8443 <image>
   curl http://localhost:8443/health
   ```
4. Check if nginx is starting: Look for nginx errors in logs

### 2. Secrets Manager Error

**Error:**
```
AWS Error: Secrets Manager can't find the specified secret.
```

**Cause:**
Katana is configured to fetch a secret from AWS Secrets Manager, but the secret doesn't exist or the name is incorrect.

**Solutions:**

#### Option 1: Remove Secret Reference (If Not Needed)
If your application doesn't need secrets, check Katana configuration to remove any secret references.

#### Option 2: Create the Missing Secret
1. Identify which secret Katana is trying to fetch:
   - Check Katana app configuration in the Katana UI
   - Look for "secrets" or "environment secrets" configuration
   - Common secret names: `ans-browser-extension/dev-private-ecs` or similar

2. Create the secret in AWS Secrets Manager:
   ```bash
   aws secretsmanager create-secret \
     --name "ans-browser-extension/dev-private-ecs" \
     --description "Secrets for ans-browser-extension dev-private-ecs environment" \
     --secret-string '{}'
   ```

3. Or if you need specific values:
   ```bash
   aws secretsmanager create-secret \
     --name "ans-browser-extension/dev-private-ecs" \
     --description "Secrets for ans-browser-extension dev-private-ecs environment" \
     --secret-string '{"KEY1":"value1","KEY2":"value2"}'
   ```

#### Option 3: Update Katana Configuration
If the secret name is wrong, update it in Katana:
1. Go to Katana UI
2. Navigate to your app: `ansmarketp/ans-browser-extension`
3. Check environment configuration for `dev-private-ecs`
4. Update or remove secret references

### 3. Container Startup Issues

**Check Container Logs:**
```bash
# Get task ID from ECS console
aws ecs describe-tasks \
  --cluster <cluster-name> \
  --tasks <task-id> \
  --region us-west-2

# View logs in CloudWatch
aws logs tail /ecs/ans-browser-extension --follow
```

**Common Issues:**
- Missing files: Check if `index.html` and `downloads/` directory exist
- Nginx configuration errors: Check nginx error logs
- Port binding issues: Verify port 8443 is exposed

## Verification Steps

### 1. Test Docker Image Locally
```bash
# Build the image
docker build -f Dockerfile.vite -t ans-browser-extension:test .

# Run the container
docker run -p 8443:8443 ans-browser-extension:test

# Test health endpoint
curl http://localhost:8443/health
# Should return: healthy

# Test main page
curl http://localhost:8443/
# Should return: HTML content
```

### 2. Check Katana Configuration
1. Verify app exists: `ansmarketp/ans-browser-extension`
2. Check environment: `dev-private-ecs`
3. Verify artifact was published successfully
4. Check for any secret references that need to be created

### 3. Check ECS Service Configuration
- Task definition includes correct port mapping (8443)
- Health check configuration matches workflow settings
- Security groups allow traffic on port 8443
- Target group health check path is `/health`

## Quick Fixes

### Fix 1: Increase Health Check Grace Period
If container needs more time to start, increase grace period in workflow:
```yaml
"healthcheckGracePeriod": 120,  # Increase from 60 to 120 seconds
```

### Fix 2: Remove Secret Dependency
If secrets aren't needed, update Katana environment configuration to remove secret references.

### Fix 3: Add Startup Delay
If nginx needs time to initialize, add a startup script:
```dockerfile
# In Dockerfile.vite, before CMD
RUN echo '#!/bin/sh' > /start.sh && \
    echo 'sleep 2' >> /start.sh && \
    echo 'nginx -g "daemon off;"' >> /start.sh && \
    chmod +x /start.sh

CMD ["/start.sh"]
```

## Next Steps

1. **Check CloudWatch Logs** for the ECS task to see actual errors
2. **Verify Secret Configuration** in Katana UI
3. **Test Docker Image Locally** to ensure it works
4. **Check ECS Task Definition** to ensure port mapping is correct
5. **Verify Security Groups** allow traffic on port 8443

## Contact

If issues persist:
- Check Katana documentation: https://katana.int.gdcorp.tools
- Review ECS service logs in CloudWatch
- Verify AWS Secrets Manager for secret existence

