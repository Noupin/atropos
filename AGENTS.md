# AGENTS Instructions

These instructions apply to the entire repository. Follow them alongside any
nested `AGENTS.md` files.

## Start here

1. Skim the top-level [README](README.md) for the repository map, then read
   [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system boundaries and
   environment selection rules.
2. Use [docs/AGENTS.md](docs/AGENTS.md) as the canonical guardrail reference for
   file creation, naming, and safety rules. Obey the more specific instructions
   in that guide when editing scoped areas.
3. Check service READMEs (`desktop/`, `server/`, `services/licensing/`,
   `infrastructure/`) before changing runtime behavior or wiring new modules.
4. Confirm whether an ADR already covers the decision you are about to change
   (`docs/ADRS/`). Author a new ADR for material architectural shifts.

## Testing

- Run `pytest` from the repository root after changes. If optional dependencies
  are missing, document the gap and run the most specific subset you can.
- Add or update tests whenever you introduce new features or fix bugs. Colocate
  new tests beside the modules they exercise.
- Lint Markdown with `npx --yes cspell --config cspell.json "**/*.md"` whenever
  you touch documentation.

## Code Style

- Python code must follow PEP 8 conventions, use 4 spaces for indentation, and
  keep line length under 100 characters.
- Prefer descriptive names, f-strings for formatting, and add type hints and
  docstrings to public functions, classes, and modules.
- Desktop and worker TypeScript should remain below ~400 LOC per file; split
  helpers into new modules when scope expands.

## Workflow & commits

- Use Conventional Commits (`type(scope): message`) for all commits. Note
  `BREAKING CHANGE:` details in the footer when applicable.
- Keep commits focused on a single concern and prefer smaller, well-scoped PRs.
- When adding routes, handlers, adapters, or UI flows, create new modules and
  wire them in rather than expanding existing large files.

## Documentation

- Update the relevant README, ADR, or architecture document whenever behavior
  or configuration changes.
- Note new environment variables in both the service README and
  `docs/ARCHITECTURE.md`.


