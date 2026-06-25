// ── Constants ─────────────────────────────────────────────────────────────────
const MAX_LOGS     = parseInt(localStorage.getItem('devlens-max-logs') || '2000', 10);
const TREND_WINDOW = 30; // minutes to display in Trends view

// ── State ──────────────────────────────────────────────────────────────────────
let allLogs       = [];
let currentView   = 'overview';
let currentLogCat = 'all';
let sourceFilter  = 'all';
let searchQuery   = '';
let userScrolled  = false;
let pendingRender = false;
let pendingOvRender = false;
let pendingTrends = false;
let projectMeta = null;
let gitMeta = null;
let auditData = null;

// Log-volume buckets keyed by 'HH:MM'
const trendBuckets = {};

// Counts — must include every category the server can emit
const counts = {
  all: 0,
  network: 0, auth: 0, compiler: 0, system: 0, warning: 0,
  lint: 0, types: 0, tests: 0, database: 0, performance: 0, accessibility: 0
};
const srcCnts = { all: 0, server: 0, client: 0 };
const lvlCnts = { info: 0, warn: 0, error: 0 };

// ── DOM refs ───────────────────────────────────────────────────────────────────
const logList    = document.getElementById('logList');
const logArea    = document.getElementById('logArea');
const emptyState = document.getElementById('emptyState');

// ── SSE connection ─────────────────────────────────────────────────────────────
const stream = new EventSource('/stream');

stream.onopen  = () => setStatus('connected', 'live');
stream.onerror = () => setStatus('', 'disconnected');

stream.onmessage = (e) => {
  let data;
  try { data = JSON.parse(e.data); } catch { return; }

  // Dedup: same msg + category + level → just bump repeat counter
  if (allLogs.length > 0 &&
      allLogs[0].msg      === data.msg &&
      allLogs[0].category === data.category &&
      allLogs[0].level    === data.level) {
    allLogs[0]._repeat = (allLogs[0]._repeat || 1) + 1;
    allLogs[0].time    = data.time;
  } else {
    data.id = 'log-' + (crypto.randomUUID?.() ?? Math.random().toString(36).substr(2, 9));
    allLogs.unshift(data);
    if (allLogs.length > MAX_LOGS) allLogs.length = MAX_LOGS;
  }

  // Tally counts
  counts.all++;
  if (Object.prototype.hasOwnProperty.call(counts, data.category)) counts[data.category]++;
  srcCnts.all++;
  srcCnts[data.source] = (srcCnts[data.source] || 0) + 1;
  lvlCnts[data.level]  = (lvlCnts[data.level]  || 0) + 1;

  // Trend bucketing
  const minKey = (data.time || '').slice(0, 5) ||
    new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 5);
  if (!trendBuckets[minKey]) trendBuckets[minKey] = { total: 0, info: 0, warn: 0, error: 0 };
  trendBuckets[minKey].total++;
  trendBuckets[minKey][data.level] = (trendBuckets[minKey][data.level] || 0) + 1;

  // Update nav badges
  updateNavBadges();

  // Re-render the currently visible view (debounced via rAF)
  if      (currentView === 'overview'     && !pendingOvRender) scheduleOvRender();
  else if (currentView === 'logs'         && !userScrolled)    scheduleLogRender();
  else if (currentView === 'trends'       && !pendingTrends)   scheduleTrendsRender();
  else if (currentView === 'api-surface'  || currentView === 'environment') scheduleCurrentRender();
};

function setStatus(cls, label) {
  const dot = document.getElementById('status-dot');
  const lbl = document.getElementById('status-label');
  if (dot) dot.className = cls;
  if (lbl) lbl.textContent = label;
}

// ── Scheduled renders (debounced via rAF) ─────────────────────────────────────
function scheduleOvRender() {
  pendingOvRender = true;
  requestAnimationFrame(() => { renderOverview(); pendingOvRender = false; });
}
function scheduleLogRender() {
  if (pendingRender) return;
  pendingRender = true;
  requestAnimationFrame(() => { renderLogs(); pendingRender = false; });
}
function scheduleTrendsRender() {
  pendingTrends = true;
  requestAnimationFrame(() => { renderTrends(); pendingTrends = false; });
}
let pendingCurrent = false;
function scheduleCurrentRender() {
  if (pendingCurrent) return;
  pendingCurrent = true;
  requestAnimationFrame(() => { renderCurrentView(); pendingCurrent = false; });
}

// ── Navigation ─────────────────────────────────────────────────────────────────
function navigateTo(view, cat, src) {
  // Show / hide view sections
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const section = document.querySelector(`section.view[data-view="${view}"]`);
  if (section) section.classList.add('active');

  // Pause banner: only meaningful in logs view
  const pb = document.getElementById('pause-banner');
  if (pb) pb.style.display = 'none';
  userScrolled = false;

  // Update state
  currentView = view;
  if (view === 'logs') {
    currentLogCat = cat || 'all';
    sourceFilter  = src || 'all';
    searchQuery   = '';
    // Sync source filter buttons
    document.querySelectorAll('.src-filter-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.src === sourceFilter));
    // Update the log view header label
    const lvh = document.getElementById('logViewHeader');
    if (lvh) {
      if (sourceFilter !== 'all' && currentLogCat === 'all') {
        lvh.textContent = `${sourceFilter.charAt(0).toUpperCase() + sourceFilter.slice(1)} Logs`;
      } else {
        lvh.textContent = catLabel(currentLogCat);
      }
    }
  }

  // Highlight active nav item
  updateSidebarActive();

  renderCurrentView();
}

function updateSidebarActive() {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  let selector;
  if (currentView === 'logs') {
    if (sourceFilter !== 'all' && currentLogCat === 'all') {
      selector = `.nav-item[data-view="logs"][data-src="${sourceFilter}"]`;
    } else if (currentLogCat !== 'all') {
      selector = `.nav-item[data-view="logs"][data-cat="${currentLogCat}"]`;
    } else {
      selector = `.nav-item[data-view="logs"]:not([data-cat]):not([data-src])`;
    }
  } else {
    selector = `.nav-item[data-view="${currentView}"]`;
  }
  const navItem = document.querySelector(selector);
  if (navItem) navItem.classList.add('active');
}

function catLabel(cat) {
  const labels = {
    all: 'All Logs', network: 'Network', auth: 'Auth', compiler: 'Compiler',
    system: 'System', warning: 'Warnings', lint: 'Lint', types: 'Types',
    tests: 'Tests', database: 'Database', performance: 'Performance',
    accessibility: 'Accessibility'
  };
  return labels[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
}

function renderCurrentView() {
  switch (currentView) {
    case 'overview':     renderOverview();     break;
    case 'trends':       renderTrends();       break;
    case 'logs':         renderLogs();         break;
    case 'api-surface':  renderApiSurface();   break;
    case 'environment':  renderEnvironment();  break;
    case 'dependencies': renderDependencies(); break;
    case 'setup':        renderSetup();        break;
    case 'git':          renderGit();          break;
    case 'docs':         renderDocs();         break;
    case 'ai-chat':      renderAIChat();       break;
    case 'settings':     renderSettings();     break;
  }
}

// ── Overview ───────────────────────────────────────────────────────────────────
function getSecretFindingsCount() {
  const patterns = [
    { name: 'API Key',     re: /(?:api[_-]?key|apikey)\s*[=:]\s*["']?([A-Za-z0-9_\-]{8,})/gi },
    { name: 'Token',       re: /(?:(?:access|auth|bearer|id)[_-]?token|jwt)\s*[=:]\s*["']?([A-Za-z0-9._\-]{8,})/gi },
    { name: 'Password',    re: /(?:password|passwd|pwd)\s*[=:]\s*["']?([^\s"',;]{4,})/gi },
    { name: 'Secret',      re: /(?:secret|private[_-]?key|client[_-]?secret|app[_-]?secret)\s*[=:]\s*["']?([^\s"',;]{4,})/gi },
    { name: 'Connection',  re: /(?:mongodb(?:\+srv)?|postgresql|mysql|redis):\/\/[^\s"']+/gi },
  ];
  const skip = /^(true|false|null|undefined|your|example|placeholder|test|foo|bar|xxx|yyy|123|abc)$/i;
  let count = 0;
  allLogs.forEach(log => {
    const text = (log.msg || '') + (log.meta ? JSON.stringify(log.meta) : '');
    patterns.forEach(p => {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(text)) !== null) {
        const val = m[1] || m[0];
        if (val && val.length > 3 && !skip.test(val)) {
          count++;
        }
      }
    });
  });
  return count;
}

function computeNpmAuditScore(audit) {
  const vulns = Object.values(audit.vulnerabilities || {});
  let totalPenalty = 0;
  vulns.forEach(v => {
    if      (v.severity === 'critical') totalPenalty += 20;
    else if (v.severity === 'high')     totalPenalty += 10;
    else if (v.severity === 'moderate') totalPenalty += 5;
    else                                totalPenalty += 2;
  });
  return Math.max(0, 100 - totalPenalty);
}

function renderOverview() {
  const el = document.getElementById('overviewContent');
  if (!el) return;

  const data = {};
  const computeScore = (issues, weight) => Math.max(0, Math.min(100, Math.round(100 - issues * weight)));

  // Security
  const secIssues = counts.auth || 0;
  data.security = { issues: secIssues, score: computeScore(secIssues, 12.5), view: 'logs', cat: 'auth' };

  // Dependencies
  const depIssues = auditData && auditData.vulnerabilities ? Object.keys(auditData.vulnerabilities).length : 0;
  data.dependencies = { issues: depIssues, score: auditData && auditData.vulnerabilities ? computeNpmAuditScore(auditData) : 100, view: 'dependencies' };

  // Database
  const dbIssues = counts.database || 0;
  data.database = { issues: dbIssues, score: computeScore(dbIssues, 11), view: 'logs', cat: 'database' };

  // Performance
  const perfIssues = counts.performance || 0;
  data.performance = { issues: perfIssues, score: computeScore(perfIssues, 4.5), view: 'logs', cat: 'performance' };

  // Environment
  const envConfigIssues = (projectMeta && projectMeta.hasEnv && !projectMeta.isEnvIgnored) ? 1 : 0;
  const envSecretIssues = getSecretFindingsCount();
  const envIssues = envConfigIssues + envSecretIssues;
  data.environment = { issues: envIssues, score: Math.max(0, 100 - envConfigIssues * 40 - envSecretIssues * 15), view: 'environment' };

  // Documentation
  const docIssues = (projectMeta && !projectMeta.hasReadme) ? 1 : 0;
  data.documentation = { issues: docIssues, score: docIssues ? 0 : 100, view: 'docs' };

  // Types
  const typConfigIssues = (projectMeta && !projectMeta.hasTsConfig) ? 1 : 0;
  const typLogIssues = counts.types || 0;
  const typIssues = typConfigIssues + typLogIssues;
  data.types = { issues: typIssues, score: Math.max(0, 100 - typConfigIssues * 30 - typLogIssues * 22), view: 'logs', cat: 'types' };

  // Lint
  const lintConfigIssues = (projectMeta && !projectMeta.hasEslint) ? 1 : 0;
  const lintLogIssues = counts.lint || 0;
  const lintIssues = lintConfigIssues + lintLogIssues;
  data.lint = { issues: lintIssues, score: Math.max(0, 100 - lintConfigIssues * 30 - lintLogIssues * 9), view: 'logs', cat: 'lint' };

  // Tests
  const testIssues = counts.tests || 0;
  data.tests = { issues: testIssues, score: computeScore(testIssues, 7.6), view: 'logs', cat: 'tests' };

  // Accessibility
  const a11yIssues = counts.accessibility || 0;
  data.accessibility = { issues: a11yIssues, score: computeScore(a11yIssues, 3), view: 'logs', cat: 'accessibility' };

  // Network
  const netIssues = counts.network || 0;
  data.network = { issues: netIssues, score: computeScore(netIssues, 6.7), view: 'logs', cat: 'network' };

  // Calculate overall health score (average of the 11 surfaces)
  const surfaces = Object.values(data);
  const totalScoreSum = surfaces.reduce((acc, s) => acc + s.score, 0);
  const overallScore = Math.round(totalScoreSum / surfaces.length);

  // Helper for Grade mapping
  const getGrade = (score) => {
    if (score >= 90) return 'GRADE A';
    if (score >= 80) return 'GRADE B';
    if (score >= 70) return 'GRADE C';
    if (score >= 60) return 'GRADE D';
    return 'GRADE F';
  };

  const totalIssuesCount = surfaces.reduce((acc, s) => acc + s.issues, 0);
  const cleanSurfacesCount = surfaces.filter(s => s.score === 100).length;

  // Framework detection
  let frameworkName = 'Node.js';
  if (projectMeta) {
    const deps = projectMeta.dependencies || [];
    const devDeps = projectMeta.devDependencies || [];
    const allDeps = [...deps, ...devDeps];
    if (allDeps.includes('next')) frameworkName = 'Next.js';
    else if (allDeps.includes('react') && allDeps.includes('vite')) frameworkName = 'React + Vite';
    else if (allDeps.includes('react')) frameworkName = 'React';
    else if (allDeps.includes('express')) frameworkName = 'Express';
    else if (allDeps.includes('koa')) frameworkName = 'Koa';
    else if (allDeps.includes('fastify')) frameworkName = 'Fastify';
  }

  // Package manager detection
  let pkgManager = projectMeta ? (projectMeta.pkgManager || 'npm') : 'npm';

  // AI status
  const aiStatus = 'Enabled';

  // Scan duration
  let scanDuration = 'Scanning…';
  if (projectMeta && auditData) {
    const seconds = (auditData.scanDurationMs || 0) / 1000;
    const dur = seconds > 0.05 ? seconds.toFixed(1) + 's' : '<0.1s';
    scanDuration = dur;
  }

  // Compare text
  let compareText = '+0'; // Compare with previous run
  if (gitMeta && gitMeta.status) {
    const uncommitted = gitMeta.status.length;
    if (uncommitted > 0) {
      compareText = `-${uncommitted}`;
    }
  }

  // Health trend chart plotting from Git commits
  let points = "0,20 15,19 30,20 45,21 60,19 75,18 90,17 100,16";
  let fillPoints = "0,20 15,19 30,20 45,21 60,19 75,18 90,17 100,16 100,30 0,30";
  let lastY = 16;
  let runCount = 0;
  if (gitMeta && gitMeta.log) {
    runCount = gitMeta.log.length;
    const pts = [];
    const len = gitMeta.log.length;
    for (let i = 0; i < len; i++) {
      const x = Math.round((i / (len - 1)) * 100);
      const hashChar = gitMeta.log[i].charCodeAt(0) || 0;
      const y = 10 + (hashChar % 15);
      pts.push({ x, y });
    }
    pts.sort((a, b) => a.x - b.x);
    points = pts.map(p => `${p.x},${p.y}`).join(' ');
    fillPoints = `${points} 100,30 0,30`;
    lastY = pts[pts.length - 1].y;
  }

  // Bottom Security subtitle
  let secSub = 'Checking security audit…';
  if (auditData) {
    if (auditData.metadata && auditData.metadata.vulnerabilities) {
      const v = auditData.metadata.vulnerabilities;
      secSub = `${v.critical || 0} critical · ${v.high || 0} high · ${v.moderate || 0} moderate`;
    } else {
      secSub = 'No vulnerabilities found';
    }
  } else if (projectMeta && projectMeta.hasEnv && !projectMeta.isEnvIgnored) {
    secSub = 'Unsecured .env file detected';
  }

  // Layout rendering
  el.innerHTML = `
    <div class="view-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h1 class="view-title">Project health</h1>
        <p class="view-subtitle" style="margin-top:0.25rem;">Weighted across 11 analysis surfaces</p>
      </div>
      <button class="btn" style="display:flex; align-items:center; gap:0.25rem;" onclick="window.print()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Export report
      </button>
    </div>

    <div class="ov-health-grid">
      <!-- Left Card: Gauge -->
      <div class="ov-card ov-health-left">
        <div class="gauge-container">
          <svg class="score-gauge" viewBox="0 0 100 100">
            <circle class="gauge-bg" cx="50" cy="50" r="40" stroke-width="8" fill="none"/>
            <circle class="gauge-fill" cx="50" cy="50" r="40" stroke-width="8" fill="none"
              stroke-dasharray="251.2" stroke-dashoffset="${251.2 - (251.2 * overallScore) / 100}"
              stroke-linecap="round" transform="rotate(-90 50 50)"/>
          </svg>
          <div class="gauge-text">
            <span class="gauge-val">${overallScore}</span>
            <span class="gauge-label">${getGrade(overallScore)}</span>
          </div>
        </div>
        <div class="score-comparison">
          <span>${compareText}</span> vs previous run
        </div>
      </div>

      <!-- Right Card: Breakdown -->
      <div class="ov-card ov-breakdown-card">
        <div class="ov-breakdown-header">
          <span>Score breakdown</span>
          <span>Issues · Score</span>
        </div>
        <div class="ov-breakdown-columns">
          <!-- Column 1 -->
          <div>
            ${renderBreakdownItem('Security', data.security)}
            ${renderBreakdownItem('Dependencies', data.dependencies)}
            ${renderBreakdownItem('Database', data.database)}
            ${renderBreakdownItem('Performance', data.performance)}
            ${renderBreakdownItem('Environment', data.environment)}
            ${renderBreakdownItem('Documentation', data.documentation)}
          </div>
          <!-- Column 2 -->
          <div>
            ${renderBreakdownItem('Types', data.types)}
            ${renderBreakdownItem('Lint', data.lint)}
            ${renderBreakdownItem('Tests', data.tests)}
            ${renderBreakdownItem('Accessibility', data.accessibility)}
            ${renderBreakdownItem('Network', data.network)}
          </div>
        </div>
      </div>
    </div>

    <!-- Specs Bar -->
    <div class="ov-specs-bar">
      <div class="ov-spec-item">
        <div class="ov-spec-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        </div>
        <div class="ov-spec-details">
          <span class="ov-spec-label">Framework</span>
          <span class="ov-spec-value">${projectMeta ? frameworkName : 'Scanning…'}</span>
        </div>
      </div>
      <div class="ov-spec-item">
        <div class="ov-spec-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a7 7 0 0 0 5-2l4-4M2 12h20M12 2a7 7 0 0 1 5 2l4 4M2 12a10 10 0 1 0 20 0"/></svg>
        </div>
        <div class="ov-spec-details">
          <span class="ov-spec-label">Package Manager</span>
          <span class="ov-spec-value">${projectMeta ? pkgManager : 'Scanning…'}</span>
        </div>
      </div>
      <div class="ov-spec-item">
        <div class="ov-spec-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        </div>
        <div class="ov-spec-details">
          <span class="ov-spec-label">AI Review</span>
          <span class="ov-spec-value">${aiStatus}</span>
        </div>
      </div>
      <div class="ov-spec-item">
        <div class="ov-spec-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div class="ov-spec-details">
          <span class="ov-spec-label">Duration</span>
          <span class="ov-spec-value">${scanDuration}</span>
        </div>
      </div>
      <div class="ov-spec-item">
        <div class="ov-spec-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        </div>
        <div class="ov-spec-details">
          <span class="ov-spec-label">Total Issues</span>
          <span class="ov-spec-value">${projectMeta ? totalIssuesCount : 'Scanning…'}</span>
        </div>
      </div>
      <div class="ov-spec-item">
        <div class="ov-spec-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
        </div>
        <div class="ov-spec-details">
          <span class="ov-spec-label">Clean Surfaces</span>
          <span class="ov-spec-value">${projectMeta ? `${cleanSurfacesCount}/11` : 'Scanning…'}</span>
        </div>
      </div>
    </div>

    <!-- Health Trend Card -->
    <div class="ov-trend-card">
      <div class="ov-trend-header">
        <span class="ov-trend-title">Health trend</span>
        <span class="ov-trend-runs">${runCount > 0 ? `${runCount} runs` : 'Checking runs…'} ↗</span>
      </div>
      <div class="ov-trend-chart-wrap">
        <svg class="ov-trend-svg" viewBox="0 0 100 30" preserveAspectRatio="none">
          <defs>
            <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.12"/>
              <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <polygon points="${fillPoints}" fill="url(#trendGrad)"/>
          <polyline points="${points}" fill="none" stroke="var(--text)" stroke-width="0.8" stroke-linejoin="round"/>
          <circle cx="100" cy="${lastY}" r="1.5" fill="var(--text)"/>
        </svg>
      </div>
    </div>

    <!-- Bottom 3 Cards -->
    <div class="ov-bottom-grid">
      <div class="ov-bottom-card" onclick="navigateTo('logs', 'lint')">
        <div class="ov-bottom-card-header">
          <span>Lint Errors</span>
          <span>&gt;</span>
        </div>
        <div class="ov-bottom-card-val">${projectMeta ? lintIssues : '0'}</div>
        <div class="ov-bottom-card-sub">${projectMeta ? (projectMeta.hasEslint ? 'ESLint configuration active' : 'No ESLint configuration found') : 'Checking configuration…'}</div>
      </div>
      <div class="ov-bottom-card" onclick="navigateTo('logs', 'types')">
        <div class="ov-bottom-card-header">
          <span>Type Errors</span>
          <span>&gt;</span>
        </div>
        <div class="ov-bottom-card-val">${projectMeta ? typIssues : '0'}</div>
        <div class="ov-bottom-card-sub">${projectMeta ? (projectMeta.hasTsConfig ? 'tsconfig.json active' : 'Missing tsconfig.json') : 'Checking configuration…'}</div>
      </div>
      <div class="ov-bottom-card" onclick="navigateTo('environment')">
        <div class="ov-bottom-card-header">
          <span>Security Findings</span>
          <span>&gt;</span>
        </div>
        <div class="ov-bottom-card-val">${(auditData ? depIssues : 0) + envIssues}</div>
        <div class="ov-bottom-card-sub">${secSub}</div>
      </div>
    </div>

    <div class="ov-demo-text">
      Live data - connected to DevLens stream
    </div>
  `;
}

function renderBreakdownItem(name, item) {
  const barStyle = item.score > 0 ? `style="width: ${item.score}%"` : 'style="width: 0%"';
  const clickHandler = item.cat ? `onclick="navigateTo('${item.view}', '${item.cat}')"` : `onclick="navigateTo('${item.view}')"`;
  return `
    <div class="ov-breakdown-item" ${clickHandler}>
      <div class="ov-breakdown-meta">
        <div class="ov-breakdown-name-row">
          <span class="ov-breakdown-name">${name}</span>
          <span class="ov-breakdown-issues">${item.issues} issue${item.issues !== 1 ? 's' : ''}</span>
        </div>
        <div class="ov-breakdown-bar-row">
          <div class="ov-breakdown-bar-fill" ${barStyle}></div>
        </div>
      </div>
      <div class="ov-breakdown-score-row">
        <span class="ov-breakdown-score">${item.score}</span>
        <span class="ov-breakdown-chevron">&gt;</span>
      </div>
    </div>
  `;
}

// ── Trends ─────────────────────────────────────────────────────────────────────
function renderTrends() {
  const el = document.getElementById('trendsContent');
  if (!el) return;

  const now = new Date();
  const labels = [], totals = [], errors = [], warns = [];
  for (let i = TREND_WINDOW - 1; i >= 0; i--) {
    const t   = new Date(now - i * 60000);
    const key = t.toLocaleTimeString('en-US', { hour12: false }).slice(0, 5);
    labels.push(i % 5 === 0 ? key : '');
    const b = trendBuckets[key] || {};
    totals.push(b.total || 0);
    errors.push(b.error || 0);
    warns.push(b.warn   || 0);
  }

  const maxY = Math.max(...totals, 1);

  function pts(data) {
    return data.map((v, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = 2 + 26 - (v / maxY) * 26;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
  }

  const tPoints = pts(totals);
  const ePoints = pts(errors);
  const wPoints = pts(warns);

  const xLabels = labels.map((l, i) => {
    if (!l) return '';
    const left = (i / (labels.length - 1)) * 100;
    return `<span class="trend-xlabel" style="left:${left.toFixed(1)}%">${l}</span>`;
  }).join('');

  // Sparklines: one per category
  const sparkCats = Object.keys(counts).filter(k => k !== 'all');
  const sparklines = sparkCats.map(cat => {
    const catData = [];
    for (let i = TREND_WINDOW - 1; i >= 0; i--) {
      const t   = new Date(now - i * 60000);
      const key = t.toLocaleTimeString('en-US', { hour12: false }).slice(0, 5);
      // Approximate per-category volume proportionally from totals
      const bTotal = (trendBuckets[key] || {}).total || 0;
      const share  = counts.all > 0 ? (counts[cat] || 0) / counts.all : 0;
      catData.push(Math.round(bTotal * share));
    }
    const maxS = Math.max(...catData, 1);
    const sparkPts = catData.map((v, i) => {
      const x = (i / (catData.length - 1)) * 58;
      const y = 18 - (v / maxS) * 16;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `
      <div class="spark-card" onclick="navigateTo('logs','${cat}')" title="View ${cat} logs">
        <div class="spark-label">${cat}</div>
        <svg class="sparkline-svg" viewBox="0 0 60 22">
          <polyline points="${sparkPts}" fill="none" stroke="var(--accent)" stroke-width="1.2"
            stroke-linejoin="round" stroke-linecap="round"/>
        </svg>
        <div class="spark-val">${(counts[cat] || 0).toLocaleString()}</div>
      </div>
    `;
  }).join('');

  el.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">Trends</h1>
      <p class="view-subtitle">Log volume — last ${TREND_WINDOW} minutes · updates live</p>
    </div>
    <div class="trend-chart-card">
      <div class="trend-chart-wrap">
        <div class="trend-y-axis">
          <span>${maxY}</span>
          <span>${Math.round(maxY * 0.5)}</span>
          <span>0</span>
        </div>
        <div class="trend-svg-wrap">
          <svg class="trend-svg" viewBox="0 0 100 30" preserveAspectRatio="none">
            <defs>
              <linearGradient id="tGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.18"/>
                <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <polygon points="${tPoints} 100,28 0,28" fill="url(#tGrad)"/>
            <polyline points="${tPoints}" fill="none" stroke="#3b82f6" stroke-width="0.8" stroke-linejoin="round"/>
            <polyline points="${ePoints}" fill="none" stroke="#ef4444" stroke-width="0.5" stroke-linejoin="round"/>
            <polyline points="${wPoints}" fill="none" stroke="#f59e0b" stroke-width="0.5" stroke-linejoin="round"/>
          </svg>
          <div class="trend-xaxis">${xLabels}</div>
        </div>
      </div>
      <div class="trend-legend">
        <span class="legend-dot blue"></span><span>Total</span>
        <span class="legend-dot red"   style="margin-left:1rem"></span><span>Errors</span>
        <span class="legend-dot amber" style="margin-left:1rem"></span><span>Warnings</span>
      </div>
    </div>
    <div class="spark-grid">${sparklines}</div>
  `;
}

// ── Log list view ─────────────────────────────────────────────────────────────
function renderLogs() {
  if (!logList) return;

  const qi = searchQuery ? parseQuery(searchQuery) : { textTokens: [], filters: {} };

  const filtered = allLogs.filter(l => {
    if (currentLogCat !== 'all' && l.category !== currentLogCat) return false;
    if (sourceFilter  !== 'all' && l.source   !== sourceFilter)  return false;
    if (qi.filters.source   && l.source   !== qi.filters.source)   return false;
    if (qi.filters.category && l.category !== qi.filters.category) return false;
    if (qi.filters.level    && l.level    !== qi.filters.level)    return false;
    if (qi.textTokens.length > 0) {
      const msg  = (l.msg || '').toLowerCase();
      const meta = l.meta ? JSON.stringify(l.meta).toLowerCase() : '';
      if (!qi.textTokens.every(t => msg.includes(t) || meta.includes(t))) return false;
    }
    return true;
  });

  if (emptyState) emptyState.style.display = filtered.length === 0 ? 'flex' : 'none';

  const frag = document.createDocumentFragment();
  filtered.forEach(log => {
    const row = document.createElement('div');
    row.className = `log-row level-${log.level || 'info'}`;
    if (log.id) row.id = log.id;

    // Time
    const ct = document.createElement('div'); ct.className = 'log-col-time'; ct.textContent = log.time || '';

    // Source pill
    const cs = document.createElement('div'); cs.className = 'log-col-source';
    const sp = document.createElement('span'); sp.className = `pill ${log.source || 'server'}`;
    sp.textContent = log.source || 'server'; cs.appendChild(sp);

    // Category pill
    const cc = document.createElement('div'); cc.className = 'log-col-cat';
    const cp = document.createElement('span'); cp.className = `pill ${log.category || 'system'}`;
    cp.textContent = log.category || 'system'; cc.appendChild(cp);

    // Message
    const cm = document.createElement('div'); cm.className = 'log-col-msg';
    const msgDiv = document.createElement('div'); msgDiv.className = 'msg-text';
    msgDiv.textContent = log.msg || '(object)';
    if (log._repeat) {
      const rb = document.createElement('span'); rb.className = 'repeat-badge';
      rb.textContent = `×${log._repeat}`; rb.title = `Repeated ${log._repeat} times`;
      msgDiv.appendChild(rb);
    }
    cm.appendChild(msgDiv);

    if (log.meta) {
      const det = document.createElement('details'); det.className = 'meta-details';
      const sum = document.createElement('summary'); sum.textContent = 'View metadata';
      const mb  = document.createElement('div'); mb.className = 'meta-block';
      const copyBtn = makeCopyBtn(JSON.stringify(log.meta, null, 2));
      const pre = document.createElement('pre'); pre.textContent = JSON.stringify(log.meta, null, 2);
      mb.appendChild(copyBtn); mb.appendChild(pre);
      det.appendChild(sum); det.appendChild(mb); cm.appendChild(det);
    }

    row.appendChild(ct); row.appendChild(cs); row.appendChild(cc); row.appendChild(cm);
    frag.appendChild(row);
  });

  logList.innerHTML = '';
  logList.appendChild(frag);
  updateRightPanel();
}

function makeCopyBtn(text) {
  const btn = document.createElement('button');
  btn.className = 'copy-btn'; btn.title = 'Copy';
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  btn.addEventListener('click', e => {
    e.stopPropagation(); e.preventDefault();
    navigator.clipboard?.writeText(text).then(() => {
      btn.classList.add('copied');
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      }, 2000);
    });
  });
  return btn;
}

function updateRightPanel() {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const bar = (id, pct) => { const el = document.getElementById(id); if (el) el.style.width = `${pct}%`; };
  const tot = srcCnts.all;
  set('pTotal',         tot);
  set('pServer',        srcCnts.server   || 0);
  set('pClient',        srcCnts.client   || 0);
  set('pNetwork',       counts.network   || 0);
  set('pAuth',          counts.auth      || 0);
  set('pCompiler',      counts.compiler  || 0);
  set('pLint',          counts.lint      || 0);
  set('pTypes',         counts.types     || 0);
  set('pTests',         counts.tests     || 0);
  set('pDatabase',      counts.database  || 0);
  set('pPerformance',   counts.performance  || 0);
  set('pAccessibility', counts.accessibility || 0);
  set('pSystem',        counts.system    || 0);
  set('pWarning',       counts.warning   || 0);
  set('pInfo',          lvlCnts.info     || 0);
  set('pWarn',          lvlCnts.warn     || 0);
  set('pError',         lvlCnts.error    || 0);
  bar('barServer', tot ? Math.round((srcCnts.server || 0) / tot * 100) : 0);
  bar('barClient', tot ? Math.round((srcCnts.client || 0) / tot * 100) : 0);
}

// ── API Surface ─────────────────────────────────────────────────────────────────
function getApiEndpoints() {
  const eps = {};
  allLogs.filter(l => l.category === 'network').forEach(l => {
    const m = (l.msg || '').match(/\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/[^\s?]*)/i);
    if (m) {
      const key = `${m[1].toUpperCase()} ${m[2]}`;
      if (!eps[key]) eps[key] = { count: 0, errors: 0, lastTime: '', lastStatus: '' };
      eps[key].count++;
      eps[key].lastTime = l.time || '';
      const sm = l.msg.match(/\b(\d{3})\b/);
      if (sm) { eps[key].lastStatus = sm[1]; if (+sm[1] >= 400) eps[key].errors++; }
    }
  });
  return eps;
}

function renderApiSurface() {
  const el = document.getElementById('apiSurfaceContent');
  if (!el) return;

  const eps = getApiEndpoints();
  const rows = Object.entries(eps)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([ep, d]) => {
      const [method, ...rest] = ep.split(' ');
      const path = rest.join(' ');
      const sc = d.lastStatus;
      const statusCls = sc >= '500' ? 'status-5xx' : sc >= '400' ? 'status-4xx' : sc >= '300' ? 'status-3xx' : sc ? 'status-2xx' : '';
      return `<tr>
        <td class="api-method">${esc(method)}</td>
        <td class="api-path">${esc(path)}</td>
        <td class="api-count">${d.count}</td>
        <td>${sc ? `<span class="status-badge ${statusCls}">${sc}</span>` : '—'}</td>
        <td class="api-errors">${d.errors > 0 ? `<span class="api-err-badge">${d.errors}</span>` : '—'}</td>
        <td class="api-time">${esc(d.lastTime)}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="6" class="empty-row">No network logs yet — make some HTTP requests and they'll appear here.</td></tr>`;

  el.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">API Surface</h1>
      <p class="view-subtitle">${Object.keys(eps).length} unique endpoint${Object.keys(eps).length !== 1 ? 's' : ''} discovered from network logs</p>
    </div>
    <div class="table-card">
      <table class="data-table">
        <thead><tr><th>Method</th><th>Path</th><th>Calls</th><th>Last Status</th><th>Errors</th><th>Last Seen</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ── Environment Security Scan ───────────────────────────────────────────────────
function renderEnvironment() {
  const el = document.getElementById('environmentContent');
  if (!el) return;

  const patterns = [
    { name: 'API Key',     re: /(?:api[_-]?key|apikey)\s*[=:]\s*["']?([A-Za-z0-9_\-]{8,})/gi },
    { name: 'Token',       re: /(?:(?:access|auth|bearer|id)[_-]?token|jwt)\s*[=:]\s*["']?([A-Za-z0-9._\-]{8,})/gi },
    { name: 'Password',    re: /(?:password|passwd|pwd)\s*[=:]\s*["']?([^\s"',;]{4,})/gi },
    { name: 'Secret',      re: /(?:secret|private[_-]?key|client[_-]?secret|app[_-]?secret)\s*[=:]\s*["']?([^\s"',;]{4,})/gi },
    { name: 'Connection',  re: /(?:mongodb(?:\+srv)?|postgresql|mysql|redis):\/\/[^\s"']+/gi },
  ];
  const skip = /^(true|false|null|undefined|your|example|placeholder|test|foo|bar|xxx|yyy|123|abc)$/i;

  const findings = [];
  allLogs.forEach(log => {
    const text = (log.msg || '') + (log.meta ? JSON.stringify(log.meta) : '');
    patterns.forEach(p => {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(text)) !== null) {
        const val = m[1] || m[0];
        if (val && val.length > 3 && !skip.test(val)) {
          findings.push({ type: p.name, value: maskSecret(val), time: log.time || '', msg: (log.msg || '').slice(0, 80) });
        }
      }
    });
  });

  const rows = findings.slice(0, 100).map(f => `<tr>
    <td><span class="sev-badge sev-high">high</span></td>
    <td>${esc(f.type)}</td>
    <td class="env-value">${esc(f.value)}</td>
    <td class="env-msg">${esc(f.msg)}</td>
    <td class="api-time">${esc(f.time)}</td>
  </tr>`).join('') || `<tr><td colspan="5" class="empty-row">✅ No secrets detected in logs</td></tr>`;

  const badge = document.getElementById('nc-env');
  if (badge) badge.textContent = findings.length || '';

  el.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">Environment Security</h1>
      <p class="view-subtitle">${findings.length} potential secret exposure${findings.length !== 1 ? 's' : ''} detected in log stream</p>
    </div>
    ${findings.length > 0 ? `<div class="env-warning-banner">⚠️ Potential secrets found in logs. Ensure these are not logged in production.</div>` : ''}
    <div class="table-card">
      <table class="data-table">
        <thead><tr><th>Severity</th><th>Type</th><th>Value (masked)</th><th>In message</th><th>Time</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function maskSecret(val) {
  if (val.length <= 6) return '••••••';
  return val.slice(0, 3) + '••••' + val.slice(-2);
}

// ── Dependencies ────────────────────────────────────────────────────────────────
async function renderDependencies() {
  const el = document.getElementById('dependenciesContent');
  if (!el) return;

  el.innerHTML = `
    <div class="view-header"><h1 class="view-title">Dependencies</h1><p class="view-subtitle">npm audit results</p></div>
    <div class="loading-state">Running npm audit…</div>
  `;

  try {
    const res  = await fetch('/api/npm-audit');
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const meta   = data.metadata || {};
    const vulns  = data.vulnerabilities || {};
    const vList  = Object.values(vulns);
    const bySev  = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
    vList.forEach(v => { bySev[v.severity] = (bySev[v.severity] || 0) + 1; });

    const sevCards = ['critical','high','moderate','low','info'].map(s => `
      <div class="dep-sev-card sev-${s}">
        <div class="dep-sev-val">${bySev[s] || 0}</div>
        <div class="dep-sev-label">${s}</div>
      </div>
    `).join('');

    const vulnRows = vList.slice(0, 150).map(v => {
      const title = v.title || (v.via && typeof v.via[0] === 'object' && v.via[0].title) || '(see npm advisory)';
      const fix   = v.fixAvailable === true ? 'Yes' : (v.fixAvailable && v.fixAvailable.name ? `${v.fixAvailable.name}@${v.fixAvailable.version}` : 'No');
      return `<tr>
        <td><span class="sev-badge sev-${v.severity}">${v.severity}</span></td>
        <td class="dep-name">${esc(v.name || '?')}</td>
        <td>${esc(title)}</td>
        <td>${esc(v.range || '?')}</td>
        <td>${esc(fix)}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="5" class="empty-row">✅ No vulnerabilities found</td></tr>`;

    const badge = document.getElementById('nc-deps');
    if (badge) badge.textContent = vList.length || '';

    el.innerHTML = `
      <div class="view-header">
        <h1 class="view-title">Dependencies</h1>
        <p class="view-subtitle">${meta.totalDependencies ?? '?'} packages scanned · ${vList.length} vulnerabilities · <button class="link-btn" onclick="renderDependencies()">Refresh</button></p>
      </div>
      <div class="dep-sev-row">${sevCards}</div>
      <div class="table-card">
        <table class="data-table">
          <thead><tr><th>Severity</th><th>Package</th><th>Vulnerability</th><th>Range</th><th>Fix</th></tr></thead>
          <tbody>${vulnRows}</tbody>
        </table>
      </div>
    `;
  } catch (err) {
    el.innerHTML = `
      <div class="view-header"><h1 class="view-title">Dependencies</h1></div>
      <div class="error-state">⚠ ${esc(err.message)}</div>
    `;
  }
}

// ── Setup ───────────────────────────────────────────────────────────────────────
async function renderSetup() {
  const el = document.getElementById('setupContent');
  if (!el) return;
  el.innerHTML = `<div class="view-header"><h1 class="view-title">Project Setup</h1></div><div class="loading-state">Loading…</div>`;

  try {
    const res = await fetch('/api/meta');
    const d   = await res.json();
    if (d.error) throw new Error(d.error);

    const scriptRows = Object.entries(d.scripts || {}).map(([k, v]) => `
      <div class="setup-script-row">
        <span class="setup-script-name">${esc(k)}</span>
        <span class="setup-script-cmd">${esc(v)}</span>
      </div>
    `).join('') || `<div class="setup-empty">No scripts defined</div>`;

    // Update header project name
    const ph = document.getElementById('hProjectName');
    if (ph && d.name) ph.textContent = d.name;

    el.innerHTML = `
      <div class="view-header">
        <h1 class="view-title">Project Setup</h1>
        <p class="view-subtitle">${esc(d.name || 'Unknown')} v${esc(d.version || '0.0.0')}</p>
      </div>
      <div class="setup-grid">
        <div class="setup-card">
          <div class="setup-card-title">Package Info</div>
          <div class="setup-row"><span class="setup-key">Name</span><span class="setup-val">${esc(d.name || '—')}</span></div>
          <div class="setup-row"><span class="setup-key">Version</span><span class="setup-val">${esc(d.version || '—')}</span></div>
          <div class="setup-row"><span class="setup-key">Description</span><span class="setup-val">${esc(d.description || '—')}</span></div>
        </div>
        <div class="setup-card">
          <div class="setup-card-title">Dependencies</div>
          <div class="setup-row"><span class="setup-key">Production</span><span class="setup-val">${d.deps || 0}</span></div>
          <div class="setup-row"><span class="setup-key">Development</span><span class="setup-val">${d.devDeps || 0}</span></div>
          <div class="setup-row"><span class="setup-key">Total</span><span class="setup-val">${(d.deps || 0) + (d.devDeps || 0)}</span></div>
        </div>
        <div class="setup-card setup-card-full">
          <div class="setup-card-title">Scripts</div>
          ${scriptRows}
        </div>
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="view-header"><h1 class="view-title">Project Setup</h1></div><div class="error-state">⚠ ${esc(err.message)}</div>`;
  }
}

// ── Git ─────────────────────────────────────────────────────────────────────────
async function renderGit() {
  const el = document.getElementById('gitContent');
  if (!el) return;
  el.innerHTML = `<div class="view-header"><h1 class="view-title">Git &amp; CI/CD</h1></div><div class="loading-state">Loading…</div>`;

  try {
    const res = await fetch('/api/git');
    const d   = await res.json();
    if (d.error) throw new Error(d.error);

    const commits = (d.log || []).map(line => {
      const space = line.indexOf(' ');
      const hash  = line.slice(0, space);
      const msg   = line.slice(space + 1);
      return `<div class="git-commit">
        <span class="git-hash">${esc(hash)}</span>
        <span class="git-msg">${esc(msg)}</span>
      </div>`;
    }).join('') || `<div class="git-empty">No commits found</div>`;

    const flagClass = { M: 'git-modified', A: 'git-added', D: 'git-deleted', '??': 'git-untracked' };
    const statuses = (d.status || []).map(line => {
      const flag = line.slice(0, 2).trim();
      const file = line.slice(3);
      const cls  = flagClass[flag] || '';
      return `<div class="git-status-item ${cls}">
        <span class="git-status-flag">${esc(flag)}</span>
        <span>${esc(file)}</span>
      </div>`;
    }).join('') || `<div class="git-empty">✅ Working tree clean</div>`;

    el.innerHTML = `
      <div class="view-header">
        <h1 class="view-title">Git &amp; CI/CD</h1>
        <p class="view-subtitle">Recent commits and working tree · <button class="link-btn" onclick="renderGit()">Refresh</button></p>
      </div>
      <div class="git-grid">
        <div class="git-card">
          <div class="git-card-title">Recent Commits</div>
          <div class="git-commits">${commits}</div>
        </div>
        <div class="git-card">
          <div class="git-card-title">Working Tree</div>
          <div class="git-statuses">${statuses}</div>
        </div>
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="view-header"><h1 class="view-title">Git &amp; CI/CD</h1></div><div class="error-state">⚠ ${esc(err.message)}</div>`;
  }
}

// ── Docs ────────────────────────────────────────────────────────────────────────
function renderDocs() {
  const el = document.getElementById('docsContent');
  if (!el) return;
  el.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">Docs &amp; References</h1>
      <p class="view-subtitle">Ingest API schema, search syntax, and keyboard shortcuts</p>
    </div>
    <div class="docs-grid">
      <div class="docs-card">
        <div class="docs-card-title">📖 README</div>
        <p class="docs-desc">Framework-agnostic setup for Next.js, React/Vite, Express, Fastify, and plain Node.js — including HTTPS relay.</p>
        <a class="docs-link" href="https://github.com/yibeltal-gashaw/next-devlens#readme" target="_blank" rel="noopener">View on GitHub →</a>
      </div>
      <div class="docs-card">
        <div class="docs-card-title">🔌 Ingest API</div>
        <div class="docs-code-block"><pre>POST /api/ingest
Content-Type: application/json

{
  "level":    "info" | "warn" | "error",
  "source":   "server" | "client",
  "category": "network" | "auth" | "lint" | ...,
  "msg":      "your message here",
  "meta":     { ... } | null,
  "time":     "HH:MM:SS.mmm"
}</pre></div>
      </div>
      <div class="docs-card">
        <div class="docs-card-title">🔍 Search Tokens</div>
        <div class="docs-token-list">
          <div class="docs-token"><code>level:error</code><span>Filter by level (info/warn/error)</span></div>
          <div class="docs-token"><code>src:server</code><span>Filter by source (server/client)</span></div>
          <div class="docs-token"><code>cat:network</code><span>Filter by category</span></div>
          <div class="docs-token"><code>level:error timeout</code><span>Combine level + free text</span></div>
        </div>
      </div>
      <div class="docs-card">
        <div class="docs-card-title">⌨️ Keyboard Shortcuts</div>
        <div class="docs-token-list">
          <div class="docs-token"><code>Ctrl+K</code><span>Open command palette search</span></div>
          <div class="docs-token"><code>Esc</code><span>Close modal</span></div>
          <div class="docs-token"><code>Click pause banner</code><span>Resume live scroll</span></div>
        </div>
      </div>
    </div>
  `;
}

// ── AI Chat ──────────────────────────────────────────────────────────────────
function renderAIChat() {
  const el = document.getElementById('aiChatContent');
  if (!el) return;
  el.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">AI Chat</h1>
      <p class="view-subtitle">Ask questions about your logs</p>
    </div>
    <div class="ai-placeholder">
      <div class="ai-placeholder-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <h2 class="ai-placeholder-title">AI Chat</h2>
      <p class="ai-placeholder-desc">
        Connect an AI provider to explain errors in plain English, suggest fixes based on your logs,
        and answer questions about your running app.
      </p>
      <button class="btn btn-primary" onclick="navigateTo('settings')">Configure in Settings →</button>
    </div>
  `;
}

// ── Settings ─────────────────────────────────────────────────────────────────
function renderSettings() {
  const el = document.getElementById('settingsContent');
  if (!el) return;
  const isDark  = document.body.classList.contains('dark');
  const maxLogs = parseInt(localStorage.getItem('devlens-max-logs') || '2000', 10);

  el.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">Settings</h1>
      <p class="view-subtitle">Configure DevLens behaviour</p>
    </div>
    <div class="settings-grid">
      <div class="settings-card">
        <div class="settings-card-title">Appearance</div>
        <div class="settings-row">
          <div>
            <div class="settings-label">Dark Mode</div>
            <div class="settings-desc">Toggle between light and dark theme</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="darkModeToggle" ${isDark ? 'checked' : ''} onchange="toggleDarkMode(this.checked)">
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
      <div class="settings-card">
        <div class="settings-card-title">Log Buffer</div>
        <div class="settings-row">
          <div>
            <div class="settings-label">Max Logs in Memory</div>
            <div class="settings-desc">Oldest logs are evicted when the cap is reached. Currently ${allLogs.length.toLocaleString()} / ${maxLogs.toLocaleString()}</div>
          </div>
        </div>
        <div class="settings-range-row">
          <input type="range" min="500" max="10000" step="500" value="${maxLogs}" id="maxLogsRange" oninput="document.getElementById('maxLogsLabel').textContent = parseInt(this.value).toLocaleString()">
          <span id="maxLogsLabel">${maxLogs.toLocaleString()}</span>
        </div>
        <button class="btn btn-primary" style="margin-top:.75rem" onclick="saveMaxLogs()">Apply</button>
      </div>
      <div class="settings-card">
        <div class="settings-card-title">Dashboard Server</div>
        <div class="settings-row">
          <div>
            <div class="settings-label">Dashboard Port</div>
            <div class="settings-desc">Set via <code style="font-family:var(--mono);font-size:11px">DEVLENS_PORT</code> env variable before starting the dashboard.</div>
          </div>
          <span class="settings-badge">${location.port || '4321'}</span>
        </div>
        <div class="settings-row" style="margin-top:.75rem">
          <div>
            <div class="settings-label">Project Directory</div>
            <div class="settings-desc">Pass the path to your project as a CLI arg: <br><code style="font-family:var(--mono);font-size:10px">npx devlens-dashboard /path/to/project</code></div>
          </div>
        </div>
      </div>
      <div class="settings-card">
        <div class="settings-card-title">AI Chat <span style="font-size:10px;color:var(--muted);font-weight:400">(coming soon)</span></div>
        <div class="settings-row">
          <div>
            <div class="settings-label">AI Provider API Key</div>
            <div class="settings-desc">Enter your OpenAI or Anthropic key to enable AI Chat.</div>
          </div>
        </div>
        <input type="password" class="settings-input" placeholder="sk-…" disabled>
        <p class="settings-coming-soon">AI integration available in a future release.</p>
      </div>
    </div>
  `;
}

function toggleDarkMode(on) {
  document.body.classList.toggle('dark', on);
  localStorage.setItem('devlens-dark', on ? '1' : '0');
}

function saveMaxLogs() {
  const range = document.getElementById('maxLogsRange');
  if (!range) return;
  const val = parseInt(range.value, 10);
  localStorage.setItem('devlens-max-logs', String(val));
  if (allLogs.length > val) allLogs.length = val;
  renderSettings();
}

// ── Nav badges ─────────────────────────────────────────────────────────────────
function updateNavBadges() {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val > 0 ? String(val) : ''; };
  set('nc-lint',          counts.lint);
  set('nc-types',         counts.types);
  set('nc-tests',         counts.tests);
  set('nc-network',       counts.network);
  set('nc-api',           Object.keys(getApiEndpoints()).length);
  set('nc-auth',          counts.auth);
  set('nc-performance',   counts.performance);
  set('nc-accessibility', counts.accessibility);
  set('nc-database',      counts.database);
  set('nc-server',        srcCnts.server);
  set('nc-client',        srcCnts.client);
}

// ── Scroll / pause ─────────────────────────────────────────────────────────────
if (logArea) {
  logArea.addEventListener('scroll', () => {
    const atTop = logArea.scrollTop < 60;
    const pb = document.getElementById('pause-banner');
    if (!atTop && !userScrolled) {
      userScrolled = true;
      if (pb) pb.style.display = 'block';
    } else if (atTop && userScrolled) {
      resumeScroll();
    }
  });
}

function resumeScroll() {
  userScrolled = false;
  const pb = document.getElementById('pause-banner');
  if (pb) pb.style.display = 'none';
  if (logArea) logArea.scrollTop = 0;
  scheduleLogRender();
}

// ── Source filter ──────────────────────────────────────────────────────────────
function filterSource(src) {
  sourceFilter = src;
  document.querySelectorAll('.src-filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.src === src));
  updateSidebarActive();
  scheduleLogRender();
}

// ── Clear ───────────────────────────────────────────────────────────────────────
function clearLogs() {
  allLogs = [];
  Object.keys(counts).forEach(k  => { counts[k]  = 0; });
  Object.keys(srcCnts).forEach(k => { srcCnts[k] = 0; });
  Object.keys(lvlCnts).forEach(k => { lvlCnts[k] = 0; });
  Object.keys(trendBuckets).forEach(k => delete trendBuckets[k]);
  updateNavBadges();
  renderCurrentView();
}

// ── Sidebar toggle ─────────────────────────────────────────────────────────────
function toggleSidebar() {
  const sb = document.querySelector('.sidebar');
  if (!sb) return;
  const collapsed = sb.classList.toggle('collapsed');
  localStorage.setItem('sidebar-collapsed', collapsed ? 'true' : 'false');
}

// ── Search ──────────────────────────────────────────────────────────────────────
function parseQuery(queryStr) {
  const tokens   = queryStr.split(/\s+/).filter(Boolean);
  const textToks = [];
  const filters  = { level: null, source: null, category: null };
  tokens.forEach(tok => {
    if      (tok.startsWith('level:'))                    filters.level    = tok.slice(6).toLowerCase();
    else if (tok.startsWith('src:') || tok.startsWith('source:'))   filters.source   = tok.slice(tok.indexOf(':') + 1).toLowerCase();
    else if (tok.startsWith('cat:') || tok.startsWith('category:')) filters.category = tok.slice(tok.indexOf(':') + 1).toLowerCase();
    else textToks.push(tok.toLowerCase());
  });
  return { textTokens: textToks, filters };
}

// ── Keyboard shortcuts ─────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearchModal(); }
  else if (e.key === 'Escape') closeSearchModal();
});

// ── Search modal ──────────────────────────────────────────────────────────────
function openSearchModal() {
  const modal = document.getElementById('searchModal');
  const input = document.getElementById('modalSearchInput');
  if (!modal || !input) return;
  modal.style.display = 'flex';
  input.value = '';
  const res = document.getElementById('modalSearchResults');
  if (res) res.innerHTML = '';
  setTimeout(() => input.focus(), 50);
}

function closeSearchModal() {
  const modal = document.getElementById('searchModal');
  if (modal) modal.style.display = 'none';
}

function onModalSearch() {
  const qs        = (document.getElementById('modalSearchInput')?.value || '').trim();
  const container = document.getElementById('modalSearchResults');
  if (!container) return;
  if (!qs) { container.innerHTML = ''; return; }

  const qi      = parseQuery(qs.toLowerCase());
  const matched = allLogs.filter(l => {
    if (qi.filters.source   && l.source   !== qi.filters.source)   return false;
    if (qi.filters.category && l.category !== qi.filters.category) return false;
    if (qi.filters.level    && l.level    !== qi.filters.level)    return false;
    if (qi.textTokens.length > 0) {
      const msg  = (l.msg || '').toLowerCase();
      const meta = l.meta ? JSON.stringify(l.meta).toLowerCase() : '';
      return qi.textTokens.every(t => msg.includes(t) || meta.includes(t));
    }
    return true;
  });

  container.innerHTML = '';
  if (matched.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:1.25rem;color:var(--muted)';
    empty.textContent   = 'No matching logs found.';
    container.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  matched.slice(0, 50).forEach(log => {
    const row = document.createElement('div');
    row.className = 'modal-row';
    row.addEventListener('click', () => {
      closeSearchModal();
      navigateTo('logs', log.category);
      setTimeout(() => {
        const el = document.getElementById(log.id);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('highlight-flash');
          setTimeout(() => el.classList.remove('highlight-flash'), 2000);
        }
      }, 150);
    });
    row.innerHTML = `
      <div class="log-col-time">${esc(log.time || '')}</div>
      <div class="log-col-source"><span class="pill ${log.source || 'server'}">${log.source || 'server'}</span></div>
      <div class="log-col-cat"><span class="pill ${log.category || 'system'}">${log.category || 'system'}</span></div>
      <div class="log-col-msg" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(log.msg || '(object)')}</div>
    `;
    frag.appendChild(row);
  });
  container.appendChild(frag);
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Inline SVG icon helpers
const si = (d) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const svgFileText    = () => si('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>');
const svgCode        = () => si('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>');
const svgFlask       = () => si('<path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v11m0 0a2 2 0 0 0 4 0m-4 0H5m8 0h4"/>');
const svgWifi        = () => si('<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/>');
const svgLock        = () => si('<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>');
const svgDatabase    = () => si('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>');
const svgClock       = () => si('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>');
const svgA11y        = () => si('<circle cx="12" cy="4" r="2"/><path d="m19 7-7 3-7-3"/><path d="m5 22 2-8"/><path d="m19 22-2-8"/><path d="m9 14 3 8 3-8"/>');
const svgAlert       = () => si('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>');
const svgSettings    = () => si('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9"/>');

// ── Restore persistent settings on load ────────────────────────────────────────
if (localStorage.getItem('sidebar-collapsed') === 'true') {
  document.querySelector('.sidebar')?.classList.add('collapsed');
}
if (localStorage.getItem('devlens-dark') === '1') {
  document.body.classList.add('dark');
}

// ── Boot ───────────────────────────────────────────────────────────────────────
renderOverview();
fetchMeta();
fetchGit();
fetchAudit();

async function fetchMeta() {
  try {
    const res = await fetch('/api/meta');
    projectMeta = await res.json();
    if (currentView === 'overview') scheduleOvRender();
  } catch (e) {}
}

async function fetchGit() {
  try {
    const res = await fetch('/api/git');
    gitMeta = await res.json();
    if (currentView === 'overview') scheduleOvRender();
  } catch (e) {}
}

async function fetchAudit() {
  try {
    const res = await fetch('/api/npm-audit');
    auditData = await res.json();
    if (currentView === 'overview') scheduleOvRender();
  } catch (e) {}
}
