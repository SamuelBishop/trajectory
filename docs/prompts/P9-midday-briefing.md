# P9 — Midday briefing with a macOS notification

**Status: shipped.**

Trajectory only ever spoke when spoken to. All four adapters — GitHub, Notion,
Strava, Google Sheets — are live and syncing, so the app holds enough context to
say something useful without being asked. Nothing ever asked it.

P9 adds a once-daily briefing. At a configured local time (default 12:00) it
syncs the integrations, asks the mentor whether the user is on track and what to
prioritise, stores the answer encrypted, and posts a macOS notification carrying
a one-line headline.

This is the first thing in the product that **initiates**. Everything before it
was pull-only. That changes what the failure modes cost: an unhelpful chat reply
is ignored, an unhelpful notification is an interruption, and an indiscreet one
is a disclosure to whoever is looking at the lock screen.

It ticks two existing `FUTURE_ITERATIONS.md` items rather than inventing scope:
a minimal midday check-in, and letting midday guidance choose continue, redirect,
reduce scope, take a break, or deliberately abandon.

## The three decisions that shaped it

**1. The notification carries a mentor-written headline, not generic text.**

The alternative — "Your midday check-in is ready" — is ignored within a week,
which makes the whole feature pointless. So the headline is real. The cost is
real too, and the author accepted it knowingly: notification text is handed to
macOS, can appear on the lock screen, and may mirror to a paired iPhone via
Continuity.

**The headline is a schema field, not a truncation.** Slicing the first hundred
characters off the body would put whatever happened to be there onto a lock
screen. Instead the model returns a dedicated `headline`, written knowing where
it appears, and `BRIEFING_SYSTEM_PROMPT` names what it may not contain: health
condition, diagnosis, symptom, relationship detail, financial figure, employer,
project code name. The detail stays in `body`, behind the window.

A settings toggle falls back to the generic line, so the headline is opt-out
without disabling the feature.

**2. Missed briefings run late on the same local day only.**

A 16:00 briefing is still useful. Yesterday's at 09:00 is noise. Both halves fall
out of the same rule, which is why `decideBriefing` needs no special case for
either: tomorrow is a different local date *and* the clock is back before the due
time.

**3. A dedicated pane, not a chat message.**

Drift across days is the signal — three days of "partly on track" about the same
goal — and it is invisible when each day is a separate conversation.

## What it is made of

| Piece | File | Why it is separate |
| --- | --- | --- |
| Schemas | `engine/domain.ts` | `briefingSchema` caps `headline` at 120 and `priorities` at 3 |
| Prompt | `engine/prompting.ts` | `briefing_v1`; shares `ACTIVITY_RULES` with chat and decision so they cannot drift |
| Orchestration | `engine/mentorship.ts` | `dailyBriefing()` — top 5 active goals, no question to select against |
| Provider method | `providers/{types,deterministic,openai,copilot}.ts` | `[HC-PROVIDER-PARITY]` |
| Schedule | `engine/briefing-schedule.ts` | Pure `decideBriefing`, no timers |
| Notification text | `engine/notification-text.ts` | The one place text leaves for the OS |
| Store | `main/briefing-store.ts` | Encrypted per-day, refuses plaintext |
| Service | `main/briefing-service.ts` | Sync → compose → store → notify |
| Home screen | `renderer/src/today/` | Assessment, evidence, sources, history, "Run now" |

### Why a third provider method rather than a flag

The system prompt is chosen *inside* each provider based on which method is
called. A new capability is therefore a new interface method, not a parameter —
and `providers.instructions.md` says so: adding a third method means updating
`deterministic.ts`, `openai.ts`, and `copilot.ts` in the same change, which the
interface makes a compile error.

The cheaper route — an optional `headline` on `ChatResponse` — is closed by
`[HC-STRICT-SCHEMA-REQUIRED]`. OpenAI strict mode rejects optional properties, so
the only way to add it would be forcing a headline onto every ordinary chat
reply.

The briefing carries `goal_ids` / `principle_ids` / `source_ids` / `activity_ids`
and goes through the same attribution validation as chat. An unattributed
briefing is the product failing at its main claim, and a briefing nobody asked
for is exactly where an invented citation would go unnoticed.

### Why a poll rather than a timer

`decideBriefing({ now, dueMinute, lastRunDate, enabled })` returns
`{ run, reason }`, mirroring `decideSync`. A loop calls it every 60 seconds.

Arming `setTimeout(noon - now)` is wrong in three ordinary situations: the laptop
sleeps through noon, the user crosses a timezone, or the clock is corrected. A
poll that asks "is it past due, and have I run today?" is correct through all
three and costs nothing. `lastRunDate` is a **local** calendar date — this
repository has shipped a UTC/local off-by-one four times.

### Sync first, and name what is stale

The briefing syncs before composing, finally giving the long-declared
`SyncTrigger` case `"timer"` a producer. Best effort: if Strava fails the
briefing still runs, but records which sources are stale, tells the model, and
shows it in the pane. A confident "you haven't trained this week" that really
means "Strava failed to sync" is worse than no briefing at all.

### Silence on failure

No provider error and no `InsufficientContextError` ever becomes a notification.
The failure is recorded and visible in the pane. A daily notification that says
"briefing failed" is how a feature gets muted.

A failed attempt still counts as the day's run, so an outage does not make the
sixty-second poll retry until midnight.

## Verification

591 tests green. The guarantees worth stating are the ones that were
mutation-tested — each mutation below was applied, the suite run, and the
mutation reverted:

| Mutation | Result |
| --- | --- |
| Skip briefing attribution validation | caught |
| Remove the headline length cap | caught |
| Remove the priority cap | caught |
| Brief on paused and completed goals | caught |
| Drop stale sources from the request | caught |
| Send `CHAT_SYSTEM_PROMPT` instead of the briefing prompt (both hosted providers) | caught |
| Notify with the body instead of the headline | caught |
| Notify on failure | caught |
| Ignore the headline opt-out | caught |
| Keep newlines in the notification body | caught |
| Remove the notification length cap | caught |
| Allow two concurrent runs | caught |
| Skip the sync | caught |
| Ignore the schedule decision | caught |
| Read the clock as UTC | caught |
| Write the store without the encryption guard | caught |
| Read the store without the encryption guard | caught |
| Append instead of replacing a day | caught |
| Never prune past retention | caught |
| Typo either IPC channel name | caught |

**What verification cannot prove:** that a notification actually appeared. In
`npm run dev` the alert is attributed to "Electron" rather than Trajectory, and
macOS Focus or Do Not Disturb suppresses it entirely without telling the app.
Confirming the real thing needs `npm run package` and a look at the screen. This
gap is written into `coverage-gaps.md` rather than papered over.

## Live fire

The unit tests prove the parts. This proves the assembled feature runs
unattended against the real four adapters and the real provider.

Method: set `briefingMinute` to one minute in the past in the real settings
file, start `npm run dev`, and then touch nothing. The 60-second poll has to
decide on its own that the briefing is due. Temporary instrumentation logged the
*shape* of the result — never its content, so no briefing text was written to a
terminal log — and was removed before the final verification run.

Four runs, each with the store moved aside first so the file could only be
written by that run:

| Run | Result | Store | Evidence |
| --- | --- | --- | --- |
| 1 | success | 4621 B | no error logged |
| 2 | success | 5197 B | no error logged |
| 3 | **failure** | 397 B | `Briefing failed: Copilot SDK request failed` |
| 4 | success | 4729 B | probe line below |

```
[probe] briefing ok {"trigger":"scheduled","headlineChars":76,"priorities":3,
 "onTrack":"partly","goalIds":4,"principleIds":2,"sourceIds":2,
 "activityIds":4,"staleSources":0,"notified":true,"includeHeadline":true}
```

Reading that line: `trigger: scheduled` means the poll fired it rather than a
human pressing "Run now". `staleSources: 0` means all four integrations synced
before composing. `activityIds: 4` means the briefing cited observed activity,
which is the entire point of the feature. `goalIds`, `principleIds` and
`sourceIds` are all non-zero, so the same bidirectional attribution validation
that governs chat passed here too. `headlineChars: 76` is inside the 110-char
notification cap. `notified: true` means the `Notification` was constructed and
`show()` returned without the OS refusing it.

Run 3 is the most useful row in the table. It was a transient provider error,
and it is what makes the other three rows mean anything: it proves main-process
`console.error` reaches the captured log, so the *absence* of an error line in
runs 1, 2 and 4 is evidence rather than silence. It also exercised the failure
path for free — the failure was recorded (397 bytes, a stored message rather
than a briefing), no notification was posted, and the app carried on.

Still not proven: that the alert was visible on screen. The app window sat on a
Space the screenshot tool cannot reach, and `notified: true` only reports that
macOS accepted the call, not that anything was drawn. `npm run package` remains
the honest way to confirm that.

## Left undone

- **The canon does not yet say anything about handing private content to the
  OS.** `[HC-NO-EXFILTRATION]` governs network egress, so this is not a breach of
  it — but it is adjacent enough that the canon should probably say so out loud.
  That is a separate proposal for the author, deliberately not slipped into this
  diff (`[HC-PROPOSE-NEVER-COMMIT]`).
- Windows and Linux notifications are untested. The code guards on
  `Notification.isSupported()` and stores the briefing either way, so the failure
  mode is a missing alert rather than a crash.
- No weekly or evening variant. `FUTURE_ITERATIONS.md` still carries both.
