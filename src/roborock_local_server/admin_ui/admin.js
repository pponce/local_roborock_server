"use strict";

// Plain DOM components keep this dashboard usable without a frontend build step.
(() => {
  const $ = (id) => document.getElementById(id);
  const cards = new Map();
  const sessionCards = new Map();
  let cloudSessionId = "";
  let cloudBusy = false;
  let connectionsDirty = false;
  let connectionsBusy = false;
  let authRevision = 0;
  let latestConnectionSetting = false;
  let authLoaded = false;
  let refreshPromise = null;
  let pollTimer = null;
  let sessionExpired = false;
  let healthFingerprint = "";
  let vacuumFingerprint = "";

  function text(element, value) {
    const next = String(value ?? "");
    if (element.textContent !== next) element.textContent = next;
  }

  function message(id, value = "", kind = "") {
    const element = $(id);
    text(element, value);
    element.className = `message ${kind}`.trim();
    element.hidden = !value;
  }

  async function fetchJson(url, options = {}, timeout = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {...options, signal: controller.signal});
      if (response.status === 401) {
        sessionExpired = true;
        clearTimeout(pollTimer);
        window.location.assign("/admin");
        throw new Error("Your session expired. Please sign in again.");
      }
      const payload = await response.json().catch(() => {
        throw new Error("The server returned an unreadable response. Please try again.");
      });
      if (!response.ok) throw new Error(payload.error || payload.detail || `Request failed (HTTP ${response.status}).`);
      return payload;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("The server took too long to respond. Please try again.");
      if (error instanceof TypeError) throw new Error("Unable to reach the server. Check your connection and try again.");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function postJson(url, body, timeout) {
    return fetchJson(url, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}, timeout);
  }

  function badge(element, label, state) {
    text(element, label);
    element.className = `badge ${state}`;
  }

  function emptyState(container, title, description, action) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const heading = document.createElement("h3");
    heading.textContent = title;
    const copy = document.createElement("p");
    copy.className = "muted";
    copy.textContent = description;
    empty.append(heading, copy);
    if (action) {
      const link = document.createElement("a");
      link.href = "#cloud-import";
      link.className = "button primary";
      link.textContent = "Import from Roborock";
      empty.append(link);
    }
    container.replaceChildren(empty);
  }

  function renderVacuums(payload) {
    const items = Array.isArray(payload.vacuums) ? payload.vacuums : [];
    const connected = items.filter((item) => item.connected).length;
    text($("connectedCount"), `${connected} / ${items.length}`);
    text($("vacuumCount"), items.length ? `${items.length} in your local inventory` : "Import a vacuum to get started");
    const fingerprint = JSON.stringify(items);
    if (fingerprint === vacuumFingerprint) return;
    vacuumFingerprint = fingerprint;
    text($("vacuums"), JSON.stringify(items, null, 2));
    const container = $("vacuumSummary");
    container.setAttribute("aria-busy", "false");
    if (!items.length) {
      cards.clear();
      emptyState(container, "Your vacuums will appear here", "Start by importing your Roborock account, then onboard each vacuum to this server.", true);
      return;
    }
    if (!cards.size) container.replaceChildren();
    const seen = new Set();
    for (const [index, vacuum] of items.entries()) {
      const id = String(vacuum.duid || vacuum.did || index);
      seen.add(id);
      let card = cards.get(id);
      if (!card) {
        card = $("vacuumTemplate").content.firstElementChild.cloneNode(true);
        cards.set(id, card);
        container.append(card);
      }
      const field = (name) => card.querySelector(`[data-field="${name}"]`);
      const onboarding = vacuum.onboarding || {};
      const key = onboarding.key_state || {};
      text(field("name"), vacuum.name || "Unnamed vacuum");
      text(field("model"), vacuum.model || "Model not reported");
      const label = vacuum.connected ? "Connected" : onboarding.unsupported ? "Unsupported" : onboarding.has_public_key ? "Disconnected" : "Awaiting onboarding";
      badge(field("connection"), label, vacuum.connected ? "good" : onboarding.unsupported ? "error" : "warning");
      const guidance = vacuum.connected ? "Connected to your local server."
        : onboarding.guidance || (onboarding.has_public_key
          ? "Public key recovered. Waiting for the vacuum to connect."
          : "Imported into your inventory. Complete onboarding to connect locally.");
      text(field("guidance"), guidance);
      text(field("mqtt"), vacuum.connected ? "Connected" : "Disconnected");
      text(field("key"), onboarding.has_public_key ? "Recovered" : "Not recovered yet");
      text(field("samples"), Number(key.query_samples || 0));
      text(field("id"), vacuum.did || vacuum.duid || "Not reported");
    }
    for (const [id, card] of cards) {
      if (!seen.has(id)) { card.remove(); cards.delete(id); }
    }
  }

  function renderHealth(status) {
    const health = status.health || {};
    const services = Array.isArray(health.services) ? health.services : [];
    const enabled = services.filter((service) => service.enabled !== false);
    const running = enabled.filter((service) => service.running).length;
    text($("overall"), health.overall_ok ? "Healthy" : "Needs attention");
    $("overall").dataset.state = health.overall_ok ? "good" : "warning";
    text($("serviceSummary"), enabled.length ? `${running} of ${enabled.length} services running` : "No service health reported");
    text($("health"), JSON.stringify(health, null, 2));
    const fingerprint = JSON.stringify(services);
    if (fingerprint === healthFingerprint) return;
    healthFingerprint = fingerprint;
    const list = $("serviceList");
    list.replaceChildren();
    for (const service of services) {
      const row = document.createElement("div");
      row.className = "service-item";
      const name = document.createElement("span");
      name.textContent = String(service.name || "Service").replaceAll("_", " ");
      const state = document.createElement("span");
      const disabled = service.enabled === false;
      badge(state, disabled ? "Disabled" : service.running ? "Running" : "Stopped", disabled ? "neutral" : service.running ? "good" : service.required ? "error" : "warning");
      row.append(name, state);
      list.append(row);
    }
    if (!services.length) text(list, "No service health reported yet.");
  }

  function syncConnectionForm() {
    $("newConnectionsEnabled").disabled = !authLoaded || connectionsBusy;
    $("saveConnections").disabled = !authLoaded || !connectionsDirty || connectionsBusy;
    text($("saveConnections"), connectionsBusy ? "Saving…" : "Save changes");
    text($("unsavedChanges"), connectionsBusy ? "Saving your setting…" : connectionsDirty ? "Unsaved changes" : authLoaded ? "Settings saved" : "Loading settings…");
  }

  function renderSessions(sessions) {
    const list = $("sessionList");
    list.setAttribute("aria-busy", "false");
    badge($("sessionCount"), `${sessions.length} saved`, "neutral");
    if (!sessions.length) {
      if (sessionCards.size || list.dataset.empty !== "true") {
        emptyState(list, "No saved sessions", "Sessions appear here when an app or integration signs in.");
        sessionCards.clear();
        list.dataset.empty = "true";
      }
      return;
    }
    if (!sessionCards.size) list.replaceChildren();
    list.dataset.empty = "false";
    const seen = new Set();
    for (const session of sessions) {
      const key = JSON.stringify([session.hawk_id, session.hawk_session]);
      seen.add(key);
      let card = sessionCards.get(key);
      if (!card) {
        card = $("sessionTemplate").content.firstElementChild.cloneNode(true);
        const remove = card.querySelector("button");
        remove.addEventListener("click", async () => {
          if (!window.confirm("Remove this saved login? The app or integration may need to sign in again.")) return;
          remove.disabled = true;
          authRevision += 1;
          try {
            const payload = await fetchJson(`/admin/api/auth/sessions/${encodeURIComponent(session.hawk_id || "")}/${encodeURIComponent(session.hawk_session || "")}`, {method: "DELETE"});
            authRevision += 1;
            if (payload.auth) renderAuth(payload.auth);
            message("authResult", "Session removed.", "success");
          } catch (error) {
            message("authResult", error.message, "error");
            remove.disabled = false;
          }
        });
        sessionCards.set(key, card);
        list.append(card);
      }
      text(card.querySelector('[data-field="name"]'), session.rruid || session.hawk_id || "Protocol session");
      const date = session.updated_at_utc ? new Date(session.updated_at_utc) : null;
      const updated = date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : "Not reported";
      text(card.querySelector('[data-field="detail"]'), `Source: ${session.source || "unknown"} · Updated: ${updated} · ID: ${session.hawk_id || "unknown"}`);
    }
    for (const [id, card] of sessionCards) {
      if (!seen.has(id)) { card.remove(); sessionCards.delete(id); }
    }
  }

  function renderAuth(auth) {
    authLoaded = true;
    latestConnectionSetting = Boolean(auth.new_connections_enabled);
    if (!connectionsDirty && !connectionsBusy) $("newConnectionsEnabled").checked = latestConnectionSetting;
    text($("connectionState"), latestConnectionSetting ? "Allowed" : "Blocked");
    text($("connectionHint"), latestConnectionSetting ? "Ready for new apps and vacuums" : "New logins and onboarding blocked");
    text($("authMeta"), `${Number(auth.protocol_session_count || 0)} saved protocol sessions. Existing sessions are managed below.`);
    const secret = String(auth.admin_session_secret || "");
    if ($("adminSessionSecret").value !== secret) $("adminSessionSecret").value = secret;
    $("copySessionSecret").disabled = !secret;
    $("showSessionSecret").disabled = !secret;
    const pending = Array.isArray(auth.pending_device_mqtt_recovery) ? auth.pending_device_mqtt_recovery : [];
    $("pendingRecovery").hidden = !pending.length;
    text($("pendingRecovery"), pending.length ? "Waiting for MQTT password recovery: " + pending.map((item) => item.name || item.duid || item.did || "Unknown device").join(", ") : "");
    renderSessions(Array.isArray(auth.protocol_sessions) ? auth.protocol_sessions : []);
    syncConnectionForm();
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    if (sessionExpired) return;
    const revision = authRevision;
    $("refresh").disabled = true;
    refreshPromise = (async () => {
      const [status, auth, vacuums] = await Promise.allSettled([
        fetchJson("/admin/api/status"), fetchJson("/admin/api/auth"), fetchJson("/admin/api/vacuums"),
      ]);
      if (sessionExpired) return;
      const failures = [];
      if (status.status === "fulfilled") renderHealth(status.value);
      else {
        text($("overall"), "Unavailable");
        $("overall").dataset.state = "error";
        text($("serviceSummary"), "Server health could not be refreshed");
        failures.push(`Server status: ${status.reason.message}`);
      }
      if (auth.status === "fulfilled") {
        if (revision === authRevision && !connectionsBusy) renderAuth(auth.value);
      } else failures.push(`Connection settings: ${auth.reason.message}`);
      if (vacuums.status === "fulfilled") {
        renderVacuums(vacuums.value);
        message("vacuumError");
      } else {
        $("vacuumSummary").setAttribute("aria-busy", "false");
        message("vacuumError", `Vacuum status could not be refreshed. ${vacuums.reason.message}`, "error");
        failures.push("Vacuum status is unavailable.");
      }
      message("pageMessage", failures.length ? `${failures.join(" ")} Showing the last available data; retrying automatically.` : "", "error");
      text($("lastUpdated"), failures.length ? "Update incomplete" : `Updated ${new Date().toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})}`);
    })().catch((error) => message("pageMessage", error.message, "error")).finally(() => {
      refreshPromise = null;
      $("refresh").disabled = false;
    });
    return refreshPromise;
  }

  async function poll() {
    clearTimeout(pollTimer);
    await refresh();
    clearTimeout(pollTimer);
    if (!sessionExpired && !document.hidden) pollTimer = setTimeout(poll, 2000);
  }

  function syncCloudForm() {
    $("sendCode").disabled = cloudBusy;
    $("email").disabled = cloudBusy;
    $("code").disabled = cloudBusy || !cloudSessionId;
    $("fetchData").disabled = cloudBusy || !cloudSessionId;
  }

  $("requestCodeForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (cloudBusy) return;
    cloudBusy = true;
    cloudSessionId = "";
    syncCloudForm();
    text($("sendCode"), "Sending…");
    message("cloudResult");
    try {
      const payload = await postJson("/admin/api/cloud/request-code", {email: $("email").value.trim()}, 120000);
      if (!payload.session_id) throw new Error("No verification session was returned. Request a new code.");
      cloudSessionId = payload.session_id;
      $("code").value = "";
      text($("cloudDetails"), JSON.stringify(payload, null, 2));
      text($("codeHelp"), "Enter the code emailed by Roborock, not your local app PIN.");
      message("cloudResult", "Code sent. Check your email to continue.", "success");
    } catch (error) {
      message("cloudResult", error.message, "error");
      text($("codeHelp"), "Request a code to continue.");
    } finally {
      cloudBusy = false;
      syncCloudForm();
      text($("sendCode"), cloudSessionId ? "Resend code" : "Send code");
      if (cloudSessionId) $("code").focus();
    }
  });

  $("email").addEventListener("input", () => {
    if (cloudBusy) return;
    cloudSessionId = "";
    $("code").value = "";
    syncCloudForm();
    text($("sendCode"), "Send code");
    text($("codeHelp"), "Request a code for this email to continue.");
    message("cloudResult");
  });

  $("importForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (cloudBusy || !cloudSessionId) return;
    cloudBusy = true;
    syncCloudForm();
    text($("fetchData"), "Importing…");
    message("cloudResult", "Fetching your cloud inventory. This may take a moment.");
    try {
      const payload = await postJson("/admin/api/cloud/submit-code", {session_id: cloudSessionId, code: $("code").value.trim()}, 120000);
      cloudSessionId = "";
      $("code").value = "";
      text($("cloudDetails"), JSON.stringify(payload, null, 2));
      message("cloudResult", "Import complete. Review your vacuums above, then follow the onboarding guide to connect them locally.", "success");
      text($("codeHelp"), "Request a new code if you need to import again.");
      await refresh();
    } catch (error) {
      message("cloudResult", error.message, "error");
    } finally {
      cloudBusy = false;
      syncCloudForm();
      text($("fetchData"), "Import data");
      text($("sendCode"), cloudSessionId ? "Resend code" : "Send code");
    }
  });

  $("newConnectionsEnabled").addEventListener("change", () => {
    connectionsDirty = $("newConnectionsEnabled").checked !== latestConnectionSetting;
    syncConnectionForm();
    message("authResult");
  });
  $("connectionsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (connectionsBusy || !connectionsDirty || !authLoaded) return;
    connectionsBusy = true;
    authRevision += 1;
    syncConnectionForm();
    try {
      const payload = await postJson("/admin/api/auth", {new_connections_enabled: $("newConnectionsEnabled").checked});
      authRevision += 1;
      connectionsDirty = false;
      connectionsBusy = false;
      renderAuth(payload);
      message("authResult", "Connection setting saved.", "success");
    } catch (error) {
      message("authResult", error.message, "error");
    } finally {
      connectionsBusy = false;
      syncConnectionForm();
    }
  });

  $("showSessionSecret").addEventListener("click", () => {
    const show = $("adminSessionSecret").type === "password";
    $("adminSessionSecret").type = show ? "text" : "password";
    $("showSessionSecret").setAttribute("aria-pressed", String(show));
    text($("showSessionSecret"), show ? "Hide" : "Show");
  });
  $("copySessionSecret").addEventListener("click", async () => {
    const input = $("adminSessionSecret");
    if (!input.value) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(input.value);
      else throw new Error("Clipboard unavailable");
      text($("syncSecretMeta"), "Copied protocol sync secret.");
    } catch {
      input.type = "text";
      text($("showSessionSecret"), "Hide");
      $("showSessionSecret").setAttribute("aria-pressed", "true");
      input.focus();
      input.select();
      text($("syncSecretMeta"), "Automatic copy is unavailable. Copy the selected text manually.");
    }
  });
  $("logout").addEventListener("click", async () => {
    $("logout").disabled = true;
    try {
      await postJson("/admin/api/logout", {});
      window.location.reload();
    } catch (error) {
      message("pageMessage", error.message, "error");
      $("logout").disabled = false;
    }
  });
  $("refresh").addEventListener("click", poll);
  document.addEventListener("visibilitychange", () => {
    clearTimeout(pollTimer);
    if (!document.hidden) poll();
  });
  function updateNavigation() {
    const hash = window.location.hash || "#overview";
    document.querySelectorAll(".nav-link").forEach((link) => {
      if (link.getAttribute("href") === hash) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }
  window.addEventListener("hashchange", updateNavigation);
  updateNavigation();

  const support = JSON.parse($("projectSupport").textContent);
  text($("supportTitle"), support.title || "Support this project");
  text($("supportText"), support.text || "");
  for (const link of support.links || []) {
    let url;
    try { url = new URL(link.url); } catch { continue; }
    if (!["https:", "http:"].includes(url.protocol)) continue;
    const anchor = document.createElement("a");
    anchor.href = url.href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.className = "button secondary";
    anchor.textContent = link.label || url.hostname;
    $("supportLinks").append(anchor);
  }
  poll();
})();
