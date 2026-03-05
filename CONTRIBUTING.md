# Contributing & Git rules

**What this file is for:** For developers contributing code to GlassyGaia. It describes branch naming rules, workflow (GitHub Flow), Pull Request guidelines, and the release process (tagging, updating the changelog). If you only want to use the app or see its features, read [README.md](./README.md).

---

## Main branch

- `main` is always **deployable**.
- All changes must go through a **feature branch and Pull Request** into `main`.

## Branch naming

| Prefix | Purpose | Examples |
|--------|---------|----------|
| `feat/...` | New feature | `feat/search-navbar-ui-refresh`, `feat/portfolio-progress-widget` |
| `fix/...` | Bug fix | `fix/admin-upload-path`, `fix/search-empty-state` |
| `chore/...` | Cleanup, config, tooling | `chore/upgrade-deps`, `chore/eslint-tweaks` |
| `refactor/...` | Refactor without changing behavior | `refactor/search-service`, `refactor/admin-layout-split` |
| `hotfix/...` | Urgent production fix | `hotfix/search-query-timeout` |

## GitHub Flow (recommended)

1. Create a branch from `main`: `git checkout -b feat/<short-descriptive-name>`.
2. Make small commits with messages like: `feat: ...`, `fix: ...`, `chore: ...`, `refactor: ...`.
3. Push the branch and open a Pull Request into `main`.
4. Require at least one review and a passing CI (if configured).
5. Merge with **Squash and Merge** or a merge commit (per team convention).
6. After merging, **delete the feature branch on GitHub** to keep the branch list tidy.

## Pull Request guidelines

- **Title:** Match the main commit, e.g. `feat: refresh search navbar and stats UI`.
- **Description:**
  - **What:** 1–3 bullets for the main changes.
  - **Why:** Brief reason (UX, perf, bug, etc.).
  - **Testing:** Steps you tested (screenshots for UI changes).
- Link to ticket/task if applicable (Jira, Linear, Notion, etc.).

---

## Release process

When releasing to production: finalize the commit on `main`, update [CHANGELOG.md](./CHANGELOG.md) for the new version, create a git tag (`git tag vX.Y.Z && git push origin vX.Y.Z`), then create a **GitHub Release** from that tag and copy the CHANGELOG content into the release description.
