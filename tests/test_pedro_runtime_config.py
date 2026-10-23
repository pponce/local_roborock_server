"""Regression checks for the first-install helper's credentials and preservation."""

import contextlib
from datetime import datetime, timedelta, timezone
import importlib.util
import io
from pathlib import Path
import ssl
import tempfile
import unittest
from unittest.mock import patch

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from roborock_local_server.config import load_config
from roborock_local_server.security import verify_password


_SCRIPT = Path(__file__).resolve().parents[1] / "scripts/pedro_runtime_config.py"
_SPEC = importlib.util.spec_from_file_location("pedro_runtime_config", _SCRIPT)
assert _SPEC and _SPEC.loader
helper = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(helper)


class PedroRuntimeConfigTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.runtime = Path(self.directory.name)

    def create(self, **kwargs):
        output = io.StringIO()
        with patch.object(helper, "getpass", side_effect=["local-password", "local-password", "482951", "482951"]), \
                patch("builtins.input", return_value="person@example.com"), \
                contextlib.redirect_stdout(output):
            helper.prepare_config(self.runtime, **kwargs)
        return output.getvalue()

    def test_credentials_work_without_storing_or_printing_plaintext_secrets(self):
        output = self.create()
        path = self.runtime / "config.toml"
        config = load_config(path)
        self.assertTrue(verify_password("local-password", config.admin.password_hash))
        self.assertTrue(verify_password("482951", config.admin.protocol_login_pin_hash))
        self.assertFalse(verify_password("000000", config.admin.protocol_login_pin_hash))
        for value in ("local-password", "482951"):
            self.assertNotIn(value, path.read_text())
            self.assertNotIn(value, output)
        self.assertEqual(config.network.timezone, "America/Los_Angeles")
        self.assertEqual(config.tls.mode, "provided")
        self.assertEqual(config.broker.mode, "embedded")
        self.assertEqual(config.turn.mode, "disabled")
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.runtime / ".env").stat().st_mode & 0o777, 0o600)

    def test_retry_preserves_credentials_and_other_secrets(self):
        self.create()
        original = (self.runtime / "config.toml").read_bytes()
        secrets_dir = self.runtime / "secrets"
        secrets_dir.mkdir()
        other_secret = secrets_dir / "cloudflare_token"
        other_secret.write_text("preserve-this-existing-secret")
        with patch.object(helper, "getpass", side_effect=AssertionError("must not prompt")):
            helper.prepare_config(self.runtime)
        self.assertEqual((self.runtime / "config.toml").read_bytes(), original)
        self.assertEqual(other_secret.read_text(), "preserve-this-existing-secret")

    def test_different_config_is_not_changed_or_given_a_new_environment(self):
        self.create()
        path = self.runtime / "config.toml"
        changed = path.read_text().replace("America/Los_Angeles", "America/New_York")
        path.write_text(changed)
        (self.runtime / ".env").unlink()
        with self.assertRaisesRegex(ValueError, "network.timezone"):
            helper.prepare_config(self.runtime)
        self.assertEqual(path.read_text(), changed)
        self.assertFalse((self.runtime / ".env").exists())

    def test_different_environment_prevents_credential_creation(self):
        path = self.runtime / ".env"
        path.write_text("ROBOROCK_SERVER_BIND_IP=127.0.0.1\n")
        with patch.object(helper, "getpass", side_effect=AssertionError("must not prompt")), \
                self.assertRaisesRegex(ValueError, "environment differs"):
            helper.prepare_config(self.runtime)
        self.assertFalse((self.runtime / "config.toml").exists())
        self.assertEqual(path.read_text(), "ROBOROCK_SERVER_BIND_IP=127.0.0.1\n")

    def test_symlink_cannot_redirect_configuration_writes(self):
        target = self.runtime / "unrelated"
        target.write_text("leave this alone")
        (self.runtime / "config.toml").symlink_to(target)
        with self.assertRaisesRegex(ValueError, "ordinary file"):
            helper.prepare_config(self.runtime)
        self.assertEqual(target.read_text(), "leave this alone")

    def test_pin_rejects_invalid_or_unconfirmed_input(self):
        with patch.object(helper, "getpass", side_effect=["12", "abcdef", "111111", "222222", "482951", "482951"]):
            self.assertEqual(helper._new_secret("PIN: ", pin=True), "482951")

    def make_certificates(self, *, mismatched=False):
        certificate_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, helper.FQDN)])
        now = datetime.now(timezone.utc)
        certificate = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                       .public_key(certificate_key.public_key()).serial_number(x509.random_serial_number())
                       .not_valid_before(now - timedelta(minutes=1)).not_valid_after(now + timedelta(days=1))
                       .sign(certificate_key, hashes.SHA256()))
        directory = self.runtime / "data/certs"
        directory.mkdir(parents=True)
        (directory / "fullchain.pem").write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048) if mismatched else certificate_key
        (directory / "privkey.pem").write_bytes(private_key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))

    def test_main_rejects_mismatched_certificate_before_prompting(self):
        self.make_certificates(mismatched=True)
        with patch("sys.argv", ["setup", "--runtime", str(self.runtime)]), \
                patch.object(helper, "getpass", side_effect=AssertionError("must not prompt")), \
                self.assertRaises(ssl.SSLError):
            helper.main()
        self.assertFalse((self.runtime / "config.toml").exists())

    def test_main_accepts_a_matching_certificate_pair(self):
        self.make_certificates()
        self.create()
        with patch("sys.argv", ["setup", "--runtime", str(self.runtime)]), \
                patch.object(helper, "getpass", side_effect=AssertionError("must not prompt")):
            helper.main()

    def test_nginx_uses_public_ports_and_loopback_plaintext_backends_without_certificates(self):
        self.create(nginx_proxy="172.20.0.1")
        config = load_config(self.runtime / "config.toml")
        self.assertEqual(config.network.listener_mode, "external_tls")
        self.assertEqual((config.network.https_port, config.network.mqtt_tls_port), (555, 18881))
        self.assertEqual((config.network.advertised_https_port, config.network.advertised_mqtt_tls_port), (443, 8881))
        self.assertEqual(config.network.trusted_proxies, ("172.20.0.1",))
        self.assertEqual((config.tls.cert_file, config.tls.key_file), ("", ""))
        env = (self.runtime / ".env").read_text()
        self.assertIn("ROBOROCK_SERVER_BIND_IP=127.0.0.1\n", env)
        self.assertIn("ROBOROCK_SERVER_HEALTHCHECK_SCHEME=http\n", env)
        self.assertFalse((self.runtime / "data/certs").exists())
        original = (self.runtime / "config.toml").read_bytes()
        with patch("sys.argv", ["setup", "--runtime", str(self.runtime), "--nginx-proxy", "172.20.0.1"]), \
                patch.object(helper, "getpass", side_effect=AssertionError("must not prompt")):
            helper.main()
        self.assertEqual((self.runtime / "config.toml").read_bytes(), original)

    def test_nginx_refuses_a_changed_gateway_without_replacing_credentials(self):
        self.create(nginx_proxy="172.20.0.1")
        original = (self.runtime / "config.toml").read_bytes()
        with self.assertRaisesRegex(ValueError, "trusted_proxies"):
            helper.prepare_config(self.runtime, nginx_proxy="172.21.0.1")
        self.assertEqual((self.runtime / "config.toml").read_bytes(), original)

    def test_nginx_does_not_silently_convert_an_existing_direct_tls_installation(self):
        self.create()
        original = (self.runtime / "config.toml").read_bytes()
        with self.assertRaisesRegex(ValueError, "environment differs"):
            helper.prepare_config(self.runtime, nginx_proxy="172.20.0.1")
        self.assertEqual((self.runtime / "config.toml").read_bytes(), original)

    def test_nginx_rejects_unmeasured_proxy_ranges_before_prompting(self):
        for value in ("*", "172.20.0.0/16", "0.0.0.0", "127.0.0.1", "::1", "224.0.0.1"):
            with self.subTest(value=value), self.assertRaises(ValueError), \
                    patch.object(helper, "getpass", side_effect=AssertionError("must not prompt")):
                helper.prepare_config(self.runtime, nginx_proxy=value)
        self.assertFalse((self.runtime / "config.toml").exists())


if __name__ == "__main__":
    unittest.main()
