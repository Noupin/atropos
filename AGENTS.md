# AGENTS Instructions

These instructions apply to the entire repository.

## Repository Overview
Atropos automatically extracts short-form clips from long-form videos. This repository contains the server pipeline that downloads videos, transcribes audio, ranks segments, and renders captioned clips.

### Directory Layout
- `server/` – pipeline implementation, CLI, and supporting modules.
- `tests/` – test suite covering pipeline steps and utilities.
- `README.md` – project description and setup instructions.

## Commit Message Format
- Use Conventional Commits style: `<type>: <subject>`.
  - Types include `feat`, `fix`, `docs`, `refactor`, `test`, etc.
  - Subject line uses imperative mood and is ≤ 50 characters.
- Separate the body with a blank line and wrap lines at 72 characters.

## Pull Request Checklist
- [ ] Follow the commit message format.
- [ ] Update documentation and type hints as needed.
- [ ] Ensure code meets style guidelines.
- [ ] Run the preferred tests and confirm `pytest` passes locally.
- [ ] Provide a clear PR description.

## Testing
- Run unit tests with `pytest tests/unit`.
- Run integration tests with `pytest tests/integration`.
- Run the full suite with `pytest` from the repository root.
- All tests must pass locally before submitting a PR.

## Style Guidelines
- Limit lines to 88 characters.
- Use type hints for all functions.
- Write docstrings in Google style.
- Follow PEP 8 conventions.
