# Automatic Product Discovery Design

## 1. Result-Oriented Flow

```text
Daily scheduler
  └─ DataForSEO discovery adapters
       ├─ Labs keyword ideas (broad demand)
       ├─ Standard SERP queries (pain language and public discussions)
       └─ App Store new/top apps (iOS market movement)
            ↓
       canonicalized, deduplicated Signals
            ↓
       AI cluster + noise rejection + dedupe key
            ↓
       new/refreshed Opportunities
            ↓
       existing Standard batch research + AI verdict
            ↓
       ranked radar
```

The React site remains a result and operations surface. Collection runs in the
server process and does not depend on a browser session.

## 2. Modules

### `discovery-provider.ts`

Owns DataForSEO discovery calls and normalizes provider payloads into bounded
`DiscoveredSignalInput` records. It reserves estimated dollar cost before every
billed request and settles the reservation with the returned task cost.

### `discovery.ts`

Persists canonicalized signals, builds a bounded untrusted-data snapshot for
AI, validates structured candidate output, deduplicates by `discovery_key`, and
links source signals to opportunities.

### `jobs.ts` and `scheduler.ts`

Add a durable `DISCOVERY` job and lock. A scheduled discovery is attempted at
most once per local day, even if its AI stage fails. Paid collection is
persisted before AI clustering so a same-day manual retry is AI-only.

### `usage.ts`

Treats one usage row as both reservation and measurement. Estimated cost is
written during reservation and replaced by actual reported cost at settlement.
Discovery-specific daily, overall daily and calendar-month limits are checked
transactionally before transmission.

## 3. Data Model

Migration 3 adds:

- `signals.fingerprint`, `signals.market`, `signals.source_name`,
  `signals.metrics_json`, `signals.discovery_run_id`, `signals.auto_collected`;
- a unique partial index on signal fingerprint;
- `opportunities.discovery_key`, `opportunities.auto_discovered`;
- a unique partial index on opportunity discovery key.

Existing `job_runs` stores global discovery runs with `job_type=DISCOVERY`.

Migration 4 adds `signals.canonical_key` and `signals.duplicate_count`, safely
consolidates historical automatic duplicates, and preserves merged provenance
inside signal metrics.

## 4. Discovery Sources and Cost Choices

- Labs Keyword Ideas is called once per configured market with multiple built-in
  seed phrases and a bounded result limit.
- Google organic SERP uses Standard task POST/GET, never Live, and posts multiple
  pain-oriented queries in one request.
- App Store discovery uses Standard `new_free_ios` list tasks.
- Content Analysis is intentionally excluded from the default daily loop because
  its per-request floor is materially higher; it can be added later for
  shortlisted candidates.
- Existing candidate research continues to batch Google Ads search-volume
  keywords by market.

## 5. AI Boundary

Provider text is enclosed as untrusted JSON. The model receives stable signal
IDs and may only cite those IDs. Output is Zod-validated and limited to the
configured maximum candidate count. The system enforces:

- at least two unique signal IDs per candidate;
- valid signal IDs only;
- normalized deterministic discovery keys;
- no direct execution of instructions found in source content.

## 6. Failure and Safety

- Source failures produce warnings in the discovery result but do not erase
  successful source data.
- Paid collection completion is saved before AI. AI failure cannot cause a
  second same-day DataForSEO batch.
- Automatic discovery has a separate `$0.05` daily cap in addition to the
  overall provider limits.
- A cost-limit exception stops further paid requests and is visible in job
  history.
- Failed provider calls retain their conservative estimated reservation because
  a remote task may have been accepted before the local failure was observed.
- Database uniqueness handles retries and process restarts.
- Existing authentication and CSRF rules protect manual job triggers.

## 7. Testing

- Provider normalization tests use mocked DataForSEO payloads.
- Discovery tests verify signal/candidate dedupe and evidence linkage.
- Usage tests verify daily/monthly dollar limits and settlement.
- Scheduler/API tests verify DISCOVERY job exposure and manual triggering.
- Frontend type checks cover operations status and controls.
