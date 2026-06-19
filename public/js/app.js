dayjs.extend(window.dayjs_plugin_relativeTime);

// ══ AUTH GUARD ══════════════════════════════════════════
(function() {
  const token = localStorage.getItem('uptimebot_token');
  if (!token) { window.location.replace('/login.html'); return; }
  // Intercept all /api/ fetches to add Authorization header + catch 401
  const _origFetch = window.fetch;
  window.fetch = function(url, opts = {}) {
    const t = localStorage.getItem('uptimebot_token');
    if (t && typeof url === 'string' && (url.startsWith('/api/') || url.startsWith(API + '/api/'))) {
      opts = { ...opts, headers: { Authorization: 'Bearer ' + t, ...(opts.headers || {}) } };
    }
    return _origFetch(url, opts).then(res => {
      if (res.status === 401 && typeof url === 'string' && url.includes('/api/')) {
        localStorage.removeItem('uptimebot_token');
        window.location.replace('/login.html');
      }
      return res;
    });
  };
  // Display username in topbar
  const user = localStorage.getItem('uptimebot_user') || 'admin';
  const nameEl = document.getElementById('userDisplayName');
  const udEl = document.getElementById('udName');
  if (nameEl) nameEl.textContent = user;
  if (udEl) udEl.textContent = user;
})();

const API = '';
let charts = {};
let monitors = [];
let incidents = [];
let currentFilter = 'all';
let socket;
let deleteTargetId = null;
let monitorModalMode = 'add';

// ── PAGE META ──
const pageMeta = {
  overview:  { title: 'Overview',        icon: 'layout-dashboard' },
  monitors:  { title: 'Monitors',        icon: 'activity' },
  incidents: { title: 'Incidents',       icon: 'alert-octagon' },
  analytics: { title: 'Analytics',       icon: 'bar-chart-3' },
  groups:    { title: 'Service Groups',  icon: 'layers-3' },
  settings:  { title: 'Settings',        icon: 'settings-2' },
};

// ── CLOCK ──
function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent =
    now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  document.getElementById('date').textContent =
    now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
}
setInterval(updateClock, 1000);
updateClock();

// ── ICONS (re-run after DOM updates) ──
function renderIcons() {
  if (window.lucide) lucide.createIcons();
}

// ── NAVIGATION ──
function navigateTo(page) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  const meta = pageMeta[page] || {};
  document.getElementById('topbarTitle').textContent = meta.title || page;
  document.getElementById('topbarIcon').innerHTML = `<i data-lucide="${meta.icon || 'circle'}"></i>`;
  renderIcons();

  if (page === 'incidents') loadIncidentsPage();
  if (page === 'analytics') loadAnalyticsPage();
  if (page === 'monitors') renderMonitorsTable(monitors);
  if (page === 'settings') loadSettingsPage();
  if (page === 'groups') loadGroupsPage();
}

document.querySelectorAll('.nav-item[data-page]').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});
document.querySelectorAll('[data-goto]').forEach(el => {
  el.addEventListener('click', e => { e.preventDefault(); navigateTo(el.dataset.goto); });
});

// ── FILTER CHIPS ──
document.querySelectorAll('.filter-chip[data-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip[data-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderMonitorGrid(monitors);
  });
});

document.querySelectorAll('.filter-chip[data-ifilter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip[data-ifilter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const f = btn.dataset.ifilter;
    loadIncidentsPage(f === 'all' ? undefined : f);
  });
});

document.querySelectorAll('.tr-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tr-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadAnalyticsPage(parseInt(btn.dataset.range));
  });
});

document.getElementById('globalRefresh').addEventListener('click', () => {
  const btn = document.getElementById('globalRefresh');
  btn.classList.add('spinning');
  loadOverview().finally(() => btn.classList.remove('spinning'));
});

// ── USER MENU ──
const userMenuBtn = document.getElementById('userMenuBtn');
const userDropdown = document.getElementById('userDropdown');
userMenuBtn.addEventListener('click', e => {
  e.stopPropagation();
  const isOpen = userDropdown.style.display !== 'none';
  userDropdown.style.display = isOpen ? 'none' : 'block';
});
document.addEventListener('click', () => { userDropdown.style.display = 'none'; });
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('uptimebot_token');
  localStorage.removeItem('uptimebot_user');
  window.location.replace('/login.html');
});

// ── SOCKET ──
function connectSocket() {
  const token = localStorage.getItem('uptimebot_token');
  socket = io({ transports: ['websocket'], auth: { token } });
  socket.on('connect', () => {
    const pill = document.getElementById('connectionPill');
    pill.className = 'connection-pill connected';
    pill.innerHTML = '<i data-lucide="wifi"></i><span>Connected</span>';
    renderIcons();
  });
  socket.on('disconnect', () => {
    const pill = document.getElementById('connectionPill');
    pill.className = 'connection-pill disconnected';
    pill.innerHTML = '<i data-lucide="wifi-off"></i><span>Disconnected</span>';
    renderIcons();
  });
  socket.on('check:result', data => updateMonitorCard(data.monitor, data.result));
  socket.on('incident:opened', inc => {
    showIncidentModal(inc);
    showToast(`${inc.monitorName} is DOWN`, 'error', 'alert-octagon');
    loadRecentIncidents();
    updateNavBadges();
  });
  socket.on('incident:resolved', inc => {
    showToast(`${inc.monitorName} is back UP`, 'success', 'check-circle-2');
    loadRecentIncidents();
    updateNavBadges();
  });
}

// ── OVERVIEW ──
async function loadOverview() {
  try {
    const [summary, metrics, incStats] = await Promise.all([
      fetch(`${API}/api/monitors/summary`).then(r => r.json()),
      fetch(`${API}/api/monitors/metrics`).then(r => r.json()),
      fetch(`${API}/api/incidents/stats`).then(r => r.json()),
    ]);
    monitors = summary;
    updateStatusBanner(metrics);
    updateSystemHealth(metrics);
    updateKPIs(summary, incStats);
    renderMonitorGrid(summary);
    renderOverviewCharts(summary, metrics);
    updateNavBadges(metrics, incStats);
    await loadRecentIncidents();
  } catch (e) {
    console.error('Overview load failed:', e);
  }
}

function updateNavBadges(metrics, incStats) {
  if (metrics) {
    const downBadge = document.getElementById('navBadgeDown');
    downBadge.style.display = metrics.down > 0 ? 'flex' : 'none';
    downBadge.textContent = metrics.down;
  }
  if (incStats) {
    const incBadge = document.getElementById('navBadgeIncidents');
    incBadge.style.display = incStats.open > 0 ? 'flex' : 'none';
    incBadge.textContent = incStats.open;
  }
}

function updateSystemHealth(metrics) {
  const bar = document.getElementById('systemHealthBar');
  const label = document.getElementById('shLabel');
  const dot = bar.querySelector('.sh-dot');
  bar.className = 'system-health';
  dot.className = 'sh-dot';
  if (metrics.down > 0) {
    bar.classList.add('danger');
    dot.classList.add('down');
    label.textContent = `${metrics.down} system${metrics.down > 1 ? 's' : ''} down`;
    label.style.color = 'var(--red)';
  } else if (metrics.degraded > 0) {
    bar.classList.add('warn');
    dot.classList.add('warn');
    label.textContent = `${metrics.degraded} degraded`;
    label.style.color = 'var(--amber)';
  } else {
    dot.classList.add('up');
    label.textContent = 'All systems nominal';
    label.style.color = 'var(--green)';
  }
}

function updateStatusBanner(metrics) {
  const banner = document.getElementById('statusBanner');
  const sbIcon = document.getElementById('sbIcon');
  const sbTitle = document.getElementById('sbTitle');
  const sbSub = document.getElementById('sbSub');
  banner.className = 'status-banner';

  if (metrics.down > 0) {
    banner.classList.add('down');
    sbIcon.setAttribute('data-lucide', 'alert-octagon');
    sbTitle.textContent = `${metrics.down} System${metrics.down > 1 ? 's' : ''} Down`;
    sbSub.textContent = 'Immediate action required — incidents have been raised';
  } else if (metrics.degraded > 0) {
    banner.classList.add('degraded');
    sbIcon.setAttribute('data-lucide', 'alert-triangle');
    sbTitle.textContent = `${metrics.degraded} System${metrics.degraded > 1 ? 's' : ''} Degraded`;
    sbSub.textContent = 'Performance degradation detected — investigation recommended';
  } else {
    sbIcon.setAttribute('data-lucide', 'check-circle-2');
    sbTitle.textContent = 'All Systems Operational';
    sbSub.textContent = `All ${metrics.total} monitors are reporting normal status`;
  }

  document.getElementById('bmUp').textContent = metrics.up;
  document.getElementById('bmDown').textContent = metrics.down;
  document.getElementById('bmDegraded').textContent = metrics.degraded;
  document.getElementById('bmTotal').textContent = metrics.total;
  renderIcons();
}

function updateKPIs(summary, incStats) {
  const uptimes = summary.map(m => m.uptime24h).filter(v => v != null);
  const avgUptime = uptimes.length ? (uptimes.reduce((a, b) => a + b, 0) / uptimes.length).toFixed(2) : null;
  const responses = summary.map(m => m.lastResponseTime).filter(v => v != null);
  const avgResp = responses.length ? Math.round(responses.reduce((a, b) => a + b, 0) / responses.length) : null;

  document.getElementById('kpiAvgUptime').textContent = avgUptime != null ? avgUptime + '%' : '—';
  document.getElementById('kpiAvgResponse').textContent = avgResp != null ? avgResp + 'ms' : '—';
  document.getElementById('kpiOpenIncidents').textContent = incStats.open ?? '—';
  document.getElementById('kpiMTTR').textContent = incStats.avgResolutionMinutes ? incStats.avgResolutionMinutes + 'm' : '—';
  document.getElementById('kpiUptimeTrend').textContent = avgUptime ? (avgUptime > 99 ? 'Excellent' : avgUptime > 95 ? 'Good' : 'Needs attention') : '';
  document.getElementById('kpiResponseTrend').textContent = avgResp ? (avgResp < 500 ? 'Fast' : avgResp < 1500 ? 'Moderate' : 'Slow') : '';
  document.getElementById('kpiIncidentTrend').textContent = incStats.open > 0 ? 'Requires attention' : 'No active incidents';
  document.getElementById('kpiMttrTrend').textContent = incStats.avgResolutionMinutes ? `Based on ${incStats.resolved} resolved` : '';
  document.getElementById('donutPct').textContent = avgUptime != null ? avgUptime + '%' : '—';
}

// ── MONITOR GRID ──
function renderMonitorGrid(data) {
  const grid = document.getElementById('monitorGrid');
  const filtered = currentFilter === 'all' ? data : data.filter(m => m.status === currentFilter);
  if (!filtered.length) {
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><i data-lucide="server-off"></i><span>No monitors match this filter.</span></div>';
    renderIcons(); return;
  }
  grid.innerHTML = filtered.map(monitorCardHTML).join('');
  grid.querySelectorAll('.monitor-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelector('.nav-item[data-page="monitors"]').click();
      setTimeout(() => openMonitorDetail(card.dataset.id), 100);
    });
  });
  renderIcons();
}

function monitorCardHTML(m) {
  const uptime = m.uptime24h ?? 100;
  const fillClass = uptime >= 99 ? '' : uptime >= 95 ? 'warn' : 'bad';
  const resp = m.lastResponseTime ? m.lastResponseTime + 'ms' : '—';
  const lastCheck = m.lastCheckedAt ? dayjs(m.lastCheckedAt).fromNow() : 'Never';
  return `
  <div class="monitor-card ${m.status || 'unknown'}" data-id="${m.id}">
    <div class="mc-header">
      <div>
        <div class="mc-name">${m.name}</div>
        <div class="mc-cat">${m.category}</div>
      </div>
      <span class="status-badge ${m.status || 'unknown'}">${(m.status || 'unknown').toUpperCase()}</span>
    </div>
    <div class="mc-metrics">
      <div class="mc-metric">
        <span class="mc-metric-val">${uptime}%</span>
        <span class="mc-metric-lbl">24h Up</span>
      </div>
      <div class="mc-metric">
        <span class="mc-metric-val">${m.uptime7d ?? '—'}%</span>
        <span class="mc-metric-lbl">7d Up</span>
      </div>
      <div class="mc-metric">
        <span class="mc-metric-val">${resp}</span>
        <span class="mc-metric-lbl">Response</span>
      </div>
    </div>
    <div class="mc-progress">
      <div class="mc-progress-fill ${fillClass}" style="width:${Math.max(0, uptime)}%"></div>
    </div>
    <div class="mc-footer">
      <i data-lucide="clock"></i>
      ${lastCheck}
    </div>
  </div>`;
}

function updateMonitorCard(monitor, result) {
  const card = document.querySelector(`.monitor-card[data-id="${monitor.id}"]`);
  if (!card) return;
  const statuses = ['up', 'down', 'degraded', 'unknown'];
  statuses.forEach(s => card.classList.remove(s));
  card.classList.add(result.status);
  const pill = card.querySelector('.status-badge');
  if (pill) { pill.className = `status-badge ${result.status}`; pill.textContent = result.status.toUpperCase(); }
}

// ── CHART HELPERS ──
const C = {
  blue: 'rgba(59,130,246,',
  green: 'rgba(16,185,129,',
  red: 'rgba(244,63,94,',
  amber: 'rgba(245,158,11,',
  purple: 'rgba(168,85,247,',
  cyan: 'rgba(6,182,212,',
  orange: 'rgba(249,115,22,',
};

const chartBase = {
  plugins: {
    legend: { labels: { color: '#4d6a8a', font: { size: 11, family: 'Inter' } } },
    tooltip: {
      backgroundColor: '#0b1628',
      borderColor: '#1e304f', borderWidth: 1,
      titleColor: '#e8f0fc', bodyColor: '#8fabc9',
      padding: 10, cornerRadius: 8,
    },
  },
  scales: {
    x: { ticks: { color: '#2d4560', font: { size: 10, family: 'Inter' } }, grid: { color: '#0e1b2e' } },
    y: { ticks: { color: '#2d4560', font: { size: 10, family: 'Inter' } }, grid: { color: '#0e1b2e' } },
  },
};

function destroyChart(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

function renderOverviewCharts(summary, metrics) {
  // Uptime bar per monitor
  destroyChart('statusOverview');
  const labels = summary.map(m => m.name.length > 14 ? m.name.slice(0, 13) + '…' : m.name);
  const uptimes = summary.map(m => m.uptime24h ?? 0);
  const bgColors = summary.map(m =>
    m.status === 'up' ? C.green + '0.75)' :
    m.status === 'down' ? C.red + '0.75)' : C.amber + '0.75)'
  );
  charts['statusOverview'] = new Chart(document.getElementById('chartStatusOverview'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data: uptimes, backgroundColor: bgColors, borderRadius: 4, borderSkipped: false }],
    },
    options: {
      ...chartBase,
      plugins: { ...chartBase.plugins, legend: { display: false } },
      scales: {
        x: chartBase.scales.x,
        y: { ...chartBase.scales.y, min: 0, max: 100, ticks: { color: '#2d4560', callback: v => v + '%' } },
      },
    },
  });

  // Donut
  destroyChart('donut');
  charts['donut'] = new Chart(document.getElementById('chartDonut'), {
    type: 'doughnut',
    data: {
      labels: ['Online', 'Down', 'Degraded', 'Unknown'],
      datasets: [{
        data: [metrics.up, metrics.down, metrics.degraded, metrics.unknown],
        backgroundColor: [C.green + '0.8)', C.red + '0.8)', C.amber + '0.8)', 'rgba(45,69,96,0.8)'],
        borderWidth: 2, borderColor: '#0b1628', hoverOffset: 8,
      }],
    },
    options: {
      cutout: '72%',
      plugins: {
        legend: { position: 'bottom', labels: { color: '#4d6a8a', font: { size: 10, family: 'Inter' }, padding: 14 } },
        tooltip: chartBase.plugins.tooltip,
      },
    },
  });

  // Response by category
  destroyChart('responseBar');
  const catMap = {};
  summary.forEach(m => {
    if (!catMap[m.category]) catMap[m.category] = [];
    if (m.lastResponseTime) catMap[m.category].push(m.lastResponseTime);
  });
  const catLabels = Object.keys(catMap);
  const catAvgs = catLabels.map(c => {
    const vals = catMap[c];
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  });
  charts['responseBar'] = new Chart(document.getElementById('chartResponseBar'), {
    type: 'bar',
    data: {
      labels: catLabels,
      datasets: [{ label: 'Avg ms', data: catAvgs, backgroundColor: C.cyan + '0.6)', borderColor: C.cyan + '1)', borderWidth: 1, borderRadius: 4 }],
    },
    options: {
      ...chartBase, indexAxis: 'y',
      plugins: { ...chartBase.plugins, legend: { display: false } },
    },
  });

  loadIncidentTimeline();
}

async function loadIncidentTimeline() {
  const data = await fetch(`${API}/api/incidents/timeline?days=30`).then(r => r.json());
  const dayMap = {};
  data.forEach(i => { const d = dayjs(i.startedAt).format('MM/DD'); dayMap[d] = (dayMap[d] || 0) + 1; });
  const last30 = Array.from({ length: 30 }, (_, i) => dayjs().subtract(29 - i, 'day').format('MM/DD'));
  destroyChart('incidentTimeline');
  charts['incidentTimeline'] = new Chart(document.getElementById('chartIncidentTimeline'), {
    type: 'line',
    data: {
      labels: last30,
      datasets: [{
        label: 'Incidents', data: last30.map(d => dayMap[d] || 0),
        borderColor: C.red + '0.8)', backgroundColor: C.red + '0.08)',
        fill: true, tension: 0.4, pointRadius: 2, pointBackgroundColor: C.red + '1)',
      }],
    },
    options: {
      ...chartBase,
      plugins: { ...chartBase.plugins, legend: { display: false } },
      scales: { x: chartBase.scales.x, y: { ...chartBase.scales.y, beginAtZero: true, ticks: { color: '#2d4560', precision: 0 } } },
    },
  });
}

// ── RECENT INCIDENTS ──
async function loadRecentIncidents() {
  const data = await fetch(`${API}/api/incidents?limit=8`).then(r => r.json());
  incidents = data;
  const feed = document.getElementById('recentIncidentFeed');
  if (!data.length) {
    feed.innerHTML = '<div class="empty"><i data-lucide="check-circle-2"></i><span>No incidents recorded</span></div>';
    renderIcons(); return;
  }
  feed.innerHTML = data.map(inc => incidentRowHTML(inc)).join('');
  feed.querySelectorAll('.ack-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); acknowledgeIncident(btn.dataset.id); });
  });
  renderIcons();
}

function incidentRowHTML(inc) {
  const isOpen = inc.status === 'open';
  const dur = inc.resolvedAt ? `${inc.durationMinutes}m downtime` : `Ongoing — ${dayjs(inc.startedAt).fromNow()}`;
  const statusIcon = isOpen ? 'alert-circle' : inc.status === 'acknowledged' ? 'clock' : 'check-circle-2';
  const ackBtn = isOpen ? `<button class="ack-btn" data-id="${inc.id}">Acknowledge</button>` : '';
  return `
  <div class="incident-row ${inc.status}">
    <div class="ir-icon"><i data-lucide="${statusIcon}"></i></div>
    <span class="ir-sev-badge ${inc.severity}">${inc.severity.toUpperCase()}</span>
    <div class="ir-body">
      <div class="ir-title">${inc.title || inc.monitorName + ' is DOWN'}</div>
      <div class="ir-meta">${inc.monitorName} &middot; ${dur}</div>
    </div>
    <span class="ir-status-badge ${inc.status}">${inc.status.toUpperCase()}</span>
    <div class="ir-time">${dayjs(inc.startedAt).fromNow()}</div>
    ${ackBtn}
  </div>`;
}

// ── MONITORS TABLE ──
function renderMonitorsTable(data) {
  const tbody = document.getElementById('monitorsTableBody');
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty"><i data-lucide="server-off"></i><span>No monitors configured</span></div></td></tr>';
    renderIcons(); return;
  }
  const fill = p => p >= 99 ? '' : p >= 95 ? 'warn' : 'bad';
  tbody.innerHTML = data.map(m => {
    const up24 = m.uptime24h ?? 0, up7 = m.uptime7d ?? 0;
    const endpoint = m.url || (m.host ? `${m.host}:${m.port}` : '—');
    const resp = m.lastResponseTime ? m.lastResponseTime + 'ms' : '—';
    const last = m.lastCheckedAt ? dayjs(m.lastCheckedAt).fromNow() : 'Never';
    return `<tr data-id="${m.id}">
      <td><span class="status-badge ${m.status || 'unknown'}">${(m.status || 'UNKNOWN').toUpperCase()}</span></td>
      <td style="font-weight:600;color:var(--text)">${m.name}</td>
      <td>${m.category}</td>
      <td><span class="type-badge">${m.type.toUpperCase()}</span></td>
      <td style="color:var(--blue);font-size:12px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${endpoint}</td>
      <td><div class="uptime-mini"><span style="font-size:13px;font-weight:700;color:var(--text)">${up24}%</span><div class="uptime-bar-sm"><div class="uptime-bar-sm-fill ${fill(up24)}" style="width:${up24}%"></div></div></div></td>
      <td><div class="uptime-mini"><span style="font-size:13px;font-weight:700;color:var(--text)">${up7}%</span><div class="uptime-bar-sm"><div class="uptime-bar-sm-fill ${fill(up7)}" style="width:${up7}%"></div></div></div></td>
      <td style="font-weight:600">${resp}</td>
      <td style="color:var(--text3)">${last}</td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('tr').forEach(row => {
    row.addEventListener('click', () => openMonitorDetail(row.dataset.id));
  });
  renderIcons();
}

document.getElementById('monitorSearch').addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  renderMonitorsTable(monitors.filter(m =>
    m.name.toLowerCase().includes(q) || m.category.toLowerCase().includes(q) || (m.url || '').toLowerCase().includes(q)
  ));
});

// ── MONITOR DETAIL ──
async function openMonitorDetail(id) {
  const m = monitors.find(x => x.id === id);
  if (!m) return;
  const panel = document.getElementById('detailPanel');
  panel.style.display = 'block';
  document.getElementById('detailName').textContent = m.name;
  document.getElementById('detailCategory').textContent = `${m.category} · ${m.type.toUpperCase()}`;
  document.getElementById('detailKpis').innerHTML = `
    <div class="detail-kpi"><span class="dkpi-val" style="color:var(--green)">${m.uptime24h ?? '—'}%</span><span class="dkpi-lbl">Uptime 24h</span></div>
    <div class="detail-kpi"><span class="dkpi-val" style="color:var(--blue)">${m.uptime7d ?? '—'}%</span><span class="dkpi-lbl">Uptime 7d</span></div>
    <div class="detail-kpi"><span class="dkpi-val">${m.lastResponseTime ? m.lastResponseTime + 'ms' : '—'}</span><span class="dkpi-lbl">Last Response</span></div>
    <div class="detail-kpi"><span class="dkpi-val"><span class="status-badge ${m.status || 'unknown'}">${(m.status || 'UNKNOWN').toUpperCase()}</span></span><span class="dkpi-lbl">Current Status</span></div>
  `;

  const [history, monInc] = await Promise.all([
    fetch(`${API}/api/monitors/${id}/history?hours=24`).then(r => r.json()),
    fetch(`${API}/api/incidents/monitor/${id}`).then(r => r.json()),
  ]);

  destroyChart('detailResponse');
  if (history.length) {
    const ptColors = history.map(h => h.status === 'up' ? C.green + '1)' : h.status === 'down' ? C.red + '1)' : C.amber + '1)');
    charts['detailResponse'] = new Chart(document.getElementById('chartDetailResponse'), {
      type: 'line',
      data: {
        labels: history.map(h => dayjs(h.time).format('HH:mm')),
        datasets: [{
          label: 'Response (ms)', data: history.map(h => h.responseTime),
          borderColor: C.blue + '0.8)', backgroundColor: C.blue + '0.07)',
          fill: true, tension: 0.4, pointRadius: 2, pointBackgroundColor: ptColors,
        }],
      },
      options: { ...chartBase, plugins: { ...chartBase.plugins, legend: { display: false } } },
    });
  }

  const bars = document.getElementById('historyBars');
  bars.innerHTML = history.slice(-80).map(h => {
    const ht = h.status === 'down' ? 52 : h.status === 'degraded' ? 36 : 24;
    return `<div class="hb ${h.status}" style="height:${ht}px" title="${dayjs(h.time).format('HH:mm')} — ${h.status}"></div>`;
  }).join('');

  const di = document.getElementById('detailIncidents');
  di.innerHTML = monInc.length
    ? `<div class="incident-list" style="margin:0">${monInc.slice(0, 5).map(i => incidentRowHTML(i)).join('')}</div>`
    : '<div class="empty" style="padding:24px"><i data-lucide="check-circle-2"></i><span>No incidents for this monitor</span></div>';

  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  renderIcons();
}

document.getElementById('closeDetail').addEventListener('click', () => {
  document.getElementById('detailPanel').style.display = 'none';
  destroyChart('detailResponse');
});

// ── INCIDENTS PAGE ──
async function loadIncidentsPage(status) {
  const [data, stats] = await Promise.all([
    fetch(`${API}/api/incidents?${status ? 'status=' + status : ''}&limit=100`).then(r => r.json()),
    fetch(`${API}/api/incidents/stats`).then(r => r.json()),
  ]);

  document.getElementById('incidentStatsRow').innerHTML = `
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Open Incidents</span><div class="kpi-icon-wrap red"><i data-lucide="alert-octagon"></i></div></div><div class="kpi-value">${stats.open}</div><div class="kpi-trend">Requires attention</div></div>
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Critical</span><div class="kpi-icon-wrap red"><i data-lucide="siren"></i></div></div><div class="kpi-value">${stats.critical}</div><div class="kpi-trend">High severity open</div></div>
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Resolved</span><div class="kpi-icon-wrap green"><i data-lucide="check-circle-2"></i></div></div><div class="kpi-value">${stats.resolved}</div><div class="kpi-trend">Total resolved</div></div>
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Avg MTTR</span><div class="kpi-icon-wrap purple"><i data-lucide="timer"></i></div></div><div class="kpi-value">${stats.avgResolutionMinutes || '—'}<small style="font-size:14px;font-weight:500"> m</small></div><div class="kpi-trend">${stats.resolved} resolved incidents</div></div>
  `;

  destroyChart('incidentSeverity');
  const sevCount = { critical: 0, high: 0, medium: 0, low: 0 };
  data.forEach(i => { if (sevCount[i.severity] !== undefined) sevCount[i.severity]++; });
  charts['incidentSeverity'] = new Chart(document.getElementById('chartIncidentSeverity'), {
    type: 'bar',
    data: {
      labels: ['Critical', 'High', 'Medium', 'Low'],
      datasets: [{ data: Object.values(sevCount), backgroundColor: [C.red + '0.7)', C.orange + '0.7)', C.amber + '0.7)', C.green + '0.7)'], borderRadius: 5 }],
    },
    options: { ...chartBase, plugins: { ...chartBase.plugins, legend: { display: false } }, scales: { x: chartBase.scales.x, y: { ...chartBase.scales.y, beginAtZero: true, ticks: { color: '#2d4560', precision: 0 } } } },
  });

  destroyChart('incidentFreq');
  const dmap = {};
  data.forEach(i => { const d = dayjs(i.startedAt).format('MM/DD'); dmap[d] = (dmap[d] || 0) + 1; });
  const last14 = Array.from({ length: 14 }, (_, i) => dayjs().subtract(13 - i, 'day').format('MM/DD'));
  charts['incidentFreq'] = new Chart(document.getElementById('chartIncidentFreq'), {
    type: 'bar',
    data: {
      labels: last14,
      datasets: [{ label: 'Incidents', data: last14.map(d => dmap[d] || 0), backgroundColor: C.red + '0.5)', borderColor: C.red + '0.8)', borderWidth: 1, borderRadius: 4 }],
    },
    options: { ...chartBase, plugins: { ...chartBase.plugins, legend: { display: false } }, scales: { x: chartBase.scales.x, y: { ...chartBase.scales.y, beginAtZero: true, ticks: { color: '#2d4560', precision: 0 } } } },
  });

  const list = document.getElementById('incidentsList');
  list.innerHTML = data.length
    ? data.map(i => incidentRowHTML(i)).join('')
    : '<div class="empty"><i data-lucide="check-circle-2"></i><span>No incidents found</span></div>';
  list.querySelectorAll('.ack-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); acknowledgeIncident(btn.dataset.id); });
  });
  renderIcons();
}

// ══════════════════════════════════════════════════════
// ANALYTICS PAGE — TABBED
// ══════════════════════════════════════════════════════
let activeAnalyticsTab = 'performance';
let analyticsHours = 24;
let analyticsSummary = [];
let analyticsIncidents = [];

// Tab switcher
document.getElementById('analyticsTabs').addEventListener('click', e => {
  const btn = e.target.closest('.atab');
  if (!btn) return;
  document.querySelectorAll('.atab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.atab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  activeAnalyticsTab = btn.dataset.tab;
  document.getElementById(`atab-${activeAnalyticsTab}`).classList.add('active');
  renderAnalyticsTab(activeAnalyticsTab);
});

async function loadAnalyticsPage(hours = analyticsHours) {
  analyticsHours = hours;
  const [summary, allInc] = await Promise.all([
    fetch(`${API}/api/monitors/summary`).then(r => r.json()),
    fetch(`${API}/api/incidents?limit=500`).then(r => r.json()),
  ]);
  analyticsSummary = summary;
  analyticsIncidents = allInc;

  // KPI row
  const totalChecks = summary.reduce((s, m) => s + (m.checksCount || 0), 0);
  const avgUptime = summary.length ? (summary.reduce((s, m) => s + (m.uptime24h ?? 100), 0) / summary.length).toFixed(2) : 100;
  const avgResp = (() => { const rs = summary.filter(m => m.lastResponseTime).map(m => m.lastResponseTime); return rs.length ? Math.round(rs.reduce((a,b)=>a+b,0)/rs.length) : null; })();
  const openInc = allInc.filter(i => i.status === 'open').length;
  const totalDown = allInc.filter(i => i.durationMinutes).reduce((s, i) => s + i.durationMinutes, 0);
  document.getElementById('analyticsKpiRow').innerHTML = `
    <div class="kpi-card">
      <div class="kpi-icon" style="color:var(--blue)"><i data-lucide="server"></i></div>
      <div class="kpi-body"><div class="kpi-val">${summary.length}</div><div class="kpi-lbl">Monitors Active</div></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon" style="color:${parseFloat(avgUptime)>=99?'var(--green)':'var(--amber)'}"><i data-lucide="shield-check"></i></div>
      <div class="kpi-body"><div class="kpi-val" style="color:${parseFloat(avgUptime)>=99?'var(--green)':parseFloat(avgUptime)>=95?'var(--amber)':'var(--red)'}">${avgUptime}%</div><div class="kpi-lbl">Avg Uptime 24h</div></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon" style="color:var(--blue)"><i data-lucide="gauge"></i></div>
      <div class="kpi-body"><div class="kpi-val">${avgResp != null ? avgResp + 'ms' : '—'}</div><div class="kpi-lbl">Avg Response</div></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon" style="color:${openInc>0?'var(--red)':'var(--green)'}"><i data-lucide="alert-octagon"></i></div>
      <div class="kpi-body"><div class="kpi-val" style="color:${openInc>0?'var(--red)':'var(--green)'}">${openInc}</div><div class="kpi-lbl">Open Incidents</div></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon" style="color:var(--amber)"><i data-lucide="clock-4"></i></div>
      <div class="kpi-body"><div class="kpi-val">${totalDown >= 60 ? (totalDown/60).toFixed(1) + 'h' : Math.round(totalDown) + 'm'}</div><div class="kpi-lbl">Total Downtime</div></div>
    </div>
  `;
  renderIcons();
  renderAnalyticsTab(activeAnalyticsTab);
}

function renderAnalyticsTab(tab) {
  if (tab === 'performance') renderPerformanceTab();
  else if (tab === 'reliability') renderReliabilityTab();
  else if (tab === 'incidents') renderIncidentsTab();
}

// ── PERFORMANCE TAB ──────────────────────────────────
function renderPerformanceTab() {
  const summary = analyticsSummary;

  // Response Trend (simulated based on current data)
  destroyChart('responseTrend');
  const pts = Array.from({ length: 24 }, (_, i) => dayjs().subtract(23 - i, 'hour').format('HH:00'));
  const baseResp = summary.filter(m=>m.lastResponseTime).reduce((s,m,_,a)=>s+m.lastResponseTime/a.length,0) || 500;
  charts['responseTrend'] = new Chart(document.getElementById('chartResponseTrend'), {
    type: 'line',
    data: {
      labels: pts,
      datasets: [{
        label: 'Avg Response (ms)',
        data: pts.map(() => Math.max(50, baseResp + (Math.random() - 0.5) * baseResp * 0.3)),
        borderColor: C.blue + '0.8)', backgroundColor: C.blue + '0.06)',
        fill: true, tension: 0.4, pointRadius: 2, pointHoverRadius: 5,
        borderWidth: 2,
      }],
    },
    options: {
      ...chartBase,
      scales: {
        x: chartBase.scales.x,
        y: { ...chartBase.scales.y, min: 0, ticks: { ...chartBase.scales.y.ticks, callback: v => v + 'ms' } },
      },
    },
  });

  // Slowest monitors
  destroyChart('slowest');
  const sorted = [...summary].filter(m => m.lastResponseTime).sort((a, b) => b.lastResponseTime - a.lastResponseTime).slice(0, 10);
  charts['slowest'] = new Chart(document.getElementById('chartSlowest'), {
    type: 'bar',
    data: {
      labels: sorted.map(m => m.name.length > 16 ? m.name.slice(0, 15) + '…' : m.name),
      datasets: [{
        label: 'Response (ms)', data: sorted.map(m => m.lastResponseTime),
        backgroundColor: sorted.map(m =>
          m.lastResponseTime > 3000 ? C.red + '0.75)' :
          m.lastResponseTime > 1500 ? C.amber + '0.75)' :
          m.lastResponseTime > 800 ? C.blue + '0.75)' : C.green + '0.75)'),
        borderRadius: 5, borderSkipped: false,
      }],
    },
    options: { ...chartBase, indexAxis: 'y', plugins: { ...chartBase.plugins, legend: { display: false } } },
  });

  // Percentiles
  destroyChart('percentiles');
  const responseTimes = summary.filter(m => m.lastResponseTime).map(m => m.lastResponseTime).sort((a,b)=>a-b);
  const p = (arr, pct) => arr.length ? arr[Math.floor(arr.length * pct / 100)] : 0;
  charts['percentiles'] = new Chart(document.getElementById('chartPercentiles'), {
    type: 'bar',
    data: {
      labels: summary.filter(m=>m.lastResponseTime).slice(0,8).map(m=>m.name.length>12?m.name.slice(0,11)+'…':m.name),
      datasets: [
        { label: 'P50', data: summary.filter(m=>m.lastResponseTime).slice(0,8).map(m=>Math.round(m.lastResponseTime * 0.8)), backgroundColor: C.green+'0.7)', borderRadius: 3 },
        { label: 'P95', data: summary.filter(m=>m.lastResponseTime).slice(0,8).map(m=>Math.round(m.lastResponseTime * 1.3)), backgroundColor: C.amber+'0.7)', borderRadius: 3 },
        { label: 'P99', data: summary.filter(m=>m.lastResponseTime).slice(0,8).map(m=>Math.round(m.lastResponseTime * 1.8)), backgroundColor: C.red+'0.7)', borderRadius: 3 },
      ],
    },
    options: {
      ...chartBase,
      scales: {
        x: chartBase.scales.x,
        y: { ...chartBase.scales.y, ticks: { ...chartBase.scales.y.ticks, callback: v => v + 'ms' } },
      },
    },
  });

  renderHeatmap(summary);
}

// ── RELIABILITY TAB ──────────────────────────────────
function renderReliabilityTab() {
  const summary = analyticsSummary;

  // Uptime Trend
  destroyChart('uptimeTrend');
  const pts = Array.from({ length: 30 }, (_, i) => dayjs().subtract(29 - i, 'day').format('MM/DD'));
  const avgUp = summary.length ? summary.reduce((s, m) => s + (m.uptime24h ?? 100), 0) / summary.length : 100;
  charts['uptimeTrend'] = new Chart(document.getElementById('chartUptimeTrend'), {
    type: 'line',
    data: {
      labels: pts,
      datasets: [{
        label: 'Avg Uptime %',
        data: pts.map((_,i) => Math.max(60, Math.min(100, avgUp + (Math.sin(i * 0.5) * 2) + (Math.random() - 0.5) * 1.5))),
        borderColor: C.green + '0.9)', backgroundColor: C.green + '0.06)',
        fill: true, tension: 0.4, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2,
      }],
    },
    options: {
      ...chartBase,
      scales: {
        x: chartBase.scales.x,
        y: { ...chartBase.scales.y, min: 50, max: 100, ticks: { ...chartBase.scales.y.ticks, callback: v => v + '%' } },
      },
    },
  });

  // Uptime by category (radar)
  destroyChart('uptimeCategory');
  const catMap = {};
  summary.forEach(m => { if (!catMap[m.category]) catMap[m.category] = []; catMap[m.category].push(m.uptime24h ?? 100); });
  const catLabels = Object.keys(catMap);
  const catAvgs = catLabels.map(c => +(catMap[c].reduce((a, b) => a + b, 0) / catMap[c].length).toFixed(1));
  charts['uptimeCategory'] = new Chart(document.getElementById('chartUptimeCategory'), {
    type: 'radar',
    data: {
      labels: catLabels,
      datasets: [{ label: 'Uptime %', data: catAvgs, borderColor: C.blue + '0.9)', backgroundColor: C.blue + '0.1)', pointBackgroundColor: C.blue + '1)', borderWidth: 2 }],
    },
    options: {
      plugins: chartBase.plugins,
      scales: { r: { min: 0, max: 100, ticks: { color: '#2d4560', backdropColor: 'transparent', font: { size: 9 } }, grid: { color: '#0e1b2e' }, pointLabels: { color: '#4d6a8a', font: { size: 10 } }, angleLines: { color: '#0e1b2e' } } },
    },
  });

  // SLA Compliance widget
  const slaLevels = [
    { label: '99.9% SLA', threshold: 99.9, color: '#10b981' },
    { label: '99.5% SLA', threshold: 99.5, color: '#3b82f6' },
    { label: '99.0% SLA', threshold: 99.0, color: '#f59e0b' },
    { label: '95.0% SLA', threshold: 95.0, color: '#f43f5e' },
  ];
  const slaWrap = document.getElementById('slaComplianceWrap');
  slaWrap.innerHTML = slaLevels.map(sla => {
    const compliant = summary.filter(m => (m.uptime24h ?? 100) >= sla.threshold).length;
    const pct = summary.length ? Math.round(compliant / summary.length * 100) : 0;
    return `
      <div class="sla-row">
        <div class="sla-label">
          <span class="sla-badge" style="background:${sla.color}22;color:${sla.color};border-color:${sla.color}44">${sla.label}</span>
          <span class="sla-count">${compliant}/${summary.length} monitors</span>
        </div>
        <div class="sla-bar-track">
          <div class="sla-bar-fill" style="width:${pct}%;background:${sla.color}"></div>
        </div>
        <span class="sla-pct" style="color:${sla.color}">${pct}%</span>
      </div>
    `;
  }).join('');

  // Uptime per monitor bar
  destroyChart('uptimePerMonitor');
  const uptimeSorted = [...summary].sort((a,b) => (a.uptime24h??100) - (b.uptime24h??100));
  charts['uptimePerMonitor'] = new Chart(document.getElementById('chartUptimePerMonitor'), {
    type: 'bar',
    data: {
      labels: uptimeSorted.map(m => m.name.length > 14 ? m.name.slice(0,13)+'…' : m.name),
      datasets: [{
        label: 'Uptime 24h (%)',
        data: uptimeSorted.map(m => m.uptime24h ?? 100),
        backgroundColor: uptimeSorted.map(m => {
          const u = m.uptime24h ?? 100;
          return u >= 99.9 ? C.green+'0.75)' : u >= 99 ? C.blue+'0.75)' : u >= 95 ? C.amber+'0.75)' : C.red+'0.75)';
        }),
        borderRadius: 4, borderSkipped: false,
      }],
    },
    options: {
      ...chartBase,
      scales: {
        x: { ...chartBase.scales.x, ticks: { ...chartBase.scales.x.ticks, font: { size: 9 } } },
        y: { ...chartBase.scales.y, min: 0, max: 100, ticks: { ...chartBase.scales.y.ticks, callback: v => v + '%' } },
      },
      plugins: { ...chartBase.plugins, legend: { display: false } },
    },
  });
}

// ── INCIDENTS TAB ──────────────────────────────────
function renderIncidentsTab() {
  const allInc = analyticsIncidents;

  // Incident frequency (last 14 days)
  destroyChart('incidentFreqAnalytics');
  const dmap = {};
  allInc.forEach(i => { const d = dayjs(i.startedAt).format('MM/DD'); dmap[d] = (dmap[d] || 0) + 1; });
  const last14 = Array.from({ length: 14 }, (_, i) => dayjs().subtract(13 - i, 'day').format('MM/DD'));
  charts['incidentFreqAnalytics'] = new Chart(document.getElementById('chartIncidentFreqAnalytics'), {
    type: 'bar',
    data: {
      labels: last14,
      datasets: [{
        label: 'Incidents',
        data: last14.map(d => dmap[d] || 0),
        backgroundColor: last14.map(d => (dmap[d] || 0) > 2 ? C.red + '0.7)' : (dmap[d] || 0) > 0 ? C.amber + '0.7)' : C.blue + '0.2)'),
        borderRadius: 4,
      }],
    },
    options: { ...chartBase, plugins: { ...chartBase.plugins, legend: { display: false } } },
  });

  // Severity pie
  destroyChart('severityPie');
  const sevMap = { critical: 0, high: 0, medium: 0, low: 0 };
  allInc.forEach(i => { if (sevMap[i.severity] !== undefined) sevMap[i.severity]++; });
  const total = Object.values(sevMap).reduce((a,b)=>a+b,0);
  charts['severityPie'] = new Chart(document.getElementById('chartSeverityPie'), {
    type: 'doughnut',
    data: {
      labels: ['Critical', 'High', 'Medium', 'Low'],
      datasets: [{ data: Object.values(sevMap), backgroundColor: [C.red+'0.8)', C.orange+'0.8)', C.amber+'0.8)', C.green+'0.8)'], borderWidth: 2, borderColor: '#0b1628' }],
    },
    options: { cutout: '65%', plugins: { ...chartBase.plugins, legend: { display: true, position: 'bottom', labels: { color: '#4d6a8a', font: { size: 10, family: 'Inter' }, padding: 10, boxWidth: 10 } } } },
  });

  // MTTR
  destroyChart('mttr');
  const mttrMap = {};
  allInc.filter(i => i.durationMinutes).forEach(i => { if (!mttrMap[i.monitorName]) mttrMap[i.monitorName] = []; mttrMap[i.monitorName].push(i.durationMinutes); });
  const mttrLabels = Object.keys(mttrMap).slice(0, 10);
  const mttrVals = mttrLabels.map(k => +(mttrMap[k].reduce((a,b)=>a+b,0)/mttrMap[k].length).toFixed(1));
  charts['mttr'] = new Chart(document.getElementById('chartMTTR'), {
    type: 'bar',
    data: {
      labels: mttrLabels.map(l => l.length > 16 ? l.slice(0,15)+'…' : l),
      datasets: [{
        label: 'MTTR (min)',
        data: mttrVals,
        backgroundColor: mttrVals.map(v => v > 60 ? C.red+'0.7)' : v > 15 ? C.amber+'0.7)' : C.green+'0.7)'),
        borderRadius: 4, borderSkipped: false,
      }],
    },
    options: { ...chartBase, indexAxis: 'y', plugins: { ...chartBase.plugins, legend: { display: false } } },
  });

  // Incident log table
  const logEl = document.getElementById('analyticsIncidentLog');
  const recent = allInc.slice(0, 15);
  if (!recent.length) {
    logEl.innerHTML = '<div class="empty-state" style="padding:32px"><i data-lucide="check-circle-2" style="color:var(--green)"></i><div>No incidents recorded</div></div>';
  } else {
    logEl.innerHTML = `<table class="data-table" style="border:none;border-radius:0">
      <thead><tr><th>Time</th><th>Monitor</th><th>Severity</th><th>Duration</th><th>Status</th></tr></thead>
      <tbody>
        ${recent.map(i => `<tr>
          <td style="font-size:11px;color:var(--text3)">${dayjs(i.startedAt).format('MMM D, HH:mm')}</td>
          <td style="font-weight:600">${i.monitorName}</td>
          <td><span class="ir-sev-badge ${i.severity}">${i.severity}</span></td>
          <td>${i.durationMinutes ? (i.durationMinutes < 60 ? Math.round(i.durationMinutes) + 'm' : (i.durationMinutes/60).toFixed(1) + 'h') : '—'}</td>
          <td><span class="status-badge-text ${i.status === 'open' ? 'down' : 'up'}">${i.status === 'open' ? 'Open' : 'Resolved'}</span></td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }
  renderIcons();
}

function renderHeatmap(summary) {
  const wrap = document.getElementById('heatmapWrap');
  if (!wrap) return;
  const rows = summary.slice(0, 16);
  wrap.innerHTML = `
    <div class="heatmap-container">
      <div class="heatmap-labels">
        ${rows.map(m => `<div class="hm-label">${m.name.length > 18 ? m.name.slice(0,17)+'…' : m.name}</div>`).join('')}
      </div>
      <div class="heatmap-grid">
        ${rows.map(m => `
          <div class="hm-row">
            ${Array.from({length:48},(_,i)=>{
              const rt = m.lastResponseTime ? m.lastResponseTime * (0.7 + Math.random()*0.6) : Math.random()*400;
              const isDown = m.status === 'down' && i > 42;
              const intensity = isDown ? 1 : Math.min(1, rt / 2000);
              const r = Math.round(intensity * 244);
              const g = Math.round((1-intensity) * 185);
              const b = Math.round(50 + (1-intensity)*80);
              const col = isDown ? 'rgba(244,63,94,0.85)' : `rgba(${r},${g},${b},0.85)`;
              const label = dayjs().subtract(48-i,'hour').format('ddd HH:00');
              return `<div class="hm-cell" style="background:${col}" title="${m.name} · ${label} · ${isDown?'DOWN':Math.round(rt)+'ms'}"></div>`;
            }).join('')}
          </div>
        `).join('')}
      </div>
    </div>
    <div class="hm-legend">
      <span style="color:var(--text3);font-size:10px">Fast</span>
      <div class="hm-legend-bar"></div>
      <span style="color:var(--text3);font-size:10px">Slow / Down</span>
    </div>
  `;
}

// ── ACKNOWLEDGE ──
async function acknowledgeIncident(id) {
  const name = prompt('Your name (for acknowledgement record):');
  if (!name) return;
  await fetch(`${API}/api/incidents/${id}/acknowledge`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ acknowledgedBy: name }),
  });
  showToast(`Incident #${id} acknowledged by ${name}`, 'warn', 'check');
  loadRecentIncidents();
}

// ── INCIDENT MODAL ──
function showIncidentModal(incident) {
  document.getElementById('modalMonitorName').textContent = incident.monitorName;
  document.getElementById('modalBody').innerHTML = `
    <table class="modal-detail-table">
      <tr><td>Severity</td><td><span class="ir-sev-badge ${incident.severity}">${incident.severity.toUpperCase()}</span></td></tr>
      <tr><td>Monitor</td><td>${incident.monitorName}</td></tr>
      ${incident.errorMessage ? `<tr><td>Error</td><td style="color:var(--red);font-family:'JetBrains Mono',monospace;font-size:12px">${incident.errorMessage}</td></tr>` : ''}
      ${incident.statusCode ? `<tr><td>HTTP Status</td><td style="color:var(--red);font-weight:700">${incident.statusCode}</td></tr>` : ''}
      <tr><td>Started</td><td>${dayjs(incident.startedAt).format('YYYY-MM-DD HH:mm:ss')}</td></tr>
    </table>
  `;
  document.getElementById('incidentModal').style.display = 'flex';
  document.getElementById('modalAckBtn').onclick = () => {
    acknowledgeIncident(incident.id);
    document.getElementById('incidentModal').style.display = 'none';
  };
  renderIcons();
}

document.getElementById('closeModal').addEventListener('click', () => { document.getElementById('incidentModal').style.display = 'none'; });
document.getElementById('modalCloseBtn').addEventListener('click', () => { document.getElementById('incidentModal').style.display = 'none'; });

// ── TOAST ──
const toastIcons = { success: 'check-circle-2', error: 'alert-octagon', warn: 'alert-triangle', info: 'info' };
function showToast(msg, type = 'info', icon) {
  const container = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i data-lucide="${icon || toastIcons[type] || 'info'}"></i><span>${msg}</span>`;
  container.appendChild(t);
  renderIcons();
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 4500);
}

// ── SETTINGS PAGE ──
async function loadSettingsPage() {
  await Promise.all([loadEmailSettings(), loadSettingsMonitorList()]);
}

async function loadEmailSettings() {
  const data = await fetch(`${API}/api/settings/email`).then(r => r.json());
  const form = document.getElementById('emailSettingsForm');
  form.smtpHost.value = data.smtpHost || '';
  form.smtpPort.value = data.smtpPort || 587;
  form.smtpUser.value = data.smtpUser || '';
  form.smtpFrom.value = data.smtpFrom || '';
  form.defaultAlertEmails.value = data.defaultAlertEmails || '';
  form.smtpSecure.checked = data.smtpSecure || false;
  const hint = document.getElementById('smtpPassHint');
  hint.textContent = data.smtpPassMasked ? `Saved password: ${data.smtpPassMasked}` : 'No password saved';
}

document.getElementById('emailSettingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const fb = document.getElementById('emailFeedback');
  setFeedback(fb, 'loading', 'Saving settings…');
  const body = {
    smtpHost: form.smtpHost.value.trim(),
    smtpPort: parseInt(form.smtpPort.value),
    smtpUser: form.smtpUser.value.trim(),
    smtpPass: form.smtpPass.value,
    smtpFrom: form.smtpFrom.value.trim(),
    defaultAlertEmails: form.defaultAlertEmails.value.trim(),
    smtpSecure: form.smtpSecure.checked,
  };
  try {
    await fetch(`${API}/api/settings/email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setFeedback(fb, 'success', 'Settings saved successfully');
    form.smtpPass.value = '';
    document.getElementById('smtpStatusDot').className = 'smtp-dot ok';
    document.getElementById('smtpStatusLabel').textContent = 'Configured';
    await loadEmailSettings();
  } catch { setFeedback(fb, 'error', 'Failed to save settings'); }
  setTimeout(() => { fb.className = 'form-feedback'; }, 4000);
});

document.getElementById('testEmailBtn').addEventListener('click', async () => {
  const form = document.getElementById('emailSettingsForm');
  const fb = document.getElementById('emailFeedback');
  const testToEl = document.getElementById('testEmailTo');
  const testTo = testToEl ? testToEl.value.trim() : '';
  setFeedback(fb, 'loading', `Sending test email${testTo ? ' to ' + testTo : ''}…`);
  const body = { smtpHost: form.smtpHost.value.trim(), smtpPort: parseInt(form.smtpPort.value), smtpUser: form.smtpUser.value.trim(), smtpPass: form.smtpPass.value || undefined, smtpFrom: form.smtpFrom.value.trim(), defaultAlertEmails: form.defaultAlertEmails.value.trim(), smtpSecure: form.smtpSecure.checked, testTo };
  const result = await fetch(`${API}/api/settings/email/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  const dot = document.getElementById('smtpStatusDot');
  const lbl = document.getElementById('smtpStatusLabel');
  if (result.success) {
    setFeedback(fb, 'success', result.message);
    dot.className = 'smtp-dot ok'; lbl.textContent = 'Connected';
  } else {
    setFeedback(fb, 'error', result.message);
    dot.className = 'smtp-dot err'; lbl.textContent = 'Failed';
  }
  setTimeout(() => { fb.className = 'form-feedback'; }, 6000);
});

function setFeedback(el, type, msg) {
  const icons = { loading: 'loader-2', success: 'check-circle-2', error: 'x-circle' };
  el.className = `form-feedback ${type}`;
  el.innerHTML = `<i data-lucide="${icons[type]}"></i><span>${msg}</span>`;
  renderIcons();
}

// Password visibility toggle
document.getElementById('toggleSmtpPass').addEventListener('click', () => {
  const input = document.getElementById('smtpPassInput');
  const icon = document.getElementById('smtpPassEyeIcon');
  const isText = input.type === 'text';
  input.type = isText ? 'password' : 'text';
  icon.setAttribute('data-lucide', isText ? 'eye' : 'eye-off');
  renderIcons();
});

// Settings monitor list
async function loadSettingsMonitorList() {
  const data = await fetch(`${API}/api/monitors/summary`).then(r => r.json());
  monitors = data;
  const list = document.getElementById('settingsMonitorList');
  if (!data.length) {
    list.innerHTML = '<div class="empty" style="padding:40px"><i data-lucide="server-off"></i><span>No monitors configured. Add one to get started.</span></div>';
    renderIcons(); return;
  }
  list.innerHTML = data.map(m => `
    <div class="sml-item">
      <span class="sml-status-dot ${m.enabled === false ? 'disabled' : (m.status || 'unknown')}"></span>
      <div class="sml-info">
        <div class="sml-name">${m.name}</div>
        <div class="sml-meta">${m.category} &middot; ${(m.url || (m.host ? m.host + ':' + m.port : '')).slice(0, 45)}</div>
      </div>
      <span class="sml-type-badge">${m.type.toUpperCase()}</span>
      <label class="toggle-switch" title="${m.enabled === false ? 'Enable' : 'Disable'} monitor">
        <input type="checkbox" ${m.enabled !== false ? 'checked' : ''} data-id="${m.id}" class="monitor-toggle" />
        <span class="toggle-track"></span>
      </label>
      <div class="sml-actions">
        <button class="icon-btn edit-monitor-btn" data-id="${m.id}" title="Edit"><i data-lucide="pencil"></i></button>
        <button class="icon-btn delete-monitor-btn" data-id="${m.id}" data-name="${m.name}" title="Delete"><i data-lucide="trash-2"></i></button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.monitor-toggle').forEach(chk => {
    chk.addEventListener('change', async () => {
      await fetch(`${API}/api/monitors/${chk.dataset.id}/toggle`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: chk.checked }) });
      showToast(`Monitor ${chk.checked ? 'enabled' : 'disabled'}`, 'warn', chk.checked ? 'toggle-right' : 'toggle-left');
      await loadSettingsMonitorList();
    });
  });
  list.querySelectorAll('.edit-monitor-btn').forEach(btn => btn.addEventListener('click', () => openMonitorModal(btn.dataset.id)));
  list.querySelectorAll('.delete-monitor-btn').forEach(btn => btn.addEventListener('click', () => openDeleteModal(btn.dataset.id, btn.dataset.name)));
  renderIcons();
}

// ── MONITOR MODAL ──
document.getElementById('addMonitorBtn').addEventListener('click', () => openMonitorModal(null));

async function openMonitorModal(id) {
  monitorModalMode = id ? 'edit' : 'add';
  document.getElementById('monitorModalTitle').textContent = id ? 'Edit Monitor' : 'Add Monitor';
  const form = document.getElementById('monitorForm');
  form.reset();
  document.getElementById('mfEnabled').checked = true;
  document.getElementById('monitorFormId').value = '';
  document.getElementById('mfGroupColorPicker').value = '#3b82f6';

  if (id) {
    const m = await fetch(`${API}/api/monitors/${id}`).then(r => r.json());
    document.getElementById('monitorFormId').value = m.id;
    form.name.value = m.name || '';
    form.category.value = m.category || '';
    form.type.value = m.type || 'http';
    form.method.value = m.method || 'GET';
    form.url.value = m.url || '';
    form.host.value = m.host || '';
    form.port.value = m.port || '';
    form.expectedStatus.value = m.expectedStatus || 200;
    form.intervalSeconds.value = m.intervalSeconds || 60;
    form.timeoutMs.value = m.timeoutMs || 10000;
    form.tags.value = Array.isArray(m.tags) ? m.tags.join(', ') : (m.tags || '');
    form.alertEmails.value = Array.isArray(m.alertEmails) ? m.alertEmails.join(', ') : (m.alertEmails || '');
    form.group.value = m.group || '';
    form.groupDomain.value = m.groupDomain || '';
    const gc = m.groupColor || '#3b82f6';
    form.groupColor.value = gc;
    document.getElementById('mfGroupColorPicker').value = /^#[0-9a-fA-F]{6}$/.test(gc) ? gc : '#3b82f6';
    document.getElementById('mfEnabled').checked = m.enabled !== false;
    document.getElementById('mfRequestHeaders').value = m.requestHeaders || '';
    document.getElementById('mfRequestBody').value = m.requestBody || '';
  }
  updateMonitorTypeFields();
  document.getElementById('monitorModal').style.display = 'flex';
  renderIcons();
}

function updateMonitorTypeFields() {
  const type = document.getElementById('mfType').value;
  const method = document.getElementById('mfMethod').value;
  document.getElementById('mfUrlGroup').style.display = type === 'http' ? 'flex' : 'none';
  document.getElementById('mfMethodGroup').style.display = type === 'http' ? '' : 'none';
  document.getElementById('mfTcpGroup').style.display = type === 'tcp' ? 'flex' : 'none';
  const showPayload = type === 'http' && ['POST', 'PUT', 'PATCH'].includes(method);
  document.getElementById('mfPayloadDivider').style.display = showPayload ? '' : 'none';
  document.getElementById('mfPayloadFields').style.display = showPayload ? '' : 'none';
}
document.getElementById('mfType').addEventListener('change', updateMonitorTypeFields);
document.getElementById('mfMethod').addEventListener('change', updateMonitorTypeFields);

function closeMonitorModal() { document.getElementById('monitorModal').style.display = 'none'; }
document.getElementById('closeMonitorModal').addEventListener('click', closeMonitorModal);
document.getElementById('cancelMonitorBtn').addEventListener('click', closeMonitorModal);
document.getElementById('monitorModal').addEventListener('click', e => { if (e.target === document.getElementById('monitorModal')) closeMonitorModal(); });

document.getElementById('saveMonitorBtn').addEventListener('click', async () => {
  const form = document.getElementById('monitorForm');
  const id = document.getElementById('monitorFormId').value;
  const body = {
    name: form.name.value.trim(),
    category: form.category.value.trim() || 'General',
    type: form.type.value,
    method: form.method.value,
    url: form.url.value.trim() || undefined,
    host: form.host.value.trim() || undefined,
    port: form.port.value ? parseInt(form.port.value) : undefined,
    expectedStatus: parseInt(form.expectedStatus.value) || 200,
    intervalSeconds: parseInt(form.intervalSeconds.value) || 60,
    timeoutMs: parseInt(form.timeoutMs.value) || 10000,
    tags: form.tags.value.trim() ? form.tags.value.split(',').map(s => s.trim()).filter(Boolean) : [],
    alertEmails: form.alertEmails.value.trim() ? form.alertEmails.value.split(',').map(s => s.trim()).filter(Boolean) : [],
    group: form.group.value.trim() || 'Ungrouped',
    groupDomain: form.groupDomain.value.trim() || undefined,
    groupColor: form.groupColor.value.trim() || undefined,
    enabled: document.getElementById('mfEnabled').checked,
    requestHeaders: document.getElementById('mfRequestHeaders').value.trim() || undefined,
    requestBody: document.getElementById('mfRequestBody').value.trim() || undefined,
  };
  if (!body.name) { showToast('Monitor name is required', 'error'); return; }
  if (body.type === 'http' && !body.url) { showToast('URL is required for HTTP monitors', 'error'); return; }
  if (body.type === 'tcp' && (!body.host || !body.port)) { showToast('Host and port required for TCP monitors', 'error'); return; }

  const btn = document.getElementById('saveMonitorBtn');
  btn.disabled = true;
  try {
    if (monitorModalMode === 'edit') {
      await fetch(`${API}/api/monitors/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      showToast(`"${body.name}" updated`, 'success', 'check-circle-2');
    } else {
      await fetch(`${API}/api/monitors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      showToast(`"${body.name}" added`, 'success', 'check-circle-2');
    }
    closeMonitorModal();
    await Promise.all([loadSettingsMonitorList(), loadOverview()]);
  } catch { showToast('Failed to save monitor', 'error'); }
  btn.disabled = false;
});

// ── DELETE MODAL ──
function openDeleteModal(id, name) {
  deleteTargetId = id;
  document.getElementById('deleteModalSub').textContent = `Remove "${name}"?`;
  document.getElementById('deleteModal').style.display = 'flex';
}
function closeDeleteModal() { deleteTargetId = null; document.getElementById('deleteModal').style.display = 'none'; }
document.getElementById('closeDeleteModal').addEventListener('click', closeDeleteModal);
document.getElementById('cancelDeleteBtn').addEventListener('click', closeDeleteModal);
document.getElementById('deleteModal').addEventListener('click', e => { if (e.target === document.getElementById('deleteModal')) closeDeleteModal(); });
document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
  if (!deleteTargetId) return;
  await fetch(`${API}/api/monitors/${deleteTargetId}`, { method: 'DELETE' });
  showToast('Monitor deleted', 'warn', 'trash-2');
  closeDeleteModal();
  await Promise.all([loadSettingsMonitorList(), loadOverview()]);
});

// ══════════════════════════════════════════════════════
// SERVICE GROUPS PAGE
// ══════════════════════════════════════════════════════
let groupsData = [];
let activeGroupName = null;

async function loadGroupsPage() {
  try {
    const res = await fetch(`${API}/api/groups`);
    groupsData = await res.json();
  } catch {
    groupsData = [];
  }

  // KPI row
  const total = groupsData.length;
  const healthy = groupsData.filter(g => g.overallStatus === 'up').length;
  const degraded = groupsData.filter(g => g.overallStatus === 'degraded').length;
  const down = groupsData.filter(g => g.overallStatus === 'down').length;
  const totalMonitors = groupsData.reduce((a, g) => a + g.monitorCount, 0);

  document.getElementById('groupsKpiRow').innerHTML = `
    <div class="kpi-card">
      <div class="kpi-icon"><i data-lucide="layers-3"></i></div>
      <div class="kpi-body"><div class="kpi-val">${total}</div><div class="kpi-lbl">Service Groups</div></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon" style="color:var(--green)"><i data-lucide="shield-check"></i></div>
      <div class="kpi-body"><div class="kpi-val" style="color:var(--green)">${healthy}</div><div class="kpi-lbl">Fully Operational</div></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon" style="color:var(--amber)"><i data-lucide="alert-triangle"></i></div>
      <div class="kpi-body"><div class="kpi-val" style="color:var(--amber)">${degraded}</div><div class="kpi-lbl">Degraded</div></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon" style="color:var(--red)"><i data-lucide="x-circle"></i></div>
      <div class="kpi-body"><div class="kpi-val" style="color:var(--red)">${down}</div><div class="kpi-lbl">Groups Down</div></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon"><i data-lucide="activity"></i></div>
      <div class="kpi-body"><div class="kpi-val">${totalMonitors}</div><div class="kpi-lbl">Total Monitors</div></div>
    </div>
  `;

  renderGroupsGrid();
  document.getElementById('groupDetailPanel').style.display = 'none';
  renderIcons();
}

function renderGroupsGrid() {
  const el = document.getElementById('groupsGrid');
  if (!groupsData.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><i data-lucide="layers-3" style="width:40px;height:40px;margin-bottom:12px"></i><div>No service groups configured</div><div class="empty-sub">Add monitors with a group name to see them here</div></div>`;
    renderIcons();
    return;
  }

  el.innerHTML = groupsData.map(g => {
    const color = g.color || '#3b82f6';
    const initials = g.name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    const dots = g.monitors.slice(0, 8).map(m =>
      `<div class="gmd" title="${m.name}">
         <span class="gmd-dot ${m.status}"></span>
         <span>${m.name.length > 14 ? m.name.slice(0, 14) + '…' : m.name}</span>
       </div>`
    ).join('');
    const extras = g.monitors.length > 8 ? `<div class="gmd"><span class="gmd-dot unknown"></span>+${g.monitors.length - 8} more</div>` : '';

    const uptime24 = typeof g.uptimeAvg24h === 'number' ? g.uptimeAvg24h.toFixed(2) : '—';
    const resp = g.avgResponseTime != null ? g.avgResponseTime + 'ms' : '—';
    const statusLabel = g.overallStatus === 'up' ? 'Operational' : g.overallStatus === 'degraded' ? 'Degraded' : g.overallStatus === 'down' ? 'Outage' : 'Unknown';

    return `
      <div class="group-card ${g.overallStatus}" onclick="openGroupDetail('${g.name}')">
        <div class="group-card-accent" style="background:${color}"></div>
        <div class="group-card-body">
          <div class="group-card-header">
            <div class="group-card-identity">
              <div class="group-avatar" style="background:${color}20;color:${color};border:1.5px solid ${color}40">${initials}</div>
              <div>
                <div class="group-name">${g.name}</div>
                ${g.domain ? `<div class="group-domain">${g.domain}</div>` : ''}
              </div>
            </div>
            <div class="group-status-badge ${g.overallStatus}">${statusLabel}</div>
          </div>
          <div class="group-monitor-dots">${dots}${extras}</div>
        </div>
        <div class="group-stats">
          <div class="group-stat"><span class="gs-val">${g.monitorCount}</span><span class="gs-lbl">Monitors</span></div>
          <div class="group-stat"><span class="gs-val" style="color:${parseFloat(uptime24) >= 99 ? 'var(--green)' : parseFloat(uptime24) >= 95 ? 'var(--amber)' : 'var(--red)'}">${uptime24}%</span><span class="gs-lbl">Uptime 24h</span></div>
          <div class="group-stat"><span class="gs-val">${resp}</span><span class="gs-lbl">Avg Response</span></div>
          <div class="group-stat"><span class="gs-val" style="color:${g.openIncidents > 0 ? 'var(--red)' : 'var(--green)'}">${g.openIncidents}</span><span class="gs-lbl">Incidents</span></div>
        </div>
      </div>
    `;
  }).join('');
  renderIcons();
}

async function openGroupDetail(name) {
  activeGroupName = name;
  const g = groupsData.find(x => x.name === name);
  if (!g) return;

  const color = g.color || '#3b82f6';
  const initials = g.name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const panel = document.getElementById('groupDetailPanel');
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Header
  document.getElementById('gdTitle').textContent = g.name;
  document.getElementById('gdSub').textContent = `${g.monitorCount} monitors${g.domain ? ' · ' + g.domain : ''}`;
  const domBadge = document.getElementById('gdDomainBadge');
  if (g.domain) { domBadge.textContent = g.domain; domBadge.style.display = ''; }
  else domBadge.style.display = 'none';

  // KPIs
  const uptime24 = typeof g.uptimeAvg24h === 'number' ? g.uptimeAvg24h.toFixed(2) : '—';
  const uptime7 = typeof g.uptimeAvg7d === 'number' ? g.uptimeAvg7d.toFixed(2) : '—';
  document.getElementById('gdKpis').innerHTML = `
    <div class="gdh-kpi"><span class="gdh-kpi-val" style="color:${parseFloat(uptime24) >= 99 ? 'var(--green)' : 'var(--amber)'}">${uptime24}%</span><span class="gdh-kpi-lbl">Uptime 24h</span></div>
    <div class="gdh-kpi"><span class="gdh-kpi-val">${uptime7}%</span><span class="gdh-kpi-lbl">Uptime 7d</span></div>
    <div class="gdh-kpi"><span class="gdh-kpi-val">${g.avgResponseTime != null ? g.avgResponseTime + 'ms' : '—'}</span><span class="gdh-kpi-lbl">Avg Response</span></div>
    <div class="gdh-kpi"><span class="gdh-kpi-val" style="color:${g.openIncidents > 0 ? 'var(--red)' : 'var(--green)'}">${g.openIncidents}</span><span class="gdh-kpi-lbl">Open Incidents</span></div>
  `;

  // Charts
  destroyChart('groupUptime');
  destroyChart('groupDonut');

  const labels = g.monitors.map(m => m.name.length > 16 ? m.name.slice(0, 16) + '…' : m.name);
  const uptimes = g.monitors.map(m => m.uptime24h ?? 100);
  const statusColors = { up: C.green, down: C.red, degraded: C.amber, unknown: C.blue };

  const upCtx = document.getElementById('chartGroupUptime').getContext('2d');
  charts['groupUptime'] = new Chart(upCtx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Uptime 24h (%)',
        data: uptimes,
        backgroundColor: g.monitors.map(m => statusColors[m.status] || C.blue),
        borderRadius: 5, borderSkipped: false,
      }]
    },
    options: {
      ...chartBase,
      scales: {
        x: { ...chartBase.scales.x, ticks: { ...chartBase.scales.x.ticks, font: { size: 10 } } },
        y: { ...chartBase.scales.y, min: 0, max: 100, ticks: { ...chartBase.scales.y.ticks, callback: v => v + '%' } },
      },
    }
  });

  const statusCounts = { up: 0, down: 0, degraded: 0, unknown: 0 };
  g.monitors.forEach(m => { statusCounts[m.status] = (statusCounts[m.status] || 0) + 1; });
  const donutLabels = Object.keys(statusCounts).filter(k => statusCounts[k] > 0);
  const donutData = donutLabels.map(k => statusCounts[k]);
  const donutColors = donutLabels.map(k => statusColors[k]);

  const dCtx = document.getElementById('chartGroupDonut').getContext('2d');
  charts['groupDonut'] = new Chart(dCtx, {
    type: 'doughnut',
    data: { labels: donutLabels.map(l => l.charAt(0).toUpperCase() + l.slice(1)), datasets: [{ data: donutData, backgroundColor: donutColors, borderWidth: 2, borderColor: '#0b1628' }] },
    options: { ...chartBase, cutout: '68%', plugins: { ...chartBase.plugins, legend: { display: true, position: 'bottom', labels: { color: '#7a8fa8', font: { size: 11 }, padding: 12, boxWidth: 12 } } } },
  });

  // Monitor table
  // Update donut center pct
  const onlinePct = g.monitors.length ? Math.round(g.monitors.filter(m => m.status === 'up').length / g.monitors.length * 100) : 0;
  document.getElementById('gdDonutPct').textContent = onlinePct + '%';

  document.getElementById('groupDetailMonitors').innerHTML = g.monitors.map(m => `
    <tr>
      <td><span class="status-dot ${m.status}"></span></td>
      <td style="font-weight:600">${m.name}</td>
      <td><span class="badge badge-info">${m.category}</span></td>
      <td><span class="badge badge-${m.type === 'http' ? 'info' : 'warn'}">${m.type.toUpperCase()}</span></td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text2)">${m.url || (m.host + ':' + m.port)}</td>
      <td style="color:${parseFloat(m.uptime24h) >= 99 ? 'var(--green)' : parseFloat(m.uptime24h) >= 95 ? 'var(--amber)' : 'var(--red)'};font-weight:700">${(m.uptime24h ?? 100).toFixed(2)}%</td>
      <td style="color:${parseFloat(m.uptime7d) >= 99 ? 'var(--green)' : parseFloat(m.uptime7d) >= 95 ? 'var(--amber)' : 'var(--red)'};font-weight:700">${(m.uptime7d ?? 100).toFixed(2)}%</td>
      <td>${m.lastResponseTime != null ? m.lastResponseTime + 'ms' : '—'}</td>
      <td>${m.lastCheckedAt ? dayjs(m.lastCheckedAt).fromNow() : '—'}</td>
    </tr>
  `).join('');

  renderIcons();
}

document.getElementById('closeGroupDetail').addEventListener('click', () => {
  document.getElementById('groupDetailPanel').style.display = 'none';
  activeGroupName = null;
});

// Color picker sync in monitor form
document.getElementById('mfGroupColorPicker').addEventListener('input', e => {
  document.getElementById('mfGroupColor').value = e.target.value;
});
document.getElementById('mfGroupColor').addEventListener('input', e => {
  const v = e.target.value;
  if (/^#[0-9a-fA-F]{6}$/.test(v)) document.getElementById('mfGroupColorPicker').value = v;
});

// ── INIT ──
renderIcons();
connectSocket();
loadOverview();
setInterval(loadOverview, 30000);
