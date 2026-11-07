/* ==========================================================
   مكتبة أبجد — منطق التطبيق
   - كل البيانات تأتي من: data/products.json و data/exercises.json
   - لا يوجد سيرفر: ما يختاره العميل يُحفظ في متصفحه (localStorage)
   - الثيم: فاتح/داكن/النظام، يُحفظ والاختيار يُقرأ قبل رسم الصفحة
   - ▲ ملاحظة: عند تعديل ملفات الواجهة ارفع CACHE في sw.js
   ========================================================== */
(() => {
  'use strict';

  /* ---------- أدوات صغيرة ---------- */

  const KEYS = {
    profile: 'abgad.profile.v1',
    cart: 'abgad.cart.v1',
    checkout: 'abgad.checkout.v1',
    data: 'abgad.data.v1',
    theme: 'abgad.theme.v1',
    orders: 'abgad.orders.v1',
    quiz: 'abgad.quiz.v1',
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const toArr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // توحيد الحروف العربية لتعمل شاشة البحث بدقة (أ/إ/آ، ة/ه، ى/ي، التشكيل)
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670]/g, '')
      .replace(/[\u0623\u0625\u0622]/g, '\u0627')
      .replace(/\u0629/g, '\u0647')
      .replace(/\u0649/g, '\u064A')
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
    } catch (_) { /* التخزين غير متاح: نتجاهل */ }
  }

  const debounce = (fn, ms = 150) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  /* ---------- رموز المواد والملصقات ---------- */

  const SUBJECT_ICONS = {
    arabic: '✍️',
    english: '🔤',
    french: '🥐',
    math: '➗',
    science: '🔬',
    social: '🌍',
    religion: '🕌',
    computer: '💻',
  };
  const subjectIcon = (id) => SUBJECT_ICONS[id] || '📚';
  const DIFFICULTY_LABEL = { easy: 'سهل', medium: 'متوسط', hard: 'صعب' };

  /* ---------- الحالة ---------- */

  const state = {
    data: null,
    products: [],
    exercises: [],
    gradeMap: new Map(),
    subjectMap: new Map(),
    productMap: new Map(),
    exMap: new Map(),
    raw: '',
    loadedAt: 0,

    profile: read(KEYS.profile, null),
    cart: new Set(toArr(read(KEYS.cart, []))),
    checkout: Object.assign({ mode: 'pickup', address: '' }, read(KEYS.checkout, {})),
    paid: false,
    sent: false,

    theme: read(KEYS.theme, 'system') || 'system',
    orders: read(KEYS.orders, []),
    quizStats: read(KEYS.quiz, {}),

    view: 'notebooks',
    scope: 'mine', // mine | all
    meTab: 'orders',

    filters: { q: '', grade: [], subject: [], sort: 'default' },
    qFilters: { q: '', grade: [], subject: [], difficulty: '' },

    onb: null,
    pendingQuiz: null,
    installEvent: null,
    lastFocus: null,
  };

  const lib = () => state.data.library;
  const money = (n) => `${n} ${lib().currency || 'جنيه'}`;
  const gradeName = (id) => (state.gradeMap.get(id) || {}).name || id || '';
  const subjectName = (id) => (state.subjectMap.get(id) || {}).name || id || '';

  /* ---------- الثيم ---------- */

  function applyTheme(mode) {
    state.theme = mode;
    const dark = mode === 'dark' ||
      (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const resolved = dark ? 'dark' : 'light';
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themeMode = mode;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#111827' : '#FFF8EE';
    const btn = $('#theme-toggle');
    if (btn) btn.setAttribute('aria-pressed', String(dark));
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.theme === 'system') applyTheme('system');
  });

  function toggleThemeAction() {
    const currentDark = document.documentElement.dataset.theme === 'dark';
    applyTheme(currentDark ? 'light' : 'dark');
    write(KEYS.theme, state.theme);
    // نحدّث نص علبة الإعدادات إن كانت ظاهرة
    if (state.view === 'me' && state.meTab === 'settings') renderView();
  }

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

  async function loadData() {
    const cached = read(KEYS.data, null) || {};
    let pText = null;
    let eText = null;
    try { pText = await fetchText('data/products.json'); } catch (_) { pText = cached.p || null; }
    try { eText = await fetchText('data/exercises.json'); } catch (_) { eText = cached.e || null; }

    if (pText == null) return { ok: false, changed: false };

    const p = parseOr(pText, cached.p, 'products.json');
    if (!p) return { ok: false, changed: false };
    const e = eText != null ? parseOr(eText, cached.e, 'exercises.json') : null;

    const raw = p.text + '|' + (e ? e.text : '');
    state.loadedAt = Date.now();
    if (raw === state.raw) return { ok: true, changed: false };

    state.raw = raw;
    write(KEYS.data, { p: p.text, e: e ? e.text : '' });
    applyData(p.obj, e ? e.obj : { exercises: [] });
    return { ok: true, changed: true };
  }

  function applyData(p, e) {
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
        oldPrice: Number(x.oldPrice) || 0,
        description: String(x.description || ''),
        emoji: String(x.emoji || ''),
        badge: String(x.badge || ''),
        tags: toArr(x.tags).map(String),
        grades: [x.grade],
        _i: i,
      }))
      .sort((a, b) => gOrder(a.grade) - gOrder(b.grade) || sOrder(a.subject) - sOrder(b.subject) || a._i - b._i);
    state.productMap = new Map(state.products.map((x) => [x.id, x]));

    state.exercises = toArr(e && e.exercises)
      .filter((x) => x && x.id)
      .map((x, i) => {
        const questions = toArr(x.questions)
          .map((q) => {
            const a = Number.isInteger(q.a) ? q.a : Number.isInteger(q.answer) ? q.answer : -1;
            return {
              q: String(q.q || ''),
              options: toArr(q.options).map(String),
              a,
              explanation: String(q.explanation || ''),
            };
          })
          .filter((q) => q.q && q.options.length >= 2 && q.a >= 0 && q.a < q.options.length);
        const file = x.file ? String(x.file) : '';
        return {
          id: String(x.id),
          title: String(x.title || ''),
          description: String(x.description || ''),
          subject: x.subject,
          grades: toArr(x.grade).filter(Boolean),
          difficulty: DIFFICULTY_LABEL[x.difficulty] ? x.difficulty : 'easy',
          duration: Number(x.duration) || 0,
          free: x.free !== false,
          tags: toArr(x.tags).map(String),
          questions,
          file,
          legacy: !questions.length && !!file, // نسخة HTML قديمة
          _i: i,
        };
      })
      .filter((x) => x.questions.length || x.legacy)
      .sort(
        (a, b) =>
          gOrder(a.grades[0]) - gOrder(b.grades[0]) || sOrder(a.subject) - sOrder(b.subject) || a._i - b._i
      );
    state.exMap = new Map(state.exercises.map((x) => [x.id, x]));

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

  function inScope(item) {
    if (state.scope === 'all' || !state.profile) return true;
    const pr = state.profile;
    const gradeOk = !item.grades.length || item.grades.some((g) => pr.grades.includes(g));
    const subjectOk = !pr.subjects.length || pr.subjects.includes(item.subject);
    return gradeOk && subjectOk;
  }

  // المواد الموجودة فعليًا للصفوف المختارة
  function availableSubjects(gradeIds) {
    const ids = new Set();
    const take = (it) => {
      if (!it.grades.length || it.grades.some((g) => gradeIds.includes(g))) ids.add(it.subject);
    };
    state.products.forEach(take);
    state.exercises.forEach(take);
    const list = state.data.subjects.filter((s) => ids.has(s.id));
    ids.forEach((id) => {
      if (id && !state.subjectMap.has(id)) list.push({ id, name: id });
    });
    return list.length ? list : state.data.subjects;
  }

  function subjectChoices() {
    const pr = state.profile;
    if (pr.subjects.length) return pr.subjects.map((id) => ({ id, name: subjectName(id) }));
    return availableSubjects(pr.grades);
  }

  /* ---------- فلاتر الملازم ---------- */

  function productsInView() {
    let list = state.products.filter(inScope);
    const f = state.filters;
    if (f.grade.length) list = list.filter((p) => f.grade.includes(p.grade));
    if (f.subject.length) list = list.filter((p) => f.subject.includes(p.subject));
    if (f.q.trim()) {
      const q = norm(f.q);
      list = list.filter((p) =>
        norm(`${p.name} ${subjectName(p.subject)} ${gradeName(p.grade)} ${p.tags.join(' ')} ${p.description}`).includes(q)
      );
    }
    if (f.sort === 'price-asc') list = [...list].sort((a, b) => a.price - b.price);
    else if (f.sort === 'price-desc') list = [...list].sort((a, b) => b.price - a.price);
    return list;
  }

  function gradesInView(list) {
    const grades = state.data.grades.filter((g) => list.some((p) => p.grade === g.id));
    const others = [...new Set(list.map((p) => p.grade))].filter((id) => !state.gradeMap.has(id));
    return [...grades.map((g) => g.id), ...others];
  }

  /* ---------- فلاتر الاختبارات ---------- */

  function quizzesInView() {
    let list = state.exercises.filter(inScope);
    const f = state.qFilters;
    if (f.grade.length) list = list.filter((x) => x.grades.some((g) => f.grade.includes(g)) || !x.grades.length);
    if (f.subject.length) list = list.filter((x) => f.subject.includes(x.subject));
    if (f.difficulty) list = list.filter((x) => x.difficulty === f.difficulty);
    if (f.q.trim()) {
      const q = norm(f.q);
      list = list.filter((x) =>
        norm(`${x.title} ${subjectName(x.subject)} ${x.grades.map(gradeName).join(' ')} ${x.tags.join(' ')} ${x.description}`).includes(q)
      );
    }
    return list;
  }

  /* ---------- السلة ---------- */

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

  function toggleCart(id, on) {
    if (on) state.cart.add(id);
    else state.cart.delete(id);
    write(KEYS.cart, [...state.cart]);
    state.sent = false;
    renderCartBar();
  }

  // تحديث زر البطاقة دون إعادة رسم القائمة كلها (حفاظًا على التركيز)
  function syncProductCard(id) {
    const on = state.cart.has(id);
    const card = document.querySelector(`.product-card[data-id="${CSS.escape(id)}"]`);
    if (card) card.classList.toggle('is-selected', on);
    const btn = document.querySelector(`[data-act="toggle-product"][data-id="${CSS.escape(id)}"]`);
    if (btn) {
      btn.setAttribute('aria-pressed', String(on));
      btn.textContent = on ? 'في الطلب ✓' : 'أضف للطلب';
    }
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
          <a class="btn marker" href="#cart">مراجعة الطلب</a>
        </div>`;
    }
    $('b', bar).textContent = countLabel(items.length);
    $('span', bar).textContent = money(items.reduce((s, p) => s + p.price, 0));
    bar.hidden = false;
  }

  /* ---------- مكونات HTML ---------- */

  function chips(values, act, selected, labelFn = (v) => v, allLabel = 'الكل') {
    return `
      <div class="chip-scroll" role="group" aria-label="تصفية">
        <button type="button" class="chip" data-act="${act}" data-id="" aria-pressed="${!selected}">${allLabel}</button>
        ${values
          .map(
            (v) => `<button type="button" class="chip" data-act="${act}" data-id="${esc(v)}" aria-pressed="${selected === v}">${esc(labelFn(v))}</button>`
          )
          .join('')}
      </div>`;
  }

  function productCardHTML(p) {
    const selected = state.cart.has(p.id);
    return `
      <article class="product-card ${selected ? 'is-selected' : ''}" data-id="${esc(p.id)}">
        <div class="card-top">
          <span class="subject-icon" aria-hidden="true">${esc(p.emoji || subjectIcon(p.subject))}</span>
          <span class="grade-badge">${esc(gradeName(p.grade))}</span>
        </div>
        ${p.badge ? `<span class="product-badge">${esc(p.badge)}</span>` : ''}
        <h3 class="card-name">${esc(p.name)}</h3>
        <p class="card-sub">${esc(subjectName(p.subject))}${p.description ? ` — ${esc(p.description)}` : ''}</p>
        <div class="card-foot">
          <span class="price">${p.price} <small>${esc(lib().currency)}</small>${p.oldPrice > p.price ? ` <s>${p.oldPrice}</s>` : ''}</span>
          <button type="button" class="add-btn" data-act="toggle-product" data-id="${esc(p.id)}" aria-pressed="${selected}">${selected ? 'في الطلب ✓' : 'أضف للطلب'}</button>
        </div>
      </article>`;
  }

  function productSections(items) {
    const out = [];
    gradesInView(items).forEach((gid) => {
      const list = items.filter((p) => p.grade === gid);
      out.push(`
        <section class="grade-section">
          <h2 class="grade-head">${esc(gradeName(gid))}<span class="count">${list.length}</span></h2>
          <div class="product-grid">${list.map(productCardHTML).join('')}</div>
        </section>`);
    });
    return out.join('');
  }

  function searchInput(id, placeholder, value) {
    return `
      <label class="search-field">
        <span class="sr-only">${esc(placeholder)}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
        <input class="input" type="search" id="${id}" placeholder="${esc(placeholder)}" value="${esc(value)}" autocomplete="off">
      </label>`;
  }

  function sortSelect() {
    return `
      <label class="sort-field">
        <span class="sr-only">ترتيب النتائج</span>
        <select class="input" id="f-sort">
          <option value="default" ${state.filters.sort === 'default' ? 'selected' : ''}>الترتيب الافتراضي</option>
          <option value="price-asc" ${state.filters.sort === 'price-asc' ? 'selected' : ''}>السعر: الأقل أولًا</option>
          <option value="price-desc" ${state.filters.sort === 'price-desc' ? 'selected' : ''}>السعر: الأعلى أولًا</option>
        </select>
      </label>`;
  }

  function resultCountHTML(id, n, countWord) {
    return `<p class="result-count" id="${id}" role="status" aria-live="polite">${n} ${esc(countWord)}</p>`;
  }

  /* زر فتح قائمة فلترة */
  function filterBtn(act, isActive, label) {
    return `
      <button type="button" class="filter-btn ${isActive ? 'is-active' : ''}" data-act="${act}" aria-haspopup="dialog"
        aria-label="${esc(label)} — اضغط لفتح قائمة الاختيار">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
        <span>${esc(label)}</span>
      </button>`;
  }

  /* نص زر الفلترة المتعددة: اسم واحد أو عدّاد */
  function multiLabel(arr, labelFn, allText, unit) {
    if (!arr.length) return allText;
    if (arr.length === 1) return labelFn(arr[0]);
    return `‏${arr.length} ${unit}`;
  }

  /* ---------- نوافذ الفلترة العائمة ---------- */

  function notebookSubjectIds() {
    let list = state.products.filter(inScope);
    if (state.filters.grade.length) list = list.filter((p) => state.filters.grade.includes(p.grade));
    const ids = [...new Set(list.map((p) => p.subject))];
    return ids.length ? ids : subjectChoices().map((s) => s.id);
  }

  function quizSubjectIds() {
    let list = state.exercises.filter(inScope);
    if (state.qFilters.grade.length) {
      list = list.filter((x) => x.grades.some((g) => state.qFilters.grade.includes(g)) || !x.grades.length);
    }
    const ids = [...new Set(list.map((x) => x.subject))];
    return ids.length ? ids : [...new Set(state.exercises.map((x) => x.subject))];
  }

  function openFilterSheet(kind, focusId) {
    let title = '';
    const hint = 'يمكنك اختيار أكثر من واحد بضغطات متتالية.';
    let values = [];
    let selected = [];
    let act = kind;
    let labelFn = (v) => v;
    if (kind === 'f-grade') {
      title = 'اختر الصفوف'; values = state.data.grades.map((g) => g.id);
      selected = state.filters.grade; labelFn = gradeName;
    } else if (kind === 'f-sub') {
      title = 'اختر المواد'; values = notebookSubjectIds();
      selected = state.filters.subject; labelFn = subjectName;
    } else if (kind === 'qf-grade') {
      title = 'اختر الصفوف'; values = state.data.grades.map((g) => g.id);
      selected = state.qFilters.grade; labelFn = gradeName;
    } else {
      title = 'اختر المواد'; values = quizSubjectIds();
      selected = state.qFilters.subject; labelFn = subjectName;
    }
    setOverlay(
      `<div class="sheet-modal" role="dialog" aria-modal="true" aria-labelledby="fs-title">
         <div class="panel filter-sheet">
           <h2 id="fs-title">${esc(title)}</h2>
           <p class="fine">${esc(hint)}</p>
           <div class="chips" role="group" aria-label="${esc(title)}">
             <button type="button" class="chip" data-act="${act}" data-id="" aria-pressed="${!selected.length}">الكل</button>
             ${values
               .map(
                 (v) =>
                   `<button type="button" class="chip" data-act="${act}" data-id="${esc(v)}" aria-pressed="${selected.includes(v)}">${esc(labelFn(v))}</button>`
               )
               .join('')}
           </div>
           <div class="actions">
             <button type="button" class="btn secondary" data-act="clear-filter" data-id="${act}">مسح</button>
             <button type="button" class="btn" data-act="close-overlay">تم</button>
           </div>
         </div>
       </div>`,
      focusId != null ? `[data-act="${act}"][data-id="${CSS.escape(focusId)}"]` : '.filter-sheet .btn'
    );
  }

  // تحديث حالات الشرائح داخل النافذة دون إعادة بنائها (حفاظًا على التركيز)
  function syncFilterChips(act, selectedArr) {
    document.querySelectorAll(`.filter-sheet [data-act="${act}"]`).forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.id === '' ? !selectedArr.length : selectedArr.includes(b.dataset.id)));
    });
  }

  // تبديل قيمة في فلتر متعدد؛ «الكل» (id فارغ) يمسح الاختيارات
  function toggleFilter(arr, id, act) {
    if (!id) arr.length = 0;
    else {
      const i = arr.indexOf(id);
      if (i >= 0) arr.splice(i, 1);
      else arr.push(id);
    }
    refreshAfterFilter(act, id);
  }

  // تحديث الحالة ثم إعادة رسم القائمة ومزامنة شرائح النافذة إن كانت مفتوحة
  function refreshAfterFilter(act) {
    renderView();
    if (document.querySelector('.filter-sheet')) {
      syncFilterChips(act, act.endsWith('-grade')
        ? (act === 'f-grade' ? state.filters.grade : state.qFilters.grade)
        : (act === 'f-sub' ? state.filters.subject : state.qFilters.subject));
    }
  }

  function mascotSVG() {
    return `
      <svg class="mascot" viewBox="0 0 120 120" aria-hidden="true">
        <rect x="46" y="18" width="28" height="70" rx="8" fill="var(--marker)" transform="rotate(8 60 60)"/>
        <polygon points="52,86 42,102 60,96" fill="#F8B9A0" transform="rotate(8 60 60)"/>
        <rect x="46" y="18" width="28" height="10" rx="4" fill="var(--primary)" transform="rotate(8 60 60)"/>
        <circle cx="56" cy="46" r="3" fill="var(--ink)"/>
        <circle cx="66" cy="44" r="3" fill="var(--ink)"/>
        <path d="M54 56 q6 6 14 2" stroke="var(--ink)" stroke-width="2.4" fill="none" stroke-linecap="round"/>
        <path d="M30 96 q30 10 62 -4" stroke="var(--accent-2)" stroke-width="3" fill="none" stroke-linecap="round" stroke-dasharray="1 8"/>
      </svg>`;
  }

  /* ---------- الصفحات ---------- */

  function viewNotebooks() {
    const f = state.filters;
    const items = productsInView();
    return `
      <h1 class="page-title">الملازم</h1>
      <p class="page-lead">اختر ما يناسبك، وأضفه إلى طلبك بضغطة واحدة.</p>
      ${segmentHTML('ملازمي', 'كل الملازم')}
      <div class="toolbar">
        ${searchInput('q-notebooks', 'ابحث باسم الملزمة أو المادة أو الصف', f.q)}
        <div class="filter-buttons">
          ${filterBtn('open-f-grade', !!f.grade.length, multiLabel(f.grade, gradeName, 'كل الصفوف', 'صفوف'))}
          ${filterBtn('open-f-sub', !!f.subject.length, multiLabel(f.subject, subjectName, 'كل المواد', 'مواد'))}
          ${sortSelect()}
        </div>
        ${resultCountHTML('res-notebooks', items.length, countWordAr(items.length))}
      </div>
      <div id="list">${productSections(items)}</div>`;
  }

  function countWordAr(n) {
    if (n === 1) return 'ملزمة';
    if (n === 2) return 'ملزمتين';
    if (n <= 10) return 'ملازم';
    return 'ملزمة';
  }

  function segmentHTML(mineLabel, allLabel) {
    return `
      <div class="segment" role="group" aria-label="نطاق العرض">
        <button type="button" data-act="scope" data-id="mine" aria-pressed="${state.scope === 'mine'}">${esc(mineLabel)}</button>
        <button type="button" data-act="scope" data-id="all" aria-pressed="${state.scope === 'all'}">${esc(allLabel)}</button>
      </div>`;
  }

  function renderList() {
    const el = $('#list');
    if (!el) return;
    const items = productsInView();
    const countEl = $('#res-notebooks');
    if (countEl) countEl.textContent = `${items.length} ${countWordAr(items.length)}`;
    if (!items.length) {
      el.innerHTML = `
        <div class="empty">
          ${mascotSVG()}
          <h2>لا توجد نتائج</h2>
          <p>جرّب كلمة أخرى أو امسح الفلاتر.</p>
          <div class="actions">
            <button type="button" class="btn small" data-act="f-clear">مسح الفلاتر</button>
            <a class="btn secondary small" href="#me">تغيير اهتماماتي</a>
          </div>
        </div>`;
      return;
    }
    el.innerHTML = productSections(items);
  }

  function viewExercises() {
    const f = state.qFilters;
    const list = quizzesInView();
    return `
      <h1 class="page-title">الاختبارات المجانية</h1>
      <p class="page-lead">اختبر نفسك، واعرف نتيجتك فور الإجابة 🎯</p>
      ${segmentHTML('اختباراتي', 'كل الاختبارات')}
      <div class="toolbar">
        ${searchInput('q-quizzes', 'ابحث باسم الاختبار أو المادة', f.q)}
        <div class="filter-buttons">
          ${filterBtn('open-qf-grade', !!f.grade.length, multiLabel(f.grade, gradeName, 'كل الصفوف', 'صفوف'))}
          ${filterBtn('open-qf-sub', !!f.subject.length, multiLabel(f.subject, subjectName, 'كل المواد', 'مواد'))}
        </div>
        <div class="filter-row">
          ${['', 'easy', 'medium', 'hard']
            .map(
              (d) =>
                `<button type="button" class="chip" data-act="qf-diff" data-id="${d}" aria-pressed="${f.difficulty === d}">${d ? esc(DIFFICULTY_LABEL[d]) : 'الكل'}</button>`
            )
            .join('')}
        </div>
        ${resultCountHTML('res-quizzes', list.length, countWordQuiz(list.length))}
      </div>
      <div id="ex-list">${quizGridHTML(list)}</div>`;
  }

  function countWordQuiz(n) {
    if (n === 1) return 'اختبار';
    if (n === 2) return 'اختبارين';
    if (n <= 10) return 'اختبارات';
    return 'اختبار';
  }

  function quizGridHTML(list) {
    if (!list.length) {
      return `
        <div class="empty">
          ${mascotSVG()}
          <h2>لا توجد اختبارات مطابقة</h2>
          <p>جرب كلمة أخرى أو امسح الفلاتر.</p>
          <div class="actions"><button type="button" class="btn small" data-act="qf-clear">مسح الفلاتر</button></div>
        </div>`;
    }
    return `<div class="product-grid quiz-grid">${list.map(quizCardHTML).join('')}</div>`;
  }

  function quizCardHTML(x) {
    const stat = state.quizStats[x.id];
    const best = stat ? `${stat.best}/${stat.total}` : '—';
    const diff = DIFFICULTY_LABEL[x.difficulty];
    const meta = [];
    if (x.questions.length) meta.push(`${x.questions.length} أسئلة`);
    if (x.duration) meta.push(`~${x.duration} دقيقة`);
    meta.push(diff);
    return `
      <article class="product-card quiz-card">
        <div class="card-top">
          <span class="subject-icon" aria-hidden="true">${esc(subjectIcon(x.subject))}</span>
          <span class="badge-free">مجاني</span>
        </div>
        <h3 class="card-name">${esc(x.title)}</h3>
        <p class="card-sub">${esc(x.description || subjectName(x.subject))}</p>
        <p class="quiz-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}</p>
        <div class="card-foot">
          <span class="best-chip" title="أفضل نتيجة سابقة">⭐ ${esc(best)}</span>
          <button type="button" class="share-btn" data-act="share-ex" data-id="${esc(x.id)}"
            aria-label="مشاركة رابط اختبار ${esc(x.title)}"
            title="انشر الرابط لزملائك">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11M8 7l4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>مشاركة</span>
          </button>
          <button type="button" class="add-btn" data-act="open-ex" data-id="${esc(x.id)}">${x.legacy ? 'افتح النسخة' : 'ابدأ الاختبار'}</button>
        </div>
      </article>`;
  }

  function renderExList() {
    const el = $('#ex-list');
    if (!el) return;
    const list = quizzesInView();
    const countEl = $('#res-quizzes');
    if (countEl) countEl.textContent = `${list.length} ${countWordQuiz(list.length)}`;
    el.innerHTML = quizGridHTML(list);
  }

  function cartRowHTML(p) {
    return `
      <div class="cart-row">
        <button type="button" class="remove-x" data-act="remove" data-id="${esc(p.id)}"
          aria-label="حذف ${esc(p.name)} من الطلب">×</button>
        <div class="row-text">
          <span class="row-name"><span>${esc(p.name)}</span></span>
          <span class="row-sub">${esc(gradeName(p.grade))}</span>
        </div>
        <span class="price">${p.price} <small>${esc(lib().currency)}</small></span>
      </div>`;
  }

  function viewCart() {
    const items = cartItems();
    if (!items.length) {
      return `
        <a class="back" href="#notebooks">رجوع إلى الملازم</a>
        <div class="empty">
          ${mascotSVG()}
          <h2>لم تختر ملازم بعد</h2>
          <p>اختر الملازم التي تريد طباعتها وسنجهزها لك.</p>
          <div class="actions"><a class="btn" href="#notebooks">تصفح الملازم</a></div>
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
               اضغط إرسال داخل المحادثة لإتمام الطلب.${t.delivery ? ' ولا تنس إرسال صورة التحويل.' : ''}
               <div class="mt"><button type="button" class="btn secondary small" data-act="clear-cart">بدء طلب جديد</button></div>
             </div>`
          : ''
      }

      <div class="sheet">${items.map(cartRowHTML).join('')}</div>

      <h2 class="section-title">بياناتك</h2>
      <label class="field">
        <span class="label">الاسم</span>
        <input class="input" id="f-name" autocomplete="name" value="${esc(name)}" placeholder="اسم ولي الأمر أو الطالب">
      </label>

      <h2 class="section-title">طريقة الاستلام</h2>
      <div class="options" role="radiogroup" aria-label="طريقة الاستلام">
        <label class="option">
          <input type="radio" name="mode" value="pickup" ${t.delivery ? '' : 'checked'}>
          <div><b>استلام من المكتبة</b><small>بدون رسوم</small></div>
        </label>
        <label class="option">
          <input type="radio" name="mode" value="delivery" ${t.delivery ? 'checked' : ''}>
          <div><b>توصيل إلى العنوان</b><small>يُضاف ${esc(money(Number(lib().deliveryFee) || 0))} على الطلب كله، ويُدفع المبلغ مقدمًا عبر انستاباي</small></div>
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

      <div class="summary">
        <div><span>الملازم (${items.length})</span><span>${esc(money(t.subtotal))}</span></div>
        ${t.delivery ? `<div><span>رسوم التوصيل</span><span>${esc(money(t.fee))}</span></div>` : ''}
        <div class="total"><span>الإجمالي</span><span>${esc(money(t.total))}</span></div>
      </div>

      <p class="error-text" id="cart-error" role="alert" hidden></p>
      <button type="button" class="btn marker block mt" data-act="send">إرسال الطلب عبر واتساب</button>
      <p class="send-note">سيفتح واتساب برسالة جاهزة، اضغط إرسال داخل المحادثة. الطلب يُحفظ تلقائيًا في «طلباتي».</p>
      <div class="center"><button type="button" class="link-btn" data-act="clear-cart">إفراغ الطلب</button></div>`;
  }

  /* ---------- حسابي ---------- */

  function statsHTML() {
    const orders = state.orders;
    const spent = orders.reduce((s, o) => s + (o.status === 'cancelled' ? 0 : o.total), 0);
    const quizDone = Object.keys(state.quizStats).length;
    return `
      <div class="stat-grid" aria-label="إحصائياتي">
        <div class="stat-card"><span class="stat-num">${orders.length}</span><span>طلبات أرسلتها</span></div>
        <div class="stat-card"><span class="stat-num">${spent}</span><span>إجمالي الطلبات (${esc(lib().currency)})</span></div>
        <div class="stat-card"><span class="stat-num">${quizDone}</span><span>اختبارات أكملتها</span></div>
        <div class="stat-card"><span class="stat-num">${toArr(state.profile.grades).length}</span><span>صفوف مسجّلة</span></div>
      </div>`;
  }

  function orderCardHTML(o) {
    const d = new Date(o.createdAt);
    const date = d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' });
    const mode = o.mode === 'delivery' ? 'توصيل' : 'من المكتبة';
    return `
      <article class="order-card">
        <div class="order-head">
          <span class="order-id">${esc(o.id)}</span>
          <span class="order-status">${o.status === 'sent' ? 'أُرسل عبر واتساب' : esc(o.status)}</span>
        </div>
        <div class="order-meta">
          <span>📅 ${esc(date)}</span>
          <span>🚚 ${esc(mode)}</span>
          <span>🧾 ${o.items.length} ملازم — ${esc(money(o.total))}</span>
        </div>
        <details class="order-details">
          <summary>تفاصيل الطلب</summary>
          <ul>
            ${o.items.map((it) => `<li>${esc(it.name)} — ${esc(gradeName(it.grade))} (${esc(money(it.price))})</li>`).join('')}
          </ul>
          ${o.address ? `<p class="fine">العنوان: ${esc(o.address)}</p>` : ''}
        </details>
        <div class="order-actions">
          <button type="button" class="btn small secondary" data-act="order-again" data-id="${esc(o.id)}">إعادة الطلب</button>
          <button type="button" class="btn small danger-ghost" data-act="del-order" data-id="${esc(o.id)}">حذف</button>
        </div>
      </article>`;
  }

  function ordersPanel() {
    if (!state.orders.length) {
      return `
        <div class="empty">
          ${mascotSVG()}
          <h2>لا توجد طلبات بعد</h2>
          <p>عند إرسال طلب عبر واتساب يظهر هنا تلقائيًا.</p>
          <div class="actions"><a class="btn small" href="#notebooks">تصفح الملازم</a></div>
        </div>`;
    }
    return `
      <div class="orders-head-row">
        <p class="fine">محفوظة على هذا الجهاز فقط، ولا تُرسل لأي سيرفر.</p>
        <button type="button" class="link-btn danger" data-act="clear-orders">مسح السجل</button>
      </div>
      <div class="orders-list">${state.orders.map(orderCardHTML).join('')}</div>`;
  }

  function resultsPanel() {
    const entries = Object.entries(state.quizStats)
      .map(([id, s]) => ({ id, ...s, ex: state.exMap.get(id) }))
      .filter((x) => x.ex)
      .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
    if (!entries.length) {
      return `
        <div class="empty">
          ${mascotSVG()}
          <h2>لم تكمل أي اختبار بعد</h2>
          <p>ابدأ أول اختبار وستظهر نتيجتك هنا.</p>
          <div class="actions"><a class="btn small" href="#exercises">تصفح الاختبارات</a></div>
        </div>`;
    }
    return `
      <div class="orders-list">
        ${entries
          .map(
            (r) => `
          <article class="order-card result-row">
            <div class="order-head"><span class="order-id">${esc(r.ex.title)}</span><span class="best-chip">⭐ ${r.best}/${r.total}</span></div>
            <p class="fine">المحاولات: ${r.attempts} — آخر محاولة: ${esc(new Date(r.lastAt).toLocaleDateString('ar-EG'))}</p>
            <div class="order-actions"><button type="button" class="btn small" data-act="open-ex" data-id="${esc(r.id)}">أعد المحاولة</button></div>
          </article>`
          )
          .join('')}
      </div>`;
  }

  function settingsPanel() {
    const pr = state.profile;
    const avail = availableSubjects(pr.grades);
    return `
      <div class="card">
        <h2>المظهر</h2>
        <p class="fine">اختر فاتح أو داكن أو اتبع إعدادات جهازك.</p>
        <div class="chips" role="group" aria-label="المظهر">
          ${[['light', 'فاتح'], ['dark', 'داكن'], ['system', 'النظام']]
            .map(([m, l]) => `<button type="button" class="chip" data-act="set-theme" data-id="${m}" aria-pressed="${state.theme === m}">${l}</button>`)
            .join('')}
        </div>
      </div>
      <div class="card">
        <h2>الصف الدراسي</h2>
        <p class="fine">يمكنك اختيار أكثر من صف.</p>
        ${gradeChips(pr.grades, 'm-grade')}
      </div>
      <div class="card">
        <h2>المواد التي تهمك</h2>
        ${subjectChips(pr.subjects, avail, 'm-subject')}
      </div>
      ${installCardHTML()}
      <div class="card">
        <h2>القائمة</h2>
        <p>تتحدث الملازم والاختبارات تلقائيًا عند تغيير القائمة في المكتبة.</p>
        <button type="button" class="btn secondary" data-act="refresh">تحديث القائمة الآن</button>
      </div>`;
  }

  function gradeChips(selected, act) {
    return `
      <div class="chips" role="group" aria-label="الصفوف الدراسية">
        ${state.data.grades
          .map(
            (g) =>
              `<button type="button" class="chip" data-act="${act}" data-id="${esc(g.id)}" aria-pressed="${selected.includes(g.id)}">${esc(g.name)}</button>`
          )
          .join('')}
      </div>`;
  }

  function subjectChips(selected, avail, act) {
    const items = [...avail, { id: '*', name: 'كل المواد' }];
    return `
      <div class="chips" role="group" aria-label="المواد">
        ${items
          .map(
            (s) =>
              `<button type="button" class="chip" data-act="${act}" data-id="${esc(s.id)}" aria-pressed="${s.id === '*' ? !selected.length : selected.includes(s.id)}">${esc(s.name)}</button>`
          )
          .join('')}
      </div>`;
  }

  function viewMe() {
    const pr = state.profile;
    const tabs = [['orders', 'طلباتي'], ['results', 'نتائجي'], ['settings', 'الإعدادات']];
    const panel = state.meTab === 'orders' ? ordersPanel() : state.meTab === 'results' ? resultsPanel() : settingsPanel();
    return `
      <h1 class="page-title">حسابي</h1>
      <p class="page-lead">أهلاً ${esc(pr.name || '')} في منطقتك الخاصة 👋</p>
      ${statsHTML()}
      <label class="field mt">
        <span class="label">الاسم</span>
        <input class="input" id="me-name" autocomplete="name" value="${esc(pr.name || '')}" placeholder="اسم ولي الأمر أو الطالب">
      </label>
      <div class="me-tabs" role="tablist" aria-label="أقسام حسابي">
        ${tabs
          .map(
            ([id, label]) =>
              `<button type="button" class="me-tab ${state.meTab === id ? 'is-active' : ''}" role="tab" aria-selected="${state.meTab === id}" data-act="me-tab" data-id="${id}">${label}</button>`
          )
          .join('')}
      </div>
      <div class="me-panel" role="tabpanel">${panel}</div>`;
  }

  function installCardHTML() {
    if (isStandalone()) return '';
    return `
      <div class="card">
        <h2>ثبّت التطبيق</h2>
        <p>أضف أبجد إلى شاشة موبايلك لتفتحه بضغطة واحدة.</p>
        <button type="button" class="btn" data-act="open-install">${state.installEvent ? 'تثبيت التطبيق' : 'طريقة التثبيت'}</button>
      </div>`;
  }

  const VIEWS = { notebooks: viewNotebooks, exercises: viewExercises, me: viewMe, cart: viewCart };

  /* ---------- العرض والتنقل ---------- */

  function route() {
    const h = location.hash.replace('#', '');
    if (h.startsWith('quiz/')) return 'exercises'; // رابط مشاركة اختبار يفتح صفحة الاختبارات ثم الاختبار نفسه
    return VIEWS[h] ? h : 'notebooks';
  }

  // فتح اختبار من رابط مشاركة صادر من جروب أو واتساب
  function handleQuizDeepLink() {
    const m = location.hash.match(/^#quiz\/(.+)$/);
    if (!m) return;
    const ex = state.exMap.get(decodeURIComponent(m[1]));
    location.hash = '#exercises';
    if (!ex) {
      toast('لم يتم العثور على الاختبار، قد يكون الاسم أو الرابط قديمًا');
      return;
    }
    if (ex.legacy) return openLegacyExercise(ex);
    state.lastFocus = null;
    window.AbjadQuiz.start(ex, {
      bestScore: (state.quizStats[ex.id] || {}).best,
      onResult: saveQuizResult,
      onClose: () => closeOverlay(),
    });
  }

  function whoLabel() {
    const g = state.profile.grades;
    if (g.length === 1) return gradeName(g[0]);
    if (g.length === 2) return 'صفّان دراسيان';
    return `${g.length} صفوف دراسية`;
  }

  function renderView(focusSel) {
    if (!state.profile) return;
    state.view = route();
    applyTheme(state.theme);
    $('#view').innerHTML = VIEWS[state.view]();

    document.querySelectorAll('.tabs a, .topnav a').forEach((a) => {
      const active = a.dataset.tab === (state.view === 'cart' ? 'notebooks' : state.view);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    const who = $('#who');
    who.textContent = whoLabel();
    who.setAttribute('aria-label', `تغيير الصف والمواد. الاختيار الحالي: ${whoLabel()}`);

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

  /* ---------- شاشة الترحيب ---------- */

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
        <h1 id="onb-title">اختر الصف الدراسي</h1>
        <p class="lead">يمكنك اختيار أكثر من صف إذا كان لديك أكثر من طالب.</p>
        ${gradeChips(o.grades, 'o-grade')}
        <div class="step-actions single">
          <button type="button" class="btn block" id="onb-next" data-act="o-next" ${o.grades.length ? '' : 'disabled'}>التالي</button>
        </div>`;
    } else if (o.step === 2) {
      card = `
        <p class="step-count">الخطوة 2 من 3</p>
        <h1 id="onb-title">ما المواد التي تهمك؟</h1>
        <p class="lead">سنعرض لك ملازم هذه المواد فقط. يمكنك تغييرها لاحقًا من «حسابي».</p>
        ${subjectChips(o.subjects, availableSubjects(o.grades), 'o-subject')}
        <div class="step-actions">
          <button type="button" class="btn secondary" data-act="o-back">رجوع</button>
          <button type="button" class="btn" data-act="o-next">التالي</button>
        </div>`;
    } else {
      card = `
        <p class="step-count">الخطوة 3 من 3</p>
        <h1 id="onb-title">ما اسمك؟</h1>
        <p class="lead">نكتبه في رسالة الطلب حتى نعرف صاحب الطلب. يمكنك تركه فارغًا الآن.</p>
        <input class="input" id="onb-name" autocomplete="name" placeholder="اسم ولي الأمر أو الطالب" value="${esc(o.name)}">
        <div class="step-actions">
          <button type="button" class="btn secondary" data-act="o-back">رجوع</button>
          <button type="button" class="btn marker" data-act="o-finish">ابدأ</button>
        </div>`;
    }

    setOverlay(
      `<div class="welcome" role="dialog" aria-modal="true" aria-labelledby="onb-title">
         <div class="welcome-inner">
           <div class="wordmark${o.shown ? ' still' : ''}" aria-label="${esc(lib().name)}"><span>${esc(lib().name)}</span></div>
           <p class="tagline">${esc(lib().tagline || 'اختر ملازمك ونحن نطبعها لك')}</p>
           <section class="step-card">${card}</section>
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
    state.scope = 'mine';
    state.filters = { q: '', grade: '', subject: '', sort: 'default' };
    setOverlay('');
    $('#app').hidden = false;
    history.replaceState(null, '', '#notebooks');
    renderView();
    window.scrollTo(0, 0);
    setTimeout(openInstallSheet, 400);
  }

  /* ---------- تثبيت التطبيق ---------- */

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installEvent = e;
    if (state.view === 'me') renderView();
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
      action = '<button type="button" class="btn marker" data-act="install">تثبيت التطبيق</button>';
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
         <div class="panel install-panel">
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

  /* ---------- الاختبارات القديمة (iframe) ---------- */

  function openLegacyExercise(ex) {
    state.lastFocus = document.activeElement;
    setOverlay(
      `<div class="viewer" role="dialog" aria-modal="true" aria-label="${esc(ex.title)}">
         <div class="viewer-bar">
           <h2>${esc(ex.title)}</h2>
           <a href="${esc(ex.file)}" target="_blank" rel="noopener">فتح في صفحة مستقلة</a>
           <button type="button" class="close" data-act="close-overlay">إغلاق</button>
         </div>
         <iframe src="${esc(ex.file)}" title="${esc(ex.title)}"></iframe>
       </div>`,
      '.viewer .close'
    );
  }

  /* ---------- حفظ الطلبات ---------- */

  function todayStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  }

  function nextOrderId() {
    const prefix = `ABG-${todayStamp()}-`;
    const used = state.orders.filter((o) => o.id.startsWith(prefix));
    return `${prefix}${String(used.length + 1).padStart(4, '0')}`;
  }

  function saveOrder(items, message) {
    const t = totals(items);
    state.orders.unshift({
      id: nextOrderId(),
      createdAt: new Date().toISOString(),
      name: (state.profile && state.profile.name) || '',
      mode: t.delivery ? 'delivery' : 'pickup',
      address: t.delivery ? String(state.checkout.address || '').trim() : '',
      items: items.map((p) => ({ id: p.id, name: p.name, grade: p.grade, subject: p.subject, price: p.price })),
      subtotal: t.subtotal,
      fee: t.fee,
      total: t.total,
      status: 'sent',
      message,
    });
    if (state.orders.length > 50) state.orders.length = 50; // نحتفظ بآخر 50 طلبًا
    write(KEYS.orders, state.orders);
  }

  /* ---------- حفظ نتائج الاختبارات ---------- */

  function saveQuizResult(r) {
    const cur = state.quizStats[r.quizId] || { best: 0, total: r.total, attempts: 0, lastAt: '' };
    cur.best = Math.max(cur.best, r.score);
    cur.total = r.total;
    cur.attempts += 1;
    cur.lastAt = new Date().toISOString();
    state.quizStats[r.quizId] = cur;
    write(KEYS.quiz, state.quizStats);
    toast(`سجّلت ${r.score} من ${r.total} 🎯`);
  }

  /* ---------- إرسال الطلب عبر واتساب ---------- */

  function waNumber() {
    let n = String(lib().whatsapp || '').replace(/\D/g, '');
    if (n.startsWith('00')) n = n.slice(2);
    if (n.startsWith('0')) n = '2' + n; // 01012345678 -> 201012345678
    return n;
  }

  function buildMessage(items) {
    const t = totals(items);
    const name = (state.profile && state.profile.name) || '';
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

    const message = buildMessage(items);
    saveOrder(items, message); // حفظ محلي قبل فتح واتساب
    const url = `https://wa.me/${waNumber()}?text=${encodeURIComponent(message)}`;
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();

    state.sent = true;
    state.paid = false;
    renderView();
    window.scrollTo(0, 0);
    toast('تم إرسال الطلب وحفظه في «طلباتي»');
  }

  /* ---------- إشعار صغير ونسخ ---------- */

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
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

  const actions = {
    // الثيم
    'toggle-theme': toggleThemeAction,
    'set-theme'(el) {
      applyTheme(el.dataset.id);
      write(KEYS.theme, state.theme);
      // تحديث حالات الضغط في علبة الإعدادات
      document.querySelectorAll('[data-act="set-theme"]').forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.id === state.theme))
      );
    },

    // نطاق العرض
    scope(el) {
      state.scope = el.dataset.id;
      renderView();
    },

    // فتح نوافذ الفلترة
    'open-f-grade'() { state.lastFocus = document.activeElement; openFilterSheet('f-grade'); },
    'open-f-sub'() { state.lastFocus = document.activeElement; openFilterSheet('f-sub'); },
    'open-qf-grade'() { state.lastFocus = document.activeElement; openFilterSheet('qf-grade'); },
    'open-qf-sub'() { state.lastFocus = document.activeElement; openFilterSheet('qf-sub'); },

    // مشاركة رابط اختبار (للنشر في الجروبات)
    async 'share-ex'(el) {
      const ex = state.exMap.get(el.dataset.id);
      if (!ex) return;
      const url = `${location.origin}${location.pathname}#quiz/${encodeURIComponent(ex.id)}`;
      const data = {
        title: `${ex.title} — اختبار مجاني من مكتبة ${lib().name}`,
        text: `جرّب اختبار «${ex.title}» المجاني من مكتبة أبجد 🎯`,
        url,
      };
      if (navigator.share) {
        try { await navigator.share(data); return; } catch (_) { /* المستخدم لغى المشاركة */ }
      }
      const ok = await copyText(url);
      toast(ok ? 'تم نسخ رابط الاختبار، الصقه في أي جروب 📢' : 'تعذر النسخ، انسخ العنوان من شريط المتصفح');
    },

    // فلاتر الملازم (اختيار متعدد من نافذة عائمة)
    'f-grade'(el) {
      toggleFilter(state.filters.grade, el.dataset.id, 'f-grade');
    },
    'f-sub'(el) {
      toggleFilter(state.filters.subject, el.dataset.id, 'f-sub');
    },
    'f-clear'() {
      state.filters = { q: '', grade: [], subject: [], sort: 'default' };
      renderView();
      const box = $('#q-notebooks');
      if (box) box.focus({ preventScroll: true });
      toast('تم مسح الفلاتر');
    },

    // فلاتر الاختبارات
    'qf-grade'(el) {
      toggleFilter(state.qFilters.grade, el.dataset.id, 'qf-grade');
    },
    'qf-sub'(el) {
      toggleFilter(state.qFilters.subject, el.dataset.id, 'qf-sub');
    },
    'qf-diff'(el) {
      state.qFilters.difficulty = el.dataset.id;
      renderView();
    },
    'qf-clear'() {
      state.qFilters = { q: '', grade: [], subject: [], difficulty: '' };
      renderView();
      const box = $('#q-quizzes');
      if (box) box.focus({ preventScroll: true });
    },
    // زر «مسح» داخل نافذة الفلترة
    'clear-filter'(el) {
      const act = el.dataset.id;
      if (act === 'f-grade') state.filters.grade = [];
      else if (act === 'f-sub') state.filters.subject = [];
      else if (act === 'qf-grade') state.qFilters.grade = [];
      else if (act === 'qf-sub') state.qFilters.subject = [];
      refreshAfterFilter(act, '');
    },

    // البطاقات
    'toggle-product'(el) {
      const id = el.dataset.id;
      const on = !state.cart.has(id);
      toggleCart(id, on);
      syncProductCard(id);
      toast(on ? 'أُضيف إلى طلبك 🛒' : 'أُزيل من طلبك');
    },

    // خطوات الشاشة الأولى
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
      $('#onb-title').setAttribute('tabindex', '-1');
      $('#onb-title').focus({ preventScroll: true });
    },
    'o-back'() {
      state.onb.step -= 1;
      renderOnboarding();
      $('#onb-title').setAttribute('tabindex', '-1');
      $('#onb-title').focus({ preventScroll: true });
    },
    'o-finish': finishOnboarding,

    // حسابي
    'me-tab'(el) {
      state.meTab = el.dataset.id;
      renderView(`.me-tab[data-id="${CSS.escape(state.meTab)}"]`);
    },
    'm-grade'(el) {
      const pr = state.profile;
      const id = el.dataset.id;
      if (pr.grades.includes(id) && pr.grades.length === 1) return toast('اختر صفًا واحدًا على الأقل');
      toggleIn(pr.grades, id);
      const avail = new Set(availableSubjects(pr.grades).map((s) => s.id));
      pr.subjects = pr.subjects.filter((s) => avail.has(s));
      write(KEYS.profile, pr);
      renderView(`[data-act="m-grade"][data-id="${CSS.escape(id)}"]`);
    },
    'm-subject'(el) {
      const pr = state.profile;
      if (el.dataset.id === '*') pr.subjects = [];
      else toggleIn(pr.subjects, el.dataset.id);
      write(KEYS.profile, pr);
      renderView(`[data-act="m-subject"][data-id="${CSS.escape(el.dataset.id)}"]`);
    },
    refresh: async () => {
      const r = await loadData();
      if (r.changed) renderView();
      toast(r.ok ? 'القائمة محدّثة' : 'تعذر التحديث. تحقق من الاتصال بالإنترنت');
    },

    // الطلبات
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

    // سجل الطلبات
    'del-order'(el) {
      const o = state.orders.find((x) => x.id === el.dataset.id);
      if (!o) return;
      if (!window.confirm(`حذف الطلب ${o.id}؟`)) return;
      state.orders = state.orders.filter((x) => x.id !== o.id);
      write(KEYS.orders, state.orders);
      renderView();
      toast('تم حذف الطلب من السجل');
    },
    'clear-orders'() {
      if (!state.orders.length) return;
      if (!window.confirm('مسح كل سجل الطلبات من هذا الجهاز؟ لا يمكن التراجع.')) return;
      state.orders = [];
      write(KEYS.orders, state.orders);
      renderView();
      toast('تم مسح سجل الطلبات');
    },
    'order-again'(el) {
      const o = state.orders.find((x) => x.id === el.dataset.id);
      if (!o) return;
      let added = 0;
      o.items.forEach((it) => {
        if (state.productMap.has(it.id) && !state.cart.has(it.id)) {
          state.cart.add(it.id);
          added += 1;
        }
      });
      if (!added) return toast('كل ملازم هذا الطلب غير متاحة الآن');
      write(KEYS.cart, [...state.cart]);
      renderCartBar();
      toast(`أضافنا ${added} ملزمة إلى طلبك الجديد 🛒`);
    },

    // الاختبارات
    'open-ex'(el) {
      const ex = state.exMap.get(el.dataset.id);
      if (!ex) return;
      if (ex.legacy) return openLegacyExercise(ex);
      state.lastFocus = document.activeElement;
      window.AbjadQuiz.start(ex, {
        bestScore: (state.quizStats[ex.id] || {}).best,
        onResult: saveQuizResult,
        onClose: () => {
          if (state.lastFocus && document.contains(state.lastFocus)) state.lastFocus.focus({ preventScroll: true });
          state.lastFocus = null;
        },
      });
    },

    // التثبيت
    'open-install'() {
      if (state.installEvent) runInstall();
      else openInstallSheet();
    },
    install: runInstall,
    'close-overlay': closeOverlay,
    retry() { boot(); },
  };

  document.addEventListener('click', (ev) => {
    // النقر على خلفية النافذة العائمة يغلقها
    if (ev.target instanceof Element && ev.target.classList.contains('sheet-modal')) {
      closeOverlay();
      return;
    }
    const el = ev.target.closest('[data-act]');
    if (!el || !document.contains(el)) return;
    const fn = actions[el.dataset.act];
    if (fn) fn(el, ev);
  });

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.matches('input[name="mode"]')) {
      state.checkout.mode = t.value;
      write(KEYS.checkout, { mode: state.checkout.mode, address: state.checkout.address });
      state.paid = false;
      renderView(`input[name="mode"][value="${t.value}"]`);
    } else if (t.id === 'f-paid') {
      state.paid = t.checked;
      $('#cart-error').hidden = true;
    } else if (t.id === 'f-sort') {
      state.filters.sort = t.value;
      renderList();
    }
  });

  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'q-notebooks') {
      state.filters.q = t.value;
      renderList(); // فوري: يحافظ على تركيز الحقل لأننا لا نعيد رسم الشريط
      return;
    }
    if (t.id === 'q-quizzes') {
      state.qFilters.q = t.value;
      renderExList();
      return;
    }
    if (t.id === 'f-name' || t.id === 'me-name' || t.id === 'onb-name') {
      const v = t.value;
      if (t.id === 'onb-name') state.onb.name = v;
      else if (state.profile) {
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
    if (ev.key === 'Escape' && $('#overlay .viewer, #overlay .install-panel, #overlay .filter-sheet')) closeOverlay();
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
    const typing = a && $('#view').contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName);
    if (state.profile) {
      if (!typing && !document.querySelector('.quiz-overlay')) renderView();
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
    applyTheme(state.theme);
    setOverlay('<div class="welcome"><div class="welcome-inner"><p class="tagline">جارٍ التحميل…</p></div></div>');
    const r = await loadData();
    if (!r.ok) {
      setOverlay(`
        <div class="welcome"><div class="welcome-inner">
          <div class="step-card">
            <h1>تعذر تحميل القائمة</h1>
            <p class="lead">تأكد من اتصالك بالإنترنت ثم حاول مرة أخرى.</p>
            <div class="step-actions single"><button type="button" class="btn block" data-act="retry">إعادة المحاولة</button></div>
          </div>
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
    handleQuizDeepLink(); // رابط اختبار مشارَك (#quiz/<id>)
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* يعمل الموقع بدونه */ });
    });
  }

  boot();
})();
