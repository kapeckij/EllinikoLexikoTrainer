fetch('data.json')
  .then(r => r.json())
  .then(TRAINER_DATA => {

const BATCHES = TRAINER_DATA.batches;
const VERBS = BATCHES.flatMap(batch => batch.verbs.map(v => ({ ...v, batch: Number(batch.batchId) })));
const BATCH_NAMES = BATCHES.map(batch => batch.batchName);
const LANGUAGE_LEVEL_KEY = 'gr_language_level';
const LANGUAGE_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const LEVEL_RANK = { A1: 0, A2: 1, B1: 2, B2: 3, C1: 4 };

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

function getVisibleVerbs() {
  return VERBS.filter(v => isVisibleByLanguageLevel(v.languageLevel));
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

  const visibleVerbs = getVisibleVerbs();

  BATCHES.forEach(batch => {
    const batchIdNum = Number(batch.batchId);
    const visibleCount = visibleVerbs.filter(v => v.batch === batchIdNum).length;
    if (visibleCount === 0) return;

    const optLearn = document.createElement('option');
    optLearn.value = batch.batchId;
    optLearn.textContent = `${batch.batchHeader} (${visibleCount})`;
    learnSelect.appendChild(optLearn);

    const optQuiz = document.createElement('option');
    optQuiz.value = batch.batchId;
    optQuiz.textContent = `${batch.batchHeader} (${visibleCount})`;
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
  document.getElementById('quiz-correct').textContent = 0;
  document.getElementById('quiz-total').textContent = 0;
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
  const visibleVerbs = getVisibleVerbs();
  const tbody = document.getElementById('plan-table-body');
  tbody.innerHTML = BATCHES.map((batch, idx) => {
    const batchIdNum = Number(batch.batchId);
    const visibleCount = visibleVerbs.filter(v => v.batch === batchIdNum).length;
    if (visibleCount === 0) return '';
    return `
    <tr class="plan-row" onclick="goToBatch(${batch.batchId})" title="Открыть карточки: ${batch.batchName}">
      <td class="batch-tag">Блок ${idx + 1}</td>
      <td>${batch.batchName}</td>
      <td>${visibleCount} глаголов</td>
      <td style="color:var(--accent)">▶ Учить</td>
    </tr>
  `;
  }).join('');

  // Fill dynamic badges from data
  const totalVerbs = visibleVerbs.length;
  const totalBatches = BATCHES.filter(batch => {
    const batchIdNum = Number(batch.batchId);
    return visibleVerbs.some(v => v.batch === batchIdNum);
  }).length;
  const avg = totalBatches ? Math.round(totalVerbs / totalBatches) : 0;
  document.getElementById('plan-title').textContent = `Обзор: ${totalVerbs} глаголов`;
  document.getElementById('badge-total').textContent = totalVerbs;
  document.getElementById('badge-batches').textContent = totalBatches;
  document.getElementById('badge-avg').textContent = `~${avg}`;
}

function goToBatch(batchId) {
  document.getElementById('batch-select').value = batchId;
  showPage('learn');
  resetLearn();
}


// ===== SPACED REPETITION (simplified SM-2) =====
// progress[verbIdx] = { interval: days, ef: ease_factor, nextReview: timestamp, seen: bool }
function loadProgress() {
  try { return JSON.parse(localStorage.getItem('gr_progress') || '{}'); } catch { return {}; }
}
function saveProgress(p) { localStorage.setItem('gr_progress', JSON.stringify(p)); }

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

// ===== NAVIGATION =====
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const btns = document.querySelectorAll('nav button');
  const pages = ['plan','learn','quiz','progress'];
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

// ===== LEARN PAGE =====
let learnQueue = [];
let learnIdx = 0;
let learnFlipped = false;
let learnStats = { known: 0, maybe: 0, unknown: 0 };

function getLearnQueue() {
  const val = parseInt(document.getElementById('batch-select').value);
  const progress = loadProgress();
  const today = Date.now();
  const visibleVerbs = getVisibleVerbs();
  let pool;
  if (val === -1) {
    // Due for review today
    pool = visibleVerbs.filter(v => {
      const p = progress[VERBS.indexOf(v)];
      if (!p || !p.seen) return true; // new = due
      return p.nextReview <= today;
    });
  } else if (val === -2) {
    pool = [...visibleVerbs];
  } else {
    pool = visibleVerbs.filter(v => v.batch === val);
  }
  // Shuffle
  return pool.map((v, i) => ({ v, origIdx: VERBS.indexOf(v) }))
             .sort(() => Math.random() - .5);
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
  const item = learnQueue[learnIdx];
  const v = item.v;
  document.getElementById('card-present').textContent = v.present;
  document.getElementById('card-forms').textContent = v.future + ' / ' + v.past;
  document.getElementById('card-translation').textContent = v.translation;
  document.getElementById('card-example').textContent = v.example;
  const bname = 'Блок ' + (v.batch + 1);
  document.getElementById('card-batch-tag').textContent = bname;
  document.getElementById('card-batch-tag2').textContent = bname;

  const lvl = v.languageLevel || '';
  const badge = document.getElementById('card-level-badge');
  badge.textContent = lvl;
  badge.className = 'card-level-badge' + (lvl ? ' card-level-' + lvl : '');
  
  const total = learnQueue.length;
  const pct = Math.round(learnIdx / total * 100);
  document.getElementById('learn-progress-bar').style.width = pct + '%';
  document.getElementById('learn-progress-label').textContent = (learnIdx + 1) + ' / ' + total;

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
  if (learnIdx <= 0) return;
  learnIdx--;
  showLearnCard();
}

function nextCard() {
  if (learnIdx >= learnQueue.length) return;
  learnIdx++;
  showLearnCard();
}

function rate(rating) {
  const item = learnQueue[learnIdx];
  let progress = loadProgress();
  progress = updateSR(progress, item.origIdx, rating);
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

// ===== QUIZ PAGE =====
let quizPool = [];
let quizCurrent = null;
let quizCorrectCount = 0;
let quizTotalCount = 0;
let quizAnswered = false;
const quizStreaks = {}; // verbIdx → consecutive correct count in this session

// Returns 0=не знаю, 1=смутно, 2=знаю
function getCategory(p) {
  if (!p || !p.seen) return 0;
  if (p.interval >= 7) return 2;
  return 1;
}

function updateQuizSR(verbIdx, isCorrect) {
  let progress = loadProgress();
  let p = progress[verbIdx] || { interval: 1, ef: 2.5, nextReview: Date.now(), seen: false };
  const cat = getCategory(p);
  if (!isCorrect) {
    quizStreaks[verbIdx] = 0;
    if (cat === 2) {           // знаю → смутно
      p.interval = 3;
      p.ef = Math.max(1.3, p.ef - 0.2);
    } else if (cat === 1) {    // смутно → не знаю
      p.interval = 1;
      p.seen = false;
      p.ef = Math.max(1.3, p.ef - 0.2);
    }
    // cat === 0: остаётся не знаю
  } else {
    quizStreaks[verbIdx] = (quizStreaks[verbIdx] || 0) + 1;
    if (quizStreaks[verbIdx] >= 2) {
      quizStreaks[verbIdx] = 0;
      if (cat === 0) {         // не знаю → смутно (2 правильных подряд)
        p.seen = true;
        p.interval = 3;
      } else if (cat === 1) { // смутно → знаю (ещё 2 правильных подряд)
        p.interval = 7;
        p.ef = Math.min(3.0, p.ef + 0.1);
      }
      // cat === 2: уже знаю, не меняем
    }
  }
  p.nextReview = Date.now() + p.interval * 86400000;
  progress[verbIdx] = p;
  saveProgress(progress);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function startQuiz() {
  const bval = parseInt(document.getElementById('quiz-batch').value);
  const excludeKnown = document.getElementById('quiz-exclude-known').checked;
  const visibleVerbs = getVisibleVerbs();
  let pool = bval === -2 ? [...visibleVerbs] : visibleVerbs.filter(v => v.batch === bval);
  if (excludeKnown) {
    const progress = loadProgress();
    pool = pool.filter(v => getCategory(progress[VERBS.indexOf(v)]) < 2);
  }
  quizPool = pool.sort(() => Math.random() - .5);
  if (quizPool.length < 1) { alert('Блок выучен - отличная работа!'); return; }
  quizPool = [...quizPool].sort(() => Math.random() - .5);
  quizCorrectCount = 0;
  quizTotalCount = 0;
  quizAnswered = false;
  document.getElementById('quiz-correct').textContent = 0;
  document.getElementById('quiz-total').textContent = 0;
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
  
  // Get 3 wrong options
  const wrongPool = getVisibleVerbs().filter(v => v !== correct);
  const wrongs = wrongPool.sort(() => Math.random() - .5).slice(0, 3);
  const options = [correct, ...wrongs].sort(() => Math.random() - .5);
  
  const modeLabel = document.getElementById('quiz-mode-label');
  const qText = document.getElementById('quiz-q-text');
  const qSub = document.getElementById('quiz-q-sub');
  const optContainer = document.getElementById('quiz-options');
  
  if (mode === 'gr-ru') {
    modeLabel.textContent = 'Переведи на русский:';
    qText.textContent = correct.present;
    qSub.textContent = correct.future + ' / ' + correct.past;
    optContainer.innerHTML = options.map(o => 
      `<button class="quiz-option" data-answer="${escapeHtml(o.present)}" onclick="checkAnswer(this, '${o.present.replace(/'/g,"&#39;")}', '${correct.present.replace(/'/g,"&#39;")}')">${o.translation}</button>`
    ).join('');
  } else if (mode === 'ru-gr') {
    modeLabel.textContent = 'Выбери греческий глагол:';
    qText.textContent = correct.translation;
    qSub.innerHTML = `<details class="quiz-spoiler"><summary>Показать пример (спойлер)</summary><div class="quiz-example-text">${escapeHtml(correct.example)}</div></details>`;
    optContainer.innerHTML = options.map(o => 
      `<button class="quiz-option" data-answer="${escapeHtml(o.present)}" onclick="checkAnswer(this, '${o.present.replace(/'/g,"&#39;")}', '${correct.present.replace(/'/g,"&#39;")}')">${o.present}<br><small style="color:var(--muted)">${o.future} / ${o.past}</small></button>`
    ).join('');
  } else {
    // forms mode
    const askFuture = Math.random() > 0.5;
    modeLabel.textContent = askFuture ? 'Угадай БУДУЩЕЕ время:' : 'Угадай ПРОШЕДШЕЕ время:';
    qText.textContent = correct.present;
    qSub.textContent = correct.translation;
    const correctForm = askFuture ? correct.future : correct.past;
    const wrongForms = wrongs.map(o => askFuture ? o.future : o.past);
    const allForms = [correctForm, ...wrongForms].sort(() => Math.random() - .5);
    optContainer.innerHTML = allForms.map(f => 
      `<button class="quiz-option" data-answer="${escapeHtml(f)}" onclick="checkFormAnswer(this, '${f.replace(/'/g,"&#39;")}', '${correctForm.replace(/'/g,"&#39;")}')">${f}</button>`
    ).join('');
  }
}

function checkAnswer(btn, chosen, correct) {
  if (quizAnswered) return;
  quizAnswered = true;
  quizTotalCount++;
  document.querySelectorAll('.quiz-option').forEach(b => b.disabled = true);
  const isCorrect = chosen === correct;
  if (isCorrect) { btn.classList.add('correct'); quizCorrectCount++; }
  else {
    btn.classList.add('wrong');
    const correctBtn = Array.from(document.querySelectorAll('.quiz-option')).find(b => b.dataset.answer === correct);
    if (correctBtn) correctBtn.classList.add('correct');
  }
  updateQuizSR(VERBS.indexOf(quizCurrent), isCorrect);
  document.getElementById('quiz-correct').textContent = quizCorrectCount;
  document.getElementById('quiz-total').textContent = quizTotalCount;
  document.getElementById('next-btn-wrap').style.display = '';
}

function checkFormAnswer(btn, chosen, correct) {
  if (quizAnswered) return;
  quizAnswered = true;
  quizTotalCount++;
  document.querySelectorAll('.quiz-option').forEach(b => b.disabled = true);
  const isCorrect = chosen === correct;
  if (isCorrect) { btn.classList.add('correct'); quizCorrectCount++; }
  else {
    btn.classList.add('wrong');
    const correctBtn = Array.from(document.querySelectorAll('.quiz-option')).find(b => b.dataset.answer === correct);
    if (correctBtn) correctBtn.classList.add('correct');
  }
  updateQuizSR(VERBS.indexOf(quizCurrent), isCorrect);
  document.getElementById('quiz-correct').textContent = quizCorrectCount;
  document.getElementById('quiz-total').textContent = quizTotalCount;
  document.getElementById('next-btn-wrap').style.display = '';
}

// ===== PROGRESS PAGE =====
function updateProgressPage() {
  const progress = loadProgress();
  let known = 0, learning = 0, neww = 0;
  const visibleVerbs = getVisibleVerbs();

  visibleVerbs.forEach(v => {
    const i = VERBS.indexOf(v);
    const p = progress[i];
    if (!p || !p.seen) neww++;
    else if (p.interval >= 7) known++;
    else learning++;
  });
  document.getElementById('stat-known').textContent = known;
  document.getElementById('stat-learning').textContent = learning;
  document.getElementById('stat-new').textContent = neww;

  const batchList = document.getElementById('batch-progress-list');
  batchList.innerHTML = '';
  for (let b = 0; b < BATCHES.length; b++) {
    const bVerbs = visibleVerbs.filter(v => v.batch === b);
    const bTotal = bVerbs.length;
    if (bTotal === 0) continue;
    const bKnown = bVerbs.filter(v => {
      const p = progress[VERBS.indexOf(v)];
      return p && p.seen && p.interval >= 3;
    }).length;
    const pct = Math.round(bKnown / bTotal * 100);

    const verbRows = bVerbs.map(v => {
      const p = progress[VERBS.indexOf(v)];
      const cat = getCategory(p);
      const [icon, label, cls] = cat === 2
        ? ['✓', 'знаю', 'verb-status-known']
        : cat === 1
        ? ['~', 'смутно', 'verb-status-learning']
        : ['✕', 'не знаю', 'verb-status-new'];
      return `<div class="verb-status-row">
        <span class="verb-status-badge ${cls}">${icon} ${label}</span>
        <span class="verb-status-present">${escapeHtml(v.present)}</span>
        <span class="verb-status-translation">${escapeHtml(v.translation)}</span>
      </div>`;
    }).join('');

    batchList.innerHTML += `
      <details class="batch-row-details">
        <summary class="batch-row-header">
          <div class="batch-row-left">
            <span class="batch-row-arrow">▶</span>
            <span class="batch-row-name">Блок ${b+1}: ${BATCH_NAMES[b]}</span>
          </div>
          <div class="batch-row-right">
            <span class="batch-row-pct">${bKnown}/${bTotal} (${pct}%)</span>
            <button class="btn-reset-batch" onclick="event.preventDefault();event.stopPropagation();resetBatchProgress(${b})">Сбросить блок</button>
          </div>
        </summary>
        <div class="mini-bar" style="margin:0 0 10px"><div class="mini-bar-fill" style="width:${pct}%"></div></div>
        <div class="verb-status-list">${verbRows}</div>
      </details>`;
  }
}

function resetBatchProgress(batchId) {
  if (!confirm('Сбросить прогресс только для этого блока?')) return;
  const progress = loadProgress();
  const visibleVerbs = getVisibleVerbs();
  VERBS.forEach((v, i) => {
    if (v.batch === batchId && visibleVerbs.includes(v)) {
      delete progress[i];
      quizStreaks[i] = 0;
    }
  });
  saveProgress(progress);
  updateProgressPage();
}

function giveUp() {
  if (quizAnswered) return;
  quizAnswered = true;
  quizTotalCount++;
  // disable all options and highlight correct
  document.querySelectorAll('.quiz-option').forEach(b => b.disabled = true);
  const correctKey = quizCurrent.present;
  const correctBtn = Array.from(document.querySelectorAll('.quiz-option')).find(b => b.dataset.answer === correctKey);
  if (correctBtn) correctBtn.classList.add('correct');
  // force category to 0 (не знаю)
  const idx = VERBS.indexOf(quizCurrent);
  let progress = loadProgress();
  let p = progress[idx] || { interval: 1, ef: 2.5, nextReview: Date.now(), seen: false };
  p.seen = false;
  p.interval = 1;
  p.ef = Math.max(1.3, p.ef - 0.2);
  p.nextReview = Date.now() + 86400000;
  progress[idx] = p;
  saveProgress(progress);
  quizStreaks[idx] = 0;
  document.getElementById('quiz-total').textContent = quizTotalCount;
  document.getElementById('quiz-giveup-wrap').style.display = 'none';
  document.getElementById('next-btn-wrap').style.display = '';
}

function resetAll() {
  if (confirm('Сбросить весь прогресс? Это удалит все данные об изученных словах.')) {
    localStorage.removeItem('gr_progress');
    updateProgressPage();
  }
}

// Expose functions to global scope (required for HTML onclick attributes)
window.showPage = showPage;
window.resetLearn = resetLearn;
window.goToBatch = goToBatch;
window.flipCard = flipCard;
window.prevCard = prevCard;
window.nextCard = nextCard;
window.rate = rate;
window.startQuiz = startQuiz;
window.nextQuizQuestion = nextQuizQuestion;
window.checkAnswer = checkAnswer;
window.checkFormAnswer = checkFormAnswer;
window.giveUp = giveUp;
window.resetBatchProgress = resetBatchProgress;
window.resetAll = resetAll;
window.onLanguageLevelChange = onLanguageLevelChange;

// Init
initLanguageLevelControl();
renderBatchOptions();
renderPlanTable();
resetLearn();
resetQuizUiState();

  })
  .catch(err => console.error('Failed to load data.json:', err));
