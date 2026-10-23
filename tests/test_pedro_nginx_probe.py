"""Guard against trusting an unrelated route or exposing plaintext backends."""

import copy
import importlib.util
from pathlib import Path
import unittest


_SCRIPT = Path(__file__).resolve().parents[1] / "scripts/pedro_nginx_probe.py"
_SPEC = importlib.util.spec_from_file_location("pedro_nginx_probe", _SCRIPT)
assert _SPEC and _SPEC.loader
helper = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(helper)


class PedroNginxProbeTests(unittest.TestCase):
    def setUp(self):
        self.marker = "a" * 32
        self.gateway = "172.20.0.1"
        self.http = {"marker": self.marker, "port": 555, "peer": self.gateway,
                     "host": helper.FQDN, "forwarded_proto": "https", "forwarded_for": helper.SERVER_IP}
        self.mqtt = {"marker": self.marker, "port": 18881, "peer": self.gateway}

    def test_accepts_matching_routes_and_measured_gateway(self):
        self.assertEqual(helper.validate_routes(self.http, self.mqtt, self.marker, self.gateway), self.gateway)

    def test_rejects_stale_probe_and_wrong_upstream_or_peer(self):
        for key, value in (("marker", "old"), ("port", 8881), ("peer", "172.17.0.1")):
            for side in ("http", "mqtt"):
                http, mqtt = copy.deepcopy(self.http), copy.deepcopy(self.mqtt)
                (http if side == "http" else mqtt)[key] = value
                with self.subTest(side=side, key=key), self.assertRaises(ValueError):
                    helper.validate_routes(http, mqtt, self.marker, self.gateway)

    def test_rejects_missing_or_rewritten_http_headers(self):
        for key, value in (("host", "192.168.84.2:555"), ("forwarded_proto", "http"),
                           ("forwarded_for", ""), ("forwarded_for", "192.168.69.140")):
            http = dict(self.http, **{key: value})
            with self.subTest(key=key), self.assertRaises(ValueError):
                helper.validate_routes(http, self.mqtt, self.marker, self.gateway)

    def test_cannot_trust_a_range_or_multiple_gateways(self):
        for gateway in ("172.20.0.0/16", "172.20.0.1\nfd00::1", "0.0.0.0", "127.0.0.1"):
            with self.subTest(gateway=gateway), self.assertRaises(ValueError):
                helper.validate_routes(self.http, self.mqtt, self.marker, gateway)

    def compose(self):
        runtime = Path("/opt/local_roborock_server")
        service = {
            "image": "local/test:built", "networks": {"default": None},
            "ports": [{"host_ip": "127.0.0.1", "published": str(p), "target": p, "protocol": "tcp"}
                      for p in (555, 18881)],
            "volumes": [{"type": "bind", "source": str(runtime / source), "target": target,
                         "read_only": readonly, "bind": {}}
                        for source, target, readonly in (("config.toml", "/app/config.toml", True),
                                                         ("data", "/data", False),
                                                         ("secrets", "/run/secrets", True))],
            "healthcheck": {"test": ["CMD", "curl", "-skf", "http://127.0.0.1:555/admin"]},
        }
        return {"name": helper.PROJECT, "services": {helper.SERVICE: service},
                "networks": {"default": {"name": helper.PROJECT + "_default"}}}, runtime

    def test_accepts_loopback_compose(self):
        config, runtime = self.compose()
        helper.validate_compose(config, "local/test:built", runtime)

    def test_rejects_unsafe_binding_https_healthcheck_and_different_network(self):
        for change in ("bind", "health", "network", "mount", "image"):
            config, runtime = self.compose()
            service = config["services"][helper.SERVICE]
            if change == "bind":
                service["ports"][0]["host_ip"] = "0.0.0.0"
            elif change == "health":
                service["healthcheck"]["test"][-1] = "https://127.0.0.1:555/admin"
            elif change == "network":
                config["networks"]["default"]["name"] = "another-network"
            elif change == "mount":
                service["volumes"][0]["bind"]["create_host_path"] = True
            else:
                service["image"] = "another-image"
            with self.subTest(change=change), self.assertRaises(ValueError):
                helper.validate_compose(config, "local/test:built", runtime)


if __name__ == "__main__":
    unittest.main()
