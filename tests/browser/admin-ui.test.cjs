/* Browser regression tests use only fictional robots and stubbed local API responses. */
const {test, before, after, beforeEach, afterEach} = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const {chromium} = require("playwright");

const assetDir = path.resolve(__dirname, "../../src/roborock_local_server/admin_ui");
const outputDir = path.resolve(__dirname, "artifacts");
const support = {title: "Support This Project", text: "Help keep local control open and accessible.", links: [
  {label: "Buy Me a Coffee", url: "https://buymeacoffee.com/lashl"},
  {label: "PayPal", url: "https://paypal.me/LLashley304"},
  {label: "Roborock Store", url: "https://us.roborock.com/"},
]};
let server, browser, context, page, baseURL, state;

function fixtures() {
  return {
    loggedIn: true,
    fail: new Set(),
    requests: [],
    scheduleConflict: false,
    schedules: {
      supported: true, generated_at: "2026-10-24T16:00:00Z", server_timezone: "America/Los_Angeles",
      devices: [
        {duid: "sample-downstairs", name: "Downstairs", model: "roborock.vacuum.a15", connected: true, schedules: [
          {id: 42, revision: "revision-42", cron: "30 9 * * 1-5", timeZoneId: "America/Los_Angeles", enabled: true, repeated: true,
            next_run_at: "2026-10-26T16:30:00Z", native_timer_name: "native-kitchen", native_timer_state: "not_checked", editable: true,
            settings: {map_index: 0, segments: "16,17", fan_power: 102, clean_order_mode: 1}},
          {id: 43, revision: "revision-43", cron: "0,30 8-9 * * *", timeZoneId: "Europe/Berlin", enabled: false, repeated: true,
            next_run_at: null, native_timer_name: null, native_timer_state: null, settings: {}, editable: true},
          {id: 44, revision: "revision-44", cron: "0 10 26 10 *", timeZoneId: "America/Los_Angeles", enabled: true, repeated: false,
            next_run_at: "2026-10-26T17:00:00Z", native_timer_name: "native-once", native_timer_state: "not_checked", settings: {}, editable: false},
        ]},
        {duid: "sample-upstairs", name: "Upstairs", model: "roborock.vacuum.a27", connected: false, schedules: [
          {id: 42, revision: "upstairs-revision-42", cron: "0 11 * * *", timeZoneId: "America/Los_Angeles", enabled: true, repeated: true,
            next_run_at: "2026-10-24T18:00:00Z", native_timer_name: "native-office", native_timer_state: "not_checked", settings: {map_index: 1}, editable: true},
        ]},
      ],
    },
    auth: {
      new_connections_enabled: true, admin_session_secret: "fictional-sync-secret",
      protocol_session_count: 1, pending_device_mqtt_recovery: [],
      protocol_sessions: [{rruid: "LocalRock", hawk_id: "sample-id", hawk_session: "sample-session", source: "app_login", updated_at_utc: "2026-10-23T18:00:00Z"}],
    },
    health: {overall_ok: true, services: [
      {name: "https_server", running: true, enabled: true, required: true},
      {name: "mqtt_proxy", running: true, enabled: true, required: true},
      {name: "mqtt_broker", running: true, enabled: true, required: true},
      {name: "topic_bridge", running: true, enabled: true, required: true},
      {name: "turn_relay", running: false, enabled: false, required: false},
    ]},
    vacuums: [
      {duid: "sample-downstairs", name: "Downstairs", model: "roborock.vacuum.a15", connected: true, mqtt_credentials: {saved: true, cleared_at: ""}, onboarding: {has_public_key: true, key_state: {query_samples: 4}}},
      {duid: "sample-upstairs", name: "Upstairs", model: "roborock.vacuum.a27", connected: false, mqtt_credentials: {saved: false, cleared_at: ""}, onboarding: {has_public_key: false, key_state: {query_samples: 0}}},
    ],
  };
}

async function serve(req, res) {
  const url = new URL(req.url, baseURL || "http://localhost");
  const reply = (data, status = 200) => {
    res.writeHead(status, {"Content-Type": "application/json"});
    res.end(JSON.stringify(data));
  };
  if (url.pathname === "/admin") {
    const html = await fs.readFile(path.join(assetDir, state.loggedIn ? "dashboard.html" : "login.html"), "utf8");
    res.writeHead(200, {"Content-Type": "text/html"});
    res.end(html.replace("__PROJECT_SUPPORT__", JSON.stringify(support).replaceAll("<", "\\u003c")));
    return;
  }
  if (url.pathname.startsWith("/admin/assets/")) {
    const name = url.pathname.split("/").pop();
    if (!["admin.css", "admin.js", "login.js"].includes(name)) return reply({}, 404);
    res.writeHead(200, {"Content-Type": name.endsWith(".css") ? "text/css" : "text/javascript"});
    res.end(await fs.readFile(path.join(assetDir, name)));
    return;
  }
  if (url.pathname === "/favicon.ico") { res.writeHead(204); res.end(); return; }
  if (!url.pathname.startsWith("/admin/api/")) return reply({}, 404);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  state.requests.push({path: url.pathname, method: req.method, body});
  if (state.fail.has(url.pathname)) return reply({error: "Simulated server failure"}, 503);
  if (url.pathname === "/admin/api/login") {
    if (body.password !== "test-password") return reply({error: "Invalid password"}, 401);
    state.loggedIn = true;
    return reply({ok: true});
  }
  if (!state.loggedIn) return reply({error: "Authentication required"}, 401);
  const credentialPath = /^\/admin\/api\/vacuums\/([^/]+)\/mqtt-credentials$/.exec(url.pathname);
  if (credentialPath && req.method === "DELETE") {
    const vacuum = state.vacuums.find((item) => item.duid === decodeURIComponent(credentialPath[1]));
    if (!vacuum) return reply({error: "Vacuum not found"}, 404);
    vacuum.mqtt_credentials = {saved: false, cleared_at: "2026-10-25T00:00:00Z"};
    vacuum.connected = false;
    return reply({ok: true, duid: vacuum.duid, name: vacuum.name, mqtt_credentials: vacuum.mqtt_credentials});
  }
  const schedulePath = /^\/admin\/api\/schedules\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (schedulePath && req.method === "PATCH") {
    const device = state.schedules.devices.find((item) => item.duid === decodeURIComponent(schedulePath[1]));
    const job = device?.schedules.find((item) => String(item.id) === decodeURIComponent(schedulePath[2]));
    if (!job) return reply({error: "Schedule not found"}, 404);
    if (state.scheduleConflict || body.revision !== job.revision) return reply({error: "Schedule changed. Reload the saved values before editing."}, 409);
    for (const key of ["cron", "timeZoneId", "enabled"]) if (Object.hasOwn(body, key)) job[key] = body[key];
    job.revision += "-saved";
    return reply({schedule: job});
  }
  switch (url.pathname) {
    case "/admin/api/status": return reply({health: state.health});
    case "/admin/api/vacuums": return reply({vacuums: state.vacuums});
    case "/admin/api/schedules": return reply(state.schedules);
    case "/admin/api/auth":
      if (req.method === "POST") state.auth.new_connections_enabled = body.new_connections_enabled;
      return reply(state.auth);
    case "/admin/api/cloud/request-code": return reply({session_id: "test-cloud-session", success: true});
    case "/admin/api/cloud/submit-code":
      if (body.session_id !== "test-cloud-session" || body.code !== "123456") return reply({error: "Invalid verification code"}, 400);
      return reply({success: true, device_count: state.vacuums.length});
    case "/admin/api/auth/sessions/sample-id/sample-session":
      if (req.method !== "DELETE") return reply({}, 405);
      state.auth.protocol_sessions = [];
      state.auth.protocol_session_count = 0;
      return reply({ok: true, auth: state.auth});
    case "/admin/api/logout": state.loggedIn = false; return reply({ok: true});
    default: return reply({}, 404);
  }
}

test("Diagnostics clears only the chosen vacuum after confirmation", async () => {
  await ready();
  const button = page.getByRole("button", {name: "Clear MQTT credentials for Downstairs", exact: true});
  assert.equal(await page.getByRole("button", {name: "Clear MQTT credentials for Upstairs", exact: true}).isDisabled(), true);
  page.once("dialog", (dialog) => dialog.dismiss());
  await button.click();
  assert.equal(state.requests.filter((item) => item.path.endsWith("/mqtt-credentials")).length, 0);
  page.once("dialog", (dialog) => {
    assert.match(dialog.message(), /Downstairs/);
    assert.match(dialog.message(), /No backup/);
    return dialog.accept();
  });
  await button.click();
  await page.waitForFunction(() => document.querySelector("#credentialList").textContent.includes("Credentials cleared for Downstairs"));
  assert.equal(await button.isDisabled(), true);
  assert.equal(state.auth.protocol_sessions.length, 1);
  assert.equal(state.requests.filter((item) => item.method === "DELETE").length, 1);
  assert.equal(state.requests.find((item) => item.method === "DELETE").path, "/admin/api/vacuums/sample-downstairs/mqtt-credentials");
  assert.match(await page.locator("#credentialList").textContent(), /Add vacuum in LocalRock/);
  await page.setViewportSize({width: 320, height: 900});
  await noOverflow();
});

test("credential reset failures keep the action available for retry", async () => {
  state.fail.add("/admin/api/vacuums/sample-downstairs/mqtt-credentials");
  await ready();
  page.once("dialog", (dialog) => dialog.accept());
  const button = page.getByRole("button", {name: "Clear MQTT credentials for Downstairs", exact: true});
  await button.click();
  await page.waitForFunction(() => document.querySelector("#credentialList").textContent.includes("Simulated server failure"));
  assert.equal(await button.isEnabled(), true);
  assert.equal(state.vacuums[0].mqtt_credentials.saved, true);
});

before(async () => {
  await fs.mkdir(outputDir, {recursive: true});
  server = http.createServer((req, res) => serve(req, res).catch((error) => {
    res.writeHead(500); res.end(error.message);
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({headless: true});
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});
beforeEach(async () => {
  state = fixtures();
  context = await browser.newContext({viewport: {width: 1440, height: 1050}, colorScheme: "light"});
  // No test may contact a real cloud service or robot.
  await context.route("**/*", (route) => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
  page = await context.newPage();
});
afterEach(async () => { await context?.close(); });

async function ready() {
  await page.goto(`${baseURL}/admin`);
  await page.waitForFunction(() => document.getElementById("overall")?.textContent === "Healthy");
  await page.waitForFunction(() => document.getElementById("vacuumSummary")?.getAttribute("aria-busy") === "false");
}
async function refresh() {
  await page.locator("#refresh").click();
  await page.waitForFunction(() => !document.getElementById("refresh").disabled);
}
async function noOverflow() {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
}

test("dashboard renders statuses, local support links and desktop preview", async () => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await ready();
  assert.equal(await page.locator("#connectedCount").textContent(), "1 / 2");
  assert.equal(await page.locator(".vacuum-card").count(), 2);
  assert.equal(await page.locator("#adminSessionSecret").getAttribute("type"), "password");
  assert.equal(await page.locator("#supportLinks a").count(), 3);
  await noOverflow();
  await page.screenshot({path: path.join(outputDir, "dashboard-desktop.png"), fullPage: true});
  assert.deepEqual(errors, []);
});

test("polling preserves an unsaved toggle, expanded details and keyboard focus", async () => {
  await ready();
  await page.locator("#newConnectionsEnabled").uncheck();
  await page.locator(".vacuum-card details").first().locator("summary").click();
  await page.locator("#saveConnections").focus();
  // A changed payload must update the card in place, including while it has open details.
  state.vacuums[0].onboarding.key_state.query_samples = 5;
  await page.waitForTimeout(2500);
  assert.equal(await page.locator("#newConnectionsEnabled").isChecked(), false);
  assert.equal(await page.locator("#saveConnections").isEnabled(), true);
  assert.equal(await page.locator(".vacuum-card details").first().getAttribute("open"), "");
  assert.equal(await page.evaluate(() => document.activeElement.id), "saveConnections");
  assert.equal(await page.locator('[data-field="samples"]').first().textContent(), "5");
  await page.locator("#saveConnections").click();
  await page.waitForFunction(() => document.getElementById("authResult").textContent.includes("saved"));
  assert.equal(state.auth.new_connections_enabled, false);
  assert.equal(await page.locator("#saveConnections").isDisabled(), true);
});

test("failed save keeps edits for retry and refresh recovers after an outage", async () => {
  await ready();
  state.fail.add("/admin/api/auth");
  await page.locator("#newConnectionsEnabled").uncheck();
  await page.locator("#saveConnections").click();
  await page.waitForFunction(() => document.getElementById("authResult").textContent.includes("failure"));
  assert.equal(await page.locator("#newConnectionsEnabled").isChecked(), false);
  assert.equal(await page.locator("#saveConnections").isEnabled(), true);
  state.fail.add("/admin/api/status");
  await refresh();
  assert.equal(await page.locator("#overall").textContent(), "Unavailable");
  state.fail.clear();
  await refresh();
  assert.equal(await page.locator("#overall").textContent(), "Healthy");
  assert.equal(await page.locator("#pageMessage").isVisible(), false);
});

test("cloud import validates steps, prevents duplicate submits and allows retry", async () => {
  await ready();
  assert.equal(await page.locator("#fetchData").isDisabled(), true);
  await page.locator("#email").fill("example@example.com");
  await page.locator("#sendCode").click();
  await page.waitForFunction(() => !document.getElementById("code").disabled);
  await page.locator("#code").fill("wrong");
  await page.locator("#fetchData").click();
  await page.waitForFunction(() => document.getElementById("cloudResult").textContent.includes("Invalid verification"));
  assert.equal(await page.locator("#fetchData").isEnabled(), true);
  await page.locator("#code").fill("123456");
  await page.locator("#fetchData").click();
  await page.waitForFunction(() => document.getElementById("cloudResult").textContent.includes("Import complete"));
  assert.equal(await page.locator("#code").inputValue(), "");
  assert.equal(await page.locator("#fetchData").isDisabled(), true);
  assert.equal(state.requests.filter((r) => r.path.endsWith("submit-code")).length, 2);
});

test("changing the import email invalidates its previous verification session", async () => {
  await ready();
  await page.locator("#email").fill("example@example.com");
  await page.locator("#sendCode").click();
  await page.waitForFunction(() => !document.getElementById("code").disabled);
  await page.locator("#email").fill("another@example.com");
  assert.equal(await page.locator("#fetchData").isDisabled(), true);
});

test("session removal asks for confirmation and sends the existing delete request", async () => {
  await ready();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", {name: "Remove session"}).click();
  assert.equal(state.auth.protocol_sessions.length, 1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", {name: "Remove session"}).click();
  await page.waitForFunction(() => document.getElementById("sessionCount").textContent === "0 saved");
  assert.equal(state.requests.filter((r) => r.method === "DELETE").length, 1);
});

test("login supports Enter, handles a wrong password, and signs out", async () => {
  state.loggedIn = false;
  await page.goto(`${baseURL}/admin`);
  await page.screenshot({path: path.join(outputDir, "login-desktop.png"), fullPage: true});
  await page.getByLabel("Admin password").fill("wrong");
  await page.getByLabel("Admin password").press("Enter");
  await page.waitForFunction(() => document.getElementById("result").textContent === "Invalid password");
  await page.getByLabel("Admin password").fill("test-password");
  await page.getByLabel("Admin password").press("Enter");
  await page.waitForSelector("#overall");
  await page.locator("#logout").click();
  await page.waitForSelector("#password");
  assert.equal(state.loggedIn, false);
});

test("expired admin sessions return to sign-in", async () => {
  await ready();
  state.loggedIn = false;
  await page.locator("#refresh").click();
  await page.waitForSelector("#password");
});

test("untrusted vacuum names render as text", async () => {
  state.vacuums[0].name = '<img src=x onerror="window.injected=true">';
  await ready();
  assert.equal(await page.locator(".vacuum-card img").count(), 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);
});

test("empty inventory provides an import action", async () => {
  state.vacuums = [];
  state.schedules.devices = [];
  state.auth.protocol_sessions = [];
  state.auth.protocol_session_count = 0;
  await ready();
  assert.equal(await page.getByRole("link", {name: "Import from Roborock"}).count(), 1);
  await page.screenshot({path: path.join(outputDir, "dashboard-empty.png"), fullPage: true});
});

test("mobile, tablet and dark layouts fit the viewport", async () => {
  await ready();
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({width, height: 950});
    await noOverflow();
    if (width === 390) await page.screenshot({path: path.join(outputDir, "dashboard-mobile.png"), fullPage: true});
  }
  await page.setViewportSize({width: 1440, height: 1050});
  await page.emulateMedia({colorScheme: "dark", reducedMotion: "reduce"});
  await noOverflow();
  await page.screenshot({path: path.join(outputDir, "dashboard-dark.png"), fullPage: true});
});

function scheduleCard(id = 42, duid = "sample-downstairs") {
  return page.locator(`.schedule-card[data-device-id="${duid}"][data-job-id="${id}"]`);
}

async function openSchedule(id = 42) {
  const card = scheduleCard(id);
  await card.locator(".schedule-editor > summary").click();
  return card;
}

test("schedule list includes native jobs and distinguishes server permission from unchecked robot state", async () => {
  await ready();
  await page.waitForFunction(() => document.getElementById("scheduleList").getAttribute("aria-busy") === "false");
  assert.equal(await page.locator("#scheduleDevice").inputValue(), "sample-downstairs");
  assert.equal(await page.locator(".schedule-card:visible").count(), 3);
  assert.match(await scheduleCard().locator('[data-field="next"]').textContent(), /America\/Los_Angeles/);
  assert.equal(await scheduleCard().locator('[data-field="enabledBadge"]').textContent(), "Server enabled");
  assert.match(await scheduleCard().locator('[data-field="timerState"]').textContent(), /not checked/);
  assert.equal(await scheduleCard(44).locator(".schedule-editor").isVisible(), false);
  await page.locator("#scheduleDevice").selectOption("sample-upstairs");
  assert.equal(await page.locator(".schedule-card:visible").count(), 1);
  assert.match(await page.locator("#scheduleSummary").textContent(), /Not connected to this server/);
});

test("schedule edits survive polling and save only changed allowed fields", async () => {
  await ready();
  const card = await openSchedule();
  const originalSettings = structuredClone(state.schedules.devices[0].schedules[0].settings);
  await card.getByLabel("Time", {exact: true}).fill("10:15");
  await card.getByLabel("Fri", {exact: true}).uncheck();
  await card.getByLabel("Time", {exact: true}).focus();
  await page.waitForTimeout(2300);
  assert.equal(await card.getByLabel("Time", {exact: true}).inputValue(), "10:15");
  assert.equal(await card.locator(".schedule-editor").getAttribute("open"), "");
  assert.equal(await page.evaluate(() => document.activeElement.name), "time");
  await card.getByRole("button", {name: "Save schedule"}).click();
  await page.waitForFunction(() => document.querySelector('.schedule-card[data-device-id="sample-downstairs"][data-job-id="42"] [data-field="result"]').textContent.includes("Schedule saved"));
  const request = state.requests.find((item) => item.method === "PATCH");
  assert.deepEqual(request.body, {revision: "revision-42", cron: "15 10 * * 1,2,3,4"});
  assert.deepEqual(state.schedules.devices[0].schedules[0].settings, originalSettings);
  assert.equal(state.schedules.devices[0].schedules[0].native_timer_name, "native-kitchen");
  assert.equal(await card.getByRole("button", {name: "Save schedule"}).isDisabled(), true);
});

test("schedule failures preserve edits and revision conflicts require a fresh reload", async () => {
  await ready();
  const card = await openSchedule();
  await card.getByLabel("Time", {exact: true}).fill("10:45");
  state.fail.add("/admin/api/schedules/sample-downstairs/42");
  await card.getByRole("button", {name: "Save schedule"}).click();
  await page.waitForFunction(() => document.querySelector('.schedule-card[data-device-id="sample-downstairs"][data-job-id="42"] [data-field="result"]').textContent.includes("failure"));
  assert.equal(await card.getByLabel("Time", {exact: true}).inputValue(), "10:45");
  assert.equal(await card.getByRole("button", {name: "Save schedule"}).isEnabled(), true);
  state.fail.clear();
  state.scheduleConflict = true;
  await card.getByRole("button", {name: "Save schedule"}).click();
  await page.waitForFunction(() => document.querySelector('.schedule-card[data-device-id="sample-downstairs"][data-job-id="42"] [data-field="result"]').textContent.includes("Schedule changed"));
  assert.equal(await card.getByRole("button", {name: "Save schedule"}).isDisabled(), true);
  assert.equal(await card.getByLabel("Time", {exact: true}).inputValue(), "10:45");
  state.schedules.devices[0].schedules[0].cron = "20 12 * * 1-5";
  state.schedules.devices[0].schedules[0].revision = "remote-revision";
  state.scheduleConflict = false;
  await card.getByRole("button", {name: "Discard edits and reload"}).click();
  await page.waitForFunction(() => document.querySelector('.schedule-card[data-device-id="sample-downstairs"][data-job-id="42"] input[name="time"]').value === "12:20");
  assert.equal(await card.getByRole("button", {name: "Save schedule"}).isDisabled(), true);
});

test("background schedule changes never overwrite an unsaved form", async () => {
  await ready();
  const card = await openSchedule();
  await card.getByLabel("Time", {exact: true}).fill("11:10");
  state.schedules.devices[0].schedules[0].cron = "0 14 * * 1-5";
  state.schedules.devices[0].schedules[0].revision = "changed-by-app";
  await page.locator("#refreshSchedules").click();
  await page.waitForFunction(() => document.querySelector('.schedule-card[data-device-id="sample-downstairs"][data-job-id="42"] [data-field="editStatus"]').textContent.includes("Changed elsewhere"));
  assert.equal(await card.getByLabel("Time", {exact: true}).inputValue(), "11:10");
  assert.equal(await card.getByRole("button", {name: "Save schedule"}).isDisabled(), true);
});

test("advanced recurrence survives unrelated permission edits and unsupported API leaves dashboard usable", async () => {
  await ready();
  const card = await openSchedule(43);
  assert.equal(await card.getByLabel("Recurrence format").inputValue(), "cron");
  assert.equal(await card.getByLabel("Timezone", {exact: true}).inputValue(), "Europe/Berlin");
  await card.getByLabel("Enable schedule").check();
  await card.getByRole("button", {name: "Save schedule"}).click();
  await page.waitForFunction(() => document.querySelector('.schedule-card[data-job-id="43"] [data-field="result"]').textContent.includes("Schedule saved"));
  assert.deepEqual(state.requests.find((item) => item.method === "PATCH").body, {revision: "revision-43", enabled: true});
  assert.equal(state.schedules.devices[0].schedules[1].cron, "0,30 8-9 * * *");
  state.fail.add("/admin/api/schedules");
  await refresh();
  assert.equal(await page.locator("#scheduleError").isVisible(), true);
  assert.equal(await page.locator("#overall").textContent(), "Healthy");
  assert.equal(await page.locator("#pageMessage").isVisible(), false);
  state.fail.clear();
  await page.locator("#refreshSchedules").click();
  await page.waitForFunction(() => document.getElementById("scheduleError").hidden);
});

test("schedule text is inert and the expanded editor fits a small mobile viewport", async () => {
  state.schedules.devices[0].name = '<img src=x onerror="window.injected=true">';
  state.schedules.devices[0].schedules[0].native_timer_name = '<img src=x onerror="window.injected=true">';
  state.schedules.devices[0].schedules[0].settings.segments = '<script>window.injected=true</script>';
  await ready();
  const card = await openSchedule();
  await card.locator(".technical > summary").click();
  assert.equal(await page.locator("#schedules img").count(), 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({width, height: 950});
    await noOverflow();
  }
  await page.locator("#schedules").scrollIntoViewIfNeeded();
  await page.screenshot({path: path.join(outputDir, "schedule-editor-mobile.png"), fullPage: true});
});
