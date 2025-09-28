# Contributing to Atropos

## Workflow overview

1. Create a feature branch from `main` using `type/scope-short-description` (e.g., `feat/licensing-consume-trial`).
2. Make focused commits that follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). Supported types include `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, and `build`. Use scopes such as `desktop`, `licensing`, `server`, or `infra`.
3. Include `BREAKING CHANGE:` notes in the commit body when behavior or APIs change in incompatible ways.
4. Push your branch and open a pull request using the template in [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md).
5. Ensure required CODEOWNERS are requested as reviewers. Automated checks run on every PR; keep diffs small for faster iteration.

## When to create an ADR

- Open an ADR under `docs/ADRS` for architectural shifts, new external dependencies, or changes to environment resolution rules.
- Reference the ADR in your PR description and link back once the decision is merged.
- Minor refactors or copy updates do not require ADRs; add context to the PR description instead.

## Proposing new modules vs editing existing ones

- Add new modules when introducing routes, worker handlers, adapters, or sizeable UI features. Wire them up in minimal existing files.
- Split large files that mix responsibilities before adding more logic. Prefer composition over modification.
- For cross-cutting concerns, stage independent PRs per layer (UI, services, worker) instead of bundling everything together.

## Testing expectations

- Run `pytest` from the repository root for Python services.
- Desktop changes should execute `npm test` or relevant Vite/Electron checks described in [desktop/README.md](desktop/README.md).
- Licensing worker changes should run Wrangler integration/unit tests outlined in [services/licensing/README.md](services/licensing/README.md).
- Document any deviations from expected test suites in the PR template.

## Local setup references

- Desktop environment variables and run commands: [desktop/README.md](desktop/README.md)
- Python services configuration and CLI usage: [server/README.md](server/README.md)
- Licensing worker secrets, endpoints, and curl recipes: [services/licensing/README.md](services/licensing/README.md)
- Infrastructure deployment workflow: [infrastructure/README.md](infrastructure/README.md)

## Issue & PR templates

- Bug reports: [.github/ISSUE_TEMPLATE/bug_report.md](.github/ISSUE_TEMPLATE/bug_report.md)
- Feature requests: [.github/ISSUE_TEMPLATE/feature_request.md](.github/ISSUE_TEMPLATE/feature_request.md)
- Tech debt & refactors: [.github/ISSUE_TEMPLATE/tech_debt.md](.github/ISSUE_TEMPLATE/tech_debt.md)
- Pull requests: [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md)

## References & standards

- Conventional Commits: [conventionalcommits.org](https://www.conventionalcommits.org/en/v1.0.0/)
- Keep a Changelog: [keepachangelog.com](https://keepachangelog.com/en/1.1.0/)
- GitHub CODEOWNERS: [docs.github.com](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
- Issue & PR templates: [GitHub Docs](https://docs.github.com/en/issues/building-community/using-templates-to-encourage-useful-issues-and-pull-requests)
