# Production Readiness Implementation Plan

Status: source implementation is complete for tasks 1–10. Compilation, runtime
packaging, automated execution and browser smoke verification are intentionally
deferred until the owner requests them.

- [x] 1. Introduce versioned database migrations
  - Preserve the current database and migrate existing installs in place.
  - Add job, lock, usage, backup and evidence-deduplication storage.
  - Configure WAL, foreign keys and busy timeout.
  - _Requirements: R5, R6, R7_

- [x] 2. Add strict production configuration
  - Validate authentication, real-provider, market and runtime settings.
  - Stop silent Demo fallback in production.
  - Separate explicit Demo seeding from database creation.
  - _Requirements: R7, R8_

- [x] 3. Implement single-user authentication and request protection
  - Add password hash CLI, signed sessions, login/logout/session APIs.
  - Add CSRF/origin checks, security headers, request IDs and bounded limiters.
  - Sanitize errors and remove filesystem details from public settings.
  - _Requirements: R1, R6, R9_

- [x] 4. Connect raw signals to the evidence chain
  - Persist source-linked complaint evidence when processing a signal.
  - Add idempotent linking to an existing opportunity and mark it due.
  - Add opportunity options API and Signal Inbox linking interaction.
  - _Requirements: R2_

- [x] 5. Expand DataForSEO market collection
  - Make market location/language configurable.
  - Add Google organic competitor evidence.
  - Add Apple App Search competition, rating and review-volume evidence.
  - Preserve gaps and provenance; add mocked provider contract tests.
  - _Requirements: R3_

- [x] 6. Harden AI judgment and report traceability
  - Treat all evidence as untrusted data in prompts.
  - Enforce unique canonical dimensions and compute the weighted score.
  - Add evidence sufficiency guard and claim-level citations.
  - Persist model/prompt/evidence snapshots and usage metadata.
  - _Requirements: R4_

- [x] 7. Add durable usage budgets and resilient provider calls
  - Track AI/DataForSEO usage in SQLite.
  - Enforce daily call budgets before requests.
  - Add timeouts, bounded retries and exponential backoff.
  - _Requirements: R5, R6_

- [x] 8. Add durable background jobs and automatic refresh
  - Implement global job locks, stale recovery and persistent job history.
  - Run due research from the scheduler and CLI through one coordinator.
  - Add optional sanitized alert webhook.
  - _Requirements: R5, R9_

- [x] 9. Add verified backups and restoration path
  - Implement consistent backup, integrity verification and retention.
  - Schedule backup and expose its latest result.
  - Add restore instructions and an integration test.
  - _Requirements: R7, R9, R10_

- [x] 10. Add production operations UI
  - Add asymmetric login surface using the current visual system.
  - Add system status route with source, freshness, budget, job and backup state.
  - Preserve the result-first dashboard as the post-login default.
  - _Requirements: R1, R9_

- [ ] 11. Produce a compiled production runtime
  - Deferred by the owner; do not compile or add Docker until explicitly requested.
  - Compile server/shared TypeScript and remove runtime dependence on `tsx`.
  - Add Dockerfile, Compose example, health check and persistent volume.
  - Verify graceful scheduler/database shutdown.
  - _Requirements: R8_

- [ ] 12. Complete release verification and documentation
  - [ ] Run unit/API/provider/backup tests, typecheck, build and dependency audit.
  - [ ] Smoke-test login, routing, signal linking and operations in the browser.
  - [x] Expand README with configuration, deployment, budget, backup and restore.
  - _Requirements: R10_
