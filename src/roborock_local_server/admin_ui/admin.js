"use strict";

// Plain DOM components keep this dashboard usable without a frontend build step.
(() => {
  const $ = (id) => document.getElementById(id);
  const cards = new Map();
  const sessionCards = new Map();
  const credentialCards = new Map();
  let vacuumRevision = 0;
  const scheduleCards = new Map();
  let scheduleDevices = [];
  let scheduleLoaded = false;
  let schedulePromise = null;
  let scheduleRevision = 0;
  let scheduleDeviceFingerprint = "";
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
      if (!response.ok) {
        const error = new Error(payload.error || payload.detail || `Request failed (HTTP ${response.status}).`);
        error.status = response.status;
        throw error;
      }
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
    renderCredentials(items);
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

  function renderCredentials(items) {
    const list = $("credentialList");
    list.setAttribute("aria-busy", "false");
    const devices = items.filter((vacuum) => vacuum.duid && vacuum.mqtt_credentials);
    if (!devices.length) {
      credentialCards.clear();
      text(list, "No saved vacuum credentials are available.");
      return;
    }
    if (!credentialCards.size) list.replaceChildren();
    const seen = new Set();
    for (const vacuum of devices) {
      const id = String(vacuum.duid);
      seen.add(id);
      let state = credentialCards.get(id);
      if (!state) {
        const card = $("credentialTemplate").content.firstElementChild.cloneNode(true);
        state = {card, vacuum, busy: false};
        credentialCards.set(id, state);
        list.append(card);
        const button = card.querySelector("button");
        button.addEventListener("click", async () => {
          if (state.busy || !state.vacuum.mqtt_credentials.saved) return;
          const name = state.vacuum.name || id;
          if (!window.confirm(`Clear MQTT credentials for ${name}? This disconnects this vacuum. You will need to re-pair it using Add vacuum in LocalRock. Its inventory entry, keys, schedules, and app logins are kept. No backup is created.`)) return;
          const result = card.querySelector('[data-field="result"]');
          state.busy = true;
          vacuumRevision += 1;
          updateCredentialCard(state);
          result.hidden = true;
          try {
            const payload = await fetchJson(`/admin/api/vacuums/${encodeURIComponent(id)}/mqtt-credentials`, {method: "DELETE"});
            state.vacuum = {...state.vacuum, mqtt_credentials: payload.mqtt_credentials, connected: false};
            text(result, `Credentials cleared for ${name}. Enable Allow new connections, reset this vacuum’s Wi-Fi, then use Add vacuum in LocalRock to re-pair it.`);
            result.className = "message success";
          } catch (error) {
            text(result, error.message);
            result.className = "message error";
          } finally {
            vacuumRevision += 1;
            state.busy = false;
            result.hidden = false;
            updateCredentialCard(state);
          }
          await refresh();
        });
      }
      if (!state.busy) state.vacuum = vacuum;
      updateCredentialCard(state);
    }
    for (const [id, state] of credentialCards) {
      if (!seen.has(id) && !state.busy) { state.card.remove(); credentialCards.delete(id); }
    }
  }

  function updateCredentialCard(state) {
    const {card, vacuum, busy} = state;
    const credentials = vacuum.mqtt_credentials;
    const name = vacuum.name || vacuum.duid;
    text(card.querySelector('[data-field="name"]'), name);
    text(card.querySelector('[data-field="detail"]'), credentials.saved ? "MQTT credentials saved" : credentials.cleared_at ? "Credentials cleared · Re-pair this vacuum to connect" : "No MQTT credentials saved");
    const button = card.querySelector("button");
    button.disabled = busy || !credentials.saved;
    button.setAttribute("aria-label", `Clear MQTT credentials for ${name}`);
    text(button, busy ? "Clearing…" : "Clear MQTT credentials");
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

  const scheduleDayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function simpleRecurrence(cron) {
    const parts = String(cron || "").trim().split(/\s+/);
    if (parts.length !== 5 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])
        || !["*", "?"].includes(parts[2]) || !["*", "?"].includes(parts[3])) return null;
    const minute = Number(parts[0]), hour = Number(parts[1]);
    if (minute > 59 || hour > 23) return null;
    const days = new Set();
    if (["*", "?"].includes(parts[4])) [0, 1, 2, 3, 4, 5, 6].forEach((day) => days.add(day));
    else {
      for (const part of parts[4].split(",")) {
        const match = /^([0-7])(?:-([0-7]))?$/.exec(part);
        if (!match) return null;
        const start = Number(match[1]), end = Number(match[2] ?? match[1]);
        if (end < start) return null;
        for (let day = start; day <= end; day += 1) days.add(day % 7);
      }
    }
    return {time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, days: [...days].sort()};
  }

  function scheduleField(state, name) { return state.card.querySelector(`[data-field="${name}"]`); }

  function scheduleMessage(state, value = "", kind = "") {
    const element = scheduleField(state, "result");
    text(element, value);
    element.className = `message ${kind}`.trim();
    element.hidden = !value;
  }

  function scheduleValues(state) {
    const form = state.form;
    return {
      mode: form.elements.mode.value,
      time: form.elements.time.value,
      days: [...form.querySelectorAll('input[name="day"]:checked')].map((input) => Number(input.value)).sort(),
      cron: form.elements.cron.value.trim(),
      zone: form.elements.zone.value.trim(),
      enabled: form.elements.enabled.checked,
    };
  }

  function syncScheduleEditor(state) {
    const values = scheduleValues(state);
    const relevant = (value) => value.mode === "simple"
      ? {mode: value.mode, time: value.time, days: value.days, zone: value.zone, enabled: value.enabled}
      : {mode: value.mode, cron: value.cron, zone: value.zone, enabled: value.enabled};
    state.dirty = JSON.stringify(relevant(values)) !== JSON.stringify(relevant(JSON.parse(state.savedValues)));
    const stale = state.forcedConflict || (state.dirty && state.latest?.revision !== state.base?.revision);
    const editable = state.base?.editable === true && !state.deleted;
    state.form.querySelector(".schedule-fields").disabled = state.busy || !editable;
    scheduleField(state, "timeField").hidden = values.mode !== "simple";
    scheduleField(state, "daysField").hidden = values.mode !== "simple";
    scheduleField(state, "cronField").hidden = values.mode !== "cron";
    state.form.elements.time.required = values.mode === "simple";
    state.form.elements.cron.required = values.mode === "cron";
    const save = scheduleField(state, "save");
    save.disabled = !editable || !state.dirty || state.busy || stale;
    text(save, state.busy ? "Saving…" : "Save schedule");
    scheduleField(state, "discard").disabled = state.busy || !(state.dirty || stale || state.deleted);
    text(scheduleField(state, "editStatus"), state.busy ? "Saving…" : state.deleted ? "Deleted elsewhere"
      : stale ? "Changed elsewhere — discard edits to load the latest values"
      : state.dirty ? "Unsaved changes" : "Saved");
  }

  function adoptSchedule(state, job) {
    state.base = job;
    state.latest = job;
    state.deleted = false;
    state.forcedConflict = false;
    const simple = simpleRecurrence(job.cron);
    const form = state.form;
    form.elements.mode.value = simple ? "simple" : "cron";
    form.elements.time.value = simple?.time || "09:00";
    form.elements.zone.value = job.timeZoneId || "";
    form.elements.cron.value = job.cron || "";
    form.elements.enabled.checked = job.enabled === true;
    form.querySelectorAll('input[name="day"]').forEach((input) => {
      input.checked = (simple?.days || [1, 2, 3, 4, 5]).includes(Number(input.value));
    });
    state.savedValues = JSON.stringify(scheduleValues(state));
    syncScheduleEditor(state);
  }

  function schedulePatch(state) {
    const values = scheduleValues(state), original = JSON.parse(state.savedValues);
    const patch = {revision: state.base.revision};
    if (values.zone !== original.zone) patch.timeZoneId = values.zone;
    if (values.enabled !== original.enabled) patch.enabled = values.enabled;
    if (values.mode !== original.mode || (values.mode === "cron" && values.cron !== original.cron)
        || (values.mode === "simple" && (values.time !== original.time || JSON.stringify(values.days) !== JSON.stringify(original.days)))) {
      if (values.mode === "cron") patch.cron = values.cron;
      else {
        if (!values.days.length) throw new Error("Choose at least one day for this recurring schedule.");
        if (!/^\d{2}:\d{2}$/.test(values.time)) throw new Error("Choose a valid time.");
        const [hour, minute] = values.time.split(":").map(Number);
        patch.cron = `${minute} ${hour} * * ${values.days.length === 7 ? "*" : values.days.join(",")}`;
      }
    }
    return patch;
  }

  function renderScheduleSummary(state, job) {
    text(scheduleField(state, "title"), `Schedule ${job.id}`);
    const simple = simpleRecurrence(job.cron);
    const days = simple?.days.length === 7 ? "Every day" : [1, 2, 3, 4, 5, 6, 0]
      .filter((day) => simple?.days.includes(day)).map((day) => scheduleDayNames[day]).join(", ");
    text(scheduleField(state, "recurrence"), simple ? `${days} at ${simple.time} · ${job.timeZoneId}` : `${job.cron} · ${job.timeZoneId}`);
    badge(scheduleField(state, "enabledBadge"), state.deleted ? "Deleted" : job.enabled ? "Server enabled" : "Server disabled", "neutral");
    let next = job.enabled ? "Next scheduled time: not calculated" : "Disabled on this server";
    if (job.enabled && job.next_run_at) {
      try {
        next = "Next scheduled time: " + new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium", timeStyle: "short", timeZone: job.timeZoneId,
        }).format(new Date(job.next_run_at)) + ` (${job.timeZoneId})`;
      } catch { next = `Next scheduled time: ${job.next_run_at}`; }
    }
    text(scheduleField(state, "next"), next);
    text(scheduleField(state, "timerState"), job.native_timer_name
      ? "Robot timer: not checked. The robot's timer must also be enabled."
      : "This schedule uses the server's legacy timer compatibility mode.");
    text(scheduleField(state, "enabledHelp"), job.native_timer_name
      ? "Checked: this server can trigger the schedule. Unchecked: this server will not trigger it. Save to apply. This does not turn the robot's own timer on or off."
      : "Checked: this server can trigger the schedule. Unchecked: this server will not trigger it. Save to apply.");
    scheduleField(state, "readOnly").hidden = job.editable === true;
    state.card.querySelector(".schedule-editor").hidden = job.editable !== true && !state.dirty && !state.forcedConflict;
    text(scheduleField(state, "settings"), JSON.stringify({native_timer_name: job.native_timer_name ?? null, ...job.settings}, null, 2));
  }

  function createScheduleCard(device, job, key) {
    const card = $("scheduleTemplate").content.firstElementChild.cloneNode(true);
    card.dataset.jobId = String(job.id);
    card.dataset.deviceId = String(device.duid);
    const state = {card, form: card.querySelector("form"), deviceId: String(device.duid), busy: false, dirty: false};
    state.form.setAttribute("aria-label", `Edit schedule ${job.id} for ${device.name || "vacuum"}`);
    adoptSchedule(state, job);
    const onInput = () => { scheduleMessage(state); syncScheduleEditor(state); };
    state.form.addEventListener("input", onInput);
    state.form.addEventListener("change", onInput);
    scheduleField(state, "discard").addEventListener("click", async () => {
      if (state.busy) return;
      state.busy = true;
      scheduleRevision += 1;
      syncScheduleEditor(state);
      try {
        const payload = await fetchJson("/admin/api/schedules");
        if (payload.supported === false) throw new Error("Schedule editing is not available in this server build.");
        if (!Array.isArray(payload.devices)) throw new Error("The schedule response was incomplete. Try refreshing.");
        const device = payload.devices.find((item) => String(item.duid) === state.deviceId);
        const latest = device?.schedules?.find((item) => String(item.id) === String(state.base.id));
        if (latest) {
          adoptSchedule(state, latest);
          renderScheduleSummary(state, latest);
          scheduleMessage(state, "Loaded the latest saved values.", "success");
        } else {
          card.remove();
          scheduleCards.delete(key);
        }
        state.busy = false;
        renderSchedules(payload);
      } catch (error) {
        scheduleMessage(state, `Could not reload. Your edits are still here. ${error.message}`, "error");
      } finally {
        state.busy = false;
        scheduleRevision += 1;
        syncScheduleEditor(state);
      }
    });
    state.form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (scheduleField(state, "save").disabled) return;
      let patch;
      try { patch = schedulePatch(state); }
      catch (error) { scheduleMessage(state, error.message, "error"); return; }
      state.busy = true;
      scheduleRevision += 1;
      syncScheduleEditor(state);
      scheduleMessage(state);
      try {
        const payload = await fetchJson(`/admin/api/schedules/${encodeURIComponent(state.deviceId)}/${encodeURIComponent(state.base.id)}`, {
          method: "PATCH", headers: {"Content-Type": "application/json"}, body: JSON.stringify(patch),
        });
        if (!payload.schedule?.revision) throw new Error("The save response was incomplete. Refresh schedules before trying again.");
        adoptSchedule(state, payload.schedule);
        renderScheduleSummary(state, payload.schedule);
        scheduleMessage(state, "Schedule saved. Room and cleaning settings were preserved.", "success");
      } catch (error) {
        if (error.status === 409) state.forcedConflict = true;
        scheduleMessage(state, error.message, "error");
      } finally {
        state.busy = false;
        scheduleRevision += 1;
        syncScheduleEditor(state);
      }
    });
    return state;
  }

  function selectScheduleDevice() {
    const duid = $("scheduleDevice").value;
    const device = scheduleDevices.find((item) => String(item.duid) === duid);
    let shown = 0;
    for (const state of scheduleCards.values()) {
      state.card.hidden = state.deviceId !== duid;
      if (!state.card.hidden) shown += 1;
    }
    $("scheduleList").querySelector(".schedule-empty")?.remove();
    if (!shown) {
      const empty = document.createElement("div");
      empty.className = "schedule-empty empty-state";
      const heading = document.createElement("h3");
      heading.textContent = device ? "No stored schedules for this vacuum" : "No vacuums in the local inventory";
      const copy = document.createElement("p");
      copy.className = "muted";
      copy.textContent = "This editor shows jobs saved on the local server, including imported schedules.";
      empty.append(heading, copy);
      $("scheduleList").append(empty);
    }
    const count = device?.schedules?.length || 0;
    text($("scheduleSummary"), device ? `${count} stored schedule${count === 1 ? "" : "s"} · `
      + (device.connected === true ? "Connected locally" : device.connected === false ? "Not connected to this server; edits affect local data only" : "Connection not reported") : "No stored vacuums");
  }

  function renderSchedules(payload) {
    if (payload.supported === false) throw new Error("Schedule editing is not available in this server build.");
    if (!Array.isArray(payload.devices)) throw new Error("The schedule response was incomplete. Try refreshing.");
    scheduleDevices = payload.devices;
    if (!scheduleLoaded) { $("scheduleList").replaceChildren(); scheduleLoaded = true; }
    const selector = $("scheduleDevice");
    const deviceFingerprint = JSON.stringify(scheduleDevices.map((device) => [device.duid, device.name]));
    if (deviceFingerprint !== scheduleDeviceFingerprint) {
      const previous = selector.value;
      selector.replaceChildren();
      for (const device of scheduleDevices) {
        const option = document.createElement("option");
        option.value = String(device.duid);
        option.textContent = device.name || "Unnamed vacuum";
        selector.append(option);
      }
      if (scheduleDevices.some((device) => String(device.duid) === previous)) selector.value = previous;
      else selector.value = String(scheduleDevices.find((device) => device.connected)?.duid || scheduleDevices[0]?.duid || "");
      scheduleDeviceFingerprint = deviceFingerprint;
    }
    selector.disabled = !scheduleDevices.length;
    const seen = new Set();
    for (const device of scheduleDevices) {
      for (const job of Array.isArray(device.schedules) ? device.schedules : []) {
        const key = JSON.stringify([String(device.duid), String(job.id)]);
        seen.add(key);
        let state = scheduleCards.get(key);
        if (!state) {
          state = createScheduleCard(device, job, key);
          scheduleCards.set(key, state);
          $("scheduleList").append(state.card);
        } else if (!state.busy) {
          state.latest = job;
          if (!state.dirty && !state.forcedConflict && state.base.revision !== job.revision) adoptSchedule(state, job);
        }
        renderScheduleSummary(state, state.busy ? state.base : job);
        syncScheduleEditor(state);
      }
    }
    for (const [key, state] of scheduleCards) {
      if (seen.has(key) || state.busy) continue;
      if (state.dirty || state.forcedConflict) {
        state.deleted = true;
        scheduleMessage(state, "This schedule was deleted elsewhere. Your edits have not been saved.", "error");
        renderScheduleSummary(state, state.base);
        syncScheduleEditor(state);
      } else { state.card.remove(); scheduleCards.delete(key); }
    }
    selectScheduleDevice();
  }

  async function refreshScheduleData() {
    if (schedulePromise) return schedulePromise;
    const revision = scheduleRevision;
    $("refreshSchedules").disabled = true;
    schedulePromise = (async () => {
      try {
        const payload = await fetchJson("/admin/api/schedules");
        if (revision !== scheduleRevision || sessionExpired) return;
        renderSchedules(payload);
        message("scheduleError");
      } catch (error) {
        if (!sessionExpired) {
          message("scheduleError", `Schedules could not be refreshed. ${error.message} Use Refresh schedules to retry.`, "error");
          if (!scheduleLoaded) emptyState($("scheduleList"), "Schedules unavailable", "The rest of the dashboard is available. Refresh schedules to try again.");
        }
      } finally {
        $("scheduleList").setAttribute("aria-busy", "false");
        $("refreshSchedules").disabled = false;
        schedulePromise = null;
      }
    })();
    return schedulePromise;
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
    const deviceRevision = vacuumRevision;
    $("refresh").disabled = true;
    refreshPromise = (async () => {
      const [status, auth, vacuums] = await Promise.allSettled([
        fetchJson("/admin/api/status"), fetchJson("/admin/api/auth"), fetchJson("/admin/api/vacuums"), refreshScheduleData(),
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
        if (deviceRevision === vacuumRevision) renderVacuums(vacuums.value);
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
  $("refreshSchedules").addEventListener("click", refreshScheduleData);
  $("scheduleDevice").addEventListener("change", selectScheduleDevice);
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
