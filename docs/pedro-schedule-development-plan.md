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
- Installed image: `local/roborock-server:schedule-ui`, built from
  `a5a46600845f4b137e14e334ef733341b61e63e6` on `SCHEDULE_SUPPORT_UI_TEST`.
  Pedro reported `LOCAL UI UPDATE COMPLETE`, container healthy, and exit status 0
  on October 23 Pacific time (October 24 UTC). The runtime's `SOURCE_COMMIT`
  records this build; pulling newer repository notes alone does not change it.
- Host: `192.168.84.2`; gateway/DNS: `192.168.84.1`. The local A record for
  `api-roborock.onefallday.com` resolves correctly from the Linux host.
- Nginx stream support is installed/loaded; Nginx UI's self-check fixes created
  its stream directories/include. Nginx syntax passes and it listens on 443 and
  `192.168.84.2:8881`. Docker now publishes backends only on
  `127.0.0.1:555` and `127.0.0.1:18881`.
- Both Nginx listeners use `/etc/nginx/ssl/onefallday/fullchain.pem` and
  `/etc/nginx/ssl/onefallday/privkey.pem`. The certificate deploy hook matches the
  reviewed repository script; successful deployments update these and reload Nginx.
- Startup succeeded October 24, 2026 around 00:30 UTC after the local terminal
  fix. The server container `roborock-local-server` is healthy; HTTPS `/admin`
  returned 200 and MQTT TLS on 8881 verified successfully using TLS 1.3.
  The measured/trusted Docker proxy is `172.18.0.1`.
- Local dashboard credentials and protocol-login email/PIN were chosen at hidden
  prompts. Do not collect or publish the password, PIN or configuration contents.
- The first credential container stalled at its hidden input prompt. Routing the
  interactive Docker command directly to the SSH terminal and using unbuffered
  Python resolved it. The retry completed in the second SSH session with status 0.
  The original SSH session can be interrupted/closed; it belongs to the removed
  temporary helper, not the detached running server. Do not rerun first-start setup.
- Initial runtime backup (before server startup, not a robot/cloud-data backup):
  `/home/pedro/devProjects/local_roborock_server/backups/2026-10-24-003047-tHRMr16Q/server/runtime-before-first-start.tar.gz`.
  The sibling `downtown/` and `uptown/` directories are ready for exports.
- Successful setup log:
  `/home/pedro/devProjects/local_roborock_server/local-work/configure-nginx-20261024T003002Z-aX8vfh5A.log`.
- Cloud import succeeded: Pedro reports that both robot names appear in the
  dashboard. The post-import backup also completed successfully. The original
  stalled SSH terminal was closed after the successful startup in the second.
- Verified backup: `/home/pedro/devProjects/local_roborock_server/backups/2026-10-24-004831-import-8qenpeim/`.
  Archive integrity and container health passed; command status was 0.
  Downtown Rock (`roborock.vacuum.a15`, firmware `02.16.12`) has 7 imported jobs,
  all enabled. Uptown Rock (`roborock.vacuum.a27`, firmware `02.59.36`) has 8,
  all enabled. These counts do not establish native-timer/map preservation.
  The image ID was `sha256:f8279329e1f61ab28663c13f67b3a8c1f8dd5ec86a563fdfcbb96ee2ae8b28ca`.
- The private backup helper remains at `local-work/setup/scripts/backup-after-cloud-import.py`.
  It saves a consistent runtime archive and restores the same container/network.
- Dashboard redesign is separate: `ADMIN_DASHBOARD_REFRESH` starts at upstream
  `d40d67d`, with draft [fork PR #1](https://github.com/pponce/local_roborock_server/pull/1)
  against `UPSTREAM_ADMIN_BASE`. The integration cannot open PRs in the upstream
  repository (HTTP 403). Pedro will handle upstream PR submission/updates after
  schedule support works; do not submit either feature upstream yet.
  The full Python suite, wheel resource check and 11 Chromium checks passed.
  This UI-only PR does not include schedules or personal setup files.
- Pedro wants the new UI on this Docker installation before proceeding with
  Downtown's certificate test. `SCHEDULE_SUPPORT_UI_TEST` now combines both
  features at `a5a46600845f4b137e14e334ef733341b61e63e6`, preserving the independent
  review branches. The full Python suites on 3.11/3.13, wheel asset check and
  11 Chromium checks passed on the combined commit. The Docker image also built
  successfully and passed its schedule-module import check
  ([schedule/Docker run](https://github.com/pponce/local_roborock_server/actions/runs/40048914576),
  [dashboard run](https://github.com/pponce/local_roborock_server/actions/runs/40048914525)).
  The private `local-work/setup/scripts/update-local-dashboard.sh` helper builds
  that pinned commit as `local/roborock-server:schedule-ui`, validates that only
  the Compose image changes, verifies the packaged assets, and recreates only
  the server container. It keeps the network, imported data, config, and Nginx
  certificate paths. Do not publish the helper or run the first-start installer.
  Pedro explicitly waived an additional backup/rollback image for this UI change.
  Deployment is confirmed: the local helper completed with status 0 and the
  container is healthy. Existing data/configuration were retained, Nginx stayed
  unchanged, and no robot pairing or Homebridge changes were performed.
- Pedro selected his MacBook Pro, then offered to use LocalRock if easier.
  The next instructions use LocalRock's phone onboarding for Downtown; the Mac
  GUI remains a diagnostic fallback. LocalRock's current source was checked:
  normal login uses the HTTPS server root plus local email/six-digit PIN;
  Add vacuum separately uses the dashboard admin password to load imported
  devices and start a session for the selected existing device ID. Select
  Downtown Rock, enter the IoT 2.4 GHz SSID/password and `America/Los_Angeles`.
  App URL: `https://api-roborock.onefallday.com` (no `/admin`, default port 443).
  Independently allow Downtown's IoT traffic to `192.168.84.2` TCP 443/8881.
  The old AAAA record's removal has not been confirmed; use IPv4-only DNS for
  this first test because MQTT TLS currently binds only to `192.168.84.2`.
  Pedro has installed LocalRock on his iPhone and successfully logged in.
  Add Vacuum / Load vacuums shows Downtown. He confirmed the firewall allowance
  for Downtown (IoT `192.168.69.140`) to server (Internal `192.168.84.2`), TCP
  destination ports 443/8881, including new connections. The first iOS attempt
  could not join the robot hotspot. The retry sent Wi-Fi credentials and showed
  `Pairing completed`, but the overall button kept spinning; server status was
  `samples=0`, `public key pending (missing)`, `waiting`. This does not confirm
  completed server onboarding. UniFi now shows Downtown connected to its IoT
  network at the unchanged address `192.168.69.140`.
  Leave Uptown and Homebridge on cloud while Downtown's current
  Let's Encrypt chain is tested. On iOS, keep the phone on its normal home Wi-Fi
  initially: Start pairing contacts the server before asking iOS to join the
  robot hotspot. Reset only the robot's Wi-Fi, then let LocalRock request the
  hotspot switch. Return the phone to normal Wi-Fi after credentials are sent.
- A private Mac setup helper was prepared but has not been delivered/run. If
  needed later, it uses local Terminal outside SSH and keeps the three pinned
  onboarding files plus uv/Python/cache under
  `~/devProjects/local_roborock_server/local-work/onboarding/`, with `launch.command`.
  The Mac GUI uses `api-roborock.onefallday.com:443`, the dashboard password,
  timezone `America/Los_Angeles`, country `us`, and no camera domain for S7.
- On October 23, 2026 at 18:49:58 Pacific, the read-only TLS report showed global
  Nginx protocols TLS 1.0/1.1/1.2/1.3, with both Roborock HTTPS and MQTT listeners
  explicitly configured for TLS 1.2/1.3. No matching Downtown errors appeared in
  the excerpts, and no Downtown TCP connection was present at that instant.
  Report folder: `local-work/downtown-tls-xPbLuLUY`. This does not establish
  whether DNS, routing, TLS version/ciphers or certificate trust is the cause.
  Nginx's default error level can omit handshake failures.
- Pedro wants to keep his current Let's Encrypt wildcard certificate. TLS
  versions/ciphers are independent of certificate trust; changing protocol
  settings cannot repair an untrusted CA chain. No TLS/cipher/certificate
  changes have been made during this diagnostic step. The bundled MQTT TLS
  server permits older protocols with `DEFAULT:@SECLEVEL=0`; that differs from
  the current Nginx stream configuration but is not proof of the S7's failure.
- The private `local-work/setup/scripts/downtown-nginx-debug.py` helper was run.
  Pedro returned its stop report: Nginx syntax passed, extra logging was disabled,
  certificates/TLS settings were unchanged, and zero Downtown connection IDs or
  matching TLS/connection messages were observed. The private capture folder is
  `local-work/downtown-debug/`. This is not evidence of a certificate rejection.
  The helper
  enables `debug_connection 192.168.69.140` using the installed `--with-debug`
  Nginx, adds a private log under `local-work/downtown-debug/`, and validates
  before reloading. Its `stop` mode removes only its marked directives and
  prints a filtered connection/TLS report. Raw logs stay local. Syntax,
  configuration restoration after failed validation, preservation of later
  unrelated edits, and report filtering were checked in an isolated fixture.
  Do not infer a certificate failure from the spinning LocalRock button or an
  empty connection snapshot. LocalRock's current sanitizer was checked: it strips
  `api-` for token.r and preserves an explicit port, with no inserted `:555`.
- Pedro ran the three-minute host packet check starting October 23, 2026 at
  19:09:24 Pacific. Linux resolved the hostname only to IPv4 `192.168.84.2`.
  The previous private Nginx capture contained two raw lines and no mention of
  Downtown's IPv4. Active configuration listed only
  `error_log /var/log/nginx/error.log;`.
  Packet capture on `enp170s0` with `host 192.168.69.140 and tcp` observed only:
  at 19:11:33, `192.168.84.2:40102 -> 192.168.69.140:58867`, then the reverse,
  each with zero TCP payload. There were no packets involving this IPv4 filter
  on server ports 443 or 8881, and zero kernel packet drops.
  Report: `local-work/downtown-network-jmWRLUn0/report.txt`.
  Do not infer who initiated or why those two packets occurred from tcpdump
  quick output (TCP flags were not printed). The capture does not show the
  robot's DNS queries to its gateway, IPv6 attempts, traffic to other hosts,
  or connections whose source was rewritten by NAT.
- Next check: inspect the IoT network's DHCP DNS server setting in UniFi;
  successful Linux DNS resolution does not establish what the robot receives.
  Also inspect Insights > Flows, if available, filtered to Downtown around
  19:09-19:13 Pacific for destination addresses/ports, allowed/blocked status,
  and matching policies. Confirm new IoT-to-Internal TCP connections from
  Downtown to the server's destination ports 443/8881 are allowed; successful
  replies to server-initiated traffic do not establish that permission.
  No further Wi-Fi reset, DNS, certificate, firewall or Nginx change has been
  requested by these read-only checks.
- Pedro's requested fallback if the next attempt remains unsuccessful: retain
  Let's Encrypt for all other Nginx sites and for Uptown S7 MaxV; obtain a separate
  Actalis or SSL.com certificate for `api-roborock.onefallday.com` for Downtown
  S7. No certificate has been ordered, issued or installed for this fallback,
  and no renewal or Nginx settings have been changed.
  A single-hostname/single-container design is feasible using Nginx maps from
  client source address to certificate/key paths in both HTTP and stream TLS.
  Nginx 1.24 supports variable certificate paths. Before configuring it, confirm
  the original source IP reaches Nginx, reserve the robot addresses, handle or
  defer IPv6, and check SNI/default-server selection on shared HTTPS 443.
  If S7 does not select the intended HTTPS virtual host, a dedicated Roborock
  LAN listener address is a fallback that avoids changing certificates for
  unrelated websites. The server's app/client login responses use the configured
  API/MQTT hostname, while the bootstrap region handler can reflect the incoming
  Host header. A two-hostname alternative would therefore need end-to-end
  validation; the proposed source-IP mapping retains the existing hostname.
- Actalis is a reasonable first certificate fallback: its current free plan
  provides single-domain 90-day DV certificates with unlimited ACME issuance;
  SSL.com also supports automated ACME issuance/renewal. The upstream tested
  vacuum table reports S7 working with Actalis and SSL.com (S7 firmware omitted),
  and S7 MaxV `a27/02.59.36` working with Let's Encrypt. These reports do not
  guarantee compatibility with every new issuer chain or prove our current
  failure is certificate-related.
  Sources: [Actalis plans](https://www.actalis.com/subscription),
  [Actalis ACME](https://guide.actalis.com/ssl/activation/acme),
  [SSL.com ACME](https://www.ssl.com/products/website-security/acme/),
  [tested vacuums](https://python-roborock.github.io/local_roborock_server/tested_vacuums/).
- Reviewed the current public `pponce/ddns-dnsexit-custom` scripts for renewal
  feasibility. They use Certbot with DNSExit auth/cleanup hooks and a deploy
  hook mapping three known certificate names to Nginx directories. The new
  Roborock certificate needs its own CA/account configuration and certificate
  lineage, provider-specific filenames in Pedro's existing certificate directories,
  and subdomain-aware DNS validation:
  zone `onefallday.com`, record `_acme-challenge.api-roborock`. The existing
  auth hook treats CERTBOT_DOMAIN as the zone and uses a bare
  `_acme-challenge` relative name, so simply appending the subdomain to the
  current request loop is insufficient. Use due-only automated renewal,
  certificate/key/chain validation, Nginx configuration validation and graceful
  reload, plus expiry/failure monitoring. Personal changes stay local; do not
  publish installers, certificate files, credentials or host-specific hooks.
- Live certificate-renewal inspection reported October 23 Pacific time:
  all four scripts under `/home/pedro/dynamicDnsScript` exactly match the
  reviewed repository versions. The live `requestCert.sh` has `renew_mode=0`,
  which selects `--force-renewal`. Root cron runs it at `0 3 * * *` (03:00 in
  the server/cron timezone); no matching certificate timer names were found.
  This establishes forced renewal attempts, not that every attempt succeeded.
  Pedro explicitly pointed out that changing the existing variable to
  `renew_mode=1` selects `--keep-until-expiring`; retain this mechanism.
  The live cleanup hook also has the missing comma after the TXT record name.
  Inspection report: `local-work/cert-renewal-E8HlN9Mj.log`.
- Pedro has activated Actalis's free plan and has its EAB Key ID and HMAC Key.
  Their values were not supplied in chat. Use hidden terminal input on his
  Linux machine; never put them in notes, GitHub, command arguments, or shared logs.
  Official Certbot ACME endpoint:
  `https://acme-api.actalis.com/acme/directory`.
  Request only `api-roborock.onefallday.com`, with certificate lineage
  `api-roborock.onefallday.com-actalis` and RSA 2048.
- Pedro's latest storage preference is to keep the new certificate copies
  alongside the existing ones, with the hostname and provider in the filenames:
  `api-roborock.onefallday.com-actalis-fullchain.pem` and
  `api-roborock.onefallday.com-actalis-privkey.pem`, in both
  `/home/pedro/dynamicDnsScript/certs/` and `/etc/nginx/ssl/onefallday/`.
  Do not replace the existing generic Let's Encrypt files or use the previously
  suggested separate Nginx directory. Actalis's private Certbot state goes
  under `certs/actalis/`, isolated from the existing Let's Encrypt account.
- A local-only setup block has been prepared for Pedro to run over SSH.
  It installs `/home/pedro/dynamicDnsScript/local-roborock-cert/actalis.py`
  and `dns-hook.sh`, excludes that folder using the certificate checkout's
  local Git exclude file, patches the known request script to mode 1,
  fixes the cleanup JSON comma, and appends the Actalis check to the existing
  daily entrypoint. It does not add another cron job or change Nginx certificate
  selection. Changed-script backups stay under the Roborock checkout's
  `backups/`, with setup files/logs under its `local-work/`.
  DNS validation is scoped to the dedicated Roborock TXT name; cleanup is
  skipped if another value is observed. Certificate/chain/key checks precede
  provider-specific deployment. A failed reload is retried on a later check.
  Eleven offline checks passed, including actual OpenSSL key validation,
  installation idempotence, unknown-edit refusal, DNS/API failures,
  preservation of Let's Encrypt files, and reload retry without forced issuance.
  These tests do not establish successful live issuance or robot compatibility.
  Installation/issuance is still awaiting Pedro's run and result.
  After installation, rerun locally with
  `sudo python3 /home/pedro/dynamicDnsScript/local-roborock-cert/actalis.py setup`.
- Many-year publicly trusted leaf certificates are not available under current
  CA/Browser Forum limits: maximum 200 days for issuance from March 15, 2026,
  100 days from March 15, 2027, and 47 days from March 15, 2029.
  A multi-year purchase does not remove periodic replacement. A long-lived
  private/self-signed certificate does not give stock firmware a trusted issuer.
  [Current requirements, section 6.3.2](https://cabforum.org/working-groups/server/baseline-requirements/requirements/#632-certificate-operational-periods-and-key-pair-usage-periods).
  If the packet capture shows no traffic reaching the host, DNS/routing/firewall
  diagnosis is still needed before a different certificate can help.
- Available map records, a Homebridge backup and Homebridge endpoint changes
  have not yet been reported. Downtown's Wi-Fi provisioning has been attempted.
  Host/app TLS success does not
  establish S7 certificate trust. The IoT firewall allowance is user-confirmed;
  successful robot-to-server traffic is still to be observed during pairing.
- Personal files were restored under ignored `local-work/setup/`; the local
  checkout reached `08ef5ca`. Helper path and empty-IPAM fixes passed seven host
  probe tests. The full Python suite had passed on 3.11/3.13 and the Docker image
  built. Later notes-only commits do not change the deployed image.

## Next steps

1. The combined schedule/UI image is installed and healthy. Continue with
   Downtown's connection/TLS diagnostics; Wi-Fi provisioning succeeded but
   server onboarding still lacks a public key and connection confirmation.
   Keep the existing certificates for this next observed attempt. Do not rerun the image
   updater, first-start helper or cloud import merely to continue.
   Disconnected robots are expected until onboarding; imported names do not
   prove robot connectivity. The post-import runtime backup is already verified.
2. Finish/cancel any active Homebridge pause/delay and restore the intended normal
   schedule settings before taking the migration snapshot.
3. While both robots are still on cloud, record available maps, floors, no-go zones,
   schedules, rooms and settings under the dated `backups/` directory. Also save
   the Homebridge backup there. App-native map backups can remain robot/cloud-side;
   screenshots and raw map captures are not verified restorable map backups.
4. Keep a current Homebridge schedule capture while both robots remain on cloud,
   so imported jobs can be compared with robot-native timer references and states.
   Counting imported jobs alone does not verify those timer records. Cloud import
   does not create a restorable map backup.
5. Verify IoT DNS plus TCP 443/8881 access before resetting Downtown's Wi-Fi.
   Use LocalRock on a phone: log in with the local email/PIN, then Add vacuum,
   dashboard admin password, Load vacuums, and select imported Downtown Rock.
   The Linux server stays connected to its LAN. Follow the app's Wi-Fi reset and
   hotspot/reconnect flow. If diagnostics are insufficient, use the Mac GUI.
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
