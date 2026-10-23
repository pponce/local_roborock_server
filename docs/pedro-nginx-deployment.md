# Pedro's Nginx deployment plan

Selected October 23, 2026, before the Roborock service's first startup. Pedro
prefers to see and manage certificate bindings in Nginx. Docker and the schedule
image are installed; the vacuums and Homebridge remain on Roborock cloud.

## Certificate ownership and renewal

The existing [certificate deployment hook](https://github.com/pponce/ddns-dnsexit-custom/blob/main/deploy-hook.sh)
copies renewed `onefallday.com` certificate files to:

- `/etc/nginx/ssl/onefallday/fullchain.pem`
- `/etc/nginx/ssl/onefallday/privkey.pem`

It then reloads Nginx. Both Roborock Nginx listeners will use these paths.
Once the matching hook is confirmed on the host, successful renewals/deployments
will update the certificates used for new HTTPS and MQTT TLS connections.
Existing MQTT connections may continue through a graceful Nginx reload.
This does not establish whether certificate renewal is scheduled on the host.

The Roborock container will use `network.listener_mode = "external_tls"` and
`tls.mode = "provided"`, with no private key or certificate copy inside the
container. See [reverse proxy support](reverse_proxy.md). TLS termination does
not change the certificate issuer: Downtown S7's reported Let's Encrypt trust
issue still needs validation before pairing.

## Proposed endpoint mapping

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

## Inspect before installing Nginx configuration

The prepared configuration files are:

- [`deploy/pedro/nginx/roborock-http.conf`](../deploy/pedro/nginx/roborock-http.conf):
  replaces the existing Roborock HTTP site, preserving its certificate paths
  and LAN allowlist. It uses `http://127.0.0.1:555`, preserves the original Host
  and Origin, and removes garage-specific header rewriting and upstream TLS.
- [`deploy/pedro/nginx/roborock-mqtt.conf`](../deploy/pedro/nginx/roborock-mqtt.conf):
  a server block for an existing top-level `stream {}` context. It listens on
  `192.168.84.2:8881` with the same certificates and forwards to the server's
  plaintext MQTT proxy on `127.0.0.1:18881`.

These are separate include contexts. Do not paste MQTT configuration into an
HTTP site editor. An example main-config integration, **outside `http {}`**, is:

```nginx
stream {
    include /etc/nginx/streams-enabled/*.conf;
}
```

If `stream {}` already exists, add the include/server there rather than
creating another stream block. The live module and include layout still need
inspection before choosing the final installation path. The source checkout
holds templates; Nginx's deployed configuration should use files under `/etc/nginx`.
Back up existing Nginx configuration under the project's `backups/` folder,
then run `sudo nginx -t` before reloading. No Nginx validation was run against
Pedro's host by preparing these templates.

The container is not configured or started yet, so a 502 from the new HTTP
proxy is expected until its backend is running. Backend ports and
`external_tls` mode must match this plan; the direct-TLS helper cannot be used
to start this proxy arrangement.

Run this as Pedro:

```bash
bash /home/pedro/devProjects/local_roborock_server/scripts/inspect-pedro-nginx.sh
```

It checks Nginx syntax, build/modules, selected structural directives, public
certificate metadata, the deploy-hook checksum, and port listeners. It never
prints private-key contents or the full configuration, creates no output files,
and changes no services. Return the `START COPY HERE` / `END COPY HERE` section.

The host-specific installation still needs:

1. Confirm the stream TLS module is available/loaded and locate the active
   HTTP and top-level stream includes. MQTT TLS requires the stream module;
   adding an HTTP proxy host alone is insufficient.
2. Match the active certificate paths to the renewal deployment hook.
3. Prepare an HTTPS virtual host and an MQTT stream using those same paths,
   with appropriate LAN access. Preserve HTTP Host and forwarding headers.
4. Determine the Docker bridge gateway that Nginx connections appear to come
   from and add that specific proxy address to `network.trusted_proxies`.
   Do not trust all private-address ranges. Verify both HTTP and MQTT proxy
   handling before onboarding.
5. Back up runtime and relevant Nginx configuration under the development
   checkout's `backups/<timestamp>/server/` before installing changes. Keep
   working files/logs under `local-work/`; the deployed runtime stays in `/opt`.
6. Validate Nginx configuration before reload; verify local backend health,
   public HTTPS/MQTT certificate handshakes, and access from the IoT network.
   Then capture robot backups and import cloud data before pairing one robot.

The prepared direct-TLS helper (`configure-pedro-docker.sh`) remains an
alternative and is not used for this selected Nginx deployment.
