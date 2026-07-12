#!/bin/bash
# clean.sh — Remove ALL build artifacts, caches, and generated files.
#
# Usage: scripts/clean.sh
#
# Ensures every subsequent build starts from scratch — no cached .o files,
# no stale node_modules, no leftover dist folders. This is the first step
# in both scripts/test.sh and scripts/build.sh.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Cleaning build artifacts ==="

# C build artifacts
rm -rf "$ROOT/build/c"

# Frontend build artifacts. Dependencies stay in place: C tests do not use
# them, and release/UI builds already run `npm ci` when they need a clean tree.
rm -rf "$ROOT/graph-ui/dist"

# `embedded_assets.c` is currently versioned as the checked-in fallback for the
# UI build. `embed-frontend.sh` overwrites it when a fresh embedded bundle is
# requested, so removing it here only leaves an otherwise clean worktree dirty.

# Leftover test fixture dirs (C test suite sometimes creates these in CWD)
find "$ROOT" -maxdepth 1 -type d \( -name 'cbm_*' -o -name 'cli-*' \) -exec rm -rf {} + 2>/dev/null || true

# Leftover test fixture dirs in /tmp
find /tmp -maxdepth 1 -type d \( -name 'cbm_*' -o -name 'cli-*' \) -user "$(id -u)" -exec rm -rf {} + 2>/dev/null || true

echo "=== Clean complete ==="
