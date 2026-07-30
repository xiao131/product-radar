# Product Radar Production Readiness Requirements

## Problem

Product Radar can run as a demo, but a single operator cannot yet rely on it as a
secure, durable, continuously refreshed product-selection system. Production
readiness must protect private data and API spend while preserving the core
outcome: selecting products worth building from current, multi-source evidence.

## Scope

This specification covers a single-user production deployment:

- single-operator authentication and request protection;
- complaint/signal evidence entering the research chain;
- configurable Web and iOS market research through DataForSEO;
- evidence-grounded, auditable AI decisions;
- durable scheduling, retries, budgets, backup, migrations and operations status;
- a reproducible production build and deployment path.

## Non-goals

- multi-user accounts, billing or tenant isolation;
- PostgreSQL, microservices, Kafka or Kubernetes;
- native iOS client development;
- automated Reddit/X scraping;
- replacing AI judgment with a threshold-only rules engine.

## User stories

1. As the operator, I want only authorized access so that private research and
   paid API actions cannot be used by strangers.
2. As the operator, I want imported complaints to affect a candidate's research
   so that the verdict reflects the evidence I collected.
3. As the operator, I want Web and iOS market evidence from my selected market
   so that platform recommendations are not inferred from search volume alone.
4. As the operator, I want every score and verdict to be reproducible and cited
   so that I can trust, inspect and challenge the AI judgment.
5. As the operator, I want due candidates to refresh automatically and recover
   from transient failures without uncontrolled API spend.
6. As the operator, I want backups and safe schema upgrades so that a deployment
   or disk failure does not destroy the radar library.
7. As the operator, I want a production status screen so that failures and stale
   data are visible without reading server logs.

## Acceptance criteria

### R1. Single-user security

- While production mode is enabled, when the server starts without an admin
  credential and session secret, the server shall fail before accepting traffic.
- When an unauthenticated client requests protected UI or API data, the system
  shall return the login surface or an HTTP 401 response.
- When the operator logs in successfully, the system shall issue a signed,
  HttpOnly, SameSite session cookie without exposing the credential to frontend
  storage.
- When a state-changing request has an invalid origin or CSRF token, the system
  shall reject it.
- When repeated login or API requests exceed configured limits, the system shall
  return HTTP 429 without invoking paid providers.
- While production mode is enabled, the system shall add security headers,
  sanitize internal errors and avoid returning filesystem paths.

### R2. Signal evidence

- When a signal is converted into a new opportunity, the system shall create a
  source-linked evidence item containing its full complaint text, timestamp and
  source URL.
- When the operator links a signal to an existing opportunity, the system shall
  preserve the signal, add deduplicated evidence and mark the opportunity due
  for research.
- When research runs, the AI context shall include linked signal evidence as
  untrusted source content rather than executable instructions.

### R3. Multi-source market research

- When real research runs, the system shall use configurable location and
  language values instead of fixed US/English constants.
- When a Web opportunity is researched, the system shall collect search-demand,
  commercial-intent and organic-competitor evidence.
- When an iOS or Web+iOS opportunity is researched, the system shall collect App
  Store search competition, ratings and review-volume evidence.
- When an optional source is unavailable, the report shall record the evidence
  gap and shall not fabricate a substitute fact.
- When external provider results are stored, the system shall preserve provider,
  source URL where available, collected time and market.

### R4. AI decision integrity

- When the Judge returns dimension scores, the system shall require exactly one
  value for each of the nine canonical dimensions.
- When a report is persisted, the system shall compute the weighted total from
  normalized dimension scores while allowing AI to make the final verdict.
- When evidence coverage cannot support a high-confidence BUILD_NOW decision,
  the system shall require validation or human review rather than publishing an
  unsupported production recommendation.
- When a report is created, the system shall persist model ID, prompt version,
  evidence snapshot, evidence coverage, token usage and claim-level citations.
- When a report is displayed, the operator shall be able to trace decisive
  claims back to evidence IDs.

### R5. Durable refresh jobs

- While scheduling is enabled, when the configured update window arrives, the
  system shall enqueue or execute one globally locked due-research job.
- When a provider returns a transient error or timeout, the system shall retry
  with bounded exponential backoff.
- When the process restarts, the system shall release stale job locks and make
  failed or abandoned work retryable.
- When new material evidence is added, the opportunity shall become due even if
  its previous search data is still fresh.
- When a job finishes, the system shall persist counts, duration, error summary
  and provider mode.

### R6. Cost protection

- Before invoking a paid provider, the system shall enforce configured daily AI
  run and DataForSEO task budgets from durable usage records.
- When a budget is exhausted, the system shall stop the paid call, record the
  reason and keep the candidate retryable.
- When a provider reports cost or token usage, the system shall persist it for
  the operations status view.

### R7. Data durability

- When the database opens, the system shall apply ordered, idempotent schema
  migrations and record the active schema version.
- While production mode is enabled, a new database shall not be populated with
  demo products unless explicitly requested.
- When Web and background processes write concurrently, the database shall wait
  for a bounded busy timeout instead of failing immediately.
- When backup runs, the system shall create a consistent SQLite backup, verify
  integrity, retain the configured number of snapshots and record the outcome.
- When restoration is documented, the operator shall be able to recover a fresh
  deployment from one backup without editing application data manually.

### R8. Production runtime

- When the production build completes, both frontend assets and backend
  JavaScript shall exist without requiring `tsx` at runtime.
- When production requests real research but credentials are missing, the server
  shall fail rather than silently switching to Demo.
- When the container or service stops, the server shall finish graceful shutdown
  and close the scheduler and database.
- When the supplied deployment configuration is used, the database and backups
  shall reside on persistent storage and the application port shall bind only to
  the intended interface.

### R9. Observability

- When a request or background job runs, the system shall emit structured logs
  with request/job IDs and durations without logging secrets.
- When liveness is requested, the service shall report process health.
- When readiness is requested, the service shall verify database access,
  migration state and production configuration.
- When the operator opens system status, the UI shall show mode, source
  configuration, budgets, latest jobs, latest backup and current data freshness.
- When a scheduled job fails and an alert webhook is configured, the system
  shall send one sanitized failure notification.

### R10. Verification and documentation

- When changes are complete, automated tests shall cover authentication,
  authorization, signal linking, evidence normalization, cost limits, job
  locking, migrations, backup and production configuration.
- When the release candidate is built, type checking, tests, production build,
  dependency audit and browser smoke flows shall pass.
- When an operator follows the README, the operator shall be able to configure,
  deploy, back up, restore and update the application without reading source code.
