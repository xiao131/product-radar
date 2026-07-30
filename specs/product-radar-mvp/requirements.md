# Product Radar MVP Requirements

## 1. Goal

Build a local-first product opportunity database that actively discovers and
helps one operator decide which Web or iOS product is worth building next.

## 2. User Stories

1. As an operator, I want to see every opportunity, not only a fixed Top 10.
2. As an operator, I want to sort and filter opportunities by score, platform, verdict, status, confidence, and score change.
3. As an operator, I want to add existing Web/iOS products so the radar avoids duplicate recommendations.
4. As an operator, I want to submit an idea or complaint dataset and receive a researched verdict.
5. As an operator, I want each verdict to cite evidence and show supporting, opposing, and unknown factors.
6. As an operator, I want score history so I can see why an opportunity became more or less attractive.
7. As an operator, I want collected evidence visible in the UI.
8. As an operator, I want internet/search data to generate candidates
   automatically so manual idea entry is optional.

## 3. Acceptance Requirements

### R1 — Radar library

- When the user opens the radar library, the system shall return all persisted opportunities through a paginated API.
- When the user changes sort, filter, search, or page controls, the system shall update the displayed rows.
- While research is incomplete, the system shall label the opportunity `UNRESEARCHED`, `RUNNING`, or `FAILED`.

### R2 — Product library

- When the user creates a product, the system shall persist its name, platform, status, URL, description, and current focus.
- When research runs, the system shall include existing products in duplicate and packaging analysis.

### R3 — Signal intake

- When the user submits an idea, comment, URL, or CSV, the system shall persist one or more Signals with source metadata.
- When the user processes a Signal, the system shall attach it to an existing entity or create a research-pending Opportunity.
- The system shall never treat a single complaint as sufficient proof of market demand.

### R4 — Research

- When research starts, the system shall collect or load evidence, then execute researcher, debate, and judge stages.
- When real credentials are absent, the system shall use Demo mode and visibly label the output.
- The system shall store evidence IDs for material factual claims.
- When evidence is insufficient, the system shall return `VALIDATE_FIRST`, `WATCH`, or low confidence rather than an unsupported strong recommendation.

### R5 — Multi-platform decision

- When research completes, the system shall output Web, iOS, and cross-platform fit scores.
- The system shall recommend `WEB`, `IOS`, or `WEB_AND_IOS` and explain why.

### R6 — Versioned scoring

- When new evidence causes re-research, the system shall create a new report version without deleting the previous report.
- When a report changes the score, the system shall save previous score, current score, delta, and change summary.
- When the score model changes, historical reports shall remain readable.

### R7 — Evidence visibility

- When the user opens an opportunity, the system shall show verdict, dimension scores, evidence, platform analysis, risks, unknowns, and report history.
- The system shall show source, collection date, market, and platform for evidence when present.

### R8 — Local operation

- When the operator runs the documented commands, the application shall start locally with persistent SQLite data.
- The system shall provide a health endpoint and a deterministic seed dataset.
- Automated tests and production build shall pass.

### R9 — Automatic discovery

- When the daily discovery schedule runs, the system shall collect English and
  Chinese market signals without manual input.
- When AI finds a supported product opportunity, the system shall deduplicate
  it, add it to the radar, and preserve the source signals.
- Before calling a paid data source, the system shall enforce daily and monthly
  dollar limits.

## 4. Non-goals

- Multi-tenant access control.
- Exhaustive private or real-time Reddit/X firehose access.
- Automated product publishing.
- Distributed queues.
- Search Console OAuth in the first implementation.
