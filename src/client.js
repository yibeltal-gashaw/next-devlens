import { initDevLensClient as _initDevLensClient } from './client/interceptor.js';

/**
 * initDevLensClient — call once in your Next.js client entry point.
 *
 * Options:
 *   relayUrl {string} — where to POST logs.
 *     • Default: 'http://localhost:4321/api/ingest'
 *       Works when the dashboard is on the same machine and the app is HTTP.
 *     • Use '/api/devlens-relay' when your app runs on HTTPS (remote dev
 *       server) to avoid mixed-content blocks. You must also add the relay
 *       API route — see the comment at the bottom of this file.
 *
 * Usage in pages/_app.js:
 *   import { initDevLensClient } from 'next-devlens/src/client';
 *   initDevLensClient();                                    // HTTP / localhost
 *   initDevLensClient({ relayUrl: '/api/devlens-relay' });  // HTTPS / remote
 *
 * Usage in app/layout.js (App Router):
 *   'use client';
 *   import { useEffect } from 'react';
 *   import { initDevLensClient } from 'next-devlens/src/client';
 *   export default function RootLayout({ children }) {
 *     useEffect(() => initDevLensClient({ relayUrl: '/api/devlens-relay' }), []);
 *     return <html><body>{children}</body></html>;
 *   }
 */
export function initDevLensClient(options) {
  return _initDevLensClient(options);
}

/*
 * ── Relay API route for HTTPS / remote dev servers ───────────────────────────
 *
 * Your browser can't fetch http://localhost:4321 from an https:// page —
 * the browser blocks it as mixed content. The fix: post to your own Next.js
 * API route instead, which proxies the log server-side.
 *
 * Create this file in your Next.js app:
 *
 *   pages/api/devlens-relay.js
 *   ─────────────────────────
 *   export default async function handler(req, res) {
 *     if (req.method !== 'POST') return res.status(405).end();
 *     try {
 *       await fetch('http://localhost:4321/api/ingest', {
 *         method: 'POST',
 *         headers: { 'Content-Type': 'application/json' },
 *         body: JSON.stringify(req.body),
 *       });
 *     } catch (_) {}
 *     res.status(200).json({ ok: true });
 *   }
 *
 * Then initialise with:
 *   initDevLensClient({ relayUrl: '/api/devlens-relay' });
 */
