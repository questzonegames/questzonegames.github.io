# Project rules for Claude Code

## Git: no auto-commit, no auto-push

- Never run `git commit` or `git push` unless the user explicitly tells you to in that
  message. Making the code changes is not itself approval to commit or push.
- After making changes, show a preview (describe what changed, and/or point to the
  changed files) and then stop and wait for approval. Do not commit "so the user can
  see it live" — describe/show it locally or via a proof image/screenshot instead.
- Only commit and push when the user says something like "looks good, commit and push
  it live" — a clear, explicit instruction to publish.
- If it's ever unclear whether the user has approved a push, ask first. Do not assume.
- This applies every session, including ones started fresh after a context compaction —
  do not treat approval from an earlier session/conversation as still standing.
