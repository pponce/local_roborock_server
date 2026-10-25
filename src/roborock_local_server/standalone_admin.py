"""Standalone admin/dashboard adapter routes.

Presentation lives in the packaged admin_ui directory; API contracts stay here.
"""

from __future__ import annotations

from functools import lru_cache
from importlib.resources import files
import json
from typing import Any
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response

from .security import verify_password

_ADMIN_ASSETS = {
    "admin.css": "text/css",
    "admin.js": "text/javascript",
    "login.js": "text/javascript",
}


@lru_cache(maxsize=5)
def _admin_asset(name: str) -> str:
    return files("roborock_local_server").joinpath("admin_ui", name).read_text(encoding="utf-8")


def _admin_login_html() -> str:
    return _admin_asset("login.html")


def _admin_dashboard_html(project_support: dict[str, Any]) -> str:
    # Keep configuration data inert even if a label contains an HTML closing tag.
    support_payload = json.dumps(project_support).replace("<", "\\u003c")
    return _admin_asset("dashboard.html").replace("__PROJECT_SUPPORT__", support_payload)


def register_standalone_admin_routes(
    *,
    app: FastAPI,
    supervisor: Any,
    project_support: dict[str, Any],
) -> None:
    # The supervisor has initialized the shared backend imports before creating
    # the app. Use those same modules/locks for dashboard schedule edits.
    from .admin_schedules import register_schedule_routes

    register_schedule_routes(app, supervisor)

    @app.get("/admin/assets/{asset_name}")
    async def admin_asset(asset_name: str) -> Response:
        media_type = _ADMIN_ASSETS.get(asset_name)
        if media_type is None:
            return JSONResponse({"error": "Asset not found"}, status_code=404)
        return Response(_admin_asset(asset_name), media_type=media_type,
                        headers={"Cache-Control": "no-cache"})

    @app.get("/admin", response_class=HTMLResponse)
    async def admin_page(request: Request) -> HTMLResponse:
        if not supervisor._authenticated(request):
            return HTMLResponse(_admin_login_html(), headers={"Cache-Control": "no-store"})
        return HTMLResponse(_admin_dashboard_html(project_support), headers={"Cache-Control": "no-store"})

    @app.post("/admin/api/login")
    async def admin_login(request: Request) -> JSONResponse:
        try:
            body = await request.json()
        except json.JSONDecodeError:
            body = {}
        password = str((body or {}).get("password") or "")
        if not verify_password(password, supervisor.config.admin.password_hash):
            return JSONResponse({"error": "Invalid password"}, status_code=401)
        response = JSONResponse({"ok": True})
        response.set_cookie(
            supervisor.session_manager.cookie_name,
            supervisor.session_manager.issue(),
            httponly=True,
            secure=supervisor.cookie_secure(request),
            samesite="lax",
            max_age=supervisor.config.admin.session_ttl_seconds,
            path="/",
        )
        return response

    @app.post("/admin/api/logout")
    async def admin_logout() -> JSONResponse:
        response = JSONResponse({"ok": True})
        response.delete_cookie(supervisor.session_manager.cookie_name, path="/")
        return response

    @app.get("/admin/api/status")
    async def admin_status(request: Request) -> JSONResponse:
        supervisor._require_admin(request)
        return JSONResponse(supervisor._status_payload())

    @app.get("/admin/api/vacuums")
    async def admin_vacuums(request: Request) -> JSONResponse:
        supervisor._require_admin(request)
        return JSONResponse(supervisor._vacuums_payload())

    @app.get("/admin/api/auth")
    async def admin_auth(request: Request) -> JSONResponse:
        supervisor._require_admin(request)
        return JSONResponse(supervisor._auth_payload())

    @app.delete("/admin/api/vacuums/{duid}/mqtt-credentials")
    async def admin_clear_mqtt_credentials(duid: str, request: Request) -> JSONResponse:
        supervisor._require_admin(request)
        origin = request.headers.get("origin")
        if origin:
            try:
                parsed = urlsplit(origin)
            except ValueError:
                return JSONResponse({"error": "Invalid request origin"}, status_code=403)
            if parsed.scheme not in ("http", "https") or parsed.netloc.casefold() != request.headers.get("host", "").casefold():
                return JSONResponse({"error": "Cross-origin credential changes are not allowed"}, status_code=403)
        try:
            payload = supervisor.clear_device_mqtt_credentials(duid=duid)
        except KeyError:
            return JSONResponse({"error": "Vacuum not found"}, status_code=404)
        except OSError:
            return JSONResponse({"error": "Could not save the credential reset. Please try again."}, status_code=500)
        return JSONResponse(payload)

    @app.post("/admin/api/auth")
    async def admin_auth_update(request: Request) -> JSONResponse:
        supervisor._require_admin(request)
        try:
            body = await request.json()
        except json.JSONDecodeError:
            return JSONResponse({"error": "Invalid JSON body"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "JSON body must be an object"}, status_code=400)
        if "new_connections_enabled" in body:
            new_connections_enabled = body.get("new_connections_enabled")
            if not isinstance(new_connections_enabled, bool):
                return JSONResponse({"error": "new_connections_enabled must be a boolean"}, status_code=400)
            try:
                payload = supervisor.set_new_connections_enabled(new_connections_enabled)
            except Exception as exc:  # noqa: BLE001
                return JSONResponse({"error": str(exc)}, status_code=500)
            return JSONResponse(payload)
        if "protocol_auth_enabled" in body:
            protocol_auth_enabled = body.get("protocol_auth_enabled")
            if not isinstance(protocol_auth_enabled, bool):
                return JSONResponse({"error": "protocol_auth_enabled must be a boolean"}, status_code=400)
            try:
                payload = supervisor.set_protocol_auth_enabled(protocol_auth_enabled)
            except Exception as exc:  # noqa: BLE001
                return JSONResponse({"error": str(exc)}, status_code=500)
            return JSONResponse(payload)
        return JSONResponse(
            {"error": "new_connections_enabled or protocol_auth_enabled is required"},
            status_code=400,
        )

    @app.delete("/admin/api/auth/sessions/{hawk_id}/{hawk_session}")
    async def admin_auth_delete_session(hawk_id: str, hawk_session: str, request: Request) -> JSONResponse:
        supervisor._require_admin(request)
        if not supervisor.remove_protocol_session(hawk_id=hawk_id, hawk_session=hawk_session):
            return JSONResponse({"error": "Protocol session not found"}, status_code=404)
        return JSONResponse({"ok": True, "auth": supervisor._auth_payload()})

    @app.get("/admin/api/onboarding/devices")
    async def admin_onboarding_devices(request: Request) -> JSONResponse:
        supervisor._require_admin(request)
        return JSONResponse(supervisor._onboarding_devices_payload())

    @app.post("/admin/api/onboarding/sessions")
    async def admin_onboarding_start(request: Request) -> JSONResponse:
        supervisor._require_admin(request)
        try:
            body = await request.json()
        except json.JSONDecodeError:
            body = {}
        duid = str((body or {}).get("duid") or "").strip()
        new_vacuum = bool((body or {}).get("new_vacuum"))
        name = str((body or {}).get("name") or "").strip()
        model = str((body or {}).get("model") or "").strip()
        try:
            payload = supervisor.start_onboarding_session(
                duid=duid,
                new_vacuum=new_vacuum,
                name=name,
                model=model,
            )
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        except KeyError:
            return JSONResponse({"error": "Unknown onboarding device"}, status_code=404)
        return JSONResponse(payload)

    @app.get("/admin/api/onboarding/sessions/{session_id}")
    async def admin_onboarding_status(session_id: str, request: Request) -> JSONResponse:
        supervisor._require_admin(request)
        try:
            payload = supervisor.onboarding_session_snapshot(session_id=session_id)
        except KeyError:
            return JSONResponse({"error": "Onboarding session not found"}, status_code=404)
        return JSONResponse(payload)

    @app.delete("/admin/api/onboarding/sessions/{session_id}")
    async def admin_onboarding_delete(session_id: str, request: Request) -> JSONResponse:
        supervisor._require_admin(request)
        try:
            payload = supervisor.clear_onboarding_session(session_id=session_id)
        except KeyError:
            return JSONResponse({"error": "Onboarding session not found"}, status_code=404)
        return JSONResponse(payload)


    @app.post("/admin/api/cloud/request-code")
    async def admin_cloud_request_code(request: Request) -> JSONResponse:
        supervisor._require_admin(request)
        try:
            body = await request.json()
        except json.JSONDecodeError:
            body = {}
        try:
            result = await supervisor.cloud_manager.request_code(
                email=str((body or {}).get("email") or ""),
                base_url=str((body or {}).get("base_url") or ""),
            )
        except Exception as exc:  # noqa: BLE001
            result = {"success": False, "step": "code_request_failed", "error": str(exc)}
        supervisor.runtime_state.record_cloud_request(result)
        return JSONResponse(result, status_code=200 if result.get("success") else 400)

    @app.post("/admin/api/cloud/submit-code")
    async def admin_cloud_submit_code(request: Request) -> JSONResponse:
        supervisor._require_admin(request)
        try:
            body = await request.json()
        except json.JSONDecodeError:
            body = {}
        try:
            result = await supervisor.cloud_manager.submit_code(
                session_id=str((body or {}).get("session_id") or ""),
                code=str((body or {}).get("code") or ""),
            )
            supervisor.refresh_inventory_state()
        except Exception as exc:  # noqa: BLE001
            result = {"success": False, "step": "code_submit_failed", "error": str(exc)}
        supervisor.runtime_state.record_cloud_request(result)
        return JSONResponse(result, status_code=200 if result.get("success") else 400)
