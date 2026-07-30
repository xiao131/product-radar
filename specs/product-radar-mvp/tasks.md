# Product Radar MVP Implementation Plan

- [x] 1. Create the application foundation
  - Vite React frontend, Express API, TypeScript, Tailwind, SQLite
  - Development, build, test, and seed scripts
  - _Requirements: R8_

- [x] 2. Implement the radar database
  - Create schema, migrations/bootstrap, repositories, and seed data
  - Implement products, signals, opportunities, evidence, reports, and runs
  - _Requirements: R1, R2, R3, R6, R7_

- [x] 3. Implement Signal intake
  - Manual idea/comment/URL form
  - CSV import and Signal processing
  - _Requirements: R3_

- [x] 4. Implement research and decision services
  - Demo provider and real-provider interfaces
  - Researcher, debate, judge orchestration
  - Multi-platform scoring and report versioning
  - _Requirements: R4, R5, R6_

- [x] 5. Implement JSON APIs
  - Dashboard, opportunities, products, signals, research, settings, health
  - Validation, pagination, sorting, filtering, error contracts
  - _Requirements: R1–R8_

- [x] 6. Implement the UI
  - Dashboard, radar library, opportunity detail, products, signals
  - Demo-mode, freshness, error, empty, and loading states
  - _Requirements: R1, R2, R3, R5, R7_

- [x] 7. Verify and optimize
  - Unit and API tests
  - Production build and local startup
  - Browser smoke tests and visual QA
  - Fix bugs and remove complexity that does not improve decisions
  - _Requirements: R1–R8_
