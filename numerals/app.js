fetch('data.json')
  .then(r => r.json())
  .then(DATA => {

const GROUPS  = DATA.groups;
const NUMBERS = GROUPS.flatMap(g => g.numbers.map(n => ({ ...n, groupId: g.id })));
const ORDINALS = DATA.ordinals;
const LANGUAGE_LEVEL_KEY = 'gr_language_level';
const LANGUAGE_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];

let currentLanguageLevel = 'C1';

function normalizeLanguageLevel(level) {
  const normalized = String(level || '').toUpperCase().trim();
  return LANGUAGE_LEVELS.includes(normalized) ? normalized : null;
}

function loadLanguageLevel() {
  const stored = normalizeLanguageLevel(localStorage.getItem(LANGUAGE_LEVEL_KEY));
  return stored || 'C1';
}

function onLanguageLevelChange(level) {
  currentLanguageLevel = normalizeLanguageLevel(level) || 'C1';
  localStorage.setItem(LANGUAGE_LEVEL_KEY, currentLanguageLevel);
  const select = document.getElementById('lang-level-select');
  if (select) select.value = currentLanguageLevel;
}

function initLanguageLevelControl() {
  currentLanguageLevel = loadLanguageLevel();
  const select = document.getElementById('lang-level-select');
  if (select) select.value = currentLanguageLevel;
}

// ===== HELPERS =====
function escapeHtml(s) {
  return String(s)
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'","&#39;");
}

// ===== PROGRESS =====
const PROG_KEY = 'gr_numerals_progress';

function loadProgress() { try { return JSON.parse(localStorage.getItem(PROG_KEY) || '{}'); } catch { return {}; } }
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

// ===== NAVIGATION =====
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const pages = ['plan', 'learn', 'quiz', 'ordinals', 'listening', 'progress'];
  const btns = document.querySelectorAll('nav button');
  btns[pages.indexOf(name)].classList.add('active');
  if (name === 'progress') updateProgressPage();
  if (name === 'ordinals' && !ordInitialized) { ordInitialized = true; showOrdCard(); }
}

function resetFlipCardToFront(cardId) {
  const card = document.getElementById(cardId);
  if (!card) return;
  card.classList.add('no-transition');
  card.classList.remove('flipped');
  void card.offsetWidth;
  requestAnimationFrame(() => card.classList.remove('no-transition'));
}

// ===== LISTENING PAGE =====
let listeningCurrent = null;
let speechVoiceCache = [];
let speechVoiceReady = false;
let listeningRangeMax = 99;

const greekOnes = ['μηδέν', 'ένα', 'δύο', 'τρία', 'τέσσερα', 'πέντε', 'έξι', 'επτά', 'οκτώ', 'εννέα', 'δέκα', 'έντεκα', 'δώδεκα', 'δεκατρία', 'δεκατέσσερα', 'δεκαπέντε', 'δεκαέξι', 'δεκαεπτά', 'δεκαοκτώ', 'δεκαεννέα'];
const greekTens = {
  20: 'είκοσι',
  30: 'τριάντα',
  40: 'σαράντα',
  50: 'πενήντα',
  60: 'εξήντα',
  70: 'εβδομήντα',
  80: 'ογδόντα',
  90: 'ενενήντα'
};
const greekHundreds = {
  100: 'εκατό',
  200: 'διακόσια',
  300: 'τριακόσια',
  400: 'τετρακόσια',
  500: 'πεντακόσια',
  600: 'εξακόσια',
  700: 'επτακόσια',
  800: 'οκτακόσια',
  900: 'εννιακόσια'
};

function selectListeningRange(maxValue) {
  listeningRangeMax = maxValue;
  document.querySelectorAll('.listening-range-option').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.max) === maxValue);
  });
}

function getGreekNumberWord(value) {
  const safeValue = Math.max(0, Math.floor(Number(value) || 0));
  const exact = NUMBERS.find(n => n.digit === safeValue);
  if (exact) return exact.greek;

  if (safeValue < 20) return greekOnes[safeValue] || String(safeValue);

  if (safeValue < 100) {
    const tens = Math.floor(safeValue / 10) * 10;
    const rem = safeValue % 10;
    const tensWord = greekTens[tens] || '';
    return rem ? `${tensWord} ${getGreekNumberWord(rem)}` : tensWord;
  }

  if (safeValue < 1000) {
    const hundreds = Math.floor(safeValue / 100) * 100;
    const rem = safeValue % 100;
    const hundredWord = greekHundreds[hundreds] || '';
    return rem ? `${hundredWord} ${getGreekNumberWord(rem)}` : hundredWord;
  }

  if (safeValue < 1000000) {
    const thousands = Math.floor(safeValue / 1000);
    const rem = safeValue % 1000;
    const thousandsWord = thousands === 1 ? 'χίλια' : `${getGreekNumberWord(thousands)} χιλιάδες`;
    return rem ? `${thousandsWord} ${getGreekNumberWord(rem)}` : thousandsWord;
  }

  if (safeValue < 1000000000) {
    const millions = Math.floor(safeValue / 1000000);
    const rem = safeValue % 1000000;
    const millionsWord = millions === 1 ? 'ένα εκατομμύριο' : `${getGreekNumberWord(millions)} εκατομμύρια`;
    return rem ? `${millionsWord} ${getGreekNumberWord(rem)}` : millionsWord;
  }

  const billions = Math.floor(safeValue / 1000000000);
  const rem = safeValue % 1000000000;
  const billionsWord = billions === 1 ? 'ένα δισεκατομμύριο' : `${getGreekNumberWord(billions)} δισεκατομμύρια`;
  return rem ? `${billionsWord} ${getGreekNumberWord(rem)}` : billionsWord;
}

function refreshSpeechVoices() {
  if (!('speechSynthesis' in window)) return [];
  const voices = window.speechSynthesis.getVoices() || [];
  speechVoiceCache = voices;
  speechVoiceReady = voices.length > 0;
  return speechVoiceCache;
}

function pickGreekVoice() {
  const voices = refreshSpeechVoices();
  const candidates = voices
    .map(voice => {
      const lang = String(voice.lang || '').toLowerCase();
      const name = String(voice.name || '').toLowerCase();
      let score = 0;
      if (lang.startsWith('el')) score += 100;
      if (lang.includes('el-gr') || lang.includes('el_gr')) score += 40;
      if (lang.includes('greek') || name.includes('greek')) score += 25;
      if (name.includes('ste') || name.includes('stefanos')) score += 15;
      if (name.includes('syl') || name.includes('sylvie')) score += 10;
      return { voice, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.voice || null;
}

function ensureSpeechVoices() {
  if (!('speechSynthesis' in window)) return Promise.resolve(null);
  if (speechVoiceReady) return Promise.resolve(pickGreekVoice());

  return new Promise(resolve => {
    const done = () => {
      refreshSpeechVoices();
      resolve(pickGreekVoice());
    };

    if (window.speechSynthesis.getVoices().length) {
      done();
      return;
    }

    window.speechSynthesis.onvoiceschanged = () => done();
    setTimeout(done, 1200);
  });
}

function speakGreekText(text) {
  if (!('speechSynthesis' in window)) return Promise.resolve(false);

  const normalized = String(text || '').trim();
  if (!normalized) return Promise.resolve(false);

  const speakNow = () => {
    try {
      window.speechSynthesis.cancel();
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      const utterance = new SpeechSynthesisUtterance(normalized);
      utterance.lang = 'el-GR';
      utterance.rate = 0.95;
      utterance.pitch = 1.0;
      utterance.volume = 1;
      utterance.onerror = () => {};
      const voice = pickGreekVoice();
      if (voice) utterance.voice = voice;
      window.speechSynthesis.speak(utterance);
      return true;
    } catch (err) {
      console.warn('Speech synthesis failed:', err);
      return false;
    }
  };

  if (!speechVoiceReady) {
    return ensureSpeechVoices().then(() => speakNow());
  }

  return Promise.resolve(speakNow());
}

function clearListeningAnswerState() {
  const input = document.getElementById('listening-answer-input');
  input.classList.remove('correct', 'wrong');
}

function generateListeningNumber() {
  const safeMax = Math.max(0, Math.floor(listeningRangeMax || 99));
  const digit = Math.floor(Math.random() * (safeMax + 1));
  listeningCurrent = {
    digit,
    greek: getGreekNumberWord(digit),
    transcription: ''
  };
  document.getElementById('listening-play-btn').disabled = false;
  const spoiler = document.getElementById('listening-number-spoiler');
  spoiler.style.display = '';
  spoiler.open = false;
  document.getElementById('listening-generated-number').textContent = String(listeningCurrent.digit);
  const answerWrap = document.getElementById('listening-answer-wrap');
  answerWrap.style.display = '';
  const input = document.getElementById('listening-answer-input');
  input.value = '';
  clearListeningAnswerState();
  input.focus();
  void speakGreekText(listeningCurrent.greek);
}

function playListeningNumber() {
  if (!listeningCurrent) return;
  void speakGreekText(listeningCurrent.greek);
}

function checkListeningAnswer() {
  if (!listeningCurrent) return;
  const input = document.getElementById('listening-answer-input');
  const value = input.value.trim();
  clearListeningAnswerState();
  const parsed = Number(value);
  const isValidNumber = value !== '' && Number.isFinite(parsed);
  const isCorrect = isValidNumber && parsed === listeningCurrent.digit;
  input.classList.add(isCorrect ? 'correct' : 'wrong');
}

// ===== PLAN PAGE =====
function renderPlanTable() {
  document.getElementById('plan-table-body').innerHTML = GROUPS.map((g, i) => `
    <tr class="plan-row" onclick="goToGroup(${g.id})" title="Учить: ${g.name}">
      <td><strong>${i + 1}</strong></td>
      <td class="batch-tag">${escapeHtml(g.name)}</td>
      <td>${g.numbers.length} чисел</td>
      <td style="color:var(--accent)">▶ Учить</td>
    </tr>
  `).join('');
}

function goToGroup(groupId) {
  document.getElementById('group-select').value = groupId;
  showPage('learn');
  resetLearn();
}

function renderGroupOptions() {
  const ls = document.getElementById('group-select');
  const qs = document.getElementById('quiz-group');
  GROUPS.forEach(g => {
    [ls, qs].forEach(sel => {
      const o = document.createElement('option');
      o.value = g.id; o.textContent = g.name;
      sel.appendChild(o);
    });
  });
}

// ===== LEARN PAGE =====
let learnQueue = [], learnIdx = 0, learnFlipped = false;
let learnStats = { known: 0, maybe: 0, unknown: 0 };

function getLearnQueue() {
  const val = parseInt(document.getElementById('group-select').value);
  const progress = loadProgress();
  const today = Date.now();
  let pool;
  if (val === -1) {
    pool = NUMBERS.filter((n, i) => {
      const p = progress[i];
      return !p || !p.seen || p.nextReview <= today;
    });
  } else if (val === -2) {
    pool = [...NUMBERS];
  } else {
    pool = NUMBERS.filter(n => n.groupId === val);
  }
  return pool.map(n => ({ n, origIdx: NUMBERS.indexOf(n) })).sort((a, b) => a.n.digit - b.n.digit);
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
  resetFlipCardToFront('flip-card');
  learnFlipped = false;
  const { n } = learnQueue[learnIdx];
  document.getElementById('card-digit').textContent = n.digit;
  document.getElementById('card-greek').textContent = n.greek;
  document.getElementById('card-transcription').textContent = n.transcription;
  const gname = GROUPS.find(g => g.id === n.groupId)?.name || '';
  document.getElementById('card-group-tag').textContent = gname;
  document.getElementById('card-group-tag2').textContent = gname;
  const total = learnQueue.length;
  document.getElementById('learn-progress-bar').style.width = Math.round(learnIdx / total * 100) + '%';
  document.getElementById('learn-progress-label').textContent = (learnIdx + 1) + ' / ' + total;
  document.getElementById('btn-prev').disabled = learnIdx === 0;
  document.getElementById('btn-next').disabled = learnIdx >= learnQueue.length - 1;
}

function flipCard() {
  learnFlipped = !learnFlipped;
  document.getElementById('flip-card').classList.toggle('flipped', learnFlipped);
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

// ===== QUIZ PAGE =====
let quizPool = [], quizCurrent = null, quizAnswered = false;
let quizCorrectCount = 0, quizTotalCount = 0;
const quizStreaks = {};

function updateQuizSR(idx, isCorrect) {
  let progress = loadProgress();
  let p = progress[idx] || { interval: 1, ef: 2.5, nextReview: Date.now(), seen: false };
  const cat = getCategory(p);
  if (!isCorrect) {
    quizStreaks[idx] = 0;
    if (cat === 2) { p.interval = 3; p.ef = Math.max(1.3, p.ef - 0.2); }
    else if (cat === 1) { p.interval = 1; p.seen = false; p.ef = Math.max(1.3, p.ef - 0.2); }
  } else {
    quizStreaks[idx] = (quizStreaks[idx] || 0) + 1;
    if (quizStreaks[idx] >= 2) {
      quizStreaks[idx] = 0;
      if (cat === 0) { p.seen = true; p.interval = 3; }
      else if (cat === 1) { p.interval = 7; p.ef = Math.min(3.0, p.ef + 0.1); }
    }
  }
  p.nextReview = Date.now() + p.interval * 86400000;
  progress[idx] = p;
  saveProgress(progress);
}

function startQuiz() {
  const gval = parseInt(document.getElementById('quiz-group').value);
  const excludeKnown = document.getElementById('quiz-exclude-known').checked;
  let pool = gval === -2 ? [...NUMBERS] : NUMBERS.filter(n => n.groupId === gval);
  if (excludeKnown) {
    const progress = loadProgress();
    pool = pool.filter(n => getCategory(progress[NUMBERS.indexOf(n)]) < 2);
  }
  if (pool.length < 1) { alert('Всё выучено — отличная работа!'); return; }
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
  const wrongs = NUMBERS.filter(n => n !== correct).sort(() => Math.random() - .5).slice(0, 3);
  const options = [correct, ...wrongs].sort(() => Math.random() - .5);

  document.getElementById('quiz-mode-label').textContent =
    mode === 'digit-to-greek' ? 'Выбери греческое слово:' : 'Выбери число:';
  document.getElementById('quiz-q-text').textContent =
    mode === 'digit-to-greek' ? correct.digit : correct.greek;
  document.getElementById('quiz-q-sub').textContent =
    mode === 'digit-to-greek' ? '' : correct.transcription;

  document.getElementById('quiz-options').innerHTML = options.map(o => {
    const display = mode === 'digit-to-greek'
      ? `${escapeHtml(o.greek)}<br><small style="color:var(--muted)">${escapeHtml(o.transcription)}</small>`
      : escapeHtml(String(o.digit));
    return `<button class="quiz-option" data-answer="${escapeHtml(o.greek)}"
      onclick="checkAnswer(this,'${o.greek.replace(/'/g,"&#39;")}','${correct.greek.replace(/'/g,"&#39;")}')">${display}</button>`;
  }).join('');
}

function checkAnswer(btn, chosen, correct) {
  if (quizAnswered) return;
  quizAnswered = true; quizTotalCount++;
  document.querySelectorAll('#page-quiz .quiz-option').forEach(b => b.disabled = true);
  const isCorrect = chosen === correct;
  if (isCorrect) { btn.classList.add('correct'); quizCorrectCount++; }
  else {
    btn.classList.add('wrong');
    const cb = Array.from(document.querySelectorAll('#page-quiz .quiz-option')).find(b => b.dataset.answer === correct);
    if (cb) cb.classList.add('correct');
  }
  updateQuizSR(NUMBERS.indexOf(quizCurrent), isCorrect);
  document.getElementById('quiz-correct').textContent = quizCorrectCount;
  document.getElementById('quiz-total').textContent = quizTotalCount;
  document.getElementById('quiz-giveup-wrap').style.display = 'none';
  document.getElementById('next-btn-wrap').style.display = '';
}

function giveUp() {
  if (quizAnswered) return;
  quizAnswered = true; quizTotalCount++;
  document.querySelectorAll('#page-quiz .quiz-option').forEach(b => b.disabled = true);
  const cb = Array.from(document.querySelectorAll('#page-quiz .quiz-option')).find(b => b.dataset.answer === quizCurrent.greek);
  if (cb) cb.classList.add('correct');
  const idx = NUMBERS.indexOf(quizCurrent);
  let progress = loadProgress();
  let p = progress[idx] || { interval: 1, ef: 2.5, nextReview: Date.now(), seen: false };
  p.seen = false; p.interval = 1; p.ef = Math.max(1.3, p.ef - 0.2);
  p.nextReview = Date.now() + 86400000;
  progress[idx] = p; saveProgress(progress); quizStreaks[idx] = 0;
  document.getElementById('quiz-total').textContent = quizTotalCount;
  document.getElementById('quiz-giveup-wrap').style.display = 'none';
  document.getElementById('next-btn-wrap').style.display = '';
}

// ===== ORDINALS PAGE =====
let ordIdx = 0, ordFlipped = false, ordInitialized = false;
let ordQuizPool = [], ordQuizAnswered = false;
let ordQuizCorrect = 0, ordQuizTotal = 0;

function showOrdCard() {
  resetFlipCardToFront('ord-flip-card');
  ordFlipped = false;
  const ord = ORDINALS[ordIdx];
  document.getElementById('ord-front-label').textContent = ord.label;
  document.getElementById('ord-back-forms').textContent = ord.male + ' / ' + ord.female + ' / ' + ord.neuter;
  document.getElementById('ord-back-transcription').textContent = ord.transcription;
  document.getElementById('ord-counter').textContent = (ordIdx + 1) + ' / ' + ORDINALS.length;
  document.getElementById('ord-btn-prev').disabled = ordIdx === 0;
  document.getElementById('ord-btn-next').disabled = ordIdx >= ORDINALS.length - 1;
}

function flipOrdCard() {
  ordFlipped = !ordFlipped;
  document.getElementById('ord-flip-card').classList.toggle('flipped', ordFlipped);
}

function prevOrd() { if (ordIdx > 0) { ordIdx--; showOrdCard(); } }
function nextOrd() { if (ordIdx < ORDINALS.length - 1) { ordIdx++; showOrdCard(); } }

function startOrdQuiz() {
  ordQuizPool = [...ORDINALS].sort(() => Math.random() - .5);
  ordQuizCorrect = 0; ordQuizTotal = 0; ordQuizAnswered = false;
  document.getElementById('ord-quiz-correct').textContent = 0;
  document.getElementById('ord-quiz-total').textContent = 0;
  nextOrdQuestion();
}

function nextOrdQuestion() {
  if (ordQuizPool.length === 0) {
    document.getElementById('ord-quiz-q-text').textContent = '🎉 Готово!';
    document.getElementById('ord-quiz-q-sub').textContent = 'Результат: ' + ordQuizCorrect + ' / ' + ordQuizTotal;
    document.getElementById('ord-quiz-options').innerHTML = '<button class="btn-primary" onclick="startOrdQuiz()" style="margin:10px auto;display:block">Ещё раз</button>';
    document.getElementById('ord-next-wrap').style.display = 'none';
    return;
  }
  ordQuizAnswered = false;
  document.getElementById('ord-next-wrap').style.display = 'none';
  const correct = ordQuizPool.shift();
  const wrongs = ORDINALS.filter(o => o !== correct).sort(() => Math.random() - .5).slice(0, 3);
  const options = [correct, ...wrongs].sort(() => Math.random() - .5);
  document.getElementById('ord-quiz-q-text').textContent = correct.label;
  document.getElementById('ord-quiz-q-sub').textContent = '';
  document.getElementById('ord-quiz-options').innerHTML = options.map(o =>
    `<button class="quiz-option" data-answer="${escapeHtml(o.male)}"
      onclick="checkOrdAnswer(this,'${o.male.replace(/'/g,"&#39;")}','${correct.male.replace(/'/g,"&#39;")}')">${escapeHtml(o.male)}</button>`
  ).join('');
}

function checkOrdAnswer(btn, chosen, correct) {
  if (ordQuizAnswered) return;
  ordQuizAnswered = true; ordQuizTotal++;
  document.querySelectorAll('#page-ordinals .quiz-option').forEach(b => b.disabled = true);
  const isCorrect = chosen === correct;
  if (isCorrect) { btn.classList.add('correct'); ordQuizCorrect++; }
  else {
    btn.classList.add('wrong');
    const cb = Array.from(document.querySelectorAll('#page-ordinals .quiz-option')).find(b => b.dataset.answer === correct);
    if (cb) cb.classList.add('correct');
  }
  document.getElementById('ord-quiz-correct').textContent = ordQuizCorrect;
  document.getElementById('ord-quiz-total').textContent = ordQuizTotal;
  document.getElementById('ord-next-wrap').style.display = '';
}

// ===== PROGRESS PAGE =====
function updateProgressPage() {
  const progress = loadProgress();
  let known = 0, learning = 0, neww = 0;
  NUMBERS.forEach((n, i) => {
    const p = progress[i];
    if (!p || !p.seen) neww++;
    else if (p.interval >= 7) known++;
    else learning++;
  });
  document.getElementById('stat-known').textContent = known;
  document.getElementById('stat-learning').textContent = learning;
  document.getElementById('stat-new').textContent = neww;

  const list = document.getElementById('batch-progress-list');
  list.innerHTML = '';
  for (const g of GROUPS) {
    const gNums = NUMBERS.filter(n => n.groupId === g.id);
    const total = gNums.length;
    const done = gNums.filter(n => { const p = progress[NUMBERS.indexOf(n)]; return p && p.seen && p.interval >= 3; }).length;
    const pct = Math.round(done / total * 100);
    const rows = gNums.map(n => {
      const p = progress[NUMBERS.indexOf(n)];
      const cat = getCategory(p);
      const [icon, label, cls] = cat === 2
        ? ['✓', 'знаю', 'verb-status-known']
        : cat === 1
        ? ['~', 'смутно', 'verb-status-learning']
        : ['✕', 'не знаю', 'verb-status-new'];
      return `<div class="verb-status-row">
        <span class="verb-status-badge ${cls}">${icon} ${label}</span>
        <span class="verb-status-present">${escapeHtml(String(n.digit))}</span>
        <span class="verb-status-translation">${escapeHtml(n.greek)}</span>
      </div>`;
    }).join('');
    list.innerHTML += `
      <details class="batch-row-details">
        <summary class="batch-row-header">
          <div class="batch-row-left">
            <span class="batch-row-arrow">▶</span>
            <span class="batch-row-name">${escapeHtml(g.name)}</span>
          </div>
          <div class="batch-row-right">
            <span class="batch-row-pct">${done}/${total} (${pct}%)</span>
            <button class="btn-reset-batch" onclick="event.preventDefault();event.stopPropagation();resetGroupProgress(${g.id})">Сбросить</button>
          </div>
        </summary>
        <div class="mini-bar" style="margin:0 0 10px"><div class="mini-bar-fill" style="width:${pct}%"></div></div>
        <div class="verb-status-list">${rows}</div>
      </details>`;
  }
}

function resetGroupProgress(groupId) {
  if (!confirm('Сбросить прогресс для этой группы?')) return;
  const progress = loadProgress();
  NUMBERS.forEach((n, i) => { if (n.groupId === groupId) delete progress[i]; });
  saveProgress(progress);
  updateProgressPage();
}

function resetAll() {
  if (confirm('Сбросить весь прогресс числительных?')) {
    localStorage.removeItem(PROG_KEY);
    updateProgressPage();
  }
}

// ===== EXPOSE =====
window.showPage = showPage;
window.goToGroup = goToGroup;
window.resetLearn = resetLearn;
window.flipCard = flipCard;
window.prevCard = prevCard;
window.nextCard = nextCard;
window.rate = rate;
window.startQuiz = startQuiz;
window.nextQuizQuestion = nextQuizQuestion;
window.checkAnswer = checkAnswer;
window.giveUp = giveUp;
window.flipOrdCard = flipOrdCard;
window.prevOrd = prevOrd;
window.nextOrd = nextOrd;
window.startOrdQuiz = startOrdQuiz;
window.nextOrdQuestion = nextOrdQuestion;
window.checkOrdAnswer = checkOrdAnswer;
window.resetGroupProgress = resetGroupProgress;
window.resetAll = resetAll;
window.onLanguageLevelChange = onLanguageLevelChange;
window.selectListeningRange = selectListeningRange;
window.generateListeningNumber = generateListeningNumber;
window.playListeningNumber = playListeningNumber;
window.checkListeningAnswer = checkListeningAnswer;

// ===== INIT =====
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = refreshSpeechVoices;
  refreshSpeechVoices();
}

initLanguageLevelControl();
renderGroupOptions();
renderPlanTable();
resetLearn();

  })
  .catch(err => console.error('Failed to load data.json:', err));
