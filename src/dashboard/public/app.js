// ── State ──────────────────────────────────────────────────────────
let allLogs      = [];
let sourceFilter = 'all';
let catFilter    = 'all';
let searchQuery  = '';
let userScrolled = false;
let pendingRender = false;

const counts  = { all:0, network:0, auth:0, compiler:0, system:0, warning:0 };
const srcCnts = { all:0, server:0, client:0 };
const lvlCnts = { info:0, warn:0, error:0 };

// ── DOM ────────────────────────────────────────────────────────────
const logList   = document.getElementById('logList');
const logArea   = document.getElementById('logArea');
const emptyState = document.getElementById('emptyState');
const pauseBanner = document.getElementById('pause-banner');
const statusDot  = document.getElementById('status-dot');
const statusLabel = document.getElementById('status-label');

// ── SSE ────────────────────────────────────────────────────────────
const stream = new EventSource('/stream');
stream.onopen  = () => { statusDot.className='connected'; statusLabel.textContent='live'; };
stream.onerror = () => { statusDot.className=''; statusLabel.textContent='disconnected'; };
stream.onmessage = (e) => {
  const data = JSON.parse(e.data);
  if (allLogs.length > 0 && allLogs[0].msg === data.msg && allLogs[0].category === data.category && allLogs[0].level === data.level) {
    allLogs[0]._repeat = (allLogs[0]._repeat || 1) + 1;
    allLogs[0].time = data.time;
  } else {
    allLogs.unshift(data);
  }
  counts.all++;
  counts[data.category] = (counts[data.category] || 0) + 1;
  srcCnts.all++;
  srcCnts[data.source] = (srcCnts[data.source] || 0) + 1;
  lvlCnts[data.level]  = (lvlCnts[data.level]  || 0) + 1;
  updateStats();
  if (!userScrolled) scheduleRender();
};

// ── Scroll pause ───────────────────────────────────────────────────
logArea.addEventListener('scroll', () => {
  const atTop = logArea.scrollTop < 60;
  if (!atTop && !userScrolled) { userScrolled = true; pauseBanner.style.display='block'; }
  else if (atTop && userScrolled) resumeScroll();
});
function resumeScroll() {
  userScrolled = false; pauseBanner.style.display='none';
  logArea.scrollTop = 0; scheduleRender();
}

// ── Render ─────────────────────────────────────────────────────────
function scheduleRender() {
  if (pendingRender) return;
  pendingRender = true;
  requestAnimationFrame(() => { renderLogs(); pendingRender = false; });
}

function renderLogs() {
  const filtered = allLogs
    .filter(l => sourceFilter === 'all' || l.source   === sourceFilter)
    .filter(l => catFilter    === 'all' || l.category === catFilter)
    .filter(l => !searchQuery || l.msg?.toLowerCase().includes(searchQuery));

  emptyState.style.display = filtered.length === 0 ? 'flex' : 'none';

  const frag = document.createDocumentFragment();
  filtered.forEach(log => {
    const row = document.createElement('div');
    row.className = 'log-row level-' + (log.level || 'info');

    // time
    const colTime = document.createElement('div');
    colTime.className = 'log-col-time';
    colTime.textContent = log.time;

    // source
    const colSrc = document.createElement('div');
    colSrc.className = 'log-col-source';
    const srcPill = document.createElement('span');
    srcPill.className = 'pill ' + (log.source || 'server');
    srcPill.textContent = log.source || 'server';
    colSrc.appendChild(srcPill);

    // category
    const colCat = document.createElement('div');
    colCat.className = 'log-col-cat';
    const catPill = document.createElement('span');
    catPill.className = 'pill ' + (log.category || 'system');
    catPill.textContent = log.category || 'system';
    colCat.appendChild(catPill);

    // message
    const colMsg = document.createElement('div');
    colMsg.className = 'log-col-msg';
    const msgDiv = document.createElement('div');
    msgDiv.className = 'msg-text';
    msgDiv.textContent = log.msg || '(object)';
    if (log._repeat) {
      const rb = document.createElement('span');
      rb.className = 'repeat-badge';
      rb.textContent = '×' + log._repeat;
      rb.title = 'Repeated ' + log._repeat + ' times';
      msgDiv.appendChild(rb);
    }
    colMsg.appendChild(msgDiv);
    if (log.meta) {
      const det = document.createElement('details');
      det.className = 'meta-details';
      const sum = document.createElement('summary');
      sum.textContent = 'View metadata';
      const mb = document.createElement('div');
      mb.className = 'meta-block';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-btn';
      copyBtn.title = 'Copy metadata';
      copyBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      `;
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const jsonStr = JSON.stringify(log.meta, null, 2);
        navigator.clipboard.writeText(jsonStr).then(() => {
          copyBtn.classList.add('copied');
          copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          `;
          setTimeout(() => {
            copyBtn.classList.remove('copied');
            copyBtn.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            `;
          }, 2000);
        });
      });

      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(log.meta, null, 2);
      
      mb.appendChild(copyBtn);
      mb.appendChild(pre);
      det.appendChild(sum);
      det.appendChild(mb);
      colMsg.appendChild(det);
    }

    row.appendChild(colTime); row.appendChild(colSrc);
    row.appendChild(colCat);  row.appendChild(colMsg);
    frag.appendChild(row);
  });
  logList.innerHTML = '';
  logList.appendChild(frag);
}

// ── Filters ────────────────────────────────────────────────────────
function filterSource(src, btn) {
  sourceFilter = src;
  document.querySelectorAll('.nav-item[onclick*="filterSource"]').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  scheduleRender();
}
function filterCat(cat, btn) {
  catFilter = cat;
  document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  scheduleRender();
}
function onSearch() {
  searchQuery = document.getElementById('searchInput').value.trim().toLowerCase();
  scheduleRender();
}

// ── Stats ──────────────────────────────────────────────────────────
function updateStats() {
  const total = srcCnts.all;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const bar = (id, pct) => { const el = document.getElementById(id); if (el) el.style.width = pct + '%'; };

  set('bs-all',    srcCnts.all);    set('bs-server', srcCnts.server); set('bs-client', srcCnts.client);
  set('b-all',     counts.all);     set('b-network', counts.network); set('b-auth',    counts.auth);
  set('b-compiler',counts.compiler);set('b-system',  counts.system);  set('b-warning', counts.warning);

  set('pTotal',   total);
  set('pServer',  srcCnts.server); set('pClient', srcCnts.client);
  set('pNetwork', counts.network); set('pAuth',   counts.auth);
  set('pCompiler',counts.compiler);set('pSystem', counts.system); set('pWarning', counts.warning);
  set('pInfo',  lvlCnts.info || 0);
  set('pWarn',  lvlCnts.warn || 0);
  set('pError', lvlCnts.error || 0);

  bar('barServer', total ? Math.round(srcCnts.server / total * 100) : 0);
  bar('barClient', total ? Math.round(srcCnts.client / total * 100) : 0);

  // highlight warning count badge in sidebar
  const wb = document.getElementById('b-warning');
  if (wb) wb.style.background = counts.warning > 0 ? '#ea580c' : '';
  if (wb) wb.style.color      = counts.warning > 0 ? '#fff'    : '';
}

// ── Clear ──────────────────────────────────────────────────────────
function clearLogs() {
  allLogs = [];
  Object.keys(counts).forEach(k  => counts[k]  = 0);
  Object.keys(srcCnts).forEach(k => srcCnts[k] = 0);
  Object.keys(lvlCnts).forEach(k => lvlCnts[k] = 0);
  updateStats();
  scheduleRender();
}

// ── Sidebar Toggle ──────────────────────────────────────────────────
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const collapsed = sidebar.classList.toggle('collapsed');
  localStorage.setItem('sidebar-collapsed', collapsed ? 'true' : 'false');
}

// Initialize sidebar state on page load
if (localStorage.getItem('sidebar-collapsed') === 'true') {
  document.querySelector('.sidebar').classList.add('collapsed');
}
