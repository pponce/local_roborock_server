"""Dashboard edits use the same persistent jobs without rewriting robot settings."""

import copy
from datetime import datetime
import json

from fastapi.testclient import TestClient
import pytest

from conftest import write_release_config
from roborock_local_server.config import load_config, resolve_paths
from roborock_local_server.server import ReleaseSupervisor
from roborock_local_server import admin_schedules


@pytest.fixture
def schedule_admin(tmp_path):
    config_file = write_release_config(tmp_path)
    config = load_config(config_file)
    paths = resolve_paths(config_file, config)
    paths.inventory_path.parent.mkdir(parents=True, exist_ok=True)
    native_job = {
        "id": 701, "cron": "15 10 * * 1,3,5", "enabled": True, "repeated": True,
        "timeZoneId": "America/Los_Angeles", "type": "clean", "future_job_field": "preserve-me",
        "param": {"method": "server_scheduled_start", "id": 1, "params": [{
            "name": "native-test-timer", "segments": "16,18", "map_index": 0,
            "fan_power": 102, "mop_mode": 300, "mop_template_id": 4,
            "water_box_mode": 202, "clean_order_mode": 1, "repeat": 1,
            "future_setting": {"preserve": [1, 2, 3]}, "secret": "PRIVATE_SETTING",
        }]},
        "opaque": "PRIVATE_JOB_DATA",
    }
    inventory = {
        "devices": [{"duid": "test-vacuum", "name": "Test downstairs", "model": "roborock.vacuum.a15",
                     "localKey": "PRIVATE_DEVICE_KEY"}],
        "schedules": {"test-vacuum": [native_job]},
        "schedule_occurrences": {"test-vacuum": {"701": {"claimed_at": 12345}}},
    }
    paths.inventory_path.write_text(json.dumps(inventory), encoding="utf-8")
    supervisor = ReleaseSupervisor(config=config, paths=paths)
    client = TestClient(supervisor.app)
    yield client, supervisor, paths, native_job
    client.close()


def login(client):
    assert client.post("/admin/api/login", json={"password": "correct horse battery staple"}).status_code == 200


def row(client):
    response = client.get("/admin/api/schedules")
    assert response.status_code == 200
    device = next(device for device in response.json()["devices"] if device["duid"] == "test-vacuum")
    return device["schedules"][0]


def patch(client, **fields):
    return client.patch("/admin/api/schedules/test-vacuum/701", json=fields)


def test_schedule_routes_require_admin_session(schedule_admin):
    client, _, paths, _ = schedule_admin
    before = paths.inventory_path.read_bytes()
    assert client.get("/admin/api/schedules").status_code == 401
    assert patch(client, revision="unknown", enabled=False).status_code == 401
    assert paths.inventory_path.read_bytes() == before


def test_lists_native_imports_and_next_run_without_exposing_inventory(schedule_admin):
    client, _, _, _ = schedule_admin
    login(client)
    response = client.get("/admin/api/schedules")
    assert response.headers["cache-control"] == "no-store"
    data = row(client)
    assert data["id"] == 701
    assert data["enabled"] is True
    assert data["native_timer_name"] == "native-test-timer"
    assert data["native_timer_state"] == "not_checked"
    assert data["editable"] is True
    assert datetime.fromisoformat(data["next_run_at"]).utcoffset().total_seconds() == 0
    assert data["settings"]["segments"] == "16,18"
    assert data["settings"]["map_index"] == 0
    for secret in ("PRIVATE_SETTING", "PRIVATE_JOB_DATA", "PRIVATE_DEVICE_KEY", "future_setting"):
        assert secret not in response.text


def test_edit_preserves_native_settings_unknown_fields_and_occurrence_claim(schedule_admin):
    client, _, paths, original = schedule_admin
    login(client)
    revision = row(client)["revision"]
    response = patch(client, revision=revision, cron="30 11 * * 0,6", timeZoneId="America/New_York")
    assert response.status_code == 200
    assert response.json()["schedule"]["revision"] != revision
    stored = json.loads(paths.inventory_path.read_text())
    changed = stored["schedules"]["test-vacuum"][0]
    expected = {**original, "cron": "30 11 * * 0,6", "timeZoneId": "America/New_York"}
    assert changed == expected
    assert stored["schedule_occurrences"]["test-vacuum"]["701"] == {"claimed_at": 12345}


def test_server_gate_does_not_claim_to_change_native_timer(schedule_admin):
    client, _, paths, original = schedule_admin
    login(client)
    response = patch(client, revision=row(client)["revision"], enabled=False)
    assert response.status_code == 200
    updated = response.json()["schedule"]
    assert updated["enabled"] is False
    assert updated["next_run_at"] is None
    assert updated["native_timer_state"] == "not_checked"
    stored = json.loads(paths.inventory_path.read_text())["schedules"]["test-vacuum"][0]
    assert stored["param"] == original["param"]
    assert stored["cron"] == original["cron"]


def test_stale_browser_revision_does_not_overwrite_another_client(schedule_admin):
    client, _, paths, _ = schedule_admin
    login(client)
    revision = row(client)["revision"]
    inventory = json.loads(paths.inventory_path.read_text())
    inventory["schedules"]["test-vacuum"][0]["cron"] = "45 14 * * *"
    paths.inventory_path.write_text(json.dumps(inventory))
    before = paths.inventory_path.read_bytes()
    assert patch(client, revision=revision, enabled=False).status_code == 409
    assert paths.inventory_path.read_bytes() == before


def test_change_between_validation_and_write_is_rejected(schedule_admin, monkeypatch):
    client, _, paths, _ = schedule_admin
    login(client)
    revision = row(client)["revision"]
    real_upsert = admin_schedules.upsert_job

    def racing_upsert(*args, **kwargs):
        inventory = json.loads(paths.inventory_path.read_text())
        inventory["schedules"]["test-vacuum"][0]["cron"] = "5 9 * * *"
        paths.inventory_path.write_text(json.dumps(inventory))
        return real_upsert(*args, **kwargs)

    monkeypatch.setattr(admin_schedules, "upsert_job", racing_upsert)
    assert patch(client, revision=revision, enabled=False).status_code == 409
    stored = json.loads(paths.inventory_path.read_text())["schedules"]["test-vacuum"][0]
    assert stored["cron"] == "5 9 * * *"
    assert stored["enabled"] is True


@pytest.mark.parametrize("fields", [
    {"enabled": "false"}, {"enabled": 0}, {"cron": "65 8 * * *"}, {"cron": []},
    {"timeZoneId": "Not/A_Zone"}, {"timeZoneId": ""}, {"timeZoneId": None},
    {"param": {"params": []}}, {"id": 800}, {"repeated": False},
])
def test_invalid_or_out_of_scope_edits_do_not_write(schedule_admin, fields):
    client, _, paths, _ = schedule_admin
    login(client)
    revision = row(client)["revision"]
    before = paths.inventory_path.read_bytes()
    assert patch(client, revision=revision, **fields).status_code == 400
    assert paths.inventory_path.read_bytes() == before


def test_one_time_imports_are_visible_but_read_only(schedule_admin):
    client, _, paths, _ = schedule_admin
    inventory = json.loads(paths.inventory_path.read_text())
    inventory["schedules"]["test-vacuum"][0]["repeated"] = "false"
    paths.inventory_path.write_text(json.dumps(inventory))
    login(client)
    data = row(client)
    assert data["editable"] is False
    assert data["repeated"] is False
    assert patch(client, revision=data["revision"], enabled=False).status_code == 409


def test_missing_and_duplicate_jobs_are_not_created_or_arbitrarily_edited(schedule_admin):
    client, _, paths, original = schedule_admin
    login(client)
    assert client.patch("/admin/api/schedules/test-vacuum/999", json={
        "revision": "unknown", "enabled": False,
    }).status_code == 404
    inventory = json.loads(paths.inventory_path.read_text())
    inventory["schedules"]["test-vacuum"].append(copy.deepcopy(original))
    paths.inventory_path.write_text(json.dumps(inventory))
    assert patch(client, revision=admin_schedules._revision(original), enabled=False).status_code == 409


def test_write_failure_and_corrupt_inventory_are_not_acknowledged(schedule_admin, monkeypatch):
    client, _, paths, _ = schedule_admin
    login(client)
    revision = row(client)["revision"]

    def cannot_save(*args, **kwargs):
        raise OSError("PRIVATE_FILESYSTEM_DETAIL")

    monkeypatch.setattr(admin_schedules, "upsert_job", cannot_save)
    response = patch(client, revision=revision, enabled=False)
    assert response.status_code == 500
    assert "PRIVATE_FILESYSTEM_DETAIL" not in response.text
    paths.inventory_path.write_text("not valid JSON")
    assert client.get("/admin/api/schedules").status_code == 500
    assert patch(client, revision=revision, enabled=False).status_code == 500
    assert paths.inventory_path.read_text() == "not valid JSON"


def test_rejects_cross_origin_and_non_json_edits(schedule_admin):
    client, _, paths, _ = schedule_admin
    login(client)
    revision = row(client)["revision"]
    before = paths.inventory_path.read_bytes()
    response = client.patch("/admin/api/schedules/test-vacuum/701",
        json={"revision": revision, "enabled": False}, headers={"Origin": "https://elsewhere.example"})
    assert response.status_code == 403
    assert client.patch("/admin/api/schedules/test-vacuum/701", content="{}").status_code == 415
    assert client.patch("/admin/api/schedules/test-vacuum/701", content="[]",
                        headers={"Content-Type": "application/json"}).status_code == 400
    assert paths.inventory_path.read_bytes() == before
