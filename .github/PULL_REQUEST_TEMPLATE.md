## Summary

<!-- One or two sentences: what does this PR change? -->

## Motivation

<!-- Why? Link issues: Closes #123, Refs #456 -->

## Changes

- <!-- bullet list of concrete changes -->
- <!-- -->
- <!-- -->

## Type of change

- [ ] 🐛 Bug fix (non-breaking)
- [ ] ✨ New feature (non-breaking)
- [ ] 💥 Breaking change (fix-up or migration required)
- [ ] ♻️ Refactor / chore / docs
- [ ] 🧪 Test-only

## Screenshots / recordings

<!-- For UI changes only — before & after. Drag-and-drop images. -->

## How to test

<!-- Numbered repro steps so a reviewer can verify the change. -->

1.
2.
3.

## Self-review checklist

- [ ] Branch targets `main` and is up to date
- [ ] Code follows the [CONTRIBUTING](../CONTRIBUTING.md) standards
- [ ] No `any` without an inline justification
- [ ] Zod validation on every new REST route / socket handler
- [ ] Authorization checks (active participant) on every new mutation
- [ ] No `dangerouslySetInnerHTML` on user content
- [ ] No secrets / `.env` / DB files committed
- [ ] `bun run lint` passes
- [ ] `bun run test` passes
- [ ] New feature has unit/integration tests
- [ ] New user flow has a Playwright spec
- [ ] Docs / README updated if behavior changed
- [ ] Commit messages follow Conventional Commits

## Notes for reviewer

<!-- Anything subtle the reviewer should look at carefully. -->
