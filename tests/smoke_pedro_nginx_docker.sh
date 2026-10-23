#!/usr/bin/env bash
# CI-only integration check: real Compose rendering, network/probe, and external-TLS startup.
set -euo pipefail
if [ "${GITHUB_ACTIONS:-}" != true ]; then
  printf 'This smoke test is only for an isolated GitHub Actions runner.\n' >&2
  exit 1
fi

test_repo=$(pwd)
test_runtime=$(mktemp -d)
test_image=local/roborock-server:schedule-ci
test_marker=0123456789abcdef0123456789abcdef
test_probe_id=""
cleanup() {
  if [ -n "$test_probe_id" ]; then docker rm -f "$test_probe_id" >/dev/null || true; fi
  docker compose --project-name local-roborock-server -f "$test_runtime/compose.yaml" down || true
  sudo rm -rf -- "$test_runtime"
}
trap cleanup EXIT
export ROBOROCK_SERVER_BIND_IP=127.0.0.1 ROBOROCK_SERVER_HTTPS_PORT=555
export ROBOROCK_SERVER_MQTT_TLS_PORT=18881 ROBOROCK_SERVER_HEALTHCHECK_SCHEME=http
mkdir "$test_runtime/data" "$test_runtime/secrets"

# Exercise the actual templates shipped in the two installers, not a duplicate
# fixture that could drift away from what Pedro will run.
python3 - "$test_runtime" "$test_image" "$test_repo" "$test_marker" <<'PY'
from pathlib import Path
import sys
runtime, image, repo, marker = sys.argv[1:]
repo = Path(repo)
stage1 = (repo / 'scripts/install-pedro-docker.sh').read_text()
compose = stage1.split('cat > "$temporary_dir/compose.yaml" <<\'EOF\'\n', 1)[1].split('\nEOF', 1)[0]
(Path(runtime) / 'compose.yaml').write_text(compose.replace('IMAGE_PLACEHOLDER', image))
nginx = (repo / 'scripts/configure-pedro-nginx-docker.sh').read_text()
probe = nginx.split('cat > "$roborock_probe_dir/compose.yaml" <<EOF\n', 1)[1].split('\nEOF', 1)[0]
for name, value in (('$image_name', image), ('$dev_dir', str(repo)), ('$marker', marker)):
    probe = probe.replace(name, value)
(Path(runtime) / 'probe.yaml').write_text(probe)
PY
docker compose --project-name local-roborock-server -f "$test_runtime/compose.yaml" config --format json > "$test_runtime/rendered.json"
python3 scripts/pedro_nginx_probe.py compose "$test_runtime/rendered.json" "$test_image" "$test_runtime"
docker compose --project-name local-roborock-server -f "$test_runtime/probe.yaml" up -d --no-build --pull never
test_probe_id=$(docker compose --project-name local-roborock-server -f "$test_runtime/probe.yaml" ps -aq nginx-probe)
test_gateway=$(docker network inspect local-roborock-server_default --format '{{range .IPAM.Config}}{{println .Gateway}}{{end}}')
curl -fsS --retry 5 --retry-delay 1 --retry-connrefused --max-time 10 \
  -H 'Host: api-roborock.onefallday.com' -H 'X-Forwarded-Proto: https' -H 'X-Forwarded-For: 192.168.84.2' \
  "http://127.0.0.1:555/__roborock_setup_$test_marker" > "$test_runtime/http.json"
curl -fsS --max-time 10 "http://127.0.0.1:18881/__roborock_setup_$test_marker" > "$test_runtime/mqtt.json"
python3 scripts/pedro_nginx_probe.py routes "$test_runtime/http.json" "$test_runtime/mqtt.json" "$test_marker" "$test_gateway"
docker rm -f "$test_probe_id"
test_probe_id=""

docker run --rm --network none --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$test_repo/scripts,target=/checks,readonly" \
  --mount "type=bind,source=$test_runtime,target=/work" \
  "$test_image" python -B -c '
import sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, "/checks")
from pedro_runtime_config import prepare_config
with patch("pedro_runtime_config.getpass", side_effect=["test-only-password", "test-only-password", "182746", "182746"]), patch("builtins.input", return_value="test@example.com"):
    prepare_config(Path("/work"), nginx_proxy=sys.argv[1])
' "$test_gateway"
docker compose --project-name local-roborock-server -f "$test_runtime/compose.yaml" up -d --no-build --pull never --wait --wait-timeout 90
curl -fsS --max-time 10 -o /dev/null http://127.0.0.1:555/admin
printf 'Compose probe replacement and external-TLS server startup: OK\n'
