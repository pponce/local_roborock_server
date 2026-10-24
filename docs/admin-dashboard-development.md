# Maintaining the standalone admin dashboard

The dashboard at `/admin` uses the existing admin API. Its HTML, CSS and
JavaScript are packaged inside `src/roborock_local_server/admin_ui/`:

| File | Responsibility |
| --- | --- |
| `dashboard.html` | Page sections, labels and reusable vacuum/session templates |
| `login.html` | Admin sign-in form |
| `admin.css` | Shared design tokens, components, responsive layout and system dark mode |
| `admin.js` | API requests, incremental rendering and interaction state |
| `login.js` | Password sign-in and error handling |

`standalone_admin.py` reads these resources using `importlib.resources` and
serves an explicit allowlist of styles/scripts at `/admin/assets/`. The HTML
templates are not exposed as static assets. API authentication is unchanged.
Support links come from the existing project configuration, encoded as inert
JSON. Robot/session names and server messages are rendered with `textContent`.

No frontend framework, bundler, CDN, web font or additional runtime dependency
is required. Docker and wheel installations include the same assets.

## Extending the interface

Add semantic markup and labels in the HTML, reuse the CSS variables/components,
and keep request/rendering logic in JavaScript. New dashboard sections should
also have an anchor in the navigation. Keep technical payloads in expandable
details so that routine tasks remain easy to scan.

Polling starts another request only after the previous refresh finishes and
pauses in hidden tabs. The connection form tracks unsaved changes separately
from the last server response. Vacuum and session cards update in place so
refreshes preserve focus and expanded details. Keep these properties when
adding controls. Errors must remain visible and retryable.

The first [schedule editor](admin-schedule-editor.md) adds authenticated admin
adapters in `admin_schedules.py` over the existing schedule store. It edits only
recurring timing and the server dispatch gate; native timer commands and the
schedule execution engine remain separate. Existing job payloads are preserved.

## Validation

Run the existing Python suite with `uv run pytest -q`. It covers authentication,
asset allowlisting, HTML caching and safe embedded configuration.

Browser tests use fictional data and a loopback-only API fixture. They never
contact a real vacuum or the Roborock cloud. Node is needed only to run these
tests; install its pinned test dependency locally with:

```sh
npm install --no-save --no-package-lock playwright@1.62.1
npx playwright install chromium
node --test tests/browser/admin-ui.test.cjs
```

The admin-dashboard workflow runs these browser checks and the complete Python
suite, verifies that all five UI assets ship in the wheel, and uploads sample
screenshots as `admin-dashboard-previews`. Screenshots cover desktop, mobile,
dark mode, sign-in and empty inventory. They are generated artifacts rather
than maintained application assets.
