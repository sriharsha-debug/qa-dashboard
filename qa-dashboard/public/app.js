const gate = document.getElementById('gate');
const app = document.getElementById('app');
const whoEmail = document.getElementById('who-email');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

let projectsCache = [];
let statusesCache = [];
let teamCache = [];
let currentUser = null;
let currentProfile = null;
let notifPollTimer = null;
let tcCache = [];
let reportsCache = [];

// ---------- Field color feedback (glass-water states) ----------

function flashFields(container, className, duration = 900) {
  if (!container) return;
  const fields = container.querySelectorAll('input, select, textarea');
  fields.forEach((f) => f.classList.add(className));
  setTimeout(() => fields.forEach((f) => f.classList.remove(className)), duration);
}

function flashRowRemoving(rowEl, delay = 220) {
  return new Promise((resolve) => {
    if (!rowEl) { resolve(); return; }
    rowEl.classList.add('row-removing');
    setTimeout(resolve, delay);
  });
}

// ---------- Supabase client + Auth ----------

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

sb.auth.onAuthStateChange((_event, session) => {
  if (session && session.user) {
    onLogin(session.user);
  } else {
    onLogout();
  }
});

let gateMode = 'signin';
const confirmPasswordInput = document.getElementById('login-password-confirm');
const gateSubmitBtn = document.getElementById('gate-submit-btn');
const loginSuccess = document.getElementById('login-success');

function setGateMode(mode) {
  gateMode = mode;
  loginError.classList.add('hidden');
  loginSuccess.classList.add('hidden');
  if (mode === 'signup') {
    confirmPasswordInput.classList.remove('hidden');
    confirmPasswordInput.required = true;
    gateSubmitBtn.textContent = 'Create account';
    document.getElementById('gate-toggle-signup').classList.add('hidden');
    document.getElementById('gate-toggle-signin').classList.remove('hidden');
    document.getElementById('gate-copy').textContent = 'Create your account to start logging your projects.';
  } else {
    confirmPasswordInput.classList.add('hidden');
    confirmPasswordInput.required = false;
    confirmPasswordInput.value = '';
    gateSubmitBtn.textContent = 'Sign in';
    document.getElementById('gate-toggle-signup').classList.remove('hidden');
    document.getElementById('gate-toggle-signin').classList.add('hidden');
    document.getElementById('gate-copy').textContent = 'Sign in with your email and password to open the ledger.';
  }
}

document.getElementById('show-signup').addEventListener('click', () => setGateMode('signup'));
document.getElementById('show-signin').addEventListener('click', () => setGateMode('signin'));

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  loginSuccess.classList.add('hidden');
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (gateMode === 'signup') {
    if (password.length < 6) {
      loginError.textContent = 'Password must be at least 6 characters.';
      loginError.classList.remove('hidden');
      flashFields(loginForm, 'field-error');
      return;
    }
    if (password !== confirmPasswordInput.value) {
      loginError.textContent = 'Passwords do not match.';
      loginError.classList.remove('hidden');
      flashFields(loginForm, 'field-error');
      return;
    }
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) {
      loginError.textContent = error.message;
      loginError.classList.remove('hidden');
      flashFields(loginForm, 'field-error');
      return;
    }
    if (data.session) {
      return; // signed in immediately; onAuthStateChange takes over
    }
    loginSuccess.textContent = 'Account created! Check your email to confirm it, then sign in.';
    loginSuccess.classList.remove('hidden');
    flashFields(loginForm, 'field-success');
    setGateMode('signin');
  } else {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      loginError.textContent = error.message;
      loginError.classList.remove('hidden');
      flashFields(loginForm, 'field-error');
    } else {
      flashFields(loginForm, 'field-success');
    }
  }
});

document.getElementById('logout').addEventListener('click', () => {
  if (notifPollTimer) clearInterval(notifPollTimer);
  sb.auth.signOut();
});

async function onLogin(user) {
  currentUser = user;
  whoEmail.textContent = user.email;
  gate.classList.add('hidden');
  app.classList.remove('hidden');
  await ensureProfile(user);
  loadStatuses().then(loadProjects);
  loadReports();
  loadTeam();
  refreshNotifications();
  if (notifPollTimer) clearInterval(notifPollTimer);
  notifPollTimer = setInterval(refreshNotifications, 25000);
}

function onLogout() {
  gate.classList.remove('hidden');
  app.classList.add('hidden');
  currentUser = null;
  currentProfile = null;
  if (notifPollTimer) clearInterval(notifPollTimer);
}

// ---------- Profile / roles ----------

async function ensureProfile(user) {
  const { data: existing } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (existing) {
    currentProfile = existing;
  } else {
    // First person to ever sign in becomes the leader automatically.
    const { count } = await sb.from('profiles').select('*', { count: 'exact', head: true });
    const role = (count || 0) === 0 ? 'leader' : 'member';
    const { data: created, error } = await sb
      .from('profiles')
      .insert({ id: user.id, email: user.email, display_name: user.email.split('@')[0], role })
      .select()
      .single();
    if (error) {
      console.error(error);
      return;
    }
    currentProfile = created;
  }
  const roleBadge = document.getElementById('who-role');
  roleBadge.textContent = currentProfile.role;
  roleBadge.classList.remove('hidden');
}

function isLeader() {
  return currentProfile && currentProfile.role === 'leader';
}

function actorLabel() {
  if (currentProfile && currentProfile.display_name) return currentProfile.display_name;
  if (currentUser) return currentUser.email;
  return 'Someone';
}

// ---------- Notifications ----------

async function notify(message, entityType, action) {
  if (!currentUser) return;
  try {
    await sb.from('notifications').insert({
      actor_id: currentUser.id,
      actor_email: currentUser.email,
      message,
      entity_type: entityType,
      action,
    });
  } catch (err) {
    console.error(err);
  }
  refreshNotifications();
}

async function refreshNotifications() {
  const { data, error } = await sb
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) {
    console.error(error);
    return;
  }
  renderNotifications(data);

  const since = currentProfile ? currentProfile.last_seen_notifications_at : null;
  const unread = data.filter((n) => n.actor_id !== (currentUser && currentUser.id) && (!since || new Date(n.created_at) > new Date(since)));
  const badge = document.getElementById('notif-badge');
  if (unread.length) {
    badge.textContent = unread.length > 9 ? '9+' : String(unread.length);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function renderNotifications(items) {
  const list = document.getElementById('notif-list');
  const empty = document.getElementById('notif-empty');
  list.innerHTML = '';
  empty.style.display = items.length ? 'none' : 'block';
  items.forEach((n) => {
    const row = document.createElement('div');
    row.className = 'notif-item';
    row.innerHTML = `
      <div>${escapeHtml(n.message)}</div>
      <span class="notif-item-time">${escapeHtml(n.actor_email || '')} · ${timeAgo(n.created_at)}</span>
    `;
    list.appendChild(row);
  });
}

const notifBell = document.getElementById('notif-bell');
const notifPanel = document.getElementById('notif-panel');

notifBell.addEventListener('click', async (e) => {
  e.stopPropagation();
  notifPanel.classList.toggle('hidden');
  if (!notifPanel.classList.contains('hidden') && currentUser) {
    const nowIso = new Date().toISOString();
    await sb.from('profiles').update({ last_seen_notifications_at: nowIso }).eq('id', currentUser.id);
    if (currentProfile) currentProfile.last_seen_notifications_at = nowIso;
    document.getElementById('notif-badge').classList.add('hidden');
  }
});
document.addEventListener('click', (e) => {
  if (!notifPanel.contains(e.target) && e.target !== notifBell) {
    notifPanel.classList.add('hidden');
  }
});

// ---------- Team tab ----------

async function loadTeam() {
  const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: true });
  if (error) {
    console.error(error);
    return;
  }
  teamCache = data;
  renderTeam(data);
  renderAdminFilters(data);
}

function renderAdminFilters(members) {
  const projectsFilter = document.getElementById('admin-filter-projects');
  const reportsFilter = document.getElementById('admin-filter-reports');
  const ownerColHead = document.getElementById('owner-col-head');

  if (!isLeader()) {
    projectsFilter.classList.add('hidden');
    reportsFilter.classList.add('hidden');
    ownerColHead.classList.add('hidden');
    return;
  }

  const opts = '<option value="">All testers</option>' +
    members.map((m) => `<option value="${escapeHtml(m.email)}">${escapeHtml(m.display_name || m.email)}</option>`).join('');
  projectsFilter.innerHTML = opts;
  reportsFilter.innerHTML = opts;
  projectsFilter.classList.remove('hidden');
  reportsFilter.classList.remove('hidden');
  ownerColHead.classList.remove('hidden');
}

document.getElementById('admin-filter-projects').addEventListener('change', () => renderProjects(projectsCache));
document.getElementById('admin-filter-reports').addEventListener('change', () => loadReports());

function renderTeam(members) {
  const list = document.getElementById('team-list');
  const count = document.getElementById('team-count');
  count.textContent = members.length ? `${members.length} member${members.length === 1 ? '' : 's'}` : '';
  list.innerHTML = '';
  members.forEach((m) => {
    const row = document.createElement('div');
    row.className = 'team-row';
    const canEdit = isLeader() && currentUser && m.id !== currentUser.id;
    row.innerHTML = `
      <div class="team-row-main">
        <span class="team-row-name">${escapeHtml(m.display_name || m.email)}</span>
        <span class="team-row-email">${escapeHtml(m.email)}</span>
      </div>
      ${canEdit
        ? `<select class="team-role-select" data-id="${m.id}">
             <option value="member" ${m.role === 'member' ? 'selected' : ''}>Member</option>
             <option value="leader" ${m.role === 'leader' ? 'selected' : ''}>Leader</option>
           </select>`
        : `<span class="role-badge">${escapeHtml(m.role)}</span>`}
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('.team-role-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const { error } = await sb.from('profiles').update({ role: sel.value }).eq('id', sel.dataset.id);
      if (error) {
        alert(error.message);
        return;
      }
      loadTeam();
    });
  });
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
  renderDetailsSelect();
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
  const adminFilter = document.getElementById('admin-filter-projects').value;
  const filtered = isLeader() && adminFilter
    ? projects.filter((p) => p.created_by_email === adminFilter)
    : projects;

  projectsTbody.innerHTML = '';
  projectCount.textContent = filtered.length ? `${filtered.length} total` : '';
  projectsEmpty.style.display = filtered.length ? 'none' : 'block';

  const statusOptions = statusesCache
    .map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`)
    .join('');

  const showOwner = isLeader();

  filtered.forEach((p, i) => {
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
      ${showOwner ? `<td>${escapeHtml(p.created_by_email || '—')}</td>` : ''}
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
      const p = projectsCache.find((x) => x.id === sel.dataset.id);
      const { error } = await sb
        .from('projects')
        .update({
          status: sel.value,
          updated_at: new Date().toISOString(),
          updated_by_email: currentUser ? currentUser.email : null,
        })
        .eq('id', sel.dataset.id);
      if (error) {
        alert(error.message);
        return;
      }
      notify(`${actorLabel()} changed "${p ? p.name : 'a project'}" status to ${sel.value}`, 'project', 'status_change');
      loadProjects();
    });
  });

  projectsTbody.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const p = projectsCache.find((x) => x.id === btn.dataset.delete);
      if (!confirm('Remove this project and all its daily entries?')) return;
      await flashRowRemoving(btn.closest('tr'));
      const { error } = await sb.from('projects').delete().eq('id', btn.dataset.delete);
      if (error) {
        alert(error.message);
        return;
      }
      notify(`${actorLabel()} removed project "${p ? p.name : ''}"`, 'project', 'delete');
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

if (statusForm) statusForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFormError('status-error');
  const name = document.getElementById('new-status-name').value.trim();
  const color = document.getElementById('new-status-color').value;
  if (!name || name.length < 2) {
    showFormError('status-error', 'Status name must be at least 2 characters.');
    return;
  }
  if (statusesCache.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    showFormError('status-error', 'A status with that name already exists.');
    return;
  }
  const { count } = await sb.from('statuses').select('*', { count: 'exact', head: true });
  const { error } = await sb.from('statuses').insert({ name, color, sort_order: count || 0 });
  if (error) {
    showFormError('status-error', error.message);
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
  if (!statusesListEl) return;
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
  project_document: 'edit-project-document',
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
  clearFormError('edit-error');
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
  clearFormError('edit-error');
  const id = document.getElementById('edit-id').value;

  const payload = {};
  Object.entries(modalFieldIds).forEach(([key, elId]) => {
    const val = document.getElementById(elId).value.trim();
    payload[key] = val || null;
  });

  // ---- Validation ----
  if (!payload.name || payload.name.length < 2) {
    showFormError('edit-error', 'Project name must be at least 2 characters.');
    flashFields(editForm, 'field-error');
    return;
  }
  if (!isValidUrl(payload.bugsheet)) {
    showFormError('edit-error', 'Bugsheet link must be a valid http(s) URL, or leave it blank.');
    flashFields(editForm, 'field-error');
    return;
  }
  if (!isValidUrl(payload.project_document)) {
    showFormError('edit-error', 'Project document must be a valid http(s) URL, or leave it blank.');
    flashFields(editForm, 'field-error');
    return;
  }
  if (!isValidDateRange(payload.start_date, payload.end_date)) {
    showFormError('edit-error', 'End date cannot be before start date.');
    flashFields(editForm, 'field-error');
    return;
  }
  if (!isValidDateRange(payload.ui_testing_start_date, payload.ui_testing_end_date)) {
    showFormError('edit-error', 'UI testing end date cannot be before its start date.');
    flashFields(editForm, 'field-error');
    return;
  }
  if (!isValidDateRange(payload.functional_testing_start_date, payload.functional_testing_end_date)) {
    showFormError('edit-error', 'Functional testing end date cannot be before its start date.');
    flashFields(editForm, 'field-error');
    return;
  }

  if (!payload.status) payload.status = statusesCache[0] ? statusesCache[0].name : 'Not Started';

  if (id) {
    payload.updated_at = new Date().toISOString();
    payload.updated_by_email = currentUser ? currentUser.email : null;
    const { error } = await sb.from('projects').update(payload).eq('id', id);
    if (error) {
      showFormError('edit-error', error.message);
      flashFields(editForm, 'field-error');
      return;
    }
    notify(`${actorLabel()} updated project "${payload.name}"`, 'project', 'update');
    flashFields(editForm, 'field-success');
  } else {
    payload.created_by_email = currentUser ? currentUser.email : null;
    payload.owner_id = currentUser ? currentUser.id : null;
    const { error } = await sb.from('projects').insert(payload);
    if (error) {
      showFormError('edit-error', error.message);
      flashFields(editForm, 'field-error');
      return;
    }
    notify(`${actorLabel()} added a new project: "${payload.name}"`, 'project', 'create');
    flashFields(editForm, 'field-success');
    celebrate(`"${payload.name}" added!`, '🚀');
  }
  closeEditModal();
  loadProjects();
});

editDeleteBtn.addEventListener('click', async () => {
  const id = document.getElementById('edit-id').value;
  if (!id) return;
  const p = projectsCache.find((x) => x.id === id);
  if (!confirm('Remove this project and all its daily entries?')) return;
  flashFields(editForm, 'field-removing', 250);
  await new Promise((r) => setTimeout(r, 220));
  const { error } = await sb.from('projects').delete().eq('id', id);
  if (error) {
    alert(error.message);
    return;
  }
  notify(`${actorLabel()} removed project "${p ? p.name : ''}"`, 'project', 'delete');
  closeEditModal();
  loadProjects();
  loadReports();
});

// ---------- Project Details tab ----------

const detailsSelect = document.getElementById('details-project-select');
const detailsEmpty = document.getElementById('details-empty');
const detailsContent = document.getElementById('details-content');
const detailsName = document.getElementById('details-name');
const detailsFields = document.getElementById('details-fields');
const detailsEditBtn = document.getElementById('details-edit-btn');
const apkForm = document.getElementById('apk-form');
const apkList = document.getElementById('apk-list');
const apkEmpty = document.getElementById('apk-empty');
const apkCount = document.getElementById('apk-count');

document.getElementById('apk-date').valueAsDate = new Date();

const detailFieldGroups = [
  { label: 'Group', span2: true, isHeader: true, title: 'Overview' },
  { key: 'status', label: 'Status' },
  { key: 'project_manager', label: 'Project manager' },
  { key: 'bugsheet', label: 'Bugsheet', isLink: true },
  { key: 'project_document', label: 'Project document', isLink: true, span2: true },
  { isHeader: true, title: 'Timeline' },
  { key: 'start_date', label: 'Start date', isDate: true },
  { key: 'end_date', label: 'End date', isDate: true },
  { key: 'kt_date', label: 'KT date', isDate: true },
  { key: 'sign_off_date', label: 'Sign off date', isDate: true },
  { isHeader: true, title: 'Testing schedule' },
  { key: 'ui_testing_start_date', label: 'UI testing start', isDate: true },
  { key: 'ui_testing_end_date', label: 'UI testing end', isDate: true },
  { key: 'functional_testing_start_date', label: 'Functional testing start', isDate: true },
  { key: 'functional_testing_end_date', label: 'Functional testing end', isDate: true },
  { isHeader: true, title: 'Team' },
  { key: 'mobile_app_developers', label: 'Mobile app developers' },
  { key: 'web_developers', label: 'Web developers' },
  { key: 'backend_developers', label: 'Backend developers', span2: true },
  { isHeader: true, title: 'Review' },
  { key: 'clients_review', label: 'Clients review', span2: true },
  { key: 'remarks', label: 'Remarks', span2: true },
  { key: 'created_by_email', label: 'Created by' },
  { key: 'updated_by_email', label: 'Last updated by' },
];

function renderDetailsSelect() {
  const opts = projectsCache.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  detailsSelect.innerHTML = opts;
  if (!projectsCache.length) {
    detailsEmpty.classList.remove('hidden');
    detailsContent.classList.add('hidden');
    return;
  }
  detailsEmpty.classList.add('hidden');
  const keep = projectsCache.find((p) => p.id === detailsSelect.dataset.current);
  const targetId = keep ? keep.id : projectsCache[0].id;
  detailsSelect.value = targetId;
  showProjectDetails(targetId);
}

detailsSelect.addEventListener('change', () => showProjectDetails(detailsSelect.value));

async function showProjectDetails(id) {
  const p = projectsCache.find((x) => x.id === id);
  if (!p) return;
  detailsSelect.dataset.current = id;
  detailsContent.classList.remove('hidden');
  detailsName.textContent = p.name;

  const { data: latestRows } = await sb
    .from('apk_shares')
    .select('*')
    .eq('project_id', id)
    .order('shared_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1);
  const latestApk = latestRows && latestRows[0];
  const latestApkHtml = latestApk
    ? `
      <div class="detail-item span-2">
        <span class="detail-label">Latest APK</span>
        <span class="detail-value">
          ${escapeHtml(latestApk.version || 'Build')} — shared ${fmtDate(latestApk.shared_date)}
          ${latestApk.shared_by ? ` by ${escapeHtml(latestApk.shared_by)}` : ''}
          ${latestApk.apk_link ? ` — <a class="bugsheet-link" href="${escapeHtml(latestApk.apk_link)}" target="_blank" rel="noopener">open link</a>` : ''}
        </span>
      </div>
    `
    : `
      <div class="detail-item span-2">
        <span class="detail-label">Latest APK</span>
        <span class="detail-value empty">None shared yet</span>
      </div>
    `;

  let html = '';
  let insertedApk = false;
  detailFieldGroups.forEach((f) => {
    if (f.isHeader) {
      if (f.title === 'Timeline' && !insertedApk) {
        html += latestApkHtml;
        insertedApk = true;
      }
      html += `<p class="span-2 section-label" style="grid-column:span 2;">${escapeHtml(f.title)}</p>`;
      return;
    }
    const raw = p[f.key];
    let valueHtml;
    if (!raw) {
      valueHtml = `<span class="detail-value empty">Not set</span>`;
    } else if (f.isDate) {
      valueHtml = `<span class="detail-value">${fmtDate(raw)}</span>`;
    } else if (f.isLink) {
      valueHtml = `<a class="bugsheet-link" href="${escapeHtml(raw)}" target="_blank" rel="noopener">${escapeHtml(raw)}</a>`;
    } else {
      valueHtml = `<span class="detail-value">${escapeHtml(raw)}</span>`;
    }
    html += `
      <div class="detail-item${f.span2 ? ' span-2' : ''}">
        <span class="detail-label">${escapeHtml(f.label)}</span>
        ${valueHtml}
      </div>
    `;
  });
  detailsFields.innerHTML = html;

  detailsEditBtn.onclick = () => openEditModal(id);

  loadApkShares(id);
  loadTestCases(id);
}

// ---------- Test execution ----------

const tcForm = document.getElementById('tc-form');
const tcList = document.getElementById('tc-list');
const tcEmpty = document.getElementById('tc-empty');
const tcSummary = document.getElementById('tc-summary');

function tcStatusColor(status) {
  return { 'Not Run': '#7FA0A6', Pass: '#34D399', Fail: '#F87171', Blocked: '#FBBF24' }[status] || '#7FA0A6';
}

tcForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFormError('tc-error');
  const project_id = detailsSelect.value;
  if (!project_id) return;

  const title = document.getElementById('tc-title').value.trim();
  if (!title || title.length < 3) {
    showFormError('tc-error', 'Test case title must be at least 3 characters.');
    flashFields(tcForm, 'field-error');
    return;
  }

  const status = document.getElementById('tc-status').value;
  const payload = {
    project_id,
    title,
    priority: document.getElementById('tc-priority').value,
    category: document.getElementById('tc-category').value,
    status,
    description: document.getElementById('tc-description').value.trim() || null,
    last_run_date: status === 'Not Run' ? null : todayStr(),
    owner_id: currentUser ? currentUser.id : null,
  };
  const { error } = await sb.from('test_cases').insert(payload);
  if (error) {
    showFormError('tc-error', error.message);
    flashFields(tcForm, 'field-error');
    return;
  }
  const proj = projectsCache.find((p) => p.id === project_id);
  notify(`${actorLabel()} added a test case for "${proj ? proj.name : 'a project'}"`, 'test_case', 'create');
  celebrate('Test case added!', '✅');
  flashFields(tcForm, 'field-success');
  tcForm.reset();
  document.getElementById('tc-priority').value = 'Medium';
  document.getElementById('tc-category').value = 'Functional';
  document.getElementById('tc-status').value = 'Not Run';
  loadTestCases(project_id);
});

async function loadTestCases(projectId) {
  const { data, error } = await sb
    .from('test_cases')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error(error);
    return;
  }
  renderTestCases(data, projectId);
  tcCache = data || [];
}

function renderTestCases(cases, projectId) {
  tcList.innerHTML = '';
  tcEmpty.style.display = cases.length ? 'none' : 'block';

  const counts = { 'Not Run': 0, Pass: 0, Fail: 0, Blocked: 0 };
  const catCounts = {};
  cases.forEach((c) => {
    counts[c.status] = (counts[c.status] || 0) + 1;
    const cat = c.category || 'Functional';
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  });
  const catBreakdown = Object.entries(catCounts).map(([cat, n]) => `${cat}: ${n}`).join(' · ');
  tcSummary.textContent = cases.length
    ? `${cases.length} total · ${counts.Pass} pass · ${counts.Fail} fail · ${counts.Blocked} blocked · ${counts['Not Run']} not run — ${catBreakdown}`
    : '';

  cases.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'tc-row';
    row.innerHTML = `
      <div class="tc-row-top">
        <div>
          <div class="tc-row-title">${escapeHtml(c.title)}</div>
          <div class="tc-row-meta">
            <span class="priority-pill priority-${escapeHtml(c.priority || 'Medium')}">${escapeHtml(c.priority || 'Medium')}</span>
            <span class="pill" style="${pillStyle(categoryColor(c.category || 'Functional'))}">${escapeHtml(c.category || 'Functional')}</span>
            ${c.last_run_date ? `<span>Last run ${fmtDate(c.last_run_date)}</span>` : '<span>Not run yet</span>'}
          </div>
          ${c.description ? `<div class="tc-row-desc">${escapeHtml(c.description)}</div>` : ''}
        </div>
        <div class="tc-row-actions">
          <select class="status-select pill tc-status-select" style="${pillStyle(tcStatusColor(c.status))}" data-id="${c.id}">
            ${['Not Run', 'Pass', 'Fail', 'Blocked'].map((s) => `<option value="${s}" ${s === c.status ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          <button class="icon-btn" data-tc-delete="${c.id}">remove</button>
        </div>
      </div>
    `;
    tcList.appendChild(row);
  });

  tcList.querySelectorAll('.tc-status-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const newStatus = sel.value;
      const { error } = await sb
        .from('test_cases')
        .update({
          status: newStatus,
          last_run_date: newStatus === 'Not Run' ? null : todayStr(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', sel.dataset.id);
      if (error) {
        alert(error.message);
        return;
      }
      if (newStatus === 'Pass') celebrate('Nice, that passed!', '💪');
      loadTestCases(projectId);
    });
  });

  tcList.querySelectorAll('[data-tc-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this test case?')) return;
      await flashRowRemoving(btn.closest('.tc-row'));
      const { error } = await sb.from('test_cases').delete().eq('id', btn.dataset.tcDelete);
      if (error) {
        alert(error.message);
        return;
      }
      loadTestCases(projectId);
    });
  });
}

// ---------- APK shares ----------

apkForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFormError('apk-error');
  const project_id = detailsSelect.value;
  if (!project_id) return;

  const sharedDate = document.getElementById('apk-date').value;
  if (!sharedDate) {
    showFormError('apk-error', 'Shared date is required.');
    flashFields(apkForm, 'field-error');
    return;
  }
  const apkLinkVal = document.getElementById('apk-link').value.trim();
  if (!isValidUrl(apkLinkVal)) {
    showFormError('apk-error', 'APK link must be a valid http(s) URL, or leave it blank.');
    flashFields(apkForm, 'field-error');
    return;
  }

  const payload = {
    project_id,
    version: document.getElementById('apk-version').value.trim() || null,
    apk_link: apkLinkVal || null,
    shared_date: sharedDate,
    shared_by: document.getElementById('apk-shared-by').value.trim() || null,
    notes: document.getElementById('apk-notes').value.trim() || null,
    logged_by_email: currentUser ? currentUser.email : null,
    owner_id: currentUser ? currentUser.id : null,
  };
  const { error } = await sb.from('apk_shares').insert(payload);
  if (error) {
    showFormError('apk-error', error.message);
    flashFields(apkForm, 'field-error');
    return;
  }
  const proj = projectsCache.find((p) => p.id === project_id);
  notify(`${actorLabel()} shared an APK (${payload.version || 'build'}) for "${proj ? proj.name : 'a project'}"`, 'apk', 'create');
  celebrate('APK logged!', '📦');
  flashFields(apkForm, 'field-success');
  apkForm.reset();
  document.getElementById('apk-date').valueAsDate = new Date();
  showProjectDetails(project_id);
});

async function loadApkShares(projectId) {
  const { data, error } = await sb
    .from('apk_shares')
    .select('*')
    .eq('project_id', projectId)
    .order('shared_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) {
    console.error(error);
    return;
  }
  renderApkShares(data);
}

function renderApkShares(shares) {
  apkList.innerHTML = '';
  apkCount.textContent = shares.length ? `${shares.length} logged` : '';
  apkEmpty.style.display = shares.length ? 'none' : 'block';

  shares.forEach((a) => {
    const row = document.createElement('div');
    row.className = 'apk-row';
    row.innerHTML = `
      <div class="apk-row-main">
        <div class="apk-row-top">
          <span class="apk-version">${escapeHtml(a.version || 'Build')}</span>
          <span>${fmtDate(a.shared_date)}</span>
          ${a.shared_by ? `<span>by ${escapeHtml(a.shared_by)}</span>` : ''}
        </div>
        ${a.apk_link ? `<a class="bugsheet-link" href="${escapeHtml(a.apk_link)}" target="_blank" rel="noopener">Download / link</a>` : ''}
        ${a.notes ? `<div class="apk-row-notes">${escapeHtml(a.notes)}</div>` : ''}
      </div>
      <button class="icon-btn" data-apk-delete="${a.id}">remove</button>
    `;
    row.querySelector('[data-apk-delete]').addEventListener('click', async () => {
      if (!confirm('Remove this APK log entry?')) return;
      await flashRowRemoving(row);
      const { error } = await sb.from('apk_shares').delete().eq('id', a.id);
      if (error) {
        alert(error.message);
        return;
      }
      showProjectDetails(detailsSelect.value);
    });
    apkList.appendChild(row);
  });
}

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function buildBatchWhatsAppMessage(reports, dateStr) {
  const niceDate = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB');
  let msg = `*QA Daily Updates — ${niceDate}*\n`;
  msg += `_${reports.length} project${reports.length === 1 ? '' : 's'} updated_\n`;

  reports.forEach((r, i) => {
    const projectName = r.projects ? r.projects.name : 'Project';
    msg += `\n*${i + 1}. ${projectName}*\n`;
    if (r.project_manager) msg += `• PM: ${r.project_manager}\n`;
    if (r.assigned_tasks) msg += `• Assigned Tasks:\n${r.assigned_tasks}\n`;
    msg += `• Test Cases: ${r.test_cases}  • UI Bugs: ${r.ui_bugs}  • Func Bugs: ${r.functionality_bugs}\n`;
    if (r.bugsheet) msg += `• Bugsheet: ${r.bugsheet}\n`;
    msg += `• Sign Off: ${r.sign_off ? 'Yes' : 'No'}\n`;
    if (r.remarks) msg += `• Remarks: ${r.remarks}\n`;
    if (r.notes) msg += `• Notes: ${r.notes}\n`;
  });

  return msg;
}

document.getElementById('share-day-btn').addEventListener('click', async () => {
  const dateStr = document.getElementById('filter-date').value || todayStr();
  const projectId = document.getElementById('filter-project').value;

  let query = sb
    .from('daily_reports')
    .select('*, projects(name)')
    .eq('report_date', dateStr)
    .order('created_at', { ascending: true });
  if (projectId) query = query.eq('project_id', projectId);

  const { data, error } = await query;
  if (error) {
    alert(error.message);
    return;
  }
  if (!data || !data.length) {
    alert(`No daily entries found for ${new Date(dateStr + 'T00:00:00').toLocaleDateString()}. Log an entry first, or pick a different date in the filter above.`);
    return;
  }

  const message = buildBatchWhatsAppMessage(data, dateStr);
  whatsappMessageEl.value = message;
  whatsappOpenLink.href = `https://wa.me/?text=${encodeURIComponent(message)}`;
  whatsappCopyBtn.textContent = 'Copy message';
  whatsappModal.classList.remove('hidden');
});

// ---------- AI test case generation (free — copy prompt, paste reply) ----------

const aiDocText = document.getElementById('ai-doc-text');
const aiResponseText = document.getElementById('ai-response-text');
const aiCopyPromptBtn = document.getElementById('ai-copy-prompt');
const aiParseBtn = document.getElementById('ai-parse-btn');
const aiPreview = document.getElementById('ai-preview');
const aiPreviewList = document.getElementById('ai-preview-list');
let aiGeneratedCases = [];

function buildAiPrompt(projectName, documentText) {
  return `You are an expert QA test case writer preparing test cases for real-world, production use — as if a market end user will actually use this feature. Based on the requirements/document text below for the project "${projectName || 'this project'}", generate a THOROUGH, comprehensive set of manual test cases.

You must cover these categories as relevant, not just the happy path — spread the test cases across them realistically based on what the document supports:
- Functional — each distinct feature or requirement verified individually
- Positive — valid inputs, normal expected usage, typical end-user flows
- Negative — invalid inputs, wrong formats, missing required fields, unauthorized access, error handling
- Edge Case — boundary values, empty/null inputs, maximum length/limits, special characters, duplicate submissions, concurrent actions
- Security — auth bypass attempts, injection, data exposure, permission checks, session handling
- Validation — field-level input validation, format checks, required-field enforcement
- UI/UX — layout, responsiveness, clarity of feedback/errors, navigation flow
- Performance — load times, behavior under slow/no network, large data sets
- Accessibility — screen reader support, keyboard navigation, color contrast, labels
- Compatibility — different devices, browsers, OS versions, screen sizes
- Regression — verifying existing related functionality still works after this change
- UAT — end-to-end scenarios matching real acceptance criteria a client/user would check

Respond with ONLY a JSON array, no prose, no markdown fences, in this exact shape:
[{"title": "short test case title", "description": "steps or scenario to verify, 1-3 sentences", "priority": "Low"|"Medium"|"High", "category": "Functional"|"Positive"|"Negative"|"Edge Case"|"Security"|"Validation"|"UI/UX"|"Performance"|"Accessibility"|"Compatibility"|"Regression"|"UAT"}]

Aim for thorough coverage — typically 20-40 test cases depending on document size and complexity — distributed across the categories that are actually relevant to this document (not every category applies to every feature). Keep titles concise and descriptions actionable.

Document:
"""
${documentText}
"""`;
}

aiCopyPromptBtn.addEventListener('click', async () => {
  clearFormError('ai-gen-error');
  const project = projectsCache.find((p) => p.id === detailsSelect.value);
  const documentText = aiDocText.value.trim();
  if (!documentText) {
    showFormError('ai-gen-error', 'Paste some requirements or document text above first.');
    return;
  }
  const prompt = buildAiPrompt(project ? project.name : '', documentText);
  try {
    await navigator.clipboard.writeText(prompt);
  } catch {
    showFormError('ai-gen-error', 'Could not copy automatically — select the text manually if needed.');
    return;
  }
  const original = aiCopyPromptBtn.textContent;
  aiCopyPromptBtn.textContent = 'Copied ✓ — now click Open Claude.ai';
  setTimeout(() => { aiCopyPromptBtn.textContent = original; }, 2500);
});

aiParseBtn.addEventListener('click', () => {
  clearFormError('ai-gen-error');
  aiPreview.classList.add('hidden');
  let raw = aiResponseText.value.trim();
  if (!raw) {
    showFormError('ai-gen-error', 'Paste the AI\'s reply above first.');
    return;
  }
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    raw = raw.slice(start, end + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    showFormError('ai-gen-error', 'Could not read that as JSON. Make sure you pasted the AI\'s full reply, including the [ ] brackets.');
    return;
  }
  if (!Array.isArray(parsed) || !parsed.length) {
    showFormError('ai-gen-error', 'That didn\'t look like a list of test cases. Try again.');
    return;
  }

  aiGeneratedCases = parsed
    .filter((t) => t && t.title)
    .map((t) => ({
      title: String(t.title).slice(0, 200),
      description: t.description ? String(t.description).slice(0, 1000) : null,
      priority: ['Low', 'Medium', 'High'].includes(t.priority) ? t.priority : 'Medium',
      category: [
        'Functional', 'Positive', 'Negative', 'Edge Case', 'Security',
        'Validation', 'UI/UX', 'Performance', 'Accessibility',
        'Compatibility', 'Regression', 'UAT',
      ].includes(t.category) ? t.category : 'Functional',
    }));

  if (!aiGeneratedCases.length) {
    showFormError('ai-gen-error', 'No valid test cases found in that reply.');
    return;
  }
  renderAiPreview(aiGeneratedCases);
});

function categoryColor(cat) {
  return {
    Functional: '#22D3EE',
    Positive: '#34D399',
    Negative: '#F87171',
    'Edge Case': '#FBBF24',
    Security: '#EF4444',
    Validation: '#60A5FA',
    'UI/UX': '#A78BFA',
    Performance: '#FB923C',
    Accessibility: '#2DD4BF',
    Compatibility: '#818CF8',
    Regression: '#F472B6',
    UAT: '#FACC15',
  }[cat] || '#7FA0A6';
}

function renderAiPreview(cases) {
  aiPreviewList.innerHTML = '';

  const counts = {};
  cases.forEach((c) => { counts[c.category] = (counts[c.category] || 0) + 1; });
  const summaryEl = document.createElement('p');
  summaryEl.className = 'ai-coverage-summary';
  summaryEl.textContent = `${cases.length} test cases — ` +
    Object.entries(counts).map(([cat, n]) => `${cat}: ${n}`).join(' · ');
  aiPreviewList.appendChild(summaryEl);

  cases.forEach((c, i) => {
    const row = document.createElement('label');
    row.className = 'ai-preview-item';
    row.innerHTML = `
      <input type="checkbox" class="ai-preview-check" data-idx="${i}" checked />
      <div>
        <div class="ai-preview-item-title">
          ${escapeHtml(c.title)}
          <span class="priority-pill priority-${escapeHtml(c.priority)}">${escapeHtml(c.priority)}</span>
          <span class="pill" style="${pillStyle(categoryColor(c.category))}">${escapeHtml(c.category)}</span>
        </div>
        ${c.description ? `<div class="ai-preview-item-desc">${escapeHtml(c.description)}</div>` : ''}
      </div>
    `;
    aiPreviewList.appendChild(row);
  });
  aiPreview.classList.remove('hidden');
}

document.getElementById('ai-discard').addEventListener('click', () => {
  aiGeneratedCases = [];
  aiPreview.classList.add('hidden');
  aiDocText.value = '';
  aiResponseText.value = '';
});

document.getElementById('ai-add-selected').addEventListener('click', async () => {
  const projectId = detailsSelect.value;
  const checks = aiPreviewList.querySelectorAll('.ai-preview-check');
  const selected = [];
  checks.forEach((cb) => {
    if (cb.checked) selected.push(aiGeneratedCases[Number(cb.dataset.idx)]);
  });
  if (!selected.length) return;

  const rows = selected.map((c) => ({
    project_id: projectId,
    title: c.title,
    description: c.description,
    priority: c.priority,
    category: c.category,
    status: 'Not Run',
    owner_id: currentUser ? currentUser.id : null,
  }));

  const { error } = await sb.from('test_cases').insert(rows);
  if (error) {
    showFormError('ai-gen-error', error.message);
    return;
  }
  const project = projectsCache.find((p) => p.id === projectId);
  notify(`${actorLabel()} added ${rows.length} AI-suggested test case${rows.length === 1 ? '' : 's'} for "${project ? project.name : 'a project'}"`, 'test_case', 'ai_generate');
  celebrate(`${rows.length} test case${rows.length === 1 ? '' : 's'} added!`, '🤖');

  aiGeneratedCases = [];
  aiPreview.classList.add('hidden');
  aiDocText.value = '';
  aiResponseText.value = '';
  loadTestCases(projectId);
});

const reportForm = document.getElementById('report-form');
const reportsList = document.getElementById('reports-list');
const reportsEmpty = document.getElementById('reports-empty');

document.getElementById('r-date').valueAsDate = new Date();

// ---------- Task list widget ----------

let currentTasks = [''];
const taskListEl = document.getElementById('task-list');

function renderTaskList() {
  taskListEl.innerHTML = '';
  currentTasks.forEach((val, i) => {
    const row = document.createElement('div');
    row.className = 'task-row';
    row.innerHTML = `
      <span class="task-number">Task ${i + 1}</span>
      <input type="text" class="task-input" data-idx="${i}" maxlength="200" placeholder="What needs to be done" value="${escapeHtml(val)}" />
      ${currentTasks.length > 1 ? `<button type="button" class="icon-btn" data-remove-task="${i}">remove</button>` : ''}
    `;
    taskListEl.appendChild(row);
  });

  taskListEl.querySelectorAll('.task-input').forEach((input) => {
    input.addEventListener('input', () => {
      currentTasks[Number(input.dataset.idx)] = input.value;
    });
  });
  taskListEl.querySelectorAll('[data-remove-task]').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentTasks.splice(Number(btn.dataset.removeTask), 1);
      renderTaskList();
    });
  });
}

document.getElementById('add-task-btn').addEventListener('click', () => {
  currentTasks.push('');
  renderTaskList();
  const inputs = taskListEl.querySelectorAll('.task-input');
  inputs[inputs.length - 1]?.focus();
});

function tasksToText() {
  return currentTasks
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t, i) => `Task ${i + 1}: ${t}`)
    .join('\n');
}

function resetTaskList() {
  currentTasks = [''];
  renderTaskList();
}

renderTaskList();

reportForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFormError('report-error');
  const project_id = document.getElementById('r-project').value;
  if (!project_id) {
    showFormError('report-error', 'Select a project first (add one on the Projects tab if the list is empty).');
    flashFields(reportForm, 'field-error');
    return;
  }
  const reportDate = document.getElementById('r-date').value;
  if (!reportDate) {
    showFormError('report-error', 'Date is required.');
    flashFields(reportForm, 'field-error');
    return;
  }
  const bugsheetVal = document.getElementById('r-bugsheet').value.trim();
  const testCases = document.getElementById('r-testcases').value;
  const uiBugs = document.getElementById('r-uibugs').value;
  const funcBugs = document.getElementById('r-funcbugs').value;
  const numericFields = [
    ['Test cases', testCases],
    ['UI bugs', uiBugs],
    ['Functionality bugs', funcBugs],
  ];
  for (const [label, val] of numericFields) {
    if (val === '' || Number(val) < 0 || !Number.isInteger(Number(val))) {
      showFormError('report-error', `${label} must be a whole number, 0 or higher.`);
      flashFields(reportForm, 'field-error');
      return;
    }
  }

  const payload = {
    report_date: reportDate,
    project_id,
    project_manager: document.getElementById('r-pm').value.trim() || null,
    assigned_tasks: tasksToText() || null,
    bugsheet: bugsheetVal || null,
    test_cases: Number(testCases),
    ui_bugs: Number(uiBugs),
    functionality_bugs: Number(funcBugs),
    remarks: document.getElementById('r-remarks').value.trim() || null,
    sign_off: document.getElementById('r-signoff').checked,
    notes: document.getElementById('r-notes').value.trim() || null,
    logged_by_email: currentUser ? currentUser.email : null,
    owner_id: currentUser ? currentUser.id : null,
  };
  const { error } = await sb.from('daily_reports').insert(payload);
  if (error) {
    showFormError('report-error', error.message);
    flashFields(reportForm, 'field-error');
    return;
  }

  const project = projectsCache.find((p) => p.id === project_id);
  notify(`${actorLabel()} logged a daily update for "${project ? project.name : 'a project'}"`, 'daily_report', 'create');
  celebrate('Daily update saved!', '🎉');
  flashFields(reportForm, 'field-success');

  // Keep the project record in sync with the latest daily update
  const projectUpdates = {};
  if (payload.project_manager) projectUpdates.project_manager = payload.project_manager;
  if (payload.bugsheet) projectUpdates.bugsheet = payload.bugsheet;
  if (payload.remarks) projectUpdates.remarks = payload.remarks;
  if (payload.sign_off) projectUpdates.sign_off_date = payload.report_date;
  if (Object.keys(projectUpdates).length) {
    projectUpdates.updated_at = new Date().toISOString();
    projectUpdates.updated_by_email = currentUser ? currentUser.email : null;
    await sb.from('projects').update(projectUpdates).eq('id', project_id);
  }

  reportForm.reset();
  document.getElementById('r-date').valueAsDate = new Date();
  resetTaskList();
  loadReports();
  loadProjects();

  openWhatsAppModal(payload, project ? project.name : 'Project');
});

// ---------- WhatsApp daily update message ----------

const whatsappModal = document.getElementById('whatsapp-modal');
const whatsappMessageEl = document.getElementById('whatsapp-message');
const whatsappOpenLink = document.getElementById('whatsapp-open');
const whatsappCopyBtn = document.getElementById('whatsapp-copy');

function buildWhatsAppMessage(payload, projectName) {
  const dateStr = new Date(payload.report_date + 'T00:00:00').toLocaleDateString('en-GB');
  let msg = `*QA Daily Update*\n`;
  msg += `Date: ${dateStr}\n`;
  msg += `Project: ${projectName}\n`;
  if (payload.project_manager) msg += `• PM: ${payload.project_manager}\n`;
  if (payload.assigned_tasks) msg += `• Assigned Tasks:\n${payload.assigned_tasks}\n`;
  msg += `\n`;
  msg += `• Test Cases: ${payload.test_cases}\n`;
  msg += `• UI Bugs: ${payload.ui_bugs}\n`;
  msg += `• Functionality Bugs: ${payload.functionality_bugs}\n`;
  if (payload.bugsheet) msg += `• Bugsheet: ${payload.bugsheet}\n`;
  msg += `\n`;
  msg += `• Sign Off: ${payload.sign_off ? 'Yes' : 'No'}\n`;
  if (payload.remarks) msg += `• Remarks: ${payload.remarks}\n`;
  if (payload.notes) msg += `• Notes: ${payload.notes}\n`;
  return msg;
}

function openWhatsAppModal(payload, projectName) {
  const message = buildWhatsAppMessage(payload, projectName);
  whatsappMessageEl.value = message;
  whatsappOpenLink.href = `https://wa.me/?text=${encodeURIComponent(message)}`;
  whatsappCopyBtn.textContent = 'Copy message';
  whatsappModal.classList.remove('hidden');
}

document.getElementById('whatsapp-close').addEventListener('click', () => {
  whatsappModal.classList.add('hidden');
});
whatsappModal.addEventListener('click', (e) => {
  if (e.target === whatsappModal) whatsappModal.classList.add('hidden');
});

whatsappCopyBtn.addEventListener('click', async () => {
  const text = whatsappMessageEl.value;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    whatsappMessageEl.select();
    document.execCommand('copy');
  }
  whatsappCopyBtn.textContent = 'Copied ✓';
  setTimeout(() => {
    whatsappCopyBtn.textContent = 'Copy message';
  }, 1800);
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
  const adminEmail = document.getElementById('admin-filter-reports').value;
  if (projectId) query = query.eq('project_id', projectId);
  if (date) query = query.eq('report_date', date);
  if (isLeader() && adminEmail) query = query.eq('logged_by_email', adminEmail);

  const { data, error } = await query;
  if (error) {
    console.error(error);
    return;
  }
  renderReports(data);
  reportsCache = data || [];
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
        ${r.logged_by_email ? `<span>Logged by: ${escapeHtml(r.logged_by_email)}</span>` : ''}
      </div>
      <button class="icon-btn report-delete" data-delete="${r.id}">remove</button>
      <button class="icon-btn report-share" data-share="${r.id}">share</button>
      <div class="report-body">
        ${r.assigned_tasks ? `<div class="assigned-tasks"><span class="detail-label">Assigned tasks</span><div>${escapeHtml(r.assigned_tasks).replace(/\n/g, '<br>')}</div></div>` : ''}
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
      await flashRowRemoving(card);
      const { error } = await sb.from('daily_reports').delete().eq('id', r.id);
      if (error) {
        alert(error.message);
        return;
      }
      loadReports();
    });
    card.querySelector('[data-share]').addEventListener('click', () => {
      openWhatsAppModal(r, r.projects ? r.projects.name : 'Project');
    });
    reportsList.appendChild(card);
  });
}

// ---------- Celebration toasts ----------

let toastWrap = null;
function celebrate(message, emoji) {
  if (!toastWrap) {
    toastWrap = document.createElement('div');
    toastWrap.className = 'celebrate-toast-wrap';
    document.body.appendChild(toastWrap);
  }
  const toast = document.createElement('div');
  toast.className = 'celebrate-toast';
  toast.innerHTML = `<span class="celebrate-emoji">${emoji || '✨'}</span><span>${escapeHtml(message)}</span>`;
  toastWrap.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 300);
  }, 2200);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ---------- Validation helpers ----------

function isValidUrl(str) {
  if (!str) return true; // empty is fine, these fields are optional
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidDateRange(startVal, endVal) {
  if (!startVal || !endVal) return true; // only check when both are set
  return new Date(endVal) >= new Date(startVal);
}

function showFormError(elId, message) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

function clearFormError(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

// ---------- Download to Excel (.xlsx) ----------

function safeFileName(name) {
  return String(name || 'download').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function downloadSheet(filename, rows, sheetName) {
  if (!rows || !rows.length) {
    alert('Nothing to download yet.');
    return;
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'Sheet1').slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

// Projects tab → downloads only the projects ledger.
document.getElementById('download-projects-btn').addEventListener('click', () => {
  const rows = projectsCache.map((p) => ({
    'Project': p.name,
    'Status': p.status,
    'Project Manager': p.project_manager || '',
    'Start Date': p.start_date || '',
    'End Date': p.end_date || '',
    'Bugsheet': p.bugsheet || '',
    'Project Document': p.project_document || '',
    'KT Date': p.kt_date || '',
    'Sign Off Date': p.sign_off_date || '',
    'Remarks': p.remarks || '',
  }));
  downloadSheet('Projects', rows, 'Projects');
});

// Project Details tab → downloads only the currently selected project's full detail sheet.
document.getElementById('download-details-btn').addEventListener('click', () => {
  const id = detailsSelect.value;
  const p = projectsCache.find((x) => x.id === id);
  if (!p) {
    alert('Select a project first.');
    return;
  }
  const row = {};
  detailFieldGroups.forEach((f) => {
    if (f.isHeader) return;
    row[f.label] = p[f.key] || '';
  });
  downloadSheet(`${safeFileName(p.name)} - Project Details`, [row], 'Project Details');
});

// Test execution panel → downloads only the currently selected project's test cases.
document.getElementById('download-tc-btn').addEventListener('click', () => {
  const id = detailsSelect.value;
  const p = projectsCache.find((x) => x.id === id);
  const rows = tcCache.map((c) => ({
    'Title': c.title,
    'Priority': c.priority || '',
    'Category': c.category || '',
    'Status': c.status,
    'Last Run Date': c.last_run_date || '',
    'Description': c.description || '',
    'Notes': c.notes || '',
  }));
  downloadSheet(`${safeFileName(p ? p.name : 'Project')} - Test Cases`, rows, 'Test Cases');
});

// Daily Log tab (History) → downloads only the currently filtered daily logs.
document.getElementById('download-reports-btn').addEventListener('click', () => {
  const rows = reportsCache.map((r) => ({
    'Project': r.projects ? r.projects.name : '',
    'Date': r.report_date,
    'Project Manager': r.project_manager || '',
    'Assigned Tasks': r.assigned_tasks || '',
    'Test Cases': r.test_cases,
    'UI Bugs': r.ui_bugs,
    'Functionality Bugs': r.functionality_bugs,
    'Bugsheet': r.bugsheet || '',
    'Sign Off': r.sign_off ? 'Yes' : 'No',
    'Remarks': r.remarks || '',
    'Notes': r.notes || '',
    'Logged By': r.logged_by_email || '',
  }));
  downloadSheet('Daily Logs', rows, 'Daily Logs');
});

// ---------- Theme toggle (light/dark) ----------

(function () {
  const THEME_KEY = 'qa-dashboard-theme';
  const root = document.documentElement;
  const btns = [
    document.getElementById('theme-toggle'),
    document.getElementById('theme-toggle-gate'),
  ].filter(Boolean);

  function applyTheme(theme) {
    if (theme === 'light') {
      root.setAttribute('data-theme', 'light');
    } else {
      root.removeAttribute('data-theme');
    }
    btns.forEach((btn) => {
      btn.textContent = theme === 'light' ? '☀️' : '🌙';
    });
  }

  function getStoredTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch {
      return null;
    }
  }

  function setStoredTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore storage errors (e.g. private browsing) */
    }
  }

  const saved = getStoredTheme();
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(saved || (prefersLight ? 'light' : 'dark'));

  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const isLight = root.getAttribute('data-theme') === 'light';
      const next = isLight ? 'dark' : 'light';
      applyTheme(next);
      setStoredTheme(next);
    });
  });
})();
