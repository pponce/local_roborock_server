#!/usr/bin/env python3
"""Probe camera DNS/TLS/bootstrap without displaying returned credentials.

This sends a host-generated HTTPS request. It does not read robot settings,
test the robot's TLS trust store, or establish authenticated TURN connectivity.
Requires Python 3.9+; uses only the standard library and makes no config edits.
"""

import argparse
import json
import socket
import ssl
import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def summarize(payload, expected_url):
    """Return only booleans and a numeric status, never credential values."""
    payload = payload if isinstance(payload, dict) else {}
    sections = [payload.get(key) for key in ("data", "result")]
    sections = [value for value in sections if isinstance(value, dict)]
    code = payload.get("code")
    return {
        "Response code": code if type(code) is int else None,
        "Expected TURN endpoint present": any(
            value.get("url") == expected_url for value in sections
        ),
        "TURN credentials present (values hidden)": any(
            all(isinstance(value.get(key), str) and value[key] for key in pair)
            for value in sections
            for pair in (("user", "pwd"), ("username", "credential"))
        ),
    }


def inspect_tls(host, context):
    print("\nHOST:", host)
    try:
        addresses = sorted({
            item[4][0] for item in socket.getaddrinfo(
                host, 443, socket.AF_INET, socket.SOCK_STREAM
            )
        })
        print("DNS IPv4:", ", ".join(addresses))
        with socket.create_connection((host, 443), timeout=8) as connection:
            with context.wrap_socket(connection, server_hostname=host):
                print("TLS trust and hostname verification: PASS")
    except Exception as exc:
        # Exception strings can include unexpected remote data; print type only.
        print("DNS/TLS check FAILED:", type(exc).__name__)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-host", required=True)
    parser.add_argument("--camera-host", required=True)
    parser.add_argument("--turn-host", help="Defaults to the camera hostname")
    parser.add_argument("--turn-port", type=int, default=3478)
    args = parser.parse_args()

    # Names only: paths, ports, URL credentials, and non-ASCII IDNs are excluded.
    for host in (args.api_host, args.camera_host, args.turn_host):
        if host is not None and (
            not host or not host.isascii()
            or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-." for c in host)
        ):
            print("Use ASCII hostnames only, without a scheme, port, or path.")
            return
    if not 1 <= args.turn_port <= 65535:
        print("TURN port must be between 1 and 65535.")
        return

    candidate = args.camera_host + "/"
    print("Candidate bootstrap length:", len(candidate), "(limit 15)")
    print("Candidate fits:", len(candidate) <= 15)
    print("This is NOT a read-back of the robot's saved token.r.")
    context = ssl.create_default_context()
    for host in dict.fromkeys((args.api_host, args.camera_host)):
        inspect_tls(host, context)

    print("\nCAMERA BOOTSTRAP: host-generated diagnostic request")
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        urllib.request.HTTPSHandler(context=context),
        NoRedirect(),
    )
    request = urllib.request.Request(
        "https://" + args.camera_host + "/iot.roborock.com/fwapi/createca",
        data=b"{}",
        headers={
            "Content-Type": "application/json",
            "User-Agent": "S7MaxV-docs-readonly-preflight",
        },
    )
    expected_url = "turn:" + (args.turn_host or args.camera_host) + ":" + str(args.turn_port)
    try:
        with opener.open(request, timeout=10) as response:
            print("HTTP status:", response.status)
            payload = json.loads(response.read(65537))
        for label, value in summarize(payload, expected_url).items():
            print(label + ":", value)
    except urllib.error.HTTPError as exc:
        print("Bootstrap HTTP status:", exc.code)
    except Exception as exc:
        print("Bootstrap check FAILED:", type(exc).__name__)
    print("Robot bootstrap, TURN allocation, and app video still require a live test.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Check interrupted; no configuration changed.")
