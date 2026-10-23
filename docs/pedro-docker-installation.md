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

Resolve these before running the configuration wizard:

- Reserve the Linux host's LAN address in UniFi.
- Use `api-roborock.onefallday.com`. Local DNS
  must resolve it to the Linux host from the IoT VLAN, phone, and onboarding
  computer. Public inbound port forwarding is not needed for LAN operation.
- Choose the ports after checking the Stage 1 listener report. The prepared
  Compose file defaults to TCP 555 and 8881, with embedded Mosquitto internal.
  If changing ports, match `config.toml` and the runtime `.env` variables
  `ROBOROCK_SERVER_HTTPS_PORT` / `ROBOROCK_SERVER_MQTT_TLS_PORT`.
  `ROBOROCK_SERVER_BIND_IP` can restrict publishing to the host's LAN address.
- Choose a certificate chain suitable for both models. The upstream
  [compatibility table](tested_vacuums.md) reports S7 working with Actalis and
  SSL.com, and failure with Let's Encrypt; S7 MaxV has working ZeroSSL and
  Let's Encrypt reports. Actalis compatibility on this S7 MaxV is not yet
  established. Do not assume an existing Let's Encrypt setup covers both.
- Use the existing certificate workflow and select **provided certificates**,
  answering **no** to Cloudflare in the wizard. DNSExit handles the existing
  certificate workflow; the server does not need its API credentials. Arrange
  a copy/deploy step into this server's certificate directory, and a server
  restart after renewal so its TLS listeners load the renewed certificate.
  Verify the existing deploy hook and renewal mechanism before adding that
  step; a one-time copy alone is not ongoing renewal integration. See
  [custom certificate management](custom_cert_management.md).
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

Once those choices are settled, the built image can run the wizard without
installing Python dependencies on the Linux host. Run this from an interactive
terminal as `pedro`:

```bash
{
  roborock_configure_local_server() {
    local runtime_dir="/opt/local_roborock_server"
    local image_name
    image_name=$(sudo docker compose --project-directory "$runtime_dir" \
      -f "$runtime_dir/compose.yaml" config --images) || return 1
    sudo docker run --rm -it --pull=never \
      --user "$(id -u):$(id -g)" \
      --mount "type=bind,source=$runtime_dir,target=/work" \
      --workdir /work "$image_name" \
      sh -c 'umask 077; exec python -m roborock_local_server.configure --config /work/config.toml'
  }
  if roborock_configure_local_server; then
    printf 'Configuration written. Review DNS, TLS, ports, and timezone before startup.\n'
  else
    printf 'Configuration incomplete; review the error above.\n'
  fi
  unset -f roborock_configure_local_server
}
```

Use the embedded broker and answer **no** to Cloudflare. Choose a new local admin password and local protocol
login PIN. Cloud import later uses the actual Roborock account verification
code. Set `timezone = "America/Los_Angeles"` in the `[network]` section; the
wizard otherwise leaves the US default timezone. Match the hostname, ports,
and certificate choice established above. Do not use `--force` on an existing
configuration without a backup.

For supplied certificates, put `fullchain.pem` and `privkey.pem` in
`/opt/local_roborock_server/data/certs/`, matching the container paths generated
by the wizard. Keep private keys private. TURN remains disabled for the initial
schedule test. When ready, start from the runtime directory:

```bash
sudo docker compose --project-directory /opt/local_roborock_server \
  -f /opt/local_roborock_server/compose.yaml up -d --no-build --pull never
```

Check `docker compose ps` and server logs with the same project-directory/file
arguments. Open `https://<selected-host>:<selected-port>/admin` and log in with
the local admin password. A container health check alone does not validate the
certificate chain the robots will trust.

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
