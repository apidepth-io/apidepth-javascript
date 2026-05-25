# Contributing to apidepth (npm package)

## Prerequisites

- Node >= 18

```bash
npm install
```

## Running tests

```bash
npm test          # run once
npm run test:watch  # watch mode
npm run typecheck   # TypeScript type check only
```

## Making changes

**All changes to `main` must go through a pull request.** Direct pushes are blocked.

### Commit / PR title format

PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/) — the title becomes the squash-merge commit message that drives automated versioning:

```
feat: add Next.js app router support
fix: flush batch on process exit
docs: add Express integration example
chore: update dependencies
```

Use `feat!:` or put `BREAKING CHANGE: <description>` in the PR body for breaking changes (triggers a major version bump).

The `PR Title` check will fail and block merge if the format isn't followed.

## Release process

Releases are fully automated via [release-please](https://github.com/googleapis/release-please). You do not manually bump versions or tag releases.

1. **Merge your PR** — release-please reads the commit message and accumulates changes.
2. **A "Release PR" appears** — release-please opens a `chore: release X.Y.Z` PR that bumps the version in `package.json` and updates `CHANGELOG.md`. This PR stays open and updates itself as more commits land.
3. **Merge the Release PR** — triggers the publish job, which runs `npm ci && npm run build && npm publish`.

> `src/version.ts` is a derived file — the `prebuild` script regenerates it from `package.json` before every build. Do not edit it directly.

### Version semantics

| Commit type | Version bump |
|---|---|
| `feat:` | minor |
| `fix:` | patch |
| `feat!:` or `BREAKING CHANGE` in body | major |
| `chore:`, `docs:`, `refactor:`, `test:` | no release |

### Do not edit `package.json` version manually

release-please owns the `version` field. Manual edits will cause the manifest to drift and break the next automated release.

## CI

The single CI job runs TypeScript type checking, Vitest unit tests, and a full build — all on Node 20. All three steps must pass before a PR can merge.

## Secrets (maintainers only)

| Secret | Where to get it |
|---|---|
| `NPM_TOKEN` | npmjs.com → Access Tokens → Generate New Token → Automation |
