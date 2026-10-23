#!/usr/bin/env bash
# First configuration/startup after install-pedro-docker.sh. Run as pedro.

roborock_copy_initial_cert() {
  local source_file="$1" destination_file="$2"
  if [ -e "$destination_file" ] || [ -L "$destination_file" ]; then
    if [ ! -L "$destination_file" ] && [ -f "$destination_file" ] && sudo cmp -s "$source_file" "$destination_file"; then
      return 0
    fi
    printf 'ERROR: Preserving an existing, different certificate file: %s\n' "$destination_file" >&2
    return 1
  fi
  sudo install -m 0600 -o "$(id -u)" -g "$(id -g)" "$source_file" "$destination_file"
}

roborock_configure_and_start() {
  local dev_dir="/home/pedro/devProjects/local_roborock_server"
  local runtime_dir="/opt/local_roborock_server"
  local cert_dir="/home/pedro/dynamicDnsScript/certs"
  local fqdn="api-roborock.onefallday.com" bind_ip="192.168.84.2"
  local image_name source_commit image_revision actual_image resolved_ip
  local setup_log backup_dir existing_container listeners folder certificate_file
  local -a compose

  if [ "$(id -un)" != pedro ] || [ "$(id -u)" = 0 ]; then
    printf 'ERROR: Run with bash as pedro, without sudo before bash.\n' >&2
    return 1
  fi
  if [ ! -t 0 ]; then
    printf 'ERROR: An interactive terminal is required for hidden credential prompts.\n' >&2
    return 1
  fi
  for folder in "$dev_dir" "$runtime_dir" "$runtime_dir/data" "$runtime_dir/secrets" "$dev_dir/local-work" "$dev_dir/backups"; do
    if [ -L "$folder" ] || [ ! -d "$folder" ]; then
      printf 'ERROR: Expected a regular directory from stage 1: %s\n' "$folder" >&2
      return 1
    fi
  done
  if [ ! -O "$runtime_dir" ] || [ ! -w "$runtime_dir" ]; then
    printf 'ERROR: Runtime directory must be owned and writable by pedro.\n' >&2
    return 1
  fi
  for certificate_file in "$runtime_dir/SOURCE_COMMIT" "$runtime_dir/compose.yaml" "$dev_dir/scripts/pedro_runtime_config.py"; do
    if [ -L "$certificate_file" ] || [ ! -f "$certificate_file" ]; then
      printf 'ERROR: Missing or unexpected setup file: %s\n' "$certificate_file" >&2
      return 1
    fi
  done
  sudo -v || return 1
  sudo docker info >/dev/null || return 1
  existing_container=$(sudo docker ps -aq --filter 'name=^/roborock-local-server$') || return 1
  if [ -n "$existing_container" ]; then
    printf 'ERROR: A Roborock service container already exists. This helper is for first startup; preserving it.\n' >&2
    sudo docker ps -a --filter 'name=^/roborock-local-server$'
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
    printf 'ERROR: The built image revision does not match SOURCE_COMMIT.\n' >&2
    return 1
  fi
  resolved_ip=$(getent ahostsv4 "$fqdn" | awk '{print $1}' | sort -u) || return 1
  if [ "$resolved_ip" != "$bind_ip" ]; then
    printf 'ERROR: Local IPv4 DNS must resolve %s only to %s.\n' "$fqdn" "$bind_ip" >&2
    return 1
  fi
  if ! ip -o -4 address show | awk -v wanted="$bind_ip" '{split($4, parts, "/"); if (parts[1] == wanted) found=1} END {exit !found}'; then
    printf 'ERROR: The server address %s is not assigned on this host.\n' "$bind_ip" >&2
    return 1
  fi
  listeners=$(ss -H -lnt '( sport = :555 or sport = :8881 )') || return 1
  if [ -n "$listeners" ]; then
    printf 'ERROR: Port 555 or 8881 is already occupied; preserving the existing service.\n%s\n' "$listeners" >&2
    return 1
  fi

  setup_log=$(mktemp "$dev_dir/local-work/configure-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXXXX.log") || return 1
  exec > >(tee -a "$setup_log") 2>&1
  printf 'Setup log: %s\nReusing image: %s\n' "$setup_log" "$image_name"
  for certificate_file in "$cert_dir/onefallday.com-fullchain.pem" "$cert_dir/onefallday.com-privkey.pem"; do
    if ! sudo test -f "$certificate_file"; then
      printf 'ERROR: Certificate file not found: %s\n' "$certificate_file" >&2
      return 1
    fi
  done
  sudo openssl x509 -in "$cert_dir/onefallday.com-fullchain.pem" -noout -checkhost "$fqdn" || return 1
  sudo openssl x509 -in "$cert_dir/onefallday.com-fullchain.pem" -noout -checkend 0 || return 1
  if [ -L "$runtime_dir/data/certs" ]; then
    printf 'ERROR: Certificate destination is a symlink; preserving it.\n' >&2
    return 1
  fi
  mkdir -p -m 0700 "$runtime_dir/data/certs" || return 1
  roborock_copy_initial_cert "$cert_dir/onefallday.com-fullchain.pem" "$runtime_dir/data/certs/fullchain.pem" || return 1
  roborock_copy_initial_cert "$cert_dir/onefallday.com-privkey.pem" "$runtime_dir/data/certs/privkey.pem" || return 1

  sudo docker run --rm -it --pull=never --network none \
    --user "$(id -u):$(id -g)" \
    --mount "type=bind,source=$runtime_dir,target=/work" \
    --mount "type=bind,source=$dev_dir/scripts/pedro_runtime_config.py,target=/setup.py,readonly" \
    "$image_name" python -B /setup.py || return 1

  compose=(sudo env ROBOROCK_SERVER_BIND_IP="$bind_ip" ROBOROCK_SERVER_HTTPS_PORT=555 \
    ROBOROCK_SERVER_MQTT_TLS_PORT=8881 ROBOROCK_SERVER_HEALTHCHECK_SCHEME=https \
    docker compose --project-directory "$runtime_dir" --env-file "$runtime_dir/.env" -f "$runtime_dir/compose.yaml")
  "${compose[@]}" config --quiet || return 1
  actual_image=$("${compose[@]}" config --images) || return 1
  if [ "$actual_image" != "$image_name" ]; then
    printf 'ERROR: Compose does not use the expected built image; no service started.\n' >&2
    return 1
  fi

  backup_dir=$(mktemp -d "$dev_dir/backups/$(date -u +%Y-%m-%d-%H%M%S)-XXXXXXXX") || return 1
  mkdir -m 0700 "$backup_dir/server" "$backup_dir/downtown" "$backup_dir/uptown" || return 1
  sudo tar -czf - -C /opt local_roborock_server > "$backup_dir/server/runtime-before-first-start.tar.gz" || return 1
  sudo docker image inspect --format 'Image: {{.Id}}\nSource: {{ index .Config.Labels "org.opencontainers.image.revision" }}' \
    "$image_name" > "$backup_dir/server/image.txt" || return 1
  printf '\nServer configuration backup: %s/server\n' "$backup_dir"
  printf 'This backs up the server configuration and certificates; robot backups have not been captured.\n'

  "${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 90 || return 1
  printf '\nVerifying HTTPS using the hostname and system trust store.\n'
  curl -4 --noproxy '*' --fail --silent --show-error --connect-timeout 5 --max-time 15 \
    --output /dev/null --write-out 'HTTPS response: %{http_code}\n' "https://$fqdn:555/admin" || return 1
  printf '\nVerifying MQTT TLS certificate and hostname.\n'
  timeout 15 openssl s_client -connect "$bind_ip:8881" -servername "$fqdn" \
    -verify_hostname "$fqdn" -verify_return_error -brief </dev/null || return 1

  printf '\nSTART COPY HERE\nLOCAL SERVER STARTED\n'
  printf 'Dashboard: https://%s:555/admin\nServer address: %s\nTimezone: America/Los_Angeles\n' "$fqdn" "$bind_ip"
  printf 'Image: %s\nRuntime source commit: %s\n' "$image_name" "$source_commit"
  printf 'Configuration backup: %s/server\nSetup log: %s\n' "$backup_dir" "$setup_log"
  "${compose[@]}" ps || return 1
  printf 'HTTPS and MQTT TLS verified from the Linux host. IoT access and robot trust still need testing.\n'
  printf 'Certificate renewal deployment is not installed yet; this was an initial certificate copy.\n'
  printf 'Vacuums remain on cloud. No robot backups, pairing, or Homebridge changes were performed.\n'
  printf 'END COPY HERE\n'
}

if [ "${BASH_SOURCE[0]:-$0}" != "$0" ]; then
  printf 'Run this file with bash; do not source it.\n' >&2
  return 1
fi
umask 077
set -o pipefail
if roborock_configure_and_start; then
  printf '\nConfiguration/startup exit status: 0\n'
else
  roborock_setup_status=$?
  printf '\nConfiguration/startup incomplete (status %s). Report the error above.\n' "$roborock_setup_status" >&2
  printf 'Existing files were preserved. If startup was attempted, the container may still be running.\n' >&2
  exit "$roborock_setup_status"
fi
