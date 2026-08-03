fetch('data.json')
  .then(r => r.json())
  .then(TRAINER_DATA => {

const BATCHES = TRAINER_DATA.batches;
const VERBS = BATCHES.flatMap(batch => batch.verbs.map(v => ({ ...v, batch: Number(batch.batchId) })));
const BATCH_NAMES = BATCHES.map(batch => batch.batchName);

function renderBatchOptions() {
  const learnSelect = document.getElementById('batch-select');
  const quizSelect = document.getElementById('quiz-batch');

  BATCHES.forEach(batch => {
    const optLearn = document.createElement('option');
    optLearn.value = batch.batchId;
    optLearn.textContent = batch.batchHeader;
    learnSelect.appendChild(optLearn);

    const optQuiz = document.createElement('option');
    optQuiz.value = batch.batchId;
    optQuiz.textContent = batch.batchHeader;
    quizSelect.appendChild(optQuiz);
  });
}

function renderPlanTable() {
  const tbody = document.getElementById('plan-table-body');
  tbody.innerHTML = BATCHES.map((batch, idx) => `
    <tr>
      <td><strong>День ${idx + 1}</strong></td>
      <td class="batch-tag">Блок ${idx + 1}</td>
      <td>${batch.batchName}</td>
      <td>${batch.verbs.length} глаголов</td>
      <td>Карточки → Тест</td>
    </tr>
  `).join('');
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
    p.interval = Math.round(p.interval * p.ef);
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

// ===== LEARN PAGE =====
let learnQueue = [];
let learnIdx = 0;
let learnFlipped = false;
let learnStats = { known: 0, maybe: 0, unknown: 0 };

function getLearnQueue() {
  const val = parseInt(document.getElementById('batch-select').value);
  const progress = loadProgress();
  const today = Date.now();
  let pool;
  if (val === -1) {
    // Due for review today
    pool = VERBS.filter((v, i) => {
      const p = progress[i];
      if (!p || !p.seen) return true; // new = due
      return p.nextReview <= today;
    });
  } else if (val === -2) {
    pool = [...VERBS];
  } else {
    pool = VERBS.filter(v => v.batch === val);
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
  const item = learnQueue[learnIdx];
  const v = item.v;
  document.getElementById('card-present').textContent = v.present;
  document.getElementById('card-forms').textContent = v.future + ' / ' + v.past;
  document.getElementById('card-translation').textContent = v.translation;
  document.getElementById('card-example').textContent = v.example;
  const bname = 'Блок ' + (v.batch + 1);
  document.getElementById('card-batch-tag').textContent = bname;
  document.getElementById('card-batch-tag2').textContent = bname;
  
  const fc = document.getElementById('flip-card');
  fc.classList.remove('flipped');
  learnFlipped = false;
  setRatingEnabled(false);
  
  const total = learnQueue.length;
  const pct = Math.round(learnIdx / total * 100);
  document.getElementById('learn-progress-bar').style.width = pct + '%';
  document.getElementById('learn-progress-label').textContent = learnIdx + ' / ' + total;
}

function flipCard() {
  const fc = document.getElementById('flip-card');
  if (!learnFlipped) {
    fc.classList.add('flipped');
    learnFlipped = true;
    setRatingEnabled(true);
  } else {
    fc.classList.remove('flipped');
    learnFlipped = false;
    setRatingEnabled(false);
  }
}

function setRatingEnabled(en) {
  ['btn-no','btn-maybe','btn-yes'].forEach(id => document.getElementById(id).disabled = !en);
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
  quizPool = bval === -2 ? [...VERBS] : VERBS.filter(v => v.batch === bval);
  if (quizPool.length < 4) { alert('Нужно минимум 4 глагола для теста. Выберите другой блок.'); return; }
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
    return;
  }
  quizAnswered = false;
  document.getElementById('next-btn-wrap').style.display = 'none';
  const mode = document.getElementById('quiz-mode').value;
  const correct = quizPool.shift();
  quizCurrent = correct;
  
  // Get 3 wrong options
  const wrongPool = VERBS.filter(v => v !== correct);
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
  document.getElementById('quiz-correct').textContent = quizCorrectCount;
  document.getElementById('quiz-total').textContent = quizTotalCount;
  document.getElementById('next-btn-wrap').style.display = '';
}

// ===== PROGRESS PAGE =====
function updateProgressPage() {
  const progress = loadProgress();
  let known = 0, learning = 0, neww = 0;
  VERBS.forEach((v, i) => {
    const p = progress[i];
    if (!p || !p.seen) neww++;
    else if (p.interval >= 7) known++;
    else learning++;
  });
  document.getElementById('stat-known').textContent = known;
  document.getElementById('stat-learning').textContent = learning;
  document.getElementById('stat-new').textContent = neww;
  
  const today = Date.now();
  const batchList = document.getElementById('batch-progress-list');
  batchList.innerHTML = '';
  for (let b = 0; b < BATCHES.length; b++) {
    const bVerbs = VERBS.filter((v, i) => v.batch === b);
    const bTotal = bVerbs.length;
    const bKnown = bVerbs.filter((v, i) => {
      const origIdx = VERBS.indexOf(v);
      const p = progress[origIdx];
      return p && p.seen && p.interval >= 3;
    }).length;
    const pct = Math.round(bKnown / bTotal * 100);
    batchList.innerHTML += `
      <div class="batch-row">
        <div class="batch-row-header">
          <span class="batch-row-name">Блок ${b+1}: ${BATCH_NAMES[b]}</span>
          <span class="batch-row-pct">${bKnown}/${bTotal} (${pct}%)</span>
        </div>
        <div class="mini-bar"><div class="mini-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
  }
}

function resetAll() {
  if (confirm('Сбросить весь прогресс? Это удалит все данные об изученных словах.')) {
    localStorage.removeItem('gr_progress');
    updateProgressPage();
  }
}

// Init
renderBatchOptions();
renderPlanTable();
resetLearn();

  })
  .catch(err => console.error('Failed to load data.json:', err));
