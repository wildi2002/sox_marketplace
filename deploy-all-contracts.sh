#!/bin/bash

# Script to deploy all SOX contracts
# Alias for deploy-contracts.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/deploy-contracts.sh" "$@"
