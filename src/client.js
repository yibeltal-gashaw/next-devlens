import { initDevLensClient as _initDevLensClient } from './client/interceptor.js';

/**
 * initDevLensClient — call once in your browser entry point.
 *
 * Works in any browser-based environment: React, Vite, Next.js, Svelte,
 * Vue, plain HTML, etc. Does nothing outside a browser window or in production.
 *
 * Options:
 *   relayUrl {string} — where to POST logs.
 *     • Default: 'http://localhost:4321/api/ingest'
 *       Works when your app and the dashboard run on the same machine over HTTP.
 *     • Use a same-origin path (e.g. '/api/devlens-relay') when your app is
 *       served over HTTPS to avoid mixed-content blocks. You must add a thin
 *       server-side proxy route in your own app — see the README for per-framework
 *       examples (Next.js API routes, Express, Fastify, etc.).
 *
 * ── Usage examples ────────────────────────────────────────────────────────────
 *
 * React / Vite (root component):
 *   import { initDevLensClient } from 'next-devlens/src/client';
 *   initDevLensClient();
 *
 * React / Vite (with useEffect):
 *   useEffect(() => initDevLensClient(), []);
 *
 * Next.js — Pages Router (pages/_app.js):
 *   import { initDevLensClient } from 'next-devlens/src/client';
 *   initDevLensClient();
 *
 * Next.js — App Router (app/layout.js):
 *   'use client';
 *   import { useEffect } from 'react';
 *   import { initDevLensClient } from 'next-devlens/src/client';
 *   export default function RootLayout({ children }) {
 *     useEffect(() => initDevLensClient({ relayUrl: '/api/devlens-relay' }), []);
 *     return <html><body>{children}</body></html>;
 *   }
 *
 * Plain HTML:
 *   <script type="module">
 *     import { initDevLensClient } from '/node_modules/next-devlens/src/client.js';
 *     initDevLensClient();
 *   </script>
 */
export function initDevLensClient(options) {
  return _initDevLensClient(options);
}

/*
 * ── Relay setup for HTTPS / remote dev servers ───────────────────────────────
 *
 * Browsers block fetch() from an https:// page to an http:// endpoint.
 * The fix is a thin server-side proxy in your own app. Per-framework examples
 * (Next.js Pages Router, Next.js App Router, Express, Fastify) are in the README.
 *
 * Short version — create a POST endpoint in your app that does:
 *
 *   await fetch('http://localhost:4321/api/ingest', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify(<forwarded-body>),
 *   });
 *
 * Then initialise with:
 *   initDevLensClient({ relayUrl: '/api/devlens-relay' });
 */

