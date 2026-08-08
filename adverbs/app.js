fetch('../resources/adverbs-data.json')
  .then(r => r.json())
  .then(TRAINER_DATA => {

const BATCHES = TRAINER_DATA.batches;
const WORDS = BATCHES.flatMap(batch => batch.words.map(w => ({ ...w, batch: Number(batch.batchId) })));
const BATCH_NAMES = BATCHES.map(batch => batch.batchName);
const LANGUAGE_LEVEL_KEY = 'gr_language_level';
const LANGUAGE_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const LEVEL_RANK = { A1: 0, A2: 1, B1: 2, B2: 3, C1: 4 };
const PROG_KEY = 'gr_adverbs_progress';

let currentLanguageLevel = 'C1';

// ===== LANGUAGE LEVEL =====
function normalizeLanguageLevel(level) {
  const normalized = String(level || '').toUpperCase().trim();
  return LANGUAGE_LEVELS.includes(normalized) ? normalized : null;
}

function loadLanguageLevel() {
  return normalizeLanguageLevel(localStorage.getItem(LANGUAGE_LEVEL_KEY)) || 'C1';
}

function saveLanguageLevel(level) {
  localStorage.setItem(LANGUAGE_LEVEL_KEY, level);
}

function isVisibleByLanguageLevel(wordLevel) {
  const normWord = normalizeLanguageLevel(wordLevel);
  const normSel = normalizeLanguageLevel(currentLanguageLevel) || 'C1';
  if (!normWord) return true;
  return LEVEL_RANK[normWord] <= LEVEL_RANK[normSel];
}

function getVisibleWords() {
  return WORDS.filter(w => isVisibleByLanguageLevel(w.languageLevel));
}

function onLanguageLevelChange(level) {
  currentLanguageLevel = normalizeLanguageLevel(level) || 'C1';
  saveLanguageLevel(currentLanguageLevel);
  const select = document.getElementById('lang-level-select');
  if (select) select.value = currentLanguageLevel;
  renderPlanTable();
  renderBatchOptions();
  const activePageId = document.querySelector('.page.active')?.id;
  if (activePageId === 'page-learn') resetLearn();
  else if (activePageId === 'page-progress') updateProgressPage();
  else if (activePageId === 'page-quiz') resetQuizUiState();
}

function initLanguageLevelControl() {
  currentLanguageLevel = loadLanguageLevel();
  const select = document.getElementById('lang-level-select');
  if (select) select.value = currentLanguageLevel;
}

// ===== HELPERS =====
function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// ===== PROGRESS =====
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

const quizStreaks = {};

function updateQuizSR(wordIdx, isCorrect) {
  let progress = loadProgress();
  let p = progress[wordIdx] || { interval: 1, ef: 2.5, nextReview: Date.now(), seen: false };
  const cat = getCategory(p);
  if (!isCorrect) {
    quizStreaks[wordIdx] = 0;
    if (cat === 2) { p.interval = 3; p.ef = Math.max(1.3, p.ef - 0.2); }
    else if (cat === 1) { p.interval = 1; p.seen = false; p.ef = Math.max(1.3, p.ef - 0.2); }
  } else {
    quizStreaks[wordIdx] = (quizStreaks[wordIdx] || 0) + 1;
    if (quizStreaks[wordIdx] >= 2) {
      quizStreaks[wordIdx] = 0;
      if (cat === 0) { p.seen = true; p.interval = 3; }
      else if (cat === 1) { p.interval = 7; p.ef = Math.min(3.0, p.ef + 0.1); }
    }
  }
  p.nextReview = Date.now() + p.interval * 86400000;
  progress[wordIdx] = p;
  saveProgress(progress);
}

// ===== NAVIGATION =====
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const pages = ['plan', 'learn', 'quiz', 'progress'];
  document.querySelectorAll('nav button')[pages.indexOf(name)]?.classList.add('active');
  if (name === 'progress') updateProgressPage();
}

// ===== PLAN =====
function renderBatchOptions() {
  const learnSelect = document.getElementById('batch-select');
  const quizSelect = document.getElementById('quiz-batch');
  const curLearn = learnSelect.value;
  const curQuiz = quizSelect.value;

  Array.from(learnSelect.querySelectorAll('option')).forEach(o => { if (o.value !== '-1' && o.value !== '-2') o.remove(); });
  Array.from(quizSelect.querySelectorAll('option')).forEach(o => { if (o.value !== '-2') o.remove(); });

  const visibleWords = getVisibleWords();
  BATCHES.forEach(batch => {
    const bId = Number(batch.batchId);
    const cnt = visibleWords.filter(w => w.batch === bId).length;
    if (cnt === 0) return;
    const ol = document.createElement('option');
    ol.value = batch.batchId; ol.textContent = `${batch.batchHeader} (${cnt})`;
    learnSelect.appendChild(ol);
    const oq = document.createElement('option');
    oq.value = batch.batchId; oq.textContent = `${batch.batchHeader} (${cnt})`;
    quizSelect.appendChild(oq);
  });

  if (Array.from(learnSelect.options).some(o => o.value === curLearn)) learnSelect.value = curLearn; else learnSelect.value = '-1';
  if (Array.from(quizSelect.options).some(o => o.value === curQuiz)) quizSelect.value = curQuiz; else quizSelect.value = '-2';
}

function renderPlanTable() {
  const visibleWords = getVisibleWords();
  const tbody = document.getElementById('plan-table-body');
  tbody.innerHTML = BATCHES.map((batch, idx) => {
    const bId = Number(batch.batchId);
    const cnt = visibleWords.filter(w => w.batch === bId).length;
    if (cnt === 0) return '';
    return `<tr class="plan-row" onclick="goToBatch(${batch.batchId})">
      <td class="batch-tag">Блок ${idx + 1}</td>
      <td>${escapeHtml(batch.batchName)}</td>
      <td>${cnt} слов</td>
      <td style="color:var(--accent)">▶ Учить</td>
    </tr>`;
  }).join('');

  const total = visibleWords.length;
  const totalBatches = BATCHES.filter(b => visibleWords.some(w => w.batch === Number(b.batchId))).length;
  const avg = totalBatches ? Math.round(total / totalBatches) : 0;
  document.getElementById('plan-title').textContent = `Обзор: ${total} наречий`;
  document.getElementById('badge-total').textContent = total;
  document.getElementById('badge-batches').textContent = totalBatches;
  document.getElementById('badge-avg').textContent = `~${avg}`;
}

function goToBatch(batchId) {
  document.getElementById('batch-select').value = batchId;
  showPage('learn');
  resetLearn();
}

// ===== LEARN =====
let learnQueue = [], learnIdx = 0, learnFlipped = false;
let learnStats = { known: 0, maybe: 0, unknown: 0 };

function getLearnQueue() {
  const val = parseInt(document.getElementById('batch-select').value);
  const progress = loadProgress();
  const today = Date.now();
  const visibleWords = getVisibleWords();
  let pool;
  if (val === -1) {
    pool = visibleWords.filter(w => {
      const p = progress[WORDS.indexOf(w)];
      return !p || !p.seen || p.nextReview <= today;
    });
  } else if (val === -2) {
    pool = [...visibleWords];
  } else {
    pool = visibleWords.filter(w => w.batch === val);
  }
  return pool.map(w => ({ w, origIdx: WORDS.indexOf(w) })).sort(() => Math.random() - .5);
}

function resetFlipCardToFront() {
  const card = document.getElementById('flip-card');
  if (!card) return;
  card.classList.add('no-transition');
  card.classList.remove('flipped');
  void card.offsetWidth;
  requestAnimationFrame(() => card.classList.remove('no-transition'));
}

function resetLearn() {
  learnQueue = getLearnQueue();
  learnIdx = 0; learnFlipped = false;
  learnStats = { known: 0, maybe: 0, unknown: 0 };
  document.getElementById('learn-main').style.display = '';
  document.getElementById('learn-done').style.display = 'none';
  showLearnCard();
}

function showLearnCard() {
  if (learnIdx >= learnQueue.length) { showLearnDone(); return; }
  resetFlipCardToFront();
  learnFlipped = false;
  const { w } = learnQueue[learnIdx];

  document.getElementById('card-greek').textContent = w.greek || '-';
  document.getElementById('card-translation').textContent = w.translation;
  document.getElementById('card-example').textContent = w.example || '';

  const bname = 'Блок ' + (w.batch + 1);
  document.getElementById('card-batch-tag').textContent = bname;
  document.getElementById('card-batch-tag2').textContent = bname;

  const lvl = w.languageLevel || '';
  const badge = document.getElementById('card-level-badge');
  badge.textContent = lvl;
  badge.className = 'card-level-badge' + (lvl ? ' card-level-' + lvl : '');

  const total = learnQueue.length;
  document.getElementById('learn-progress-bar').style.width = Math.round(learnIdx / total * 100) + '%';
  document.getElementById('learn-progress-label').textContent = (learnIdx + 1) + ' / ' + total;
  document.getElementById('btn-prev').disabled = learnIdx === 0;
  document.getElementById('btn-next').disabled = learnIdx >= learnQueue.length - 1;
}

function flipCard() {
  const fc = document.getElementById('flip-card');
  if (!learnFlipped) { fc.classList.add('flipped'); learnFlipped = true; }
  else { fc.classList.remove('flipped'); learnFlipped = false; }
}

function prevCard() { if (learnIdx > 0) { learnIdx--; showLearnCard(); } }
function nextCard() { if (learnIdx < learnQueue.length) { learnIdx++; showLearnCard(); } }

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

// ===== QUIZ =====
let quizPool = [], quizCurrent = null, quizCorrectCount = 0, quizTotalCount = 0, quizAnswered = false;

function resetQuizUiState() {
  quizPool = []; quizCurrent = null; quizAnswered = false;
  quizCorrectCount = 0; quizTotalCount = 0;
  document.getElementById('quiz-correct').textContent = 0;
  document.getElementById('quiz-total').textContent = 0;
  document.getElementById('quiz-q-text').textContent = 'Нажмите «Начать тест»';
  document.getElementById('quiz-q-sub').textContent = '';
  document.getElementById('quiz-options').innerHTML = '';
  document.getElementById('next-btn-wrap').style.display = 'none';
  document.getElementById('quiz-giveup-wrap').style.display = 'none';
}

function startQuiz() {
  const bval = parseInt(document.getElementById('quiz-batch').value);
  const excludeKnown = document.getElementById('quiz-exclude-known').checked;
  const visibleWords = getVisibleWords();
  let pool = bval === -2 ? [...visibleWords] : visibleWords.filter(w => w.batch === bval);
  if (excludeKnown) {
    const progress = loadProgress();
    pool = pool.filter(w => getCategory(progress[WORDS.indexOf(w)]) < 2);
  }
  if (pool.length < 2) { alert('Недостаточно слов для теста.'); return; }
  quizPool = [...pool].sort(() => Math.random() - .5);
  quizCorrectCount = 0; quizTotalCount = 0; quizAnswered = false;
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
  const correctKey = WORDS.indexOf(correct);

  const visibleWords = getVisibleWords();
  const wrongs = visibleWords.filter(w => w !== correct).sort(() => Math.random() - .5).slice(0, 3);
  const options = [correct, ...wrongs].sort(() => Math.random() - .5);

  const modeLabel = document.getElementById('quiz-mode-label');
  const qText = document.getElementById('quiz-q-text');
  const qSub = document.getElementById('quiz-q-sub');
  const optContainer = document.getElementById('quiz-options');

  if (mode === 'gr-ru') {
    modeLabel.textContent = 'Переведи на русский:';
    qText.textContent = correct.greek;
    qSub.innerHTML = `<details class="quiz-spoiler"><summary>Показать пример (спойлер)</summary><div class="quiz-example-text">${escapeHtml(correct.example || '')}</div></details>`;
    optContainer.innerHTML = options.map(o =>
      `<button class="quiz-option" data-key="${WORDS.indexOf(o)}" onclick="checkAnswer(this, ${WORDS.indexOf(o)}, ${correctKey})">${escapeHtml(o.translation)}</button>`
    ).join('');
  } else {
    modeLabel.textContent = 'Выбери греческое наречие:';
    qText.textContent = correct.translation;
    qSub.innerHTML = `<details class="quiz-spoiler"><summary>Показать пример (спойлер)</summary><div class="quiz-example-text">${escapeHtml(correct.example || '')}</div></details>`;
    optContainer.innerHTML = options.map(o => {
      const key = WORDS.indexOf(o);
      return `<button class="quiz-option" data-key="${key}" onclick="checkAnswer(this, ${key}, ${correctKey})">${escapeHtml(o.greek)}</button>`;
    }).join('');
  }
}

function checkAnswer(btn, chosenKey, correctKey) {
  if (quizAnswered) return;
  quizAnswered = true; quizTotalCount++;
  document.querySelectorAll('.quiz-option').forEach(b => b.disabled = true);
  const isCorrect = chosenKey === correctKey;
  if (isCorrect) { btn.classList.add('correct'); quizCorrectCount++; }
  else {
    btn.classList.add('wrong');
    document.querySelector(`.quiz-option[data-key="${correctKey}"]`)?.classList.add('correct');
  }
  updateQuizSR(correctKey, isCorrect);
  document.getElementById('quiz-correct').textContent = quizCorrectCount;
  document.getElementById('quiz-total').textContent = quizTotalCount;
  document.getElementById('next-btn-wrap').style.display = '';
}

function giveUp() {
  if (quizAnswered) return;
  quizAnswered = true; quizTotalCount++;
  document.querySelectorAll('.quiz-option').forEach(b => b.disabled = true);
  const correctKey = WORDS.indexOf(quizCurrent);
  document.querySelector(`.quiz-option[data-key="${correctKey}"]`)?.classList.add('correct');
  let progress = loadProgress();
  let p = progress[correctKey] || { interval: 1, ef: 2.5, nextReview: Date.now(), seen: false };
  p.seen = false; p.interval = 1; p.ef = Math.max(1.3, p.ef - 0.2); p.nextReview = Date.now() + 86400000;
  progress[correctKey] = p; saveProgress(progress); quizStreaks[correctKey] = 0;
  document.getElementById('quiz-total').textContent = quizTotalCount;
  document.getElementById('quiz-giveup-wrap').style.display = 'none';
  document.getElementById('next-btn-wrap').style.display = '';
}

// ===== PROGRESS PAGE =====
function updateProgressPage() {
  const progress = loadProgress();
  const visibleWords = getVisibleWords();
  let known = 0, learning = 0, neww = 0;
  visibleWords.forEach(w => {
    const p = progress[WORDS.indexOf(w)];
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
    const bWords = visibleWords.filter(w => w.batch === b);
    if (!bWords.length) continue;
    const bKnown = bWords.filter(w => { const p = progress[WORDS.indexOf(w)]; return p && p.seen && p.interval >= 3; }).length;
    const pct = Math.round(bKnown / bWords.length * 100);

    const wordRows = bWords.map(w => {
      const p = progress[WORDS.indexOf(w)];
      const cat = getCategory(p);
      const [icon, label, cls] = cat === 2 ? ['✓', 'знаю', 'verb-status-known'] : cat === 1 ? ['~', 'смутно', 'verb-status-learning'] : ['✕', 'не знаю', 'verb-status-new'];
      return `<div class="word-status-row">
        <span class="word-status-badge ${cls}">${icon} ${label}</span>
        <span class="word-status-main">${escapeHtml(w.greek)}</span>
        <span class="word-status-translation">${escapeHtml(w.translation)}</span>
      </div>`;
    }).join('');

    batchList.innerHTML += `
      <details class="batch-row-details">
        <summary class="batch-row-header">
          <div class="batch-row-left">
            <span class="batch-row-arrow">▶</span>
            <span class="batch-row-name">Блок ${b + 1}: ${escapeHtml(BATCH_NAMES[b])}</span>
          </div>
          <div class="batch-row-right">
            <span class="batch-row-pct">${bKnown}/${bWords.length} (${pct}%)</span>
            <button class="btn-reset-batch" onclick="event.preventDefault();event.stopPropagation();resetBatchProgress(${b})">Сбросить блок</button>
          </div>
        </summary>
        <div class="mini-bar" style="margin:0 0 10px"><div class="mini-bar-fill" style="width:${pct}%"></div></div>
        <div class="word-status-list">${wordRows}</div>
      </details>`;
  }
}

function resetBatchProgress(batchId) {
  if (!confirm('Сбросить прогресс только для этого блока?')) return;
  const progress = loadProgress();
  const visibleWords = getVisibleWords();
  WORDS.forEach((w, i) => { if (w.batch === batchId && visibleWords.includes(w)) { delete progress[i]; quizStreaks[i] = 0; } });
  saveProgress(progress);
  updateProgressPage();
}

function resetAll() {
  if (confirm('Сбросить весь прогресс по наречиям?')) {
    localStorage.removeItem(PROG_KEY);
    updateProgressPage();
  }
}

// ===== EXPOSE GLOBALS =====
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
window.giveUp = giveUp;
window.resetBatchProgress = resetBatchProgress;
window.resetAll = resetAll;
window.onLanguageLevelChange = onLanguageLevelChange;

// ===== INIT =====
initLanguageLevelControl();
renderBatchOptions();
renderPlanTable();
resetLearn();
resetQuizUiState();

  })
  .catch(err => console.error('Failed to load adverbs-data.json:', err));
