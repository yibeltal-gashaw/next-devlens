#!/usr/bin/env node
const { startServer } = require('../src/dashboard/server.js');

// Optional: pass the consumer's project directory so the dashboard can run
// npm audit and git commands in the right place.
//   npx devlens-dashboard /path/to/your/project
const projectDir = process.argv[2] || process.cwd();
startServer(undefined, projectDir);
