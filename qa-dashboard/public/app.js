/* global netlifyIdentity */

const gate = document.getElementById('gate');
const app = document.getElementById('app');
const whoEmail = document.getElementById('who-email');

let currentUser = null;
let projectsCache = [];

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
  loadProjects();
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

projectForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('new-project-name').value.trim();
  const status = document.getElementById('new-project-status').value;
  if (!name) return;
  try {
    await api('projects', { method: 'POST', body: JSON.stringify({ name, status }) });
    document.getElementById('new-project-name').value = '';
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

function statusClass(status) {
  return 'pill-' + status.toLowerCase().replace(/\s+/g, '-');
}

function renderProjects(projects) {
  projectsTbody.innerHTML = '';
  projectCount.textContent = projects.length ? `${projects.length} total` : '';
  projectsEmpty.style.display = projects.length ? 'none' : 'block';

  projects.forEach((p, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-idx">${String(i + 1).padStart(2, '0')}</td>
      <td>${escapeHtml(p.name)}</td>
      <td>
        <select class="status-select" data-id="${p.id}">
          ${['Not Started', 'In Progress', 'Blocked', 'Done']
            .map((s) => `<option value="${s}" ${s === p.status ? 'selected' : ''}>${s}</option>`)
            .join('')}
        </select>
      </td>
      <td>${new Date(p.created_at).toLocaleDateString()}</td>
      <td><button class="icon-btn" data-delete="${p.id}">remove</button></td>
    `;
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
