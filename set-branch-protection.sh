#!/bin/bash

# Script to set branch protection rules for main branch
# Requires GitHub CLI (gh) to be installed and authenticated
# Install: brew install gh
# Authenticate: gh auth login

REPO="gdcorp-im/ans-browser-extension-v1-temp"
BRANCH="main"

echo "Setting branch protection rules for $BRANCH branch in $REPO..."

# Check if gh is installed
if ! command -v gh &> /dev/null; then
    echo "Error: GitHub CLI (gh) is not installed."
    echo "Install it with: brew install gh"
    echo "Then authenticate with: gh auth login"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo "Error: Not authenticated with GitHub CLI."
    echo "Run: gh auth login"
    exit 1
fi

# Set branch protection rules
gh api repos/$REPO/branches/$BRANCH/protection \
  --method PUT \
  --field required_status_checks=null \
  --field enforce_admins=null \
  --field required_pull_request_reviews=null \
  --field restrictions=null \
  --field allow_force_pushes=false \
  --field allow_deletions=false \
  --field block_creations=false \
  --field required_conversation_resolution=false \
  --field lock_branch=false \
  --field allow_fork_syncing=false

if [ $? -eq 0 ]; then
    echo "✅ Branch protection rules set successfully for $BRANCH branch"
else
    echo "❌ Failed to set branch protection rules"
    echo "Make sure you have admin access to the repository"
    exit 1
fi

