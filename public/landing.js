(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  // Theme toggle (light is the default)
  const applyThemeIcon = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const btn = $('#theme-btn');
    if (btn) btn.textContent = dark ? '☀' : '☾';
  };
  applyThemeIcon();
  $('#theme-btn').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = cur ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('gg-theme', next); } catch (e) {}
    applyThemeIcon();
  });

  // Navbar shadow on scroll
  const nav = $('#nav');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 10);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Mobile menu
  const menu = $('#mobile-menu');
  $('#menu-btn').addEventListener('click', () => {
    const open = menu.classList.toggle('open');
    menu.style.display = open ? 'flex' : 'none';
  });
  $$('#mobile-menu a').forEach((a) => a.addEventListener('click', () => {
    menu.classList.remove('open');
    menu.style.display = 'none';
  }));

  // Scroll reveal
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }
  }, { threshold: 0.12 });
  $$('.reveal').forEach((el) => io.observe(el));

  // Animated contribution grid in the hero.
  // Cells fill smoothly in a staggered sweep while a flat timeline below
  // walks through the product story. No overlays, no boxes.
  const heat = $('#heat');
  const visBar = $('#vis-progress-bar');
  const visItems = $$('#vis-timeline .vt-item');
  const COLS = 24, ROWS = 7;
  const levels = ['', 'l1', 'l2', 'l3', 'l4'];
  const cells = [];
  for (let c = 0; c < COLS; c++) {
    const col = document.createElement('div');
    col.className = 'heat-col';
    for (let r = 0; r < ROWS; r++) {
      const cell = document.createElement('div');
      cell.className = 'heat-cell';
      cells.push(cell);
      col.appendChild(cell);
    }
    heat.appendChild(col);
  }
  // Every cell gets a level so the final grid is fully green and balanced.
  const weights = cells.map(() => [1, 1, 2, 2, 3, 4][Math.floor(Math.random() * 6)]);
  const phase = (fraction) => fraction >= 1 ? 3 : fraction >= .7 ? 2 : fraction >= .35 ? 1 : 0;
  function setPhase(p) {
    visItems.forEach((el) => {
      const s = Number(el.dataset.step);
      el.classList.toggle('active', s === p);
      el.classList.toggle('done', s < p);
    });
  }
  function setBar(fraction, done) {
    if (!visBar) return;
    visBar.style.width = Math.round(fraction * 100) + '%';
    visBar.style.backgroundColor = done ? 'var(--green-2)' : 'var(--green)';
  }
  function animateGrid() {
    // Graceful reset: cells fade back to empty via their color transition.
    cells.forEach((cell) => cell.classList.remove('l1', 'l2', 'l3', 'l4', 'lit'));
    setPhase(0);
    setBar(0, false);
    let idx = 0;
    const total = cells.length;
    const tick = () => {
      const step = Math.max(1, Math.round(total / 56));
      for (let k = 0; k < step && idx < total; k++, idx++) {
        const cell = cells[idx];
        cell.classList.add(levels[weights[idx]], 'lit');
        setTimeout(() => cell.classList.remove('lit'), 420);
      }
      const fraction = idx / total;
      setPhase(phase(fraction));
      setBar(fraction, false);
      if (idx < total) {
        setTimeout(tick, 26);
      } else {
        setPhase(3);
        setBar(1, true);
        setTimeout(animateGrid, 3400);
      }
    };
    tick();
  }
  setTimeout(animateGrid, 300);

  // Signed-in users should see a "dashboard" button instead of "Sign in".
  fetch('/api/auth/me').then((r) => r.json()).then((me) => {
    if (me && me.user) {
      const signin = $('#nav-signin');
      const cta = $('#nav-cta');
      if (signin) signin.style.display = 'none';
      if (cta) cta.textContent = 'Open dashboard';
      const mobile = $$('#mobile-menu a.btn');
      mobile.forEach((a) => { a.textContent = 'Open dashboard'; a.href = '/app'; });
    }
  }).catch(() => {});

  // Pricing grid
  fetch('/api/billing/plans').then((r) => r.json()).then((data) => {
    const plans = data.plans && data.plans.length ? data.plans : [
      { id: 'free', name: 'Free trial', accounts: 1, price: 0, tagline: 'Try the autopilot for 30 days.' },
      { id: 'starter', name: 'Starter', accounts: 5, price: 3, tagline: 'For one focused GitHub profile.' },
      { id: 'pro', name: 'Pro', accounts: 10, price: 5, tagline: 'More accounts, same calm workflow.', popular: true },
      { id: 'pro_plus', name: 'Pro Plus', accounts: 30, price: 10, tagline: 'For a broader developer presence.' },
      { id: 'max', name: 'Max', accounts: 100, price: 20, tagline: 'Maximum coverage, one dashboard.' }
    ];
    const grid = $('#pricing-grid');
    if (!grid) return;
    grid.innerHTML = plans.map((p) => {
      const per = p.price > 0 ? '$' + p.price + '<span class="per">/mo</span>' : 'Free';
      const accs = p.accounts === 1 ? '1 account' : p.accounts + ' accounts';
      const popular = p.popular ? '<div class="plan-tag">Most popular</div>' : '';
      return '' +
        '<div class="pricing-card ' + (p.popular ? 'popular' : '') + '">' +
          popular +
          '<h3 class="plan-name">' + p.name + '</h3>' +
          '<div class="plan-price">' + per + '</div>' +
          '<p class="plan-tagline">' + p.tagline + '</p>' +
          '<ul class="plan-feats">' +
            '<li>' + accs + '</li>' +
            '<li>Unlimited commits &amp; repos</li>' +
            '<li>Human-like daily activity</li>' +
            '<li>Priority support</li>' +
          '</ul>' +
          '<a class="btn btn-block ' + (p.popular ? 'btn-green' : 'btn-ghost') + '" href="/app">' + (p.id === 'free' ? 'Start free' : 'Get ' + p.name) + '</a>' +
        '</div>';
    }).join('');
    // Cards stay visible even in print/PDF capture and reduced-motion mode.
    $$('#pricing-grid .pricing-card').forEach((el, i) => {
      el.classList.add('in');
      el.style.transitionDelay = (i * 60) + 'ms';
    });
  }).catch(() => {});
})();
