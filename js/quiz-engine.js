/* ==========================================================
   أبجد — محرك الاختبارات التفاعلية
   يفتح الاختبار في طبقة كاملة داخل التطبيق، دون iframe.
   الاستخدام: AbjadQuiz.start(quiz, { onResult, onClose })
   ========================================================== */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);

  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let overlay = null;
  let opts = null;
  let quiz = null;
  let idx = 0;
  let correct = 0;
  let answered = 0;
  let timer = null;
  let secondsLeft = 0;

  /* ---------- رسائل النتيجة ---------- */

  function resultMessage(pct) {
    if (pct === 100) return 'ممتاز! نتيجة كاملة 🏆';
    if (pct >= 80) return 'رائع جدًا! 🌟';
    if (pct >= 60) return 'جيد! كرر المحاولة لنتيجة أعلى 💪';
    if (pct >= 40) return 'بداية طيبة، راجع الأسئلة ثم أعد المحاولة 🙂';
    return 'لا بأس، راجع المادة وأعد المحاولة 📚';
  }

  /* ---------- قصاصات ورقية ---------- */

  function confetti() {
    if (reduced()) return;
    const colors = ['#12B886', '#2F6BFF', '#FF7A6B', '#2AD4A8', '#63E6BE'];
    const box = h('<div class="confetti" aria-hidden="true"></div>');
    for (let i = 0; i < 28; i += 1) {
      const p = h('<span></span>');
      p.style.setProperty('--ci', colors[i % colors.length]);
      p.style.left = `${5 + Math.random() * 90}%`;
      p.style.animationDelay = `${Math.random() * 0.6}s`;
      p.style.animationDuration = `${2.2 + Math.random() * 1.4}s`;
      p.style.transform = `rotate(${Math.random() * 260}deg)`;
      box.appendChild(p);
    }
    overlay.appendChild(box);
    setTimeout(() => box.remove(), 4200);
  }

  /* ---------- المؤقت ---------- */

  function startTimer() {
    if (!quiz.duration && quiz.duration !== 0) return;
    clearTimeout(timer);
    secondsLeft = Number(quiz.duration) * 60 || 0;
    if (!secondsLeft) return;
    const el = () => $('.quiz-timer', overlay);
    const tick = () => {
      const m = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
      const s = String(secondsLeft % 60).padStart(2, '0');
      const t = el();
      if (t) t.textContent = `${m}:${s}`;
      secondsLeft -= 1;
      if (secondsLeft < 0) {
        clearTimeout(timer);
        showResult(true);
        return;
      }
      timer = setTimeout(tick, 1000);
    };
    tick();
  }

  /* ---------- شاشة السؤال ---------- */

  function renderQuestion() {
    const q = quiz.questions[idx];
    const total = quiz.questions.length;
    const pct = Math.round((idx / total) * 100);
    const last = idx === total - 1;

    $('.quiz-body', overlay).innerHTML = `
      <div class="quiz-progressbar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="التقدم في الاختبار">
        <span style="width:${pct}%"></span>
      </div>
      <p class="quiz-count">السؤال ${idx + 1} من ${total}</p>
      <h2 class="quiz-text" id="q-title" tabindex="-1">${esc(q.q)}</h2>
      <div class="quiz-opts" role="group" aria-labelledby="q-title">
        ${q.options
          .map(
            (o, i) =>
              `<button type="button" class="quiz-opt" data-opt="${i}"><span class="opt-dot" aria-hidden="true"></span><span>${esc(o)}</span></button>`
          )
          .join('')}
      </div>
      <p class="quiz-fb" id="q-fb" role="status" aria-live="polite"></p>
      <div class="quiz-actions">
        <button type="button" class="btn block quiz-next" id="quiz-next" hidden>${last ? 'عرض النتيجة' : 'السؤال التالي'}</button>
      </div>`;

    $('#q-title').focus({ preventScroll: true });
    if (idx === 0) startTimer(); // نبدأ المؤقت عند أول سؤال فقط
  }

  function choose(btn) {
    const q = quiz.questions[idx];
    const picked = Number(btn.dataset.opt);
    answered += 1;
    q._picked = picked; // نحفظ اختيار المستخدم لمراجعة النتيجة لاحقًا
    clearTimeout(timer);

    const optsEl = [...overlay.querySelectorAll('.quiz-opt')];
    optsEl.forEach((b) => {
      b.disabled = true;
      if (Number(b.dataset.opt) === q.a) b.classList.add('right');
    });
    if (picked === q.a) {
      btn.classList.add('right');
      correct += 1;
    } else {
      btn.classList.add('wrong');
    }

    const fb = $('#q-fb', overlay);
    if (q.explanation) {
      fb.textContent = (picked === q.a ? 'إجابة صحيحة! ' : `الإجابة الصحيحة: ${q.options[q.a]}. `) + q.explanation;
    } else {
      fb.textContent = picked === q.a ? 'إجابة صحيحة!' : `الإجابة الصحيحة: ${q.options[q.a]}`;
    }
    btn.setAttribute('aria-current', 'true');

    const next = $('#quiz-next', overlay);
    next.hidden = false;
    next.focus({ preventScroll: true });
  }

  /* ---------- شاشة النتيجة ---------- */

  function showResult(timeUp) {
    clearTimeout(timer);
    const total = quiz.questions.length;
    const pct = Math.round((correct / total) * 100);
    const me = opts && opts.bestScore != null && opts.bestScore >= pct;

    $('.quiz-body', overlay).innerHTML = `
      <div class="quiz-result ${pct >= 80 ? 'great' : ''}" role="status">
        <p class="result-emoji" aria-hidden="true">${pct >= 80 ? '🎉' : timeUp ? '⏰' : '💪'}</p>
        <p class="result-pct">${pct}%</p>
        <p class="result-score">أجبت ${correct} من ${total} إجابات صحيحة${timeUp ? ' (انتهى الوقت)' : ''}</p>
        <p class="result-msg">${me ? 'حافظت على أفضل نتيجة! ' : ''}${resultMessage(pct)}</p>
      </div>
      <section class="quiz-review">
        <h3>مراجعة الإجابات</h3>
        <ul>
          ${quiz.questions
            .map((q, i) => {
              const wrong = quiz.questions[i]._picked !== undefined && quiz.questions[i]._picked !== q.a;
              return `
                <li class="${wrong ? 'rev-wrong' : 'rev-ok'}">
                  <p>${i + 1}. ${esc(q.q)}</p>
                  <p class="rev-a">الإجابة الصحيحة: ${esc(q.options[q.a])}${q.explanation ? ` — ${esc(q.explanation)}` : ''}</p>
                </li>`;
            })
            .join('')}
        </ul>
      </section>
      <div class="quiz-actions">
        <button type="button" class="btn block" id="quiz-retry">أعد المحاولة</button>
        <button type="button" class="btn secondary block" id="quiz-done">إغلاق الاختبار</button>
      </div>`;

    $('#quiz-retry').addEventListener('click', () => { quiz.questions.forEach((q) => delete q._picked); idx = 0; correct = 0; answered = 0; renderQuestion(); });
    $('#quiz-done').addEventListener('click', close);
    if (pct >= 80) confetti();

    if (opts && opts.onResult) {
      opts.onResult({ quizId: quiz.id, score: correct, total, pct });
    }
  }

  /* ---------- فتح وإغلاق ---------- */

  function close() {
    clearTimeout(timer);
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    if (opts && opts.onClose) opts.onClose();
    opts = null;
    quiz = null;
  }

  function onKey(ev) {
    if (ev.key !== 'Escape' || !overlay) return;
    ev.preventDefault();
    if (answered && answered < quiz.questions.length) {
      if (window.confirm('هل تريد إغلاق الاختبار؟ ستفقد تقدمك في هذه المحاولة.')) close();
    } else {
      close();
    }
  }

  function start(qz, options = {}) {
    if (!qz || !Array.isArray(qz.questions) || !qz.questions.length) return;
    quiz = Object.assign({}, qz, {
      questions: qz.questions.map((x) => Object.assign({}, x)),
    });
    quiz.duration = Number(quiz.duration) || 0;
    opts = options;
    idx = 0;
    correct = 0;
    answered = 0;

    if (overlay) overlay.remove();
    overlay = h(`
      <div class="quiz-overlay" role="dialog" aria-modal="true" aria-label="${esc(quiz.title)}">
        <div class="quiz-topbar">
          <h2>${esc(quiz.title)}</h2>
          <span class="quiz-timer" aria-live="off"></span>
          <button type="button" class="quiz-close" data-quiz-close aria-label="إغلاق الاختبار">إغلاق</button>
        </div>
        <div class="quiz-body"></div>
      </div>`);
    overlay.addEventListener('click', (ev) => {
      const t = ev.target;
      const opt = t.closest('.quiz-opt');
      if (opt && !opt.disabled) return choose(opt);
      const next = t.closest('#quiz-next');
      if (next) {
        idx += 1;
        if (idx >= quiz.questions.length) showResult(false);
        else renderQuestion();
        return;
      }
      if (t.closest('[data-quiz-close]')) onKey({ key: 'Escape', preventDefault: () => {} });
    });
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    renderQuestion();
  }

  window.AbjadQuiz = { start };
})();
