/**
 * Core client-side console interception code.
 */

// Legacy client interceptor (originally exported by src/index.js)
function initDevLensClientLegacy() {
  // Guard clause: ensure this only boots in a browser window during dev
  if (typeof window === 'undefined' || process.env.NODE_ENV === 'production') return;

  const originalClientLog = console.log;
  const originalClientError = console.error;

  console.log = (...args) => {
    transmitFromBrowser('info', args);
    originalClientLog(...args);
  };

  console.error = (...args) => {
    transmitFromBrowser('error', args);
    originalClientError(...args);
  };

  // Automatically catch unhandled runtime errors occurring in client components
  window.addEventListener('error', (event) => {
    transmitFromBrowser('error', [`Browser Runtime Error: ${event.message} at ${event.filename}:${event.lineno}`]);
  });
}

function transmitFromBrowser(level, args) {
  let structuredData = null;

  const messageParts = args.map(arg => {
    if (arg && typeof arg === 'object') {
      try { structuredData = JSON.parse(JSON.stringify(arg)); } catch(e) { structuredData = { error: "[Unserializable Data]" }; }
      return '';
    }
    return String(arg);
  });

  const textMessage = messageParts.filter(Boolean).join(' ');

  const payload = {
    level,
    category: level === 'error' ? 'warning' : 'system',
    source: 'client',
    msg: `[Browser] ${textMessage}`, // Prefixed so you know it came from the client UI
    meta: structuredData,
    time: new Date().toLocaleTimeString('en-US', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0')
  };

  // Uses native window.fetch instead of Node's http module
  window.fetch('http://localhost:4321/api/ingest', {
    method: 'POST',
    mode: 'cors', // Crucial for cross-origin browser-to-dashboard communication
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => {});
}

// Modern client interceptor (originally exported by src/client.js)
function initDevLensClient({ relayUrl = 'http://localhost:4321/api/ingest' } = {}) {
  // Only run in the browser
  if (typeof window === 'undefined') return;

  // Only run in development
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') return;

  // Guard against double-initialisation (e.g. HMR re-executes this module)
  if (window.__devLensInitialised) return;
  window.__devLensInitialised = true;

  const originalLog   = console.log;
  const originalError = console.error;
  const originalWarn  = console.warn;

  console.log = (...args) => {
    transmitClientLog('info', args, relayUrl);
    originalLog(...args);
  };

  console.error = (...args) => {
    transmitClientLog('error', args, relayUrl);
    originalError(...args);
  };

  console.warn = (...args) => {
    transmitClientLog('warn', args, relayUrl);
    originalWarn(...args);
  };

  // Catch unhandled runtime errors
  window.addEventListener('error', (event) => {
    transmitClientLog('error', [
      `Unhandled Error: ${event.message} at ${event.filename}:${event.lineno}`
    ], relayUrl);
  });

  // Catch unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    transmitClientLog('error', [
      `Unhandled Promise Rejection: ${event.reason}`
    ], relayUrl);
  });
}

function transmitClientLog(level, args, relayUrl) {
  let structuredData = null;

  const messageParts = args.map(arg => {
    if (arg && typeof arg === 'object') {
      try { structuredData = JSON.parse(JSON.stringify(arg)); } catch (e) { structuredData = { error: '[Unserializable Object]' }; }
      return '';
    }
    return String(arg);
  });

  const textMessage = messageParts.filter(Boolean).join(' ');
  if (!textMessage && !structuredData) return; // nothing useful to send

  const payload = {
    level,
    category: level === 'error' ? 'warning' : 'system',
    source: 'client',
    msg: textMessage || '(object)',
    meta: structuredData,
    time: new Date().toLocaleTimeString('en-US', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0')
  };

  fetch(relayUrl, {
    method: 'POST',
    mode: relayUrl.startsWith('/') ? 'same-origin' : 'cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => {}); // fail silently — never break the app
}

module.exports = {
  initDevLensClient,
  initDevLensClientLegacy
};
