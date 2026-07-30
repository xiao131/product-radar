# Automatic Product Discovery Implementation Plan

- [x] 1. Add durable discovery and budget configuration
  - Add migration fields and unique indexes
  - Add discovery schedules, source limits, candidate limits, and dollar caps
  - _Requirements: R1, R2, R5, R6_

- [x] 2. Upgrade the usage ledger to enforce dollar limits
  - Reserve estimated cost before transmission
  - Settle with provider-reported cost
  - Report daily and monthly usage
  - _Requirement: R5_

- [x] 3. Implement DataForSEO automatic discovery adapters
  - Normalize Labs keyword ideas
  - Normalize Standard Google SERP results
  - Normalize Standard App Store lists
  - Continue when one optional source fails
  - _Requirements: R1, R2_

- [x] 4. Implement AI clustering and candidate persistence
  - Persist and deduplicate raw signals
  - Validate evidence-linked AI candidate output
  - Create or refresh deduplicated opportunities
  - _Requirements: R2, R3, R4_

- [x] 5. Integrate discovery into jobs, scheduler, API, and UI
  - Add scheduled and manual discovery jobs
  - Run discovery before research
  - Show discovery health, results, and dollar budgets
  - _Requirements: R4, R6_

- [x] 6. Verify and document
  - Add provider, budget, discovery, and API tests
  - Update environment and operator documentation
  - Run tests and type checking without running a production build
  - _Requirements: R1–R6_
