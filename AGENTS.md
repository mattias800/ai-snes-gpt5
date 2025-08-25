# Agent Guidelines for this Repo

- Always follow docs/EMULATOR_PLAN.md as the primary implementation roadmap. Update this file when high-level plan changes are required and commit those updates with a descriptive message.
- All development must be test-driven. Never implement a feature without unit tests that define its behavior.
- No manual testing until the acceptance criteria in the plan indicate high confidence that Super Mario World will run.
- After each unit of work (new module, feature, or test suite), create a Git commit with a detailed message explaining what changed and why.
- Never add proprietary ROMs to the repository. Tests that require ROMs must be opt-in via environment variables and skipped by default.
- Prefer pure, deterministic logic in the emulator core. The frontend should be a thin layer.

