#!/bin/bash
# Check ECS task definition to see what secret name it's trying to use

echo "Checking ECS task definitions for secret references..."
echo ""

# Try to find the task definition
TASK_DEF_PATTERN="dev-private-ecs-ans-browser-extension"

echo "Searching for task definitions matching: $TASK_DEF_PATTERN"
echo ""

# List task definitions
aws ecs list-task-definitions --region us-west-2 --query 'taskDefinitionArns[?contains(@, `ans-browser-extension`) || contains(@, `dev-private-ecs`)].@' --output text 2>/dev/null | head -5

echo ""
echo "If you can get a specific task definition name, run:"
echo "aws ecs describe-task-definition --task-definition <name> --region us-west-2 --query 'taskDefinition.containerDefinitions[0].secrets' --output json"
