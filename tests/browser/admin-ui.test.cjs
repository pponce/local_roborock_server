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
      {duid: "sample-downstairs", name: "Downstairs", model: "roborock.vacuum.a15", connected: true, onboarding: {has_public_key: true, key_state: {query_samples: 4}}},
      {duid: "sample-upstairs", name: "Upstairs", model: "roborock.vacuum.a27", connected: false, onboarding: {has_public_key: false, key_state: {query_samples: 0}}},
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
  switch (url.pathname) {
    case "/admin/api/status": return reply({health: state.health});
    case "/admin/api/vacuums": return reply({vacuums: state.vacuums});
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
