# Automatic Product Discovery Requirements

## 1. Goal

Product Radar shall actively discover Web and iOS product opportunities from
English and Chinese internet/search data. Manual signal entry remains a
supplement, not the primary way candidates enter the radar.

## 2. User Stories

1. As the operator, I want the system to discover product candidates without
   requiring me to submit an idea first.
2. As the operator, I want raw discoveries preserved as signals so every
   candidate has traceable source material.
3. As the operator, I want AI to cluster, deduplicate, and reject noisy signals
   before candidates enter the radar.
4. As the operator, I want every accepted candidate to continue through the
   existing multi-source research and scoring pipeline.
5. As the operator, I want hard daily and monthly DataForSEO cost limits so an
   automation fault cannot create an open-ended bill.

## 3. Acceptance Requirements

### R1 — API-first automatic collection

- When the scheduled discovery window arrives, the system shall call configured
  DataForSEO sources without requiring an open browser or manual input.
- The system shall collect both US/English and China/Chinese market data.
- The system shall use low-cost batched or Standard delivery whenever the
  selected endpoint supports it.
- When a source is disabled or fails, the run shall preserve results from other
  sources and report the gap.

### R2 — Traceable signal inbox

- When a source item is collected, the system shall persist its source, URL,
  market, metrics, collection run, and a stable fingerprint.
- When the same source item is collected again, the system shall update or
  reuse the existing signal instead of creating a duplicate.
- Automatically collected signals shall remain visible in the existing signal
  inbox.

### R3 — AI candidate generation

- When a discovery run has usable signals, the system shall ask AI to cluster
  related pains, searches, and app-market observations.
- The AI shall reject generic news, navigation queries, entertainment-only
  trends, and ideas unsupported by the collected data.
- Every generated candidate shall cite at least two collected signals.
- When a generated discovery key already exists, the system shall link the new
  signals to the existing candidate and mark it for refreshed research.
- When a discovery key is new, the system shall create an `UNRESEARCHED`
  opportunity and link its source signals.

### R4 — Continuous research

- When automatic discovery completes, the daily research job shall include the
  newly created or refreshed candidates.
- When new evidence changes a candidate, the existing versioned research and
  scoring rules shall remain authoritative.

### R5 — Cost guardrails

- Before a DataForSEO request is sent, the system shall reserve its estimated
  cost inside the same durable usage ledger used for task limits.
- When a request completes, the system shall replace the estimate with the
  provider-reported cost.
- When the configured daily or monthly dollar limit would be exceeded, the
  system shall stop new DataForSEO requests before transmission.
- The system status page shall show task usage, daily cost, monthly cost, and
  both dollar limits.
- Background discovery and research shall never use Google Ads Live delivery.

### R6 — Operations

- The scheduler shall run backup, discovery, and research in a deterministic
  order.
- The operator shall be able to trigger discovery manually from the system
  status page without bypassing cost limits.
- The system status page shall show whether automatic discovery is enabled,
  the latest discovery time, signals collected, and candidates created.

## 4. Default Budget

- Daily DataForSEO hard limit: `$0.50`.
- Monthly DataForSEO hard limit: `$10.00`.
- Maximum candidates created per discovery run: `5`.
- Automatic discovery uses bounded result limits and one run per local day.

## 5. Non-goals

- Exhaustive real-time access to private or unindexed Reddit/X content.
- A general-purpose web crawler.
- Automatic product development or publishing.
- Multi-tenant discovery policies.

