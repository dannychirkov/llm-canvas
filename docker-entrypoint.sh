#!/bin/sh

# Exit on any error
set -e

# ANSI color codes for logging
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Logging functions with colors
log_info() {
    echo "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo "${GREEN}✅ $1${NC}"
}

log_error() {
    echo "${RED}❌ $1${NC}" >&2
}

log_warning() {
    echo "${YELLOW}⚠️  $1${NC}"
}

log_process() {
    echo "${CYAN}🔄 $1${NC}"
}

# Metrics collection for monitoring
METRICS_START_TIME=$(date +%s)
METRICS_LOG="/app/prisma/.startup_metrics.log"
TIMER_NAME=""

# Initialize metrics log
init_metrics() {
    echo "# Startup metrics - $(date -Iseconds 2>/dev/null || date '+%Y-%m-%d %H:%M:%S')" > "$METRICS_LOG"
    echo "STARTUP_TIMESTAMP=$METRICS_START_TIME" >> "$METRICS_LOG"
}

# Enhanced timer function with metrics collection
start_timer() {
    TIMER_START=$(date +%s)
    TIMER_NAME="${1:-unknown}"
}

end_timer() {
    TIMER_END=$(date +%s)
    TIMER_DIFF=$((TIMER_END - TIMER_START))
    echo "${CYAN}   ⏱️  Completed in ${TIMER_DIFF} seconds${NC}"
    
    # Store metric if name provided
    if [ -n "$TIMER_NAME" ] && [ "$TIMER_NAME" != "unknown" ]; then
        local timestamp=$(date -Iseconds 2>/dev/null || date '+%Y-%m-%d %H:%M:%S')
        echo "$timestamp | $TIMER_NAME | ${TIMER_DIFF}s" >> "$METRICS_LOG" 2>/dev/null || true
    fi
    TIMER_NAME=""
}

# Export final metrics summary
export_startup_metrics() {
    local total_duration=$(( $(date +%s) - METRICS_START_TIME ))
    
    log_info "=== Startup Metrics Summary ==="
    log_info "Total startup duration: ${total_duration} seconds"
    
    if [ -f "$METRICS_LOG" ]; then
        log_info "Metrics log: $METRICS_LOG"
        # Export key metrics as environment variables for application access
        export CONTAINER_STARTUP_DURATION=$total_duration
        export CONTAINER_STARTUP_TIMESTAMP=$METRICS_START_TIME
        echo "TOTAL_STARTUP_DURATION=${total_duration}" >> "$METRICS_LOG"
    fi
}

# Security check: Verify script is running as root (required for su-exec)
if [ "$(id -u)" -ne 0 ]; then
    log_error "This script must be run as root to use su-exec"
    exit 1
fi

# Verify nextjs user exists
if ! id -u nextjs >/dev/null 2>&1; then
    log_error "nextjs user does not exist"
    exit 1
fi

log_process "Starting LLM Canvas deployment..."

# Initialize metrics collection
init_metrics

# Add node_modules to PATH
export PATH="/app/node_modules/.bin:$PATH"

# Validate and set default environment variables
export DATABASE_URL=${DATABASE_URL:-"file:/app/prisma/dev.db"}

export PORT=${PORT:-4250}
if ! echo "$PORT" | grep -qE '^[0-9]+$' || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
    log_error "Invalid PORT: $PORT (must be a number between 1 and 65535)"
    exit 1
fi

log_info "DATABASE_URL: $DATABASE_URL"
log_info "PORT: $PORT"

# Define path for persistent secret file
SECRET_FILE="/app/prisma/.auth.secret"

    # Generate AUTH_SECRET only if it doesn't exist (persistent across restarts)
    start_timer "auth_secret_generation"
    if [ ! -f "$SECRET_FILE" ]; then
        if [ -n "$AUTH_SECRET" ]; then
            log_info "Using provided AUTH_SECRET from environment"
            echo "AUTH_SECRET=$AUTH_SECRET" > "$SECRET_FILE"
        else
            log_process "Generating new AUTH_SECRET..."
            # Try openssl with timeout, fallback to /dev/urandom if it fails or hangs
            if ! SECRET_VALUE=$(timeout 5 openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -d "\n" | head -c 44) || [ -z "$SECRET_VALUE" ]; then
                log_error "Failed to generate AUTH_SECRET"
                exit 1
            fi
            echo "AUTH_SECRET=$SECRET_VALUE" > "$SECRET_FILE"
            log_success "AUTH_SECRET generated and saved to $SECRET_FILE"
        fi
    else
        log_info "Using existing AUTH_SECRET from volume"
    fi
end_timer

# Set NEXT_PUBLIC_APP_URL to AUTH_URL if not explicitly set
if [ -z "$NEXT_PUBLIC_APP_URL" ] && [ -n "$AUTH_URL" ]; then
    export NEXT_PUBLIC_APP_URL="$AUTH_URL"
    log_info "NEXT_PUBLIC_APP_URL auto-configured to: $NEXT_PUBLIC_APP_URL"
fi

# Debug environment variables
log_info "AUTH_URL: ${AUTH_URL:-not set}"
log_info "NEXT_PUBLIC_APP_URL: ${NEXT_PUBLIC_APP_URL:-not set}"
log_info "AUTH_SECRET: $([ -n "$AUTH_SECRET" ] && echo "set" || echo "not set")"

log_process "Initializing database..."

# Ensure database directory exists
if [ ! -d "/app/prisma" ]; then
    log_process "Creating /app/prisma directory..."
    mkdir -p /app/prisma
fi

# Optimized chown function: only chown if ownership is incorrect
# Uses ls -ld for compatibility with Alpine Linux (stat -c may not be available)
safe_chown() {
    local target="$1"
    local user="$2"
    local group="$3"
    
    # If path doesn't exist, it's not an error (might be created later)
    if [ ! -e "$target" ]; then
        return 0
    fi
    
    # Check current owner using ls (Alpine compatible)
    local current_owner=$(ls -ld "$target" 2>/dev/null | awk '{print $3":"$4}' || echo "")
    if [ -n "$current_owner" ] && [ "$current_owner" = "$user:$group" ]; then
        # Ownership is already correct, no need to change
        return 0
    fi
    
    # Perform chown and capture exit code
    chown -R "$user:$group" "$target" 2>/dev/null
    local chown_exit_code=$?
    
    if [ $chown_exit_code -ne 0 ]; then
        log_warning "Failed to change ownership of $target to $user:$group (exit code: $chown_exit_code)"
    fi
    
    return $chown_exit_code
}

# Ensure uploads directory exists and has correct ownership (volume-safe)
UPLOADS_DIR="/app/public/uploads"
log_process "Checking ownership for uploads directory..."
mkdir -p "$UPLOADS_DIR"
if ! safe_chown "$UPLOADS_DIR" "nextjs" "nodejs"; then
    log_error "Critical: Failed to set ownership for uploads directory"
    exit 1
fi

# Ensure prisma directory remains writable by nextjs (handles mounted volume)
log_process "Checking ownership for prisma directory..."
if ! safe_chown "/app/prisma" "nextjs" "nodejs"; then
    log_error "Critical: Failed to set ownership for prisma directory"
    exit 1
fi
# Ensure the directory is writable (not just readable)
chmod 775 "/app/prisma" 2>/dev/null || log_warning "Could not set directory permissions on /app/prisma"
# .prisma directory might not exist, failure is not critical
if ! safe_chown "/app/.prisma" "nextjs" "nodejs" 2>/dev/null; then
    log_warning "Failed to set ownership for .prisma directory (may not exist), continuing..."
fi

if [ -f "/app/prisma-template/schema.prisma" ]; then
    cp "/app/prisma-template/schema.prisma" "/app/prisma/schema.prisma" || exit 1
    mkdir -p "/app/prisma/migrations" || exit 1
    cp -R "/app/prisma-template/migrations/." "/app/prisma/migrations/" || exit 1
fi

# Run Prisma migrations
start_timer "database_migrations"
log_process "Applying database migrations..."
PRISMA_MIGRATE_LOG="/app/prisma/.migrate.log"
if npx prisma migrate deploy >"$PRISMA_MIGRATE_LOG" 2>&1; then
    log_success "Migrations applied successfully"
else
    log_error "Failed to apply database migrations"
    log_error "Error details saved to: $PRISMA_MIGRATE_LOG"
    log_error "Migration error output:"
    cat "$PRISMA_MIGRATE_LOG" >&2 || true
    log_error ""
    log_error "=========================================="
    log_error "MANUAL INTERVENTION REQUIRED"
    log_error "=========================================="
    log_error ""
    log_error "Database migrations failed. This requires manual review to prevent data loss."
    log_error ""
    log_error "Possible solutions:"
    log_error "1. Review the migration error above"
    log_error "2. Check if migrations are in sync with the database"
    log_error "3. Create a new migration: npx prisma migrate dev --name <migration_name>"
    log_error "4. If you're certain it's safe, you can manually run:"
    log_error "   npx prisma db push (WARNING: may cause data loss)"
    log_error ""
    log_error "For production environments, always:"
    log_error "- Review migrations before applying"
    log_error "- Backup your database before schema changes"
    log_error "- Test migrations in a staging environment first"
    log_error ""
    exit 1
fi
end_timer

# Fix ownership of prisma directory after migrations (only if needed)
log_process "Setting correct permissions for database directory and files..."
if ! safe_chown "/app/prisma" "nextjs" "nodejs"; then
    log_error "Critical: Failed to fix ownership of prisma directory after migrations"
    exit 1
fi

# Explicitly set permissions on database file(s) to ensure write access
# SQLite requires write access to both the database file and its directory
DB_FILE="/app/prisma/dev.db"
if [ -f "$DB_FILE" ]; then
    chmod 664 "$DB_FILE" 2>/dev/null || log_warning "Could not set permissions on $DB_FILE"
    chown nextjs:nodejs "$DB_FILE" 2>/dev/null || log_warning "Could not set ownership on $DB_FILE"
    log_info "Database file permissions set: $DB_FILE"
fi

# Also handle SQLite journal and WAL files if they exist
if [ -f "${DB_FILE}-journal" ]; then
    chmod 664 "${DB_FILE}-journal" 2>/dev/null || true
    chown nextjs:nodejs "${DB_FILE}-journal" 2>/dev/null || true
fi
if [ -f "${DB_FILE}-wal" ]; then
    chmod 664 "${DB_FILE}-wal" 2>/dev/null || true
    chown nextjs:nodejs "${DB_FILE}-wal" 2>/dev/null || true
fi
if [ -f "${DB_FILE}-shm" ]; then
    chmod 664 "${DB_FILE}-shm" 2>/dev/null || true
    chown nextjs:nodejs "${DB_FILE}-shm" 2>/dev/null || true
fi

# Ensure the prisma directory itself is writable
chmod 775 "/app/prisma" 2>/dev/null || log_warning "Could not set directory permissions on /app/prisma"

# Use the native Prisma Client generated when the image was built.
# A missing volume hash is normal on first install; it is not a reason to
# delete the compiled client or download dependencies at runtime.
PRISMA_SCHEMA="/app/prisma/schema.prisma"
COMPILED_SCHEMA="/app/node_modules/.prisma/client/schema.prisma"
SCHEMA_HASH_FILE="/app/prisma/.schema.hash"

start_timer "prisma_client_validation"
log_process "Validating the compiled Prisma Client..."
if [ ! -f "$PRISMA_SCHEMA" ] || [ ! -f "$COMPILED_SCHEMA" ] || [ ! -d "/app/node_modules/@prisma/client" ]; then
    log_error "Prisma Client or schema is missing. Rebuild the application image."
    exit 1
fi
CURRENT_HASH=$(openssl dgst -sha256 "$PRISMA_SCHEMA" | cut -d' ' -f2)
COMPILED_HASH=$(openssl dgst -sha256 "$COMPILED_SCHEMA" | cut -d' ' -f2)
if [ -z "$CURRENT_HASH" ] || [ "$CURRENT_HASH" != "$COMPILED_HASH" ]; then
    log_error "Prisma Client does not match the application schema. Rebuild the application image."
    exit 1
fi
# Retain the compatibility marker without trusting it over the actual client.
printf '%s\n' "$CURRENT_HASH" > "$SCHEMA_HASH_FILE"
log_success "Compiled Prisma Client matches the schema; no runtime generation needed"
end_timer

log_success "Database initialization complete!"

# Final verification: ensure database is writable before starting application
log_process "Verifying database write permissions..."
DB_FILE="/app/prisma/dev.db"
if [ -f "$DB_FILE" ]; then
    # Test write access by checking if we can touch the directory
    if [ -w "/app/prisma" ] && [ -w "$DB_FILE" ]; then
        log_success "Database write permissions verified"
    else
        log_error "Database or directory is not writable!"
        log_error "Directory /app/prisma writable: $([ -w "/app/prisma" ] && echo "yes" || echo "no")"
        log_error "Database file $DB_FILE writable: $([ -w "$DB_FILE" ] && echo "yes" || echo "no")"
        # Try to fix permissions one more time
        chmod 775 "/app/prisma" 2>/dev/null || true
        chmod 664 "$DB_FILE" 2>/dev/null || true
        chown nextjs:nodejs "/app/prisma" "$DB_FILE" 2>/dev/null || true
        log_warning "Attempted to fix permissions, but verification failed - this may cause runtime errors"
    fi
else
    log_warning "Database file not found at $DB_FILE (will be created on first use)"
    # Ensure directory is writable for database creation
    chmod 775 "/app/prisma" 2>/dev/null || true
    chown nextjs:nodejs "/app/prisma" 2>/dev/null || true
fi

# Load environment variables from secret file before starting server
log_process "Loading environment variables..."
if [ -f "$SECRET_FILE" ]; then
    set -a
    . "$SECRET_FILE"
    set +a
    
    # Export AUTH_SECRET to container environment
    # Use grep + sed to properly handle values containing '=' characters
    export AUTH_SECRET=$(grep "^AUTH_SECRET=" "$SECRET_FILE" | sed "s/^AUTH_SECRET=//")
    if [ -z "$AUTH_SECRET" ]; then
        log_error "AUTH_SECRET not found in $SECRET_FILE"
        exit 1
    fi
    log_success "AUTH_SECRET loaded and exported to environment"
else
    log_error "Secret file not found: $SECRET_FILE"
    exit 1
fi

# Export startup metrics before starting application
export_startup_metrics

# Start the Next.js application
log_process "Starting Next.js server on port ${PORT}..."
exec su-exec nextjs:nodejs node server.js
