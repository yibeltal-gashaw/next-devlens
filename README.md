<p align="center">
  <img src="https://raw.githubusercontent.com/yibeltal-gashaw/next-devlens/main/public/images/logo.png" width="120" alt="next-devlens logo" />
</p>

# next-devlens

A real-time structured log dashboard for Node.js development. Intercepts `console.log`, `console.warn`, and `console.error` on both the server and browser, streams them to a local dashboard, and displays them with filtering, search, and source tagging.

> **Name note:** The package is called `next-devlens` but works with **any Node.js backend or browser-based frontend** — Express, Fastify, React, Vite, plain HTML, and of course Next.js.

---

## Features

- **Live log streaming** via Server-Sent Events (SSE)
- **Compact & Collapsible Sidebar**: Toggle between a full-width filter panel and a space-saving icon-only view
- **Copy Metadata**: Easily copy structured JSON payload to clipboard with a one-click copy button
- **Separate Server & Client Tabs**: Easily filter messages by execution environment
- **Structured Categories**: Filter logs by Network, Auth, Compiler, System, or Warnings
- **Advanced Search**: Full-text search with `level:`, `src:`, and `cat:` filter tokens
- **Visual Styling**: Color-coded error rows, warnings count highlights, and status indicators
- **Deduplication**: Duplicate consecutive logs are grouped together with a repeat badge count
- **Reading Pause**: Automatically pauses live scrolling when viewing older logs
- **Memory-safe**: Capped at 2,000 log entries in-browser with automatic oldest-entry eviction

---

## Installation

```bash
npm install next-devlens --save-dev
```

Or as a local dependency (monorepo):

```json
{
  "devDependencies": {
    "next-devlens": "https://github.com/yibeltal-gashaw/next-devlens.git"
  }
}
```

---

## How it works

```
Your Node.js server
  └── initDevLens() patches console.log / .warn / .error
        └── HTTP POST → localhost:4321/api/ingest
              └── SSE broadcast → dashboard UI

Your browser app (any framework)
  └── initDevLensClient() patches console.log / .warn / .error
        └── fetch POST → http://localhost:4321/api/ingest   (HTTP / localhost)
              OR
        └── fetch POST → /api/your-relay-route              (HTTPS / remote)
              └── server-side proxy → localhost:4321/api/ingest
                    └── SSE broadcast → dashboard UI
```

---

## Setup

### Step 1 — Start the dashboard

Run this in a separate terminal **before** starting your app:

```bash
npx devlens-dashboard
```

The dashboard opens at **http://localhost:4321**.

To run it alongside your dev server use `concurrently`:

```json
{
  "scripts": {
    "dev": "concurrently -k \"node server.js\" \"npx devlens-dashboard\""
  }
}
```

#### Custom port

The default port is `4321`. Override it with the `DEVLENS_PORT` environment variable:

```bash
DEVLENS_PORT=5000 npx devlens-dashboard
```

Set the same variable in your server process so the interceptor posts to the correct port:

```bash
DEVLENS_PORT=5000 node server.js
```

---

### Step 2 — Server-side logging

Call `initDevLens()` **once** at the top of your server entry point, before anything else boots.
It patches `console.log`, `console.warn`, and `console.error` on the Node.js process and does nothing in `NODE_ENV=production`.

#### Next.js (custom `server.js`)

```js
const { initDevLens } = require('next-devlens');

initDevLens(); // must be called before next() boots

const next = require('next');
const app = next({ dev: true });
app.prepare().then(() => { /* your server setup */ });
```

#### Express

```js
const { initDevLens } = require('next-devlens');
initDevLens();

const express = require('express');
const app = express();
// ... rest of your Express setup
```

#### Fastify

```js
const { initDevLens } = require('next-devlens');
initDevLens();

const fastify = require('fastify')({ logger: false });
// ... rest of your Fastify setup
```

#### Plain Node.js

```js
const { initDevLens } = require('next-devlens');
initDevLens();

const http = require('http');
http.createServer((req, res) => { /* ... */ }).listen(3000);
```

---

### Step 3 — Client-side logging

`initDevLensClient()` works in any browser environment. It patches `console.log`, `console.warn`, and `console.error`, and also catches `window.onerror` and `unhandledrejection` events.

Safe to call multiple times — it guards against double-initialisation (HMR-safe).

#### React / Vite / CRA (HTTP / localhost)

In your root component or entry file:

```js
import { initDevLensClient } from 'next-devlens/src/client.js';

initDevLensClient(); // posts directly to http://localhost:4321/api/ingest
```

#### React / Vite (using `useEffect`)

```js
import { useEffect } from 'react';
import { initDevLensClient } from 'next-devlens/src/client.js';

function App() {
  useEffect(() => { initDevLensClient(); }, []);
  return <>{/* ... */}</>;
}
```

#### Next.js — Pages Router (`pages/_app.js`)

```js
import { initDevLensClient } from 'next-devlens/src/client.js';

initDevLensClient();

function MyApp({ Component, pageProps }) {
  return <Component {...pageProps} />;
}
export default MyApp;
```

#### Next.js — App Router (`app/layout.js`)

```js
'use client';
import { useEffect } from 'react';
import { initDevLensClient } from 'next-devlens/src/client.js';

export default function RootLayout({ children }) {
  useEffect(() => { initDevLensClient(); }, []);
  return <html><body>{children}</body></html>;
}
```

#### Plain HTML / Vanilla JS

```html
<script type="module">
  import { initDevLensClient } from '/node_modules/next-devlens/src/client.js';
  initDevLensClient();
</script>
```

---

### HTTPS / remote dev servers — relay setup

Browsers block `fetch` from an `https://` page to an `http://` endpoint (mixed content). The fix is a thin server-side proxy route that you add to your own app.

Pass `relayUrl` pointing to that route:

```js
initDevLensClient({ relayUrl: '/api/devlens-relay' });
```

Then create the relay endpoint for your framework:

#### Next.js — Pages Router (`pages/api/devlens-relay.js`)

```js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    await fetch('http://localhost:4321/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
  } catch (_) {}
  res.status(200).json({ ok: true });
}
```

#### Next.js — App Router (`app/api/devlens-relay/route.js`)

```js
export async function POST(request) {
  const body = await request.json();
  try {
    await fetch('http://localhost:4321/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (_) {}
  return Response.json({ ok: true });
}
```

#### Express

```js
app.post('/api/devlens-relay', express.json(), async (req, res) => {
  try {
    await fetch('http://localhost:4321/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
  } catch (_) {}
  res.json({ ok: true });
});
```

#### Fastify

```js
fastify.post('/api/devlens-relay', async (request, reply) => {
  try {
    await fetch('http://localhost:4321/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body),
    });
  } catch (_) {}
  return { ok: true };
});
```

---

## Dashboard

Open **http://localhost:4321** in your browser while your app is running.

### Sidebar filters

| Section | Filter | Description |
|---|---|---|
| Source | All Sources | All logs regardless of origin |
| Source | Server Logs | Logs from Node.js / server-side only |
| Source | Client Logs | Logs from the browser only |
| Category | All Logs | All categories |
| Category | Network | HTTP requests and API calls |
| Category | Auth | Authentication events |
| Category | Compiler | Build / compilation messages |
| Category | System | General `console.log` output |
| Category | Warnings | Errors and warnings |

Source and category filters compose — e.g. "Server Logs" + "Network" shows only server-side network logs.

### Search

Type in the search box or press `Ctrl+K` / `Cmd+K` to open the command-palette search.

**Search tokens:**

| Token | Example | Effect |
|---|---|---|
| Plain text | `userId` | Filter by message content |
| `level:` | `level:error` | Filter by log level (`info`, `warn`, `error`) |
| `src:` | `src:client` | Filter by source (`server`, `client`) |
| `cat:` | `cat:network` | Filter by category |

Tokens combine: `level:error cat:network timeout` finds error-level network logs containing "timeout".

### Log rows

| Column | Description |
|---|---|
| Timestamp | `HH:MM:SS.mmm` with milliseconds |
| Source | `server` (blue) or `client` (purple) pill |
| Category | Colour-coded category label |
| Message | Log text, with expandable JSON metadata below |

- **Red left border + tinted row** — error level log
- **xN badge** — repeated consecutive identical message, collapsed into one row
- **View metadata** — click to expand structured object data

---

## API

### `initDevLens()`

```js
const { initDevLens } = require('next-devlens');
initDevLens();
```

Call once in your Node.js server entry point. No options.

- Patches `console.log`, `console.warn`, and `console.error`
- Forwards all output to `http://localhost:4321/api/ingest` (or `DEVLENS_PORT`)
- No-ops in `NODE_ENV=production`

---

### `initDevLensClient(options?)`

```js
import { initDevLensClient } from 'next-devlens/src/client.js';
initDevLensClient(options);
```

Call once in your browser entry point. Browser-only — safe to import in any client file.

| Option | Type | Default | Description |
|---|---|---|---|
| `relayUrl` | `string` | `'http://localhost:4321/api/ingest'` | Endpoint to POST logs to. Use a same-origin relay route for HTTPS apps. |

- Patches `console.log`, `console.warn`, and `console.error`
- Captures `window.onerror` (runtime errors) and `unhandledrejection` events
- Guards against double-initialisation (HMR-safe)
- No-ops in `NODE_ENV=production`

---

## Dashboard server endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Dashboard HTML UI |
| `/api/ingest` | POST | Receives a log payload and broadcasts it to all connected dashboard tabs |
| `/stream` | GET | SSE stream — the dashboard subscribes here for live updates |

### Ingest payload shape

```json
{
  "level": "info",
  "category": "network",
  "source": "server",
  "msg": "GET /api/users 200",
  "meta": { "userId": 42 },
  "time": "14:23:07.042"
}
```

| Field | Required | Values |
|---|---|---|
| `level` | Yes | `"info"`, `"warn"`, `"error"` |
| `source` | Yes | `"server"`, `"client"` |
| `msg` | Yes | Any string |
| `category` | — | `"network"`, `"auth"`, `"compiler"`, `"system"`, `"warning"` (defaults to `"system"`) |
| `meta` | — | Any JSON-serialisable object, or `null` |
| `time` | — | `"HH:MM:SS.mmm"` string |

---

## Troubleshooting

**No logs in dashboard after starting the app**
- Make sure the dashboard is running first: `npx devlens-dashboard`
- Confirm `initDevLens()` is called at the very top of your server entry file
- Test manually:
  ```bash
  curl -X POST http://localhost:4321/api/ingest \
    -H "Content-Type: application/json" \
    -d '{"level":"info","category":"system","source":"server","msg":"test","time":"00:00:00.000"}'
  ```

**No client logs — relay returns 404**
- Verify the relay route file exists and is at the correct path for your framework
- Ensure `relayUrl` in `initDevLensClient()` matches the route path exactly (no trailing slash)

**No client logs — relay returns 200 but nothing in dashboard**
- Check in browser DevTools: `window.__devLensInitialised` should be `true`
- If `undefined`, `initDevLensClient()` was never called or ran server-side (SSR). Wrap it in `useEffect` or a `typeof window !== 'undefined'` guard

**Client logs show in browser console but not in dashboard**
- This is the mixed-content block. Your app is on HTTPS but the default `relayUrl` points to `http://`. Switch to a relay route as described in the HTTPS setup section above

**Logs appear under wrong category**
- Server-side categorisation in `src/server/interceptor.js` is keyword-based. Edit `processAndTransmit()` to add your own keywords or patterns

**Port conflict: `[DevLens] Port 4321 is already in use`**
- Set `DEVLENS_PORT` to a free port: `DEVLENS_PORT=5000 npx devlens-dashboard`
- Set the same variable in your server process: `DEVLENS_PORT=5000 node server.js`
