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
  // It starts empty and gradually fills to a healthy green grid, then resets.
  const heat = $('#heat');
  const COLS = 26, ROWS = 7;
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
  const dayLabel = $('#vis-day-label');
  // Weight cells so some days stay light and a few are intense, like real use.
  const weights = cells.map(() => [0, 0, 0, 1, 1, 2, 3][Math.floor(Math.random() * 7)]);
  let lit = 0;
  function animateGrid() {
    lit = 0;
    cells.forEach((cell, i) => {
      cell.classList.remove('l1', 'l2', 'l3', 'l4', 'pop');
      if (weights[i]) cell.style.opacity = '0';
    });
    if (dayLabel) dayLabel.textContent = 'Week 1 · getting started';
    let idx = 0;
    const tick = () => {
      const step = Math.max(1, Math.round(cells.length / 46));
      for (let k = 0; k < step && idx < cells.length; k++, idx++) {
        const cell = cells[idx];
        const w = weights[idx];
        if (w) {
          cell.classList.add(levels[w], 'pop');
          cell.style.opacity = '1';
          lit++;
        }
      }
      const week = Math.min(8, 1 + Math.floor(idx / (cells.length / 8)));
      if (dayLabel) {
        dayLabel.textContent = week >= 8 ? 'A healthy, active grid' : 'Week ' + week + ' · filling up';
      }
      if (idx < cells.length) {
        setTimeout(tick, 34);
      } else {
        setTimeout(() => {
          if (dayLabel) dayLabel.textContent = 'Never misses a day';
          setTimeout(animateGrid, 2600);
        }, 700);
      }
    };
    tick();
  }
  setTimeout(animateGrid, 400);

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
