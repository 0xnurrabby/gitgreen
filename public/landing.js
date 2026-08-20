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

  // Animated contribution grid in the hero
  const heat = $('#heat');
  const COLS = 22, ROWS = 7;
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
  // Randomly light cells to look like a real grid
  for (const cell of cells) {
    if (Math.random() < 0.62) cell.classList.add(levels[Math.floor(Math.random() * levels.length)]);
  }
  // Periodic "commit" pulses that light up a cell and pop
  setInterval(() => {
    const cell = cells[Math.floor(Math.random() * cells.length)];
    cell.classList.remove('l1', 'l2', 'l3', 'l4', 'pop');
    void cell.offsetWidth;
    cell.classList.add('l4', 'pop');
    setTimeout(() => cell.classList.remove('pop'), 500);
  }, 700);

  // Signed-in users should land in the product, not see the public sign-in page.
  fetch('/api/auth/me').then((r) => r.json()).then((me) => {
    if (me && me.user) {
      location.replace('/app');
    }
  }).catch(() => {});

  // Pricing grid
  fetch('/api/billing/plans').then((r) => r.json()).then((data) => {
    const plans = data.plans || [];
    const grid = $('#pricing-grid');
    if (!grid || !plans.length) return;
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
    // Reveal animation for pricing cards
    const io2 = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { e.target.classList.add('in'); io2.unobserve(e.target); }
      }
    }, { threshold: 0.15 });
    $$('#pricing-grid .pricing-card').forEach((el) => io2.observe(el));
  }).catch(() => {});
})();
