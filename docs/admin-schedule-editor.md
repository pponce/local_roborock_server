# Dashboard schedule editor (first hardware-test version)

Open **Schedules** in the standalone `/admin` dashboard and choose a vacuum.
The list includes imported native jobs, including jobs that a client's legacy
`get_timer` screen does not show. No cloud re-import or new pairing is needed.

The editor shows each stored job's time expression, timezone, next calculated
run, server enablement, native timer reference, and map/room/cleaning settings.
Next-run times are displayed in the job's timezone. A next-run time describes
when the server will evaluate a job; it is not confirmation that the robot can
or will clean.

## First-version scope

- Edit an existing recurring job's time, weekdays, timezone, and server dispatch
  permission. Advanced expressions can be retained or edited as five-field cron.
- Preserve the job ID, native timer link, complete cleaning payload, unknown
  model fields, recurrence flag, and occurrence claims.
- Keep unsaved edits when the dashboard refreshes. Reject stale updates after
  another client changes or deletes a job; the user can discard and reload.
- Show one-time jobs read-only. Creating/deleting jobs, changing cleaning
  settings, and writing robot-native timers are outside this first editor.

**Enable schedule** controls only the stored job's
`enabled` flag. A native job also requires its robot-side timer to be on. This
editor does not query or modify that timer and labels its state **Not checked**.
Do not interpret an enabled server job as proof that a native timer survived
onboarding. The scheduler still performs its existing native timer preflight.

Homebridge pause/delay policy remains in Homebridge. This dashboard is an admin
adapter over the existing schedule store, not a second scheduling engine. The
editor changes can be reviewed separately from schedule execution and from the
earlier dashboard styling change. A test build may combine these features.

## Hardware test sequence

1. Verify the active robot map and room selection before testing a clean. Check
   the imported job count, timezone, room IDs, map reference and timer reference.
2. Choose one existing recurring schedule. Record its original time and days.
   Set a test time several minutes ahead, including the current weekday, and
   confirm the saved read-back and next run. Avoid another schedule's due time.
3. Observe the actual robot, the native timer-read/start replies and cleaning
   history. A job-task acceptance or calculated next run is not proof of a clean.
   Normal dispatch can occur up to 60 seconds after the scheduled minute.
4. Test a later occurrence with server permission off; it should not start.
   Re-enable for a future time and verify exactly one intended clean. This tests
   the server gate, not native-timer off/on semantics.
5. Restore the original time/days and permission. Validate native off/on,
   room-specific settings, offline/restart behavior and Homebridge pause/delay
   separately as described in [schedule support](schedules.md).

## Admin API and validation

`GET /admin/api/schedules` returns an allowlisted view grouped by vacuum.
`PATCH /admin/api/schedules/{duid}/{job_id}` accepts `revision` and one or more of
`cron`, `timeZoneId`, `enabled`. Both require the existing admin session. Writes
require JSON and reject cross-origin browser requests. The revision is checked
again against the expected job under the schedule store's inventory lock.

No new runtime dependency or database format is introduced. Python tests cover
authentication, field privacy, preservation, stale/racing updates, validation,
one-time jobs and persistence errors. Browser tests cover the native listing,
form persistence, conflict recovery, advanced expressions, mobile layout and
text escaping. Hardware scheduled execution remains pending until observed.
