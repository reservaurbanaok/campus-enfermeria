#!/bin/sh
set -eu

mkdir -p /home/node/.n8n
chown -R node:node /home/node/.n8n

exec su -s /bin/sh node -c 'exec n8n "$@"' -- "$@"


