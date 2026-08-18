const gate = document.getElementById('gate');
const app = document.getElementById('app');
const whoEmail = document.getElementById('who-email');
const whoName = document.getElementById('who-name');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

// Subtle, professional press feedback on every button in the app: a soft
// ripple expands from the click point and fades out. Delegated to one
// document-level listener so it works for buttons rendered dynamically on
// any tab, not just the ones present at page load.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const ripple = document.createElement('span');
  const size = Math.max(rect.width, rect.height) * 1.4;
  ripple.className = 'btn-ripple';
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
  btn.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
});

let projectsCache = [];
let statusesCache = [];
let teamCache = [];
let currentUser = null;
let currentProfile = null;
let notifPollTimer = null;
let tcCache = [];
let bugCache = [];
let reportsCache = [];
let auditCache = [];
let auditPageNum = 1;
const AUDIT_PAGE_SIZE = 20;

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

// ---------- Bulk select / select all / delete selected ----------
// Generic helper used by Projects, Test execution, Bugs, APK shares and
// Daily report History. Each list gets its own instance: a "select all"
// checkbox, per-row checkboxes (rendered by the list's own render function),
// and a "Delete selected" button that batch-deletes the checked rows.
//
// For paginated lists (Test execution, Bugs) only ~8 rows exist in the DOM
// at a time, so "select all" / the selection count must be based on the
// FULL underlying list (getAllIds), not just the checkboxes currently on
// screen — otherwise "select all" + delete would only ever touch one page.
function createBulkSelector({ checkboxSelector, selectAllId, deleteBtnId, table, itemLabel, getAllIds, onDeleted }) {
  const selected = new Set();
  const selectAllCb = document.getElementById(selectAllId);
  const deleteBtn = document.getElementById(deleteBtnId);

  function visibleCheckboxes() {
    return Array.from(document.querySelectorAll(checkboxSelector));
  }

  // All ids the list currently represents (every page), falling back to
  // whatever's on screen for non-paginated lists.
  function allIds() {
    return getAllIds ? getAllIds() : visibleCheckboxes().map((cb) => cb.dataset.id);
  }

  function updateUI() {
    const n = selected.size;
    if (deleteBtn) {
      deleteBtn.classList.toggle('hidden', n === 0);
      deleteBtn.textContent = n ? `Delete selected (${n})` : 'Delete selected';
    }
    if (selectAllCb) {
      const ids = allIds();
      const checkedCount = ids.filter((id) => selected.has(id)).length;
      selectAllCb.checked = ids.length > 0 && checkedCount === ids.length;
      selectAllCb.indeterminate = checkedCount > 0 && checkedCount < ids.length;
    }
  }

  // Call after every render (including a page change): syncs the checkboxes
  // currently in the DOM to the selection state, and drops any selected ids
  // that no longer exist anywhere in the underlying list (e.g. deleted
  // elsewhere / filtered out). Selections on OTHER pages are preserved.
  function onRendered() {
    const present = new Set(allIds());
    Array.from(selected).forEach((id) => {
      if (!present.has(id)) selected.delete(id);
    });
    visibleCheckboxes().forEach((cb) => {
      cb.checked = selected.has(cb.dataset.id);
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(cb.dataset.id);
        else selected.delete(cb.dataset.id);
        updateUI();
      });
    });
    updateUI();
  }

  if (selectAllCb) {
    selectAllCb.addEventListener('change', () => {
      const checked = selectAllCb.checked;
      const ids = allIds();
      if (checked) ids.forEach((id) => selected.add(id));
      else ids.forEach((id) => selected.delete(id));
      // Reflect the change on whichever checkboxes happen to be visible.
      visibleCheckboxes().forEach((cb) => { cb.checked = selected.has(cb.dataset.id); });
      updateUI();
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const ids = Array.from(selected);
      if (!ids.length) return;
      const label = itemLabel || 'item';
      if (!confirm(`Delete ${ids.length} selected ${label}${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
      deleteBtn.disabled = true;
      // Batch defensively in case a very large selection is made — Supabase's
      // .in() filter works fine at normal sizes, but this keeps requests small.
      const batchSize = 200;
      let error = null;
      for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        const res = await sb.from(table).delete().in('id', batch);
        if (res.error) { error = res.error; break; }
      }
      deleteBtn.disabled = false;
      if (error) {
        alert(error.message);
        return;
      }
      selected.clear();
      if (onDeleted) await onDeleted(ids);
    });
  }

  return { onRendered, selected };
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
  gate.classList.add('hidden');
  app.classList.remove('hidden');
  await ensureProfile(user);
  // Show the signed-in user's profile name beside Project Tracker.
  // Keep the signed-in email in its original top-right location.
  const headerName = (currentProfile && currentProfile.display_name)
    ? currentProfile.display_name
    : (user.email ? user.email.split('@')[0] : 'User');
  whoName.textContent = headerName;
  whoEmail.textContent = user.email || '';
  loadStatuses().then(loadProjects);
  loadReports();
  loadTeam();
  refreshNotifications();
  loadNotificationsPage();
  if (isLeader()) {
    document.getElementById('audit-tab').classList.remove('hidden');
    document.getElementById('team-tab').classList.remove('hidden');
    loadAuditLogs();
  } else {
    document.getElementById('audit-tab').classList.add('hidden');
    document.getElementById('team-tab').classList.add('hidden');
  }
  initSettingsTab();
  runFallbackCleanup();
  if (notifPollTimer) clearInterval(notifPollTimer);
  notifPollTimer = setInterval(refreshNotifications, 25000);
}

// Best-effort fallback in case pg_cron isn't available on the Supabase plan -
// the leader's login silently prunes notifications older than 30 days.
// This is a safety net; migration-v16.sql sets up the real daily pg_cron job.
async function runFallbackCleanup() {
  if (!isLeader()) return;
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  try {
    await sb.from('notifications').delete().lt('created_at', cutoff);
  } catch (err) {
    console.error(err);
  }
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
  const sidebarBadge = document.getElementById('sidebar-notif-badge');
  [badge, sidebarBadge].forEach((b) => {
    if (!b) return;
    if (unread.length) {
      b.textContent = unread.length > 9 ? '9+' : String(unread.length);
      b.classList.remove('hidden');
    } else {
      b.classList.add('hidden');
    }
  });
}

let notifPageAll = [];
let notifPageNum = 1;
const NOTIF_PAGE_SIZE = 15;

async function loadNotificationsPage() {
  const { data, error } = await sb
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error(error);
    return;
  }
  notifPageAll = data;
  notifPageNum = 1;
  renderNotifPage();
}

function renderNotifPage() {
  const list = document.getElementById('notif-page-list');
  const empty = document.getElementById('notif-page-empty');
  const count = document.getElementById('notif-page-count');
  const totalPages = Math.max(1, Math.ceil(notifPageAll.length / NOTIF_PAGE_SIZE));
  if (notifPageNum > totalPages) notifPageNum = totalPages;

  count.textContent = notifPageAll.length ? `${notifPageAll.length} total` : '';
  list.innerHTML = '';
  empty.style.display = notifPageAll.length ? 'none' : 'block';

  const start = (notifPageNum - 1) * NOTIF_PAGE_SIZE;
  const pageItems = notifPageAll.slice(start, start + NOTIF_PAGE_SIZE);
  pageItems.forEach((n) => {
    const row = document.createElement('div');
    row.className = 'notif-item';
    row.innerHTML = `
      <div>${escapeHtml(n.message)}</div>
      <span class="notif-item-time">${escapeHtml(n.actor_email || '')} · ${timeAgo(n.created_at)}</span>
    `;
    list.appendChild(row);
  });

  renderPager('notif-page-pager', notifPageNum, totalPages, (dir) => {
    notifPageNum += dir;
    renderNotifPage();
  });
}

document.getElementById('notif-clear-btn').addEventListener('click', async () => {
  if (!currentUser) return;
  if (!confirm('Clear all notifications you triggered? This cannot be undone.')) return;
  const { error, count } = await sb
    .from('notifications')
    .delete({ count: 'exact' })
    .eq('actor_id', currentUser.id);
  if (error) {
    alert(error.message);
    return;
  }
  if (!count) {
    alert("Couldn't clear notifications right now — please try again, or contact your admin.");
    return;
  }
  loadNotificationsPage();
  refreshNotifications();
});

const notifClearAllBtn = document.getElementById('notif-clear-all-btn');
notifClearAllBtn.addEventListener('click', async () => {
  if (!confirm('Clear EVERYONE\'s notifications, not just yours? This cannot be undone.')) return;
  const { error, count } = await sb
    .from('notifications')
    .delete({ count: 'exact' })
    .not('id', 'is', null);
  if (error) {
    alert(error.message);
    return;
  }
  if (!count) {
    alert("Couldn't clear notifications right now — please try again, or contact your admin.");
    return;
  }
  loadNotificationsPage();
  refreshNotifications();
});

// ---------- Simple pager helper ----------

function renderPager(containerId, page, totalPages, onChange) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (totalPages <= 1) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <button type="button" class="btn btn-ghost btn-small" data-dir="-1" ${page <= 1 ? 'disabled' : ''}>‹ Prev</button>
    <span class="pager-info">Page ${page} of ${totalPages}</span>
    <button type="button" class="btn btn-ghost btn-small" data-dir="1" ${page >= totalPages ? 'disabled' : ''}>Next ›</button>
  `;
  el.querySelectorAll('button[data-dir]').forEach((btn) => {
    btn.addEventListener('click', () => onChange(Number(btn.dataset.dir)));
  });
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
  const settingsPanel = document.getElementById('settings-permissions-panel');
  if (isLeader()) {
    settingsPanel.classList.remove('hidden');
    renderTeamInto('team-list', 'team-count', members);
    renderTeamInto('settings-team-list', 'settings-team-count', members);
  } else {
    settingsPanel.classList.add('hidden');
  }
  renderCleanupTargets(members);
}

function renderTeamInto(listId, countId, members) {
  const list = document.getElementById(listId);
  const count = document.getElementById(countId);
  if (!list) return;
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

// ---------- Settings tab ----------

function initSettingsTab() {
  document.getElementById('settings-display-name').value = currentProfile ? currentProfile.display_name || '' : '';
  document.getElementById('settings-email').value = currentUser ? currentUser.email : '';
  updateCleanupNotifCount();
  notifClearAllBtn.classList.toggle('hidden', !isLeader());
}

document.getElementById('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFormError('profile-error');
  document.getElementById('profile-success').classList.add('hidden');
  const name = document.getElementById('settings-display-name').value.trim();
  if (!name) {
    showFormError('profile-error', 'Display name cannot be empty.');
    return;
  }
  const { error } = await sb.from('profiles').update({ display_name: name }).eq('id', currentUser.id);
  if (error) {
    showFormError('profile-error', error.message);
    return;
  }
  if (currentProfile) currentProfile.display_name = name;
  document.getElementById('profile-success').textContent = 'Profile saved.';
  document.getElementById('profile-success').classList.remove('hidden');
  loadTeam();
});

document.getElementById('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFormError('password-error');
  document.getElementById('password-success').classList.add('hidden');
  const pw = document.getElementById('settings-new-password').value;
  const confirm = document.getElementById('settings-confirm-password').value;
  if (pw.length < 6) {
    showFormError('password-error', 'Password must be at least 6 characters.');
    return;
  }
  if (pw !== confirm) {
    showFormError('password-error', 'Passwords do not match.');
    return;
  }
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) {
    showFormError('password-error', error.message);
    return;
  }
  document.getElementById('password-form').reset();
  document.getElementById('password-success').textContent = 'Password updated.';
  document.getElementById('password-success').classList.remove('hidden');
});

function renderCleanupTargets(members) {
  const row = document.getElementById('cleanup-target-row');
  const select = document.getElementById('cleanup-target-select');
  if (!isLeader()) {
    row.classList.add('hidden');
    select.innerHTML = '<option value="">Myself</option>';
    select.value = '';
    updateCleanupLabels();
    return;
  }
  row.classList.remove('hidden');
  const prev = select.value;
  const opts = ['<option value="">Myself</option>']
    .concat(
      members
        .filter((m) => m.id !== (currentUser && currentUser.id))
        .map((m) => `<option value="${m.id}">${escapeHtml(m.display_name || m.email)}</option>`)
    );
  select.innerHTML = opts.join('');
  if ([...select.options].some((o) => o.value === prev)) select.value = prev;
  updateCleanupLabels();
}

function cleanupTargetId() {
  const select = document.getElementById('cleanup-target-select');
  return (isLeader() && select.value) ? select.value : (currentUser ? currentUser.id : null);
}

function cleanupTargetLabel() {
  const select = document.getElementById('cleanup-target-select');
  if (isLeader() && select.value) {
    const opt = select.options[select.selectedIndex];
    return opt ? opt.textContent : 'this member';
  }
  return 'my';
}

function updateCleanupLabels() {
  const isMe = cleanupTargetLabel() === 'my';
  const who = isMe ? 'my' : `${cleanupTargetLabel()}'s`;
  document.getElementById('cleanup-notif-label').textContent = isMe ? 'My notifications' : `${who} notifications`;
  document.getElementById('cleanup-daily-label').textContent = isMe ? 'My daily logs older than' : `${who} daily logs older than`;
}

document.getElementById('cleanup-target-select').addEventListener('change', () => {
  updateCleanupLabels();
  updateCleanupNotifCount();
});

async function updateCleanupNotifCount() {
  const targetId = cleanupTargetId();
  if (!targetId) return;
  const { count } = await sb
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('actor_id', targetId);
  document.getElementById('cleanup-notif-count').textContent = `${count || 0} logged`;
}

document.getElementById('cleanup-notif-btn').addEventListener('click', async () => {
  clearFormError('cleanup-error');
  document.getElementById('cleanup-success').classList.add('hidden');
  const targetId = cleanupTargetId();
  if (!targetId) return;
  const isMe = cleanupTargetLabel() === 'my';
  if (!confirm(`Clear all notifications ${isMe ? 'you' : cleanupTargetLabel()} triggered? This cannot be undone.`)) return;
  const { error, count } = await sb
    .from('notifications')
    .delete({ count: 'exact' })
    .eq('actor_id', targetId);
  if (error) {
    showFormError('cleanup-error', error.message);
    return;
  }
  if (!count) {
    showFormError('cleanup-error', "Couldn't clear notifications right now — please try again, or contact your admin.");
    return;
  }
  updateCleanupNotifCount();
  loadNotificationsPage();
  refreshNotifications();
  document.getElementById('cleanup-success').textContent = `Cleared ${count} notification${count === 1 ? '' : 's'}.`;
  document.getElementById('cleanup-success').classList.remove('hidden');
});

document.getElementById('cleanup-daily-btn').addEventListener('click', async () => {
  clearFormError('cleanup-error');
  document.getElementById('cleanup-success').classList.add('hidden');
  const targetId = cleanupTargetId();
  if (!targetId) return;
  const isMe = cleanupTargetLabel() === 'my';
  const cutoff = document.getElementById('cleanup-daily-date').value;
  if (!cutoff) {
    showFormError('cleanup-error', 'Pick a date first — entries older than that will be removed.');
    return;
  }
  if (!confirm(`Remove all ${isMe ? 'your' : `${cleanupTargetLabel()}'s`} daily log entries before ${cutoff}? This cannot be undone.`)) return;
  const { error, count } = await sb
    .from('daily_reports')
    .delete({ count: 'exact' })
    .eq('owner_id', targetId)
    .lt('report_date', cutoff);
  if (error) {
    showFormError('cleanup-error', error.message);
    return;
  }
  loadReports();
  document.getElementById('cleanup-success').textContent = `Cleared ${count ?? ''} old daily log entr${count === 1 ? 'y' : 'ies'}.`;
  document.getElementById('cleanup-success').classList.remove('hidden');
});


// ---------- Audit logs ----------

function auditActionText(action) {
  return action === 'INSERT' ? 'Created' : action === 'UPDATE' ? 'Updated' : 'Deleted';
}

function auditChangedFields(row) {
  if (!row.old_data || !row.new_data) return '';
  const keys = new Set([...Object.keys(row.old_data || {}), ...Object.keys(row.new_data || {})]);
  const changed = [];
  keys.forEach((key) => {
    if (['updated_at', 'created_at'].includes(key)) return;
    const before = JSON.stringify(row.old_data?.[key] ?? null);
    const after = JSON.stringify(row.new_data?.[key] ?? null);
    if (before !== after) changed.push(`${key}: ${before} → ${after}`);
  });
  return changed.slice(0, 8).join('\n');
}

async function loadAuditLogs() {
  document.getElementById('audit-clear-btn')?.classList.toggle('hidden', !isLeader());
  if (!isLeader()) return;
  let query = sb.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(500);
  const action = document.getElementById('audit-filter-action')?.value || '';
  const table = document.getElementById('audit-filter-table')?.value || '';
  const user = document.getElementById('audit-filter-user')?.value.trim() || '';
  if (action) query = query.eq('action', action);
  if (table) query = query.eq('table_name', table);
  if (user) query = query.ilike('actor_email', `%${user}%`);

  const { data, error } = await query;
  if (error) {
    console.error(error);
    return;
  }
  auditCache = data || [];
  auditPageNum = 1;

  const tableSelect = document.getElementById('audit-filter-table');
  if (tableSelect) {
    const selected = tableSelect.value;
    const tables = [...new Set(auditCache.map((r) => r.table_name))].sort();
    tableSelect.innerHTML = '<option value="">All modules</option>' +
      tables.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    tableSelect.value = selected;
  }
  renderAuditLogs();
}

document.getElementById('audit-clear-btn')?.addEventListener('click', async () => {
  if (!isLeader()) return;
  if (!confirm('Clear ALL audit log history? This is permanent and cannot be undone.')) return;
  const { error, count } = await sb
    .from('audit_logs')
    .delete({ count: 'exact' })
    .not('id', 'is', null);
  if (error) {
    alert(error.message);
    return;
  }
  if (!count) {
    alert("Couldn't clear audit logs — make sure migration-v20.sql has been run.");
    return;
  }
  loadAuditLogs();
});

function renderAuditLogs() {
  const list = document.getElementById('audit-list');
  const empty = document.getElementById('audit-empty');
  const count = document.getElementById('audit-count');
  if (!list || !count) return;
  const totalPages = Math.max(1, Math.ceil(auditCache.length / AUDIT_PAGE_SIZE));
  auditPageNum = Math.min(auditPageNum, totalPages);
  count.textContent = auditCache.length ? `${auditCache.length} total` : '';
  list.innerHTML = '';
  empty.style.display = auditCache.length ? 'none' : 'block';

  const start = (auditPageNum - 1) * AUDIT_PAGE_SIZE;
  auditCache.slice(start, start + AUDIT_PAGE_SIZE).forEach((row) => {
    const item = document.createElement('div');
    item.className = 'audit-item';
    const actionClass = row.action.toLowerCase();
    const changed = auditChangedFields(row);
    item.innerHTML = `
      <div class="audit-head">
        <span class="audit-action ${actionClass}">${auditActionText(row.action)}</span>
        <span><b>${escapeHtml(row.table_name)}</b></span>
        ${row.record_label ? `<span>— ${escapeHtml(row.record_label)}</span>` : ''}
      </div>
      <div class="audit-meta">${escapeHtml(row.actor_email || 'System')} · ${new Date(row.created_at).toLocaleString()}</div>
      ${changed ? `<div class="audit-details"><span class="audit-label">Changed:</span>\n${escapeHtml(changed)}</div>` : ''}
    `;
    list.appendChild(item);
  });

  renderPager('audit-pager', auditPageNum, totalPages, (dir) => {
    auditPageNum += dir;
    renderAuditLogs();
  });
}

['audit-filter-action', 'audit-filter-table'].forEach((id) => {
  document.getElementById(id)?.addEventListener('change', loadAuditLogs);
});
document.getElementById('audit-filter-user')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadAuditLogs();
});
document.getElementById('audit-filter-clear')?.addEventListener('click', () => {
  document.getElementById('audit-filter-action').value = '';
  document.getElementById('audit-filter-table').value = '';
  document.getElementById('audit-filter-user').value = '';
  loadAuditLogs();
});

document.getElementById('download-audit-btn')?.addEventListener('click', () => {
  const rows = auditCache.map((r) => ({
    'Date & Time': new Date(r.created_at).toLocaleString(),
    'User': r.actor_email || '',
    'Action': auditActionText(r.action),
    'Module': r.table_name,
    'Record': r.record_label || '',
    'Record ID': r.record_id || '',
    'Changed Fields': auditChangedFields(r),
  }));
  downloadSheet('Audit Logs', rows, 'Audit Logs');
});

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
  renderBugsSelect();
}

const projectsBulk = createBulkSelector({
  checkboxSelector: '#projects-tbody .row-checkbox',
  selectAllId: 'projects-select-all',
  deleteBtnId: 'projects-bulk-delete',
  table: 'projects',
  itemLabel: 'project',
  onDeleted: async () => {
    notify(`${actorLabel()} bulk-deleted projects`, 'project', 'delete');
    await loadProjects();
    await loadReports();
  },
});

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
      <td class="col-checkbox"><input type="checkbox" class="row-checkbox" data-id="${p.id}" /></td>
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

  projectsBulk.onRendered();
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
  tcPageNum = 1;
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
  tcCache = data || [];
  renderTestCases(data, projectId);
}

let tcPageNum = 1;
const TC_PAGE_SIZE = 8;

const tcBulk = createBulkSelector({
  checkboxSelector: '#tc-list .row-checkbox',
  selectAllId: 'tc-select-all',
  deleteBtnId: 'tc-bulk-delete',
  table: 'test_cases',
  itemLabel: 'test case',
  getAllIds: () => tcCache.map((c) => c.id),
  onDeleted: async () => {
    await loadTestCases(detailsSelect.value);
  },
});

function renderTestCases(cases, projectId) {
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

  const totalPages = Math.max(1, Math.ceil(cases.length / TC_PAGE_SIZE));
  if (tcPageNum > totalPages) tcPageNum = totalPages;
  const start = (tcPageNum - 1) * TC_PAGE_SIZE;
  const pageCases = cases.slice(start, start + TC_PAGE_SIZE);

  tcList.innerHTML = '';
  tcEmpty.style.display = cases.length ? 'none' : 'block';

  pageCases.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'tc-row';
    row.innerHTML = `
      <div class="tc-row-top">
        <div class="tc-row-checkbox-wrap"><input type="checkbox" class="row-checkbox" data-id="${c.id}" /></div>
        <div>
          <div class="tc-row-title">${escapeHtml(c.title)}</div>
          <div class="tc-row-meta">
            <span class="priority-pill priority-${escapeHtml(c.priority || 'Medium')}">${escapeHtml(c.priority || 'Medium')}</span>
            <span class="pill" style="${pillStyle(categoryColor(c.category || 'Functional'))}">${escapeHtml(c.category || 'Functional')}</span>
            ${c.last_run_date ? `<span>Last run ${fmtDate(c.last_run_date)}</span>` : '<span>Not run yet</span>'}
          </div>
          ${c.description ? `<div class="tc-row-desc">${escapeHtml(c.description)}</div>` : ''}
        </div>
      </div>
      <div class="tc-row-actions">
        <select class="status-select pill tc-status-select" style="${pillStyle(tcStatusColor(c.status))}" data-id="${c.id}">
          ${['Not Run', 'Pass', 'Fail', 'Blocked'].map((s) => `<option value="${s}" ${s === c.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <button class="icon-btn" data-tc-delete="${c.id}">remove</button>
      </div>
    `;
    tcList.appendChild(row);
  });

  renderPager('tc-pager', tcPageNum, totalPages, (dir) => {
    tcPageNum += dir;
    renderTestCases(cases, projectId);
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

  tcBulk.onRendered();
}

// ---------- Bugs (own tab, own project selector) ----------

const bugsSelect = document.getElementById('bugs-project-select');
const bugsTabEmpty = document.getElementById('bugs-tab-empty');
const bugsTabContent = document.getElementById('bugs-tab-content');
const bugForm = document.getElementById('bug-form');
const bugList = document.getElementById('bug-list');
const bugEmpty = document.getElementById('bug-empty');
const bugSummary = document.getElementById('bug-summary');

function renderBugsSelect() {
  const opts = projectsCache.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  bugsSelect.innerHTML = opts;
  if (!projectsCache.length) {
    bugsTabEmpty.classList.remove('hidden');
    bugsTabContent.classList.add('hidden');
    return;
  }
  bugsTabEmpty.classList.add('hidden');
  const keep = projectsCache.find((p) => p.id === bugsSelect.dataset.current);
  const targetId = keep ? keep.id : projectsCache[0].id;
  bugsSelect.value = targetId;
  showBugsForProject(targetId);
}

bugsSelect.addEventListener('change', () => showBugsForProject(bugsSelect.value));

function showBugsForProject(id) {
  if (!id) return;
  bugsSelect.dataset.current = id;
  bugsTabContent.classList.remove('hidden');
  bugPageNum = 1;
  loadBugs(id);
}

function bugSeverityColor(sev) {
  return { Low: '#34D399', Medium: '#FBBF24', High: '#FB923C', Critical: '#F87171' }[sev] || '#7FA0A6';
}

function bugStatusColor(status) {
  return {
    Open: '#F87171',
    'In Progress': '#FBBF24',
    Fixed: '#34D399',
    Retest: '#60A5FA',
    Closed: '#7FA0A6',
    Reopened: '#EF4444',
  }[status] || '#7FA0A6';
}

function devStatusColor(status) {
  return {
    'Not Started': '#7FA0A6',
    'In Progress': '#FBBF24',
    Fixed: '#34D399',
    'Cannot Reproduce': '#A78BFA',
    'Need Info': '#60A5FA',
    "Won't Fix": '#F87171',
  }[status] || '#7FA0A6';
}

function retestStatusColor(status) {
  return {
    'Not Retested': '#7FA0A6',
    Pass: '#34D399',
    Fail: '#F87171',
    Blocked: '#FBBF24',
  }[status] || '#7FA0A6';
}

function normalizeSeverity(v) {
  return ['Low', 'Medium', 'High', 'Critical'].includes(v) ? v : 'Medium';
}

function normalizeBugStatus(v) {
  return ['Open', 'In Progress', 'Fixed', 'Retest', 'Closed', 'Reopened'].includes(v) ? v : 'Open';
}

function normalizeDeveloperStatus(v) {
  return ['Not Started', 'In Progress', 'Fixed', 'Cannot Reproduce', 'Need Info', "Won't Fix"].includes(v) ? v : 'Not Started';
}

function normalizeRetestStatus(v) {
  return ['Not Retested', 'Pass', 'Fail', 'Blocked'].includes(v) ? v : 'Not Retested';
}

function normalizeIssueType(v) {
  return ['Functional', 'UI/UX', 'Backend', 'Frontend', 'API', 'Performance', 'Security', 'Database', 'Other'].includes(v) ? v : 'Functional';
}

// Best-effort: accepts "YYYY-MM-DD" as-is, otherwise tries to parse common
// spreadsheet date formats (e.g. "17/08/2026", "Aug 17 2026"). Returns null
// if the value can't be understood, rather than guessing.
function parseSheetDate(v) {
  if (!v) return null;
  const s = v.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

bugForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFormError('bug-error');
  const project_id = bugsSelect.value;
  if (!project_id) return;

  const title = document.getElementById('bug-title').value.trim();
  if (!title || title.length < 3) {
    showFormError('bug-error', 'Bug title must be at least 3 characters.');
    flashFields(bugForm, 'field-error');
    return;
  }
  const page = document.getElementById('bug-page').value.trim();
  if (!page) {
    showFormError('bug-error', 'Page is required — which screen or module is this bug on?');
    flashFields(bugForm, 'field-error');
    return;
  }

  const payload = {
    project_id,
    title,
    bug_id: document.getElementById('bug-bugid').value.trim() || null,
    page,
    module: document.getElementById('bug-module').value.trim() || null,
    sub_module: document.getElementById('bug-sub-module').value.trim() || null,
    severity: document.getElementById('bug-severity').value,
    issue_type: document.getElementById('bug-issue-type').value,
    status: document.getElementById('bug-status').value,
    reported_by: document.getElementById('bug-reported-by').value.trim() || null,
    reported_date: document.getElementById('bug-reported-date').value || null,
    closed_date: document.getElementById('bug-closed-date').value || null,
    steps_to_reproduce: document.getElementById('bug-steps').value.trim() || null,
    expected_result: document.getElementById('bug-expected').value.trim() || null,
    actual_result: document.getElementById('bug-actual').value.trim() || null,
    description: document.getElementById('bug-description').value.trim() || null,
    developer_status: document.getElementById('bug-developer-status').value,
    retest_status: document.getElementById('bug-retest-status').value,
    developer_comments: document.getElementById('bug-developer-comments').value.trim() || null,
    manager_comments: document.getElementById('bug-manager-comments').value.trim() || null,
    notes: document.getElementById('bug-notes').value.trim() || null,
    owner_id: currentUser ? currentUser.id : null,
  };
  const { error } = await sb.from('bugs').insert(payload);
  if (error) {
    showFormError('bug-error', error.message);
    flashFields(bugForm, 'field-error');
    return;
  }
  const proj = projectsCache.find((p) => p.id === project_id);
  notify(`${actorLabel()} logged a bug for "${proj ? proj.name : 'a project'}"`, 'bug', 'create');
  celebrate('Bug logged!', '🐞');
  flashFields(bugForm, 'field-success');
  bugForm.reset();
  document.getElementById('bug-severity').value = 'Medium';
  document.getElementById('bug-issue-type').value = 'Functional';
  document.getElementById('bug-status').value = 'Open';
  document.getElementById('bug-developer-status').value = 'Not Started';
  document.getElementById('bug-retest-status').value = 'Not Retested';
  loadBugs(project_id);
});

// ---------- Bug detail / edit modal ----------

const bugModal = document.getElementById('bug-modal');
const bugEditForm = document.getElementById('bug-edit-form');

function openBugModal(id) {
  const b = bugCache.find((x) => x.id === id);
  if (!b) return;
  clearFormError('bug-edit-error');
  document.getElementById('be-id').value = b.id;
  document.getElementById('be-title').value = b.title || '';
  document.getElementById('be-bugid').value = b.bug_id || '';
  document.getElementById('be-page').value = b.page || '';
  document.getElementById('be-module').value = b.module || '';
  document.getElementById('be-sub-module').value = b.sub_module || '';
  document.getElementById('be-severity').value = b.severity || 'Medium';
  document.getElementById('be-issue-type').value = b.issue_type || 'Functional';
  document.getElementById('be-status').value = b.status || 'Open';
  document.getElementById('be-reported-by').value = b.reported_by || '';
  document.getElementById('be-reported-date').value = b.reported_date || '';
  document.getElementById('be-closed-date').value = b.closed_date || '';
  document.getElementById('be-developer-status').value = b.developer_status || 'Not Started';
  document.getElementById('be-retest-status').value = b.retest_status || 'Not Retested';
  document.getElementById('be-steps').value = b.steps_to_reproduce || '';
  document.getElementById('be-expected').value = b.expected_result || '';
  document.getElementById('be-actual').value = b.actual_result || '';
  document.getElementById('be-description').value = b.description || '';
  document.getElementById('be-developer-comments').value = b.developer_comments || '';
  document.getElementById('be-manager-comments').value = b.manager_comments || '';
  document.getElementById('be-notes').value = b.notes || '';
  bugModal.classList.remove('hidden');
}

function closeBugModal() {
  bugModal.classList.add('hidden');
}

document.getElementById('bug-modal-close').addEventListener('click', closeBugModal);
bugModal.addEventListener('click', (e) => {
  if (e.target === bugModal) closeBugModal();
});

bugEditForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFormError('bug-edit-error');
  const id = document.getElementById('be-id').value;
  const title = document.getElementById('be-title').value.trim();
  const page = document.getElementById('be-page').value.trim();
  if (!title || title.length < 3) {
    showFormError('bug-edit-error', 'Bug title must be at least 3 characters.');
    return;
  }
  if (!page) {
    showFormError('bug-edit-error', 'Page is required.');
    return;
  }
  const payload = {
    title,
    bug_id: document.getElementById('be-bugid').value.trim() || null,
    page,
    module: document.getElementById('be-module').value.trim() || null,
    sub_module: document.getElementById('be-sub-module').value.trim() || null,
    severity: document.getElementById('be-severity').value,
    issue_type: document.getElementById('be-issue-type').value,
    status: document.getElementById('be-status').value,
    reported_by: document.getElementById('be-reported-by').value.trim() || null,
    reported_date: document.getElementById('be-reported-date').value || null,
    closed_date: document.getElementById('be-closed-date').value || null,
    developer_status: document.getElementById('be-developer-status').value,
    retest_status: document.getElementById('be-retest-status').value,
    steps_to_reproduce: document.getElementById('be-steps').value.trim() || null,
    expected_result: document.getElementById('be-expected').value.trim() || null,
    actual_result: document.getElementById('be-actual').value.trim() || null,
    description: document.getElementById('be-description').value.trim() || null,
    developer_comments: document.getElementById('be-developer-comments').value.trim() || null,
    manager_comments: document.getElementById('be-manager-comments').value.trim() || null,
    notes: document.getElementById('be-notes').value.trim() || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('bugs').update(payload).eq('id', id);
  if (error) {
    showFormError('bug-edit-error', error.message);
    return;
  }
  notify(`${actorLabel()} updated bug "${title}"`, 'bug', 'update');
  closeBugModal();
  loadBugs(bugsSelect.value);
});

document.getElementById('bug-edit-delete').addEventListener('click', async () => {
  const id = document.getElementById('be-id').value;
  const title = document.getElementById('be-title').value;
  if (!id) return;
  if (!confirm('Remove this bug? This cannot be undone.')) return;
  const { error } = await sb.from('bugs').delete().eq('id', id);
  if (error) {
    showFormError('bug-edit-error', error.message);
    return;
  }
  notify(`${actorLabel()} removed bug "${title}"`, 'bug', 'delete');
  closeBugModal();
  loadBugs(bugsSelect.value);
});

async function loadBugs(projectId) {
  const { data, error } = await sb
    .from('bugs')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error(error);
    return;
  }
  bugCache = data || [];
  renderBugs(bugCache, projectId);
}

let bugPageNum = 1;
const BUG_PAGE_SIZE = 8;

const bugBulk = createBulkSelector({
  checkboxSelector: '#bug-list .row-checkbox',
  selectAllId: 'bug-select-all',
  deleteBtnId: 'bug-bulk-delete',
  table: 'bugs',
  itemLabel: 'bug',
  getAllIds: () => bugCache.map((b) => b.id),
  onDeleted: async () => {
    await loadBugs(bugsSelect.value);
  },
});

function renderBugs(bugs, projectId) {
  const counts = { Open: 0, 'In Progress': 0, Fixed: 0, Retest: 0, Closed: 0, Reopened: 0 };
  bugs.forEach((b) => { counts[b.status] = (counts[b.status] || 0) + 1; });
  bugSummary.textContent = bugs.length
    ? `${bugs.length} total · ${counts.Open} open · ${counts['In Progress']} in progress · ${counts.Fixed} fixed · ${counts.Closed} closed`
    : '';

  const totalPages = Math.max(1, Math.ceil(bugs.length / BUG_PAGE_SIZE));
  if (bugPageNum > totalPages) bugPageNum = totalPages;
  const start = (bugPageNum - 1) * BUG_PAGE_SIZE;
  const pageBugs = bugs.slice(start, start + BUG_PAGE_SIZE);

  bugList.innerHTML = '';
  bugEmpty.style.display = bugs.length ? 'none' : 'block';

  pageBugs.forEach((b) => {
    const row = document.createElement('div');
    row.className = 'tc-row';
    const stepsBlock = [
      b.steps_to_reproduce ? `<div><b>Steps:</b> ${escapeHtml(b.steps_to_reproduce)}</div>` : '',
      b.expected_result ? `<div><b>Expected:</b> ${escapeHtml(b.expected_result)}</div>` : '',
      b.actual_result ? `<div><b>Actual:</b> ${escapeHtml(b.actual_result)}</div>` : '',
    ].filter(Boolean).join('');
    const commentsBlock = [
      b.developer_comments ? `<div><b>Dev comments:</b> ${escapeHtml(b.developer_comments)}</div>` : '',
      b.manager_comments ? `<div><b>Manager comments:</b> ${escapeHtml(b.manager_comments)}</div>` : '',
    ].filter(Boolean).join('');
    row.innerHTML = `
      <div class="tc-row-top">
        <div class="tc-row-checkbox-wrap"><input type="checkbox" class="row-checkbox" data-id="${b.id}" /></div>
        <div>
          <div class="tc-row-title"><button type="button" class="project-link" data-bug-edit="${b.id}">${b.bug_id ? `[${escapeHtml(b.bug_id)}] ` : ''}${escapeHtml(b.title)}</button></div>
          <div class="tc-row-meta">
            ${b.module ? `<span class="pill" style="${pillStyle('#38BDF8')}">Module: ${escapeHtml(b.module)}</span>` : ''}
            ${b.sub_module ? `<span class="pill" style="${pillStyle('#38BDF8')}">Sub module: ${escapeHtml(b.sub_module)}</span>` : ''}
            <span class="pill" style="${pillStyle('#818CF8')}">Page: ${escapeHtml(b.page)}</span>
            <span class="pill" style="${pillStyle('#34D399')}">${escapeHtml(b.issue_type || 'Functional')}</span>
            <span class="priority-pill priority-${escapeHtml(b.severity)}">${escapeHtml(b.severity)}</span>
            ${b.reported_by ? `<span>Reported by ${escapeHtml(b.reported_by)}</span>` : ''}
            ${b.reported_date ? `<span>Reported: ${fmtDate(b.reported_date)}</span>` : ''}
            ${b.closed_date ? `<span>Closed: ${fmtDate(b.closed_date)}</span>` : ''}
          </div>
          ${stepsBlock ? `<div class="tc-row-desc">${stepsBlock}</div>` : ''}
          ${b.description ? `<div class="tc-row-desc">${escapeHtml(b.description)}</div>` : ''}
          ${commentsBlock ? `<div class="tc-row-desc">${commentsBlock}</div>` : ''}
          ${b.notes ? `<div class="tc-row-desc"><b>Notes:</b> ${escapeHtml(b.notes)}</div>` : ''}
        </div>
      </div>
      <div class="tc-row-actions">
        <select class="status-select pill bug-status-select" style="${pillStyle(bugStatusColor(b.status))}" data-id="${b.id}">
          ${['Open', 'In Progress', 'Fixed', 'Retest', 'Closed', 'Reopened'].map((s) => `<option value="${s}" ${s === b.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <select class="status-select pill bug-dev-status-select" style="${pillStyle(devStatusColor(b.developer_status))}" data-id="${b.id}">
          ${['Not Started', 'In Progress', 'Fixed', 'Cannot Reproduce', 'Need Info', "Won't Fix"].map((s) => `<option value="${s}" ${s === b.developer_status ? 'selected' : ''}>Dev: ${s}</option>`).join('')}
        </select>
        <select class="status-select pill bug-retest-status-select" style="${pillStyle(retestStatusColor(b.retest_status))}" data-id="${b.id}">
          ${['Not Retested', 'Pass', 'Fail', 'Blocked'].map((s) => `<option value="${s}" ${s === b.retest_status ? 'selected' : ''}>Retest: ${s}</option>`).join('')}
        </select>
        <button class="icon-btn" data-bug-delete="${b.id}">remove</button>
      </div>
    `;
    bugList.appendChild(row);
  });

  bugList.querySelectorAll('[data-bug-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openBugModal(btn.dataset.bugEdit));
  });

  renderPager('bug-pager', bugPageNum, totalPages, (dir) => {
    bugPageNum += dir;
    renderBugs(bugs, projectId);
  });

  bugList.querySelectorAll('.bug-status-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const newStatus = sel.value;
      const { error } = await sb
        .from('bugs')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', sel.dataset.id);
      if (error) {
        alert(error.message);
        return;
      }
      if (newStatus === 'Fixed') celebrate('Bug fixed!', '🎉');
      loadBugs(projectId);
    });
  });

  bugList.querySelectorAll('.bug-dev-status-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const { error } = await sb
        .from('bugs')
        .update({ developer_status: sel.value, updated_at: new Date().toISOString() })
        .eq('id', sel.dataset.id);
      if (error) {
        alert(error.message);
        return;
      }
      loadBugs(projectId);
    });
  });

  bugList.querySelectorAll('.bug-retest-status-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const { error } = await sb
        .from('bugs')
        .update({ retest_status: sel.value, updated_at: new Date().toISOString() })
        .eq('id', sel.dataset.id);
      if (error) {
        alert(error.message);
        return;
      }
      loadBugs(projectId);
    });
  });

  bugList.querySelectorAll('[data-bug-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this bug?')) return;
      await flashRowRemoving(btn.closest('.tc-row'));
      const { error } = await sb.from('bugs').delete().eq('id', btn.dataset.bugDelete);
      if (error) {
        alert(error.message);
        return;
      }
      loadBugs(projectId);
    });
  });

  bugBulk.onRendered();
}

// ---------- Import bugs from Google Sheet ----------

const bugImportSheetUrl = document.getElementById('bug-import-sheet-url');
const bugImportSheetTabs = document.getElementById('bug-import-sheet-tabs');
const bugImportFetchBtn = document.getElementById('bug-import-fetch-btn');
const bugImportText = document.getElementById('bug-import-text');
const bugImportParseBtn = document.getElementById('bug-import-parse-btn');
const bugImportPreview = document.getElementById('bug-import-preview');
const bugImportPreviewList = document.getElementById('bug-import-preview-list');
const bugImportTabSummary = document.getElementById('bug-import-tab-summary');
let bugImportRows = [];

// Parses CSV/TSV text into rows of cells, correctly handling quoted fields
// that contain embedded newlines (very common for a "Steps to Reproduce"
// cell with multiple numbered lines) - a newline only ends a row when it's
// outside quotes, not whenever it appears.
function parseDelimitedText(text) {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!raw.trim()) return [];
  const delim = raw.includes('\t') ? '\t' : ',';

  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(cur.trim());
      cur = '';
    } else if (ch === '\n') {
      row.push(cur.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cur = '';
    } else {
      cur += ch;
    }
  }
  row.push(cur.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

function normalizeHeaderKey(h) {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const BUG_HEADER_ALIASES = {
  title: 'title',
  bugtitle: 'title',
  submodule: 'sub_module',
  sub_module: 'sub_module',
  page: 'page',
  screen: 'page',
  module: 'module',
  severity: 'severity',
  status: 'status',
  reportedby: 'reported_by',
  reporter: 'reported_by',
  reporteddate: 'reported_date',
  datereported: 'reported_date',
  dateopened: 'reported_date',
  date: 'reported_date',
  closeddate: 'closed_date',
  closingdate: 'closed_date',
  dateclosed: 'closed_date',
  resolveddate: 'closed_date',
  issuetype: 'issue_type',
  type: 'issue_type',
  category: 'issue_type',
  description: 'description',
  desc: 'description',
  stepstoreproduce: 'steps',
  steps: 'steps',
  expectedresult: 'expected',
  expected: 'expected',
  actualresult: 'actual',
  actual: 'actual',
  developerstatus: 'developer_status',
  devstatus: 'developer_status',
  retest: 'retest_status',
  retststatus: 'retest_status',
  retestresult: 'retest_status',
  developercomments: 'developer_comments',
  devcomments: 'developer_comments',
  managercomments: 'manager_comments',
  bugid: 'bug_id',
  id: 'bug_id',
  notes: 'notes',
  note: 'notes',
};

// tabName (optional): used as a fallback Page/Module when a row doesn't have
// its own, and to tag each parsed bug with the sheet tab it came from.
function rowsToBugObjects(rows, tabName) {
  if (!rows.length) return [];
  const firstRowKeys = rows[0].map((c) => BUG_HEADER_ALIASES[normalizeHeaderKey(c)]).filter(Boolean);
  // A "Sub Module" column can stand in for Title, and a "Module" column can
  // stand in for Page — either one in each pair is enough to recognize the header.
  const hasHeader = (firstRowKeys.includes('title') || firstRowKeys.includes('sub_module'))
    && (firstRowKeys.includes('page') || firstRowKeys.includes('module'));

  let fieldMap; // index -> field name
  let dataRows;
  if (hasHeader) {
    fieldMap = rows[0].map((c) => BUG_HEADER_ALIASES[normalizeHeaderKey(c)] || null);
    dataRows = rows.slice(1);
  } else {
    // Assume the default column order when no recognizable header is present.
    fieldMap = ['title', 'page', 'severity', 'status', 'reported_by', 'description', 'notes'];
    dataRows = rows;
  }

  const objs = [];
  dataRows.forEach((row) => {
    const obj = {};
    fieldMap.forEach((field, idx) => {
      if (field) obj[field] = (row[idx] || '').trim();
    });
    if (!obj.page) obj.page = obj.module || tabName || ''; // fall back to Module column, then the tab/sheet name
    if (!obj.title) obj.title = obj.sub_module || '';
    if (!obj.title || !obj.page) return; // Title and Page are required

    // Notes from the sheet are kept as-is; Bug Id / Reported date / Closing
    // date now have their own columns, so they're stored directly instead.
    const noteParts = [];
    if (obj.notes) noteParts.push(obj.notes);

    objs.push({
      title: obj.title.slice(0, 200),
      bug_id: obj.bug_id ? obj.bug_id.slice(0, 60) : null,
      page: obj.page.slice(0, 120),
      module: obj.module ? obj.module.slice(0, 120) : null,
      sub_module: obj.sub_module ? obj.sub_module.slice(0, 200) : null,
      severity: normalizeSeverity(obj.severity),
      issue_type: obj.issue_type ? normalizeIssueType(obj.issue_type) : 'Functional',
      status: normalizeBugStatus(obj.status),
      reported_by: obj.reported_by ? obj.reported_by.slice(0, 80) : null,
      reported_date: parseSheetDate(obj.reported_date),
      closed_date: parseSheetDate(obj.closed_date),
      description: obj.description ? obj.description.slice(0, 1000) : null,
      steps_to_reproduce: obj.steps ? obj.steps.slice(0, 1000) : null,
      expected_result: obj.expected ? obj.expected.slice(0, 1000) : null,
      actual_result: obj.actual ? obj.actual.slice(0, 1000) : null,
      developer_status: obj.developer_status ? normalizeDeveloperStatus(obj.developer_status) : 'Not Started',
      retest_status: obj.retest_status ? normalizeRetestStatus(obj.retest_status) : 'Not Retested',
      developer_comments: obj.developer_comments ? obj.developer_comments.slice(0, 1000) : null,
      manager_comments: obj.manager_comments ? obj.manager_comments.slice(0, 1000) : null,
      notes: noteParts.length ? noteParts.join(' | ').slice(0, 500) : null,
      _tab: tabName || null,
    });
  });
  return objs;
}

// Best-effort: works only for sheets shared as "Anyone with the link can view".
// Google's CORS headers on this export endpoint aren't guaranteed, so if the
// fetch fails we tell the user to paste the rows instead.
function extractSheetIdAndGid(url) {
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return null;
  const gidMatch = url.match(/[#&?]gid=([0-9]+)/);
  return { id: idMatch[1], gid: gidMatch ? gidMatch[1] : null };
}

// Fetches one worksheet tab as CSV via Google's gviz endpoint, addressed by
// its tab name (works for any sheet shared as "Anyone with the link can view",
// without needing to know that tab's numeric gid).
async function fetchSheetTabCsv(sheetId, tabName) {
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
  const res = await fetch(csvUrl);
  if (!res.ok) throw new Error('not ok');
  const text = await res.text();
  if (!text.trim()) throw new Error('empty');
  return text.trim();
}

bugImportFetchBtn.addEventListener('click', async () => {
  clearFormError('bug-import-error');
  bugImportTabSummary.classList.add('hidden');
  const url = bugImportSheetUrl.value.trim();
  if (!url) {
    showFormError('bug-import-error', 'Paste a Google Sheet link above first.');
    return;
  }
  const parts = extractSheetIdAndGid(url);
  if (!parts) {
    showFormError('bug-import-error', 'That doesn\'t look like a Google Sheets link.');
    return;
  }

  const tabNames = bugImportSheetTabs.value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const original = bugImportFetchBtn.textContent;
  bugImportFetchBtn.textContent = 'Fetching...';
  bugImportFetchBtn.disabled = true;

  try {
    if (!tabNames.length) {
      // Single tab/link: fetch the CSV and let the person review/edit it in
      // the textarea before parsing, same as before.
      try {
        const csvUrl = `https://docs.google.com/spreadsheets/d/${parts.id}/gviz/tq?tqx=out:csv${parts.gid ? `&gid=${parts.gid}` : ''}`;
        const res = await fetch(csvUrl);
        if (!res.ok) throw new Error('not ok');
        const text = await res.text();
        if (!text.trim()) throw new Error('empty');
        bugImportText.value = text.trim();
      } catch {
        showFormError('bug-import-error', 'Couldn\'t fetch that sheet automatically (it may not be shared publicly, or your browser blocked the request). Open the sheet, select all the rows, copy them, and paste into the box below instead.');
      }
      return;
    }

    // Multiple tabs: fetch + parse each on its own, then merge into one
    // preview. Each tab keeps its own header row, so this handles testers
    // who use different column layouts per tab.
    const combined = [];
    const summaryParts = [];
    const failedTabs = [];
    for (const tabName of tabNames) {
      try {
        const text = await fetchSheetTabCsv(parts.id, tabName);
        const rows = parseDelimitedText(text);
        const objs = rowsToBugObjects(rows, tabName);
        combined.push(...objs);
        summaryParts.push(`${tabName}: ${objs.length} bug${objs.length === 1 ? '' : 's'}`);
      } catch {
        failedTabs.push(tabName);
      }
    }

    if (failedTabs.length) {
      summaryParts.push(`Couldn't fetch: ${failedTabs.join(', ')} (check the tab name is spelled exactly as in the sheet, and the sheet is shared as "Anyone with the link can view")`);
    }
    bugImportTabSummary.textContent = summaryParts.join('  •  ');
    bugImportTabSummary.classList.remove('hidden');

    if (!combined.length) {
      showFormError('bug-import-error', 'No valid rows found in any of those tabs — make sure each row has at least a Title/Sub Module and a Page/Module.');
      return;
    }
    bugImportRows = combined;
    renderBugImportPreview(combined);
  } finally {
    bugImportFetchBtn.textContent = original;
    bugImportFetchBtn.disabled = false;
  }
});

bugImportParseBtn.addEventListener('click', () => {
  clearFormError('bug-import-error');
  bugImportPreview.classList.add('hidden');
  bugImportTabSummary.classList.add('hidden');
  const raw = bugImportText.value.trim();
  if (!raw) {
    showFormError('bug-import-error', 'Paste sheet rows above first (or fetch from a link).');
    return;
  }
  const rows = parseDelimitedText(raw);
  const objs = rowsToBugObjects(rows);
  if (!objs.length) {
    showFormError('bug-import-error', 'No valid rows found — make sure each row has at least a Title and a Page.');
    return;
  }
  bugImportRows = objs;
  renderBugImportPreview(objs);
});

function renderBugImportPreview(bugs) {
  bugImportPreviewList.innerHTML = '';

  const summaryEl = document.createElement('p');
  summaryEl.className = 'ai-coverage-summary';
  summaryEl.textContent = `${bugs.length} bug${bugs.length === 1 ? '' : 's'} found`;
  bugImportPreviewList.appendChild(summaryEl);

  bugs.forEach((b, i) => {
    const row = document.createElement('label');
    row.className = 'ai-preview-item';
    row.innerHTML = `
      <input type="checkbox" class="bug-import-check" data-idx="${i}" checked />
      <div>
        <div class="ai-preview-item-title">
          ${b.bug_id ? `[${escapeHtml(b.bug_id)}] ` : ''}${escapeHtml(b.title)}
          ${b.module ? `<span class="pill" style="${pillStyle('#38BDF8')}">Module: ${escapeHtml(b.module)}</span>` : ''}
          <span class="pill" style="${pillStyle('#818CF8')}">Page: ${escapeHtml(b.page)}</span>
          ${b._tab ? `<span class="pill" style="${pillStyle('#38BDF8')}">Tab: ${escapeHtml(b._tab)}</span>` : ''}
          <span class="pill" style="${pillStyle('#34D399')}">${escapeHtml(b.issue_type || 'Functional')}</span>
          <span class="priority-pill priority-${escapeHtml(b.severity)}">${escapeHtml(b.severity)}</span>
          <span class="pill" style="${pillStyle(bugStatusColor(b.status))}">${escapeHtml(b.status)}</span>
        </div>
        ${(b.reported_date || b.closed_date) ? `<div class="ai-preview-item-desc">${b.reported_date ? `<b>Reported:</b> ${fmtDate(b.reported_date)} ` : ''}${b.closed_date ? `<b>Closed:</b> ${fmtDate(b.closed_date)}` : ''}</div>` : ''}
        ${b.steps_to_reproduce ? `<div class="ai-preview-item-desc"><b>Steps:</b> ${escapeHtml(b.steps_to_reproduce)}</div>` : ''}
        ${b.expected_result ? `<div class="ai-preview-item-desc"><b>Expected:</b> ${escapeHtml(b.expected_result)}</div>` : ''}
        ${b.actual_result ? `<div class="ai-preview-item-desc"><b>Actual:</b> ${escapeHtml(b.actual_result)}</div>` : ''}
        ${b.description ? `<div class="ai-preview-item-desc">${escapeHtml(b.description)}</div>` : ''}
      </div>
    `;
    bugImportPreviewList.appendChild(row);
  });
  bugImportPreview.classList.remove('hidden');
}

document.getElementById('bug-import-discard').addEventListener('click', () => {
  bugImportRows = [];
  bugImportPreview.classList.add('hidden');
  bugImportTabSummary.classList.add('hidden');
  bugImportSheetUrl.value = '';
  bugImportSheetTabs.value = '';
  bugImportText.value = '';
});

document.getElementById('bug-import-add-selected').addEventListener('click', async () => {
  const projectId = bugsSelect.value;
  if (!projectId) return;
  const checks = bugImportPreviewList.querySelectorAll('.bug-import-check');
  const selected = [];
  checks.forEach((cb) => {
    if (cb.checked) selected.push(bugImportRows[Number(cb.dataset.idx)]);
  });
  if (!selected.length) return;

  const rows = selected.map((b) => ({
    project_id: projectId,
    title: b.title,
    bug_id: b.bug_id,
    page: b.page,
    module: b.module,
    sub_module: b.sub_module,
    severity: b.severity,
    issue_type: b.issue_type,
    status: b.status,
    reported_by: b.reported_by,
    reported_date: b.reported_date,
    closed_date: b.closed_date,
    description: b.description,
    steps_to_reproduce: b.steps_to_reproduce,
    expected_result: b.expected_result,
    actual_result: b.actual_result,
    developer_status: b.developer_status,
    retest_status: b.retest_status,
    developer_comments: b.developer_comments,
    manager_comments: b.manager_comments,
    notes: b.notes,
    owner_id: currentUser ? currentUser.id : null,
  }));

  const { error } = await sb.from('bugs').insert(rows);
  if (error) {
    showFormError('bug-import-error', error.message);
    return;
  }
  const project = projectsCache.find((p) => p.id === projectId);
  notify(`${actorLabel()} imported ${rows.length} bug${rows.length === 1 ? '' : 's'} from a sheet for "${project ? project.name : 'a project'}"`, 'bug', 'import');
  celebrate(`${rows.length} bug${rows.length === 1 ? '' : 's'} imported!`, '📥');

  bugImportRows = [];
  bugImportPreview.classList.add('hidden');
  bugImportTabSummary.classList.add('hidden');
  bugImportSheetUrl.value = '';
  bugImportSheetTabs.value = '';
  bugImportText.value = '';
  loadBugs(projectId);
});

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

const apkBulk = createBulkSelector({
  checkboxSelector: '#apk-list .row-checkbox',
  selectAllId: 'apk-select-all',
  deleteBtnId: 'apk-bulk-delete',
  table: 'apk_shares',
  itemLabel: 'APK entry',
  onDeleted: async () => {
    showProjectDetails(detailsSelect.value);
  },
});

function renderApkShares(shares) {
  apkList.innerHTML = '';
  apkCount.textContent = shares.length ? `${shares.length} logged` : '';
  apkEmpty.style.display = shares.length ? 'none' : 'block';

  shares.forEach((a) => {
    const row = document.createElement('div');
    row.className = 'apk-row';
    row.innerHTML = `
      <div class="apk-row-checkbox-wrap"><input type="checkbox" class="row-checkbox" data-id="${a.id}" /></div>
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

  apkBulk.onRendered();
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

function tryParseTestCasesJson(raw) {
  let text = raw.trim();
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = text.indexOf('[');
  if (start === -1) return null;
  text = text.slice(start);

  // Try a straightforward parse first (handles a clean, complete paste)
  try {
    return JSON.parse(text);
  } catch { /* fall through to repair attempt below */ }

  // The paste may have been cut off partway through. Find the last fully
  // closed object in the array and salvage everything up to there.
  let depth = 0;
  let inString = false;
  let escape = false;
  let lastGoodEnd = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) lastGoodEnd = i;
    }
  }
  if (lastGoodEnd !== -1) {
    try {
      return JSON.parse(text.slice(0, lastGoodEnd + 1) + ']');
    } catch { /* give up below */ }
  }
  return null;
}

aiParseBtn.addEventListener('click', () => {
  clearFormError('ai-gen-error');
  aiPreview.classList.add('hidden');
  const raw = aiResponseText.value.trim();
  if (!raw) {
    showFormError('ai-gen-error', 'Paste the AI\'s reply above first.');
    return;
  }

  const parsed = tryParseTestCasesJson(raw);
  if (!parsed) {
    showFormError('ai-gen-error', 'Couldn\'t read that reply — the paste may have been cut off. Try copying the AI\'s reply again from the very start ("[") to the very end ("]").');
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

const reportsBulk = createBulkSelector({
  checkboxSelector: '#reports-list .card-checkbox',
  selectAllId: 'reports-select-all',
  deleteBtnId: 'reports-bulk-delete',
  table: 'daily_reports',
  itemLabel: 'entry',
  onDeleted: async () => {
    await loadReports();
  },
});

function renderReports(reports) {
  reportsList.innerHTML = '';
  reportsEmpty.style.display = reports.length ? 'none' : 'block';

  reports.forEach((r) => {
    const card = document.createElement('div');
    card.className = 'report-card has-checkbox';
    card.innerHTML = `
      <input type="checkbox" class="card-checkbox" data-id="${r.id}" />
      <div class="report-head">
        <span class="proj-name">${escapeHtml(r.projects ? r.projects.name : 'Unknown project')}</span>
        <span>${r.report_date}</span>
        ${r.project_manager ? `<span>PM: ${escapeHtml(r.project_manager)}</span>` : ''}
        ${r.logged_by_email ? `<span>Logged by: ${escapeHtml(r.logged_by_email)}</span>` : ''}
      </div>
      <button class="icon-btn report-edit" data-edit="${r.id}">edit</button>
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
    card.querySelector('[data-edit]').addEventListener('click', () => {
      openReportModal(r.id);
    });
    reportsList.appendChild(card);
  });

  reportsBulk.onRendered();
}

// ---------- Daily log detail / edit modal ----------

const reportModal = document.getElementById('report-modal');
const reportEditForm = document.getElementById('report-edit-form');
const reProjectSelect = document.getElementById('re-project');

function openReportModal(id) {
  const r = reportsCache.find((x) => x.id === id);
  if (!r) return;
  clearFormError('report-edit-error');
  reProjectSelect.innerHTML = projectsCache.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  document.getElementById('re-id').value = r.id;
  document.getElementById('re-date').value = r.report_date || '';
  reProjectSelect.value = r.project_id;
  document.getElementById('re-pm').value = r.project_manager || '';
  document.getElementById('re-tasks').value = r.assigned_tasks || '';
  document.getElementById('re-bugsheet').value = r.bugsheet || '';
  document.getElementById('re-testcases').value = r.test_cases ?? 0;
  document.getElementById('re-uibugs').value = r.ui_bugs ?? 0;
  document.getElementById('re-funcbugs').value = r.functionality_bugs ?? 0;
  document.getElementById('re-signoff').checked = !!r.sign_off;
  document.getElementById('re-remarks').value = r.remarks || '';
  document.getElementById('re-notes').value = r.notes || '';
  reportModal.classList.remove('hidden');
}

function closeReportModal() {
  reportModal.classList.add('hidden');
}

document.getElementById('report-modal-close').addEventListener('click', closeReportModal);
reportModal.addEventListener('click', (e) => {
  if (e.target === reportModal) closeReportModal();
});

reportEditForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFormError('report-edit-error');
  const id = document.getElementById('re-id').value;
  const project_id = reProjectSelect.value;
  if (!project_id) {
    showFormError('report-edit-error', 'Select a project.');
    return;
  }
  const reportDate = document.getElementById('re-date').value;
  if (!reportDate) {
    showFormError('report-edit-error', 'Date is required.');
    return;
  }
  const testCases = document.getElementById('re-testcases').value;
  const uiBugs = document.getElementById('re-uibugs').value;
  const funcBugs = document.getElementById('re-funcbugs').value;
  const numericFields = [
    ['Test cases', testCases],
    ['UI bugs', uiBugs],
    ['Functionality bugs', funcBugs],
  ];
  for (const [label, val] of numericFields) {
    if (val === '' || Number(val) < 0 || !Number.isInteger(Number(val))) {
      showFormError('report-edit-error', `${label} must be a whole number, 0 or higher.`);
      return;
    }
  }

  const payload = {
    report_date: reportDate,
    project_id,
    project_manager: document.getElementById('re-pm').value.trim() || null,
    assigned_tasks: document.getElementById('re-tasks').value.trim() || null,
    bugsheet: document.getElementById('re-bugsheet').value.trim() || null,
    test_cases: Number(testCases),
    ui_bugs: Number(uiBugs),
    functionality_bugs: Number(funcBugs),
    remarks: document.getElementById('re-remarks').value.trim() || null,
    sign_off: document.getElementById('re-signoff').checked,
    notes: document.getElementById('re-notes').value.trim() || null,
  };

  const { error } = await sb.from('daily_reports').update(payload).eq('id', id);
  if (error) {
    showFormError('report-edit-error', error.message);
    return;
  }
  notify(`${actorLabel()} updated a daily log entry`, 'daily_report', 'update');
  closeReportModal();
  loadReports();
});

document.getElementById('report-edit-delete').addEventListener('click', async () => {
  const id = document.getElementById('re-id').value;
  if (!id) return;
  if (!confirm('Remove this entry? This cannot be undone.')) return;
  const { error } = await sb.from('daily_reports').delete().eq('id', id);
  if (error) {
    showFormError('report-edit-error', error.message);
    return;
  }
  closeReportModal();
  loadReports();
});

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

// A "template" download is just headers + one filled-in example row, so a
// blank file always has something to download (unlike downloadSheet, which
// needs existing data).
function downloadTemplateSheet(filename, headers, exampleRow, sheetName) {
  const ws = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
  ws['!cols'] = headers.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'Template').slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

// Test execution → blank template matching the Add test case fields exactly,
// so filled-in rows can be copied straight into the form / a future import.
document.getElementById('download-tc-template-btn').addEventListener('click', () => {
  downloadTemplateSheet(
    'Test Cases Template',
    ['Title', 'Priority', 'Category', 'Status', 'Description', 'Notes'],
    [
      'Verify login with valid credentials',
      'High',
      'Functional',
      'Not Run',
      'Enter a valid username and password, click Login, verify the user lands on the dashboard',
      'Priority: Low/Medium/High. Category: Functional/Positive/Negative/Edge Case/Security/Validation/UI-UX/Performance/Accessibility/Compatibility/Regression/UAT. Status: Not Run/Pass/Fail/Blocked.',
    ],
    'Test Cases'
  );
});

// Bugs → blank template using the exact column headers the "Import bugs from
// Google Sheet" panel already recognizes (see BUG_HEADER_ALIASES), so a filled
// template can be copied straight into a Google Sheet and imported as-is.
document.getElementById('download-bugs-template-btn').addEventListener('click', () => {
  downloadTemplateSheet(
    'Bugs Template',
    ['Title', 'Page', 'Module', 'Sub Module', 'Severity', 'Issue Type', 'Status', 'Reported By', 'Reported Date', 'Closing Date', 'Steps to Reproduce', 'Expected Result', 'Actual Result', 'Description', 'Developer Status', 'Developer Comments', 'Retest Status', 'Manager Comments', 'Bug Id', 'Notes'],
    [
      'Login button unresponsive on checkout',
      'Checkout page',
      'University Admin',
      'Departments – Create Department',
      'High',
      'Functional',
      'Open',
      'Jane Doe',
      '2026-08-17',
      '',
      '1. Go to checkout page\n2. Fill in valid details\n3. Click Login',
      'User is redirected to the dashboard after logging in',
      'Nothing happens, button stays disabled',
      'Clicking the login button does not navigate anywhere',
      'Not Started',
      '',
      'Not Retested',
      '',
      'BUG-001',
      'Only reproduced on Chrome so far',
    ],
    'Bugs'
  );
});

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

// Bugs panel → downloads only the currently selected project's bugs.
document.getElementById('download-bugs-btn').addEventListener('click', () => {
  const id = bugsSelect.value;
  const p = projectsCache.find((x) => x.id === id);
  const rows = bugCache.map((b) => ({
    'Title': b.title,
    'Bug Id': b.bug_id || '',
    'Module': b.module || '',
    'Sub Module': b.sub_module || '',
    'Page': b.page,
    'Severity': b.severity,
    'Issue Type': b.issue_type || '',
    'Status': b.status,
    'Reported By': b.reported_by || '',
    'Reported Date': b.reported_date || '',
    'Closing Date': b.closed_date || '',
    'Steps to Reproduce': b.steps_to_reproduce || '',
    'Expected Result': b.expected_result || '',
    'Actual Result': b.actual_result || '',
    'Description': b.description || '',
    'Developer Status': b.developer_status || '',
    'Developer Comments': b.developer_comments || '',
    'Retest Status': b.retest_status || '',
    'Manager Comments': b.manager_comments || '',
    'Notes': b.notes || '',
  }));
  downloadSheet(`${safeFileName(p ? p.name : 'Project')} - Bugs`, rows, 'Bugs');
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
