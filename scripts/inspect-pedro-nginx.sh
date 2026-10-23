#!/usr/bin/env bash
# Read-only preflight for the selected Nginx-managed TLS deployment.
# Output includes configuration filenames and certificate paths, never key contents.

roborock_inspect_nginx() {
  sudo -v || return 1
  printf '\nSTART COPY HERE\n'
  printf '\nNginx configuration check:\n'
  sudo nginx -t || return 1
  printf '\nNginx build and module support:\n'
  sudo nginx -V 2>&1 || return 1
  printf '\nSelected configuration directives (not the full configuration):\n'
  sudo nginx -T 2>&1 | awk '
    /^# configuration file / {print; next}
    /^[[:space:]]*(http|stream)[[:space:]]*\{/ {print; next}
    /^[[:space:]]*(load_module|include|listen|server_name|ssl_certificate|ssl_certificate_key|set_real_ip_from|real_ip_header)[[:space:]]/ {
      # Only print the first directive on a line, not unrelated trailing content.
      if ($1 ~ /^ssl_certificate/ && $0 ~ /data:/) {
        print "    " $1 " [inline value omitted];"; next
      }
      sub(/;.*/, ";"); print
    }
  ' || return 1
  printf '\nNginx-managed onefallday.com certificate (public metadata):\n'
  if sudo test -f /etc/nginx/ssl/onefallday/fullchain.pem; then
    sudo openssl x509 -in /etc/nginx/ssl/onefallday/fullchain.pem \
      -noout -subject -issuer -dates -ext subjectAltName || return 1
  else
    printf 'Expected /etc/nginx/ssl/onefallday/fullchain.pem was not found.\n'
  fi
  if sudo test -r /etc/nginx/ssl/onefallday/privkey.pem; then
    printf 'Nginx private-key file exists and is readable by root; contents not displayed.\n'
  else
    printf 'Expected Nginx private-key file is absent or unreadable.\n'
  fi
  printf '\nCertificate deploy-hook checksum (script contents not displayed):\n'
  if sudo test -f /home/pedro/dynamicDnsScript/deploy-hook.sh; then
    sudo sha256sum /home/pedro/dynamicDnsScript/deploy-hook.sh || return 1
  else
    printf 'No deploy-hook.sh at the expected certificate-script location.\n'
  fi
  printf '\nListeners on proposed frontend/backend ports:\n'
  ss -H -lnt '( sport = :443 or sport = :555 or sport = :8881 or sport = :18881 )' || return 1
  printf '\nNo configuration, certificates, services, or robot pairing were changed.\n'
  printf 'END COPY HERE\n'
}

if [ "${BASH_SOURCE[0]:-$0}" != "$0" ]; then
  printf 'Run this file with bash; do not source it.\n' >&2
  return 1
fi
set -o pipefail
roborock_inspect_nginx
