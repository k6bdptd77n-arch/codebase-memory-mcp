---
name: ultrathink
description: Explicitly raise reasoning effort to the maximum for the current task and reason as thoroughly as the problem warrants before answering. Use when the user invokes /ultrathink or asks you to think deeply/hard about a hard or subtle problem.
---

# ultrathink

Maximum-effort reasoning for a single hard task.

Note: the bare keyword `ultrathink` in a user message already triggers a native
effort bump in Claude Code. This skill exists for explicit `/ultrathink`
invocation and discoverability — the behavior is the same.

## Steps

1. Treat the current task at the **highest reasoning effort**: enumerate the real
   constraints, consider multiple competing approaches, and stress-test the chosen
   one against edge cases before committing.
2. For debugging / unknown-cause work, form 3+ competing hypotheses and gather
   evidence per hypothesis rather than guessing.
3. Do the thinking internally; give the user the conclusion and the key reasoning,
   not a stream of consciousness.
4. If the task is genuinely simple, say so and answer directly — don't manufacture
   depth where none is needed.

For deep *planning* specifically (multi-agent fan-out), use `/ultraplan` instead.
