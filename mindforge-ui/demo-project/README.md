# MindForge demo project

A tiny, real Python project — created so you can watch the whole loop run for real, on your
own machine and your own coding-agent subscription: plan → two agents in parallel git
worktrees → each story's verify gate → review the diff → merge.

This isn't staged. The plan MindForge creates for you asks for two genuinely independent
features (each in its own new file, so the two worktree agents never touch the same file and
always merge cleanly) — whatever actually happens when you run them is the real mechanism,
not a canned result.

Try it: open the **Доска** (Board) tab and click **Запустить агента** on each story, then
**Проверить** to review the diff before merging.
