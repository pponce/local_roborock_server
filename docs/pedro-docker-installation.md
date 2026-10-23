# Pedro's Docker installation and first robot test

This is the staged installation for Pedro's `SCHEDULE_SUPPORT` branch. It is
not an upstream installation guide. Schedule hardware validation is pending.

## Stage 1: Docker, source checkout, and image

Run `scripts/install-pedro-docker.sh` with Bash as `pedro`, not as root. It
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
hook. Follow [the Nginx deployment plan](pedro-nginx-deployment.md) and its
read-only inspection first. The direct-TLS helper below is an alternative,
not the selected startup path; it copies certificates only once.

Prerequisites for the selected proxy setup or the direct-TLS alternative:

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
  credentials inside Docker. The direct-TLS alternative below instead copies
  certificates into the runtime and would need a separate renewal deploy step.
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

### Alternative: direct TLS in the existing image (not selected)

Update this branch with `git pull --ff-only origin SCHEDULE_SUPPORT` from a
clean `SCHEDULE_SUPPORT` checkout. Then run the new helper from an interactive
terminal as `pedro` (without sudo before bash):

```bash
bash /home/pedro/devProjects/local_roborock_server/scripts/configure-pedro-docker.sh
```

This first-start helper:

1. Checks host DNS, the IP address, available ports, and the existing image's
   source revision. It uses the runtime's `SOURCE_COMMIT`, so pulling these
   helper changes does **not** require rebuilding the already-installed image.
   Do not rerun the Stage 1 installer just to obtain this configuration helper.
2. Copies the existing certificate and key into runtime `data/certs/` with
   private permissions, verifies expiry/hostname and key matching, and leaves
   different existing destination files untouched for review.
3. Runs `scripts/pedro_runtime_config.py` inside the built image with networking
   disabled. It asks for a local admin password (twice), local login email,
   and six-digit local PIN (twice). Passwords/PINs are hashed in `config.toml`.
   The email may be the cloud-account email, but the PIN is chosen locally;
   no cloud verification email is sent by this step.
4. Sets the known hostname, ports, embedded broker, provided certificates,
   `America/Los_Angeles` timezone, and Compose publishing on `192.168.84.2`.
   An existing matching configuration is reused without changing credentials;
   different configuration is preserved and stops the helper.
5. Makes a private runtime archive under
   `backups/YYYY-MM-DD-HHMMSS-<unique>/server/` before first startup. This is a
   **server configuration backup**, not a robot/map/schedule backup. Its
   sibling `downtown/` and `uptown/` folders remain empty until exports occur.
6. Starts Compose using the existing image, waits for health, and verifies
   HTTPS and MQTT TLS certificates from the host. It prints a report between
   `START COPY HERE` and `END COPY HERE`. Setup logs stay in `local-work/`.

Open `https://api-roborock.onefallday.com:555/admin` and log in with the local
admin password. Neither vacuum is moved from cloud by running this helper.
Robot backups, cloud import, and pairing are subsequent steps. TURN is disabled.
Certificate copying is initial setup only: renewal/deploy-hook integration
still needs to be installed before leaving the server running long term.

The helper refuses to change an existing service container. If startup or
endpoint verification fails, the container may still be running; report the
error and inspect it before retrying. Do not delete runtime data to rerun setup.

## Stage 3: Backups, import, and one robot

Before resetting any robot's Wi-Fi:

1. Record firmware versions, maps, rooms, schedules, routine settings, and
   current enable/disable states while cloud access still works. Use available
   app map-backup features as well as exports and screenshots. A screenshot
   or raw map capture is not proven to be a restorable map backup.
2. Store every backup/export we create under
   `/home/pedro/devProjects/local_roborock_server/backups/YYYY-MM-DD-HHMMSS/`,
   grouped into `downtown/`, `uptown/`, and `server/` as needed. Keep schedule
   captures and restore notes here too. App-native map backups may remain in
   the robot/cloud and cannot necessarily be moved into this folder.
3. In the local dashboard, use cloud import: enter the existing Roborock email,
   send the verification code, and fetch the inventory and schedules. Review
   the imported jobs before any pairing. Re-importing later replaces local
   job definitions; back up local state first.
4. Make a consistent server backup after import: stop the Compose service,
   archive the whole runtime directory (including configuration, secrets,
   data, Compose files, and source commit) into that dated `server/` folder,
   then start the service again. Record the Docker image ID for restoration.

Start with **Downtown Rock (S7, 192.168.69.140)** after its certificate path is
ready. Keep **Uptown Rock (S7 MaxV, 192.168.69.178)** on cloud until the first
robot passes schedule tests. This does not imply one phone app session can
control both backends simultaneously.

Use a second computer that can join the robot's temporary Wi-Fi hotspot while
the Linux server stays on the LAN. Following [onboarding](onboarding.md), run
`start_onboarding.py` with the selected server hostname/port and
`--timezone America/Los_Angeles`. The second computer needs Python 3.11+ and
`uv`. Copy the onboarding scripts together or use a checkout on that computer.
Reset **Wi-Fi only**, select the correct imported robot, and follow the guided
pairing/reconnection steps. Some robots require more than one pairing cycle.

Verify status, map access, ordinary control, and then the recurring-schedule
sequence in [schedules.md](schedules.md). Homebridge must also be configured
for the local server's API and login; cloud capture mode alone does not switch
its backend. Keep pause/delay policy in Homebridge. Validate its configuration
before changing the live child bridge, especially while the other robot is
still on cloud.

The [official app redirection](roborock_app.md) and
[Uptown camera/video tests](camera.md) follow the basic server and schedule
tests. Returning to cloud requires restoring the app's cloud session and
re-pairing the robot through that app; stopping Docker does not switch it back.
