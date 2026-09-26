fetch('../../resources/intro-and-linkings-data.json')
  .then(r => r.json())
  .then(DATA => {

const BATCHES = (DATA.batches || []).map((b, idx) => ({
  ...b,
  batchIdNum: Number.parseInt(b.batchId, 10),
  _idx: idx,
  words: b.words || []
}));

const WORDS = BATCHES.flatMap(b =>
  b.words.map(w => ({ ...w, batchId: Number.isNaN(b.batchIdNum) ? b._idx : b.batchIdNum, batchRef: b }))
);

const PROG_KEY = 'gr_intro_linkings_progress';
const LANGUAGE_LEVEL_KEY = 'gr_language_level';
const LANGUAGE_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const LEVEL_RANK = { A1: 0, A2: 1, B1: 2, B2: 3, C1: 4 };
const quizStreaks = {};
let learnQueue = [];
let learnIdx = 0;
let learnFlipped = false;
let learnStats = { known: 0, maybe: 0, unknown: 0 };
let quizPool = [];
let quizCurrent = null;
let quizAnswered = false;
let quizCorrectCount = 0;
let quizTotalCount = 0;
let currentLanguageLevel = 'C1';

function normalizeLanguageLevel(level) {
  const normalized = String(level || '').toUpperCase().trim();
  return LANGUAGE_LEVELS.includes(normalized) ? normalized : null;
}

function loadLanguageLevel() {
  const stored = normalizeLanguageLevel(localStorage.getItem(LANGUAGE_LEVEL_KEY));
  return stored || 'C1';
}

function saveLanguageLevel(level) {
  localStorage.setItem(LANGUAGE_LEVEL_KEY, level);
}

function isVisibleByLanguageLevel(wordLevel) {
  const normalizedWordLevel = normalizeLanguageLevel(wordLevel);
  const normalizedSelectedLevel = normalizeLanguageLevel(currentLanguageLevel) || 'C1';
  if (!normalizedWordLevel) return true;
  return LEVEL_RANK[normalizedWordLevel] <= LEVEL_RANK[normalizedSelectedLevel];
}

function getVisibleWords() {
  return WORDS.filter(w => isVisibleByLanguageLevel(w.languageLevel));
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(PROG_KEY) || '{}'); } catch { return {}; }
}
function saveProgress(p) { localStorage.setItem(PROG_KEY, JSON.stringify(p)); }

function getCategory(p) {
  if (!p || !p.seen) return 0;
  if (p.interval >= 7) return 2;
  return 1;
}

function updateSR(progress, idx, rating) {
  const today = Date.now();
  let p = progress[idx] || { interval: 1, ef: 2.5, nextReview: today, seen: false };
  p.seen = true;

  if (rating === 0) {
    p.interval = 1;
    p.ef = Math.max(1.3, p.ef - 0.2);
  } else if (rating === 3) {
    p.interval = Math.max(1, Math.round(p.interval * 1.2));
    p.ef = Math.max(1.3, p.ef - 0.14);
  } else {
    p.interval = Math.max(7, Math.round(p.interval * p.ef));
    p.ef = Math.min(3.0, p.ef + 0.1);
  }

  p.nextReview = today + p.interval * 86400000;
  progress[idx] = p;
  return progress;
}

function updateQuizSR(idx, isCorrect) {
  const progress = loadProgress();
  const now = Date.now();
  let p = progress[idx] || { interval: 1, ef: 2.5, nextReview: now, seen: false };
  const cat = getCategory(p);

  if (!isCorrect) {
    quizStreaks[idx] = 0;
    if (cat === 2) {
      p.interval = 3;
      p.ef = Math.max(1.3, p.ef - 0.2);
    } else if (cat === 1) {
      p.interval = 1;
      p.seen = false;
      p.ef = Math.max(1.3, p.ef - 0.2);
    }
  } else {
    quizStreaks[idx] = (quizStreaks[idx] || 0) + 1;
    if (quizStreaks[idx] >= 2) {
      quizStreaks[idx] = 0;
      if (cat === 0) {
        p.seen = true;
        p.interval = 3;
      } else if (cat === 1) {
        p.interval = 7;
        p.ef = Math.min(3.0, p.ef + 0.1);
      }
    }
  }

  p.nextReview = now + p.interval * 86400000;
  progress[idx] = p;
  saveProgress(progress);
}

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');

  const pages = ['plan', 'learn', 'quiz', 'progress'];
  const btns = document.querySelectorAll('nav button');
  btns[pages.indexOf(name)].classList.add('active');

  if (name === 'progress') updateProgressPage();
}

function resetFlipCardToFront(cardId) {
  const card = document.getElementById(cardId);
  if (!card) return;
  card.classList.add('no-transition');
  card.classList.remove('flipped');
  void card.offsetWidth;
  requestAnimationFrame(() => card.classList.remove('no-transition'));
}

function renderBatchOptions() {
  const learnSelect = document.getElementById('batch-select');
  const quizSelect = document.getElementById('quiz-batch');

  const currentLearnValue = learnSelect.value;
  const currentQuizValue = quizSelect.value;

  Array.from(learnSelect.querySelectorAll('option')).forEach(opt => {
    if (opt.value !== '-1' && opt.value !== '-2') opt.remove();
  });
  Array.from(quizSelect.querySelectorAll('option')).forEach(opt => {
    if (opt.value !== '-2') opt.remove();
  });

  const visibleWords = getVisibleWords();

  BATCHES.forEach(batch => {
    const value = Number.isNaN(batch.batchIdNum) ? batch._idx : batch.batchIdNum;
    const visibleCount = visibleWords.filter(w => w.batchId === value).length;
    if (visibleCount === 0) return;

    const optLearn = document.createElement('option');
    optLearn.value = value;
    optLearn.textContent = (batch.batchHeader || ('Блок ' + (batch._idx + 1))) + ' (' + visibleCount + ')';
    learnSelect.appendChild(optLearn);

    const optQuiz = document.createElement('option');
    optQuiz.value = value;
    optQuiz.textContent = (batch.batchHeader || ('Блок ' + (batch._idx + 1))) + ' (' + visibleCount + ')';
    quizSelect.appendChild(optQuiz);
  });

  if (!Array.from(learnSelect.options).some(o => o.value === currentLearnValue)) {
    learnSelect.value = '-1';
  } else {
    learnSelect.value = currentLearnValue;
  }

  if (!Array.from(quizSelect.options).some(o => o.value === currentQuizValue)) {
    quizSelect.value = '-2';
  } else {
    quizSelect.value = currentQuizValue;
  }
}

function resetQuizUiState() {
  quizPool = [];
  quizCurrent = null;
  quizAnswered = false;
  quizCorrectCount = 0;
  quizTotalCount = 0;
  document.getElementById('quiz-correct').textContent = '0';
  document.getElementById('quiz-total').textContent = '0';
  document.getElementById('quiz-q-text').textContent = 'Нажмите «Начать тест»';
  document.getElementById('quiz-q-sub').textContent = 'Выборка будет собрана по выбранному уровню языка.';
  document.getElementById('quiz-options').innerHTML = '';
  document.getElementById('next-btn-wrap').style.display = 'none';
  document.getElementById('quiz-giveup-wrap').style.display = 'none';
}

function onLanguageLevelChange(level) {
  currentLanguageLevel = normalizeLanguageLevel(level) || 'C1';
  saveLanguageLevel(currentLanguageLevel);

  const select = document.getElementById('lang-level-select');
  if (select) select.value = currentLanguageLevel;

  renderPlanTable();
  renderBatchOptions();

  const activePageId = document.querySelector('.page.active')?.id;
  if (activePageId === 'page-learn') {
    resetLearn();
  } else if (activePageId === 'page-progress') {
    updateProgressPage();
  } else if (activePageId === 'page-quiz') {
    resetQuizUiState();
  }
}

function initLanguageLevelControl() {
  currentLanguageLevel = loadLanguageLevel();
  const select = document.getElementById('lang-level-select');
  if (select) select.value = currentLanguageLevel;
}

function renderPlanTable() {
  const visibleWords = getVisibleWords();
  const tbody = document.getElementById('plan-table-body');
  tbody.innerHTML = BATCHES.map((batch, idx) => {
    const value = Number.isNaN(batch.batchIdNum) ? batch._idx : batch.batchIdNum;
    const visibleCount = visibleWords.filter(w => w.batchId === value).length;
    if (visibleCount === 0) return '';
    const title = escapeHtml(batch.batchName || ('Блок ' + (idx + 1)));
    return `
      <tr class="plan-row" onclick="goToBatch(${value})" title="Открыть карточки: ${title}">
        <td class="batch-tag">Блок ${idx + 1}</td>
        <td>${title}</td>
        <td>${visibleCount} слов</td>
        <td style="color:var(--accent)">▶ Учить</td>
      </tr>`;
  }).join('');

  const total = visibleWords.length;
  const batchCount = BATCHES.filter(batch => {
    const value = Number.isNaN(batch.batchIdNum) ? batch._idx : batch.batchIdNum;
    return visibleWords.some(w => w.batchId === value);
  }).length;
  const avg = batchCount ? Math.round(total / batchCount) : 0;
  document.getElementById('plan-title').textContent = 'Обзор: ' + total + ' слов';
  document.getElementById('badge-total').textContent = String(total);
  document.getElementById('badge-batches').textContent = String(batchCount);
  document.getElementById('badge-avg').textContent = '~' + avg;
}

function goToBatch(batchId) {
  document.getElementById('batch-select').value = batchId;
  showPage('learn');
  resetLearn();
}

function getLearnQueue() {
  const val = Number.parseInt(document.getElementById('batch-select').value, 10);
  const progress = loadProgress();
  const now = Date.now();
  const visibleWords = getVisibleWords();
  let pool;

  if (val === -1) {
    pool = visibleWords.filter(w => {
      const p = progress[WORDS.indexOf(w)];
      return !p || !p.seen || p.nextReview <= now;
    });
  } else if (val === -2) {
    pool = [...visibleWords];
  } else {
    pool = visibleWords.filter(w => w.batchId === val);
  }

  return pool.map(w => ({ w, origIdx: WORDS.indexOf(w) })).sort(() => Math.random() - .5);
}

function resetLearn() {
  learnQueue = getLearnQueue();
  learnIdx = 0;
  learnFlipped = false;
  learnStats = { known: 0, maybe: 0, unknown: 0 };
  document.getElementById('learn-main').style.display = '';
  document.getElementById('learn-done').style.display = 'none';
  showLearnCard();
}

function showLearnCard() {
  if (learnIdx >= learnQueue.length) {
    showLearnDone();
    return;
  }

  resetFlipCardToFront('flip-card');
  learnFlipped = false;

  const { w } = learnQueue[learnIdx];
  document.getElementById('card-present').textContent = w.greek || '-';
  document.getElementById('card-example').textContent = w.example || '';
  document.getElementById('card-translation').textContent = w.translation || '-';

  const lvl = w.languageLevel || '';
  const badge = document.getElementById('card-level-badge');
  badge.textContent = lvl;
  badge.className = 'card-level-badge' + (lvl ? ' card-level-' + lvl : '');

  const tag = w.batchRef?.batchHeader || 'Блок';
  document.getElementById('card-batch-tag').textContent = tag;
  document.getElementById('card-batch-tag2').textContent = tag;

  const total = learnQueue.length;
  const pct = total ? Math.round(learnIdx / total * 100) : 0;
  document.getElementById('learn-progress-bar').style.width = pct + '%';
  document.getElementById('learn-progress-label').textContent = (total ? (learnIdx + 1) : 0) + ' / ' + total;
  document.getElementById('btn-prev').disabled = learnIdx === 0;
  document.getElementById('btn-next').disabled = learnIdx >= learnQueue.length - 1;
}

function flipCard() {
  const fc = document.getElementById('flip-card');
  if (!learnFlipped) {
    fc.classList.add('flipped');
    learnFlipped = true;
  } else {
    fc.classList.remove('flipped');
    learnFlipped = false;
  }
}

function prevCard() {
  if (learnIdx > 0) {
    learnIdx--;
    showLearnCard();
  }
}

function nextCard() {
  if (learnIdx < learnQueue.length) {
    learnIdx++;
    showLearnCard();
  }
}

function rate(rating) {
  if (!learnQueue.length || learnIdx >= learnQueue.length) return;
  const item = learnQueue[learnIdx];
  const progress = updateSR(loadProgress(), item.origIdx, rating);
  saveProgress(progress);

  if (rating === 5) learnStats.known++;
  else if (rating === 3) learnStats.maybe++;
  else learnStats.unknown++;

  learnIdx++;
  showLearnCard();
}

function showLearnDone() {
  document.getElementById('learn-main').style.display = 'none';
  document.getElementById('learn-done').style.display = '';
  document.getElementById('done-stats').textContent =
    '✓ ' + learnStats.known + ' знаю  |  ~ ' + learnStats.maybe + ' смутно  |  ✗ ' + learnStats.unknown + ' не знаю';
  document.getElementById('learn-progress-bar').style.width = '100%';
  document.getElementById('learn-progress-label').textContent = learnQueue.length + ' / ' + learnQueue.length;
}

function startQuiz() {
  const bval = Number.parseInt(document.getElementById('quiz-batch').value, 10);
  const excludeKnown = document.getElementById('quiz-exclude-known').checked;
  const visibleWords = getVisibleWords();

  let pool = bval === -2 ? [...visibleWords] : visibleWords.filter(w => w.batchId === bval);
  if (excludeKnown) {
    const progress = loadProgress();
    pool = pool.filter(w => getCategory(progress[WORDS.indexOf(w)]) < 2);
  }

  if (pool.length < 1) {
    alert('В выбранной выборке не осталось слов для теста.');
    return;
  }

  quizPool = [...pool].sort(() => Math.random() - 0.5);
  quizAnswered = false;
  quizCorrectCount = 0;
  quizTotalCount = 0;
  document.getElementById('quiz-correct').textContent = '0';
  document.getElementById('quiz-total').textContent = '0';
  nextQuizQuestion();
}

function nextQuizQuestion() {
  if (quizPool.length === 0) {
    document.getElementById('quiz-q-text').textContent = '🎉 Тест завершён!';
    document.getElementById('quiz-q-sub').textContent = 'Результат: ' + quizCorrectCount + ' / ' + quizTotalCount;
    document.getElementById('quiz-options').innerHTML = '<button class="btn-primary" onclick="startQuiz()" style="margin:10px auto;display:block">Начать заново</button>';
    document.getElementById('next-btn-wrap').style.display = 'none';
    document.getElementById('quiz-giveup-wrap').style.display = 'none';
    return;
  }

  quizAnswered = false;
  document.getElementById('next-btn-wrap').style.display = 'none';
  document.getElementById('quiz-giveup-wrap').style.display = '';
  document.getElementById('btn-giveup').disabled = false;

  const mode = document.getElementById('quiz-mode').value;
  const correct = quizPool.shift();
  quizCurrent = correct;

  const wrongs = getVisibleWords()
    .filter(w => w !== correct)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);
  const options = [correct, ...wrongs].sort(() => Math.random() - 0.5);

  document.getElementById('quiz-mode-label').textContent = mode === 'gr-ru'
    ? 'Выбери перевод'
    : 'Выбери греческое слово';
  document.getElementById('quiz-q-text').textContent = mode === 'gr-ru'
    ? (correct.greek || '')
    : (correct.translation || '');
  document.getElementById('quiz-q-sub').textContent = correct.example || '';

  document.getElementById('quiz-options').innerHTML = options.map(o => {
    const label = mode === 'gr-ru' ? (o.translation || '-') : (o.greek || '-');
    const chosenVal = mode === 'gr-ru' ? (o.translation || '') : (o.greek || '');
    const correctVal = mode === 'gr-ru' ? (correct.translation || '') : (correct.greek || '');
    return `<button class="quiz-option" data-answer="${escapeHtml(chosenVal)}" onclick="checkAnswer(this, '${escapeHtml(chosenVal)}', '${escapeHtml(correctVal)}')">${escapeHtml(label)}</button>`;
  }).join('');
}

function checkAnswer(btn, chosenEscaped, correctEscaped) {
  if (quizAnswered) return;
  quizAnswered = true;
  quizTotalCount++;

  const chosen = chosenEscaped
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
  const correct = correctEscaped
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

  document.querySelectorAll('#page-quiz .quiz-option').forEach(b => { b.disabled = true; });

  const isCorrect = chosen === correct;
  if (isCorrect) {
    btn.classList.add('correct');
    quizCorrectCount++;
  } else {
    btn.classList.add('wrong');
    const cb = Array.from(document.querySelectorAll('#page-quiz .quiz-option')).find(b => b.dataset.answer === correctEscaped);
    if (cb) cb.classList.add('correct');
  }

  updateQuizSR(WORDS.indexOf(quizCurrent), isCorrect);
  document.getElementById('quiz-correct').textContent = String(quizCorrectCount);
  document.getElementById('quiz-total').textContent = String(quizTotalCount);
  document.getElementById('quiz-giveup-wrap').style.display = 'none';
  document.getElementById('next-btn-wrap').style.display = '';
}

function giveUp() {
  if (quizAnswered) return;
  quizAnswered = true;
  quizTotalCount++;

  document.querySelectorAll('#page-quiz .quiz-option').forEach(b => { b.disabled = true; });

  const mode = document.getElementById('quiz-mode').value;
  const correctVal = mode === 'gr-ru' ? (quizCurrent.translation || '') : (quizCurrent.greek || '');
  const correctEsc = escapeHtml(correctVal);
  const cb = Array.from(document.querySelectorAll('#page-quiz .quiz-option')).find(b => b.dataset.answer === correctEsc);
  if (cb) cb.classList.add('correct');

  const idx = WORDS.indexOf(quizCurrent);
  const progress = loadProgress();
  let p = progress[idx] || { interval: 1, ef: 2.5, nextReview: Date.now(), seen: false };
  p.seen = false;
  p.interval = 1;
  p.ef = Math.max(1.3, p.ef - 0.2);
  p.nextReview = Date.now() + 86400000;
  progress[idx] = p;
  saveProgress(progress);
  quizStreaks[idx] = 0;

  document.getElementById('quiz-total').textContent = String(quizTotalCount);
  document.getElementById('quiz-giveup-wrap').style.display = 'none';
  document.getElementById('next-btn-wrap').style.display = '';
}

function updateProgressPage() {
  const progress = loadProgress();
  let known = 0;
  let learning = 0;
  let neww = 0;
  const visibleWords = getVisibleWords();

  visibleWords.forEach(w => {
    const i = WORDS.indexOf(w);
    const p = progress[i];
    if (!p || !p.seen) neww++;
    else if (p.interval >= 7) known++;
    else learning++;
  });

  document.getElementById('stat-known').textContent = String(known);
  document.getElementById('stat-learning').textContent = String(learning);
  document.getElementById('stat-new').textContent = String(neww);

  const list = document.getElementById('batch-progress-list');
  list.innerHTML = '';

  for (const batch of BATCHES) {
    const batchWords = visibleWords.filter(w => w.batchId === (Number.isNaN(batch.batchIdNum) ? batch._idx : batch.batchIdNum));
    const total = batchWords.length;
    if (total === 0) continue;
    const done = batchWords.filter(w => {
      const p = progress[WORDS.indexOf(w)];
      return p && p.seen && p.interval >= 3;
    }).length;
    const pct = total ? Math.round(done / total * 100) : 0;

    const rows = batchWords.map(w => {
      const p = progress[WORDS.indexOf(w)];
      const cat = getCategory(p);
      const [icon, label, cls] = cat === 2
        ? ['✓', 'знаю', 'verb-status-known']
        : cat === 1
        ? ['~', 'смутно', 'verb-status-learning']
        : ['✕', 'не знаю', 'verb-status-new'];

      return `<div class="verb-status-row">
        <span class="verb-status-badge ${cls}">${icon} ${label}</span>
        <span class="verb-status-present">${escapeHtml(w.greek || '-')}</span>
        <span class="verb-status-translation">${escapeHtml(w.translation || '')}</span>
      </div>`;
    }).join('');

    const resetId = Number.isNaN(batch.batchIdNum) ? batch._idx : batch.batchIdNum;
    list.innerHTML += `
      <details class="batch-row-details">
        <summary class="batch-row-header">
          <div class="batch-row-left">
            <span class="batch-row-arrow">▶</span>
            <span class="batch-row-name">${escapeHtml(batch.batchHeader || ('Блок ' + (batch._idx + 1)))}</span>
          </div>
          <div class="batch-row-right">
            <span class="batch-row-pct">${done}/${total} (${pct}%)</span>
            <button class="btn-reset-batch" onclick="event.preventDefault();event.stopPropagation();resetBatchProgress(${resetId})">Сбросить</button>
          </div>
        </summary>
        <div class="mini-bar" style="margin:0 0 10px"><div class="mini-bar-fill" style="width:${pct}%"></div></div>
        <div class="verb-status-list">${rows}</div>
      </details>`;
  }
}

function resetBatchProgress(batchId) {
  if (!confirm('Сбросить прогресс для этого блока?')) return;
  const progress = loadProgress();
  const visibleWords = getVisibleWords();

  WORDS.forEach((w, i) => {
    if (w.batchId === batchId && visibleWords.includes(w)) delete progress[i];
  });

  saveProgress(progress);
  updateProgressPage();
}

function resetAll() {
  if (confirm('Сбросить весь прогресс вводных и соединительных слов?')) {
    localStorage.removeItem(PROG_KEY);
    updateProgressPage();
  }
}

window.showPage = showPage;
window.goToBatch = goToBatch;
window.resetLearn = resetLearn;
window.flipCard = flipCard;
window.prevCard = prevCard;
window.nextCard = nextCard;
window.rate = rate;
window.startQuiz = startQuiz;
window.nextQuizQuestion = nextQuizQuestion;
window.checkAnswer = checkAnswer;
window.giveUp = giveUp;
window.resetBatchProgress = resetBatchProgress;
window.resetAll = resetAll;
window.onLanguageLevelChange = onLanguageLevelChange;

initLanguageLevelControl();
renderBatchOptions();
renderPlanTable();
resetLearn();
resetQuizUiState();

  })
  .catch(err => console.error('Failed to load data.json:', err));
