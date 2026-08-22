(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const state = { user: null, stats: null, catalog: [], accounts: [], projects: [], plans: [], settings: {}, oauth: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toast(msg, err = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (err ? ' err' : '');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), 3200);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.code = data.code || null;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ---------- Privy auth ----------
  function closeModal(id) { $('#' + id).classList.add('hidden'); }

  window.addEventListener('gitgreen:login', (e) => {
    state.user = e.detail;
    if (e.detail && e.detail.is_admin) $('#nav-admin-link').classList.remove('hidden');
    renderMe();
    enterApp();
  });

  function clearPrivyStorage() {
    // Privy persists its login session in localStorage. If it is not cleared,
    // the next visit auto-logs-in as the previous account instead of asking for
    // email again. Nuke every key that belongs to Privy / wallet connectors.
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /privy|walletconnect|walletlink|wagmi|rainbow|crossmint/i.test(k)) keys.push(k);
    }
    keys.forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
    try { sessionStorage.clear(); } catch (e) {}
  }

  $('#logout-btn').addEventListener('click', async () => {
    try {
      if (window.__gitgreenPrivyLogout) { try { await window.__gitgreenPrivyLogout(); } catch (e) {} }
      clearPrivyStorage();
      await api('/api/auth/logout', { method: 'POST' });
    } catch (e) { /* server session may already be gone */ }
    location.href = '/';
  });

  // Theme toggle (light is the default)
  const themeBtn = $('#theme-btn');
  function updateThemeBtn() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (themeBtn) themeBtn.textContent = dark ? '☀ Light mode' : '☾ Dark mode';
  }
  updateThemeBtn();
  themeBtn.addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = dark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('gg-theme', next); } catch (e) {}
    updateThemeBtn();
  });

  $$('.modal-close').forEach((b) => b.addEventListener('click', () => closeModal(b.dataset.close)));
  $$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) closeModal(m.id); }));

  async function enterApp() {
    $('#auth-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    clearAuthRetry();
    renderMe();
    try {
      await Promise.all([loadStats(), loadAccounts(), loadCatalog(), loadProjects(), loadPlans(), loadLogs(), loadSettings(), loadSubscription()]);
      await refreshPushAll();
    } catch (e) {
      console.error('Failed to load dashboard data', e);
    }
    if (state.accounts.length === 0) {
      go('accounts');
      toast('Connect your first GitHub account to get started.');
    }
  }

  function renderMe() {
    if (!state.user) return;
    const name = state.user.email || ('@' + state.user.username);
    $('#me-name').textContent = name;
    $('#me-avatar').textContent = (state.user.email || state.user.username)[0].toUpperCase();
  }

  // ---------- Navigation ----------
  function go(view) {
    $$('.nav-link').forEach((l) => l.classList.toggle('active', l.dataset.view === view));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    if (view === 'dashboard') refreshCountdown();
    closeMenu();
  }
  function openMenu() {
    $('.sidebar').classList.add('open');
    $('#sidebar-scrim').classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  function closeMenu() {
    $('.sidebar').classList.remove('open');
    $('#sidebar-scrim').classList.remove('show');
    document.body.style.overflow = '';
  }
  $('#menu-btn').addEventListener('click', () => {
    if ($('.sidebar').classList.contains('open')) closeMenu(); else openMenu();
  });
  $('#sidebar-scrim').addEventListener('click', closeMenu);
  $$('.nav-link').forEach((l) => l.addEventListener('click', () => go(l.dataset.view)));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => go(b.dataset.goto)));

  // ---------- Next-commit countdown (computed locally, no polling pressure) ----------
  let countdownTarget = null;
  let countdownTimer = null;
  let countdownRetry = null;

  function fmtCountdown(ms) {
    if (ms == null || ms <= 0) return '-';
    const s = Math.max(0, Math.ceil(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    return `${m}m ${String(sec).padStart(2, '0')}s`;
  }

  function startCountdown() {
    clearInterval(countdownTimer);
    clearTimeout(countdownRetry);
    if (!countdownTarget) return;
    countdownTimer = setInterval(() => {
      const remain = countdownTarget - Date.now();
      const el = $('#countdown-time');
      if (remain <= 0) {
        // A commit just became due; refresh immediately so we never sit on a
        // stale "running…" - the next target (or a progress count) shows next.
        clearInterval(countdownTimer);
        countdownRetry = setTimeout(refreshCountdown, 2500);
      } else {
        el.textContent = fmtCountdown(remain);
      }
    }, 1000);
  }

  async function refreshCountdown() {
    clearInterval(countdownTimer);
    clearTimeout(countdownRetry);
    const accountId = $('#run-account').value;
    const el = $('#countdown-time');
    const chip = $('#countdown-chip');
    if (!chip) return;
    if (!accountId && (!state.stats || !state.stats.accounts || state.stats.accounts.length === 0)) {
      countdownTarget = null;
      el.textContent = '-';
      return;
    }
    try {
      const q = accountId ? '?accountId=' + encodeURIComponent(accountId) : '';
      const r = await api('/api/next-commit' + q);
      const pending = r.pending || 0;
      if (!r.scheduledAt) {
        countdownTarget = null;
        if (pending > 0) {
          // Commits are queued but the next one isn't time-based yet (or is
          // being processed). Show live progress instead of "running…".
          chip.classList.remove('none');
          el.textContent = pending + ' queued';
          chip.title = pending + ' queued commit(s) waiting to be pushed';
          countdownRetry = setTimeout(refreshCountdown, 8000);
        } else {
          chip.classList.add('none');
          el.textContent = '-';
          chip.title = 'No commits are scheduled right now';
        }
        return;
      }
      chip.classList.remove('none');
      if (r.scheduledAt <= Date.now()) {
        // Due now / being processed. Show "now" and the number left, and keep
        // refreshing so it never looks stuck.
        countdownTarget = null;
        el.textContent = pending > 0 ? ('now · ' + pending + ' left') : 'now';
        chip.title = pending > 0 ? pending + ' queued commit(s) being pushed' : 'A commit is being pushed right now';
        countdownRetry = setTimeout(refreshCountdown, 4000);
      } else {
        countdownTarget = r.scheduledAt;
        el.textContent = fmtCountdown(r.scheduledAt - Date.now());
        chip.title = 'Estimated time until the next commit';
        startCountdown();
      }
    } catch (e) { /* ignore, next refresh retries */ }
  }

  // ---------- Dashboard ----------
  function updateRunButtons() {
    const hasAccount = !!$('#run-account').value;
    const hasAny = !!state.stats && (state.stats.accounts || []).length > 0;
    // "All accounts" runs for every connected account, so only disable when
    // there is nothing to run at all.
    $('#run-now-btn').disabled = !(hasAccount || hasAny);
    $('#run-today-btn').disabled = !(hasAccount || hasAny);
  }

  async function loadStats() {
    const accountId = $('#run-account').value;
    state.stats = await api('/api/stats' + (accountId ? '?accountId=' + encodeURIComponent(accountId) : ''));
    $('#stat-repos').textContent = state.stats.totalRepos;
    $('#stat-commits').textContent = state.stats.totalCommits;
    $('#stat-streak').innerHTML = state.stats.streak + '<span class="stat-unit">days</span>';
    $('#stat-events').textContent = state.stats.totalLogs;
    renderHeatmap(state.stats.byDay || {});
    renderUpcoming(state.stats.planned || []);

    const sel = $('#run-account');
    const active = state.stats.accounts || [];
    const previous = accountId;
    sel.innerHTML = '';
    if (active.length === 0) {
      sel.innerHTML = '<option value="">No accounts</option>';
    } else {
      const allOpt = document.createElement('option');
      allOpt.value = '';
      allOpt.textContent = 'All accounts';
      sel.appendChild(allOpt);
      active.forEach((a) => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = '@' + a.github_username;
        sel.appendChild(opt);
      });
      if (previous && active.some((a) => String(a.id) === String(previous))) {
        sel.value = previous;
      } else {
        sel.value = '';
      }
    }
    updateRunButtons();
    refreshCountdown();
  }

  function renderHeatmap(byDay) {
    const box = $('#heatmap');
    box.innerHTML = '';
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - (52 * 7 - 1));
    const dayKeys = new Set(Object.keys(byDay));
    const weeks = [];
    const d = new Date(start);
    while (d <= end) {
      const col = [];
      for (let i = 0; i < 7; i++) {
        col.push(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() + 1);
      }
      weeks.push(col);
      if (d > end) break;
    }
    const levels = [0, 1, 4, 9, 15];
    for (const col of weeks) {
      const el = document.createElement('div');
      el.className = 'hm-col';
      for (const ds of col) {
        const cell = document.createElement('div');
        let lvl = 0;
        if (dayKeys.has(ds)) {
          const n = byDay[ds];
          lvl = levels.reduce((a, v, idx) => (n >= v ? idx : a), 0);
        }
        cell.className = 'hm-cell l' + lvl;
        cell.title = ds + (dayKeys.has(ds) ? ': ' + byDay[ds] + ' commits' : '');
        el.appendChild(cell);
      }
      box.appendChild(el);
    }
    $('#heat-range').textContent = (state.stats.selectedAccount ? '@' + state.stats.selectedAccount + ' · ' : '') + start.toISOString().slice(0, 10) + ' - ' + end.toISOString().slice(0, 10);
  }

  function renderUpcoming(planned) {
    const box = $('#upcoming');
    box.innerHTML = '';
    if (!planned.length) { box.innerHTML = '<div class="empty">No plan yet. Connect an account.</div>'; return; }
    const today = new Date().toISOString().slice(0, 10);
    planned.forEach((p) => {
      const el = document.createElement('div');
      el.className = 'up-item' + (p.commits === 0 ? ' off' : '') + (p.done ? ' done' : '');
      const label = new Date(p.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
      el.innerHTML = `<div class="d">${label}${p.date === today ? ' <span class="dot-now"></span>' : ''}</div><div class="n">${p.commits}</div><div class="d">commits</div>`;
      box.appendChild(el);
    });
  }

  // ---------- Accounts ----------
  async function loadAccounts() {
    state.accounts = await api('/api/accounts');
    renderMe();
    renderProjAccountSelect();
    let health = {};
    try { health = await api('/api/accounts/health'); health = Array.isArray(health) ? health : []; } catch (e) { health = []; }
    const box = $('#accounts-list');
    box.innerHTML = '';
    const sub = state.subscription || {};
    const limit = sub.active ? sub.account_limit : 0;
    const headActions = $('#view-accounts .view-head .head-actions') || null;
    if (!headActions) {
      const btn = document.createElement('div');
      btn.className = 'head-actions';
      btn.innerHTML = '<span class="muted" style="font-size:13px">' + state.accounts.length + ' of ' + (limit || 0) + ' account' + (limit === 1 ? '' : 's') + ' used</span>';
      const header = $('#view-accounts .view-head');
      if (header) header.appendChild(btn);
    }
    if (state.accounts.length === 0) {
      box.innerHTML = '<div class="empty"><div class="big">🔗</div>No GitHub accounts connected yet.<br>Add one to start the autopilot.</div>';
      return;
    }
    state.accounts.forEach((a) => {
      try {
        const el = document.createElement('div');
        el.className = 'account-card';
        const source = a.is_oauth ? '<span class="badge on" style="margin-left:auto">oauth</span>' : `<span class="badge ${a.is_active ? 'on' : 'off'}" style="margin-left:auto">${a.is_active ? 'active' : 'paused'}</span>`;
        const h = health.find((x) => String(x.id) === String(a.id));
        const healthBadge = h && h.errorsToday > 0
          ? `<span class="badge off" title="${esc(h.last_error || '')}">${h.errorsToday} issue${h.errorsToday > 1 ? 's' : ''} today</span>`
          : '<span class="badge on">healthy</span>';
        el.innerHTML = `
          <div class="account-top">
            <input type="checkbox" class="acc-sel" data-id="${a.id}" title="Select this account" ${a.is_active ? '' : ''}>
            <div class="account-avatar"><img src="${esc(a.avatar_url || '')}" alt="" onerror="this.style.display='none'"></div>
            <div>
              <h4>@${esc(a.github_username)}</h4>
              <a href="${esc(a.profile_url || '')}" target="_blank" rel="noopener">${esc(a.profile_url || '')}</a>
            </div>
            ${source}
          </div>
          <div class="account-meta">connected ${new Date(a.created_at).toLocaleDateString()} · ${healthBadge}</div>
          <div class="account-actions">
            <button class="btn btn-ghost" data-toggle="${a.id}">${a.is_active ? 'Pause' : 'Resume'}</button>
            <button class="btn btn-ghost" data-settings="${a.id}">Settings</button>
            <button class="btn btn-ghost" data-remove="${a.id}" style="color:var(--red)">Remove</button>
          </div>
          <div class="acc-settings" id="acc-settings-${a.id}" style="display:none"></div>`;
        box.appendChild(el);
      } catch (e) {
        console.error('[app] account card render failed:', a.github_username, e);
      }
    });
    if (box.childElementCount === 0) {
      box.innerHTML = '<div class="empty"><div class="big">🔗</div>Your accounts could not be displayed.<br>Refresh or try again.</div>';
    }
    $$('#accounts-list [data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      await api('/api/accounts/' + b.dataset.toggle + '/activate', { method: 'POST', body: { active: b.textContent === 'Resume' } });
      await Promise.all([loadAccounts(), loadStats()]);
    }));
    $$('#accounts-list [data-settings]').forEach((b) => b.addEventListener('click', () => toggleAccountSettings(b.dataset.settings)));
    $$('#accounts-list [data-remove]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remove this GitHub account?')) return;
      await api('/api/accounts/' + b.dataset.remove, { method: 'DELETE' });
      await Promise.all([loadAccounts(), loadStats()]);
      toast('Account removed.');
    }));
    bindBulk();
  }

  let selectedAccounts = new Set();
  function bindBulk() {
    const selAll = $('#bulk-select-all');
    if (!selAll) return;
    selectedAccounts = new Set($$('.acc-sel:checked').map((c) => Number(c.dataset.id)));
    updateBulkCount();
    $$('.acc-sel').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) selectedAccounts.add(Number(c.dataset.id));
      else selectedAccounts.delete(Number(c.dataset.id));
      const all = $$('.acc-sel');
      selAll.checked = all.length > 0 && all.every((x) => x.checked);
      updateBulkCount();
    }));
    selAll.addEventListener('change', () => {
      $$('.acc-sel').forEach((c) => { c.checked = selAll.checked; });
      selectedAccounts = selAll.checked ? new Set($$('.acc-sel').map((c) => Number(c.dataset.id))) : new Set();
      updateBulkCount();
    });
    $('#bulk-off').addEventListener('click', async () => await bulkSetActive(0));
    $('#bulk-on').addEventListener('click', async () => await bulkSetActive(1));
  }
  function updateBulkCount() {
    const el = $('#bulk-count');
    if (el) el.textContent = selectedAccounts.size ? selectedAccounts.size + ' selected' : '';
  }
  async function bulkSetActive(active) {
    if (selectedAccounts.size === 0) { toast('Select at least one account.', true); return; }
    await api('/api/accounts/set-active', { method: 'POST', body: { ids: [...selectedAccounts], active } });
    toast(active ? 'Selected accounts turned on.' : 'Selected accounts turned off.');
    await Promise.all([loadAccounts(), loadStats()]);
  }

  function toggleAccountSettings(id) {
    const panel = $('#acc-settings-' + id);
    const acc = state.accounts.find((a) => String(a.id) === String(id));
    if (!acc) return;
    if (panel.style.display === 'none') {
      const s = acc.settings || {};
      panel.innerHTML = `
        <div class="acc-settings-inner">
          <div class="setting-row">
            <div><h4>Autopilot</h4><p class="muted">Let this account run on its own.</p></div>
            <label class="switch"><input type="checkbox" class="as-enabled" ${acc.is_active ? 'checked' : ''}><span></span></label>
          </div>
          <div class="setting-row">
            <div><h4>Min commits / day</h4></div>
            <input type="number" class="as-min" value="${s.min_commits != null ? s.min_commits : ''}" placeholder="use global" style="width:100px">
          </div>
          <div class="setting-row">
            <div><h4>Max commits / day</h4></div>
            <input type="number" class="as-max" value="${s.max_commits != null ? s.max_commits : ''}" placeholder="use global" style="width:100px">
          </div>
          <div class="setting-row">
            <div><h4>Sessions / day</h4></div>
            <input type="number" class="as-sessions" value="${s.sessions_per_day != null ? s.sessions_per_day : ''}" placeholder="use global" style="width:100px">
          </div>
          <div class="account-actions">
            <button class="btn btn-primary btn-sm" data-save-settings="${id}">Save settings</button>
          </div>
        </div>`;
      panel.style.display = 'block';
      $('#acc-settings-' + id + ' [data-save-settings]').addEventListener('click', async () => {
        const enabled = $('#acc-settings-' + id + ' .as-enabled').checked;
        const body = {
          scheduler_enabled: enabled ? 1 : 0,
          min_commits: $('#acc-settings-' + id + ' .as-min').value || null,
          max_commits: $('#acc-settings-' + id + ' .as-max').value || null,
          sessions_per_day: $('#acc-settings-' + id + ' .as-sessions').value || null
        };
        await api('/api/accounts/' + id + '/settings', { method: 'PUT', body });
        toast('Account settings saved.');
        await Promise.all([loadAccounts(), loadStats()]);
      });
    } else {
      panel.style.display = 'none';
    }
  }

  // ---------- Catalog & projects ----------
  let projCategory = 'All';
  let projAccount = '';
  async function loadCatalog() {
    const acc = $('#proj-account') ? $('#proj-account').value : '';
    projAccount = acc;
    state.catalog = await api('/api/catalog' + (acc ? '?accountId=' + encodeURIComponent(acc) : ''));
    renderFilters();
    renderProjects();
    renderProjectRepos();
  }
  function renderProjAccountSelect() {
    const sel = $('#proj-account');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '';
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = 'All accounts';
    sel.appendChild(allOpt);
    (state.accounts || []).forEach((a) => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = '@' + a.github_username;
      sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
    // Keep the plans filter in sync.
    const sel2 = $('#plans-account');
    if (sel2) {
      const prev2 = sel2.value;
      sel2.innerHTML = '';
      const allOpt2 = document.createElement('option');
      allOpt2.value = '';
      allOpt2.textContent = 'All accounts';
      sel2.appendChild(allOpt2);
      (state.accounts || []).forEach((a) => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = '@' + a.github_username;
        sel2.appendChild(opt);
      });
      if (prev2) sel2.value = prev2;
    }
    // Keep the push-all account selector in sync.
    const sel3 = $('#push-account');
    if (sel3) {
      const prev3 = sel3.value;
      sel3.innerHTML = '';
      const allOpt3 = document.createElement('option');
      allOpt3.value = '';
      allOpt3.textContent = 'Select an account';
      sel3.appendChild(allOpt3);
      (state.accounts || []).forEach((a) => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = '@' + a.github_username + (a.is_active ? '' : ' (paused)');
        sel3.appendChild(opt);
      });
      if (prev3 && (state.accounts || []).some((a) => String(a.id) === prev3)) sel3.value = prev3;
    }
  }
  function renderProjectRepos() {
    const box = $('#project-repos');
    if (!box) return;
    const acc = $('#proj-account') ? $('#proj-account').value : '';
    const list = acc
      ? state.projects.filter((p) => String(p.account_id) === String(acc))
      : state.projects;
    const sorted = [...list].sort((a, b) => (b.pushed_at || 0) - (a.pushed_at || 0));
    if (!sorted.length) { box.innerHTML = '<div class="empty">No projects pushed yet for this account.</div>'; return; }
    const accNames = new Map((state.accounts || []).map((a) => [a.id, a.github_username]));
    box.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>Pushed repositories (${sorted.length})</h3><span class="muted">Which repos were pushed and from which account</span></div>
        <div class="repo-list">${sorted.map((p) => `
          <div class="repo-row">
            <div class="repo-main">
              <strong>${esc(p.repo_name || p.slug)}</strong>
              <a href="${esc(p.repo_url || '')}" target="_blank" rel="noopener" class="muted">${esc(p.repo_url || '')}</a>
            </div>
            <div class="repo-meta">
              <span>${esc(p.category)}</span>
              <span>@${accNames.get(p.account_id) || '?'}</span>
              <span>${p.commits_done || 0} commits</span>
              <span class="${p.status === 'done' ? 'badge on' : 'badge'}">${p.status}</span>
              <span class="muted">${ago(p.pushed_at)}</span>
            </div>
          </div>`).join('')}</div>
      </div>`;
  }
  function renderFilters() {
    const cats = ['All', ...new Set(state.catalog.map((p) => p.category))];
    const row = $('#proj-filters');
    row.innerHTML = '';
    cats.forEach((c) => {
      const chip = document.createElement('button');
      chip.className = 'chip' + (c === projCategory ? ' active' : '');
      chip.textContent = c;
      chip.addEventListener('click', () => { projCategory = c; renderFilters(); renderProjects(); });
      row.appendChild(chip);
    });
  }
  function renderProjects() {
    const q = $('#proj-search').value.toLowerCase();
    const list = state.catalog.filter((p) =>
      (projCategory === 'All' || p.category === projCategory) &&
      (!q || p.title.toLowerCase().includes(q) || p.blurb.toLowerCase().includes(q) || p.stack.toLowerCase().includes(q))
    );
    const grid = $('#projects-grid');
    grid.innerHTML = '';
    const pushedCount = state.catalog.filter((p) => p.pushed).length;
    $('#nav-projects-count').textContent = pushedCount;
    if (!list.length) { grid.innerHTML = '<div class="empty">No projects match.</div>'; return; }
    list.forEach((p) => {
      const el = document.createElement('div');
      el.className = 'project-card';
      el.innerHTML = `
        <div class="proj-top">
          <span class="proj-cat">${p.category}</span>
          <span class="status-badge ${p.pushed ? 'pushed' : 'ready'}">${p.pushed ? 'pushed' : 'queued'}</span>
        </div>
        <h4 class="proj-title">${p.title}</h4>
        <p class="proj-blurb">${p.blurb}</p>
        <span class="proj-stack">${p.stack}</span>`;
      grid.appendChild(el);
    });
  }

  async function loadProjects() {
    state.projects = await api('/api/projects');
    renderProjects();
    renderProjectRepos();
  }

  // ---------- Push all repositories ----------
  let pushRunning = false;
  let pushPollTimer = null;
  async function refreshPushAll() {
    const acc = $('#push-account') ? $('#push-account').value : '';
    const box = $('#push-results');
    const bar = $('#push-bar-fill');
    const label = $('#push-progress-label');
    const nums = $('#push-progress-nums');
    const count = $('#nav-pushall-count');
    try {
      const st = await api('/api/push-all/status' + (acc ? '?accountId=' + encodeURIComponent(acc) : ''));
      if (acc) {
        const pct = st.total ? Math.round((st.pushed / st.total) * 100) : 0;
        if (bar) bar.style.width = pct + '%';
        if (label) label.textContent = acc === '' ? 'Select an account to begin.' : `Pushed ${st.pushed} of ${st.total} ready-made projects to @${st.account}`;
        if (nums) nums.textContent = st.remaining ? st.remaining + ' left' : 'all pushed';
      } else {
        if (label && box) label.textContent = 'Select an account to begin.';
        if (nums) nums.textContent = '';
        if (bar) bar.style.width = '0%';
      }
      if (count) count.textContent = st.total >= 0 ? st.pushed : '';
    } catch (e) { /* ignore */ }
  }

  async function runPushAll() {
    const acc = $('#push-account') ? $('#push-account').value : '';
    if (!acc) { toast('Select a GitHub account first.', true); return; }
    if (pushRunning) { toast('A push is already running.', true); return; }
    pushRunning = true;
    vouchStart();
    const btn = $('#push-all-btn');
    const box = $('#push-results');
    const label = $('#push-progress-label');
    if (btn) { btn.disabled = true; btn.textContent = 'Pushing\u2026'; }
    startPushPolling();
    let vouchTriggered = false;
    try {
      for (let pass = 0; pass < 400; pass++) {
        const r = await api('/api/push-all', { method: 'POST', body: { accountId: Number(acc), batch: 30 } });
        if (r.results) {
          r.results.forEach((x) => {
            const row = document.createElement('div');
            row.className = 'push-row ' + (x.status === 'failed' ? 'fail' : 'ok');
            row.innerHTML = `<span class="push-row-name">${esc(x.slug)}</span><span class="push-row-state">${x.status === 'failed' ? (escapeHtml(x.error || 'failed')) : x.status}</span>`;
            box.prepend(row);
          });
        }
        // Ask for a vouch every 100 repos or on a rate-limit stop.
        const pushed = Number(r.pushed || 0);
        if ((!vouchTriggered && pushed >= 100) || r.rateLimited) { vouchShowModal(); vouchTriggered = true; }
        await refreshPushAll();
        if (r.rateLimited) {
          if (label) label.textContent = r.rateLimitMessage || 'GitHub rate-limited us. Wait a moment and resume.';
          toast(r.rateLimitMessage || 'Rate limited by GitHub. Try again shortly.', true);
          break;
        }
        if (r.done || r.remaining <= 0) break;
      }
      await refreshPushAll();
    } catch (e) {
      toast(e.message, true);
    } finally {
      pushRunning = false;
      stopPushPolling();
      if (btn) { btn.disabled = false; btn.textContent = 'Push all repos'; }
      await refreshPushAll();
    }
  }

  // Auto-refresh the progress bar/label while a push is in flight.
  function startPushPolling() {
    stopPushPolling();
    pushPollTimer = setInterval(() => { refreshPushAll(); }, 2000);
  }
  function stopPushPolling() {
    if (pushPollTimer) { clearInterval(pushPollTimer); pushPollTimer = null; }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- Vouch prompt (fair-trade Twitter shoutout) ----------
  const VOUCH_TEXT = 'Hey @commonsmade, vouch @nurw3b \n\nI just bulk-pushed my whole repo library with GitGreen (free & open source). If you build on GitHub too, it keeps your grid green automatically. The trade is fair: I use it free, so I vouch for it. \n\n#GitGreen #OpenSource #GitHub';
  const VOUCH_CAMPAIGN_HOURS = 48;
  const VOUCH_SNOOZE_KEY = 'gg_vouch_hidden_until';
  const VOUCH_UNTIL_KEY = 'gg_vouch_until';
  const VOUCH_PUSH_COUNT_KEY = 'gg_vouch_push_count';

  function vouchCampaignActive() {
    try {
      const until = Number(localStorage.getItem(VOUCH_UNTIL_KEY) || 0);
      return until > Date.now();
    } catch (e) { return false; }
  }
  function vouchStart() {
    try {
      if (!localStorage.getItem(VOUCH_UNTIL_KEY)) {
        localStorage.setItem(VOUCH_UNTIL_KEY, String(Date.now() + VOUCH_CAMPAIGN_HOURS * 3600000));
      }
    } catch (e) {}
  }
  function vouchExpire() {
    try {
      localStorage.removeItem(VOUCH_UNTIL_KEY);
      localStorage.removeItem(VOUCH_SNOOZE_KEY);
      localStorage.removeItem(VOUCH_PUSH_COUNT_KEY);
    } catch (e) {}
  }
  function vouchSnoozed() {
    try {
      const until = Number(localStorage.getItem(VOUCH_SNOOZE_KEY) || 0);
      return until > Date.now();
    } catch (e) { return false; }
  }
  function vouchSnooze() {
    try { localStorage.setItem(VOUCH_SNOOZE_KEY, String(Date.now() + 3600000)); } catch (e) {}
  }
  function vouchBumpPushCount() {
    try {
      const n = Number(localStorage.getItem(VOUCH_PUSH_COUNT_KEY) || 0) + 1;
      localStorage.setItem(VOUCH_PUSH_COUNT_KEY, String(n));
      return n;
    } catch (e) { return 0; }
  }
  function vouchShowModal() {
    if (!vouchCampaignActive()) return;
    if (vouchSnoozed()) return;
    $('#vouch-modal').classList.remove('hidden');
  }
  function vouchHideModal() { $('#vouch-modal').classList.add('hidden'); }
  function vouchBindCopy(btn, textEl) {
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const text = textEl ? textEl.textContent : VOUCH_TEXT;
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e2) {}
        document.body.removeChild(ta);
      }
      toast('Tweet copied. Paste it on X and hit post!');
    });
  }
  function vouchSetup() {
    // Show the fixed card while the campaign is active and not snoozed.
    const card = $('#vouch-card');
    if (!card) return;
    if (!vouchCampaignActive()) { vouchExpire(); card.classList.remove('show'); return; }
    if (vouchSnoozed()) { card.classList.remove('show'); return; }
    card.classList.add('show');
    // Wire the pop-up.
    $('#vouch-close').addEventListener('click', () => {
      vouchSnooze();
      vouchHideModal();
      card.classList.remove('show');
    });
    vouchBindCopy($('#vouch-copy'), $('#vouch-text'));
    vouchBindCopy($('#vouch-card-copy'), null);
    const tweet = $('#vouch-tweet');
    if (tweet) tweet.href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(VOUCH_TEXT);
    // If there is no auth screen yet, this modal/dup would be hidden; guard clicks.
    $('#vouch-modal').addEventListener('click', (e) => { if (e.target === $('#vouch-modal')) vouchSnooze(); });
  }

  // ---------- Plans ----------
  async function loadPlans() {
    const acc = $('#plans-account') ? $('#plans-account').value : '';
    state.plans = await api('/api/plans' + (acc ? '?accountId=' + encodeURIComponent(acc) : ''));
    const box = $('#plans-list');
    box.innerHTML = '';
    if (!state.plans.length) { box.innerHTML = '<div class="empty">No plans yet.</div>'; return; }
    const today = new Date().toISOString().slice(0, 10);
    state.plans.forEach((p) => {
      const el = document.createElement('div');
      el.className = 'plan-card';
      const sessions = (p.sessions || []).map((s) =>
        `<span class="session-chip">${s.start} <span class="c">${(s.commits || []).length} commits</span></span>`
      ).join('');
      const total = (p.sessions || []).reduce((a, s) => a + (s.commits || []).length, 0);
      const todayMark = p.date === today ? ' <span class="dot-now"></span>' : '';
      el.innerHTML = `
        <div class="plan-head">
          <h4>${new Date(p.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}${todayMark}</h4>
          <span class="plan-date">${p.account ? '@' + p.account : ''} · ${total} commits</span>
        </div>
        <div class="session-list">${sessions || '<span class="plan-empty">rest day</span>'}</div>`;
      box.appendChild(el);
    });
  }

  // ---------- Logs ----------
  async function loadLogs() {
    const logs = await api('/api/logs');
    const box = $('#logs');
    box.innerHTML = '';
    if (!logs.length) { box.innerHTML = '<div class="empty">No activity yet.</div>'; return; }
    logs.forEach((l) => {
      const el = document.createElement('div');
      el.className = 'log-line';
      const who = l.account_name ? '@' + l.account_name : '';
      const linked = String(l.message || '').replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
      el.innerHTML = `<span class="log-time">${new Date(l.created_at).toLocaleString()}</span><span class="log-kind ${l.kind}">${l.kind}</span><span class="log-msg">${l.ok ? '' : '❌ '}${linked} ${who}</span>`;
      box.appendChild(el);
    });
  }

  // ---------- Settings ----------
  async function loadSettings() {
    state.settings = await api('/api/settings');
    $('#set-enabled').checked = !!state.settings.scheduler_enabled;
    $('#set-activepct').value = state.settings.active_day_pct;
    $('#out-activepct').textContent = state.settings.active_day_pct + '%';
  }

  function bindSettings() {
    $('#set-activepct').addEventListener('input', (e) => {
      $('#out-activepct').textContent = e.target.value + '%';
    });
    const save = async () => {
      try {
        state.settings = await api('/api/settings', {
          method: 'POST',
          body: {
            active_day_pct: Number($('#set-activepct').value),
            scheduler_enabled: $('#set-enabled').checked ? 1 : 0
          }
        });
        toast('Settings saved.');
      } catch (err) { toast(err.message, true); }
    };
    $('#set-enabled').addEventListener('change', save);
    $('#set-activepct').addEventListener('change', save);
  }

  // ---------- Subscription & plan ----------
  let payPollTimer = null;
  let payOrderId = null;
  let payPlanId = null;
  let payQuote = null;

  function updatePlanPill() {
    const sub = state.subscription;
    if (!sub) return;
    const pill = $('#nav-plan-name');
    if (pill) pill.textContent = sub.plan ? sub.plan.name : (sub.plan_id === 'free' ? 'Free' : sub.plan_id);
  }

  async function loadSubscription() {
    const data = await api('/api/billing/subscription');
    state.subscription = data.subscription;
    state.plans = data.plans || [];
    state.billingConfigured = data.configured;
    updatePlanPill();
    renderPlanView();
    renderBanner();
    renderAccounts();
  }

  function renderBanner() {
    const banner = $('#sub-banner');
    if (!banner) return;
    const sub = state.subscription;
    if (!sub) { banner.style.display = 'none'; return; }
    const title = $('#sub-banner-title');
    const subText = $('#sub-banner-sub');
    if (sub.active) {
      banner.style.display = 'block';
      title.textContent = sub.plan_id === 'free' ? 'Free trial active' : sub.plan.name + ' plan active';
      subText.textContent = (sub.days_left + ' day' + (sub.days_left === 1 ? '' : 's') + ' left' + (sub.plan_id === 'free' ? ' - upgrade anytime to keep the streak going' : ''));
    } else {
      banner.style.display = 'block';
      title.textContent = 'Your subscription has expired';
      subText.textContent = 'Renew a plan to reactivate your accounts.';
      $('#sub-banner a').textContent = 'Renew plan';
    }
  }

  function planCardHtml(plan) {
    const sub = state.subscription || {};
    const isCurrent = sub.plan_id === plan.id && sub.active;
    const cur = (state.plans || []).find((p) => p.id === sub.plan_id);
    let btnLabel = '$' + plan.price + '/mo';
    let btnClass = 'btn-primary';
    let extra = '';
    if (isCurrent) {
      btnLabel = 'Current plan';
      btnClass = 'current-btn';
    } else if (plan.id === 'free') {
      btnLabel = sub.active && sub.plan_id === 'free' ? 'Current trial' : 'Start free';
      btnClass = 'btn-ghost';
    } else if (cur && sub.plan_id !== 'free' && sub.active) {
      if (plan.price > cur.price) {
        const diff = plan.price - cur.price;
        btnLabel = 'Upgrade - $' + diff + '/mo';
        btnClass = 'btn-primary';
        extra = '<div class="plan-note">Pay only the $' + diff + ' difference. Your expiry stays the same.</div>';
      } else if (plan.price < cur.price) {
        btnLabel = 'Switch (free)';
        btnClass = 'btn-ghost';
      } else {
        btnLabel = 'Renew - $' + plan.price + '/mo';
        btnClass = 'btn-primary';
      }
    }
    const per = plan.price > 0 ? '$' + plan.price + '<span class="per">/mo</span>' : 'Free';
    const accs = plan.accounts === 1 ? '1 account' : plan.accounts + ' accounts';
    return '' +
      '<div class="plan-card plan-card-tile ' + (isCurrent ? 'current' : '') + ' ' + (plan.popular ? 'popular' : '') + '">' +
        (plan.popular ? '<div class="plan-tag">Most popular</div>' : '') +
        '<h4 class="plan-name">' + plan.name + '</h4>' +
        '<div class="plan-price">' + per + '</div>' +
        '<p class="plan-tagline">' + plan.tagline + '</p>' +
        '<ul class="plan-feats">' +
          '<li>' + accs + '</li>' +
          '<li>Unlimited commits &amp; repos</li>' +
          '<li>Human-like daily activity</li>' +
          '<li>Priority support</li>' +
        '</ul>' +
        extra +
        '<button class="btn btn-block ' + btnClass + '" data-buy="' + plan.id + '" ' + (isCurrent ? 'disabled' : '') + '>' + btnLabel + '</button>' +
      '</div>';
  }

  function renderPlanView() {
    const sub = state.subscription;
    const box = $('#plan-current');
    if (!sub) { box.innerHTML = '<div class="empty">Loading subscription...</div>'; return; }

    const active = !!sub.active;
    const plan = sub.plan || { name: sub.plan_id, accounts: 0, price: 0 };
    const used = sub.accounts_used || 0;
    const limit = active ? sub.account_limit : 0;
    const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

    let statusBadge = '<span class="badge off">expired</span>';
    if (active) statusBadge = sub.status === 'active' ? '<span class="badge on">active</span>' : '<span class="badge off">' + sub.status + '</span>';
    if (sub.plan_id === 'free' && active) statusBadge = '<span class="badge on">free trial</span>';

    const expiry = active && sub.expires_at ? new Date(sub.expires_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '-';
    const daysLeft = active && sub.days_left != null ? sub.days_left : 0;

    box.innerHTML = '' +
      '<div class="panel plan-current-card">' +
        '<div class="plan-current-name">' + (plan.name || 'Free') + ' plan ' + statusBadge + '</div>' +
        '<div class="muted">' + (sub.source === 'trial' ? 'Free trial' : sub.source === 'admin' ? 'Granted by admin' : 'Paid subscription') + '</div>' +
        '<div class="plan-current-stats">' +
          '<div class="pcs"><span class="pcs-l">Expires</span><span class="pcs-v">' + expiry + '</span></div>' +
          '<div class="pcs"><span class="pcs-l">Days left</span><span class="pcs-v">' + (active ? daysLeft + ' days' : '0') + '</span></div>' +
          '<div class="pcs"><span class="pcs-l">Accounts</span><span class="pcs-v">' + used + ' / ' + (active ? limit : 0) + '</span></div>' +
        '</div>' +
        '<div class="plan-limit">' +
          '<div class="plan-limit-bar"><div class="plan-limit-fill" style="width:' + pct + '%"></div></div>' +
          '<span class="muted">' + used + ' of ' + (active ? limit : 0) + ' account' + (limit === 1 ? '' : 's') + ' connected</span>' +
        '</div>' +
        (active && sub.source === 'trial' ? '<p class="plan-trial-note">Your free trial is active. Upgrade anytime - it only takes a minute and you can pick the plan that fits.</p>' : '') +
        (!active ? '<p class="plan-expired-note">Your subscription has expired. Renew a plan to keep your accounts active.</p>' : '') +
      '</div>';

    const grid = $('#plan-grid');
    grid.innerHTML = (state.plans || []).map(planCardHtml).join('');

    $$('#plan-grid [data-buy]').forEach((b) => b.addEventListener('click', () => buyPlan(b.dataset.buy)));
    updatePlanPill();
  }

  async function buyPlan(planId) {
    payPlanId = planId;
    try {
      const quote = await api('/api/billing/quote?planId=' + encodeURIComponent(planId));
      if (quote.amount <= 0) {
        // Free switch (downgrade/noop) - apply immediately, no crypto needed.
        const res = await api('/api/billing/payment', { method: 'POST', body: { planId } });
        toast('Plan switched to ' + res.plan.name + '.');
        await loadSubscription();
        await loadStats();
        return;
      }
      payQuote = quote;
      openChooseStage(quote);
    } catch (err) {
      toast(err.message, true);
    }
  }

  function openChooseStage(quote) {
    $('#pay-modal-title').textContent = quote.action === 'upgrade' ? 'Upgrade to ' + quote.plan.name : 'Get ' + quote.plan.name;
    $('#pay-plan-row').innerHTML =
      '<span class="pay-plan-label">' + (quote.action === 'upgrade' ? 'Upgrade to <b>' + quote.plan.name + '</b>' : 'Buy <b>' + quote.plan.name + '</b>') + '</span>' +
      '<span class="pay-plan-amount">$' + quote.amount.toFixed(2) + '</span>';
    $('#pay-choose').classList.remove('hidden');
    $('#pay-send').classList.add('hidden');
    $('#pay-modal').classList.remove('hidden');
  }

  async function generatePayment() {
    const btn = $('#pay-generate');
    btn.disabled = true;
    btn.textContent = 'Creating...';
    try {
      const res = await api('/api/billing/payment', { method: 'POST', body: { planId: payPlanId } });
      if (res.applied) {
        toast('Plan switched to ' + res.plan.name + '.');
        $('#pay-modal').classList.add('hidden');
        await loadSubscription();
        await loadStats();
        return;
      }
      payOrderId = res.order.order_id;
      showSendStage(res);
      startPayPolling();
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate payment link';
    }
  }

  function showSendStage(res) {
    $('#pay-modal-title').textContent = 'Pay with crypto';
    $('#pay-plan-row2').innerHTML =
      '<span class="pay-plan-label">' + (res.action === 'upgrade' ? 'Upgrade to <b>' + res.plan.name + '</b>' : 'Buy <b>' + res.plan.name + '</b>') + '</span>' +
      '<span class="pay-plan-amount">$' + Number(res.amount || 0).toFixed(2) + '</span>';
    const openBtn = $('#pay-open');
    openBtn.href = res.order.payment_url || '#';
    $('#pay-choose').classList.add('hidden');
    $('#pay-send').classList.remove('hidden');
    setPayStatus('Waiting for payment...', false);
  }

  function setPayStatus(msg, err) {
    const line = $('#pay-status-line');
    if (!line) return;
    line.innerHTML = (err ? '' : '<span class="spinner"></span>') + msg;
    line.className = 'pay-status-line' + (err ? ' err' : '');
  }

  async function pollPay() {
    if (!payOrderId) return;
    try {
      const r = await api('/api/billing/payment/' + encodeURIComponent(payOrderId));
      if (r.applied) {
        clearTimeout(payPollTimer);
        payPollTimer = null;
        setPayStatus('Payment confirmed! Your plan is now active.', false);
        await loadSubscription();
        await loadStats();
        setTimeout(() => { $('#pay-modal').classList.add('hidden'); }, 2000);
        return;
      }
      const st = (r.status || '').toLowerCase();
      if (st === 'paid' || st === 'manual_accept') {
        setPayStatus('Payment complete! Activating your plan...', false);
      } else if (st === 'paying' || st === 'waiting' || st === 'new') {
        setPayStatus(st === 'paying' ? 'Payment detected - waiting for blockchain confirmation...' : 'Waiting for payment. Open the payment page when ready.', false);
      } else if (st === 'expired' || st === 'failed' || st === 'refunded' || st === 'refunding' || st === 'underpaid') {
        clearTimeout(payPollTimer);
        payPollTimer = null;
        setPayStatus('Payment ' + st + '. No charge was applied. You can try again.', true);
        return;
      } else {
        setPayStatus('Status: ' + (r.status || 'unknown'), false);
      }
      payPollTimer = setTimeout(pollPay, 5000);
    } catch (err) {
      setPayStatus('Could not check status: ' + err.message + ' - retrying...', true);
      payPollTimer = setTimeout(pollPay, 7000);
    }
  }

  function startPayPolling() {
    clearTimeout(payPollTimer);
    pollPay();
  }

  function closePayModal() {
    clearTimeout(payPollTimer);
    payPollTimer = null;
    payOrderId = null;
    $('#pay-modal').classList.add('hidden');
  }

  $$('.modal-close').forEach((b) => {
    if (b.dataset.close === 'pay-modal') b.addEventListener('click', closePayModal);
  });
  $('#pay-modal').addEventListener('click', (e) => { if (e.target.id === 'pay-modal') closePayModal(); });
  $('#pay-close').addEventListener('click', closePayModal);
  $('#pay-close2').addEventListener('click', closePayModal);
  $('#pay-generate').addEventListener('click', generatePayment);
  $('#pay-check').addEventListener('click', () => { if (payOrderId) { clearTimeout(payPollTimer); pollPay(); } });
  $('#plan-refresh').addEventListener('click', async () => { await loadSubscription(); toast('Refreshed.'); });

  // ---------- Token modal (connect GitHub) ----------
  let checkedToken = null; // last successfully checked token string
  function openModal() {
    $('#modal').classList.remove('hidden');
    $('#token-input').value = '';
    $('#token-msg').textContent = '';
    $('#token-msg').className = 'form-msg';
    $('#scope-result').classList.add('hidden');
    $('#token-check-state').textContent = '';
    $('#token-check-state').className = 'token-check-state';
    $('#connect-btn').disabled = true;
    checkedToken = null;
    $('#token-input').focus();
  }
  $('#add-account-btn').addEventListener('click', openModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal('modal'); });

  function renderScopeResult(r) {
    const box = $('#scope-result');
    box.classList.remove('hidden');
    const scopeRow = (code, present, note) => `
      <div class="scope-item">
        <span class="mark ${present ? 'yes' : 'no'}">${present ? '✓' : '✕'}</span>
        <code>${code}</code>
        ${note ? `<span class="scope-note">- ${note}</span>` : ''}
      </div>`;
    const avatar = r.avatar_url ? `<img src="${r.avatar_url}" alt="" onerror="this.style.display='none'">` : '';
    let scopesGrid;
    if (r.scopesReported) {
      scopesGrid = `
        <div class="scope-grid">
          ${scopeRow('repo', r.hasRepo, 'required - create repos & push commits')}
          ${scopeRow('workflow', r.hasWorkflow, 'recommended - avoid push errors')}
        </div>`;
    } else {
      scopesGrid = `
        <div class="scope-grid">
          <div class="scope-item"><span class="mark yes">✓</span><span>Token is valid. GitHub does not report scopes for this token type (fine-grained), so we can't list them here.</span></div>
        </div>`;
    }
    box.innerHTML = `
      <div class="who">${avatar}<div><strong>@${r.login}</strong><div class="muted" style="font-size:12px">Token is valid</div></div></div>
      ${scopesGrid}
      ${r.warning ? `<div class="scope-warn">⚠ ${r.warning}</div>` : ''}`;
  }

  function resetChecked() {
    $('#scope-result').classList.add('hidden');
    $('#token-check-state').textContent = '';
    $('#token-check-state').className = 'token-check-state';
    $('#connect-btn').disabled = true;
    checkedToken = null;
  }
  $('#token-input').addEventListener('input', resetChecked);

  $('#check-token-btn').addEventListener('click', async () => {
    const token = $('#token-input').value.trim();
    const state = $('#token-check-state');
    const btn = $('#check-token-btn');
    const msg = $('#token-msg');
    msg.className = 'form-msg';
    if (!token) { state.textContent = 'Paste a token first.'; state.className = 'token-check-state err'; return; }
    btn.disabled = true;
    state.textContent = 'Checking...';
    state.className = 'token-check-state';
    try {
      const r = await api('/api/accounts/check', { method: 'POST', body: { token } });
      checkedToken = token;
      renderScopeResult(r);
      state.textContent = '✓ Ready to connect';
      state.className = 'token-check-state ok';
      $('#connect-btn').disabled = !r.canPush;
      if (!r.canPush) msg.textContent = 'This token cannot push repos. Tick the "repo" scope and regenerate.';
      else msg.textContent = '';
    } catch (err) {
      $('#scope-result').classList.add('hidden');
      state.textContent = '✕ Check failed';
      state.className = 'token-check-state err';
      msg.textContent = err.message;
      msg.classList.add('err');
      $('#connect-btn').disabled = true;
      checkedToken = null;
    } finally {
      btn.disabled = false;
    }
  });

  $('#connect-btn').addEventListener('click', async () => {
    const token = $('#token-input').value.trim();
    const msg = $('#token-msg');
    msg.className = 'form-msg';
    if (!checkedToken || checkedToken !== token) {
      msg.textContent = 'Check the token first, then connect.';
      msg.classList.add('err');
      return;
    }
    $('#connect-btn').disabled = true;
    try {
      await api('/api/accounts', { method: 'POST', body: { token } });
      msg.textContent = 'Connected.';
      msg.classList.add('ok');
      closeModal('modal');
      await Promise.all([loadAccounts(), loadStats(), loadPlans(), loadLogs()]);
      toast('GitHub account connected.');
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('err');
      $('#connect-btn').disabled = false;
      if (err.code === 'limit_reached' || err.status === 402) {
        setTimeout(() => { go('plan'); toast('Upgrade your plan to connect more accounts.', true); }, 600);
      }
    }
  });

  // ---------- Actions ----------
  $('#run-account').addEventListener('change', () => { updateRunButtons(); loadStats(); refreshCountdown(); });
  $('#run-now-btn').addEventListener('click', async () => {
    const accountId = $('#run-account').value;
    const btn = $('#run-now-btn');
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const r = await api('/api/run-now', { method: 'POST', body: { ...(accountId ? { accountId } : {}), commits: 3 } });
      toast('Pushed ' + r.commits + ' commits' + (r.accounts > 1 ? ' across ' + r.accounts + ' accounts' : '') + '. Refreshing...');
      await Promise.all([loadStats(), loadLogs(), loadProjects(), loadPlans()]);
    } catch (err) {
      toast('Run failed: ' + err.message, true);
    } finally {
      updateRunButtons();
    }
  });

  // "Run today's task": queue today's full planned activity as 1-3 batches
  // spread across the day (commits minutes apart) instead of a single burst.
  $('#run-today-btn').addEventListener('click', async () => {
    const accountId = $('#run-account').value;
    const btn = $('#run-today-btn');
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const r = await api('/api/run-today', { method: 'POST', body: { ...(accountId ? { accountId } : {}) } });
      const first = r.firstAt ? new Date(r.firstAt).toLocaleTimeString() : '';
      const scope = r.accounts > 1 ? ' across ' + r.accounts + ' accounts' : '';
      toast(`Queued ${r.total} commits across ${r.batches} batch${r.batches > 1 ? 'es' : ''}${scope} for today${first ? ' (first at ' + first + ')' : ''}.`);
      await Promise.all([loadStats(), loadPlans()]);
    } catch (err) {
      toast('Failed to schedule: ' + err.message, true);
    } finally {
      updateRunButtons();
    }
  });
  $('#regenerate-btn').addEventListener('click', async () => {
    await api('/api/regenerate-plans', { method: 'POST' });
    await loadPlans();
    await loadStats();
    toast('Plans regenerated.');
  });
  $('#refresh-logs').addEventListener('click', async () => { await loadLogs(); toast('Refreshed.'); });
  $('#proj-search').addEventListener('input', renderProjects);
  $('#proj-account').addEventListener('change', async () => {
    await loadCatalog();
    await loadProjects();
  });
  $('#plans-account').addEventListener('change', async () => { await loadPlans(); });
  $('#push-account').addEventListener('change', async () => { await refreshPushAll(); });
  $('#push-all-btn').addEventListener('click', async () => { await runPushAll(); });

  // ---------- Auth page visual ----------
  // Animated contribution grid + activity timeline on the sign-in screen.
  (function initAuthVisual() {
    const heat = $('#auth-heat');
    if (!heat) return;
    const bar = $('#auth-progress-bar');
    const items = $$('#auth-timeline .vt-item');
    const COLS = 20, ROWS = 7;
    const levels = ['', 'l1', 'l2', 'l3', 'l4'];
    const cells = [];
    for (let c = 0; c < COLS; c++) {
      const col = document.createElement('div');
      col.className = 'heat-col';
      for (let r = 0; r < ROWS; r++) {
        const cell = document.createElement('div');
        cell.className = 'hcell';
        cells.push(cell);
        col.appendChild(cell);
      }
      heat.appendChild(col);
    }
    const weights = cells.map(() => [1, 1, 2, 2, 3, 4][Math.floor(Math.random() * 6)]);
    const phase = (f) => f >= 1 ? 3 : f >= .7 ? 2 : f >= .35 ? 1 : 0;
    function setPhase(p) {
      items.forEach((el) => {
        const s = Number(el.dataset.step);
        el.classList.toggle('active', s === p);
        el.classList.toggle('done', s < p);
      });
    }
    function animate() {
      cells.forEach((c) => c.classList.remove('l1', 'l2', 'l3', 'l4', 'lit'));
      setPhase(0);
      if (bar) bar.style.width = '0%';
      let idx = 0;
      const total = cells.length;
      const tick = () => {
        const step = Math.max(1, Math.round(total / 96));
        for (let k = 0; k < step && idx < total; k++, idx++) {
          const cell = cells[idx];
          cell.classList.add(levels[weights[idx]], 'lit');
          setTimeout(() => cell.classList.remove('lit'), 560);
        }
        const f = idx / total;
        setPhase(phase(f));
        if (bar) bar.style.width = Math.round(f * 100) + '%';
        if (idx < total) {
          setTimeout(tick, 44);
        } else {
          setPhase(3);
          if (bar) bar.style.width = '100%';
          setTimeout(animate, 4600);
        }
      };
      tick();
    }
    setTimeout(animate, 350);
  })();

// ---------- Init ----------
  let authRetryTimer = null;
  function clearAuthRetry() {
    if (authRetryTimer) { clearTimeout(authRetryTimer); authRetryTimer = null; }
  }
  function showAuth() {
    $('#auth-screen').classList.remove('hidden');
    // Safety net: if the user signs in through Privy but the "gitgreen:login"
    // event is missed (or the server session is created slightly later), keep
    // checking so the app still opens instead of sitting on the auth screen.
    clearAuthRetry();
    authRetryTimer = setInterval(async () => {
      try {
        const me = await api('/api/auth/me');
        if (me.user) {
          clearAuthRetry();
          state.user = me.user;
          if (me.user.is_admin) $('#nav-admin-link').classList.remove('hidden');
          await enterApp();
        }
      } catch (e) { /* still not authed yet */ }
    }, 1500);
    // Stop polling after 30s so it doesn't run forever.
    setTimeout(clearAuthRetry, 30000);
  }

  (async function init() {
    bindSettings();
    const q = new URLSearchParams(location.search);
    if (q.get('auth_error')) {
      toast(q.get('auth_error') === 'denied' ? 'GitHub sign-in was cancelled.' : 'GitHub sign-in failed: ' + q.get('auth_error'), true);
      history.replaceState({}, '', '/');
    }
    if (q.get('payment') === 'success') {
      history.replaceState({}, '', location.pathname);
      setTimeout(async () => {
        try {
          await loadSubscription();
          go('plan');
          toast('Thanks for subscribing! Your plan is active.');
        } catch (e) { /* ignore */ }
      }, 600);
    }
    try {
      const me = await api('/api/auth/me');
      state.user = me.user;
      if (me.user.is_admin) $('#nav-admin-link').classList.remove('hidden');
      await enterApp();
    } catch (e) {
      showAuth();
    }
    vouchSetup();
  })();
})();
