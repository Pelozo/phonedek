## Persistent Agent Workflow

Your working memory is stored on disk.

At the beginning of every session:
1. Read .agent/PLAN.md and .agent/STATE.md.
2. Inspect git status and relevant source files.
3. Resume the first incomplete task.

During execution:
- Work on one small task at a time.
- Update STATE.md after each meaningful milestone.
- Mark verified tasks completed in PLAN.md.
- Record important architectural decisions.
- Record blockers, failures, and attempted solutions.
- Keep state concise. Do not store full logs.

Before ending a session or requesting compaction:
- Update STATE.md with the exact next action.
- Save unfinished work and relevant file paths.

Never assume a task is finished just because
STATE.md says so. Verify actual code and tests.

## Subagents (preferred)

Delegate to `subagent` to keep this session's context small. The main
session only sees the subagent's final answer, so heavy work —
exploration, research, reading large files or logs, multi-step
implementation — belongs there, not inline.

- Explore/research first: "find X in the codebase" → `explore` subagent
  (set the thoroughness level); general subagent for multi-step tasks.
- Self-contained features or fixes: hand the subagent a precise brief —
  goal, file paths, invariants, and a definition of done.
- Heavy verification (running tests, builds, triaging failures): let the
  subagent run it and report the verdict, not the full output.
- Run with `background: true` when this session has other work to do;
  run in the foreground when the next step depends on the result.
- Keep the main session for orchestration: planning, reviewing the
  subagent's report, small edits, updating STATE.md/PLAN.md.

## Long-Runtime Work

This agent is expected to run unattended. Never block the session on
something that can wait.

- Any command that may run longer than ~30 seconds (servers, builds,
  installs, tests, migrations, downloads) must be called with
  `background: true`. Never run it in the foreground.
- When two tool calls are independent, issue them in the same turn.
  Do not run independent calls sequentially.
- Use `execute` (Code Mode) to fan out independent tool calls in parallel.
- A foreground `shell` call times out after 2 minutes by default. Pass
  `timeout` explicitly only when the result is genuinely needed before
  the next step.
- Use `subagent` with `background: true` for long child tasks so this
  session keeps working while they run.
- Prefer backgrounding over waiting. Read the result on a later turn;
  background calls notify the session when they finish.

Nothing on the keyboard to answer prompts, so avoid stalling states:

- Do not call `question` unless the task is truly blocked without an answer.
- Do not choose an approach that resolves to `ask` when an already-allowed
  approach exists. A pending approval stalls the session indefinitely.

## Autopilot (continuous work) — IMPORTANT

This project is meant to keep working **without the user sending new
messages** while `.agent/AUTOPILOT` exists.

The harness has no built-in agent loop. It DOES guarantee this: *a background
command resumes the session automatically when it finishes*. That is the
autopilot heartbeat:

**Before ending ANY turn (while autopilot is on), start a wake-up timer as the
last tool call:**

```
shell({ command: "sleep 90; echo AUTOPILOT_TICK", background: true })
```

Then write the normal reply. When the timer completes, the session is resumed
automatically — continue with the next task and schedule the next timer before
ending again. This is what makes the agent run for hours without user input.

Autopilot loop rules:

0. **A wake-up is NOT a new session.** Do not re-read `.agent/PLAN.md` /
   `.agent/STATE.md` on every tick — if the context still contains the plan and
   the in-flight task (it normally does), just continue where you were. Re-read
   only when: the context was compacted/summarized, you are genuinely unsure
   what to do next, or this is a fresh session. Keep the heartbeat cheap.
1. One small task at a time: implement → verify (real code + gates: `npm test`,
   `npm run typecheck`, `npm run build`, and CI for Android) → commit + push with
   `git --git-dir=/tmp/phonedek.git` (the NTFS workspace cannot host `.git`) → update
   `.agent/STATE.md`/`.agent/PLAN.md`.
2. Pick the next item from `.agent/PLAN.md` immediately; there is always work.
3. Never end a turn without the wake-up timer (unless `.agent/STOP` exists).
4. If blocked: record it in STATE.md, mark it, and move to the next task instead
   of spinning on the blocker.
5. Prefer `subagent` for isolated work (different files); never let two agents
   edit the same files concurrently.
6. Keep STATE.md current — after a long run the context is compacted, and the
   next wake-up must be able to resume from STATE.md alone.

Stopping autopilot: the user creates `.agent/STOP` (or says "stop"). When
`.agent/STOP` exists, do not schedule more timers; finish the current task
cleanly, update STATE.md, and end the turn. Delete `.agent/STOP` (and keep
`.agent/AUTOPILOT`) to resume.
