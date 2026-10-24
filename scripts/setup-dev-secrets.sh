#!/bin/bash
set -e

# Check OpenSSL availability
if ! command -v openssl >/dev/null 2>&1; then
    echo "Error: openssl is not available" >&2
    exit 1
fi

DEV_VARS_FILE=".dev.vars"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# Set secure umask
umask 077

# Create or update .dev.vars atomically
if [ ! -f "$DEV_VARS_FILE" ]; then
    TMP_FILE=$(mktemp)
    chmod 600 "$TMP_FILE"
    echo "SESSION_SECRET=$(openssl rand -hex 32)" >> "$TMP_FILE"
    echo "CSRF_SECRET=$(openssl rand -hex 32)" >> "$TMP_FILE"
    # Add other required secrets if any
    mv "$TMP_FILE" "$DEV_VARS_FILE"
    chmod 600 "$DEV_VARS_FILE"
    echo "Generated development secrets in $DEV_VARS_FILE"
else
    TMP_FILE=$(mktemp)
    chmod 600 "$TMP_FILE"
    
    # Preserve existing valid values
    SESSION_EXISTS=0
    CSRF_EXISTS=0
    
    if grep -q "^SESSION_SECRET=" "$DEV_VARS_FILE"; then
        SESSION_VAL=$(grep "^SESSION_SECRET=" "$DEV_VARS_FILE" | cut -d'=' -f2-)
        if [ -n "$SESSION_VAL" ] && [ "$SESSION_VAL" != "" ]; then
            echo "SESSION_SECRET=$SESSION_VAL" >> "$TMP_FILE"
            SESSION_EXISTS=1
        fi
    fi
    
    if grep -q "^CSRF_SECRET=" "$DEV_VARS_FILE"; then
        CSRF_VAL=$(grep "^CSRF_SECRET=" "$DEV_VARS_FILE" | cut -d'=' -f2-)
        if [ -n "$CSRF_VAL" ] && [ "$CSRF_VAL" != "" ]; then
            echo "CSRF_SECRET=$CSRF_VAL" >> "$TMP_FILE"
            CSRF_EXISTS=1
        fi
    fi
    
    # Add missing values without duplicating
    if [ $SESSION_EXISTS -eq 0 ]; then
        echo "SESSION_SECRET=$(openssl rand -hex 32)" >> "$TMP_FILE"
    fi
    
    if [ $CSRF_EXISTS -eq 0 ]; then
        echo "CSRF_SECRET=$(openssl rand -hex 32)" >> "$TMP_FILE"
    fi
    
    # Preserve other lines
    grep -v "^SESSION_SECRET=" "$DEV_VARS_FILE" | grep -v "^CSRF_SECRET=" | grep -v "^$" >> "$TMP_FILE" || true
    
    mv "$TMP_FILE" "$DEV_VARS_FILE"
    chmod 600 "$DEV_VARS_FILE"
    echo "Updated development secrets in $DEV_VARS_FILE"
fi

# The local/admin ingestion command needs a bearer token. Generate one only when
# missing; never print or overwrite an existing value.
if ! grep -q '^INGEST_TOKEN=' "$DEV_VARS_FILE"; then
    printf 'INGEST_TOKEN=%s\n' "$(openssl rand -hex 24)" >> "$DEV_VARS_FILE"
    chmod 600 "$DEV_VARS_FILE"
    echo "Added a local INGEST_TOKEN to $DEV_VARS_FILE (value not printed)"
fi
