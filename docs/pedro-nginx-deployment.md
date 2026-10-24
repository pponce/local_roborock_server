# Pedro's Nginx deployment plan

Updated October 24, 2026 (UTC). Public notes are permitted; personal executable
helpers, templates and their tests are local-only under the ignored
`local-work/setup/` directory. Preserve them before pulling the repository cleanup.

Selected October 23, 2026, before the Roborock service's first startup. Pedro
prefers to see and manage certificate bindings in Nginx. Docker and the schedule
image are installed; the vacuums and Homebridge remain on Roborock cloud.

## Certificate ownership and renewal

The existing [certificate deployment hook](https://github.com/pponce/ddns-dnsexit-custom/blob/main/deploy-hook.sh)
copies renewed `onefallday.com` certificate files to:

- `/etc/nginx/ssl/onefallday/fullchain.pem`
- `/etc/nginx/ssl/onefallday/privkey.pem`

It then reloads Nginx. Both Roborock Nginx listeners use these paths.
The host's deploy-hook SHA256, reported October 23, matches the repository:
`157f51a63ae5c2b48676c31a57e3222d746343388771a518343472e72741a965`.
Successful renewals/deployments through that hook update the certificates used
for new HTTPS and MQTT TLS connections.
Existing MQTT connections may continue through a graceful Nginx reload.
This does not establish whether certificate renewal is scheduled on the host.

The Roborock container will use `network.listener_mode = "external_tls"` and
`tls.mode = "provided"`, with no private key or certificate copy inside the
container. See [reverse proxy support](reverse_proxy.md). TLS termination does
not change the certificate issuer: Downtown S7's reported Let's Encrypt trust
issue still needs validation before pairing.

## Selected endpoint mapping

| Connection | Client endpoint on 192.168.84.2 | Host-only Docker backend |
| --- | --- | --- |
| HTTPS API/dashboard | `api-roborock.onefallday.com:443`, Nginx HTTPS virtual host | `127.0.0.1:555`, plain HTTP |
| MQTT TLS | `api-roborock.onefallday.com:8881`, Nginx TCP stream with TLS | `127.0.0.1:18881`, plain MQTT |

The MQTT stream must forward to the server's MQTT proxy, not directly to its
embedded Mosquitto broker. The application backend listeners will be 555 and
18881, while advertised client ports will be 443 and 8881. Compose publishes
the backend ports only on loopback and uses an HTTP health check.

Keep the A record `api-roborock.onefallday.com -> 192.168.84.2`. IPv4 DNS was
verified through gateway `192.168.84.1`. IPv6 remains deferred. Change the
Roborock IoT-to-Internal exception to TCP destination ports **443 and 8881**
for the two robot IPs (`192.168.69.140`, `192.168.69.178`). Port 555 is a
host-only backend in this plan. Internal-to-IoT already permits replies.

The dashboard URL becomes `https://api-roborock.onefallday.com/admin`.
Restrict this virtual host to the intended LAN clients; a local DNS record
alone does not prevent access through an existing public Nginx port forward.
The MQTT listener should likewise be LAN-restricted. Retain other Nginx sites.

## Nginx configuration

The personal configuration files belong locally at:

- `local-work/setup/deploy/pedro/nginx/roborock-http.conf`:
  replaces the existing Roborock HTTP site, preserving its certificate paths
  and LAN allowlist. It uses `http://127.0.0.1:555`, preserves the original Host
  and Origin, and removes garage-specific header rewriting and upstream TLS.
- `local-work/setup/deploy/pedro/nginx/roborock-mqtt.conf`:
  a server block for an existing top-level `stream {}` context. It listens on
  `192.168.84.2:8881` with the same certificates and forwards to the server's
  plaintext MQTT proxy on `127.0.0.1:18881`.

These are separate include contexts. The MQTT file belongs in the top-level
stream context, outside the HTTP context. Its enabled-directory include was
created through the Nginx UI self-check repair.

If `stream {}` already exists, add the include/server there rather than
creating another stream block. Pedro's inspection confirmed the stream module
is loaded, this top-level include is active, and the deployed files are
`/etc/nginx/sites-enabled/api-roborock.onefallday.com` and
`/etc/nginx/streams-enabled/roborock-mqtt.conf`. Nginx syntax validation passed,
with listeners on 443 and `192.168.84.2:8881`; backend ports 555/18881 were free.
Pedro explicitly does not want a backup for adding Nginx stream support.
Run `sudo nginx -t` before applying later Nginx configuration changes.

The container is configured and healthy as of October 24 around 00:30 UTC.
The dashboard returned 200 through Nginx and MQTT TLS verified on 8881. A 502
now warrants checking backend health; it is no longer the expected initial state.
Backend ports and `external_tls` mode must match this plan.

Run this as Pedro:

```bash
{
  bash /home/pedro/devProjects/local_roborock_server/local-work/setup/scripts/inspect-pedro-nginx.sh
}
```

It checks Nginx syntax, build/modules, selected structural directives, public
certificate metadata, the deploy-hook checksum, and port listeners. It never
prints private-key contents or the full configuration, creates no output files,
and changes no services. Return the `START COPY HERE` / `END COPY HERE` section.

## First Docker startup

Completed October 24 around 00:30 UTC. Both live forwarding paths and frontend
certificates passed, with measured proxy address `172.18.0.1`. The initial
credential prompt stalled in the SSH/logging path; a local launcher adjustment
using direct terminal input/output and unbuffered Python resolved it. The second
SSH session completed with status 0 and the detached server is healthy.

The first-start helper is retained locally for reference. Do not rerun it now;
use the deployed Compose service for normal operations. Neither robot has been
moved and cloud import/backups still need completion. The old interrupted SSH
session can be closed without stopping the running server.

The helper reuses the image recorded in `/opt/local_roborock_server/SOURCE_COMMIT`
(currently `local/roborock-server:schedule-7e07021b6f51`). Pulling deployment
scripts does not require rebuilding this image. It:

1. Validates the existing runtime Compose file, requiring loopback-only backend
   bindings and the expected image, network, mounts and HTTP health check.
2. Starts a temporary, credential-free backend on the project's actual Docker
   network. Requests through Nginx 443 and 8881 verify the TLS certificate,
   forwarding ports, HTTP headers and proxy source address seen inside Docker.
   The MQTT stream carries a disposable HTTP probe during this check; the real
   MQTT service replaces it immediately afterward. No robot is contacted.
3. Removes that probe while retaining the project network. The measured bridge
   address becomes the sole `network.trusted_proxies` entry. A different route
   or address stops setup for review; it never trusts entire private networks.
4. Prompts for a new local dashboard password, login email and six-digit local
   app/plugin PIN. These are user-chosen local credentials. The email may be the
   existing Roborock email; this does not change the cloud account or password.
   Cloud import later uses a separate verification code emailed by Roborock.
5. Creates `config.toml` and `.env` under `/opt/local_roborock_server`, with
   external TLS, Pacific time, internal ports 555/18881, advertised ports
   443/8881, and no certificate material. Matching credentials are preserved
   on a retry; conflicting files are not overwritten.
6. Saves the initial runtime configuration under the development checkout's
   `backups/<timestamp>/server/`, starts the service and verifies health and
   HTTPS/MQTT TLS. Logs remain under `local-work/`; temporary probe files are
   removed. Nginx configuration and certificate files are not changed.

Open `https://api-roborock.onefallday.com/admin` and use the local dashboard
password. Return the helper's `START COPY HERE` / `END COPY HERE` report.
The helper is for first startup and preserves any existing server container.
If it reports a failure after startup, inspect that container rather than
rerunning the installer or removing persistent data.

Remaining before robot migration: test access from the IoT network, capture
available maps and schedule records under this checkout's `backups/`, import
cloud data, and then pair one vacuum. Host certificate checks do not establish
certificate trust on either robot. Schedule hardware testing remains pending.

The prepared direct-TLS helper (`configure-pedro-docker.sh`) remains an
alternative and is not used for this selected Nginx deployment.
