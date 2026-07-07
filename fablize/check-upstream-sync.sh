#!/usr/bin/env bash
# Guard the fork's core invariant (INTEGRATION.md): the C engine stays byte-for-byte upstream,
# so `git pull upstream` always merges cleanly. Fails if any C-core path drifted from a ref.
# Lives in fablize/ (fork-owned) so the checker itself never counts as drift.
#
#   fablize/check-upstream-sync.sh [ref]      # default ref: upstream/main
set -euo pipefail
REF="${1:-upstream/main}"
# Everything the fork must NOT touch; its own value lives in fablize/ crew/ imba/ mindforge-ui/.
CORE=(src internal pkg tools vendored scripts Makefile.cbm install.sh install.ps1 server.json)

if ! git rev-parse --verify -q "$REF" >/dev/null 2>&1; then
  echo "check-upstream-sync: ref '$REF' not found. Add the upstream remote and fetch:"
  echo "  git remote add upstream https://github.com/DeusData/codebase-memory-mcp.git"
  echo "  git fetch upstream main"
  exit 2
fi

# compare only paths that exist on the ref or in the tree (the fork may add new tools/ files)
paths=()
for p in "${CORE[@]}"; do
  if git cat-file -e "$REF:$p" >/dev/null 2>&1 || [ -e "$p" ]; then paths+=("$p"); fi
done

if git diff --quiet "$REF" -- "${paths[@]}"; then
  echo "check-upstream-sync: C core matches $REF ✓"
else
  echo "check-upstream-sync: DRIFT from $REF in the C core (it must stay upstream):"
  git diff --stat "$REF" -- "${paths[@]}"
  echo "If intentional, move the change into a fork layer (fablize/ crew/ imba/ mindforge-ui/)."
  exit 1
fi
