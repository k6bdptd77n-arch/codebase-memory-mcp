# Verify recipes

Sane per-stack defaults for a story's **verify gate** — the command a closed loop holds each
story to. A gate is only as strong as its `--check`, and these keep plan authoring from being
expert-only. `recipes.json` maps a stack to its `test` / `build` command and the `allow`
entries a worktree agent needs (added to a project's `crew.json → hand.allow`).

Used by:
- the GUI plan wizard (the verify field offers these as suggestions),
- `loop.py` / `orchestrate.py` when you pick a gate by hand,
- as a contribution surface — add a stack by appending one row (plain JSON, trivially PR-able).

Example:

```bash
python3 fablize/scripts/loop.py run --name feature \
  --check "$(python3 -c "import json;print(json.load(open('fablize/packs/recipes/recipes.json'))['recipes']['python']['test'])")" \
  --agent "claude -p"
```
