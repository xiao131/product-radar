# Product Radar MVP Technical Design

## 1. Architecture

```text
React UI
  ↕ JSON API
Express application
  ├─ Signal service
  ├─ Opportunity service
  ├─ Research orchestrator
  ├─ Provider adapters
  └─ SQLite repository
```

One TypeScript repository owns the UI, API, jobs, validation, and schema. Long-running research is represented as a run record; the first implementation executes locally without a distributed queue.

## 2. Module Contracts

### Signal service

Input: manual form or CSV rows.
Output: normalized Signals and optional Opportunity drafts.

### Provider adapter

Input: research plan.
Output: typed Evidence items with provenance and freshness.

### Research orchestrator

Input: Opportunity, Signals, Products, Evidence.
Output: versioned Research Report and denormalized current opportunity fields.

### Presentation API

Input: list/query/form requests.
Output: bounded JSON payloads with validation and clear errors.

## 3. Data Model

```text
Product 1 ── n Opportunity (similar/packaging relationship)
Signal  n ── 0..1 Opportunity
Signal  n ── 0..1 Product
Opportunity 1 ── n EvidenceItem
Opportunity 1 ── n ResearchReport
DiscoveryRun 1 ── n ResearchReport
```

SQLite uses WAL mode and foreign keys. JSON fields store rich evidence while frequently filtered fields remain scalar columns.

## 4. Research Contract

Research output includes:

```text
verdict
recommendedPlatform
recommendedAction
confidence
score
dimensionScores[]
supportingReasons[]
opposingReasons[]
unknowns[]
risks[]
platformAnalysis
mvp
evidenceIds[]
changeSummary
```

Demo mode is deterministic for reproducible testing. Real mode routes structured generation through an adapter and validates every stage with Zod.

## 5. UI Design

- Industrial/editorial data terminal.
- Left navigation, wide data canvas.
- Paper background with charcoal, forest, and orange signal colors.
- IBM Plex Mono for numbers/headings; Source Sans 3 for prose.
- Opportunity table is the primary interface, not decorative summary cards.
- Responsive layout collapses navigation and converts dense tables into horizontally scrollable regions.

## 6. Error Handling

- API errors use `{ error, details? }`.
- Form validation is shown inline.
- Provider failures create failed run records without deleting prior evidence.
- Demo and real modes are visually distinct.
- Empty, partial, stale, updating, and failed states are explicit.

## 7. Security

- API credentials stay server-side.
- Imported social text stores no unnecessary identity fields.
- URLs and CSV content are validated.
- Raw HTML is never rendered directly.

## 8. Testing

- Repository and service unit tests.
- Supertest API integration tests using an isolated temporary database.
- Browser smoke tests for all primary user flows.
- Build, typecheck, lint, and seed verification before handoff.
