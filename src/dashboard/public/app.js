// ── Constants ─────────────────────────────────────────────────────
const MAX_LOGS = 2000; // ring-buffer cap — prevents unbounded memory growth

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
    data.id = 'log-' + (crypto.randomUUID?.() ?? Math.random().toString(36).substr(2, 9));
    allLogs.unshift(data);
    if (allLogs.length > MAX_LOGS) allLogs.length = MAX_LOGS; // evict oldest entries
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

// ── Advanced Search Helper ─────────────────────────────────────────
function parseSearchQuery(queryStr) {
  const tokens = queryStr.split(/\s+/).filter(Boolean);
  const textTokens = [];
  const filters = {
    level: null,
    source: null,
    category: null
  };
  
  tokens.forEach(token => {
    if (token.startsWith('level:')) {
      filters.level = token.substring(6).toLowerCase();
    } else if (token.startsWith('src:')) {
      filters.source = token.substring(4).toLowerCase();
    } else if (token.startsWith('source:')) {
      filters.source = token.substring(7).toLowerCase();
    } else if (token.startsWith('cat:')) {
      filters.category = token.substring(4).toLowerCase();
    } else if (token.startsWith('category:')) {
      filters.category = token.substring(9).toLowerCase();
    } else {
      textTokens.push(token.toLowerCase());
    }
  });
  
  return { textTokens, filters };
}

function renderLogs() {
  const queryInfo = searchQuery ? parseSearchQuery(searchQuery) : { textTokens: [], filters: {} };

  const filtered = allLogs.filter(l => {
    if (sourceFilter !== 'all' && l.source !== sourceFilter) return false;
    if (queryInfo.filters.source && l.source !== queryInfo.filters.source) return false;

    if (catFilter !== 'all' && l.category !== catFilter) return false;
    if (queryInfo.filters.category && l.category !== queryInfo.filters.category) return false;

    if (queryInfo.filters.level && l.level !== queryInfo.filters.level) return false;

    if (queryInfo.textTokens.length > 0) {
      const msgLower = (l.msg || '').toLowerCase();
      const metaStr = l.meta ? JSON.stringify(l.meta).toLowerCase() : '';
      const allMatched = queryInfo.textTokens.every(token => 
        msgLower.includes(token) || metaStr.includes(token)
      );
      if (!allMatched) return false;
    }
    return true;
  });

  emptyState.style.display = filtered.length === 0 ? 'flex' : 'none';

  const frag = document.createDocumentFragment();
  filtered.forEach(log => {
    const row = document.createElement('div');
    row.className = 'log-row level-' + (log.level || 'info');
    if (log.id) row.id = log.id;

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

// ── Keyboard Shortcuts ──────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    openSearchModal();
  } else if (e.key === 'Escape') {
    closeSearchModal();
  }
});

// ── Modal Search & Control ──────────────────────────────────────────
function openSearchModal() {
  const modal = document.getElementById('searchModal');
  const input = document.getElementById('modalSearchInput');
  modal.style.display = 'flex';
  input.value = '';
  document.getElementById('modalSearchResults').innerHTML = '';
  setTimeout(() => input.focus(), 50);
}

function closeSearchModal() {
  const modal = document.getElementById('searchModal');
  modal.style.display = 'none';
}

function onModalSearch() {
  const queryStr = document.getElementById('modalSearchInput').value.trim().toLowerCase();
  const resultsContainer = document.getElementById('modalSearchResults');
  
  if (!queryStr) {
    resultsContainer.innerHTML = '';
    return;
  }
  
  const queryInfo = parseSearchQuery(queryStr);
  const matched = allLogs.filter(l => {
    if (queryInfo.filters.source && l.source !== queryInfo.filters.source) return false;
    if (queryInfo.filters.category && l.category !== queryInfo.filters.category) return false;
    if (queryInfo.filters.level && l.level !== queryInfo.filters.level) return false;

    if (queryInfo.textTokens.length > 0) {
      const msgLower = (l.msg || '').toLowerCase();
      const metaStr = l.meta ? JSON.stringify(l.meta).toLowerCase() : '';
      return queryInfo.textTokens.every(token => 
        msgLower.includes(token) || metaStr.includes(token)
      );
    }
    return true;
  });

  const frag = document.createDocumentFragment();
  matched.slice(0, 50).forEach(log => {
    const row = document.createElement('div');
    row.className = 'modal-row';
    row.addEventListener('click', () => {
      closeSearchModal();
      
      // Ensure sidebar/header filters don't hide the clicked log
      if (sourceFilter !== 'all' && log.source !== sourceFilter) {
        filterSource('all', document.querySelector('.nav-item'));
      }
      if (catFilter !== 'all' && log.category !== catFilter) {
        filterCat('all', document.querySelector('.cat-tab'));
      }
      
      // Wait for filters rendering, then scroll and flash
      setTimeout(() => {
        const el = document.getElementById(log.id);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('highlight-flash');
          setTimeout(() => el.classList.remove('highlight-flash'), 2000);
        }
      }, 100);
    });

    const timeCol = document.createElement('div');
    timeCol.className = 'log-col-time';
    timeCol.textContent = log.time;

    const srcCol = document.createElement('div');
    srcCol.className = 'log-col-source';
    const srcPill = document.createElement('span');
    srcPill.className = 'pill ' + (log.source || 'server');
    srcPill.textContent = log.source || 'server';
    srcCol.appendChild(srcPill);

    const catCol = document.createElement('div');
    catCol.className = 'log-col-cat';
    const catPill = document.createElement('span');
    catPill.className = 'pill ' + (log.category || 'system');
    catPill.textContent = log.category || 'system';
    catCol.appendChild(catPill);

    const msgCol = document.createElement('div');
    msgCol.className = 'log-col-msg';
    const msgText = document.createElement('div');
    msgText.className = 'msg-text';
    msgText.textContent = log.msg || '(object)';
    msgCol.appendChild(msgText);

    row.appendChild(timeCol);
    row.appendChild(srcCol);
    row.appendChild(catCol);
    row.appendChild(msgCol);
    frag.appendChild(row);
  });
  
  resultsContainer.innerHTML = '';
  if (matched.length === 0) {
    const noResults = document.createElement('div');
    noResults.style.padding = '1.25rem';
    noResults.style.color = 'var(--muted)';
    noResults.textContent = 'No matching logs found.';
    resultsContainer.appendChild(noResults);
  } else {
    resultsContainer.appendChild(frag);
  }
}
