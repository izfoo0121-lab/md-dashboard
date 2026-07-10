(function () {
  const MONTH_KEY = 'md_admin_working_month';
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function currentMonthLabel() {
    const d = new Date();
    return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
  }

  function normalizeMonth(value) {
    const raw = String(value || '').trim();
    if (!raw || raw === 'current') return '';

    let m = raw.match(/^([A-Za-z]{3,9})\s*[-_/]?\s*(\d{2}|\d{4})$/);
    if (m) {
      const mon = MONTHS.find(x => x.toLowerCase() === m[1].slice(0, 3).toLowerCase());
      if (!mon) return '';
      return `${mon} ${String(m[2]).slice(-2)}`;
    }

    m = raw.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
    if (m) {
      const idx = Number(m[2]) - 1;
      if (idx < 0 || idx > 11) return '';
      return `${MONTHS[idx]} ${String(m[1]).slice(-2)}`;
    }

    return '';
  }

  function monthToSlug(label) {
    const normalized = normalizeMonth(label);
    return normalized ? normalized.replace(/\s+/g, '').toLowerCase() : '';
  }

  function slugToMonth(slug) {
    return normalizeMonth(slug);
  }

  function monthToIsoDate(label) {
    const normalized = normalizeMonth(label);
    if (!normalized) return '';
    const [mon, yy] = normalized.split(' ');
    const idx = MONTHS.indexOf(mon);
    return `20${yy}-${String(idx + 1).padStart(2, '0')}-01`;
  }

  function monthToIsoMonth(label) {
    return monthToIsoDate(label).slice(0, 7);
  }

  function urlMonth() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      return normalizeMonth(params.get('month') || params.get('m') || '');
    } catch (_) {
      return '';
    }
  }

  function savedMonth() {
    try { return normalizeMonth(localStorage.getItem(MONTH_KEY)); }
    catch (_) { return ''; }
  }

  function setWorkingMonth(label, opts = {}) {
    const normalized = normalizeMonth(label);
    if (!normalized) return '';
    try { localStorage.setItem(MONTH_KEY, normalized); } catch (_) {}
    if (!opts.silent) {
      window.dispatchEvent(new CustomEvent('md:working-month-change', { detail: { month: normalized } }));
    }
    decorateLinks();
    return normalized;
  }

  function getWorkingMonth(fallback) {
    return urlMonth() || savedMonth() || normalizeMonth(fallback) || currentMonthLabel();
  }

  function monthOptions(opts = {}) {
    const startYear = opts.startYear || 2026;
    const startMonth = opts.startMonth == null ? 0 : opts.startMonth;
    const futureBuffer = opts.futureBuffer == null ? 6 : opts.futureBuffer;
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth() + futureBuffer, 1);
    const out = [];
    let y = startYear;
    let m = startMonth;
    while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth())) {
      out.push(`${MONTHS[m]} ${String(y).slice(-2)}`);
      m++;
      if (m > 11) { m = 0; y++; }
      if (out.length > 240) break;
    }
    (opts.include || []).forEach(v => {
      const month = normalizeMonth(v);
      if (month && !out.includes(month)) out.push(month);
    });
    out.sort((a, b) => {
      const [am, ay] = a.split(' ');
      const [bm, by] = b.split(' ');
      return (Number(ay) - Number(by)) || (MONTHS.indexOf(am) - MONTHS.indexOf(bm));
    });
    const preferred = normalizeMonth(opts.preferred) || getWorkingMonth(opts.fallback);
    const defaultSel = out.includes(preferred) ? preferred : (out.includes(currentMonthLabel()) ? currentMonthLabel() : out[out.length - 1]);
    return { opts: out, defaultSel };
  }

  function decorateLinks(root = document) {
    const workingMonth = monthToSlug(getWorkingMonth());
    if (!workingMonth || !root?.querySelectorAll) return;
    root.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) return;
      if (/^(https?:)?\/\//i.test(href) && !href.includes(location.host)) return;
      if (!href.includes('.html')) return;
      try {
        const url = new URL(href, location.href);
        const policy = String(a.dataset?.monthPolicy || '').trim().toLowerCase();
        const linkMonth = policy === 'latest' ? monthToSlug(currentMonthLabel()) : workingMonth;
        if (!linkMonth) return;
        url.searchParams.set('month', linkMonth);
        a.setAttribute('href', url.href);
      } catch (_) {}
    });
  }

  window.MDAdminContext = {
    key: MONTH_KEY,
    months: MONTHS,
    normalizeMonth,
    monthToSlug,
    slugToMonth,
    monthToIsoDate,
    monthToIsoMonth,
    urlMonth,
    savedMonth,
    currentMonthLabel,
    getWorkingMonth,
    setWorkingMonth,
    monthOptions,
    decorateLinks,
  };

  const initial = getWorkingMonth();
  setWorkingMonth(initial, { silent: true });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => decorateLinks());
  } else {
    decorateLinks();
  }
})();
