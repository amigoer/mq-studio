# Changelog

All notable changes to Rocket-Leaf are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

[简体中文](CHANGELOG.zh-CN.md)

## [0.1.3] - 2026-08-06

### Added

- The topic pickers on Send test message and Messages filter as you type, so a
  cluster with hundreds of topics no longer has to be scrolled through. Matches
  are ordered by how well they fit: the exact name first, then names starting
  with what was typed, then names merely containing it.
- Both pickers now open on a "Recently used" section holding the last ten topics
  actually sent to or queried — usually the handful one service is being
  debugged against. The list is kept per connection, so one cluster never
  suggests another's names, and a topic since removed from the cluster is not
  offered.
- The consumer group picker behind the retry and dead-letter tabs works the same
  way, with a recent list of its own.
- A picker renders at most 200 matches at a time and reports how many were left
  out, so even a very large cluster opens instantly.

## [0.1.2] - 2026-08-06

### Added

- Update checks run on their own: Rocket-Leaf asks GitHub for a newer release
  shortly after launch and every 24 hours after that. A release is announced
  once, then marked on the Settings entry in the sidebar until that page is
  opened, so nobody has to go looking for the check to learn about an update.
- Settings > General gains "Check for updates automatically", on by default, for
  anyone who would rather the app made no outbound request on its own. The
  request carries the running version and nothing else.

### Changed

- The "Check for updates" button in Settings > About shares that state, so a
  manual check also clears the sidebar marker and updates what the About card
  reports.

## [0.1.1] - 2026-08-06

### Added

- Connections can be organised into groups. A group is free text and optional:
  type a name to create one, pick an existing name to reuse it, or leave the
  field empty to stay ungrouped.
- The connection list buckets profiles under collapsible group headers, named
  groups first and ungrouped last. A list with no groups at all keeps the flat
  layout it had before.
- Connection search matches the group name, and temporarily expands folded
  groups so a match is never hidden behind a collapsed header.

### Changed

- The connection environment field (Production / Test / Development) is replaced
  by the group. The old preset only tinted a badge, and it could not be left
  unset, so every profile carried a label whether or not it meant anything.

### Removed

- The stored environment value is dropped when a connection profile is loaded.
  Existing connections open as ungrouped rather than inheriting a group named
  after the old preset. No other connection setting is affected.

## [0.1.0] - 2026-08-05

### Added

- First release of the desktop client rebuilt on Wails 3, published for macOS,
  Windows and Linux on both amd64 and arm64.

### Changed

- Versioning restarts at 0.1.0 for the rebuilt application. This release does
  not continue the earlier 1.x line, and no upgrade path from it is provided.

[0.1.3]: https://github.com/amigoer/rocket-leaf/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/amigoer/rocket-leaf/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/amigoer/rocket-leaf/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/amigoer/rocket-leaf/releases/tag/v0.1.0
