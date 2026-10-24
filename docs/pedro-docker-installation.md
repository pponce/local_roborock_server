# Pedro's Docker installation and first robot test

Updated October 24, 2026 (UTC). Public notes are permitted; personal executable
helpers, templates and their tests are local-only under the ignored
`local-work/setup/` directory. Preserve them before pulling the repository cleanup.

This is the staged installation for Pedro's `SCHEDULE_SUPPORT` branch. It is
not an upstream installation guide. Schedule hardware validation is pending.

Current checkpoint: Docker startup behind Nginx completed October 24 around
00:30 UTC. The container is healthy, HTTPS returned 200, and MQTT TLS verified.
Cloud import also completed and both robot names appear. Stages 1–2 below
describe the completed setup. Continue with Stage 3's post-import runtime backup,
schedule-count check and map/Homebridge records; onboarding remains pending.
The local-only `backup-after-cloud-import.py` helper is prepared but has not yet
been reported as run. See the recovery plan for the initial backup and log paths.

## Stage 1: Docker, source checkout, and image

Run `local-work/setup/scripts/install-pedro-docker.sh` with Bash as `pedro`, not as root. It
requests sudo only for host packages, Docker, and creating the runtime folder.
It follows Docker's [Ubuntu apt repository installation](https://docs.docker.com/engine/install/ubuntu/),
using `UBUNTU_CODENAME` on Ubuntu-based Linux Mint. Docker does not officially
support Mint itself. The script checks the Ubuntu base and supports amd64/arm64.

The script:

1. Installs Docker Engine, Buildx, and Compose, or verifies an existing working
   installation. Conflicting or incomplete installations stop for inspection;
   packages are not automatically uninstalled. Docker commands use sudo.
2. Prepares `/home/pedro/devProjects/local_roborock_server/` on
   `SCHEDULE_SUPPORT`. It preserves local changes and divergent commits by
   stopping rather than resetting or stashing them.
3. Builds `local/roborock-server:schedule-<commit>` from an archive of the
   committed tree. Secrets, backups, and uncommitted files are excluded.
4. Creates `/opt/local_roborock_server/` with an image-only `compose.yaml`,
   optional `compose.turn.yaml`, `SOURCE_COMMIT`, `data/`, and `secrets/`.
   Existing different files are not overwritten. There is no source bind mount.
5. Creates Git-ignored `backups/` and `local-work/` within the development
   checkout. Installation logs stay in `local-work/`; temporary build files
   are removed on exit. The script does not capture robot backups.
6. Checks Docker, the schedule-engine import, and Compose syntax, then prints
   host IPv4 addresses and listeners relevant to the next stage.

The first build needs internet access and can take several minutes. Docker
stores its own images/containers separately; the report prints its data root.
The server is **not running yet**, and no robot pairing or Homebridge settings
are changed. This is a first-install script, not the deployment update process.

After completion, retain the setup log and report the `READY FOR CONFIGURATION`
section, including certificate metadata. Do not paste API tokens, passwords,
private keys, or configuration secrets.

Pedro selected his existing `onefallday.com` domain and certificate workflow in
[`pponce/ddns-dnsexit-custom`](https://github.com/pponce/ddns-dnsexit-custom).
Use **`api-roborock.onefallday.com`** for the initial server; the project needs
the `api-` prefix even though the requested friendly name was
`roborock.onefallday.com`. Its certificate script requests the apex and
`*.onefallday.com`, which covers this one-level subdomain. The deployment hook
copies files to:

- `/home/pedro/dynamicDnsScript/certs/onefallday.com-fullchain.pem`
- `/home/pedro/dynamicDnsScript/certs/onefallday.com-privkey.pem`

The setup report reads only public certificate metadata at the expected path
(or the Certbot `live/` path). It never prints the key. The checked-in request
script uses Certbot without `--server`, so Let's Encrypt is likely unless
host-local Certbot settings override it. Confirm the **actual** issuer and
validity from the report. S7 compatibility remains uncertain if it is Let's
Encrypt. The existing DDNS/certificate scripts and their other services are
not modified by this installation.

## Stage 2: DNS, certificates, and server configuration

**Selected approach: Nginx owns HTTPS and MQTT TLS.** Pedro wants certificates
visible in his existing Nginx setup and updated through his existing deployment
hook. Follow [the Nginx deployment plan](pedro-nginx-deployment.md) and run
`local-work/setup/scripts/configure-pedro-nginx-docker.sh` after configuring the Nginx listeners.
The helper verifies both forwarding paths before writing the runtime configuration
and starting the server. Use that helper for this Nginx deployment.

Prerequisites for the selected proxy setup:

- Reserve the Linux host's LAN address in UniFi.
- Use `api-roborock.onefallday.com`. Local DNS
  must resolve it to the Linux host from the IoT VLAN, phone, and onboarding
  computer. Public inbound port forwarding is not needed for LAN operation.
- Choose the ports after checking the Stage 1 listener report. Nginx clients
  will use TCP 443 and 8881, with loopback backends on 555 and 18881. The original
  Stage 1 Compose file defaults to TCP 555 and 8881, with embedded Mosquitto internal.
  If changing ports, match `config.toml` and the runtime `.env` variables
  `ROBOROCK_SERVER_HTTPS_PORT` / `ROBOROCK_SERVER_MQTT_TLS_PORT`.
  `ROBOROCK_SERVER_BIND_IP` can restrict publishing to the host's LAN address.
- Choose a certificate chain suitable for both models. The upstream
  [compatibility table](tested_vacuums.md) reports S7 working with Actalis and
  SSL.com, and failure with Let's Encrypt; S7 MaxV has working ZeroSSL and
  Let's Encrypt reports. Actalis compatibility on this S7 MaxV is not yet
  established. Do not assume an existing Let's Encrypt setup covers both.
- Use the existing certificate workflow. Nginx will reference the existing
  `/etc/nginx/ssl/onefallday/` certificate files, which the deployment hook
  already updates before reloading Nginx. Verify the live paths/hook first.
  The selected `external_tls` mode needs no certificate copy or DNSExit API
  credentials inside Docker.
- Plan the camera hostname before pairing Uptown. The firmware-specific input
  must fit the [camera guide's](camera.md) 15-character rule, including a port
  and trailing slash. A hostname adequate for schedules can be too long for
  camera setup; default port 555 also counts if included in that input.
  `roborock.onefallday.com/` is already 24 characters, so it cannot fit the
  observed `token.r` camera bootstrap rule. This hostname is for the initial
  schedule test. S7 MaxV camera bootstrap behavior must be inspected before
  choosing an alternate camera endpoint or re-pairing for video.
- Allow the robot-to-server HTTPS/MQTT connections through UniFi's IoT-zone
  rules, and access from the phone/onboarding computer. Docker-published ports
  can bypass host UFW rules; use deliberate interface and network restrictions.

### Recorded host and UniFi settings (October 23, 2026)

Stage 1 completed on `192.168.84.2` with image
`local/roborock-server:schedule-7e07021b6f51`. Nginx already owns port 443;
the prepared direct-TLS Compose file uses TCP 555 and 8881. The selected Nginx
plan changes the client HTTPS port to 443 and keeps its backends on loopback.
The host's DNS and default gateway
are `192.168.84.1`. The local A record for `api-roborock.onefallday.com`
has been verified from the Linux host. Reserve its DHCP address in UniFi.
Use only the A record until IPv6 publishing and connectivity have been tested.

The existing Internal-to-IoT policy allows connections, while IoT-to-Internal
allows replies. Add an exception for **new** connections from
`192.168.69.140` and `192.168.69.178` in IoT to `192.168.84.2` in Internal,
IPv4 TCP destination ports **443 and 8881**, source port any (the earlier
direct-TLS plan used 555 instead of 443). Put it above the
inter-zone block. Replies are already permitted by Internal-to-IoT. Check DNS
access to the gateway and test from the IoT network before pairing; the host's
DNS result alone does not verify the robot's network access.

The actual certificate is Let's Encrypt YR2, covers `onefallday.com` and
`*.onefallday.com`, and expires January 21, 2027. It can serve the dashboard
now. S7 trust compatibility is still unresolved; a successful browser or
Linux TLS test does not establish that Downtown will trust this chain.

## Stage 3: Backups and cloud import

Complete startup and confirm the dashboard is reachable before onboarding.
Keep both robots on cloud while recording their current configuration.

1. In the Roborock app, record firmware, all maps/floors, room names, no-go zones,
   schedules and their enabled states, room order, suction, mop/water settings,
   and routines. Use the app's map-backup option if available. Save downloadable
   exports, screenshots and the Homebridge schedule capture under the checkout's
   ignored `backups/<timestamp>/downtown/` and `uptown/` directories.
2. App-native map backups may stay on the robot/cloud. A screenshot or raw map
   download is a record, not a verified restorable map backup. The cloud import
   below does not download a restorable map image or recreate native robot timers.
3. Back up Homebridge through its UI and store the downloaded backup under the
   same dated backup directory. Preserve Matter/HomeKit pairing state.
4. Open `https://api-roborock.onefallday.com/admin`. In cloud import, enter the
   existing Roborock cloud email, select **Send code**, enter the emailed code,
   and select **Fetch data**. This code is different from the local six-digit PIN.
5. The import fetches device/home/room records, scenes/routines, device details,
   and device schedule jobs. It writes the working inventory and a full cloud
   snapshot under `/opt/local_roborock_server/data/runtime/` as
   `web_api_inventory.json` and `web_api_inventory_full_snapshot.json`.
   These files contain private data and stay off GitHub.
6. Verify both robot names and each schedule's time, days, timezone and settings.
   Import is not proof that native timer IDs, maps or room IDs survived onboarding.
   Re-importing later replaces local schedule definitions; back up edits first.
7. Stop the Compose service, archive the complete `/opt/local_roborock_server/`
   runtime into the dated `backups/<timestamp>/server/` folder, record its Docker
   image ID, then start it again. This provides a consistent pre-pairing copy.

## Stage 4: Onboard one robot, then the second

The current Homebridge platform instance has one server URL for all devices.
Pedro agreed to test one robot on the local server first, leaving Homebridge on
cloud temporarily; the moved robot will not have a functioning cloud connection
in that instance. Once both robots work locally, switch Homebridge once. Do not
create duplicate bridge instances or remove/re-pair Matter accessories by default.

Pedro explicitly selected **Downtown S7 first**, using the current Let's Encrypt
chain, to check whether the reported S7 failure reproduces on his firmware.
Complete startup, cloud import and backups before its Wi-Fi reset. Retain server
and Nginx diagnostics during onboarding so a TLS trust rejection can be separated
from DNS, firewall, proxy or key-recovery failures. A successful browser/host TLS
test is not a robot trust test. Leave Uptown S7 MaxV and Homebridge on cloud during
this first trial; reconsider the certificate only if the actual failure supports it.

Use a second computer with Wi-Fi while the Linux server stays connected to the
LAN. Use the project's [onboarding guide](onboarding.md), selecting the imported
robot and the **explicit endpoint `api-roborock.onefallday.com:443`**. The CLI
otherwise defaults to 555. Set `America/Los_Angeles`, use the IoT 2.4 GHz Wi-Fi,
and perform a **Wi-Fi reset only**, not a factory reset. Follow the guided AP
connection/reconnection and key-recovery steps; multiple cycles can be required.
A phone running LocalRock is another documented onboarding option.

The admin dashboard checks service/onboarding health; it is not a full robot
control app. Use a local client such as LocalRock (or a prepared diagnostic
client) for control tests while Homebridge remains on cloud. After the first
robot connects, check status, map/room access, ordinary start/dock,
and native timer entries against the captured jobs. Then test one recurring
schedule, correct rooms/settings and disabled state. Repeat for the second robot
before moving Homebridge. Do not assume maps or native timers survived solely
because the cloud inventory imported successfully.

## Stage 5: Switch Homebridge 3.40.0 once

Verified against Pedro's `SCHEDULE_PROTOCOL_CAPTURE` branch on October 24:
`package.json` reports 3.40.0 and the branch retains pause/delay and capture settings.
Its [settings UI](https://github.com/pponce/homebridge-roborock-matter-plus/blob/SCHEDULE_PROTOCOL_CAPTURE/homebridge-ui/public/index.js)
and [schema](https://github.com/pponce/homebridge-roborock-matter-plus/blob/SCHEDULE_PROTOCOL_CAPTURE/config.schema.json)
support the following flow:

1. Preserve the Homebridge backup and finish/cancel any active pause or delay so
   the saved original schedule state is not left pending across the transition.
2. In this plugin's settings, log out of its saved cloud login to unlock Region.
   This clears the plugin login, not the Roborock account or app session.
3. Select **Custom server** in Region and enter
   `https://api-roborock.onefallday.com` in **Custom Server URL** (`serverURL`).
   Do not append `/admin` or use backend port 555. The local login response
   supplies the MQTT endpoint; there is no separate MQTT port to enter here.
4. Enter the local protocol-login email and use the chosen six-digit local PIN
   in the verification-code login field. Do not use the dashboard password or
   request a new cloud email code for this local login.
5. Save and restart the Roborock child bridge. Keep existing pairing/state and
   schedule/pause/delay settings. Confirm both robots, room IDs and schedules,
   then test a toggle, delay and cancel/restore round trip.

The plugin routes all devices in this instance through its selected server.
Switching Region back later does not move a robot: returning a robot to cloud
requires cloud onboarding again. The real Roborock account is not deleted.

Official-app redirection and Uptown video are later tasks; see
[mobile app options](roborock_app.md) and [camera notes](camera.md). The current
long hostname is for initial schedule tests; S7 MaxV camera bootstrap remains
unvalidated. Hardware schedule results are still pending.
