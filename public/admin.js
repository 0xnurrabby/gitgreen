(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const state = { overview: null, detail: null, userId: null, tab: 'accounts' };

  function toast(msg, err = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (err ? ' err' : '');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), 3600);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    if (res.status === 401) {
      location.href = '/app';
      throw new Error('auth');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Show the real email when available, otherwise fall back to the username.
  function userLabel(u) {
    return u.email || u.github_login || u.username;
  }

  function ago(ts) {
    if (!ts) return '-';
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  // ---------- Navigation ----------
  function go(view) {
    $$('.nav-link').forEach((l) => l.classList.toggle('active', l.dataset.adminView === view));
    $$('.admin-view').forEach((v) => v.classList.toggle('active', v.id === 'admin-view-' + view));
    if (view === 'accounts') loadAllAccounts();
    closeMenu();
  }
  function openMenu() {
    $('.admin-side').classList.add('open');
    $('#admin-sidebar-scrim').classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  function closeMenu() {
    $('.admin-side').classList.remove('open');
    $('#admin-sidebar-scrim').classList.remove('show');
    document.body.style.overflow = '';
  }
  $('#admin-menu-btn').addEventListener('click', () => {
    if ($('.admin-side').classList.contains('open')) closeMenu(); else openMenu();
  });
  $('#admin-sidebar-scrim').addEventListener('click', closeMenu);
  $$('.nav-link').forEach((l) => l.addEventListener('click', () => go(l.dataset.adminView)));

  // ---------- Init ----------
  function showLock(msg) {
    $('#admin-lock').classList.remove('hidden');
    $('.admin-app').classList.add('hidden');
    $('#admin-password').value = '';
    $('#admin-lock-msg').textContent = msg || '';
    $('#admin-lock-msg').className = 'form-msg' + (msg ? ' err' : '');
    $('#admin-password').focus();
  }

  function hideLock() {
    $('#admin-lock').classList.add('hidden');
    $('.admin-app').classList.remove('hidden');
  }

  async function unlock(password) {
    const r = await api('/api/admin/login', { method: 'POST', body: { password } });
    return r.ok;
  }

  $('#admin-unlock-btn').addEventListener('click', async () => {
    const btn = $('#admin-unlock-btn');
    const input = $('#admin-password');
    if (!input.value) return showLock('Enter the admin password.');
    btn.disabled = true;
    try {
      await unlock(input.value);
      hideLock();
      await init();
    } catch (e) {
      showLock(e.message === 'wrong password' ? 'Wrong password.' : e.message);
    } finally {
      btn.disabled = false;
    }
  });
  $('#admin-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#admin-unlock-btn').click();
  });

  async function init() {
    try {
      const me = await api('/api/admin/me');
      if (me.needPassword) return showLock();
      $('#admin-me-name').textContent = me.user.email || ('@' + me.user.username);
      $('#admin-me-avatar').textContent = (me.user.email || me.user.username)[0].toUpperCase();
      await loadOverview();
    } catch (e) {
      if (e.message === 'not_admin') location.href = '/app';
    }
  }

  // ---------- Overview ----------
  async function loadOverview() {
    state.overview = await api('/api/admin/overview');
    try { const p = await api('/api/billing/plans'); state.subscriptionPlans = p.plans || []; } catch (e) { state.subscriptionPlans = []; }
    renderStats();
    renderUsersTable();
    renderUserCards();
  }

  function renderStats() {
    const t = state.overview.totals;
    const cards = [
      ['Users', t.users], ['GitHub accounts', t.accounts], ['Repos created', t.repos],
      ['Total commits', t.commits], ['Events logged', t.logs], ['Queued commits', t.queued]
    ];
    $('#admin-stats').innerHTML = cards.map(([l, n]) =>
      `<div class="stat-card"><span class="stat-label">${l}</span><span class="stat-num">${n}</span></div>`
    ).join('');
  }

  function renderUsersTable() {
    const q = ($('#admin-user-search').value || '').toLowerCase();
    const tbody = $('#admin-users-table tbody');
    const users = (state.overview.users || []).filter((u) => !q || userLabel(u).toLowerCase().includes(q) || (u.github_login || '').toLowerCase().includes(q));
    $('#admin-users-count').textContent = users.length;
    tbody.innerHTML = users.length ? users.map((u) => `
      <tr>
        <td><strong>${esc(userLabel(u))}</strong>${u.is_admin ? ' <span class="badge on">admin</span>' : ''}${u.privy_did ? ' <span class="badge" style="background:var(--accent-soft);color:var(--accent)">privy</span>' : ''}</td>
        <td>${new Date(u.created_at).toLocaleDateString()}</td>
        <td>${u.scheduler_enabled ? '<span class="badge on">on</span>' : '<span class="badge off">off</span>'}</td>
        <td>${u.accounts_n}</td>
        <td>${u.subscription ? esc(u.subscription.plan ? u.subscription.plan.name : u.subscription.plan_id) : '-'} ${u.subscription && u.subscription.active ? '<span class="badge on">active</span>' : '<span class="badge off">expired</span>'}</td>
        <td>${u.repos_n}</td>
        <td>${u.commits_n}</td>
        <td>${u.logs_n}</td>
        <td>${ago(u.last_active)}</td>
        <td><button class="btn btn-ghost btn-sm" data-open-user="${u.id}">View</button></td>
      </tr>
    `).join('') : '<tr><td colspan="9" class="empty">No users found.</td></tr>';
    $$('#admin-users-table [data-open-user]').forEach((b) => b.addEventListener('click', () => openUser(b.dataset.openUser)));
  }

  function renderUserCards() {
    const q = ($('#admin-user-search-2').value || '').toLowerCase();
    const box = $('#admin-user-cards');
    const users = (state.overview.users || []).filter((u) => !q || userLabel(u).toLowerCase().includes(q) || (u.github_login || '').toLowerCase().includes(q));
    box.innerHTML = users.length ? users.map((u) => `
      <div class="admin-user-card">
        <div class="account-top">
          <div class="account-avatar">${(u.email || u.github_login || u.username)[0].toUpperCase()}</div>
          <div>
            <h4>${esc(userLabel(u))}</h4>
            <span class="account-meta">created ${new Date(u.created_at).toLocaleDateString()}</span>
          </div>
          ${u.is_admin ? '<span class="badge on">admin</span>' : ''}
        </div>
        <div class="admin-user-meta">
          <span>${u.accounts_n} accounts</span><span>${u.subscription ? (u.subscription.plan ? u.subscription.plan.name : u.subscription.plan_id) : '-'} ${u.subscription && u.subscription.active ? '· active' : '· expired'}</span><span>${u.repos_n} repos</span><span>${u.commits_n} commits</span><span>last ${ago(u.last_active)}</span>
        </div>
        <div class="account-actions">
          <button class="btn btn-ghost" data-open-user="${u.id}">Manage</button>
        </div>
      </div>
    `).join('') : '<div class="empty">No users found.</div>';
    $$('#admin-user-cards [data-open-user]').forEach((b) => b.addEventListener('click', () => openUser(b.dataset.openUser)));
  }

  // ---------- All GitHub accounts (across all users) ----------
  let allAccounts = [];
  async function loadAllAccounts() {
    try {
      allAccounts = await api('/api/admin/accounts');
      renderAllAccounts();
    } catch (e) { /* handled */ }
  }
  function renderAllAccounts() {
    const q = ($('#admin-acc-search').value || '').toLowerCase();
    const box = $('#admin-acc-list');
    const list = allAccounts.filter((a) => !q ||
      (a.github_username || '').toLowerCase().includes(q) ||
      (a.owner_email || '').toLowerCase().includes(q) ||
      (a.owner_username || '').toLowerCase().includes(q));
    if (!list.length) { box.innerHTML = '<div class="empty">No GitHub accounts found.</div>'; return; }
    box.innerHTML = list.map((a) => `
      <div class="account-card">
        <div class="account-top">
          <div class="account-avatar"><img src="${esc(a.avatar_url || '')}" alt="" onerror="this.style.display='none'"></div>
          <div>
            <h4>@${esc(a.github_username)}</h4>
            <span class="account-meta">owner: ${esc(a.owner_email || ('@' + a.owner_username))}</span>
          </div>
          <span class="badge ${a.is_active ? 'on' : 'off'}" style="margin-left:auto">${a.is_active ? 'active' : 'paused'}</span>
        </div>
        <div class="account-meta">connected ${new Date(a.created_at).toLocaleDateString()}${a.last_error ? ' · error: ' + esc(a.last_error) : ''}</div>
        <div class="account-actions">
          <button class="btn btn-ghost" data-open-owner="${a.user_id}">View owner</button>
          <button class="btn btn-ghost" data-admin-remove-acc="${a.id}" style="color:var(--red)">Remove</button>
        </div>
      </div>
    `).join('');
    $$('#admin-acc-list [data-open-owner]').forEach((b) => b.addEventListener('click', () => openUser(b.dataset.openOwner)));
    $$('#admin-acc-list [data-admin-remove-acc]').forEach((b) => b.addEventListener('click', async () => {
      const a = allAccounts.find((x) => x.id === Number(b.dataset.adminRemoveAcc));
      if (!confirm(`Remove GitHub account @${a.github_username} and ALL its repos/plans? This cannot be undone.`)) return;
      await api('/api/admin/accounts/' + b.dataset.adminRemoveAcc, { method: 'DELETE' });
      toast('Account removed.');
      await loadAllAccounts();
      await loadOverview();
    }));
  }

  // ---------- User detail ----------
  async function openUser(id) {
    state.userId = id;
    go('detail');
    $('#admin-detail-title').textContent = 'Loading user...';
    try {
      state.detail = await api('/api/admin/users/' + id);
      renderDetail();
    } catch (e) { /* handled */ }
  }

  function renderDetail() {
    const u = state.detail.user;
    $('#admin-detail-title').textContent = userLabel(u);

    const actions = [
      `<button class="btn btn-ghost" id="admin-toggle-user">${state.detail.settings.scheduler_enabled ? 'Pause autopilot' : 'Resume autopilot'}</button>`,
      `<button class="btn btn-ghost" id="admin-toggle-admin">${u.is_admin ? 'Revoke admin' : 'Make admin'}</button>`,
      `<button class="btn btn-ghost" id="admin-regenerate" style="color:var(--amber)">Regenerate plans</button>`,
      `<button class="btn btn-ghost" id="admin-delete-user" style="color:var(--red)">Delete user</button>`
    ];
    $('#admin-detail-actions').innerHTML = actions.join('');

    $('#admin-toggle-user').addEventListener('click', async () => {
      const on = state.detail.settings.scheduler_enabled;
      await api(`/api/admin/users/${state.userId}/${on ? 'pause' : 'resume'}`, { method: 'POST' });
      toast(on ? 'Autopilot paused.' : 'Autopilot resumed.');
      await openUser(state.userId);
      await loadOverview();
    });
    $('#admin-toggle-admin').addEventListener('click', async () => {
      await api(`/api/admin/users/${state.userId}/set-admin`, { method: 'POST', body: { admin: !u.is_admin } });
      toast(u.is_admin ? 'Admin revoked.' : 'User is now admin.');
      await openUser(state.userId);
      await loadOverview();
    });
    $('#admin-regenerate').addEventListener('click', async () => {
      if (!confirm('Regenerate this user\'s 14-day plans?')) return;
      await api(`/api/admin/users/${state.userId}/regenerate-plans`, { method: 'POST' });
      toast('Plans regenerated.');
      await openUser(state.userId);
    });
    $('#admin-delete-user').addEventListener('click', async () => {
      if (!confirm(`Delete user @${u.username} and ALL their data? This cannot be undone.`)) return;
      await api(`/api/admin/users/${state.userId}`, { method: 'DELETE' });
      toast('User deleted.');
      state.userId = null;
      go('overview');
      await loadOverview();
    });

    renderTab();
  }

  // ---------- Tabs ----------
  $$('.admin-tab').forEach((t) => t.addEventListener('click', () => {
    $$('.admin-tab').forEach((x) => x.classList.toggle('active', x === t));
    $$('.admin-tab-pane').forEach((p) => p.classList.remove('active'));
    state.tab = t.dataset.tab;
    $('#' + state.tab + '-tab-pane')?.classList.add('active');
    renderTab();
  }));

  function renderTab() {
    if (!state.detail) return;
    switch (state.tab) {
      case 'accounts': renderAccounts(); break;
      case 'projects': renderProjects(); break;
      case 'plans': renderPlans(); break;
      case 'logs': renderLogs(); break;
      case 'settings': renderSettings(); break;
      case 'queue': renderQueue(); break;
      case 'subscription': renderSubscription(); break;
    }
  }

  // Accounts
  function renderAccounts() {
    const box = $('#admin-tab-accounts');
    const accs = state.detail.accounts;
    if (!accs.length) { box.innerHTML = '<div class="empty">No GitHub accounts connected.</div>'; return; }
    box.innerHTML = accs.map((a) => `
      <div class="account-card">
        <div class="account-top">
          <div class="account-avatar"><img src="${esc(a.avatar_url || '')}" alt="" onerror="this.style.display='none'"></div>
          <div>
            <h4>@${esc(a.github_username)}</h4>
            <a href="${esc(a.profile_url)}" target="_blank" rel="noopener">${esc(a.profile_url)}</a>
          </div>
          <span class="badge ${a.is_active ? 'on' : 'off'}" style="margin-left:auto">${a.is_active ? 'active' : 'paused'}</span>
        </div>
        <div class="account-meta">added ${new Date(a.created_at).toLocaleDateString()} · last used ${ago(a.last_used_at)}${a.last_error ? '<br><span style="color:var(--red)">error: ' + esc(a.last_error) + '</span>' : ''}</div>
        <div class="account-actions">
          <button class="btn btn-ghost" data-toggle-acc="${a.id}">${a.is_active ? 'Pause' : 'Resume'}</button>
          <button class="btn btn-primary" data-run-today="${a.id}">Run today's task</button>
          <button class="btn btn-ghost" data-run-now="${a.id}">Run now</button>
          <button class="btn btn-ghost" data-remove-acc="${a.id}" style="color:var(--red)">Remove</button>
        </div>
      </div>
    `).join('');
    bindAccountActions();
  }

  function bindAccountActions() {
    $$('#admin-tab-accounts [data-toggle-acc]').forEach((b) => b.addEventListener('click', async () => {
      await api(`/api/admin/users/${state.userId}/accounts/${b.dataset.toggleAcc}/activate`, { method: 'POST', body: { active: b.textContent === 'Resume' } });
      toast('Account updated.');
      await openUser(state.userId);
    }));
    $$('#admin-tab-accounts [data-run-today]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'Scheduling...';
      try {
        const r = await api(`/api/admin/users/${state.userId}/run-today`, { method: 'POST', body: { accountId: Number(b.dataset.runToday) } });
        toast(`Queued ${r.total} commits across ${r.batches} batch${r.batches > 1 ? 'es' : ''} for today.`);
        await openUser(state.userId);
      } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = "Run today's task"; }
    }));
    $$('#admin-tab-accounts [data-run-now]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const r = await api(`/api/admin/users/${state.userId}/run-now`, { method: 'POST', body: { accountId: Number(b.dataset.runNow), commits: 3 } });
        toast(`Pushed ${r.commits} commits now.`);
        await openUser(state.userId);
      } catch (e) { toast(e.message, true); b.disabled = false; }
    }));
    $$('#admin-tab-accounts [data-remove-acc]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remove this GitHub account and all its repos/plans?')) return;
      await api(`/api/admin/users/${state.userId}/accounts/${b.dataset.removeAcc}`, { method: 'DELETE' });
      toast('Account removed.');
      await openUser(state.userId);
    }));
  }

  // Projects
  function renderProjects() {
    const box = $('#admin-tab-projects');
    const rows = state.detail.projects;
    if (!rows.length) { box.innerHTML = '<div class="empty">No repos created yet.</div>'; return; }
    box.innerHTML = `<div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>Repo</th><th>Category</th><th>Commits</th><th>Pushed</th><th></th></tr></thead>
      <tbody>${rows.map((p) => `
        <tr>
          <td><strong>${esc(p.repo_name || p.slug)}</strong></td>
          <td>${esc(p.category)}</td>
          <td>${p.commits_done}</td>
          <td>${ago(p.pushed_at)}</td>
          <td>${p.repo_url ? `<a href="${esc(p.repo_url)}" target="_blank" rel="noopener">open ↗</a>` : ''}</td>
        </tr>`).join('')}
      </tbody></table></div>`;
  }

  // Plans
  function renderPlans() {
    const box = $('#admin-tab-plans');
    const plans = state.detail.plans;
    if (!plans.length) { box.innerHTML = '<div class="empty">No plans.</div>'; return; }
    box.innerHTML = plans.map((p) => {
      const acc = state.detail.accounts.find((a) => a.id === p.account_id);
      const sessions = (p.sessions || []).map((s) =>
        `<span class="session-chip">${s.start} <span class="c">${(s.commits || []).length} commits</span></span>`).join('');
      const total = (p.sessions || []).reduce((a, s) => a + (s.commits || []).length, 0);
      return `<div class="plan-card">
        <div class="plan-head">
          <h4>${new Date(p.plan_date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}${p.done ? ' <span class="badge on">done</span>' : ''}</h4>
          <span class="plan-date">${acc ? '@' + acc.github_username : ''} · ${total} commits</span>
        </div>
        <div class="session-list">${sessions || '<span class="plan-empty">rest day</span>'}</div>
      </div>`;
    }).join('');
  }

  // Logs
  function renderLogs() {
    const box = $('#admin-tab-logs');
    const logs = state.detail.logs;
    if (!logs.length) { box.innerHTML = '<div class="empty">No activity yet.</div>'; return; }
    box.innerHTML = `<div class="logs">${logs.map((l) => `
      <div class="log-line">
        <span class="log-time">${new Date(l.created_at).toLocaleString()}</span>
        <span class="log-kind ${l.kind}">${l.kind}</span>
        <span class="log-msg">${l.ok ? '' : '❌ '}${esc(l.message).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')} ${l.account_name ? '@' + esc(l.account_name) : ''}</span>
      </div>`).join('')}</div>`;
  }

  // Settings
  function renderSettings() {
    const box = $('#admin-tab-settings');
    const s = state.detail.settings;
    box.innerHTML = `
      <div class="panel" style="max-width:520px">
        <div class="setting-row">
          <div><h4>Autopilot scheduler</h4><p class="muted">Let the app plan and push on its own.</p></div>
          <label class="switch"><input type="checkbox" id="adm-set-enabled" ${s.scheduler_enabled ? 'checked' : ''}><span></span></label>
        </div>
        <div class="setting-row">
          <div><h4>Full day share</h4><p class="muted">Chance a day is a full random amount.</p></div>
          <div class="range-wrap"><input type="range" id="adm-set-activepct" min="50" max="100" value="${s.active_day_pct}"><output>${s.active_day_pct}%</output></div>
        </div>
        <div class="setting-row">
          <div><h4>Min commits / day</h4></div>
          <input type="number" id="adm-set-min" min="1" max="100" value="${s.min_commits}" style="width:90px" class="field input">
        </div>
        <div class="setting-row">
          <div><h4>Max commits / day</h4></div>
          <input type="number" id="adm-set-max" min="1" max="300" value="${s.max_commits}" style="width:90px">
        </div>
        <div class="setting-row">
          <div><h4>Active hours</h4><p class="muted">Commit window start/end (BD).</p></div>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="number" id="adm-set-hstart" min="0" max="23" value="${s.hourly_start}" style="width:70px"> →
            <input type="number" id="adm-set-hend" min="0" max="23" value="${s.hourly_end}" style="width:70px">
          </div>
        </div>
        <button class="btn btn-primary btn-block" id="adm-save-settings">Save settings</button>
      </div>`;
    $('#adm-set-activepct').addEventListener('input', (e) => { $('#adm-set-activepct + output').textContent = e.target.value + '%'; });
    $('#adm-save-settings').addEventListener('click', async () => {
      await api(`/api/admin/users/${state.userId}/settings`, {
        method: 'POST',
        body: {
          active_day_pct: Number($('#adm-set-activepct').value),
          min_commits: Number($('#adm-set-min').value),
          max_commits: Number($('#adm-set-max').value),
          hourly_start: Number($('#adm-set-hstart').value),
          hourly_end: Number($('#adm-set-hend').value),
          scheduler_enabled: $('#adm-set-enabled').checked ? 1 : 0
        }
      });
      toast('Settings saved.');
      await openUser(state.userId);
    });
  }

  // Today's queue
  function renderQueue() {
    const box = $('#admin-tab-queue');
    const rows = state.detail.queue || [];
    if (!rows.length) { box.innerHTML = '<div class="empty">No manual run is queued for today. Use "Run today\'s task" on an account to schedule one.</div>'; return; }
    const pending = rows.filter((r) => !r.executed);
    const done = rows.filter((r) => r.executed);
    box.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>Schedule</h3><span class="muted">${done.length}/${rows.length} executed</span></div>
        <div class="admin-queue-bar"><div class="admin-queue-fill" style="width:${Math.round(done.length / rows.length * 100)}%"></div></div>
        <div class="queue-list">${rows.map((r) => `
          <div class="queue-row ${r.executed ? 'done' : ''}">
            <span class="queue-time">${new Date(r.scheduled_at).toLocaleString()}</span>
            <span class="queue-state">${r.executed ? '✓ executed' : 'pending'}</span>
          </div>`).join('')}</div>
      </div>`;
  }

  // Subscription
  function renderSubscription() {
    const box = $('#admin-tab-subscription');
    const sub = state.detail.subscription;
    const plans = (state.subscriptionPlans || []).length ? state.subscriptionPlans : [
      { id: 'free', name: 'Free Trial', accounts: 1, price: 0 },
      { id: 'starter', name: 'Starter', accounts: 5, price: 3 },
      { id: 'pro', name: 'Pro', accounts: 10, price: 5 },
      { id: 'pro_plus', name: 'Pro Plus', accounts: 30, price: 10 },
      { id: 'max', name: 'Max', accounts: 100, price: 20 }
    ];
    const active = sub && sub.active;
    const planName = sub && sub.plan ? sub.plan.name : (sub ? sub.plan_id : 'none');
    const expires = sub && sub.expires_at ? new Date(sub.expires_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '-';
    const daysLeft = sub && sub.days_left != null ? sub.days_left : 0;
    const limit = active ? sub.account_limit : 0;

    const planOptions = plans.map((p) => '<option value="' + p.id + '" ' + (sub && sub.plan_id === p.id ? 'selected' : '') + '>' + p.name + ' - $' + p.price + '/mo (' + p.accounts + ' acc)</option>').join('');

    const payments = (state.detail.payments || []).map((p) => `
      <div class="queue-row">
        <span class="queue-time">${new Date(p.created_at).toLocaleString()}</span>
        <span class="queue-state">${esc(p.plan_id)} · $${p.amount_usd} · <span class="${p.status === 'finished' ? '' : ''}">${esc(p.status)}</span>${p.applied ? ' · applied' : ''}</span>
      </div>`).join('') || '<div class="empty">No payments yet.</div>';

    box.innerHTML = `
      <div class="panel" style="max-width:560px">
        <div class="panel-head"><h3>Subscription</h3><span class="muted">Manage this user's plan, days and account limit.</span></div>
        <div class="plan-current-stats" style="margin-bottom:16px">
          <div class="pcs"><span class="pcs-l">Plan</span><span class="pcs-v">${esc(planName)}</span></div>
          <div class="pcs"><span class="pcs-l">Status</span><span class="pcs-v">${active ? '<span style="color:var(--green)">active</span>' : '<span style="color:var(--red)">' + esc(sub ? sub.status : 'none') + '</span>'}</span></div>
          <div class="pcs"><span class="pcs-l">Expires</span><span class="pcs-v">${expires}</span></div>
          <div class="pcs"><span class="pcs-l">Days left</span><span class="pcs-v">${daysLeft}</span></div>
          <div class="pcs"><span class="pcs-l">Accounts</span><span class="pcs-v">${sub ? sub.accounts_used : 0} / ${limit}</span></div>
        </div>

        <label class="field"><span>Set plan</span><select id="adm-sub-plan" class="select">${planOptions}</select></label>
        <div class="setting-row">
          <div><h4>Give days</h4><p class="muted">Adds this many days to the current expiry (use -N to subtract).</p></div>
          <input type="number" id="adm-sub-days" value="30" style="width:110px">
        </div>
        <div class="setting-row">
          <div><h4>Account limit</h4><p class="muted">Set a custom account limit (overrides the plan's default).</p></div>
          <input type="number" id="adm-sub-limit" value="${limit}" style="width:110px">
        </div>
        <div class="account-actions">
          <button class="btn btn-primary" id="adm-sub-save">Apply subscription</button>
          <button class="btn btn-ghost" id="adm-sub-grant">Grant 30 days</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Payment history</h3><span class="muted">Crypto orders for this user.</span></div>
        <div class="queue-list">${payments}</div>
      </div>`;

    $('#adm-sub-save').addEventListener('click', async () => {
      const planId = $('#adm-sub-plan').value;
      const days = Number($('#adm-sub-days').value);
      const limit = Number($('#adm-sub-limit').value);
      try {
        await api(`/api/admin/users/${state.userId}/subscription`, { method: 'POST', body: { planId, days, limit } });
        toast('Subscription updated.');
        await openUser(state.userId);
        await loadOverview();
      } catch (e) { toast(e.message, true); }
    });
    $('#adm-sub-grant').addEventListener('click', async () => {
      const planId = $('#adm-sub-plan').value;
      try {
        await api(`/api/admin/users/${state.userId}/subscription`, { method: 'POST', body: { planId, days: 30 } });
        toast('Granted 30 days of ' + planId + '.');
        await openUser(state.userId);
        await loadOverview();
      } catch (e) { toast(e.message, true); }
    });
  }

  // ---------- Events ----------
  const adminThemeBtn = $('#admin-theme-btn');
  function updateAdminThemeBtn() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (adminThemeBtn) adminThemeBtn.textContent = dark ? '☀ Light mode' : '☾ Dark mode';
  }
  updateAdminThemeBtn();
  adminThemeBtn.addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = dark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('gg-theme', next); } catch (e) {}
    updateAdminThemeBtn();
  });

  $('#admin-refresh').addEventListener('click', async () => { await loadOverview(); toast('Refreshed.'); });
  $('#admin-back').addEventListener('click', () => go('users'));
  $('#admin-user-search').addEventListener('input', renderUsersTable);
  $('#admin-user-search-2').addEventListener('input', renderUserCards);
  $('#admin-acc-search').addEventListener('input', renderAllAccounts);
  $('#admin-logout-btn').addEventListener('click', async () => {
    try {
      if (window.__gitgreenPrivyLogout) { try { await window.__gitgreenPrivyLogout(); } catch (e) {} }
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && /privy|walletconnect|walletlink|wagmi|rainbow|crossmint/i.test(k)) keys.push(k);
      }
      keys.forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
      try { sessionStorage.clear(); } catch (e) {}
      await api('/api/auth/logout', { method: 'POST' });
    } catch (e) {}
    location.href = '/';
  });

  init();
})();
