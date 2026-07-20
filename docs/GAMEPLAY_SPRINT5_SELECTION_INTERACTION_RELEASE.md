# Gameplay 1.0 — Sprint 5 Selection & Interaction Release

## Release status

Sprint 5 release certification is complete. The automated release gate is green and the headed native-browser-zoom matrix was executed manually in Chrome 150 on Windows 11 for browser zoom 80/100/125/150 percent combined with battlefield zoom 70/100/140 percent.

## Selection contract

- Selection is viewer-local, transient, instance-based, ordered, and never persisted in bootstrap, snapshots, events, Patch.v2, or GameLog.
- Click, Ctrl/Cmd toggle, battlefield Shift toggle, hand Shift range, scoped Select All, Clear Selection, and priority-ordered Escape share the Sprint 5 selection service contract.
- A mutable selection cannot cross player, region, or zone boundaries. Opponent battlefields remain focus/preview-only.
- Refresh, reconnect hydration, runtime restart hydration, game close, defeat, concession, zone movement, controller loss, and relation changes prune or clear selection deterministically.

## Marquee and input

- Mouse and pen can start a rectangular marquee from empty space on the actor's battlefield. Touch requires the explicit one-shot Select Area mode.
- Hit testing uses visual centers in the same client-coordinate space. Bounds are captured once per interaction and preview updates are limited to animation frames.
- No modifier replaces selection, Shift adds candidates, and Ctrl/Cmd toggles candidates against the base selection.
- Cancel paths preserve the base selection, clear interaction caches, and emit no gameplay commands.
- Keyboard behavior includes Space toggle, scoped Ctrl/Cmd+A, hand Shift range, deterministic spatial arrows, Home/End, focus rings, and safe shortcut suppression in editable or modal contexts.

## Complex geometry and relations

- Independent overlaps remain independently selectable by marquee; pointer click selects the topmost target and keyboard tie-breaking is deterministic.
- Attachments are selected independently from their target. Relation-aware movement avoids duplicate target/source movement.
- A collapsed battlefield stack contributes its visible root plus a viewer-local group reference. Hidden members are not silently inserted into `selectedIds`.
- Stack members are resolved from current authoritative relations at command time. Root promotion, detach, dissolve, controller change, and zone exit prune stale group references.

## Batch interaction

- The contextual toolbar derives visibility, enabled state, disabled reason, confirmation, command type, affected count, and group count from the current authoritative projection.
- Supported actions are move selected, tap, untap, face down, face up, create stack, dissolve stack, detach one attachment, and relation-aware position drag.
- Tap/untap and position preserve valid selection. Zone moves consume moved entries. Stack creation replaces member selection with the root/group reference. Errors preserve valid entries and prune only stale ones.
- Confirmation is focus-trapped and restores focus. Escape closes the confirmation before it can clear selection. Duplicate submission is disabled while pending.

## Authority, privacy, atomicity, and replay

- Runtime authority is mandatory for every expanded instance: current controller, active actor, open game, compatible zone, no duplicates, and valid relation membership.
- Batch commands are one command, one event, and one version. Rejections preserve version, state, relation graph, patches, and GameLog. Duplicate `clientActionId` retries do not duplicate events or logs.
- Face-down projection remains viewer-specific. Authorized viewers retain canonical references; unauthorized viewers receive opaque placeholders without identity/static fields.
- Public logs are aggregate and identity-safe. Replay, compact bootstrap, reconnect, and actor restart reconstruct authoritative card and relation state without reconstructing local selection.

## Responsive and performance contract

- The only responsive states remain normal, compact, aggressive, and minimal. The selection toolbar uses a visible overflow layer in aggressive/minimal layouts and stays within the viewport.
- Automated coverage validates battlefield zoom 70/100/140 and layout cancellation rules. Native browser zoom was additionally validated in headed Chrome without CSS transforms, viewport substitution, or `deviceScaleFactor` simulation.
- The dense fixture renders 100 independent cards plus overlaps, five attachments, a stack of eight, face-down cards, and controller transfers.
- The endurance gate performs 50 marquees, 50 keyboard moves, 20 Select All/Clear cycles, 21 toolbar action/rejection checks, five create/dissolve cycles, and 20 confirmation cycles. It asserts bounded layout reads, one bounds capture per gesture, rAF throttling, cleared caches, no command during preview, and a valid final action.

## Integrated release gate

`frontend/e2e/game-product-sprint5-selection-interaction-gate.spec.ts` runs serially with zero retries and isolated browser contexts. It contains:

- isolated 2P, 3P, 4P, 5P, and 6P selection/action matrices;
- a composed 3P selection, input, relation, batch, privacy, failure, and continuity scenario;
- the dense-board/endurance scenario;
- an opt-in headed native Chrome zoom certification scenario.

The automated run completed with seven passing scenarios; its opt-in native-zoom scenario remained skipped during unattended execution. The equivalent headed Chrome matrix was subsequently executed manually and all 12 browser/BF zoom combinations passed. Existing Sprint 5B–5D and transversal release gates also remained green.

## Headed native Chrome certification

Environment: Chrome `150.0.7871.124`, Microsoft Windows 11 Pro `10.0.26200` build `26200`.

| Browser zoom | DPR | Viewport CSS | Responsive state | BF zoom | Result |
|---:|---:|---:|---|---:|---|
| 80% | 0.8 | 2400 x 1068 | normal | 70% | PASS |
| 80% | 0.8 | 2400 x 1068 | normal | 100% | PASS |
| 80% | 0.8 | 2400 x 1068 | normal | 140% | PASS |
| 100% | 1 | 1920 x 855 | normal | 70% | PASS |
| 100% | 1 | 1920 x 855 | normal | 100% | PASS |
| 100% | 1 | 1920 x 855 | normal | 140% | PASS |
| 125% | 1.25 | 1536 x 684 | compact | 70% | PASS |
| 125% | 1.25 | 1536 x 684 | compact | 100% | PASS |
| 125% | 1.25 | 1536 x 684 | compact | 140% | PASS |
| 150% | 1.5 | 1280 x 570 | aggressive | 70% | PASS |
| 150% | 1.5 | 1280 x 570 | aggressive | 100% | PASS |
| 150% | 1.5 | 1280 x 570 | aggressive | 140% | PASS |

Each combination validated marquee commit, stack and attachment targeting, toolbar/Select Area visibility, confirmation viewport and focus containment, body overflow, and drag selection. BF140 also exercised spatial keyboard focus and touch-mode cancellation. At 150 percent the aggressive toolbar overflow exposed and executed the face-down action correctly.

Chrome was returned to 100 percent with BF zoom 100. The final viewport was 1920 x 911, responsive state `normal`, DPR 1, body overflow false, selection remained stable across BF100 -> BF140 -> BF100, and a valid Tap action was accepted while preserving selection.

Two apparent failures were closed as harness timing/targeting issues rather than product defects: the range slider advances in one-percent keyboard steps and therefore uses the contractual Reset control for BF100; an occluded card center correctly resolved to the topmost stack, while retrying on a visible independent-card center produced the expected drag.

## Integration defects closed

1. Aggressive/minimal toolbar overflow was clipped below battlefield hit targets. The overflow layer now escapes toolbar clipping and has an explicit interaction z-index.
2. Batch confirmation had no initial focus/trap/restore contract. `AppModal` now provides opt-in focus containment used by the selection confirmation.
3. One Escape press could close confirmation and clear selection. Modal Escape is now consumed before global selection cleanup.
4. The local runtime environment override omitted the two Sprint 5D batch command types. It was aligned for gate execution; the tracked Compose defaults and command catalogs already contained both commands.

## Evidence

- Integrated Sprint 5 automated gate: 7 passed, 1 headed opt-in skipped; the skipped native-zoom requirement was then completed manually with 12/12 combinations passing.
- Sprint 5B–5D focused Playwright gates: 4 passed, 1 headed opt-in skipped during unattended execution.
- Transversal Playwright gates: 30 passed, 5 headed opt-in scenarios skipped during unattended execution; their native-zoom coverage is represented by the completed matrix above.
- Frontend unit suite: 2,626 passed across 273 files.
- Frontend production build: passed; pre-existing style-budget warnings remain non-blocking.
- PHPUnit focal: 405 tests, 3,805 assertions, passed with existing notices/deprecations.
- PHPUnit complete: 1,334 tests, 14,024 assertions, passed with existing notices/deprecations.
- Go: `go test ./...`, `go test -race ./...`, and `go vet ./...` passed using the repository toolchain image.
- i18n: 11 locales and 1,880 base keys validated.
- OpenAPI parsed successfully; WebSocket contract coverage passed.
- API, WebSocket, and Runtime health/ready endpoints returned 200. Runtime metrics reported 100 percent command coverage, queue depth 0, unsupported 0, legacy fallback 0, and replay resync 0.

## Certification and out-of-scope debt

All Sprint 5 release-critical automated and headed-native-zoom gates are complete.

The following remain outside Sprint 5: grouped tokens, Oracle helpers, lasso, persistent selection, Patch.v2 selection state, batch controller/counter/stat editors, unsupported multi-detach, generalized visual polish, new responsive states, and browser zoom 200 percent.
