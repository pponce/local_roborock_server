# Pedro's schedule development and deployment plan

Recorded: 2026-10-23. This is a working plan for the
[pponce fork](https://github.com/pponce/local_roborock_server), not the general
installation guide or a claim that schedule support is complete.

## Recovery checkpoint — October 24, 2026 (UTC)

Read this section first when resuming in a new chat.

- Public notes/plans are explicitly permitted. Application code and tests on
  `SCHEDULE_SUPPORT` are for schedule support and potential upstream PRs.
- Personal installers, Nginx templates and tests of those installers must stay
  under the Git-ignored `local-work/setup/` directory. Do not upload them again.
- Provide terminal commands in one Bash `{ ... }` block, suitable for SSH, with
  functions and `return` for failures rather than exiting the interactive shell.
- Development checkout: `/home/pedro/devProjects/local_roborock_server`.
  Runtime: `/opt/local_roborock_server`. Docker data: `/var/lib/docker`.
  All backups stay under the checkout's ignored `backups/` directory.
- Installed image: `local/roborock-server:schedule-7e07021b6f51`, built from
  `7e07021b6f51fc773e7e08166e8cc5220826025c`. Pulling newer notes/scripts does not
  change that image; the runtime's `SOURCE_COMMIT` records the build.
- Host: `192.168.84.2`; gateway/DNS: `192.168.84.1`. The local A record for
  `api-roborock.onefallday.com` resolves correctly from the Linux host.
- Nginx stream support is installed/loaded; Nginx UI's self-check fixes created
  its stream directories/include. Nginx syntax passes and it listens on 443 and
  `192.168.84.2:8881`. Backends 555 and 18881 were free at the last inspection.
- Both Nginx listeners use `/etc/nginx/ssl/onefallday/fullchain.pem` and
  `/etc/nginx/ssl/onefallday/privkey.pem`. The certificate deploy hook matches the
  reviewed repository script; successful deployments update these and reload Nginx.
- First startup attempt: checkout advanced to `08ef5ca` and personal helpers
  were restored under ignored `local-work/setup/`. Seven local probe checks
  passed. Live HTTPS/MQTT forwarding and both frontend certificates passed;
  the measured Docker gateway is `172.18.0.1`.
- The temporary route probe was removed. The separate credential container
  reached "Choose LOCAL credentials" but the SSH session showed no prompt;
  its Python process remained waiting after five minutes. Terminal/output
  handling is suspected. A local launcher adjustment gives credential setup
  direct terminal input/output and unbuffered Python; retry is pending.
- Last confirmed state: the actual server has not started. No robot backups,
  cloud import, re-pairing or Homebridge endpoint changes have occurred.
- The full Python suite passed on 3.11/3.13 and the Docker image built. A personal
  installer smoke test found overly strict handling of empty Compose IPAM
  defaults. A correction and regression test are prepared locally; successful
  Docker startup of that corrected installer has not yet been reported.

## Next steps

1. Completed: personal setup files were preserved under `local-work/setup/`
   before the cleanup pull. Previous public versions remain in Git history.
2. Completed: helper paths and the empty-IPAM correction were applied locally.
   Personal files were last published in `8215eaf657a1ac3100fe8f8a3e79b58dc42380db`.
   Subsequent fixes, including terminal handling, remain local-only.
3. Stop only the stalled credential setup container, apply the local terminal
   adjustment, then retry the startup helper using the existing image. It verifies
   both proxy routes and the actual Docker gateway, then creates external-TLS
   configuration with loopback-only backends on 555/18881 and public ports 443/8881.
4. Choose a local dashboard password and six-digit app/plugin PIN at hidden
   prompts. The usual email is acceptable. These do not change the cloud account;
   cloud import later uses a separate emailed Roborock verification code.
5. Verify the dashboard and IoT access. Record/export available maps, schedules,
   rooms and settings under `backups/` before moving a vacuum. Import cloud data,
   then onboard one robot and test schedules before adding the second.
6. The current Homebridge instance uses one server for all devices. Pedro agreed
   to validate one robot locally first (temporarily losing its cloud connection
   in Homebridge), move the second, then switch Homebridge once. The capture
   branch is verified as 3.40.0 with `serverURL` and pause/delay support. Use
   Region **Custom server**, URL `https://api-roborock.onefallday.com`, and the
   local email/PIN after logging out of the plugin cloud session. Preserve
   existing accessory identities and pause/delay policy.
7. Pedro explicitly chose Downtown S7 as the first robot, using the existing
   Let's Encrypt certificate to test whether the reported failures reproduce.
   Start/import/back up first, then onboard only Downtown and retain server/Nginx
   diagnostics. Do not switch issuer based on other reports alone. Uptown and
   Homebridge stay on cloud during this initial test. Cloud import includes jobs,
   rooms and routines but is not a restorable map backup.

For a new chat, retrieve this note from GitHub and ask for recent local output.
Do not assume access to files on Pedro's host. The machine's local setup files
remain authoritative; preparing a script does not mean it was run.

The capture branch in use is `SCHEDULE_PROTOCOL_CAPTURE`. Captures verified
schedule toggles/time edits, native timer linkage and cleaning settings. Downtown
missed its 14:09 run while offline and did not replay after reconnecting around
14:10–14:11 (still skipped at 14:17). The exact cloud start command was not captured.
Schedule code integrates the upstream proposal with native-timer preflight,
settings preservation, refusal handling, deduplication and timezone/DST tests.
Hardware schedule validation remains pending.

See the [Nginx deployment notes](https://github.com/pponce/local_roborock_server/blob/SCHEDULE_SUPPORT/docs/pedro-nginx-deployment.md),
[Docker notes](https://github.com/pponce/local_roborock_server/blob/SCHEDULE_SUPPORT/docs/pedro-docker-installation.md)
and [schedule test sequence](https://github.com/pponce/local_roborock_server/blob/SCHEDULE_SUPPORT/docs/schedules.md).

## Responsibilities

The local server should reproduce the Roborock schedule protocol and behavior:
schedule definitions, storage, reads and updates, enable/disable semantics,
time changes, and scheduled execution.

Homebridge keeps Pedro's schedule switches and pause/delay policy, including
restoring original times and states, daily reset, and recovery. Those features
should operate against the local server through the same compatible APIs.
Do not move pause/delay policy into this server.

## Agreed Linux layout

| Location | Purpose | When |
| --- | --- | --- |
| `/home/pedro/devProjects/local_roborock_server/` | Git checkout, feature branches, source, tests, and Docker build context | Prepare now |
| `/home/pedro/devProjects/local_roborock_server/backups/` | All backup files, exports, schedule captures, and migration records; private and Git-ignored | Before pairing or changing a deployment |
| `/home/pedro/devProjects/local_roborock_server/local-work/` | Private logs/working files; `setup/` holds personal scripts, templates and tests | During setup and maintenance |
| `/opt/local_roborock_server/` | Deployed service configuration and persistent application files | Create during later installation |
| `/opt/local_roborock_server/compose.yaml` | Launch the selected versioned Docker image | Later |
| `/opt/local_roborock_server/config.toml` | Server configuration; includes sensitive settings | Later |
| `/opt/local_roborock_server/secrets/` | Runtime secrets such as certificate-provider credentials, if used | Later |
| `/opt/local_roborock_server/data/` | Persistent server state, certificates, runtime files, and file-based application logs | Later |

The development checkout belongs to Pedro and is prepared without `sudo`.
Development tooling and an optional project virtual environment can live there.
The live service will not read source files from that checkout.

Docker Engine and the Compose plugin are host software. Docker manages images,
layers, containers, and its own logs in its engine storage, separately from the
two project folders. Keep the engine's default storage configuration and check
the actual locations during installation. The application bind mounts above
are the files we manage directly.

Homebridge remains in its existing installation.

For the first installation Pedro selected the existing `onefallday.com`
certificate workflow in `pponce/ddns-dnsexit-custom`. The server hostname is
`api-roborock.onefallday.com` (the protocol requires the `api-` prefix).
Use provided certificates and confirm the installed issuer, expiry, and SANs
before pairing; the S7 has reported Let's Encrypt incompatibility. The long
hostname also needs separate investigation for S7 MaxV camera bootstrap.

Pedro requested that backups stay together inside the development project.
Use `backups/YYYY-MM-DD-HHMMSS/` with `downtown/`, `uptown/`, and `server/`
subdirectories as applicable. Keep robot names, model/firmware, capture time,
and restoration notes with each set. Raw exports may contain credentials and
household activity; never commit them. The backup folders do not enter Docker
builds, which use an archive of the committed source tree.

App-native map backups may remain on the robot or in Roborock's service; they
cannot necessarily be exported to this directory. Save any available exports
and screenshots here, and distinguish visual records from verified restorable
map backups. No robot backup has been made by the setup script.

## Checkout preparation (completed)

Run the setup script as `pedro` in Bash. Its brace-grouped contents can also
be pasted directly into a terminal. It requires Git and access to GitHub.

The script:

1. Creates `/home/pedro/devProjects/` if needed.
2. Clones Pedro's fork into the exact development path, initially on `main`.
3. Reuses an existing checkout only when its origin points to the expected fork.
   Git refuses to clone over an unrelated nonempty directory.
4. Sets the fork fetch URL to HTTPS and its push URL to SSH, and adds the
   parent project as `upstream` if absent. An unexpected upstream stops setup.
5. Fetches both remotes and prints the current branch, working-tree status,
   remotes, and the setup result.

Expected remotes:

| Remote | URL |
| --- | --- |
| `origin` fetch | `https://github.com/pponce/local_roborock_server.git` |
| `origin` push | `git@github.com:pponce/local_roborock_server.git` |
| `upstream` | `https://github.com/Python-roborock/local_roborock_server.git` |

On reruns, the script preserves the current branch and working files. Fetching
updates remote-tracking refs; it does not pull, merge, or switch an existing
checkout. SSH authentication will be checked when a push is needed.

This step does not install Python dependencies, Docker, or the server; create
`/opt` files; restart Homebridge; or change a vacuum's pairing.

## Learn from cloud captures first

Follow the Homebridge
[capture guide](https://github.com/pponce/homebridge-roborock-matter-plus/blob/SCHEDULE_PROTOCOL_CAPTURE/docs/local-server-schedule-capture.md).

Enable **Capture schedule protocol for 30 minutes** in Advanced settings, save,
and restart the Roborock child bridge. General plugin debug logging and the
child bridge's `-D` option are not required. Confirm **Schedule capture started**
in the normal log and use **Download schedule capture** to collect the file.

For the first report, include the robot model, firmware if available, and the
action times with timezone. Start with a baseline, one schedule off/on round
trip, and a Homebridge delay/cancel round trip, allowing snapshots between
actions and restoring the original settings afterward. Later experiments can
cover app edits, room schedules, and a normally scheduled clean.

Review:

- Complete job and scene definitions, response envelopes, cron, timezone,
  room settings, and calculated next-run fields.
- Cloud job IDs versus robot timer IDs. The observed join is normally
  `param.params[].name`, not a direct equality of the two IDs.
- Cloud job `enabled` versus robot timer on/off state. Do not treat them as
  interchangeable without model-specific evidence.
- Legacy timer commands versus server-timer commands and their replies.
- The plugin's time-update request body, encoding, and resulting read-back.
- Enable/disable and restore behavior observed through Homebridge.

Capture observes Homebridge's own traffic and additional read snapshots.
It cannot reveal private app-to-cloud requests or cloud-to-robot commands that
Homebridge does not receive. Seeing a scheduled clean therefore does not prove
which exact command the cloud dispatched. Execution still needs local testing.

Keep capture files and credentials out of public Git. Even sanitized captures
can contain schedule times, room numbers, and activity. Only reviewed,
anonymized protocol fixtures should become tests.

## Review upstream before implementation

Review
[Python-roborock/local_roborock_server PR #179](https://github.com/Python-roborock/local_roborock_server/pull/179),
which proposes schedule storage, APIs, and execution. It was open and unmerged
when this plan was recorded; recheck its status and implementation before
starting our branch. Reuse or extend suitable upstream work after verifying it
against captures and hardware behavior.

Fetch both remotes and inspect their differences before choosing the code
baseline. Create a dedicated schedule implementation branch in the development
checkout once the evidence is reviewed. Preserve this fork's plan; do not reset
the fork to upstream.

Implementation and tests should cover:

- Compatible schedule listing, creation, updates, deletion, persistence,
  enable/disable behavior, and time edits.
- Correct relationships between jobs, scenes, and robot timers, including
  preservation of model-specific fields and supported command routing.
- Due-time calculation and dispatch using the required robot commands.
- Disabled schedules staying disabled, repeating and one-time schedules,
  timezone/DST behavior, restart recovery, offline robots, and avoiding
  duplicate or unintended catch-up execution.
- Whole-home and room-specific schedules where supported by captured models.
- Homebridge's pause/delay/restore behavior working through those APIs while
  all pause/delay policy remains in Homebridge.

Use the repository's pinned development tooling and run relevant automated
checks before building a candidate. Keep the tested model/firmware scope
explicit; one successful robot does not establish all-model compatibility.

## Build and install for local testing later

Build from a reviewed, tested commit in the development checkout and use a
unique image tag, for example `local-roborock-server:schedules-test-01`.
Record the source commit with each candidate and do not reuse its tag for
different code.

Create the deployment directory under `/opt/local_roborock_server/` during
the installation phase. Adapt the repository's Compose configuration there:
replace the source-build section with the selected `image:` tag and retain
the project's required ports and health check. Use these bind mounts:

| Host path | Container path | Access |
| --- | --- | --- |
| `/opt/local_roborock_server/config.toml` | `/app/config.toml` | Read only |
| `/opt/local_roborock_server/secrets/` | `/run/secrets` | Read only |
| `/opt/local_roborock_server/data/` | `/data` | Read/write |

Use this deployment Compose file for service operations. No second source
checkout is needed under `/opt`. Editing code or switching development
branches will affect the service only after a deliberate image rebuild and
redeployment. If the build and runtime hosts differ, transfer the exact tagged
image to the runtime host before deployment.

Follow the project's [installation guide](installation.md) to select the LAN
hostname/DNS, certificate path, ports, local credentials, and onboarding
machine. Arrange the configuration wizard's output into the deployment paths
and verify container paths and permissions before startup. Do not use an
unmodified development-tree `docker compose up` as the live deployment.

Before each change, back up the deployment configuration, secrets, and the
entire persistent `data/` directory using a consistent stopped-service backup.
Store that archive under the dated `backups/` directory above, including the
selected image ID, source commit, and Compose files in the restoration record.
Keep the previous image and matching data backup for rollback; an older image
alone may not understand data written by newer code.

Start with one robot. Verify Homebridge can authenticate against the local
server, list schedules, toggle them, change times through delay, restore them,
and observe execution at the correct time. Verify restart and disabled-state
behavior before expanding the test scope. Recheck the plugin's custom-server
configuration during installation; cloud capture does not prove local-server
compatibility.

Returning a robot to the official cloud is a separate onboarding operation,
generally involving a Wi-Fi reset and re-pairing. Stopping Docker alone is not
a cloud/local switch. Plan that test transition explicitly and do not assume
maps or schedules will be preserved across re-pairing.

## Upstream contribution

After local hardware testing, prepare a focused branch against the then-current
upstream base. Include compatible server changes, reviewed anonymized fixtures,
tests, and public documentation. Exclude this personal plan, Pedro-specific
setup scripts, credentials, runtime state, and raw captures from that PR.

Record tested commit/image tags, models, firmware versions, observed behavior,
and remaining limitations so reviewers can assess the actual evidence.
