<!--
Thanks for the pull request. The guide is CONTRIBUTING.md (中文：CONTRIBUTING.zh-CN.md).
Title this pull request the way you would write the commit subject:
  <type>(<scope>): <subject>   e.g. fix(kafka): keep the offset reset within the retention window
-->

## What

<!-- What this changes, in a sentence or two. -->

## Why

<!--
The motivation. If an issue asked for it, link it here and put the footer
`Closes #NN` in the commit body, or `Refs #NN` when the issue stays open.
-->

## How to verify

<!--
What a reviewer should do to see it working: the pages to open, the broker to
point at, the command to run. For a bug fix, say what it did before.
-->

## Checklist

- [ ] The title follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), and so do the commits
- [ ] `make check` passes locally
- [ ] I read what this touches, and did not leave a half-wired page behind

If it applies:

- [ ] A commit closes an issue → its body has `Closes #NN`, **and** both `CHANGELOG.md` and `CHANGELOG.zh-CN.md` name that number under `Unreleased`. The Changelog check fails otherwise, and a number written inside backticks does not count
- [ ] New user-facing text is in both `frontend/src/i18n/locales/en.json` and `zh.json`
- [ ] Docs changed in pairs — `README.md` with `README.zh-CN.md`, and so on
- [ ] A Go service signature changed → `npm run generate:bindings`, with the result committed
- [ ] A new live test carries `e2e.Require` with a probe **and** a `Family`, and that family has a shard in `.github/workflows/ci.yml`
- [ ] A driver was added or a family changed name → every family list in CONTRIBUTING.md is updated

<!--
On the checks: **Check** and **Build** are the ones that gate this pull request.
**Package** is skipped on pull requests by design. **Workers Builds** fails on
every pull request branch here and is not caused by your change — previews are
not enabled on the account, so only the deployment from `main` can go green.
-->
