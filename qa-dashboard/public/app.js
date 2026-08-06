const gate = document.getElementById('gate');
const app = document.getElementById('app');
const whoEmail = document.getElementById('who-email');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

let projectsCache = [];
let statusesCache = [];

// ---------- Supabase client + Auth ----------

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

sb.auth.onAuthStateChange((_event, session) => {
  if (session && session.user) {
    onLogin(session.user);
  } else {
    onLogout();
  }
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    loginError.textContent = error.message;
    loginError.classList.remove('hidden');
  }
});

document.getElementById('logout').addEventListener('click', () => {
  sb.auth.signOut();
});

function onLogin(user) {
  whoEmail.textContent = user.email;
  gate.classList.add('hidden');
  app.classList.remove('hidden');
  loadStatuses().then(loadProjects);
  loadReports();
}

function onLogout() {
  gate.classList.remove('hidden');
  app.classList.add('hidden');
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

const projectsTbody = document.getElementById('projects-tbody');
const projectsEmpty = document.getElementById('projects-empty');
const projectCount = document.getElementById('project-count');
const rProjectSelect = document.getElementById('r-project');
const filterProjectSelect = document.getElementById('filter-project');

document.getElementById('open-add-modal').addEventListener('click', () => openEditModal(null));

async function loadProjects() {
  const { data, error } = await sb
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error(error);
    return;
  }
  projectsCache = data;
  renderProjects(data);
  renderProjectSelects(data);
}

function statusColor(name) {
  const s = statusesCache.find((x) => x.name === name);
  return (s && s.color) || '#7FA0A6';
}

function pillStyle(hex) {
  return `background:${hex}22;color:${hex};border-color:${hex};`;
}

function fmtDate(d) {
  return d ? new Date(d + 'T00:00:00').toLocaleDateString() : '—';
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
      <td><button class="project-link" data-edit="${p.id}">${escapeHtml(p.name)}</button></td>
      <td>
        <select class="status-select pill" style="${pillStyle(statusColor(p.status))}" data-id="${p.id}">
          ${statusOptions}
        </select>
      </td>
      <td>${p.project_manager ? escapeHtml(p.project_manager) : '<span class="no-link">—</span>'}</td>
      <td>${fmtDate(p.start_date)} – ${fmtDate(p.end_date)}</td>
      <td class="row-actions">
        <button class="icon-btn" data-edit-btn="${p.id}">edit</button>
        <button class="icon-btn" data-delete="${p.id}">remove</button>
      </td>
    `;
    tr.querySelector('.status-select').value = p.status;
    projectsTbody.appendChild(tr);
  });

  projectsTbody.querySelectorAll('[data-edit], [data-edit-btn]').forEach((btn) => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.edit || btn.dataset.editBtn));
  });

  projectsTbody.querySelectorAll('.status-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const { error } = await sb
        .from('projects')
        .update({ status: sel.value, updated_at: new Date().toISOString() })
        .eq('id', sel.dataset.id);
      if (error) {
        alert(error.message);
        return;
      }
      loadProjects();
    });
  });

  projectsTbody.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this project and all its daily entries?')) return;
      const { error } = await sb.from('projects').delete().eq('id', btn.dataset.delete);
      if (error) {
        alert(error.message);
        return;
      }
      loadProjects();
      loadReports();
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
  const { count } = await sb.from('statuses').select('*', { count: 'exact', head: true });
  const { error } = await sb.from('statuses').insert({ name, color, sort_order: count || 0 });
  if (error) {
    alert(error.message);
    return;
  }
  document.getElementById('new-status-name').value = '';
  await loadStatuses();
  loadProjects();
});

async function loadStatuses() {
  const { data, error } = await sb
    .from('statuses')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) {
    console.error(error);
    return;
  }
  statusesCache = data;
  renderStatusManager(data);
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
      const newName = input.value.trim();
      const { data: existing } = await sb.from('statuses').select('name').eq('id', input.dataset.id).single();
      if (existing && existing.name !== newName) {
        await sb.from('projects').update({ status: newName }).eq('status', existing.name);
      }
      const { error } = await sb.from('statuses').update({ name: newName }).eq('id', input.dataset.id);
      if (error) {
        alert(error.message);
        return;
      }
      await loadStatuses();
      loadProjects();
    });
  });

  statusesListEl.querySelectorAll('.status-color-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const { error } = await sb.from('statuses').update({ color: sel.value }).eq('id', sel.dataset.id);
      if (error) {
        alert(error.message);
        return;
      }
      await loadStatuses();
      loadProjects();
    });
  });

  statusesListEl.querySelectorAll('[data-delete-status]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { count } = await sb.from('statuses').select('*', { count: 'exact', head: true });
      if ((count || 0) <= 1) {
        alert('Keep at least one status.');
        return;
      }
      if (!confirm('Remove this status? Projects using it will keep the label but lose its color.')) return;
      const { error } = await sb.from('statuses').delete().eq('id', btn.dataset.deleteStatus);
      if (error) {
        alert(error.message);
        return;
      }
      await loadStatuses();
      loadProjects();
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

// ---------- Add / Edit project modal ----------

const editModal = document.getElementById('edit-modal');
const editForm = document.getElementById('edit-form');
const editStatusSelect = document.getElementById('edit-status');
const modalTitle = document.getElementById('modal-title');
const editDeleteBtn = document.getElementById('edit-delete');

const modalFieldIds = {
  name: 'edit-name',
  status: 'edit-status',
  project_manager: 'edit-pm',
  bugsheet: 'edit-bugsheet',
  start_date: 'edit-start-date',
  end_date: 'edit-end-date',
  kt_date: 'edit-kt-date',
  sign_off_date: 'edit-signoff-date',
  ui_testing_start_date: 'edit-ui-start',
  ui_testing_end_date: 'edit-ui-end',
  functional_testing_start_date: 'edit-func-start',
  functional_testing_end_date: 'edit-func-end',
  mobile_app_developers: 'edit-mobile-devs',
  web_developers: 'edit-web-devs',
  backend_developers: 'edit-backend-devs',
  clients_review: 'edit-clients-review',
  remarks: 'edit-remarks',
};

function openEditModal(id) {
  editStatusSelect.innerHTML = statusesCache
    .map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`)
    .join('');

  if (id) {
    const p = projectsCache.find((x) => x.id === id);
    if (!p) return;
    document.getElementById('edit-id').value = p.id;
    modalTitle.textContent = 'Edit project';
    editDeleteBtn.classList.remove('hidden');
    Object.entries(modalFieldIds).forEach(([key, elId]) => {
      document.getElementById(elId).value = p[key] || '';
    });
  } else {
    document.getElementById('edit-id').value = '';
    modalTitle.textContent = 'Add project';
    editDeleteBtn.classList.add('hidden');
    editForm.reset();
    editStatusSelect.value = statusesCache[0] ? statusesCache[0].name : '';
  }
  editModal.classList.remove('hidden');
}

function closeEditModal() {
  editModal.classList.add('hidden');
}

document.getElementById('edit-close').addEventListener('click', closeEditModal);
editModal.addEventListener('click', (e) => {
  if (e.target === editModal) closeEditModal();
});

editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('edit-id').value;

  const payload = {};
  Object.entries(modalFieldIds).forEach(([key, elId]) => {
    const val = document.getElementById(elId).value.trim();
    payload[key] = val || null;
  });
  if (!payload.name) {
    alert('Project name is required.');
    return;
  }
  if (!payload.status) payload.status = statusesCache[0] ? statusesCache[0].name : 'Not Started';

  if (id) {
    payload.updated_at = new Date().toISOString();
    const { error } = await sb.from('projects').update(payload).eq('id', id);
    if (error) {
      alert(error.message);
      return;
    }
  } else {
    const { error } = await sb.from('projects').insert(payload);
    if (error) {
      alert(error.message);
      return;
    }
  }
  closeEditModal();
  loadProjects();
});

editDeleteBtn.addEventListener('click', async () => {
  const id = document.getElementById('edit-id').value;
  if (!id) return;
  if (!confirm('Remove this project and all its daily entries?')) return;
  const { error } = await sb.from('projects').delete().eq('id', id);
  if (error) {
    alert(error.message);
    return;
  }
  closeEditModal();
  loadProjects();
  loadReports();
});

// ---------- Daily reports ----------

const reportForm = document.getElementById('report-form');
const reportsList = document.getElementById('reports-list');
const reportsEmpty = document.getElementById('reports-empty');

document.getElementById('r-date').valueAsDate = new Date();

reportForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const project_id = document.getElementById('r-project').value;
  if (!project_id) {
    alert('Add a project first.');
    return;
  }
  const payload = {
    report_date: document.getElementById('r-date').value,
    project_id,
    project_manager: document.getElementById('r-pm').value.trim() || null,
    bugsheet: document.getElementById('r-bugsheet').value.trim() || null,
    test_cases: Number(document.getElementById('r-testcases').value) || 0,
    ui_bugs: Number(document.getElementById('r-uibugs').value) || 0,
    functionality_bugs: Number(document.getElementById('r-funcbugs').value) || 0,
    remarks: document.getElementById('r-remarks').value.trim() || null,
    sign_off: document.getElementById('r-signoff').checked,
    notes: document.getElementById('r-notes').value.trim() || null,
  };
  const { error } = await sb.from('daily_reports').insert(payload);
  if (error) {
    alert(error.message);
    return;
  }
  reportForm.reset();
  document.getElementById('r-date').valueAsDate = new Date();
  loadReports();
});

document.getElementById('filter-project').addEventListener('change', loadReports);
document.getElementById('filter-date').addEventListener('change', loadReports);
document.getElementById('filter-clear').addEventListener('click', () => {
  document.getElementById('filter-project').value = '';
  document.getElementById('filter-date').value = '';
  loadReports();
});

async function loadReports() {
  let query = sb
    .from('daily_reports')
    .select('*, projects(name)')
    .order('report_date', { ascending: false })
    .order('created_at', { ascending: false });

  const projectId = document.getElementById('filter-project').value;
  const date = document.getElementById('filter-date').value;
  if (projectId) query = query.eq('project_id', projectId);
  if (date) query = query.eq('report_date', date);

  const { data, error } = await query;
  if (error) {
    console.error(error);
    return;
  }
  renderReports(data);
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
      const { error } = await sb.from('daily_reports').delete().eq('id', r.id);
      if (error) {
        alert(error.message);
        return;
      }
      loadReports();
    });
    reportsList.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
