# Future iterations

This backlog preserves ideas intentionally excluded from the decision-review MVP. Every item is pending until it is deliberately selected, scoped, implemented, and validated. The ordering is directional rather than a commitment.

## Deferred quality gates

The repository is in **prototype mode** (section 0 of
`docs/methodology/CONSTITUTION.md`). Gates costing minutes are suspended so the
app can be made usable first. This section is the record of what that trades
away, so re-enabling is a checklist rather than an archaeology project.

Work through these **before anyone other than the author uses this**, then
delete section 0 of the constitution.

- [ ] Re-enable adversarial `review` on every change. It is on demand while prototyping. It has found twelve real defects across two rounds — six in the desktop build, six in the TypeScript migration — so the backlog of unreviewed diffs is the main thing this trades away. Run it once over the accumulated diff before turning it back on per-change.
- [ ] Re-enable `npm run package && npm run smoke` as a per-change gate for packaging, preload, and provider-runtime edits. It is the only check that catches a build green everywhere else and broken once installed.
- [ ] Restore loop steps 3–4 (signal, then BEFORE evidence) for all changes, not just bug fixes.
- [ ] Reconcile `docs/methodology/coverage-gaps.md` with reality. Row-by-row upkeep is relaxed while prototyping, so its counts will drift.
- [ ] Backfill tests for UI and wiring changes shipped under the relaxed `[HC-TEST-WITH-BEHAVIOR]`, and replace any stubs left under the relaxed `[SC-NO-PLACEHOLDERS]`.
- [ ] Audit for drive-by changes that slipped in under the relaxed `[HC-NARROW-DIFF]`.

Not suspended, and not to be suspended: `[HC-NO-PLAINTEXT-HISTORY]`,
`[HC-NO-PRIVATE-DATA-COMMITS]`, `[HC-SECRETS-ENV-ONLY]`, `[HC-NO-EXFILTRATION]`,
and `./scripts/verify.sh`. The first four are constraints rather than gates, so
they cost nothing, and each protects something that cannot be undone once it has
happened. The chain takes 2.7 seconds.

## Current desktop roadmap

The TypeScript migration is complete: the mentorship engine now runs in the
Electron main process and the Python package and sidecar have been deleted.
In-app editing has since landed on top of it — the app is now configurable
without a text editor, which was the last thing standing between it and being
usable by someone who is not its author.

What remains open here is integrations and the Copilot provider's packaged
coverage.

- [x] Migrate the mentorship engine from Python to type-safe TypeScript modules that run directly in Electron while preserving provider contracts, grounding validation, and existing behavior.
- [x] Store provider credentials in the app using Electron `safeStorage` and an in-app settings screen. Shipped as `desktop/src/main/secrets.ts` plus the Settings view. Required amending `[HC-SECRETS-ENV-ONLY]`, which the repository owner approved: an in-app key is permitted only when encrypted at rest, refused rather than downgraded when encryption is unavailable, and write-only across IPC.
- [x] Add in-app mentor management for one or more editable personalities, principles, communication preferences, and source-linked grounding resources. Shipped as the Mentors view: list, duplicate, delete, switch active, and edit all three files per mentor. Duplication rewrites `mentor_id` on every record, because copying it verbatim produces a profile that cites another mentor's sources.
- [x] Add a validated goals editor in the app with stable goal identifiers and safe local persistence. Shipped as the Profile view over all five user files, with a structured form and a raw YAML tab. Writes are atomic and guarded by a serialize-reparse-revalidate round trip.
- [ ] Add permission-scoped Notion, calendar, screen-time, and related task integrations so Trajectory can understand current commitments and activity without silently expanding its privacy boundary.
- [x] Add a packaged smoke test that launches the built app and asserts the preload bridge is present. Closes the highest-risk row in `docs/methodology/coverage-gaps.md`. Shipped as `desktop/scripts/smoke-packaged.mjs` (`npm run smoke`); it also covers renderer privilege, first-launch seeding, encrypted history, and that the bundled OpenAI SDK actually runs.
- [ ] Offer an interactive GitHub sign-in instead of asking for a pasted token. The SDK exposes `getAuthStatus` but no login flow, so today the app can only accept a token or use a login the Copilot CLI already stored.
- [ ] Preserve YAML comments when saving from the structured form. The raw YAML tab writes the user's text verbatim, so comments survive there; the form serializes from the model and drops them. Round-tripping needs the `yaml` package's Document AST rather than `parse`/`stringify`. Recorded as a stated trade-off rather than an oversight.
- [ ] Cover the Copilot provider in the packaged smoke test. It needs a signed-in GitHub account, so it is the one provider the automated smoke run skips — and it is the provider whose runtime resolution broke three separate ways in the packaged app.

## Product validation gates

- [ ] Evaluate whether users respect and act on decision-review recommendations before adding more context sources.
- [ ] Define qualitative recommendation-quality criteria beyond schema validity.
- [ ] Build a reviewed evaluation set covering alignment, opportunity cost, uncertainty, recovery, avoidance, and perfectionism.
- [ ] Compare recommendations across deterministic and real providers without treating eloquence as quality.
- [ ] Test whether citations and concise rationales increase trust without creating false authority.
- [ ] Establish explicit criteria for when the product should expand beyond a CLI.

## User constitution and goal model

- [ ] Add a dedicated desired-identity document.
- [ ] Support long-term identity goals.
- [ ] Support one-to-three-year outcomes.
- [ ] Support quarterly goals.
- [ ] Support active projects and current experiments.
- [ ] Support maintenance responsibilities.
- [ ] Support paused and explicitly rejected goals.
- [ ] Add target dates, leading indicators, lagging indicators, next review dates, and richer status transitions.
- [ ] Model acceptable and unacceptable tradeoffs per goal.
- [ ] Expand values configuration for relationships, health, career, learning, financial security, contribution, adventure, and recreation.
- [ ] Expand current state for training load, health load, recurring obstacles, and unresolved decisions.
- [ ] Expand constraints for work hours, commute, family commitments, recovery needs, financial limits, access permissions, notification windows, and protected time.
- [ ] Add configuration migration and compatibility rules as schemas evolve.
- [ ] Let users tune directness, warmth, challenge, verbosity, use of questions and evidence, and prohibited communication patterns.

## Mentor council and source grounding

- [ ] Replace the fictional demo profile with reviewed, source-grounded public profiles where legally and ethically appropriate.
- [ ] Research an Alex Ostberg profile from approved public sources without inventing his philosophy.
- [ ] Research a Dominic Schlueter profile from The Running Effect and his own approved public work.
- [ ] Research an Alex Hormozi profile primarily from first-party books, official sites, long-form interviews, podcasts, and official channels.
- [ ] Document limitations of aggressive business-optimization frameworks, including possible underweighting of recovery, relationships, leisure, intrinsic enjoyment, and non-commercial success.
- [ ] Require citations, interpretation labels, confidence, domains, heuristics, blind spots, and review status for every real mentor principle.
- [ ] Define source-quality hierarchy and approved source types.
- [ ] Create a repository-wide mentor and evidence source registry.
- [ ] Add stale-source and conflicting-source handling.
- [ ] Add quotation metadata and legally appropriate excerpt limits.
- [ ] Warn on missing URLs where the source type requires one.
- [ ] Warn when a source has not been approved.
- [ ] Warn when an interpretation lacks confidence.
- [ ] Reject unsourced attribution to a person.
- [ ] Reject quotations without source metadata.
- [ ] Add a reviewed source-extraction workflow that distinguishes explicit support, strong inference, weak inference, and user-defined principles.
- [ ] Prevent weak inference from being silently promoted to established fact.
- [ ] Add contribution guidance for new mentor profiles.
- [ ] Add review ownership and approval workflow for public mentor resources.
- [ ] Represent disagreements and tensions between mentor frameworks.
- [ ] Select relevant council perspectives per decision rather than averaging them into generic advice.
- [ ] Explain why one principle is more relevant than another when perspectives conflict.
- [ ] Ensure user values and goals always outrank every mentor worldview.

## Evidence system

- [ ] Define separate records for mentor principles and empirical evidence.
- [ ] Add evidence categories for behavioral science, occupational psychology, sleep and recovery, exercise science, user history, calendar/task context, self-report, and model inference.
- [ ] Add an evidence registry with source quality, applicability, confidence, limitations, and review metadata.
- [ ] Require every empirical claim to resolve to an evidence record or be labeled as unverified model inference.
- [ ] Add retrieval of evidence relevant to the current question.
- [ ] Add conflict handling for mentor principles versus empirical evidence.
- [ ] Add evidence freshness and re-review policies.
- [ ] Add adversarial checks for plausible but unsupported scientific claims.

## Structured memory and continuity

- [ ] Add local persistence after the non-persistent MVP proves useful.
- [ ] Evaluate SQLite with SQLAlchemy or SQLModel.
- [ ] Add Alembic migrations.
- [ ] Model stable facts.
- [ ] Persist goals and identity commitments.
- [ ] Model observations inferred from repeated behavior.
- [ ] Model important decisions and their reasoning.
- [ ] Model explicit commitments.
- [ ] Model outcomes linked to decisions and commitments.
- [ ] Model communication and workflow preferences.
- [ ] Model tentative hypotheses separately from facts.
- [ ] Model behavioral events with source provenance and explicit user authorization.
- [ ] Store timestamps, supporting event IDs, confidence, status, last validation date, alternative explanations, and user confirmation for observations and hypotheses.
- [ ] Prevent hypotheses from being rendered as facts.
- [ ] Add user confirmation, correction, and rejection of inferred memories.
- [ ] Add memory retention settings.
- [ ] Add commands to inspect and selectively delete memory.
- [ ] Add a command to delete all local history.
- [ ] Avoid treating a complete chat transcript as memory.
- [ ] Evaluate whether embeddings or a vector database are justified only after simpler retrieval is insufficient.

## Additional mentorship workflows

- [ ] Add a morning briefing.
- [ ] Select one most important daily outcome.
- [ ] Select up to three supporting priorities.
- [ ] Identify one likely distraction or failure mode.
- [ ] Protect one recovery or relationship commitment.
- [ ] Add a minimal midday check-in for intended work, actual progress, current energy, and current obstacle.
- [ ] Let midday guidance choose continue, redirect, reduce scope, take a break, or deliberately abandon.
- [ ] Add an evening reflection.
- [ ] Capture meaningful progress, avoided work, unexpected demands, energy patterns, priority alignment, one lesson, and tomorrow's unresolved priority.
- [ ] Ensure evening reflection never reduces a day to a productivity score.
- [ ] Add a weekly trajectory review.
- [ ] Report each life domain as improving, stable, declining, or uncertain.
- [ ] Explain evidence, goal progress, recurring drift, commitments kept and missed, overload, and high-leverage work.
- [ ] Recommend only one or two meaningful weekly adjustments.
- [ ] Avoid fake precision and numeric life scores.
- [ ] Track commitments, decisions, and outcomes across workflows.
- [ ] Add question-driven follow-up only when missing information could materially change the recommendation.

## Data ingestion and adapters

- [ ] Define a stable task-provider interface.
- [ ] Define a stable calendar-provider interface.
- [ ] Define a code-hosting activity interface.
- [ ] Define a screen-time analytics interface.
- [ ] Define a journal-entry interface.
- [ ] Define a fitness and recovery interface.
- [ ] Define a message-delivery interface.
- [ ] Add a generic CSV task importer.
- [ ] Add a generic CSV screen-time importer with date, application, category, duration, pickups, and source device.
- [ ] Add local JSON or Markdown daily check-in import.
- [ ] Add GitHub activity ingestion using explicit token authorization.
- [ ] Add a Notion adapter interface and later a minimal implementation.
- [ ] Add exported or manually created screen-time data before attempting platform collectors.
- [ ] Document future platform-specific collectors.
- [ ] Add calendar ingestion with explicit scope selection.
- [ ] Add synthetic fixtures for every importer.
- [ ] Add import validation, duplicate handling, provenance, and deletion.
- [ ] Never assume access to proprietary phone analytics APIs.
- [ ] Never ingest employer-confidential data by default.

## Intervention policy and notifications

- [ ] Add intervention evaluation only after reflection workflows establish useful context.
- [ ] Support `no_intervention`, `soft_checkin`, `direct_redirect`, `recovery_prompt`, and `urgent_user_defined_alert`.
- [ ] Include reason, confidence, cooldown status, context sufficiency, and optional notification text in intervention results.
- [ ] Configure allowed hours and do-not-disturb periods.
- [ ] Configure protected focus periods.
- [ ] Configure cooldown duration.
- [ ] Configure maximum daily interventions.
- [ ] Configure applications or categories eligible for evaluation.
- [ ] Configure minimum duration and repeated-pattern thresholds.
- [ ] Add calendar-aware exceptions.
- [ ] Add vacation, sick, and high-workload modes.
- [ ] Evaluate intent conflict, likely recovery, repetition, interruption value, missing context, and false-positive cost.
- [ ] Default to silence when confidence is low.
- [ ] Ensure a single period of leisure is not treated as failure.
- [ ] Add user-configured notification windows.
- [ ] Add pause and resume controls.
- [ ] Prohibit continual notifications and covert monitoring.

## Integrations and user experiences

- [ ] Add an optional Telegram adapter after the CLI workflows stabilize.
- [ ] Support Telegram commands for morning, check-in, decide, evening, week, goals, status, pause, and privacy.
- [ ] Support concise free-text Telegram decision messages.
- [ ] Keep Telegram optional and never commit bot tokens.
- [ ] Add a FastAPI service only when another client requires a stable API.
- [ ] Design a web interface only after validating the core workflow.
- [ ] Evaluate native mobile applications.
- [ ] Evaluate browser extensions.
- [ ] Evaluate voice interaction.
- [ ] Evaluate wearable integrations.
- [ ] Evaluate direct iOS Screen Time integration only if a supported, consent-based API exists.
- [ ] Evaluate additional code-hosting and task-management integrations.
- [ ] Do not add automatic employer-system ingestion.

## Reporting and trajectory analysis

- [ ] Aggregate patterns over weeks rather than judging isolated events.
- [ ] Compare planned priorities with meaningful outcomes.
- [ ] Detect repeated avoidance while preserving alternative explanations.
- [ ] Detect possible overload without diagnosing medical or mental-health conditions.
- [ ] Surface improving, stable, declining, and uncertain trajectories by user-defined life domain.
- [ ] Explain the evidence behind every trajectory assessment.
- [ ] Provide exportable reports that remain understandable without the application.
- [ ] Avoid a universal productivity or life score.

## Privacy, security, and user control

- [ ] Write a formal privacy model.
- [ ] Write a threat model.
- [ ] Separate public mentor resources from private user data at the filesystem and packaging levels.
- [ ] Add configurable context allowlists per provider and workflow.
- [ ] Add user-reviewed redaction before sending context to external models.
- [ ] Add data-retention configuration.
- [ ] Add per-source authorization records.
- [ ] Require explicit authorization for every data source.
- [ ] Ensure telemetry remains opt-in and disabled by default if it is ever added.
- [ ] Add secret-scanning and ignored-path tests.
- [ ] Ensure logs never include full private journals, prompts, or credentials.
- [ ] Add secure deletion semantics appropriate to local storage limitations.
- [ ] Add export, correction, and deletion workflows for user data.
- [ ] Document environment-variable handling.
- [ ] Document external-provider data exposure and enterprise-policy considerations.
- [ ] Prohibit capturing keystrokes, private conversations, other people's data, or covert activity.
- [ ] Treat screen-time data as user-controlled reflection rather than surveillance.
- [ ] Add security review before passive or background capabilities.

## LLM and prompt architecture

- [ ] Add additional provider adapters only when they preserve the same domain contract.
- [ ] Add model capability detection for structured outputs and context limits.
- [ ] Add configurable token and context-size budgets.
- [ ] Add robust bounded retry behavior for invalid output.
- [ ] Add provider-independent prompt versioning and migration.
- [ ] Add trace metadata without retaining private prompt content by default.
- [ ] Add separate prompts for morning, midday, evening, weekly, intervention, and source extraction.
- [ ] Keep context assembly, principle selection, evidence selection, generation, validation, and rendering as separate stages.
- [ ] Add attribution and safety validators to every workflow.
- [ ] Add model-quality evaluations across providers and model upgrades.
- [ ] Avoid exposing private chain of thought; retain concise rationales and references only.
- [ ] Evaluate bring-your-own-key support for additional providers.

## Expanded CLI

- [ ] Add `trajectory init`.
- [ ] Add `trajectory validate-config`.
- [ ] Add `trajectory import tasks`.
- [ ] Add `trajectory import screentime`.
- [ ] Add `trajectory checkin`.
- [ ] Add `trajectory morning`.
- [ ] Add `trajectory evening`.
- [ ] Add `trajectory weekly-review`.
- [ ] Add `trajectory sources validate`.
- [ ] Add `trajectory memory list`.
- [ ] Add selective memory deletion.
- [ ] Add `trajectory memory delete --all`.
- [ ] Add `trajectory goals`.
- [ ] Add `trajectory status`.
- [ ] Add `trajectory pause`.
- [ ] Add `trajectory privacy`.
- [ ] Keep all core workflows available locally without Telegram or paid cloud infrastructure.

## Testing and quality

- [ ] Add tests for task CSV ingestion.
- [ ] Add tests for screen-time CSV ingestion.
- [ ] Add tests for memory confidence and hypothesis handling.
- [ ] Add tests for intervention cooldowns.
- [ ] Add tests for low-confidence no-intervention behavior.
- [ ] Add tests for local-history deletion.
- [ ] Add adversarial tests for fabricated quotations.
- [ ] Add adversarial tests for certainty about a living person's opinion.
- [ ] Add adversarial tests for unsupported empirical claims.
- [ ] Add adversarial tests for shaming or demeaning language.
- [ ] Add adversarial tests for recommending continual work despite explicit exhaustion.
- [ ] Add adversarial tests for leaking secrets or ignored private files.
- [ ] Add recommendation-quality regression fixtures.
- [ ] Add end-to-end tests for every new workflow before exposing it.
- [ ] Add CI for the desktop typecheck, tests, and build.
- [ ] Add setup verification on supported Node.js versions and operating systems.

## Architecture and operations

- [ ] Add architecture documentation after the MVP reveals stable boundaries.
- [ ] Add architecture decision records for consequential choices.
- [ ] Reassess whether the repository should keep the `trajectory` name before wider release.
- [ ] Add Docker support only when it solves a demonstrated setup or deployment need.
- [ ] Add `docker-compose.yml` only when multiple local services exist.
- [ ] Add a Makefile or task runner only when documented commands become unwieldy.
- [ ] Evaluate a scheduler for recurring workflows.
- [ ] Evaluate complex multi-agent orchestration only if a single pipeline proves inadequate.
- [ ] Do not add autonomous task execution without an explicit safety and permission model.
- [ ] Do not require paid cloud infrastructure for local use.

## Open-source project foundations

- [ ] Add `CONTRIBUTING.md`.
- [ ] Add `SECURITY.md`.
- [ ] Add `CODE_OF_CONDUCT.md`.
- [ ] Add issue templates.
- [ ] Add a pull request template.
- [ ] Add contributor documentation for mentor-source research.
- [ ] Add product-principles documentation.
- [ ] Add source-grounding documentation.
- [ ] Add a public roadmap derived from validated product learning.
- [ ] Add accessibility guidance before introducing graphical interfaces.
- [ ] Clarify copyright rules for metadata, brief excerpts, user notes, and derived principles.
- [ ] Prohibit bulk inclusion of copyrighted books, transcripts, newsletters, and paid material.
- [ ] Require contributor profiles to avoid misleading impersonation and implied endorsement.

## Explicitly out of scope unless reconsidered

- [ ] Reconsider passive background monitoring only with compelling value, explicit consent, and strong safeguards.
- [ ] Reconsider continual notifications only if rare interventions prove beneficial.
- [ ] Reconsider autonomous task execution only with granular permissions and reversibility.
- [ ] Reconsider employer-system ingestion only if confidentiality and authorization can be guaranteed.
- [ ] Reconsider vector databases only when measured retrieval quality requires them.
- [ ] Reconsider complex multi-agent systems only when simpler orchestration demonstrably fails.
