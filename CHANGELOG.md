# Changelog

All notable changes to the MindForge distribution are documented here.

## Unreleased

### Added

- Persistent Codex bootstrap: automatic MCP registration, repository auto-indexing, global and project-local workflow skills, Brain lifecycle hooks, and `mindforge-doctor.sh` health checks.
- Bounded skill-evolution proposals backed by repeated failure evidence and candidate evaluation.
- MindForge Control localization contract with matching English/Russian dictionaries and runtime interpolation tests.

### Changed

- MindForge Control main-process messages now follow the selected UI locale instead of remaining hard-coded in Russian.
- Combined installation is idempotent and preserves healthy graph databases on repeated runs.
