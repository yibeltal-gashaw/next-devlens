const http = require('http');

function initDevLens() {
  if (process.env.NODE_ENV === 'production') return;

  const originalLog  = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args) => {
    processAndTransmit('info', args);
    originalLog(...args);
  };

  console.warn = (...args) => {
    processAndTransmit('warn', args);
    originalWarn(...args);
  };

  console.error = (...args) => {
    processAndTransmit('error', args);
    originalError(...args);
  };
}

function processAndTransmit(level, args) {
  let category = 'system';
  let structuredData = null;
  let textMessage = '';

  const messageParts = args.map(arg => {
    if (arg && typeof arg === 'object') {
      structuredData = arg; 
      return '';
    }
    return String(arg);
  });

  textMessage = messageParts.filter(Boolean).join(' ');
  textMessage = textMessage.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

  if (textMessage.includes('🌐') || textMessage.includes('API Access') || textMessage.includes('POST /api') || textMessage.includes('GET /')) {
    category = 'network';
  } else if (textMessage.includes('🚀') || textMessage.includes('UNIFIED AUTH')) {
    category = 'auth';
  } else if (textMessage.includes('Compiling') || textMessage.includes('Compiled')) {
    category = 'compiler';
  } else if (level === 'error' || textMessage.includes('Warning')) {
    category = 'warning';
  }

  const payload = JSON.stringify({
    level,
    category,
    source: 'server',
    msg: textMessage,
    meta: structuredData,
    time: new Date().toLocaleTimeString('en-US', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0')
  });

  const DEVLENS_PORT = parseInt(process.env.DEVLENS_PORT, 10) || 4321;
  const req = http.request({
    hostname: 'localhost',
    port: DEVLENS_PORT,
    path: '/api/ingest',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  });

  req.on('error', () => {});
  req.write(payload);
  req.end();
}

module.exports = {
  initDevLens
};
