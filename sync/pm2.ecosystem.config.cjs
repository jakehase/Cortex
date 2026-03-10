module.exports = {
  apps: [
    {
      name: 'cortex-git-autosync',
      script: '/opt/clawdbot/sync/cortex_git_sync_loop.sh',
      interpreter: '/usr/bin/env bash',
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      env: {
        REPO_ROOT: '/opt/clawdbot',
        SYNC_INTERVAL_SECONDS: '300',
        DEBOUNCE_SECONDS: '300',
        PUSH_MAX_RETRIES: '4',
        SYNC_BRANCH: 'main'
      }
    }
  ]
};
