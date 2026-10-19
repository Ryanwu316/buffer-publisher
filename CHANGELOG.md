# Changelog

## 1.1.0 — 2026-10-19

### Added

- `doctor` checks Node.js and local credential configuration without API requests. `doctor --online` performs read-only connection discovery and reports organization/channel counts without account details.
- `verify --expected-text-file` compares the saved post with approved multiline UTF-8 text, preserving whitespace while ignoring a leading BOM.
- Existing users now have Git and ZIP upgrade instructions and a first-draft trial path.

### Fixed

- Reject conflicting JSON and CLI sources for media, text, channels, and scheduled time. In 1.0.0, `assets: []` in JSON silently ignored an explicit `--image-url`; 1.1.0 stops with an actionable error before any API request.
- Reject explicit null payload fields instead of silently falling back; support UTF-8 BOM JSON files used by Windows editors.
- Preserve per-post results and continue read-only `get` / `verify` batches when one post cannot be read. Overall success remains false while any requested post fails.
- Detect empty or unchanged example keys locally.

Regression coverage expands from 17 to 32 tests. Creation failures still stop write batches, and uncertain writes are never retried automatically.

## 1.0.0 — 2026-10-16

First public version, prepared from a locally used Buffer publishing skill.

- Draft, queue, schedule, and read back posts with explicit state and media checks.
- Add an offline dry-run mode and configurable external key file.
- Validate publishing modes, media URLs, duplicate channels, and future timestamps before requests.
- Stop multi-channel creation on the first failure; report created IDs and skipped channels.
- Add installation instructions, examples, MIT licensing, and automated tests.

This is the initial public release. Earlier local changes are not presented as public releases.
