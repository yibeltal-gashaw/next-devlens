const http = require('http');

function initDevLens() {
  if (process.env.NODE_ENV === 'production') return;

  const originalLog   = console.log;
  const originalWarn  = console.warn;
  const originalError = console.error;

  console.log = (...args) => { processAndTransmit('info',  args); originalLog(...args);   };
  console.warn  = (...args) => { processAndTransmit('warn',  args); originalWarn(...args);  };
  console.error = (...args) => { processAndTransmit('error', args); originalError(...args); };
}

/**
 * Classify a log message into one of the known categories.
 * Rules are ordered most-specific → least-specific to avoid false positives.
 */
function categorise(level, text) {
  // TypeScript compiler errors
  if (/\berror\s+TS\d+|Type\s+error:|TS\d+:/i.test(text))                              return 'types';
  // Linter output (ESLint, Stylelint, etc.)
  if (/\d+:\d+\s+(error|warning)\s+\S|eslint|stylelint|no-unused|@typescript-eslint/i.test(text)) return 'lint';
  // Test runner output (Jest, Vitest, Mocha, etc.)
  if (/\b(PASS|FAIL|PASSED|FAILED|✓|✗|describe\(|it\(|test\(|expect\(|jest|vitest|mocha|jasmine|cypress)\b/i.test(text)) return 'tests';
  // Database queries
  if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE TABLE|DROP TABLE|TRUNCATE|prisma\.|mongoose\.|sequelize\.|knex\.|typeorm|slow query|DB error|query\s+took)\b/i.test(text)) return 'database';
  // Performance signals
  if (/\b(latency|timeout|\d+\s*ms\b|response\s+time|slow\s+request|heap\s+used|memory\s+usage|LCP|FID|CLS|TTFB|FCP)\b/i.test(text)) return 'performance';
  // Accessibility
  if (/\b(axe-core|axe:|aria-|a11y|wcag|accessibility\s+violation|screen\s+reader)\b/i.test(text)) return 'accessibility';
  // Network / HTTP
  if (/🌐|API Access|\b(GET|POST|PUT|DELETE|PATCH|HEAD)\s+\/|http(s)?:\/\//i.test(text)) return 'network';
  // Auth / identity
  if (/🚀|UNIFIED AUTH|\b(login|logout|sign.?in|sign.?up|jwt|bearer\s+token|session|unauthorized|forbidden|401|403)\b/i.test(text)) return 'auth';
  // Compiler / bundler
  if (/\b(Compiling|Compiled\s+successfully|Failed\s+to\s+compile|webpack|turbopack|vite|esbuild|next\s+build|bundl)\b/i.test(text)) return 'compiler';
  // Catch-all: errors and explicit warnings
  if (level === 'error' || /\bWarning\b/i.test(text)) return 'warning';
  return 'system';
}

function processAndTransmit(level, args) {
  let structuredData = null;

  const messageParts = args.map(arg => {
    if (arg && typeof arg === 'object') { structuredData = arg; return ''; }
    return String(arg);
  });

  const textMessage = messageParts.filter(Boolean).join(' ')
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ''); // strip ANSI colour codes

  const payload = JSON.stringify({
    level,
    category: categorise(level, textMessage),
    source:   'server',
    msg:      textMessage,
    meta:     structuredData,
    time:     new Date().toLocaleTimeString('en-US', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0')
  });

  const DEVLENS_PORT = parseInt(process.env.DEVLENS_PORT, 10) || 4321;
  const req = http.request({
    hostname: 'localhost',
    port:     DEVLENS_PORT,
    path:     '/api/ingest',
    method:   'POST',
    headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  });

  req.on('error', () => {}); // fail silently — dashboard may not be running
  req.write(payload);
  req.end();
}

module.exports = { initDevLens };
