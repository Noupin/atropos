# Web Frontend Guardrails

These rules apply to the static marketing site under `web/`.

## Structure

- HTML entry points live at the root of this directory (`index.html`, `privacy.html`,
  `terms.html`). Keep one page per file so that each document can be served
  independently.
- Shared styles belong in `css/`; use `css/legal.css` for simple text-only policy
  pages.
- Client-side behavior is organized by feature under `js/`. Each file should focus on
  a single concern (signup form, phrase rotator, metrics, etc.) and avoid creating
  new global variables.

## JavaScript conventions

- Wrap logic in IIFEs or ES modules to prevent leaking globals. Query DOM elements
  defensively so pages without a feature do not throw errors.
- Prefer small, composable helpers over monolithic scripts. If a file grows beyond
  roughly 250 lines, split out additional modules.

## HTML & accessibility

- Include `<html>`, `<head>`, and `<body>` scaffolding for every page. Reuse the
  footer year script instead of hard-coding dates.
- Keep copy updates accessible: use semantic headings, maintain sufficient color
  contrast, and ensure links include descriptive text.

## Assets

- Place new icons or images beside `favicon.png`. Reference them with root-relative
  URLs (e.g., `/images/hero.png`).
- Keep social configuration overrides in `js/social.config.js` (copy from
  `social.config.example.js`).
