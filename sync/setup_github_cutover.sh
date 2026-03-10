#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/opt/clawdbot}"
GITHUB_REPO="${GITHUB_REPO:-}"
GITHUB_VISIBILITY="${GITHUB_VISIBILITY:-public}"
SYNC_BRANCH="${SYNC_BRANCH:-main}"

if [[ -z "$GITHUB_REPO" ]]; then
  echo "ERROR: set GITHUB_REPO=owner/repo"
  exit 2
fi

cd "$REPO_ROOT"

if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  echo "$GITHUB_TOKEN" | gh auth login --with-token >/dev/null
fi

gh auth status >/dev/null

# Create repo if missing
if ! gh repo view "$GITHUB_REPO" >/dev/null 2>&1; then
  gh repo create "$GITHUB_REPO" --"$GITHUB_VISIBILITY" >/dev/null
fi

remote_url="https://github.com/${GITHUB_REPO}.git"
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$remote_url"
else
  git remote add origin "$remote_url"
fi

# Ensure local branch
current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" != "$SYNC_BRANCH" ]]; then
  git branch -M "$SYNC_BRANCH"
fi

git push -u origin "$SYNC_BRANCH"
echo "Cutover complete: origin=$remote_url branch=$SYNC_BRANCH"
