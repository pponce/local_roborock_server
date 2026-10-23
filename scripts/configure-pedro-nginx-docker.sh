#!/usr/bin/env bash
# First server startup with TLS owned by Pedro's existing host Nginx.

roborock_cleanup_nginx_probe() {
  if [ -n "${roborock_probe_id:-}" ]; then
    sudo docker rm --force "$roborock_probe_id" >/dev/null || return 1
    roborock_probe_id=""
  fi
  if [ -n "${roborock_probe_dir:-}" ]; then
    rm -rf -- "$roborock_probe_dir" || return 1
    roborock_probe_dir=""
  fi
}

roborock_start_behind_nginx() {
  local dev_dir="/home/pedro/devProjects/local_roborock_server"
  local runtime_dir="/opt/local_roborock_server"
  local fqdn="api-roborock.onefallday.com" server_ip="192.168.84.2"
  local source_commit image_name image_revision folder file existing listeners resolved_ip
  local setup_log marker gateway proxy_ip probe_status backup_dir
  local -a compose probe_compose

  if [ "$(id -un)" != pedro ] || [ "$(id -u)" = 0 ] || [ ! -t 0 ]; then
    printf 'ERROR: Run with bash as pedro in an interactive terminal, without sudo before bash.\n' >&2
    return 1
  fi
  command -v python3 >/dev/null || return 1
  for folder in "$dev_dir" "$runtime_dir" "$runtime_dir/data" "$runtime_dir/secrets" "$dev_dir/local-work" "$dev_dir/backups"; do
    if [ -L "$folder" ] || [ ! -d "$folder" ]; then
      printf 'ERROR: Expected a regular directory from stage 1: %s\n' "$folder" >&2
      return 1
    fi
  done
  if [ ! -O "$runtime_dir" ] || [ ! -w "$runtime_dir" ]; then
    printf 'ERROR: The runtime directory must be owned and writable by pedro.\n' >&2
    return 1
  fi
  for file in "$runtime_dir/SOURCE_COMMIT" "$runtime_dir/compose.yaml" \
      "$dev_dir/scripts/pedro_runtime_config.py" "$dev_dir/scripts/pedro_nginx_probe.py"; do
    if [ -L "$file" ] || [ ! -f "$file" ]; then
      printf 'ERROR: Missing or unexpected setup file: %s\n' "$file" >&2
      return 1
    fi
  done
  sudo -v || return 1
  sudo docker info >/dev/null || return 1
  existing=$(sudo docker ps -aq --filter 'name=^/roborock-local-server$') || return 1
  if [ -n "$existing" ]; then
    printf 'ERROR: A Roborock server container already exists. This is a first-start helper; preserving it.\n' >&2
    sudo docker ps -a --filter 'name=^/roborock-local-server$'
    return 1
  fi
  existing=$(sudo docker ps -aq --filter label=com.docker.compose.project=local-roborock-server \
    --filter label=com.docker.compose.service=nginx-probe) || return 1
  if [ -n "$existing" ]; then
    printf 'ERROR: An earlier setup probe container exists; report this before retrying.\n' >&2
    return 1
  fi
  source_commit=$(cat "$runtime_dir/SOURCE_COMMIT") || return 1
  if [[ ! "$source_commit" =~ ^[0-9a-f]{40}$ ]]; then
    printf 'ERROR: SOURCE_COMMIT is not a full Git commit ID.\n' >&2
    return 1
  fi
  image_name="local/roborock-server:schedule-${source_commit:0:12}"
  image_revision=$(sudo docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image_name") || return 1
  if [ "$image_revision" != "$source_commit" ]; then
    printf 'ERROR: The image revision does not match SOURCE_COMMIT.\n' >&2
    return 1
  fi
  resolved_ip=$(getent ahostsv4 "$fqdn" | awk '{print $1}' | sort -u) || return 1
  if [ "$resolved_ip" != "$server_ip" ]; then
    printf 'ERROR: Local IPv4 DNS must resolve %s only to %s.\n' "$fqdn" "$server_ip" >&2
    return 1
  fi
  if ! ip -o -4 address show | awk -v wanted="$server_ip" '{split($4, parts, "/"); if (parts[1] == wanted) found=1} END {exit !found}'; then
    printf 'ERROR: The server address %s is not assigned on this host.\n' "$server_ip" >&2
    return 1
  fi
  sudo nginx -t || return 1
  listeners=$(ss -H -lnt '( sport = :555 or sport = :18881 )') || return 1
  if [ -n "$listeners" ]; then
    printf 'ERROR: A backend port is already in use; preserving the existing listener.\n%s\n' "$listeners" >&2
    return 1
  fi
  setup_log=$(mktemp "$dev_dir/local-work/configure-nginx-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXXXX.log") || return 1
  exec > >(tee -a "$setup_log") 2>&1
  printf 'Setup log: %s\nReusing image: %s\n' "$setup_log" "$image_name"
  roborock_probe_dir=$(mktemp -d "$dev_dir/local-work/nginx-probe.XXXXXXXX") || return 1
  marker=$(python3 -c 'import secrets; print(secrets.token_hex(16))') || return 1

  # Force the intended values during validation, regardless of the invoking shell's environment.
  compose=(sudo env ROBOROCK_SERVER_BIND_IP=127.0.0.1 ROBOROCK_SERVER_HTTPS_PORT=555 \
    ROBOROCK_SERVER_MQTT_TLS_PORT=18881 ROBOROCK_SERVER_HEALTHCHECK_SCHEME=http \
    docker compose --project-name local-roborock-server --project-directory "$runtime_dir" \
    --env-file /dev/null -f "$runtime_dir/compose.yaml")
  "${compose[@]}" config --format json > "$roborock_probe_dir/runtime-compose.json" || return 1
  python3 "$dev_dir/scripts/pedro_nginx_probe.py" compose \
    "$roborock_probe_dir/runtime-compose.json" "$image_name" "$runtime_dir" || return 1

  # Compose creates its normal project network. The probe has no runtime mounts,
  # credentials and sends no robot commands. Keep the network when removing the probe so the
  # measured proxy address remains valid for the real server.
  cat > "$roborock_probe_dir/compose.yaml" <<EOF
services:
  nginx-probe:
    image: $image_name
    pull_policy: never
    command: ["python", "-B", "/probe.py", "serve", "$marker"]
    ports:
      - "127.0.0.1:555:555"
      - "127.0.0.1:18881:18881"
    volumes:
      - type: bind
        source: $dev_dir/scripts/pedro_nginx_probe.py
        target: /probe.py
        read_only: true
        bind:
          create_host_path: false
EOF
  probe_compose=(sudo docker compose --project-name local-roborock-server --env-file /dev/null \
    --project-directory "$runtime_dir" -f "$roborock_probe_dir/compose.yaml")
  printf '\nTesting the live Nginx forwarding paths with a temporary backend.\n'
  probe_status=0
  "${probe_compose[@]}" up -d --no-build --pull never || probe_status=$?
  roborock_probe_id=$("${probe_compose[@]}" ps -aq nginx-probe) || return 1
  if [ "$probe_status" != 0 ] || [ -z "$roborock_probe_id" ]; then
    printf 'ERROR: The temporary backend could not start.\n' >&2
    return 1
  fi
  gateway=$(sudo docker network inspect local-roborock-server_default \
    --format '{{range .IPAM.Config}}{{println .Gateway}}{{end}}') || return 1
  # HTTP sent through the MQTT stream is only a disposable routing probe. The
  # real MQTT service replaces it below, after both TLS paths are validated.
  for file in http mqtt; do
    local port=443
    [ "$file" = mqtt ] && port=8881
    if ! curl -4 --noproxy '*' --interface "$server_ip" --fail --silent --show-error \
      --connect-timeout 3 --max-time 8 --retry 5 --retry-delay 1 --retry-connrefused \
      --output "$roborock_probe_dir/$file.json" "https://$fqdn:$port/__roborock_setup_$marker"; then
      printf 'ERROR: Nginx port %s did not reach its backend. Check the Roborock site/stream template.\n' "$port" >&2
      return 1
    fi
  done
  proxy_ip=$(python3 "$dev_dir/scripts/pedro_nginx_probe.py" routes \
    "$roborock_probe_dir/http.json" "$roborock_probe_dir/mqtt.json" "$marker" "$gateway") || return 1
  printf 'HTTPS forwarding, HTTP headers and both TLS certificates verified.\n'
  printf 'Measured HTTP and MQTT proxy address: %s\n' "$proxy_ip"
  roborock_cleanup_nginx_probe || return 1

  sudo docker run --rm -it --pull=never --network none --user "$(id -u):$(id -g)" \
    --mount "type=bind,source=$runtime_dir,target=/work" \
    --mount "type=bind,source=$dev_dir/scripts/pedro_runtime_config.py,target=/setup.py,readonly" \
    "$image_name" python -B /setup.py --nginx-proxy "$proxy_ip" || return 1

  backup_dir=$(mktemp -d "$dev_dir/backups/$(date -u +%Y-%m-%d-%H%M%S)-XXXXXXXX") || return 1
  mkdir -m 0700 "$backup_dir/server" "$backup_dir/downtown" "$backup_dir/uptown" || return 1
  sudo tar -czf - -C /opt local_roborock_server > "$backup_dir/server/runtime-before-first-start.tar.gz" || return 1
  printf '\nServer configuration backup: %s/server\n' "$backup_dir"
  printf 'Robot backups have not been captured yet.\n'

  "${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 90 || return 1
  curl -4 --noproxy '*' --fail --silent --show-error --connect-timeout 5 --max-time 15 \
    --output /dev/null --write-out 'HTTPS dashboard response: %{http_code}\n' "https://$fqdn/admin" || return 1
  timeout 15 openssl s_client -connect "$server_ip:8881" -servername "$fqdn" \
    -verify_hostname "$fqdn" -verify_return_error -brief </dev/null || return 1

  printf '\nSTART COPY HERE\nLOCAL SERVER STARTED BEHIND NGINX\n'
  printf 'Dashboard: https://%s/admin\nTimezone: America/Los_Angeles\n' "$fqdn"
  printf 'Image: %s\nRuntime source commit: %s\n' "$image_name" "$source_commit"
  printf 'Trusted Docker proxy: %s\nBackends: 127.0.0.1:555 and 127.0.0.1:18881\n' "$proxy_ip"
  printf 'Certificates: existing Nginx paths; no container certificate copy.\n'
  printf 'Configuration backup: %s/server\nSetup log: %s\n' "$backup_dir" "$setup_log"
  "${compose[@]}" ps || return 1
  printf 'Host HTTPS/TLS and backend forwarding verified. IoT access and robot trust still need testing.\n'
  printf 'No robot backups, pairing, cloud migration, or Homebridge changes were performed.\n'
  printf 'END COPY HERE\n'
}

if [ "${BASH_SOURCE[0]:-$0}" != "$0" ]; then
  printf 'Run this file with bash; do not source it.\n' >&2
  return 1
fi
umask 077
set -o pipefail
trap roborock_cleanup_nginx_probe EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if roborock_start_behind_nginx; then
  printf '\nConfiguration/startup exit status: 0\n'
else
  roborock_setup_status=$?
  printf '\nConfiguration/startup incomplete (status %s). Report the error above.\n' "$roborock_setup_status" >&2
  printf 'If server startup was attempted, its container may still be running.\n' >&2
  exit "$roborock_setup_status"
fi
