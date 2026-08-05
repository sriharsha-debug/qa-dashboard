/* global netlifyIdentity */

const gate = document.getElementById('gate');
const app = document.getElementById('app');
const whoEmail = document.getElementById('who-email');

let currentUser = null;
let projectsCache = [];
let statusesCache = [];

// ---------- Auth ----------

netlifyIdentity.on('init', (user) => {
  if (user) onLogin(user);
});

netlifyIdentity.on('login', (user) => {
  onLogin(user);
  netlifyIdentity.close();
});

netlifyIdentity.on('logout', () => {
  currentUser = null;
  gate.classList.remove('hidden');
  app.classList.add('hidden');
});

document.getElementById('gate-login').addEventListener('click', () => {
  netlifyIdentity.open('login');
});

document.getElementById('logout').addEventListener('click', () => {
  netlifyIdentity.logout();
});

function onLogin(user) {
  currentUser = user;
  whoEmail.textContent = user.email;
  gate.classList.add('hidden');
  app.classList.remove('hidden');
  loadStatuses().then(loadProjects);
  loadReports();
}

netlifyIdentity.init();

// ---------- API helper ----------

async function api(path, options = {}) {
  const token = currentUser && currentUser.token && currentUser.token.access_token;
  const res = await fetch(`/.netlify/functions/${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

// ---------- Tabs ----------

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// ---------- Projects ----------

const projectForm = document.getElementById('project-form');
const projectsTbody = document.getElementById('projects-tbody');
const projectsEmpty = document.getElementById('projects-empty');
const projectCount = document.getElementById('project-count');
const rProjectSelect = document.getElementById('r-project');
const filterProjectSelect = document.getElementById('filter-project');
const newProjectStatusSelect = document.getElementById('new-project-status');

projectForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('new-project-name').value.trim();
  const status = document.getElementById('new-project-status').value;
  const start_date = document.getElementById('new-project-date').value || null;
  if (!name) return;
  try {
    await api('projects', { method: 'POST', body: JSON.stringify({ name, status, start_date }) });
    document.getElementById('new-project-name').value = '';
    document.getElementById('new-project-date').value = '';
    loadProjects();
  } catch (err) {
    alert(err.message);
  }
});

async function loadProjects() {
  try {
    const { projects } = await api('projects');
    projectsCache = projects;
    renderProjects(projects);
    renderProjectSelects(projects);
  } catch (err) {
    console.error(err);
  }
}

function statusColor(name) {
  const s = statusesCache.find((x) => x.name === name);
  return (s && s.color) || '#7FA0A6';
}

function pillStyle(hex) {
  return `background:${hex}22;color:${hex};border-color:${hex};`;
}

function renderProjects(projects) {
  projectsTbody.innerHTML = '';
  projectCount.textContent = projects.length ? `${projects.length} total` : '';
  projectsEmpty.style.display = projects.length ? 'none' : 'block';

  const statusOptions = statusesCache
    .map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`)
    .join('');

  projects.forEach((p, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-idx">${String(i + 1).padStart(2, '0')}</td>
      <td>${escapeHtml(p.name)}</td>
      <td>
        <select class="status-select pill" style="${pillStyle(statusColor(p.status))}" data-id="${p.id}">
          ${statusOptions}
        </select>
      </td>
      <td>${p.start_date ? new Date(p.start_date + 'T00:00:00').toLocaleDateString() : '—'}</td>
      <td><button class="icon-btn" data-delete="${p.id}">remove</button></td>
    `;
    tr.querySelector('.status-select').value = p.status;
    projectsTbody.appendChild(tr);
  });

  projectsTbody.querySelectorAll('.status-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      try {
        await api('projects', {
          method: 'PUT',
          body: JSON.stringify({ id: sel.dataset.id, status: sel.value }),
        });
        loadProjects();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  projectsTbody.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this project and all its daily entries?')) return;
      try {
        await api('projects', { method: 'DELETE', body: JSON.stringify({ id: btn.dataset.delete }) });
        loadProjects();
        loadReports();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

function renderProjectSelects(projects) {
  const opts = projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  rProjectSelect.innerHTML = opts || '<option value="">Add a project first</option>';
  filterProjectSelect.innerHTML =
    '<option value="">All projects</option>' + opts;
}

// ---------- Status manager ----------

const statusForm = document.getElementById('status-form');
const statusesListEl = document.getElementById('statuses-list');

statusForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('new-status-name').value.trim();
  const color = document.getElementById('new-status-color').value;
  if (!name) return;
  try {
    await api('statuses', { method: 'POST', body: JSON.stringify({ name, color }) });
    document.getElementById('new-status-name').value = '';
    await loadStatuses();
    loadProjects();
  } catch (err) {
    alert(err.message);
  }
});

async function loadStatuses() {
  try {
    const { statuses } = await api('statuses');
    statusesCache = statuses;
    renderStatusOptionsForNewProject(statuses);
    renderStatusManager(statuses);
  } catch (err) {
    console.error(err);
  }
}

function renderStatusOptionsForNewProject(statuses) {
  newProjectStatusSelect.innerHTML = statuses
    .map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`)
    .join('');
}

const colorSwatches = ['#12747D', '#1F7A6C', '#A9761E', '#A63D26', '#5B5FA6', '#6B7280'];

function renderStatusManager(statuses) {
  statusesListEl.innerHTML = '';
  statuses.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'status-row';
    row.innerHTML = `
      <span class="status-swatch" style="background:${s.color}"></span>
      <input type="text" value="${escapeHtml(s.name)}" data-id="${s.id}" class="status-name-input" />
      <select class="status-color-select" data-id="${s.id}">
        ${colorSwatches
          .map((c) => `<option value="${c}" ${c === s.color ? 'selected' : ''}>${colorName(c)}</option>`)
          .join('')}
      </select>
      <button class="icon-btn" data-delete-status="${s.id}">remove</button>
    `;
    statusesListEl.appendChild(row);
  });

  statusesListEl.querySelectorAll('.status-name-input').forEach((input) => {
    input.addEventListener('change', async () => {
      try {
        await api('statuses', {
          method: 'PUT',
          body: JSON.stringify({ id: input.dataset.id, name: input.value.trim() }),
        });
        await loadStatuses();
        loadProjects();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  statusesListEl.querySelectorAll('.status-color-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      try {
        await api('statuses', {
          method: 'PUT',
          body: JSON.stringify({ id: sel.dataset.id, color: sel.value }),
        });
        await loadStatuses();
        loadProjects();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  statusesListEl.querySelectorAll('[data-delete-status]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this status? Projects using it will keep the label but lose its color.')) return;
      try {
        await api('statuses', { method: 'DELETE', body: JSON.stringify({ id: btn.dataset.deleteStatus }) });
        await loadStatuses();
        loadProjects();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

function colorName(hex) {
  const map = {
    '#12747D': 'Teal', '#1F7A6C': 'Green', '#A9761E': 'Amber',
    '#A63D26': 'Red', '#5B5FA6': 'Purple', '#6B7280': 'Gray',
  };
  return map[hex] || hex;
}

// ---------- Daily reports ----------

const reportForm = document.getElementById('report-form');
const reportsList = document.getElementById('reports-list');
const reportsEmpty = document.getElementById('reports-empty');

document.getElementById('r-date').valueAsDate = new Date();

reportForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    report_date: document.getElementById('r-date').value,
    project_id: document.getElementById('r-project').value,
    project_manager: document.getElementById('r-pm').value.trim(),
    bugsheet: document.getElementById('r-bugsheet').value.trim(),
    test_cases: document.getElementById('r-testcases').value,
    ui_bugs: document.getElementById('r-uibugs').value,
    functionality_bugs: document.getElementById('r-funcbugs').value,
    remarks: document.getElementById('r-remarks').value.trim(),
    sign_off: document.getElementById('r-signoff').checked,
    notes: document.getElementById('r-notes').value.trim(),
  };
  if (!payload.project_id) {
    alert('Add a project first.');
    return;
  }
  try {
    await api('reports', { method: 'POST', body: JSON.stringify(payload) });
    reportForm.reset();
    document.getElementById('r-date').valueAsDate = new Date();
    loadReports();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('filter-project').addEventListener('change', loadReports);
document.getElementById('filter-date').addEventListener('change', loadReports);
document.getElementById('filter-clear').addEventListener('click', () => {
  document.getElementById('filter-project').value = '';
  document.getElementById('filter-date').value = '';
  loadReports();
});

async function loadReports() {
  const params = new URLSearchParams();
  const projectId = document.getElementById('filter-project').value;
  const date = document.getElementById('filter-date').value;
  if (projectId) params.set('project_id', projectId);
  if (date) params.set('date', date);

  try {
    const { reports } = await api(`reports?${params.toString()}`);
    renderReports(reports);
  } catch (err) {
    console.error(err);
  }
}

function renderReports(reports) {
  reportsList.innerHTML = '';
  reportsEmpty.style.display = reports.length ? 'none' : 'block';

  reports.forEach((r) => {
    const card = document.createElement('div');
    card.className = 'report-card';
    card.innerHTML = `
      <div class="report-head">
        <span class="proj-name">${escapeHtml(r.projects ? r.projects.name : 'Unknown project')}</span>
        <span>${r.report_date}</span>
        ${r.project_manager ? `<span>PM: ${escapeHtml(r.project_manager)}</span>` : ''}
      </div>
      <button class="icon-btn report-delete" data-delete="${r.id}">remove</button>
      <div class="report-body">
        ${r.bugsheet ? `<div>Bugsheet: ${escapeHtml(r.bugsheet)}</div>` : ''}
        <div class="report-metrics">
          <span>Test cases: <b>${r.test_cases}</b></span>
          <span>UI bugs: <b>${r.ui_bugs}</b></span>
          <span>Functionality bugs: <b>${r.functionality_bugs}</b></span>
        </div>
        ${r.remarks ? `<div class="report-remarks">${escapeHtml(r.remarks)}</div>` : ''}
        ${r.notes ? `<div>${escapeHtml(r.notes)}</div>` : ''}
      </div>
      ${r.sign_off ? '<div class="stamp">SIGNED<br/>OFF</div>' : ''}
    `;
    card.querySelector('[data-delete]').addEventListener('click', async () => {
      if (!confirm('Remove this entry?')) return;
      try {
        await api('reports', { method: 'DELETE', body: JSON.stringify({ id: r.id }) });
        loadReports();
      } catch (err) {
        alert(err.message);
      }
    });
    reportsList.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
