#!/usr/bin/env bash
# First-stage setup for Pedro's Ubuntu / Ubuntu-based Linux Mint host.
# Run with bash as pedro. The server is configured and started separately.

roborock_install_file() {
  local source_file="$1" target_file="$2"
  if [ -e "$target_file" ] || [ -L "$target_file" ]; then
    if [ ! -L "$target_file" ] && [ -f "$target_file" ] && cmp -s "$source_file" "$target_file"; then
      return 0
    fi
    printf 'ERROR: Preserving existing file: %s\n' "$target_file" >&2
    return 1
  fi
  install -m 0600 "$source_file" "$target_file"
}

roborock_prepare_docker() {
  local dev_dir="/home/pedro/devProjects/local_roborock_server"
  local runtime_dir="/opt/local_roborock_server"
  local fork_https="https://github.com/pponce/local_roborock_server.git"
  local fork_ssh="git@github.com:pponce/local_roborock_server.git"
  local branch="SCHEDULE_SUPPORT"
  local os_id ubuntu_codename architecture origin_url upstream_url package status
  local source_commit image_name image_revision repo_root work_status
  local uid gid temporary_dir backup_dir work_dir folder setup_log certificate_file
  local -a conflicts=()

  if [ "$(id -un)" != "pedro" ] || [ "$(id -u)" = "0" ]; then
    printf 'ERROR: Run this script as pedro, without sudo before bash.\n' >&2
    return 1
  fi
  if [ ! -r /etc/os-release ]; then
    printf 'ERROR: Cannot identify this Linux distribution.\n' >&2
    return 1
  fi
  os_id=$(. /etc/os-release; printf '%s' "${ID:-}") || return 1
  ubuntu_codename=$(. /etc/os-release; printf '%s' "${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}") || return 1
  case "$os_id" in
    ubuntu | linuxmint) ;;
    *) printf 'ERROR: This installer targets Ubuntu or Ubuntu-based Linux Mint. Found: %s\n' "$os_id" >&2; return 1 ;;
  esac
  case "$ubuntu_codename" in
    jammy | noble | resolute | stonking) ;;
    *) printf 'ERROR: Unsupported Ubuntu base: %s. No installation attempted.\n' "$ubuntu_codename" >&2; return 1 ;;
  esac
  architecture=$(dpkg --print-architecture) || return 1
  case "$architecture" in
    amd64 | arm64) ;;
    *) printf 'ERROR: This script supports amd64 and arm64. Found: %s\n' "$architecture" >&2; return 1 ;;
  esac
  uid=$(id -u) || return 1
  gid=$(id -g) || return 1
  if [ -L "$dev_dir" ] || [ -L "$runtime_dir" ]; then
    printf 'ERROR: An installation directory is a symlink; leaving it unchanged.\n' >&2
    return 1
  fi

  printf '\nOperating system: %s; Ubuntu base: %s; architecture: %s\n' "$os_id" "$ubuntu_codename" "$architecture"
  sudo -v || return 1
  sudo apt-get update || return 1
  sudo apt-get install -y --no-remove ca-certificates curl git openssl || return 1

  printf '\nPreparing the development checkout.\n'
  mkdir -p /home/pedro/devProjects || return 1
  if [ ! -e "$dev_dir/.git" ]; then
    git clone --branch "$branch" "$fork_https" "$dev_dir" || return 1
  fi
  repo_root=$(git -C "$dev_dir" rev-parse --show-toplevel) || return 1
  if [ "$repo_root" != "$dev_dir" ]; then
    printf 'ERROR: The development path is not this repository root.\n' >&2
    return 1
  fi
  origin_url=$(git -C "$dev_dir" remote get-url --all origin) || return 1
  case "$origin_url" in
    "$fork_https" | "${fork_https%.git}" | "$fork_ssh" | "${fork_ssh%.git}") ;;
    *) printf 'ERROR: Existing origin is not Pedro\047s fork.\n' >&2; return 1 ;;
  esac
  work_status=$(git -C "$dev_dir" status --porcelain) || return 1
  if [ -n "$work_status" ]; then
    printf 'ERROR: There are local changes. No checkout, reset, or stash was performed.\n' >&2
    git -C "$dev_dir" status --short
    return 1
  fi
  if upstream_url=$(git -C "$dev_dir" remote get-url --all upstream 2>/dev/null); then
    case "$upstream_url" in
      https://github.com/Python-roborock/local_roborock_server | https://github.com/Python-roborock/local_roborock_server.git | git@github.com:Python-roborock/local_roborock_server | git@github.com:Python-roborock/local_roborock_server.git) ;;
      *) printf 'ERROR: Existing upstream is unexpected; preserving it.\n' >&2; return 1 ;;
    esac
  else
    git -C "$dev_dir" remote add upstream https://github.com/Python-roborock/local_roborock_server.git || return 1
  fi
  git -C "$dev_dir" remote set-url origin "$fork_https" || return 1
  git -C "$dev_dir" config --replace-all remote.origin.pushurl "$fork_ssh" || return 1
  git -C "$dev_dir" fetch origin || return 1
  if git -C "$dev_dir" show-ref --verify --quiet "refs/heads/$branch"; then
    if ! git -C "$dev_dir" merge-base --is-ancestor "$branch" "origin/$branch"; then
      printf 'ERROR: The local schedule branch has commits absent from GitHub; preserving them.\n' >&2
      return 1
    fi
    git -C "$dev_dir" switch "$branch" || return 1
    git -C "$dev_dir" merge --ff-only "origin/$branch" || return 1
  else
    git -C "$dev_dir" switch --track -c "$branch" "origin/$branch" || return 1
  fi
  backup_dir="$dev_dir/backups"
  work_dir="$dev_dir/local-work"
  for folder in "$backup_dir" "$work_dir"; do
    if [ -L "$folder" ] || { [ -e "$folder" ] && [ ! -d "$folder" ]; }; then
      printf 'ERROR: Expected a regular directory: %s\n' "$folder" >&2
      return 1
    fi
    if [ ! -d "$folder" ]; then
      mkdir -m 0700 "$folder" || return 1
    fi
  done
  temporary_dir=$(mktemp -d "$work_dir/setup.XXXXXXXX") || return 1
  roborock_temporary_dir="$temporary_dir"
  setup_log=$(mktemp "$work_dir/install-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXXXX.log") || return 1
  exec > >(tee -a "$setup_log") 2>&1
  printf '\nInstallation log: %s\n' "$setup_log"

  if command -v docker >/dev/null 2>&1; then
    printf '\nChecking the existing Docker installation.\n'
    if ! sudo docker info >/dev/null 2>&1 || ! sudo docker compose version || ! sudo docker buildx version; then
      printf 'ERROR: Docker exists but Engine, Compose, or Buildx is unavailable. Send this output before replacing it.\n' >&2
      return 1
    fi
  else
    for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
      status=$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null) || status=""
      if [ "$status" = "install ok installed" ]; then
        conflicts+=("$package")
      fi
    done
    if [ "${#conflicts[@]}" -gt 0 ]; then
      printf 'ERROR: Existing container packages need review; none were removed: %s\n' "${conflicts[*]}" >&2
      return 1
    fi
    if [ -e /etc/apt/sources.list.d/docker.list ]; then
      printf 'ERROR: An existing docker.list repository needs review; leaving it unchanged.\n' >&2
      return 1
    fi
    cat > "$temporary_dir/docker.sources" <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $ubuntu_codename
Components: stable
Architectures: $architecture
Signed-By: /etc/apt/keyrings/docker.asc
EOF
    if [ -e /etc/apt/sources.list.d/docker.sources ] && ! cmp -s "$temporary_dir/docker.sources" /etc/apt/sources.list.d/docker.sources; then
      printf 'ERROR: An existing Docker repository differs from the expected configuration; preserving it.\n' >&2
      return 1
    fi
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o "$temporary_dir/docker.asc" || return 1
    sudo install -m 0755 -d /etc/apt/keyrings || return 1
    sudo install -m 0644 "$temporary_dir/docker.asc" /etc/apt/keyrings/docker.asc || return 1
    sudo install -m 0644 "$temporary_dir/docker.sources" /etc/apt/sources.list.d/docker.sources || return 1
    sudo apt-get update || return 1
    sudo apt-get install -y --no-remove docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin || return 1
    sudo systemctl enable --now docker || return 1
  fi
  sudo docker version || return 1
  sudo docker compose version || return 1
  sudo docker run --rm hello-world || return 1

  source_commit=$(git -C "$dev_dir" rev-parse HEAD) || return 1
  image_name="local/roborock-server:schedule-${source_commit:0:12}"

  printf '\nBuilding %s from commit %s\n' "$image_name" "$source_commit"
  if sudo docker image inspect "$image_name" >/dev/null 2>&1; then
    image_revision=$(sudo docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image_name") || return 1
    if [ "$image_revision" != "$source_commit" ]; then
      printf 'ERROR: An image with this tag has a different source revision; preserving it.\n' >&2
      return 1
    fi
    printf 'Reusing the already-built image for this commit.\n'
  else
    # Export the committed tree, so ignored credentials and uncommitted files
    # cannot enter the build context and the revision label remains accurate.
    git -C "$dev_dir" archive --format=tar --output="$temporary_dir/context.tar" "$source_commit" || return 1
    sudo docker build --progress=plain \
      --label "org.opencontainers.image.source=https://github.com/pponce/local_roborock_server" \
      --label "org.opencontainers.image.revision=$source_commit" \
      --tag "$image_name" - < "$temporary_dir/context.tar" || return 1
  fi
  sudo docker run --rm --network none "$image_name" python -c \
    'import roborock_local_server.bundled_backend.shared.schedule_runner; print("Schedule runner import: OK")' || return 1

  if [ ! -d "$runtime_dir" ]; then
    sudo install -d -m 0700 -o "$uid" -g "$gid" "$runtime_dir" || return 1
  fi
  if [ ! -O "$runtime_dir" ] || [ ! -w "$runtime_dir" ]; then
    printf 'ERROR: The existing runtime directory is not owned and writable by pedro; preserving its permissions.\n' >&2
    return 1
  fi
  for package in data secrets; do
    if [ -L "$runtime_dir/$package" ]; then
      printf 'ERROR: Runtime %s is a symlink; preserving it.\n' "$package" >&2
      return 1
    fi
  done
  mkdir -p "$runtime_dir/data" "$runtime_dir/secrets" || return 1

  cat > "$temporary_dir/compose.yaml" <<'EOF'
name: local-roborock-server
services:
  roborock-local-server:
    image: IMAGE_PLACEHOLDER
    pull_policy: never
    container_name: roborock-local-server
    restart: unless-stopped
    ports:
      - "${ROBOROCK_SERVER_BIND_IP:-0.0.0.0}:${ROBOROCK_SERVER_HTTPS_PORT:-555}:${ROBOROCK_SERVER_HTTPS_PORT:-555}"
      - "${ROBOROCK_SERVER_BIND_IP:-0.0.0.0}:${ROBOROCK_SERVER_MQTT_TLS_PORT:-8881}:${ROBOROCK_SERVER_MQTT_TLS_PORT:-8881}"
    volumes:
      - type: bind
        source: ./config.toml
        target: /app/config.toml
        read_only: true
        bind:
          create_host_path: false
      - type: bind
        source: ./data
        target: /data
        bind:
          create_host_path: false
      - type: bind
        source: ./secrets
        target: /run/secrets
        read_only: true
        bind:
          create_host_path: false
    logging:
      driver: local
      options:
        max-size: "10m"
        max-file: "3"
    healthcheck:
      test: ["CMD", "curl", "-skf", "${ROBOROCK_SERVER_HEALTHCHECK_SCHEME:-https}://127.0.0.1:${ROBOROCK_SERVER_HTTPS_PORT:-555}/admin"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 20s
EOF
  sed -i "s|IMAGE_PLACEHOLDER|$image_name|" "$temporary_dir/compose.yaml" || return 1
  roborock_install_file "$temporary_dir/compose.yaml" "$runtime_dir/compose.yaml" || return 1
  git -C "$dev_dir" show "$source_commit:compose.turn.yaml" > "$temporary_dir/compose.turn.yaml" || return 1
  roborock_install_file "$temporary_dir/compose.turn.yaml" "$runtime_dir/compose.turn.yaml" || return 1
  printf '%s\n' "$source_commit" > "$temporary_dir/SOURCE_COMMIT" || return 1
  roborock_install_file "$temporary_dir/SOURCE_COMMIT" "$runtime_dir/SOURCE_COMMIT" || return 1
  sudo docker compose --project-directory "$runtime_dir" -f "$runtime_dir/compose.yaml" config --quiet || return 1

  printf '\nREADY FOR CONFIGURATION\n'
  printf 'Development checkout: %s\nRuntime directory: %s\nBranch: %s\nCommit: %s\nImage: %s\n' "$dev_dir" "$runtime_dir" "$branch" "$source_commit" "$image_name"
  sudo docker info --format 'Docker data directory: {{.DockerRootDir}}' || return 1
  printf '\nHost IPv4 addresses:\n'
  ip -o -4 address show scope global || return 1
  printf '\nListeners on possible server / camera ports (empty means none):\n'
  sudo ss -lntup '( sport = :443 or sport = :555 or sport = :8881 or sport = :3478 )' || return 1
  printf '\nExisting onefallday.com certificate (public metadata only):\n'
  certificate_file=""
  for folder in \
    /home/pedro/dynamicDnsScript/certs/onefallday.com-fullchain.pem \
    /home/pedro/dynamicDnsScript/certs/live/onefallday.com/fullchain.pem; do
    if sudo test -r "$folder"; then
      certificate_file="$folder"
      break
    fi
  done
  if [ -n "$certificate_file" ]; then
    printf 'Certificate file: %s\n' "$certificate_file"
    sudo openssl x509 -in "$certificate_file" -noout -subject -issuer -dates -ext subjectAltName || return 1
    if ! sudo openssl x509 -in "$certificate_file" -noout -checkhost api-roborock.onefallday.com; then
      printf 'The existing certificate does not cover the proposed server hostname.\n'
    fi
    if ! sudo openssl x509 -in "$certificate_file" -noout -checkend 0; then
      printf 'The existing certificate is expired. Renew it before server startup.\n'
    fi
  else
    printf 'No certificate found at the paths used by ddns-dnsexit-custom. Report its current location.\n'
  fi
  printf '\nBackup folder: %s\nSetup log: %s\n' "$backup_dir" "$setup_log"
  printf 'Backup folders are prepared; no robot backups have been captured yet.\n'
  printf '\nThe Roborock service has not been started. DNS, certificates, and config.toml are next.\n'
  printf 'Your vacuums remain paired with Roborock cloud; Homebridge was not changed.\n'
}

# A child shell owns the restrictive umask and cleanup; the invoking shell is unchanged.
if [ "${BASH_SOURCE[0]:-$0}" != "$0" ]; then
  printf 'Run this file with bash; do not source it.\n' >&2
  return 1
fi
umask 077
printf '\nSTART COPY HERE\n'
roborock_temporary_dir=""
trap 'if [ -n "$roborock_temporary_dir" ]; then rm -rf -- "$roborock_temporary_dir"; fi' EXIT
if roborock_prepare_docker; then
  printf '\nSetup exit status: 0\nEND COPY HERE\n'
else
  roborock_setup_status=$?
  printf '\nSetup exit status: %s (incomplete; see the error above)\nEND COPY HERE\n' "$roborock_setup_status" >&2
  exit "$roborock_setup_status"
fi
