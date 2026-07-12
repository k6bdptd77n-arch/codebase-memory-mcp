# MindForge / fablize-memory-mcp — полный review

**Дата:** 2026-07-11 · **ветка:** `fablize-integration` · **режим:** read-only review текущего дерева, включая незакоммиченный diff.

## Вердикт

Архитектура здравая: upstream C-ядро изолировано от собственных слоёв `fablize/`, `crew/`, `mindforge-ui/`; verify-gate и атомарное состояние хорошо покрыты тестами; Electron использует `contextIsolation`, sandbox, узкий preload API, валидацию идентификаторов/путей, native confirm и шифрование ключей. **P0 нет.** Проект пригоден для разработки и пилота, но ещё не готов к обещанию «установил и всё работает»: остаются P1 вокруг Electron e2e, watchdog и проверки релизного артефакта.

## Проверено

| Проверка | Результат |
|---|---|
| Граф архитектуры | 14 427 узлов / 50 659 рёбер; C-core и fork-слои разделены |
| `fablize` | **141/141** unittest |
| Graph UI | **3/3** RPC-теста; production build OK |
| Graph UI bundle | startup **257.9 KiB** / бюджет 350 KiB; lazy GraphTab 1.12 MiB (314 KiB gzip) |
| MindForge UI | **21/21** Node-тест; JS syntax check; Electron screenshots 1560×940 и 900×650 |
| npm | offline audit: 0 известных уязвимостей |
| Git | 28 tracked-файлов + новые test/core-модули; изменения не закоммичены |
| Локальный runtime | `build/c/codebase-memory-mcp` отсутствует — Memory offline до сборки |
| C full suite | в предыдущем ASan/UBSan-прогоне всё прошло, кроме `test_parent_watchdog.sh` на macOS: ребёнок переживает смерть родителя |

## Что уже улучшено в текущем diff

- MindForge: command palette, shortcuts, focus/ARIA, responsive layout, понятные loading/error states, onboarding сборки, визуальные regression-снимки.
- MindForge core: 21 тест на project creation/boundaries, provider HTTP, atomic files и graph lifecycle; закрыт обход `../…`/Windows path.
- Provider HTTP: 30-секундный timeout, http/https validation, JSON/response-size limits.
- 3D-граф: start/probe/reuse/stop supervisor; installer и release собирают `--with-ui` engine.
- Настройки, preferences и merge receipts пишутся атомарно через fsync + rename.
- Graph UI: lazy-load тяжёлого графа, стартовый bundle-budget, RPC-тесты, удаление дублей.
- CI: UI build/check добавлены в PR gate; `clean.sh` больше не удаляет tracked/generated source и зависимости.

## Findings

| Приоритет | Проблема / доказательство | Рекомендация |
|---|---|---|
| **P1** | Pure/main helpers теперь покрыты 21 тестом, но критические renderer/IPC approve→verify→merge, plan и settings потоки всё ещё не проходят реальный Electron e2e. | 1 Electron e2e-smoke под `xvfb`: create project → plan → reject/approve; отдельно IPC contract tests с mock main/preload. |
| **P1** | macOS parent-watchdog красный: возможен orphan MCP-процесс. C-core должен оставаться byte-identical upstream. | Исправить через upstream PR; до принятия — явно документировать риск/cleanup. Fork-патч в core делать только после отдельного решения отказаться от invariant. |
| **P1** | Release не доказывает устанавливаемость: нет запуска собранного `.app`/AppImage, подпись опциональна, mac matrix фактически arm64; текущий `.app` 498 MiB, из них binary 258 MiB (DMG 132 MiB). | Artifact smoke-test, x64/arm64 matrix, обязательная signing/notarization политика для stable, strip/symbol split и size-budget. |
| **P2** | EN заявлен default, но в runtime JS остаётся ~234 строк с русским текстом: новая EN-сессия смешивает языки. | Все user-facing строки и titles перенести в `i18n.js`; добавить тест полноты ключей RU/EN. |
| **P2** | GraphTab всё ещё 1.12 MiB и покрыт только RPC-тестами. | Разделить Three.js/vendor и panels; тесты фильтров, selection и empty/error states; lazy chunk-budget отдельно от startup. |
| **P2** | PR UI-job использует `npm ci --ignore-scripts`, поэтому `node-pty` и реальный Electron startup не проверяются; release теперь гоняет test/check, но не запускает artifact. | Отдельный Linux Electron smoke с rebuild+xvfb; проверять packaged preload/native module ABI. |
| **P2** | MindForge README синхронизирован, но корневой roadmap/релизная история не заменяют пользовательский changelog. | Добавить `CHANGELOG.md`; генерировать screenshots из `npm run shot` для релиза. |
| **P2** | Нет Dependabot/Renovate и npm audit gate; security workflow pin-ит actions по SHA, новый UI-job — только по тегам. | Dependabot для двух lockfile; online `npm audit`/dependency-review; единая SHA-pin политика actions. |
| **P2** | Постоянный polling каждые 4 с обновляет активный view и board даже при скрытом окне; metrics может регулярно запускать Python. | Пауза при hidden/minimized, adaptive backoff 4→30 с, event-first refresh и дедупликация subprocess. |
| **P3** | `main.js` 844 строк, `renderer.js` 471, `board.js` 540; глобальные IIFE усложняют тестирование. | После тестов разделить на IPC services, process supervisor, project service и view controllers; не делать big-bang rewrite. |
| **P3** | Архитектурный hotspot `cbm_extract_imports`: cyclomatic 83 / cognitive 164; это upstream core. | Не рефакторить в fork. Вынести предложение и benchmarks upstream; локально только отслеживать regressions. |

## Рекомендуемый порядок

1. Зафиксировать текущий UX/reliability diff отдельным PR и прогнать реальный CI.
2. Добавить Electron IPC + один packaged/e2e smoke.
3. Закрыть watchdog upstream.
4. Release matrix, signing, strip/size budget и artifact smoke.
5. Завершить RU/EN, добавить CHANGELOG и dependency automation; затем оптимизировать polling/lazy chunk.

**Критерий готовности v0.1:** чистая машина → подписанный artifact → первый проект/демо → Memory online → plan → агент → verify gate → approve/reject; всё повторяется в CI без ручного терминала.
