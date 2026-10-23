"""Temporary, credential-free backend for checking Pedro's Nginx routes."""

from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
from pathlib import Path
import re
import threading


FQDN = "api-roborock.onefallday.com"
SERVER_IP = "192.168.84.2"
PROJECT = "local-roborock-server"
SERVICE = "roborock-local-server"


def validate_compose(config: dict, image: str, runtime: Path) -> None:
    """Check the rendered runtime before binding any plaintext backend ports."""
    if config.get("name") != PROJECT or set(config.get("services", {})) != {SERVICE}:
        raise ValueError("Expected the single-service Roborock runtime Compose project.")
    service = config["services"][SERVICE]
    if service.get("image") != image:
        raise ValueError("Runtime Compose does not use the stage-1 image.")
    ports = service.get("ports", [])
    bindings = {(p.get("host_ip"), str(p.get("published")), p.get("target"),
                 p.get("protocol", "tcp")) for p in ports}
    if len(ports) != 2 or bindings != {
        ("127.0.0.1", "555", 555, "tcp"),
        ("127.0.0.1", "18881", 18881, "tcp"),
    }:
        raise ValueError("Runtime must publish only 127.0.0.1:555 and 127.0.0.1:18881.")
    networks = config.get("networks", {})
    if (set(networks) != {"default"}
            or networks["default"] != {"name": PROJECT + "_default"}
            or service.get("network_mode")
            or set(service.get("networks", {})) != {"default"}):
        raise ValueError("Expected the unmodified stage-1 Compose default network.")
    mounts = {v.get("target"): v for v in service.get("volumes", [])}
    expected_mounts = {"/app/config.toml": ("config.toml", True),
                       "/data": ("data", False), "/run/secrets": ("secrets", True)}
    if set(mounts) != set(expected_mounts):
        raise ValueError("Unexpected runtime bind mounts; preserving Compose for review.")
    for target, (relative, readonly) in expected_mounts.items():
        mount = mounts[target]
        if (mount.get("type") != "bind" or mount.get("source") != str(runtime / relative)
                or bool(mount.get("read_only")) != readonly
                or mount.get("bind", {}).get("create_host_path", False)):
            raise ValueError(f"Unexpected runtime bind mount for {target}.")
    health = service.get("healthcheck", {})
    if health.get("disable") or "http://127.0.0.1:555/admin" not in health.get("test", []):
        raise ValueError("Runtime health check must use plain HTTP on port 555.")


def validate_routes(http: dict, mqtt: dict, marker: str, gateway: str) -> str:
    address = ipaddress.IPv4Address(gateway)
    if address.is_unspecified or address.is_multicast or address.is_loopback:
        raise ValueError("Expected one Docker bridge gateway IPv4 address.")
    gateway = str(address)
    for response, port in ((http, 555), (mqtt, 18881)):
        if response.get("marker") != marker or response.get("port") != port:
            raise ValueError(f"Nginx did not reach the setup probe on backend {port}.")
        if response.get("peer") != gateway:
            raise ValueError("Nginx's measured proxy address differs from the Docker gateway; review before trusting it.")
    if (http.get("host") not in {FQDN, FQDN + ":443"}
            or http.get("forwarded_proto") != "https"
            or http.get("forwarded_for", "").strip() != SERVER_IP):
        raise ValueError("HTTPS must preserve Host and send X-Forwarded-Proto / X-Forwarded-For.")
    return gateway


def serve(marker: str) -> None:
    if not re.fullmatch(r"[a-f0-9]{32}", marker):
        raise ValueError("Invalid setup probe marker.")

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != "/__roborock_setup_" + marker:
                self.send_error(404)
                return
            payload = json.dumps({
                "marker": marker, "port": self.server.server_port,
                "peer": self.client_address[0], "host": self.headers.get("Host", ""),
                "forwarded_proto": self.headers.get("X-Forwarded-Proto", ""),
                "forwarded_for": self.headers.get("X-Forwarded-For", ""),
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass

    with ThreadingHTTPServer(("0.0.0.0", 555), Handler) as http, \
            ThreadingHTTPServer(("0.0.0.0", 18881), Handler) as mqtt:
        threading.Thread(target=mqtt.serve_forever, daemon=True).start()
        http.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    server = commands.add_parser("serve")
    server.add_argument("marker")
    compose = commands.add_parser("compose")
    compose.add_argument("config", type=Path)
    compose.add_argument("image")
    compose.add_argument("runtime", type=Path)
    routes = commands.add_parser("routes")
    routes.add_argument("http", type=Path)
    routes.add_argument("mqtt", type=Path)
    routes.add_argument("marker")
    routes.add_argument("gateway")
    args = parser.parse_args()
    if args.command == "serve":
        serve(args.marker)
    elif args.command == "compose":
        validate_compose(json.loads(args.config.read_text()), args.image, args.runtime)
    else:
        print(validate_routes(json.loads(args.http.read_text()), json.loads(args.mqtt.read_text()),
                              args.marker, args.gateway))


if __name__ == "__main__":
    main()
