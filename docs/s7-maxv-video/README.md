# S7 MaxV video with the OEM Roborock app

Live video and the **Call** feature worked in the OEM Roborock app with an
S7 MaxV connected to `local_roborock_server`, using Actalis certificates,
Nginx, and the bundled coturn service. This guide records the configuration
and lessons from that successful test, using example names and addresses.

## Confirmed result and scope

| Item | Observed result |
| --- | --- |
| Robot | Roborock S7 MaxV, `roborock.vacuum.a27` |
| Firmware | `02.59.36` |
| Client | OEM Roborock app connected to the local server |
| Video | Live picture worked with the robot off its dock |
| Call | The app's Call feature worked |
| Certificates | Actalis certificates served by Nginx |
| Bootstrap | A real robot request reached the camera hostname at `/iot.roborock.com/fwapi/createca` and received the configured TURN endpoint |
| Server | Docker deployment, external TLS termination, provided coturn |

This confirms the app features in this configuration. The test did not force
TURN relay candidates, establish the actual media route, or verify operation
with all Internet access blocked. Remote driving was not tested. The exact app
version was not recorded. Other firmware and certificate chains need their own
tests.

The earlier [S7 MaxV report in PR #185](https://github.com/Python-roborock/local_roborock_server/pull/185)
established go2rtc video on the same model and firmware, using a different
certificate provider. The result above adds OEM-app video and Call with Actalis;
go2rtc was not needed for this test. That PR's proposed `--camera` option was
still unmerged when checked on 2026-10-25. This guide does not require it.

## Examples in this folder

| File | Purpose |
| --- | --- |
| [config.camera.example.toml](config.camera.example.toml) | Relevant network, TLS, and TURN settings; merge into the existing configuration |
| [compose.camera-turn.example.yaml](compose.camera-turn.example.yaml) | Adds the 21 UDP ports to an existing Compose service |
| [nginx-camera.example.conf](nginx-camera.example.conf) | New HTTPS site for camera bootstrap |
| [nginx-api.example.conf](nginx-api.example.conf) | API HTTPS reference for an external-TLS deployment |
| [nginx-mqtt.example.conf](nginx-mqtt.example.conf) | Existing MQTT TLS stream reference |
| [check-camera.py](check-camera.py) | Read-only DNS, TLS, and bootstrap checks without printing credentials |

The examples use `api-r.example.com` for the API, `r.example.com` for camera
bootstrap and TURN, and `10.0.20.10` for the server's fixed LAN address.
`10.0.20.0/24` and `10.0.30.0/24` represent viewer and robot networks.
**Replace all these examples with your own values.** `example.com` is a
documentation domain; you need a domain you control and valid certificates.

This is an extension to an already working local-server deployment. First
confirm ordinary controls work in the OEM app. Back up the active configuration
and preserve the existing image, data/secrets mounts, pairing, schedules,
Compose project, environment file, and proxy settings.

## 1. Choose a short camera hostname

For this S7 MaxV firmware, the relevant camera bootstrap input is `token.r`.
The firmware takes at most **15 characters** of the input and appends
`iot.roborock.com`. A trailing `/` makes that suffix part of the HTTP path
instead of part of the hostname. Count the actual advertised input, including
any explicit port and the trailing slash.

| Example bootstrap input | Characters | Result |
| --- | ---: | --- |
| `r.example.com/` | 14 | Fits; HTTPS uses port 443 by default |
| `r.example.com:443/` | 18 | Too long, despite referring to the same HTTPS port |
| `api-r.example.com/` | 18 | Too long for this firmware input |

The full browser URL `https://r.example.com/iot.roborock.com/fwapi/createca`
is expected to exceed 15 characters. The limit applies to the firmware's
bootstrap input, not that complete URL or the separate `turn:host:3478` value.

Some onboarding paths derive the camera hostname by removing an `api-` prefix.
Check what your onboarding client actually advertises; do not assume a valid
API hostname also produces a valid `token.r`. Keep the normal region settings.
Changing DNS, Nginx, or TURN configuration does not rewrite a value already
saved on the robot. A successful real robot request to the intended camera
hostname is evidence that this length/routing issue is not blocking that test;
a host-generated probe alone is not.

## 2. Configure DNS on the gateway

Reserve the server's LAN address, then add local DNS records or overrides on
the gateway/router used by the robot and viewer. For a UniFi gateway, use its
local DNS-record/override facility; menu names vary by Network version.

| Local DNS name | Address in this example |
| --- | --- |
| `api-r.example.com` | `10.0.20.10` |
| `r.example.com` | `10.0.20.10` |

Ensure DHCP supplies the intended DNS resolver on both networks. An entry in
the Linux host's `/etc/hosts` alone does not configure the robot, phone, or
container. Verify the camera name also resolves correctly inside Docker:
provided coturn resolves its advertised IPv4 address from `turn.host` at
startup. After correcting that DNS answer, recreate the service so coturn
resolves it again.

These LAN overrides are separate from certificate validation. ACME DNS-01
validation uses TXT records in the domain's **public authoritative DNS**;
adding only a gateway record does not prove domain ownership to Actalis.

## 3. Provide Actalis certificates for both names

The tested deployment used separate Actalis certificates for the API and
camera hostnames, managed on the host and presented by Nginx.

1. Use an Actalis ACME account and keep its EAB credentials private. Follow
   [Actalis's ACME instructions](https://guide.actalis.com/ssl/activation/acme).
2. Obtain certificates covering both hostnames. For a LAN-only service,
   Certbot with your DNS provider's DNS-01 plugin or automated DNS hooks can
   validate ownership without opening the application to the Internet. Use
   `certonly` if managing Nginx configuration yourself. See the
   [Certbot DNS plugin documentation](https://eff-certbot.readthedocs.io/en/stable/using.html#dns-plugins).
3. Install each certificate's full chain and matching private key at the paths
   used by Nginx. The example files use `/etc/nginx/ssl/roborock/`.
4. Arrange automatic renewal and a successful Nginx configuration check/reload
   after renewed files are installed. Keep private keys, EAB credentials, and
   DNS API credentials out of the repository and shared logs.

A suitable SAN certificate can cover both names. A wildcard such as
`*.example.com` covers both example hosts, while `*.r.example.com` does not
cover `r.example.com`. Verify the certificate actually served for each name;
having a certificate on disk is insufficient. A working API certificate may
cover only the API hostname. The server's built-in Actalis provisioning should
not be assumed to provision a separate camera alias.

The initial camera check in this test failed because Nginx served the API-only
certificate for the camera name. Adding a camera HTTPS site with its own
certificate fixed hostname verification. This is not evidence that every
Actalis chain works on every firmware, or that another CA cannot work.

## 4. Route camera HTTPS through Nginx

Use [nginx-camera.example.conf](nginx-camera.example.conf) as a separate site
included inside Nginx's `http` context. Substitute the camera hostname,
certificate paths, and allowed LAN/VLAN subnets, then enable the site according
to your Nginx installation.

For this example, Nginx runs on the Docker host and terminates HTTPS on 443.
It preserves the hostname and request path and forwards plain HTTP to
`127.0.0.1:555`. The backend uses `listener_mode = "external_tls"` and
`[tls] mode = "provided"`. If your proxy is containerized, adapt the upstream
to its private Docker network instead of using that loopback address.

**No new Nginx stream is needed for the camera.** The existing MQTT connection
still uses a TLS stream proxy. TURN uses direct Docker UDP publication and is
not supplied by an HTTPS proxy.

| Traffic | Client destination | Backend in this example |
| --- | --- | --- |
| API HTTPS | `api-r.example.com:443` TCP | Nginx to `127.0.0.1:555` HTTP |
| Camera bootstrap HTTPS | `r.example.com:443` TCP | Nginx to the same HTTP listener, preserving the full path |
| Existing MQTT TLS | `api-r.example.com:8881` TCP | Nginx stream to `127.0.0.1:18881` plain MQTT |
| TURN listener | `r.example.com:3478` UDP | Docker host port 3478 to container port 3478 |
| TURN relay ports | Server LAN IPv4, UDP 49160-49179 | Matching host/container UDP ports |

The API and MQTT files in this folder are references. Retain working sites and
streams. Keep plain HTTP/MQTT backend ports bound to loopback or an isolated
proxy network. For example, the relevant entries in an existing base Compose
file can be:

```yaml
services:
  roborock-local-server:
    ports:
      - "127.0.0.1:555:555/tcp"
      - "127.0.0.1:18881:18881/tcp"
```

This is a fragment of the base service, not an override to add alongside
unrestricted mappings. Preserve its other settings and set the external-TLS
healthcheck to HTTP (`ROBOROCK_SERVER_HEALTHCHECK_SCHEME=http` if using the
repository's parameterized healthcheck). With that base file, its MQTT port
variable must also match the configured backend listener, here
`ROBOROCK_SERVER_MQTT_TLS_PORT=18881`.

Keep `network.trusted_proxies` restricted to the actual proxy source addresses
seen by the container. A host Nginx connection commonly arrives through the
Docker bridge gateway; inspect your own network instead of copying an address.
See [reverse-proxy configuration](../reverse_proxy.md).

After installing the camera site, validate and reload Nginx:

```bash
{
    if sudo -v; then
        sudo -n nginx -t && sudo -n systemctl reload nginx
    fi
}
```

## 5. Enable provided TURN and publish its UDP ports

Merge the relevant settings from
[config.camera.example.toml](config.camera.example.toml) into the existing
`config.toml`. Update its existing `[turn]` table rather than appending a second
one. Use `mode = "provided"`, a reachable hostname, port 3478, a nonempty
username, and a long random password stored locally. The example password is
a placeholder and must be replaced. Keep the remote-view PIN separate from
these TURN credentials.

Copy [compose.camera-turn.example.yaml](compose.camera-turn.example.yaml) into
the **existing deployment directory** as `compose.camera-turn.yaml`, and
replace its example bind address. The overlay adds UDP 3478 plus every port
49160-49179 with matching host/container numbers. It preserves TCP mappings,
images, and mounts inherited from the base files. Do not enable this alongside
another overlay publishing the same TURN ports. The repository's standard
`compose.turn.yaml` is an alternative if its bind behavior suits your setup.

Retain the existing Compose project name, working directory, environment file,
and all existing `-f` files in their original order, adding the TURN overlay
last. This example must be adapted to those existing values. Omit `--env-file`
only if the deployment does not use one.

```bash
{
    if sudo -v; then
        camera_compose_cmd=(sudo -n docker compose
            --project-name YOUR_EXISTING_PROJECT
            --project-directory /path/to/existing/deployment
            --env-file /path/to/existing/deployment/.env
            -f /path/to/existing/deployment/compose.yaml
            -f /path/to/existing/deployment/compose.camera-turn.yaml)
        "${camera_compose_cmd[@]}" config --quiet &&
        "${camera_compose_cmd[@]}" up -d --no-deps --no-build --pull never \
            --force-recreate roborock-local-server
    fi
}
```

Recreation briefly interrupts the server. `--no-build --pull never` prevents
an incidental build/pull; verify the local image tag still resolves to the
intended image. Keep both base and TURN files in future update/recreate
commands. Do not replace the data directory, run `down -v`, or re-pair a working
robot just to enable TURN. Coturn's generated configuration contains its
password; do not print or share it.

## 6. Allow the LAN and VLAN traffic

Allow the robot's **current address** and the viewer network to reach the
server on UDP 3478 and UDP 49160-49179, with return traffic permitted. Preserve
the working API HTTPS and MQTT rules. Check gateway/VLAN rules as well as host
and Docker filtering; an inactive host firewall does not establish that a
gateway permits the traffic. An old robot IP in a firewall rule can make an
otherwise correct setup fail. A DHCP reservation helps keep rules accurate.

No WAN port forwarding is needed for this LAN test. Nginx allowing HTTPS does
not open the UDP path. This guide does not establish off-site viewing support.

## 7. Verify the setup, then test off the dock

Run the following after substituting your names and the path to this checkout:

```bash
{
    python3 /path/to/checkout/docs/s7-maxv-video/check-camera.py \
        --api-host api-r.example.com --camera-host r.example.com
    if sudo -v; then
        sudo -n docker port roborock-local-server
        sudo -n docker exec roborock-local-server python -c \
            'import socket, sys; print("Container camera IPv4:", sorted({r[4][0] for r in socket.getaddrinfo(sys.argv[1], 3478, socket.AF_INET, socket.SOCK_DGRAM)}))' \
            r.example.com
    fi
}
```

The check script verifies DNS, TLS trust/hostname matching, and the bootstrap
response without displaying credentials. It posts a **host-generated probe**;
it cannot read back the robot's saved `token.r`, prove the robot trusts the
chain, or prove UDP reachability. HTTP 200 alone is not enough: with TURN
disabled, the server can return a generic success/fallback without relay
credentials. Confirm all 21 UDP ports are published, coturn is running, and
the advertised IPv4 address is reachable from both networks.

Then perform one controlled app test:

1. Physically move the robot off the dock and leave it awake and idle.
2. Put the phone on home Wi-Fi, with VPN disabled, and use the OEM app already
   connected to the local server.
3. Open Remote Viewing and enter the existing remote-view PIN if requested.
   Allow roughly 30 seconds for the result.
4. Confirm an actual live picture. Test Call separately, then end the session.
5. If diagnosing a failure, note the time, exact app message, whether the PIN
   was accepted, and whether any frames appeared. Do not share the PIN.

For this successful test, the real robot requested the camera hostname at
`/iot.roborock.com/fwapi/createca`; the server returned code 200 with the
configured TURN endpoint. The observed camera RPC sequence included
`check_homesec_password`, `get_homesec_connect_status`,
`start_camera_preview`, and `stop_camera_preview`, without top-level RPC
errors. The user's visible picture and working Call feature confirmed the
result; a reply containing a list or a null error field alone would not do so.

## Troubleshooting by stage

| Evidence | Next check |
| --- | --- |
| Normal controls work, but camera TLS fails | Camera hostname needs its own certificate coverage and active Nginx site; the API site's certificate may be selected otherwise |
| No real robot bootstrap request | Actual `token.r` length/trailing slash, robot DNS, camera TLS, port, and route from the robot VLAN; a host probe cannot clear these for the robot |
| HTTP 200, but no TURN endpoint/credentials | `[turn]` may still be disabled or the request may have reached the wrong backend/catchall |
| PIN rejected or activation requested | Existing remote-view PIN and the S7 MaxV's own activation flow; do not copy a Saros-specific button procedure or reset pairing as the first step |
| Preview returns `-10011` | The same-model report identifies charging as the reason; test physically off the dock |
| Preview returns `-10014` | The same-model report identifies a TURN-server request failure; inspect bootstrap DNS/TLS/response first, then relay/network evidence rather than assuming only a UDP firewall problem |
| Bootstrap succeeds, but there are no frames | Coturn process, Docker's DNS answer and advertised IPv4, authenticated TURN allocation, both UDP port groups, VLAN rules, and client negotiation |
| A filtered TURN log summary is empty | Inconclusive: filtering or log retention can miss events, and media may be direct; it is not proof of a failed relay or a cloud-free stream |

If OEM video still fails after those checks, use
[go2rtc's Roborock integration](https://github.com/AlexxIT/go2rtc/blob/master/internal/roborock/README.md)
as a **separate diagnostic client**, closing the OEM camera session first.
Success there helps isolate a client-specific problem but does not by itself
prove the OEM app works. A forced-relay test is needed to establish that media
actually traverses TURN. Keep PINs, local keys, tokens, credentials, and raw
HTTP/MQTT payloads out of issue reports; share filtered paths, response codes,
numeric errors, and observed app behavior.

For the broader implementation and other robot models, see
[Camera (live video)](../camera.md) and
[Custom certificate management](../custom_cert_management.md).
