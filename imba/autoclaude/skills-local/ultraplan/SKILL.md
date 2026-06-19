---
name: ultraplan
description: Produce a high-confidence implementation plan by fanning out several Plan subagents in parallel at high effort and synthesizing their results into one consolidated plan. Use when the user asks for a thorough/deep plan, an "ultraplan", or when a task is complex enough that a single planning pass is risky.
---

# ultraplan

Deep, multi-agent planning for complex tasks. Spends parallel subagent context
(isolated from the main thread) to get a more robust plan than a single pass.

## When to use
- The task is `complex` (multi-file, architectural, ambiguous, high-risk).
- The user explicitly invokes `/ultraplan` or asks for a deep/thorough plan.
- Do NOT use for simple/medium tasks — a single Plan pass (or inline planning) is
  cheaper and sufficient.

## Steps

1. Restate the goal as a precise spec: goal, constraints, success criteria. If a
   key requirement is genuinely unknown, ask ONE batched round of questions first.
2. Fan out **2–3 `Plan` subagents in parallel** (single message, multiple Agent
   calls), each with a distinct angle, e.g.:
   - Agent A: primary implementation path + critical files to change.
   - Agent B: alternative approach + trade-offs / risks the primary path misses.
   - Agent C (optional): test/verification strategy and edge cases.
   Give each agent the full spec and any file paths / code traces already known.
3. Read the critical files the agents flag, to ground the synthesis yourself.
4. Synthesize ONE consolidated plan: recommended approach only (not every
   alternative), named files to change, reused functions/utilities, and an
   end-to-end verification section.
5. Present the plan for approval before implementing.

Keep the main thread lean — let the bulk reading/analysis live in the subagents.
