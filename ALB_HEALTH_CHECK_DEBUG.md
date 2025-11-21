# ALB Health Check Debugging

## Container is Working ✅
- Health endpoint `/health` returns 200 OK
- Nginx starts correctly
- Port 8443 is listening
- Tested locally - all works

## What to Check in AWS/Katana

### 1. ALB Target Group Health Check Settings
Go to AWS Console → EC2 → Target Groups → Find your target group

**Verify:**
- **Protocol**: Must be `HTTP` (NOT HTTPS - ALB terminates SSL)
- **Port**: `8443`
- **Path**: `/health`
- **Success codes**: `200`
- **Interval**: 30 seconds
- **Timeout**: 5 seconds
- **Healthy threshold**: 2
- **Unhealthy threshold**: 3

### 2. ALB Listener Default Action
Go to AWS Console → EC2 → Load Balancers → Find your ALB → Listeners

**Verify:**
- Default action is **"Forward to target group"** (NOT "Return fixed response 502")
- Target group is selected and correct

### 3. Security Groups
**ALB Security Group:**
- Outbound: Allow HTTPS to ECS security group on port 8443

**ECS Security Group:**
- Inbound: Allow HTTPS from ALB security group on port 8443
- **OR** Allow HTTP from ALB security group on port 8443 (if health checks use HTTP)

### 4. ECS Task Definition
- Port mapping: Container port 8443 → Host port 8443
- Health check: Should be disabled (ALB handles it)

### 5. Check CloudWatch Logs
Look at ECS task logs to see if:
- Container is starting
- Nginx is running
- Any errors in logs

### 6. Test from ECS Task
SSH into ECS task and test:
```bash
curl http://localhost:8443/health
```

## Most Likely Issues

1. **Target group health check using HTTPS instead of HTTP**
   - Fix: Change target group health check protocol to HTTP

2. **Security group blocking health checks**
   - Fix: Allow HTTP/HTTPS from ALB to ECS on port 8443

3. **ALB listener still misconfigured**
   - Fix: Change default action to forward to target group

