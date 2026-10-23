"""Create Pedro's initial configuration inside the already-built Docker image."""

from __future__ import annotations

import argparse
from getpass import getpass
import os
from pathlib import Path
import re
import secrets
import ssl

from roborock_local_server.config import load_config
from roborock_local_server.configure import ConfigureAnswers, hash_password, render_config_toml


FQDN = "api-roborock.onefallday.com"
TIMEZONE = "America/Los_Angeles"
COMPOSE_ENV = (
    "ROBOROCK_SERVER_BIND_IP=192.168.84.2\n"
    "ROBOROCK_SERVER_HTTPS_PORT=555\n"
    "ROBOROCK_SERVER_MQTT_TLS_PORT=8881\n"
)


def validate_config(path: Path) -> None:
    config = load_config(path)
    expected = {
        "network": {
            "stack_fqdn": FQDN, "timezone": TIMEZONE, "region": "us",
            "bind_host": "0.0.0.0", "listener_mode": "local_tls",
            "https_port": 555, "mqtt_tls_port": 8881,
            "advertised_https_port": 555, "advertised_mqtt_tls_port": 8881,
        },
        "broker": {"mode": "embedded", "host": "127.0.0.1", "port": 18830},
        "storage": {"data_dir": "/data"},
        "tls": {
            "mode": "provided", "cert_file": "/data/certs/fullchain.pem",
            "key_file": "/data/certs/privkey.pem",
        },
        "admin": {"protocol_auth_enabled": True, "new_connections_enabled": True},
        "turn": {"mode": "disabled"},
    }
    for section, fields in expected.items():
        for name, value in fields.items():
            if getattr(getattr(config, section), name) != value:
                raise ValueError(f"Existing {section}.{name} differs; preserving configuration for review.")
    if not all((config.admin.password_hash, config.admin.session_secret,
                config.admin.protocol_login_email, config.admin.protocol_login_pin_hash)):
        raise ValueError("Local login credentials are incomplete; preserving configuration for review.")


def _new_secret(prompt: str, *, pin: bool = False) -> str:
    while True:
        value = getpass(prompt).strip()
        if not value or (pin and not re.fullmatch(r"[0-9]{6}", value)):
            print("Enter exactly six digits." if pin else "Enter a nonempty password.")
            continue
        if value != getpass("Confirm: ").strip():
            print("The entries did not match. Try again.")
            continue
        return value


def _write_new(path: Path, content: str) -> None:
    # Exclusive creation also rejects symlinks and avoids replacing existing secrets.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(content)


def prepare_config(runtime: Path) -> None:
    config_path, env_path = runtime / "config.toml", runtime / ".env"
    for path in (config_path, env_path):
        if path.is_symlink() or (path.exists() and not path.is_file()):
            raise ValueError(f"Expected an ordinary file at {path.name}; preserving it.")
    if env_path.exists() and env_path.read_text(encoding="utf-8") != COMPOSE_ENV:
        raise ValueError("Existing Compose environment differs; preserving it for review.")

    if config_path.exists():
        validate_config(config_path)
        print("Reusing the existing, matching configuration and login credentials.")
    else:
        print("Choose LOCAL credentials. Cloud import uses Roborock's verification code later.")
        password = _new_secret("New local dashboard admin password (hidden): ")
        while True:
            email = input("Local app/plugin login email (your usual email is fine): ").strip()
            if re.fullmatch(r"[^\s@]+@[^\s@]+", email):
                break
            print("Enter an email address.")
        pin = _new_secret("New local app/plugin PIN (six digits, hidden): ", pin=True)
        answers = ConfigureAnswers(
            stack_fqdn=FQDN, https_port=555, mqtt_tls_port=8881,
            broker_mode="embedded", tls_mode="provided", base_domain="", email="",
            acme_server="zerossl", acme_eab_kid="", acme_eab_hmac_key="", cloudflare_token="",
            password_hash=hash_password(password), session_secret=secrets.token_urlsafe(32),
            protocol_login_email=email, protocol_login_pin_hash=hash_password(pin),
        )
        rendered = render_config_toml(answers)
        if not rendered.startswith("[network]\n"):
            raise ValueError("Unexpected configuration template; no configuration was written.")
        rendered = rendered.replace("[network]\n", f'[network]\ntimezone = "{TIMEZONE}"\n', 1)
        _write_new(config_path, rendered)
        validate_config(config_path)
    if not env_path.exists():
        _write_new(env_path, COMPOSE_ENV)
    print(f"Configuration validated: {FQDN}, HTTPS 555, MQTT TLS 8881, {TIMEZONE}.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, default=Path("/work"))
    args = parser.parse_args()
    # Empty password rejects encrypted keys without falling back to an interactive prompt.
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(
        args.runtime / "data/certs/fullchain.pem",
        args.runtime / "data/certs/privkey.pem", password="",
    )
    print("Certificate and private key match and can be loaded by the server.")
    prepare_config(args.runtime)


if __name__ == "__main__":
    main()
