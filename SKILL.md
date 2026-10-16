---
name: buffer-publisher
description: Draft, queue, schedule, and verify social posts in the user's Buffer account, including a draft-first workflow for local images. Use for Buffer publishing requests.
---

# Buffer Publisher

Use the bundled Node.js CLI for Buffer account discovery, post creation, and read-back verification. Resolve `scripts/buffer_publish.mjs` relative to this skill directory. Requirements and setup are in [README.md](README.md); exact API shapes are in [references/buffer-api.md](references/buffer-api.md).

## Resolve the publishing request

1. Read `list` to discover actual organizations and channels unless their IDs are already verified in the current task. Ask which account/channel only when the request remains ambiguous.
2. Resolve the final copy, media, destination, and intended state: draft, queue, or exact schedule. Interpret dates in the user's established timezone; preserve the intended local time while converting to UTC. Ask for the timezone when it changes the outcome and is unknown.
3. Preview the exact write with `--dry-run` when useful. This mode requires no API key and makes no API requests. It validates input but cannot prove Buffer accepts the post.
4. Create only drafts unless the user has authorized queuing or scheduling the final content. Reuse authorization for the same version. Do not infer permission to send from a request for copy or a draft.

## Text or already hosted media

Use `draft`, `queue`, or `schedule` as requested. For multiline copy, prefer a UTF-8 JSON file with `channelIds`, `text`, optional `assets`, and optional `dueAt`. Match `mode` to the actual command if it is included. Hosted assets need public HTTPS URLs accessible to Buffer. Do not upload local files to a third-party host without authorization.

The CLI reads back each created post and checks text, channel, intended status, scheduled time when supplied, and minimum media count. Inspect returned issues. It stops a batch at the first failure and reports skipped channels. A failed or interrupted mutation may have created a post: inspect Buffer before retrying; never rerun a whole batch without checking known post IDs.

## Local images: draft first

The bundled CLI accepts media URLs; it does not upload local files. Use the logged-in Buffer web app and the environment's permitted browser tools:

1. Create a draft, then open that exact post in Buffer.
2. Upload the requested local image through Buffer's file control and save.
3. Read the post with `get`; confirm the correct image in the web preview and verify `assetCount >= 1` before scheduling.
4. Apply the authorized schedule in Buffer's web app, then run `verify` against that same post ID to check channel, state, time, and media count. Inspect the final copy and preview too.

Check each post before moving to the next. If browser access is unavailable, retain the draft and explain the missing upload. Never silently reduce an image post to text-only. If an edit unexpectedly publishes a post, changes its time, or removes media, stop the batch and report the observed state; deletion or reposting needs its own authorization.

## Completion and reporting

Report each post's ID, destination, observed state, local scheduled time, and media result. A draft is not scheduled; scheduled is not sent. A successful creation response is not evidence of eventual delivery. Verify public delivery only when the requested task includes it and authoritative evidence is available.

## Credentials

Read `BUFFER_API_KEY` from the environment or an external key file configured by `BUFFER_API_KEY_FILE`. A legacy file at `~/.codex/secrets/buffer-publisher.env` is also supported. Never display credentials or include them in post payloads, screenshots, logs, or repository files. Read-only discovery can still reveal account/channel details: keep real outputs out of public examples.
