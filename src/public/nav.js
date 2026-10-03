// Shared: stars, nav active state, live bot status dot, logout, footer, spotlight.
(function () {
  const page = location.pathname;
  document.querySelectorAll('nav a[data-page]').forEach(a => {
    if (a.getAttribute('href') === page) a.classList.add('active');
  });
  // twinkling starfield backdrop
  if (!document.querySelector('.stars')) {
    const s = document.createElement('div');
    s.className = 'stars';
    document.body.prepend(s);
  }
  // mouse spotlight on cards/panels/stats
  document.addEventListener('mousemove', e => {
    const t = e.target.closest && e.target.closest('.card,.stat,.panel,.tier,.cmd');
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    t.style.setProperty('--my', (e.clientY - r.top) + 'px');
    if (!t.classList.contains('spot')) t.classList.add('spot');
  }, { passive: true });
  // footer with live dot
  if (!document.querySelector('footer.bot-foot')) {
    const f = document.createElement('footer');
    f.className = 'bot-foot';
    f.innerHTML = `🤖 <b>TierBot</b> dashboard<span class="foot-dot" id="footDot"></span><span id="footYear"></span>`;
    document.body.appendChild(f);
    document.getElementById('footYear').textContent = new Date().getFullYear();
  }
  // live status dots
  (async function () {
    try {
      const r = await fetch('/api/health');
      const h = await r.json();
      if (!h.online) return;
      const dot = document.getElementById('navDot');
      if (dot) dot.classList.add('on');
      const fd = document.getElementById('footDot');
      if (fd) fd.classList.add('on');
      const sb = document.getElementById('sBot');
      if (sb) sb.parentElement.classList.add('live');
    } catch { /* dashboard unreachable */ }
  })();
  if (page !== '/login') {
    const nav = document.querySelector('nav');
    if (nav && !document.getElementById('logoutBtn')) {
      const b = document.createElement('a');
      b.id = 'logoutBtn';
      b.href = '#';
      b.textContent = 'Logout';
      b.style.marginLeft = 'auto';
      b.onclick = async e => {
        e.preventDefault();
        try { await fetch('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
        location.href = '/login';
      };
      nav.appendChild(b);
    }
  }
})();
