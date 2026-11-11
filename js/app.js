/* ==========================================================
   مكتبة أبجد — منطق التطبيق
   - البيانات من: data/products.json و data/quizzes.json
   - لا يوجد سيرفر: اهتمامات العميل وطلباته تُحفظ في متصفحه (localStorage)
   ========================================================== */
(() => {
  'use strict';

  /* ---------- أدوات صغيرة ---------- */

  const KEYS = {
    profile: 'abgad.profile.v1',
    cart: 'abgad.cart.v1',
    checkout: 'abgad.checkout.v1',
    orders: 'abgad.orders.v1',
    theme: 'abgad.theme.v1',
    data: 'abgad.data.v2',
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const toArr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // توحيد الحروف العربية ليعمل البحث بدقة (أ/إ/آ، ة/ه، ى/ي، التشكيل)
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[ً-ٰٟ]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .trim();

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) { /* التخزين غير متاح */ }
  }

  /* ---------- الحالة ---------- */

  const newFilters = () => ({ scope: 'mine', q: '', grade: '', subject: '' });

  const state = {
    data: null,
    products: [],
    quizzes: [],
    gradeMap: new Map(),
    subjectMap: new Map(),
    productMap: new Map(),
    quizMap: new Map(),
    raw: '',
    loadedAt: 0,

    profile: read(KEYS.profile, null),
    cart: new Set(toArr(read(KEYS.cart, []))),
    checkout: Object.assign({ mode: 'pickup', address: '' }, read(KEYS.checkout, {})),
    orders: toArr(read(KEYS.orders, [])),
    paid: false,
    sent: false,

    view: 'notebooks',
    meTab: 'orders',
    f: { products: Object.assign(newFilters(), { sort: 'default' }), quizzes: newFilters() },

    onb: null,
    installEvent: null,
    lastFocus: null,
  };

  const lib = () => state.data.library;
  const cur = () => lib().currency || 'جنيه';
  const money = (n) => `${n} ${cur()}`;
  const gradeName = (id) => (state.gradeMap.get(id) || {}).name || id || '';
  const gradeLabel = (id) => gradeName(id).replace(/^الصف\s+/, '');
  const subjectName = (id) => (state.subjectMap.get(id) || {}).name || id || '';

  /* ---------- شكل المواد (أيقونة ولون) ---------- */

  const COLORS = ['blue', 'coral', 'purple', 'green', 'orange', 'teal', 'pink', 'yellow'];
  const SUBJECT_DEFAULTS = {
    arabic: { icon: '📖', color: 'coral' },
    english: { icon: '🔤', color: 'purple' },
    french: { icon: '🗼', color: 'pink' },
    math: { icon: '📐', color: 'blue' },
    science: { icon: '🔬', color: 'green' },
    social: { icon: '🌍', color: 'orange' },
    religion: { icon: '🕌', color: 'teal' },
    computer: { icon: '💻', color: 'blue' },
    physics: { icon: '⚡', color: 'purple' },
    chemistry: { icon: '🧪', color: 'pink' },
    biology: { icon: '🧬', color: 'green' },
    history: { icon: '🏺', color: 'orange' },
    geography: { icon: '🗺️', color: 'teal' },
    philosophy: { icon: '💡', color: 'yellow' },
  };
  // يمكن تغيير الأيقونة واللون لأي مادة من data/products.json (الحقلان icon و color)
  function subjectStyle(id) {
    const s = state.subjectMap.get(id) || {};
    const d = SUBJECT_DEFAULTS[id] || {};
    const h = [...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0);
    return {
      icon: s.icon || d.icon || '📚',
      color: COLORS.includes(s.color) ? s.color : d.color || COLORS[h % COLORS.length],
    };
  }

  /* ---------- المظهر (فاتح / داكن) ---------- */

  const SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  const themePref = () => {
    const v = read(KEYS.theme, 'auto');
    return ['auto', 'light', 'dark'].includes(v) ? v : 'auto';
  };
  const resolvedTheme = () => {
    const p = themePref();
    if (p !== 'auto') return p;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };
  function applyTheme() {
    const t = resolvedTheme();
    document.documentElement.setAttribute('data-theme', t);
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = t === 'dark' ? '#22265A' : '#FFFFFF';
    const btn = $('#theme-btn');
    if (btn) {
      btn.innerHTML = t === 'dark' ? SUN : MOON;
      btn.setAttribute('aria-label', t === 'dark' ? 'التبديل إلى المظهر الفاتح' : 'التبديل إلى المظهر الداكن');
    }
  }
  function setTheme(pref) {
    write(KEYS.theme, pref);
    applyTheme();
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (themePref() === 'auto') applyTheme();
  });

  /* ---------- تحميل البيانات ---------- */

  async function fetchText(path) {
    // ?t= يتجاوز الكاش حتى تظهر التعديلات سريعًا
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return res.text();
  }

  function parseOr(text, fallbackText, label) {
    try {
      return { obj: JSON.parse(text), text };
    } catch (err) {
      console.error(`خطأ في ملف ${label}: تأكد من الفواصل والأقواس. تم استخدام آخر نسخة سليمة.`, err);
      if (fallbackText) {
        try { return { obj: JSON.parse(fallbackText), text: fallbackText }; } catch (_) { /* لا شيء */ }
      }
      return null;
    }
  }

  // يرجع: { ok, changed }
  async function loadData() {
    const cached = read(KEYS.data, null) || {};
    let pText = null;
    let qText = null;
    try { pText = await fetchText('data/products.json'); } catch (_) { pText = cached.p || null; }
    try { qText = await fetchText('data/quizzes.json'); } catch (_) { qText = cached.q || null; }

    if (pText == null) return { ok: false, changed: false };

    const p = parseOr(pText, cached.p, 'products.json');
    if (!p) return { ok: false, changed: false };
    const q = qText != null ? parseOr(qText, cached.q, 'quizzes.json') : null;

    const raw = p.text + '|' + (q ? q.text : '');
    state.loadedAt = Date.now();
    if (raw === state.raw) return { ok: true, changed: false };

    state.raw = raw;
    write(KEYS.data, { p: p.text, q: q ? q.text : '' });
    applyData(p.obj, q ? q.obj : { quizzes: [] });
    return { ok: true, changed: true };
  }

  function applyData(p, q) {
    const library = Object.assign(
      { name: 'أبجد', tagline: '', whatsapp: '', deliveryFee: 10, currency: 'جنيه', instapay: {} },
      p.library || {}
    );
    const grades = toArr(p.grades);
    const subjects = toArr(p.subjects);
    const stages = toArr(p.stages);
    state.data = { library, grades, subjects, stages };

    state.gradeMap = new Map(grades.map((g, i) => [g.id, { ...g, order: i }]));
    state.subjectMap = new Map(subjects.map((s, i) => [s.id, { ...s, order: i }]));
    const gOrder = (id) => (state.gradeMap.has(id) ? state.gradeMap.get(id).order : 999);
    const sOrder = (id) => (state.subjectMap.has(id) ? state.subjectMap.get(id).order : 999);

    state.products = toArr(p.products)
      .filter((x) => x && x.id && x.available !== false)
      .map((x, i) => ({
        id: String(x.id),
        name: String(x.name || ''),
        grade: x.grade,
        subject: x.subject,
        price: Number(x.price) || 0,
        grades: [x.grade],
        _i: i,
      }))
      .sort((a, b) => gOrder(a.grade) - gOrder(b.grade) || sOrder(a.subject) - sOrder(b.subject) || a._i - b._i);
    state.productMap = new Map(state.products.map((x) => [x.id, x]));

    state.quizzes = toArr(q && q.quizzes)
      .filter((x) => x && x.id && x.file && x.available !== false)
      .map((x, i) => ({
        id: String(x.id),
        title: String(x.title || ''),
        description: String(x.description || ''),
        subject: x.subject,
        grades: toArr(x.grade).filter(Boolean),
        file: String(x.file),
        questions: Number(x.questions) || 0,
        minutes: Number(x.minutes) || 0,
        _i: i,
      }))
      .sort(
        (a, b) =>
          gOrder(a.grades[0]) - gOrder(b.grades[0]) || sOrder(a.subject) - sOrder(b.subject) || a._i - b._i
      );
    state.quizMap = new Map(state.quizzes.map((x) => [x.id, x]));

    // تنظيف السلة من ملازم لم تعد موجودة
    for (const id of [...state.cart]) if (!state.productMap.has(id)) state.cart.delete(id);
    write(KEYS.cart, [...state.cart]);

    // تنظيف الاهتمامات من صفوف لم تعد موجودة
    if (state.profile) {
      state.profile.grades = toArr(state.profile.grades).filter((id) => state.gradeMap.has(id));
      state.profile.subjects = toArr(state.profile.subjects);
      if (!state.profile.grades.length) state.profile = null;
      else write(KEYS.profile, state.profile);
    }
  }

  /* ---------- الاهتمامات والتصفية ---------- */

  function inScope(item, scope) {
    if (scope === 'all' || !state.profile) return true;
    const pr = state.profile;
    const gradeOk = !item.grades.length || item.grades.some((g) => pr.grades.includes(g));
    const subjectOk = !pr.subjects.length || pr.subjects.includes(item.subject);
    return gradeOk && subjectOk;
  }

  // المواد الموجودة فعليًا للصفوف المختارة (تُستخدم في الخطوات الأولى وحسابي)
  function availableSubjects(gradeIds) {
    const ids = new Set();
    const take = (it) => {
      if (!it.grades.length || it.grades.some((g) => gradeIds.includes(g))) ids.add(it.subject);
    };
    state.products.forEach(take);
    state.quizzes.forEach(take);
    const list = state.data.subjects.filter((s) => ids.has(s.id));
    ids.forEach((id) => {
      if (id && !state.subjectMap.has(id)) list.push({ id, name: id });
    });
    return list.length ? list : state.data.subjects;
  }

  const baseItems = (kind) => (kind === 'products' ? state.products : state.quizzes);
  const searchText = (kind, it) =>
    kind === 'products'
      ? `${it.name} ${subjectName(it.subject)} ${gradeName(it.grade)}`
      : `${it.title} ${it.description} ${subjectName(it.subject)} ${it.grades.map(gradeName).join(' ')}`;

  // خيارات الصفوف والمواد داخل النطاق الحالي (ملازمي / الكل)
  function scopeOptions(kind) {
    const f = state.f[kind];
    const items = baseItems(kind).filter((it) => inScope(it, f.scope));
    const gIds = new Set();
    const sIds = new Set();
    items.forEach((it) => {
      it.grades.forEach((g) => gIds.add(g));
      sIds.add(it.subject);
    });
    const grades = state.data.grades.filter((g) => gIds.has(g.id)).map((g) => g.id);
    const subjects = state.data.subjects.filter((s) => sIds.has(s.id)).map((s) => s.id);
    sIds.forEach((id) => { if (id && !state.subjectMap.has(id)) subjects.push(id); });
    return { grades, subjects };
  }

  function itemsFor(kind) {
    const f = state.f[kind];
    let list = baseItems(kind).filter((it) => inScope(it, f.scope));
    if (f.grade) list = list.filter((it) => it.grades.includes(f.grade));
    if (f.subject) list = list.filter((it) => it.subject === f.subject);
    const terms = norm(f.q).split(/\s+/).filter(Boolean);
    if (terms.length) {
      list = list.filter((it) => {
        const text = norm(searchText(kind, it));
        return terms.every((t) => text.includes(t));
      });
    }
    if (kind === 'products') {
      if (f.sort === 'price-asc') list = [...list].sort((a, b) => a.price - b.price);
      else if (f.sort === 'price-desc') list = [...list].sort((a, b) => b.price - a.price);
      else if (f.sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    }
    return list;
  }

  const filtersActive = (kind) => {
    const f = state.f[kind];
    return !!(f.q.trim() || f.grade || f.subject);
  };

  /* ---------- السلة والطلبات ---------- */

  const cartItems = () => [...state.cart].map((id) => state.productMap.get(id)).filter(Boolean);

  function totals(items) {
    const subtotal = items.reduce((s, p) => s + p.price, 0);
    const delivery = state.checkout.mode === 'delivery';
    const fee = delivery ? Number(lib().deliveryFee) || 0 : 0;
    return { subtotal, delivery, fee, total: subtotal + fee };
  }

  function countLabel(n) {
    if (n === 1) return 'ملزمة واحدة';
    if (n === 2) return 'ملزمتان';
    if (n <= 10) return `${n} ملازم`;
    return `${n} ملزمة`;
  }
  function quizCountLabel(n) {
    if (n === 1) return 'اختبار واحد';
    if (n === 2) return 'اختباران';
    if (n <= 10) return `${n} اختبارات`;
    return `${n} اختبارًا`;
  }

  function toggleCart(id, on) {
    if (on) state.cart.add(id);
    else state.cart.delete(id);
    write(KEYS.cart, [...state.cart]);
    state.sent = false;
    renderCartBar();
  }

  function renderCartBar() {
    const bar = $('#cartbar');
    const items = cartItems();
    if (!items.length || state.view === 'cart' || !state.profile) {
      bar.hidden = true;
      bar.innerHTML = '';
      return;
    }
    if (!bar.firstElementChild) {
      bar.innerHTML = `
        <div class="cartbar-inner">
          <div class="cartbar-info"><b></b><span></span></div>
          <a class="btn dark" href="#cart">مراجعة الطلب</a>
        </div>`;
    }
    $('b', bar).textContent = countLabel(items.length);
    $('span', bar).textContent = money(items.reduce((s, p) => s + p.price, 0));
    bar.hidden = false;
  }

  function saveOrder(items, t, name) {
    const no = (state.orders[0] && state.orders[0].no ? state.orders[0].no : 0) + 1;
    state.orders.unshift({
      id: Date.now(),
      no,
      ts: Date.now(),
      name,
      mode: t.delivery ? 'delivery' : 'pickup',
      address: t.delivery ? state.checkout.address.trim() : '',
      fee: t.fee,
      total: t.total,
      items: items.map((p) => ({ id: p.id, name: p.name, grade: p.grade, subject: p.subject, price: p.price })),
    });
    state.orders = state.orders.slice(0, 50);
    write(KEYS.orders, state.orders);
  }

  /* ---------- مكونات HTML ---------- */

  const mascot = (cls = '') => `
    <svg class="mascot ${cls}" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <g transform="rotate(12 50 50)" stroke="currentColor" stroke-width="3" stroke-linejoin="round">
        <rect x="34" y="7" width="32" height="15" rx="7" fill="#FF7EB6"/>
        <rect x="34" y="21" width="32" height="8" fill="#C9CFE8"/>
        <rect x="34" y="28" width="32" height="46" fill="#FFC933"/>
        <path d="M34 74h32L50 97z" fill="#FFE2B8"/>
        <path d="M44.5 87h11L50 97z" fill="currentColor"/>
        <circle cx="43" cy="47" r="3.3" fill="currentColor" stroke="none"/>
        <circle cx="57" cy="47" r="3.3" fill="currentColor" stroke="none"/>
        <circle cx="39" cy="55" r="3" fill="#FF7EB6" stroke="none" opacity=".8"/>
        <circle cx="61" cy="55" r="3" fill="#FF7EB6" stroke="none" opacity=".8"/>
        <path d="M44 55q6 6 12 0" fill="none" stroke-linecap="round"/>
      </g>
    </svg>`;

  const searchSvg =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';

  function chip({ act, id, label, pressed, color, icon, extra = '' }) {
    return `<button type="button" class="chip${color ? ` sub c-${color}` : ''}" data-act="${act}" data-id="${esc(id)}" ${extra}
      aria-pressed="${pressed}">${icon ? `<span aria-hidden="true">${icon}</span> ` : ''}${esc(label)}</button>`;
  }

  function gradeChips(selected, act) {
    const stages = state.data.stages.length ? state.data.stages : [{ id: '*', name: 'الصفوف الدراسية' }];
    return stages
      .map((st) => {
        const gs = state.data.grades.filter((g) => st.id === '*' || g.stage === st.id);
        if (!gs.length) return '';
        return `
          <fieldset class="stage">
            <legend>${esc(st.name)}</legend>
            <div class="chips">
              ${gs
                .map((g) =>
                  chip({
                    act,
                    id: g.id,
                    label: g.short || g.name,
                    pressed: selected.includes(g.id),
                    extra: `aria-label="${esc(g.name)}"`,
                  })
                )
                .join('')}
            </div>
          </fieldset>`;
      })
      .join('');
  }

  function subjectChips(selected, avail, act) {
    return `
      <div class="chips">
        ${chip({ act, id: '*', label: 'كل المواد', pressed: selected.length === 0 })}
        ${avail
          .map((s) => {
            const st = subjectStyle(s.id);
            return chip({ act, id: s.id, label: s.name, pressed: selected.includes(s.id), color: st.color, icon: st.icon });
          })
          .join('')}
      </div>`;
  }

  /* ----- شريط البحث والفلاتر ----- */

  function chipRow(kind, group, label, allLabel, options, current) {
    if (options.length < 2) return '';
    return `
      <div class="chip-scroll" role="group" aria-label="${label}">
        ${chip({ act: 'fchip', id: '', label: allLabel, pressed: !current, extra: `data-kind="${kind}" data-group="${group}"` })}
        ${options
          .map((o) =>
            chip({
              act: 'fchip',
              id: o.id,
              label: o.label,
              pressed: current === o.id,
              color: o.color,
              icon: o.icon,
              extra: `data-kind="${kind}" data-group="${group}"`,
            })
          )
          .join('')}
      </div>`;
  }

  function toolbarHTML(kind) {
    const f = state.f[kind];
    const opts = scopeOptions(kind);
    const subs = opts.subjects.map((id) => ({ id, label: subjectName(id), ...subjectStyle(id) }));
    const grades = opts.grades.map((id) => ({ id, label: gradeLabel(id) }));
    const isP = kind === 'products';
    const sort = isP
      ? `<label class="sort">
           <span class="sr-only">ترتيب الملازم</span>
           <select class="select" id="sort">
             <option value="default" ${f.sort === 'default' ? 'selected' : ''}>الترتيب الافتراضي</option>
             <option value="price-asc" ${f.sort === 'price-asc' ? 'selected' : ''}>الأرخص أولًا</option>
             <option value="price-desc" ${f.sort === 'price-desc' ? 'selected' : ''}>الأغلى أولًا</option>
             <option value="name" ${f.sort === 'name' ? 'selected' : ''}>حسب الاسم</option>
           </select>
         </label>`
      : '';
    return `
      <div class="toolbar">
        <label class="search">
          ${searchSvg}
          <span class="sr-only">بحث</span>
          <input id="q" data-kind="${kind}" type="search" enterkeyhint="search" autocomplete="off"
            placeholder="${isP ? 'ابحث عن ملزمة أو مادة' : 'ابحث عن اختبار'}" value="${esc(f.q)}">
        </label>
        ${chipRow(kind, 'subject', 'تصفية حسب المادة', 'كل المواد', subs, f.subject)}
        ${chipRow(kind, 'grade', 'تصفية حسب الصف', 'كل الصفوف', grades, f.grade)}
        <div class="toolbar-row">
          <div class="segment" role="group" aria-label="نطاق العرض">
            <button type="button" data-act="scope" data-kind="${kind}" data-id="mine" aria-pressed="${f.scope === 'mine'}">${isP ? 'ملازمي' : 'اختباراتي'}</button>
            <button type="button" data-act="scope" data-kind="${kind}" data-id="all" aria-pressed="${f.scope === 'all'}">الكل</button>
          </div>
          ${sort}
        </div>
        <p class="count" id="count" aria-live="polite"></p>
      </div>`;
  }

  /* ----- البطاقات ----- */

  const addBtnInner = (p, on) =>
    `${on ? '<span aria-hidden="true">✓</span> مضافة' : '<span aria-hidden="true">+</span> أضف'}<span class="sr-only"> ${esc(p.name)}</span>`;

  function productCard(p) {
    const st = subjectStyle(p.subject);
    const on = state.cart.has(p.id);
    return `
      <article class="card pcard c-${st.color}${on ? ' is-in' : ''}" data-pid="${esc(p.id)}">
        <div class="card-top">
          <span class="card-emoji" aria-hidden="true">${st.icon}</span>
          <span class="card-grade">${esc(gradeLabel(p.grade))}</span>
        </div>
        <div class="card-body">
          <h3 class="card-title">${esc(p.name)}</h3>
          <p class="card-sub">${esc(subjectName(p.subject))}</p>
          <div class="card-foot">
            <span class="price"><b>${p.price}</b> <small>${esc(cur())}</small></span>
            <button type="button" class="add-btn" data-act="toggle-cart" data-id="${esc(p.id)}" aria-pressed="${on}">${addBtnInner(p, on)}</button>
          </div>
        </div>
      </article>`;
  }

  function quizCard(x) {
    const st = subjectStyle(x.subject);
    const metas = [];
    if (x.questions) metas.push(`${x.questions} أسئلة`);
    if (x.minutes) metas.push(`${x.minutes} دقائق`);
    return `
      <article class="card qcard c-${st.color}">
        <div class="card-top">
          <span class="card-emoji" aria-hidden="true">${st.icon}</span>
          <span class="card-grade">${esc(x.grades.map(gradeLabel).join('، ') || 'كل الصفوف')}</span>
          <span class="free-tag">مجاني</span>
        </div>
        <div class="card-body">
          <h3 class="card-title">${esc(x.title)}</h3>
          <p class="card-sub">${esc(subjectName(x.subject))}</p>
          ${x.description ? `<p class="card-desc">${esc(x.description)}</p>` : ''}
          ${metas.length ? `<p class="card-meta">${metas.map((m) => `<span class="meta-pill">${esc(m)}</span>`).join('')}</p>` : ''}
          <div class="card-foot">
            <button type="button" class="btn block small" data-act="open-quiz" data-id="${esc(x.id)}">ابدأ الاختبار</button>
          </div>
        </div>
      </article>`;
  }

  function emptyHTML(kind) {
    const f = state.f[kind];
    const isP = kind === 'products';
    let title = 'لا توجد نتائج';
    let text = 'جرّب كلمة أخرى أو غيّر التصفية.';
    let actions = '<button type="button" class="btn small" data-act="clear-filters">مسح البحث والتصفية</button>';
    if (!filtersActive(kind)) {
      if (f.scope === 'mine') {
        title = isP ? 'لا توجد ملازم لاهتماماتك بعد' : 'لا توجد اختبارات لاهتماماتك بعد';
        text = 'نضيف الجديد باستمرار. يمكنك الآن تصفح كل المحتوى.';
        actions = `<button type="button" class="btn small" data-act="scope" data-kind="${kind}" data-id="all">عرض الكل</button>
                   <a class="btn secondary small" href="#me" data-act="me-interests">تعديل اهتماماتي</a>`;
      } else {
        title = isP ? 'لا توجد ملازم حاليًا' : 'لا توجد اختبارات حاليًا';
        text = 'سنضيف المزيد قريبًا.';
        actions = '';
      }
    }
    return `
      <div class="empty">
        ${mascot('empty-mascot')}
        <h2>${title}</h2>
        <p>${text}</p>
        ${actions ? `<div class="actions">${actions}</div>` : ''}
      </div>`;
  }

  function renderResults(kind) {
    const box = $('#results');
    if (!box) return;
    const items = itemsFor(kind);
    const count = $('#count');
    if (count) count.textContent = items.length ? (kind === 'products' ? countLabel(items.length) : quizCountLabel(items.length)) : '';
    if (!items.length) {
      box.innerHTML = emptyHTML(kind);
      return;
    }
    if (kind === 'quizzes') {
      box.innerHTML = `<div class="grid">${items.map(quizCard).join('')}</div>`;
      return;
    }
    const f = state.f.products;
    const grouped = f.sort === 'default' && new Set(items.map((p) => p.grade)).size > 1;
    if (!grouped) {
      box.innerHTML = `<div class="grid">${items.map(productCard).join('')}</div>`;
      return;
    }
    const out = [];
    let last = null;
    let bucket = [];
    const flush = () => {
      if (!bucket.length) return;
      out.push(`<section class="group"><h2 class="group-title">${esc(gradeName(last))}</h2><div class="grid">${bucket.join('')}</div></section>`);
      bucket = [];
    };
    items.forEach((p) => {
      if (p.grade !== last) { flush(); last = p.grade; }
      bucket.push(productCard(p));
    });
    flush();
    box.innerHTML = out.join('');
  }

  /* ---------- الصفحات ---------- */

  function viewNotebooks() {
    const name = (state.profile.name || '').trim();
    return `
      <section class="hero">
        <div class="hero-text">
          <h1 class="page-title">${name ? `أهلًا يا ${esc(name)}!` : 'أهلًا بك!'}</h1>
          <p>اختر الملازم التي تحتاجها، وسنجهزها لك للطباعة.</p>
        </div>
        <div class="hero-art">${mascot('hero-mascot')}</div>
      </section>
      ${toolbarHTML('products')}
      <div id="results"></div>`;
  }

  function viewQuizzes() {
    return `
      <section class="page-head">
        <h1 class="page-title">اختبارات تفاعلية</h1>
        <p class="page-lead">اختبارات مجانية لكل الصفوف، وتعرف نتيجتك فور الإجابة.</p>
      </section>
      ${toolbarHTML('quizzes')}
      <div id="results"></div>`;
  }

  function cartItemHTML(p) {
    const st = subjectStyle(p.subject);
    return `
      <div class="item c-${st.color}">
        <span class="item-badge" aria-hidden="true">${st.icon}</span>
        <div class="item-text"><b>${esc(p.name)}</b><small>${esc(gradeName(p.grade))}</small></div>
        <span class="price"><b>${p.price}</b> <small>${esc(cur())}</small></span>
        <button type="button" class="remove-x" data-act="remove" data-id="${esc(p.id)}"
          aria-label="حذف ${esc(p.name)} من الطلب">×</button>
      </div>`;
  }

  function viewCart() {
    const items = cartItems();
    if (!items.length) {
      return `
        <div class="narrow">
          <a class="back" href="#notebooks">رجوع إلى الملازم</a>
          <div class="empty">
            ${mascot('empty-mascot')}
            <h2>لم تختر ملازم بعد</h2>
            <p>اختر الملازم التي تريد طباعتها وسنجهزها لك.</p>
            <div class="actions"><a class="btn" href="#notebooks">تصفح الملازم</a></div>
          </div>
        </div>`;
    }
    const t = totals(items);
    const ip = lib().instapay || {};
    const name = (state.profile && state.profile.name) || '';

    const payBox = t.delivery
      ? `
        <div class="pay-box">
          <h3>الدفع عبر انستاباي</h3>
          <p>المبلغ المطلوب تحويله</p>
          <div class="pay-amount">${esc(money(t.total))}</div>
          <div class="pay-address">
            <code>${esc(ip.address || '')}</code>
            <button type="button" class="btn secondary small" data-act="copy" data-id="${esc(ip.address || '')}">نسخ</button>
          </div>
          ${ip.accountName ? `<p class="fine">اسم الحساب: ${esc(ip.accountName)}</p>` : ''}
          <ol class="pay-steps">
            <li>حوّل المبلغ إلى العنوان أعلاه.</li>
            <li>اضغط «إرسال الطلب عبر واتساب».</li>
            <li>أرسل صورة التحويل في المحادثة.</li>
          </ol>
          <label class="check">
            <input type="checkbox" id="f-paid" ${state.paid ? 'checked' : ''}>
            <span>حوّلت المبلغ بالفعل</span>
          </label>
        </div>`
      : '';

    return `
      <a class="back" href="#notebooks">رجوع إلى الملازم</a>
      <h1 class="page-title">طلبك</h1>

      ${
        state.sent
          ? `<div class="notice">
               <b>فتحنا واتساب برسالة جاهزة</b>
               <p>اضغط إرسال داخل المحادثة لإتمام الطلب.${t.delivery ? ' ولا تنس إرسال صورة التحويل.' : ''} حفظنا الطلب في «طلباتي».</p>
               <div class="actions">
                 <button type="button" class="btn small" data-act="clear-cart">بدء طلب جديد</button>
                 <a class="btn secondary small" href="#me" data-act="me-orders">طلباتي السابقة</a>
               </div>
             </div>`
          : ''
      }

      <div class="cart-layout">
        <div class="cart-main">
          <div class="item-list">${items.map(cartItemHTML).join('')}</div>

          <section class="box">
            <h2 class="box-title">بياناتك</h2>
            <label class="field">
              <span class="label">الاسم</span>
              <input class="input" id="f-name" autocomplete="name" value="${esc(name)}" placeholder="اسم ولي الأمر أو الطالب">
            </label>
          </section>

          <section class="box">
            <h2 class="box-title">طريقة الاستلام</h2>
            <div class="options" role="radiogroup" aria-label="طريقة الاستلام">
              <label class="option">
                <input type="radio" name="mode" value="pickup" ${t.delivery ? '' : 'checked'}>
                <div><b>🏪 استلام من المكتبة</b><small>بدون رسوم</small></div>
              </label>
              <label class="option">
                <input type="radio" name="mode" value="delivery" ${t.delivery ? 'checked' : ''}>
                <div><b>🛵 توصيل إلى العنوان</b><small>تضاف ${esc(money(Number(lib().deliveryFee) || 0))} على الطلب كله، ويُدفع المبلغ مقدمًا</small></div>
              </label>
            </div>
            ${
              t.delivery
                ? `<label class="field mt">
                     <span class="label">العنوان بالتفصيل</span>
                     <textarea class="textarea" id="f-address" placeholder="المحافظة، المنطقة، الشارع، رقم المبنى">${esc(state.checkout.address)}</textarea>
                   </label>
                   ${payBox}`
                : ''
            }
          </section>
        </div>

        <aside class="cart-side">
          <div class="box summary">
            <div><span>الملازم (${items.length})</span><span>${esc(money(t.subtotal))}</span></div>
            ${t.delivery ? `<div><span>رسوم التوصيل</span><span>${esc(money(t.fee))}</span></div>` : ''}
            <div class="total"><span>الإجمالي</span><span>${esc(money(t.total))}</span></div>
          </div>
          <p class="error-text" id="cart-error" role="alert" hidden></p>
          <button type="button" class="btn block mt" data-act="send">إرسال الطلب عبر واتساب</button>
          <p class="send-note">سيفتح واتساب برسالة جاهزة، اضغط إرسال داخل المحادثة.</p>
          <div class="center"><button type="button" class="link-btn" data-act="clear-cart">إفراغ الطلب</button></div>
        </aside>
      </div>`;
  }

  /* ----- حسابي ----- */

  function orderHTML(o) {
    const date = new Date(o.ts).toLocaleString('ar-EG-u-nu-latn', {
      day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    const items = toArr(o.items);
    const rows = items
      .map((it) => {
        const st = subjectStyle(it.subject);
        return `<li class="c-${st.color}"><span class="mini-badge" aria-hidden="true">${st.icon}</span>
          <span class="li-text">${esc(it.name)}<small>${esc(gradeName(it.grade))}</small></span>
          <span class="li-price">${it.price}</span></li>`;
      })
      .join('');
    return `
      <article class="order">
        <div class="order-head">
          <div>
            <h3>طلب رقم ${o.no || ''}</h3>
            <p class="fine">${esc(date)}</p>
          </div>
          <span class="pill ${o.mode === 'delivery' ? 'pill-blue' : 'pill-green'}">${o.mode === 'delivery' ? '🛵 توصيل' : '🏪 استلام من المكتبة'}</span>
        </div>
        <details class="order-items" ${items.length <= 3 ? 'open' : ''}>
          <summary>${countLabel(items.length)}</summary>
          <ul>${rows}</ul>
        </details>
        ${o.mode === 'delivery' && o.address ? `<p class="fine">العنوان: ${esc(o.address)}</p>` : ''}
        <div class="order-foot">
          <div class="order-total"><small>الإجمالي</small><b>${esc(money(o.total))}</b></div>
          <div class="order-actions">
            <button type="button" class="btn small" data-act="reorder" data-id="${o.id}">إعادة الطلب</button>
            <button type="button" class="btn secondary small" data-act="del-order" data-id="${o.id}" aria-label="حذف طلب رقم ${o.no || ''} من السجل">حذف</button>
          </div>
        </div>
      </article>`;
  }

  function meOrders() {
    if (!state.orders.length) {
      return `
        <div class="empty">
          ${mascot('empty-mascot')}
          <h2>لا توجد طلبات سابقة</h2>
          <p>عندما ترسل طلبًا عبر واتساب سنحفظه هنا لتعيده بضغطة واحدة.</p>
          <div class="actions"><a class="btn" href="#notebooks">تصفح الملازم</a></div>
        </div>`;
    }
    return `
      <p class="fine mb">الأسعار عند إعادة الطلب هي أسعار القائمة الحالية. يُحفظ سجل الطلبات على هذا الجهاز فقط.</p>
      <div class="orders">${state.orders.map(orderHTML).join('')}</div>`;
  }

  function meInterests() {
    const pr = state.profile;
    return `
      <section class="box">
        <label class="field" style="margin:0">
          <span class="label">الاسم</span>
          <input class="input" id="me-name" autocomplete="name" value="${esc(pr.name || '')}" placeholder="اسم ولي الأمر أو الطالب">
        </label>
      </section>
      <section class="box">
        <h2 class="box-title">الصف الدراسي</h2>
        <p class="fine mb">يمكنك اختيار أكثر من صف.</p>
        ${gradeChips(pr.grades, 'm-grade')}
      </section>
      <section class="box">
        <h2 class="box-title">المواد التي تهمك</h2>
        <p class="fine mb">اختر «كل المواد» لعرض كل شيء.</p>
        ${subjectChips(pr.subjects, availableSubjects(pr.grades), 'm-subject')}
      </section>`;
  }

  function installCardHTML() {
    if (isStandalone()) return '';
    return `
      <section class="box">
        <h2 class="box-title">ثبّت التطبيق</h2>
        <p>أضف أبجد إلى شاشة موبايلك لتفتحه بضغطة واحدة.</p>
        <button type="button" class="btn mt" data-act="open-install">${state.installEvent ? 'تثبيت التطبيق' : 'طريقة التثبيت'}</button>
      </section>`;
  }

  function meSettings() {
    const pref = themePref();
    const opt = (id, label) => `<button type="button" data-act="theme" data-id="${id}" aria-pressed="${pref === id}">${label}</button>`;
    return `
      <section class="box">
        <h2 class="box-title">المظهر</h2>
        <div class="segment three" role="group" aria-label="المظهر">
          ${opt('auto', 'تلقائي')}${opt('light', '☀️ فاتح')}${opt('dark', '🌙 داكن')}
        </div>
      </section>
      ${installCardHTML()}
      <section class="box">
        <h2 class="box-title">القائمة</h2>
        <p>تتحدث الملازم والاختبارات تلقائيًا عند تغيير القائمة في المكتبة.</p>
        <button type="button" class="btn secondary mt" data-act="refresh">تحديث القائمة الآن</button>
      </section>`;
  }

  function viewMe() {
    const pr = state.profile;
    const tab = state.meTab;
    const tabBtn = (id, label) => `<button type="button" data-act="me-tab" data-id="${id}" aria-pressed="${tab === id}">${label}</button>`;
    const body = tab === 'orders' ? meOrders() : tab === 'interests' ? meInterests() : meSettings();
    const name = (pr.name || '').trim();
    return `
      <div class="narrow">
        <section class="profile-card">
          <div class="avatar">${mascot()}</div>
          <div>
            <h1 class="page-title">${name ? esc(name) : 'حسابي'}</h1>
            <p class="fine">${esc(whoLabel())}${pr.subjects.length ? ' · ' + pr.subjects.map(subjectName).map(esc).join('، ') : ' · كل المواد'}</p>
          </div>
        </section>
        <div class="segment three" role="group" aria-label="أقسام حسابي">
          ${tabBtn('orders', `🧾 طلباتي`)}${tabBtn('interests', '⭐ اهتماماتي')}${tabBtn('settings', '⚙️ الإعدادات')}
        </div>
        <div class="me-body">${body}</div>
      </div>`;
  }

  const VIEWS = { notebooks: viewNotebooks, quizzes: viewQuizzes, me: viewMe, cart: viewCart };

  /* ---------- العرض والتنقل ---------- */

  function route() {
    const h = location.hash.replace('#', '');
    return VIEWS[h] ? h : 'notebooks';
  }

  function whoLabel() {
    const g = state.profile.grades;
    if (g.length === 1) return gradeLabel(g[0]);
    if (g.length === 2) return 'صفّان دراسيان';
    return `${g.length} صفوف دراسية`;
  }

  function renderView(focusSel) {
    if (!state.profile) return;
    state.view = route();
    $('#view').innerHTML = VIEWS[state.view]();
    if (state.view === 'notebooks') renderResults('products');
    if (state.view === 'quizzes') renderResults('quizzes');

    $$('.tabs a').forEach((a) => {
      const active = a.dataset.tab === (state.view === 'cart' ? 'notebooks' : state.view);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    const who = $('#who');
    who.textContent = whoLabel();
    who.setAttribute('aria-label', `حسابي. الاختيار الحالي: ${whoLabel()}`);

    renderCartBar();
    if (focusSel) {
      const el = $(focusSel);
      if (el) el.focus({ preventScroll: true });
    }
  }

  window.addEventListener('hashchange', () => {
    if (state.onb) return;
    renderView();
    window.scrollTo(0, 0);
    $('#view').focus({ preventScroll: true });
  });

  /* ---------- الطبقات المنبثقة ---------- */

  function setOverlay(html, focusSel) {
    $('#overlay').innerHTML = html;
    document.body.style.overflow = html ? 'hidden' : '';
    if (html && focusSel) {
      const el = $(focusSel, $('#overlay'));
      if (el) el.focus({ preventScroll: true });
    }
  }

  function closeOverlay() {
    setOverlay('');
    if (state.lastFocus && document.contains(state.lastFocus)) state.lastFocus.focus({ preventScroll: true });
    state.lastFocus = null;
  }

  /* ---------- شاشة الترحيب (الخطوات الأولى) ---------- */

  function startOnboarding() {
    const pr = state.profile || {};
    state.onb = {
      step: 1,
      grades: toArr(pr.grades).slice(),
      subjects: toArr(pr.subjects).slice(),
      name: pr.name || '',
      shown: false,
    };
    renderOnboarding();
  }

  function renderOnboarding(focusSel) {
    const o = state.onb;
    let card = '';
    if (o.step === 1) {
      card = `
        <p class="step-count">الخطوة 1 من 3</p>
        <h1 id="onb-title" tabindex="-1">اختر الصف الدراسي</h1>
        <p class="lead">يمكنك اختيار أكثر من صف إذا كان لديك أكثر من طالب.</p>
        ${gradeChips(o.grades, 'o-grade')}
        <div class="step-actions single">
          <button type="button" class="btn block" id="onb-next" data-act="o-next" ${o.grades.length ? '' : 'disabled'}>التالي</button>
        </div>`;
    } else if (o.step === 2) {
      card = `
        <p class="step-count">الخطوة 2 من 3</p>
        <h1 id="onb-title" tabindex="-1">ما المواد التي تهمك؟</h1>
        <p class="lead">سنعرض لك ملازم واختبارات هذه المواد فقط. يمكنك تغييرها لاحقًا من «حسابي».</p>
        ${subjectChips(o.subjects, availableSubjects(o.grades), 'o-subject')}
        <div class="step-actions">
          <button type="button" class="btn secondary" data-act="o-back">رجوع</button>
          <button type="button" class="btn" data-act="o-next">التالي</button>
        </div>`;
    } else {
      card = `
        <p class="step-count">الخطوة 3 من 3</p>
        <h1 id="onb-title" tabindex="-1">ما اسمك؟</h1>
        <p class="lead">نكتبه في رسالة الطلب حتى نعرف صاحب الطلب. يمكنك تركه فارغًا الآن.</p>
        <input class="input" id="onb-name" autocomplete="name" placeholder="اسم ولي الأمر أو الطالب" value="${esc(o.name)}">
        <div class="step-actions">
          <button type="button" class="btn secondary" data-act="o-back">رجوع</button>
          <button type="button" class="btn" data-act="o-finish">ابدأ</button>
        </div>`;
    }

    setOverlay(
      `<div class="welcome" role="dialog" aria-modal="true" aria-labelledby="onb-title">
         <div class="welcome-inner">
           <div class="welcome-brand${o.shown ? ' still' : ''}">
             <span class="logo logo-xl">${esc(lib().name)}</span>
             ${mascot('welcome-mascot')}
           </div>
           <p class="tagline">${esc(lib().tagline || 'اختر ملازمك ونحن نطبعها لك')}</p>
           <section class="step-card">
             <div class="steps" aria-hidden="true"><i class="${o.step >= 1 ? 'on' : ''}"></i><i class="${o.step >= 2 ? 'on' : ''}"></i><i class="${o.step >= 3 ? 'on' : ''}"></i></div>
             ${card}
           </section>
         </div>
       </div>`,
      focusSel
    );
    o.shown = true;
  }

  function finishOnboarding() {
    const o = state.onb;
    const avail = new Set(availableSubjects(o.grades).map((s) => s.id));
    state.profile = {
      grades: o.grades.slice(),
      subjects: o.subjects.filter((id) => avail.has(id)),
      name: o.name.trim(),
    };
    write(KEYS.profile, state.profile);
    state.onb = null;
    state.f = { products: Object.assign(newFilters(), { sort: 'default' }), quizzes: newFilters() };
    setOverlay('');
    $('#app').hidden = false;
    history.replaceState(null, '', '#notebooks');
    renderView();
    window.scrollTo(0, 0);
    setTimeout(openInstallSheet, 400); // بعد استكمال البيانات نعرض خطوة التثبيت
  }

  /* ---------- تثبيت التطبيق ---------- */

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installEvent = e;
    if (state.view === 'me' && state.meTab === 'settings') renderView();
  });
  window.addEventListener('appinstalled', () => {
    state.installEvent = null;
    if ($('#overlay .install-panel')) closeOverlay();
    if (state.profile && state.view === 'me') renderView();
    toast('تم تثبيت التطبيق');
  });

  function openInstallSheet() {
    if (isStandalone() || state.onb) return;
    let body;
    let action = '';
    if (state.installEvent) {
      body = '<p>ثبّت التطبيق على موبايلك لتفتحه في أي وقت من الشاشة الرئيسية.</p>';
      action = '<button type="button" class="btn" data-act="install">تثبيت التطبيق</button>';
    } else if (isIOS()) {
      body = `<p>لتثبيت التطبيق على الآيفون:</p>
        <ol>
          <li>اضغط زر المشاركة في شريط المتصفح.</li>
          <li>اختر «إضافة إلى الشاشة الرئيسية».</li>
          <li>اضغط «إضافة».</li>
        </ol>`;
    } else {
      body = `<p>لتثبيت التطبيق افتح قائمة المتصفح، ثم اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».</p>`;
    }
    state.lastFocus = document.activeElement;
    setOverlay(
      `<div class="sheet-modal" role="dialog" aria-modal="true" aria-labelledby="inst-title">
         <div class="sheet-panel install-panel">
           ${mascot('sheet-mascot')}
           <h2 id="inst-title">ثبّت أبجد على موبايلك</h2>
           ${body}
           <div class="actions">
             ${action}
             <button type="button" class="btn secondary" data-act="close-overlay">ليس الآن</button>
           </div>
         </div>
       </div>`,
      '.install-panel .btn'
    );
  }

  async function runInstall() {
    const ev = state.installEvent;
    if (!ev) return;
    ev.prompt();
    try { await ev.userChoice; } catch (_) { /* لا شيء */ }
    state.installEvent = null;
    closeOverlay();
    if (state.view === 'me') renderView();
  }

  /* ---------- الاختبارات ---------- */

  function openQuiz(id) {
    const x = state.quizMap.get(id);
    if (!x) return;
    state.lastFocus = document.activeElement;
    const sep = x.file.includes('?') ? '&' : '?';
    const src = `${x.file}${sep}theme=${resolvedTheme()}`; // الاختبارات الجاهزة تقرأ theme لتطابق المظهر
    setOverlay(
      `<div class="viewer" role="dialog" aria-modal="true" aria-label="${esc(x.title)}">
         <div class="viewer-bar">
           <h2>${esc(x.title)}</h2>
           <a href="${esc(x.file)}" target="_blank" rel="noopener">فتح في صفحة مستقلة</a>
           <button type="button" class="close" data-act="close-overlay">إغلاق</button>
         </div>
         <iframe src="${esc(src)}" title="${esc(x.title)}"></iframe>
       </div>`,
      '.viewer .close'
    );
  }

  /* ---------- إرسال الطلب عبر واتساب ---------- */

  function waNumber() {
    let n = String(lib().whatsapp || '').replace(/\D/g, '');
    if (n.startsWith('00')) n = n.slice(2);
    if (n.startsWith('0')) n = '2' + n; // 01012345678 -> 201012345678
    return n;
  }

  function buildMessage(items, name) {
    const t = totals(items);
    const lines = [];
    lines.push(`طلب طباعة ملازم - مكتبة ${lib().name}`);
    lines.push(`الاسم: ${name}`);
    lines.push('');
    lines.push('الملازم المطلوبة:');
    items.forEach((p, i) => lines.push(`${i + 1}) ${p.name} - ${gradeName(p.grade)} (${money(p.price)})`));
    lines.push('');
    lines.push(`عدد الملازم: ${items.length}`);
    if (t.delivery) {
      lines.push('طريقة الاستلام: توصيل');
      lines.push(`العنوان: ${state.checkout.address.trim()}`);
      lines.push(`رسوم التوصيل: ${money(t.fee)}`);
    } else {
      lines.push('طريقة الاستلام: من المكتبة');
    }
    lines.push(`الإجمالي: ${money(t.total)}`);
    if (t.delivery) {
      lines.push('');
      lines.push('تم تحويل المبلغ عبر انستاباي، وسأرسل صورة التحويل في هذه المحادثة.');
    }
    return lines.join('\n');
  }

  function cartError(msg, el) {
    const box = $('#cart-error');
    box.textContent = msg;
    box.hidden = false;
    if (el) {
      el.classList.add('invalid');
      el.focus();
    } else {
      box.scrollIntoView({ block: 'center' });
    }
  }

  function sendOrder() {
    const items = cartItems();
    if (!items.length) return;
    const t = totals(items);
    const nameEl = $('#f-name');
    const name = nameEl.value.trim();

    if (!name) return cartError('اكتب اسمك حتى نعرف صاحب الطلب.', nameEl);
    if (!waNumber()) return cartError('رقم واتساب المكتبة غير مضبوط. أبلغ المكتبة بالمشكلة.');
    if (t.delivery) {
      const addrEl = $('#f-address');
      if (!state.checkout.address.trim()) return cartError('اكتب عنوان التوصيل بالتفصيل.', addrEl);
      if (!state.paid) return cartError('حوّل المبلغ عبر انستاباي أولًا، ثم علّم على «حوّلت المبلغ بالفعل».', $('#f-paid'));
    }

    const url = `https://wa.me/${waNumber()}?text=${encodeURIComponent(buildMessage(items, name))}`;
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();

    saveOrder(items, t, name);
    state.sent = true;
    renderView();
    window.scrollTo(0, 0);
  }

  /* ---------- إشعار صغير ونسخ ---------- */

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { /* لا شيء */ }
      ta.remove();
      return ok;
    }
  }

  /* ---------- الأحداث ---------- */

  function toggleIn(arr, id) {
    const i = arr.indexOf(id);
    if (i === -1) arr.push(id);
    else arr.splice(i, 1);
  }

  const kindOf = (el) => (el.dataset.kind === 'quizzes' ? 'quizzes' : 'products');

  const actions = {
    // التصفية والبحث
    scope(el) {
      const f = state.f[kindOf(el)];
      f.scope = el.dataset.id;
      f.grade = '';
      f.subject = '';
      renderView();
    },
    fchip(el) {
      const kind = kindOf(el);
      const f = state.f[kind];
      const group = el.dataset.group;
      f[group] = f[group] === el.dataset.id ? '' : el.dataset.id;
      $$(`[data-act="fchip"][data-group="${group}"]`).forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.id === f[group]))
      );
      renderResults(kind);
    },
    'clear-filters'() {
      const kind = state.view === 'quizzes' ? 'quizzes' : 'products';
      Object.assign(state.f[kind], { q: '', grade: '', subject: '' });
      renderView('#q');
    },

    // الطلب
    'toggle-cart'(el) {
      const id = el.dataset.id;
      const on = !state.cart.has(id);
      toggleCart(id, on);
      const p = state.productMap.get(id);
      $$(`[data-pid="${CSS.escape(id)}"]`).forEach((card) => {
        card.classList.toggle('is-in', on);
        const b = $('.add-btn', card);
        b.setAttribute('aria-pressed', String(on));
        b.innerHTML = addBtnInner(p, on);
      });
    },
    remove(el) {
      toggleCart(el.dataset.id, false);
      renderView();
    },
    'clear-cart'() {
      state.cart.clear();
      write(KEYS.cart, []);
      state.sent = false;
      state.paid = false;
      renderView();
      toast('تم إفراغ الطلب');
    },
    send: sendOrder,
    async copy(el) {
      const ok = await copyText(el.dataset.id);
      toast(ok ? 'تم نسخ العنوان' : 'تعذر النسخ، انسخه يدويًا');
    },

    // الخطوات الأولى
    'o-grade'(el) {
      toggleIn(state.onb.grades, el.dataset.id);
      el.setAttribute('aria-pressed', String(state.onb.grades.includes(el.dataset.id)));
      $('#onb-next').disabled = state.onb.grades.length === 0;
    },
    'o-subject'(el) {
      const o = state.onb;
      if (el.dataset.id === '*') o.subjects = [];
      else toggleIn(o.subjects, el.dataset.id);
      renderOnboarding(`[data-act="o-subject"][data-id="${CSS.escape(el.dataset.id)}"]`);
    },
    'o-next'() {
      const o = state.onb;
      if (o.step === 1 && !o.grades.length) return;
      if (o.step === 1) {
        const avail = new Set(availableSubjects(o.grades).map((s) => s.id));
        o.subjects = o.subjects.filter((id) => avail.has(id));
      }
      o.step += 1;
      renderOnboarding('#onb-title');
    },
    'o-back'() {
      state.onb.step -= 1;
      renderOnboarding('#onb-title');
    },
    'o-finish': finishOnboarding,

    // حسابي
    'me-tab'(el) {
      state.meTab = el.dataset.id;
      renderView();
    },
    'me-orders'() { state.meTab = 'orders'; },
    'me-interests'() { state.meTab = 'interests'; },
    theme(el) {
      setTheme(el.dataset.id);
      renderView();
    },
    'm-grade'(el) {
      const pr = state.profile;
      const id = el.dataset.id;
      if (pr.grades.includes(id) && pr.grades.length === 1) return toast('اختر صفًا دراسيًا واحدًا على الأقل');
      toggleIn(pr.grades, id);
      const avail = new Set(availableSubjects(pr.grades).map((s) => s.id));
      pr.subjects = pr.subjects.filter((s) => avail.has(s));
      write(KEYS.profile, pr);
      state.f.products = Object.assign(newFilters(), { sort: state.f.products.sort });
      state.f.quizzes = newFilters();
      renderView(`[data-act="m-grade"][data-id="${CSS.escape(id)}"]`);
    },
    'm-subject'(el) {
      const pr = state.profile;
      if (el.dataset.id === '*') pr.subjects = [];
      else toggleIn(pr.subjects, el.dataset.id);
      write(KEYS.profile, pr);
      state.f.products = Object.assign(newFilters(), { sort: state.f.products.sort });
      state.f.quizzes = newFilters();
      renderView(`[data-act="m-subject"][data-id="${CSS.escape(el.dataset.id)}"]`);
    },
    refresh: async () => {
      const r = await loadData();
      if (r.changed) renderView();
      toast(r.ok ? 'القائمة محدّثة' : 'تعذر التحديث. تحقق من الاتصال بالإنترنت');
    },
    reorder(el) {
      const o = state.orders.find((x) => String(x.id) === el.dataset.id);
      if (!o) return;
      let added = 0;
      let missing = 0;
      toArr(o.items).forEach((it) => {
        if (state.productMap.has(it.id)) { state.cart.add(it.id); added += 1; }
        else missing += 1;
      });
      if (!added) return toast('هذه الملازم لم تعد متاحة');
      write(KEYS.cart, [...state.cart]);
      state.sent = false;
      if (missing) toast(`أضفنا ${added} وتعذر إضافة ${missing} لأنها لم تعد متاحة`);
      location.hash = '#cart';
    },
    'del-order'(el) {
      state.orders = state.orders.filter((x) => String(x.id) !== el.dataset.id);
      write(KEYS.orders, state.orders);
      renderView();
      toast('تم حذف الطلب من السجل');
    },

    // الاختبارات والتثبيت
    'open-quiz'(el) { openQuiz(el.dataset.id); },
    'open-install'() {
      if (state.installEvent) runInstall();
      else openInstallSheet();
    },
    install: runInstall,
    'close-overlay': closeOverlay,
    retry() { boot(); },
  };

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const fn = actions[el.dataset.act];
    if (fn) fn(el, ev);
  });

  $('#theme-btn').addEventListener('click', () => {
    setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark');
    if (state.profile && state.view === 'me') renderView();
  });

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'sort') {
      state.f.products.sort = t.value;
      renderResults('products');
    } else if (t.matches('input[name="mode"]')) {
      state.checkout.mode = t.value;
      write(KEYS.checkout, { mode: state.checkout.mode, address: state.checkout.address });
      state.paid = false;
      renderView(`input[name="mode"][value="${t.value}"]`);
    } else if (t.id === 'f-paid') {
      state.paid = t.checked;
      $('#cart-error').hidden = true;
    }
  });

  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'q') {
      const kind = kindOf(t);
      state.f[kind].q = t.value;
      renderResults(kind);
    } else if (t.id === 'f-name' || t.id === 'me-name' || t.id === 'onb-name') {
      const v = t.value;
      if (t.id === 'onb-name') state.onb.name = v;
      else {
        state.profile.name = v;
        write(KEYS.profile, state.profile);
      }
      t.classList.remove('invalid');
      const box = $('#cart-error');
      if (box) box.hidden = true;
    } else if (t.id === 'f-address') {
      state.checkout.address = t.value;
      write(KEYS.checkout, { mode: state.checkout.mode, address: t.value });
      t.classList.remove('invalid');
      $('#cart-error').hidden = true;
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && $('#overlay .viewer, #overlay .install-panel')) closeOverlay();
    if (ev.key === 'Enter' && ev.target.id === 'onb-name') {
      ev.preventDefault();
      finishOnboarding();
    }
  });

  /* ---------- التحديث التلقائي ---------- */

  async function refreshQuietly() {
    if (!state.profile || state.onb) return;
    const r = await loadData();
    if (!r.changed) return;
    const a = document.activeElement;
    const typing = a && $('#view').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
    if (state.profile) {
      if (!typing) renderView();
    } else {
      startOnboarding(); // الصفوف المختارة لم تعد موجودة
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.loadedAt > 15000) refreshQuietly();
  });
  window.addEventListener('online', refreshQuietly);
  setInterval(() => { if (!document.hidden) refreshQuietly(); }, 60000);

  /* ---------- التشغيل ---------- */

  async function boot() {
    applyTheme();
    setOverlay(`<div class="welcome"><div class="welcome-inner loading">
        <span class="logo logo-xl">أبجد</span>${mascot('welcome-mascot')}<p class="tagline">جارٍ التحميل…</p>
      </div></div>`);
    const r = await loadData();
    if (!r.ok) {
      setOverlay(`
        <div class="welcome"><div class="welcome-inner loading">
          ${mascot('welcome-mascot')}
          <section class="step-card">
            <h1>تعذر تحميل القائمة</h1>
            <p class="lead">تأكد من اتصالك بالإنترنت ثم حاول مرة أخرى.</p>
            <div class="step-actions single"><button type="button" class="btn block" data-act="retry">إعادة المحاولة</button></div>
          </section>
        </div></div>`);
      return;
    }
    if (!state.profile) {
      startOnboarding();
      return;
    }
    setOverlay('');
    $('#app').hidden = false;
    renderView();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* يعمل الموقع بدونه */ });
    });
  }

  boot();
})();
