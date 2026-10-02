// Shared: nav active state + live bot status dot.
(async function () {
  const page = location.pathname;
  document.querySelectorAll('nav a[data-page]').forEach(a => {
    if (a.getAttribute('href') === page) a.classList.add('active');
  });
  try {
    const r = await fetch('/api/health');
    const h = await r.json();
    const dot = document.getElementById('navDot');
    if (dot && h.online) dot.classList.add('on');
  } catch { /* dashboard unreachable */ }
})();
