const LANGUAGE_LEVEL_KEY = 'gr_language_level';
const PLANS_KEY = 'gr_learning_plans';
const USED_WORD_IDS_KEY = 'gr_learning_used_word_ids';
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const LEVEL_RANK = Object.fromEntries(LEVELS.map((level, index) => [level, index]));
const SOURCE_FILES = [
  ['adjective', '../../resources/adjectives-data.json'],
  ['adverb', '../../resources/adverbs-data.json'],
  ['linking', '../../resources/intro-and-linkings-data.json'],
  ['noun', '../../resources/nouns-data.json'],
  ['verb', '../../resources/verbs-data.json']
];
const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30];

let currentLevel = 'C1';
let wordPool = [];
let currentPlanId = null;
let currentStudyQuestion = null;
let currentStudyOptions = [];
let reviewQueue = [];
let currentReviewQuestion = null;
let currentReviewOptions = [];
let reviewStats = { correct: 0, wrong: 0 };

function normalizeLevel(level) {
  const value = String(level || '').trim().toUpperCase();
  return LEVELS.includes(value) ? value : 'C1';
}

function loadPlans() {
  try { return JSON.parse(localStorage.getItem(PLANS_KEY) || '[]'); } catch { return []; }
}

function savePlans(plans) { localStorage.setItem(PLANS_KEY, JSON.stringify(plans)); }

function loadUsedWordIds() {
  try { return new Set(JSON.parse(localStorage.getItem(USED_WORD_IDS_KEY) || '[]')); } catch { return new Set(); }
}

function saveUsedWordIds(ids) { localStorage.setItem(USED_WORD_IDS_KEY, JSON.stringify([...ids])); }

function joinForms(word, fields) {
  return fields.map(field => word[field]).filter(value => value && value !== '-').join(' / ');
}

function normalizeWord(type, word) {
  const greek = type === 'verb' ? joinForms(word, ['present', 'future', 'past'])
    : (type === 'noun' || type === 'adjective') ? joinForms(word, ['male', 'female', 'neuter'])
      : word.greek;
  const key = String(greek || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return { id: key, type, greek, translation: word.translation || '', example: word.example || '', languageLevel: normalizeLevel(word.languageLevel) };
}

function isAvailableForLevel(word, level = currentLevel) { return LEVEL_RANK[word.languageLevel] <= LEVEL_RANK[level]; }

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}

function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA').format(date);
}

function planTitle(plan) { return `${plan.date} · План ${plan.index}`; }

function reviewIntervalMs(reviewCount = 0) {
  return REVIEW_INTERVAL_DAYS[Math.min(reviewCount, REVIEW_INTERVAL_DAYS.length - 1)] * 86400000;
}

function refreshReviewStatus(plan, now = Date.now()) {
  if (plan.status !== 'completed' || !plan.completedAt) {
    plan.needsReview = false;
    return false;
  }
  plan.needsReview = new Date(plan.completedAt).getTime() + reviewIntervalMs(plan.reviewCount) <= now;
  return plan.needsReview;
}

function refreshAllReviewStatuses() {
  const plans = loadPlans();
  let changed = false;
  plans.forEach(plan => {
    const before = plan.needsReview;
    refreshReviewStatus(plan);
    if (plan.needsReview !== before) changed = true;
  });
  if (changed) savePlans(plans);
  return plans;
}

function getStudyProgress(plan, wordId) {
  plan.studyProgress ||= {};
  plan.studyProgress[wordId] ||= { grRu: 0, ruGr: 0 };
  return plan.studyProgress[wordId];
}

function savePlan(plan) {
  savePlans(loadPlans().map(item => item.id === plan.id ? plan : item));
}

function renderPlans() {
  const plans = refreshAllReviewStatuses().sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const body = document.getElementById('plans-table-body');
  const empty = document.getElementById('plans-empty');
  body.innerHTML = plans.map(plan => `<tr class="plan-row" onclick="openPlan('${plan.id}')">
    <td>${planTitle(plan)}</td><td>${plan.languageLevel}</td><td>${plan.words.length}</td>
    <td><span class="status ${plan.status === 'completed' ? 'status-complete' : 'status-progress'}">${plan.status === 'completed' ? 'Завершён' : 'В процессе'}</span></td>
    <td>${plan.needsReview ? '<span class="review-alert" title="Стоит повторить">!</span>' : ''}</td>
    <td><button class="delete-plan" onclick="deletePlan(event, '${plan.id}')" title="Удалить">Удалить</button></td>
  </tr>`).join('');
  empty.hidden = plans.length > 0;
}

function openPlanConfig() {
  const modal = document.getElementById('plan-config-modal');
  document.getElementById('plan-level-select').value = currentLevel;
  document.querySelector('input[name="plan-size"][value="20"]').checked = true;
  document.getElementById('custom-plan-size').value = 20;
  document.getElementById('custom-plan-size').disabled = true;
  modal.hidden = false;
  updatePlanConfigNote();
}

function closePlanConfig() { document.getElementById('plan-config-modal').hidden = true; }

function selectedPlanSize() {
  const value = document.querySelector('input[name="plan-size"]:checked').value;
  return value === 'custom' ? Number(document.getElementById('custom-plan-size').value) : Number(value);
}

function updatePlanConfigNote() {
  const level = normalizeLevel(document.getElementById('plan-level-select').value);
  const size = selectedPlanSize();
  const available = wordPool.filter(word => isAvailableForLevel(word, level) && !loadUsedWordIds().has(word.id)).length;
  document.getElementById('plan-config-note').textContent = Number.isInteger(size) && size > 0
    ? `Доступно новых слов: ${available}. В план войдёт: ${size}.`
    : `Доступно новых слов: ${available}. Укажите количество слов.`;
}

function confirmPlanConfig() {
  const size = selectedPlanSize();
  const level = normalizeLevel(document.getElementById('plan-level-select').value);
  if (!Number.isInteger(size) || size < 1 || size > 100) {
    alert('Укажите количество слов от 1 до 100.');
    return;
  }
  closePlanConfig();
  createPlan(size, level);
}

function createPlan(size, level) {
  const plans = loadPlans();
  const date = localDate();
  const todayPlans = plans.filter(plan => plan.date === date);
  if (todayPlans.length && !confirm('Сегодня уже есть созданный план. Создать ещё один?')) return;

  const usedIds = loadUsedWordIds();
  const candidates = wordPool.filter(word => isAvailableForLevel(word, level) && !usedIds.has(word.id));
  if (candidates.length < size) {
    alert(`Для уровня ${level} осталось только ${candidates.length} новых слов. Для нового плана нужно ${size}.`);
    return;
  }
  const words = shuffle(candidates).slice(0, size);
  const plan = {
    id: `${date}-${todayPlans.length + 1}-${Date.now()}`,
    date,
    index: todayPlans.length + 1,
    createdAt: new Date().toISOString(),
    languageLevel: level,
    status: 'in-progress',
    needsReview: false,
    words
  };
  words.forEach(word => usedIds.add(word.id));
  saveUsedWordIds(usedIds);
  savePlans([...plans, plan]);
  renderPlans();
  openPlan(plan.id);
}

function deletePlan(event, id) {
  event.stopPropagation();
  if (!confirm('Удалить этот план? Его слова снова смогут попасть в новые планы.')) return;
  const remainingPlans = loadPlans().filter(plan => plan.id !== id);
  const reservedWordIds = new Set(remainingPlans.flatMap(plan => plan.words.map(word => word.id)));
  savePlans(remainingPlans);
  saveUsedWordIds(reservedWordIds);
  renderPlans();
}

function openPlan(id) {
  const plan = loadPlans().find(item => item.id === id);
  if (!plan) return;
  currentPlanId = id;
  currentStudyQuestion = null;
  document.getElementById('detail-title').textContent = planTitle(plan);
  document.getElementById('detail-meta').textContent = `Уровень ${plan.languageLevel} · ${plan.words.length} слов`;
  refreshReviewStatus(plan);
  document.getElementById('plan-review-reminder').hidden = !plan.needsReview;
  renderPlanWords(plan);
  renderStudy(plan);
  showPlanTab('words', document.querySelector('.plan-tab'));
  document.getElementById('plans-page').hidden = true;
  document.getElementById('detail-page').hidden = false;
  window.scrollTo(0, 0);
}

function renderPlanWords(plan) {
  document.getElementById('plan-words').innerHTML = plan.words.map((word, index) => {
    const progress = getStudyProgress(plan, word.id);
    return `<li><div class="greek">${escapeHtml(word.greek)}<span class="word-type">${word.type}</span></div>
      <div class="translation">${escapeHtml(word.translation)}</div>
      ${word.example ? `<div class="example">${escapeHtml(word.example)}</div>` : ''}
      <div class="word-progress"><span class="${progress.grRu === 3 ? 'mastered' : ''}">ГР → РУ: ${progress.grRu}/3</span><span class="${progress.ruGr === 3 ? 'mastered' : ''}">РУ → ГР: ${progress.ruGr}/3</span><button class="reset-word-progress" onclick="resetWordProgress(${index})" title="Сбросить прогресс слова" aria-label="Сбросить прогресс слова">↻</button></div></li>`;
  }).join('');
}

function resetWordProgress(index) {
  const plan = getCurrentPlan();
  const word = plan?.words[index];
  if (!word) return;
  plan.studyProgress ||= {};
  plan.studyProgress[word.id] = { grRu: 0, ruGr: 0 };
  plan.status = 'in-progress';
  plan.completedAt = null;
  plan.reviewCount = 0;
  plan.needsReview = false;
  savePlan(plan);
  renderPlanWords(plan);
  renderStudy(plan);
  renderPlans();
}

function showPlanTab(name, button) {
  document.querySelectorAll('.plan-tab').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.plan-tab-panel').forEach(panel => { panel.hidden = true; panel.classList.remove('active'); });
  button.classList.add('active');
  const panel = document.getElementById(`plan-tab-${name}`);
  panel.hidden = false;
  panel.classList.add('active');
  if (name === 'study') nextStudyQuestion();
  if (name === 'review') startReview();
}

function getCurrentPlan() { return loadPlans().find(plan => plan.id === currentPlanId); }

function countMastered(plan, direction) {
  return plan.words.filter(word => getStudyProgress(plan, word.id)[direction] === 3).length;
}

function isPlanComplete(plan) {
  return plan.words.every(word => {
    const progress = getStudyProgress(plan, word.id);
    return progress.grRu === 3 && progress.ruGr === 3;
  });
}

function renderStudy(plan) {
  const grRu = countMastered(plan, 'grRu');
  const ruGr = countMastered(plan, 'ruGr');
  document.getElementById('study-gr-ru-count').textContent = `${grRu}/${plan.words.length}`;
  document.getElementById('study-ru-gr-count').textContent = `${ruGr}/${plan.words.length}`;
  const completed = isPlanComplete(plan);
  document.getElementById('study-test').hidden = completed;
  document.getElementById('study-complete').hidden = !completed;
  if (completed && plan.status !== 'completed') {
    plan.status = 'completed';
    plan.completedAt = new Date().toISOString();
    plan.reviewCount = 0;
    plan.needsReview = false;
    savePlan(plan);
    renderPlans();
  }
}

function nextStudyQuestion() {
  const plan = getCurrentPlan();
  if (!plan) return;
  renderStudy(plan);
  if (isPlanComplete(plan)) return;
  const questions = plan.words.flatMap(word => {
    const progress = getStudyProgress(plan, word.id);
    return [
      ...(progress.grRu < 3 ? [{ word, direction: 'grRu' }] : []),
      ...(progress.ruGr < 3 ? [{ word, direction: 'ruGr' }] : [])
    ];
  });
  currentStudyQuestion = questions[Math.floor(Math.random() * questions.length)];
  const { word, direction } = currentStudyQuestion;
  const correctAnswer = direction === 'grRu' ? word.translation : word.greek;
  const candidates = [...plan.words, ...wordPool].filter(candidate => candidate.id !== word.id);
  const uniqueOptions = new Map();
  shuffle(candidates).forEach(candidate => {
    const value = direction === 'grRu' ? candidate.translation : candidate.greek;
    if (value && !uniqueOptions.has(value)) uniqueOptions.set(value, value);
  });
  currentStudyOptions = shuffle([correctAnswer, ...[...uniqueOptions.values()].slice(0, 3)]);
  document.getElementById('study-direction').textContent = direction === 'grRu' ? 'Греческий → русский' : 'Русский → греческий';
  document.getElementById('study-question').textContent = direction === 'grRu' ? word.greek : word.translation;
  const progress = getStudyProgress(plan, word.id);
  document.getElementById('study-streak').textContent = `Правильно подряд: ${progress[direction]}/3`;
  document.getElementById('study-example').innerHTML = word.example
    ? `<details><summary>Показать пример</summary><p>${escapeHtml(word.example)}</p></details>`
    : '';
  document.getElementById('study-options').innerHTML = currentStudyOptions.map((option, index) =>
    `<button class="study-option" onclick="selectStudyOption(${index})">${escapeHtml(option)}</button>`
  ).join('');
  document.getElementById('study-feedback').textContent = '';
  document.getElementById('study-feedback').className = 'study-feedback';
  document.getElementById('study-next-button').hidden = true;
}

function selectStudyOption(index) {
  if (!currentStudyQuestion) return;
  const { word, direction } = currentStudyQuestion;
  const plan = getCurrentPlan();
  const progress = getStudyProgress(plan, word.id);
  const expected = direction === 'grRu' ? word.translation : word.greek;
  const feedback = document.getElementById('study-feedback');
  const correct = currentStudyOptions[index] === expected;
  progress[direction] = correct ? Math.min(3, progress[direction] + 1) : 0;
  savePlan(plan);
  renderPlanWords(plan);
  renderStudy(plan);
  document.querySelectorAll('.study-option').forEach((option, optionIndex) => {
    option.disabled = true;
    if (currentStudyOptions[optionIndex] === expected) option.classList.add('correct');
    else if (optionIndex === index && !correct) option.classList.add('wrong');
  });
  feedback.textContent = correct ? `Верно: ${progress[direction]}/3 подряд.` : `Правильный ответ: ${expected}`;
  feedback.className = `study-feedback ${correct ? 'correct' : 'wrong'}`;
  if (!isPlanComplete(plan)) document.getElementById('study-next-button').hidden = false;
}

function buildQuizOptions(plan, word, direction) {
  const correctAnswer = direction === 'grRu' ? word.translation : word.greek;
  const candidates = [...plan.words, ...wordPool].filter(candidate => candidate.id !== word.id);
  const uniqueOptions = new Map();
  shuffle(candidates).forEach(candidate => {
    const value = direction === 'grRu' ? candidate.translation : candidate.greek;
    if (value && !uniqueOptions.has(value)) uniqueOptions.set(value, value);
  });
  return shuffle([correctAnswer, ...[...uniqueOptions.values()].slice(0, 3)]);
}

function startReview() {
  const plan = getCurrentPlan();
  if (!plan) return;
  if (plan.status !== 'completed') {
    document.getElementById('review-test').hidden = true;
    document.getElementById('review-complete').hidden = true;
    document.getElementById('review-unavailable').hidden = false;
    return;
  }
  document.getElementById('review-unavailable').hidden = true;
  reviewQueue = shuffle(plan.words.flatMap(word => [{ word, direction: 'grRu' }, { word, direction: 'ruGr' }]));
  reviewStats = { correct: 0, wrong: 0 };
  document.getElementById('review-test').hidden = false;
  document.getElementById('review-complete').hidden = true;
  nextReviewQuestion();
}

function nextReviewQuestion() {
  const plan = getCurrentPlan();
  if (!plan) return;
  if (reviewQueue.length === 0) {
    showReviewComplete(plan);
    return;
  }
  currentReviewQuestion = reviewQueue.shift();
  const { word, direction } = currentReviewQuestion;
  currentReviewOptions = buildQuizOptions(plan, word, direction);
  const completed = reviewStats.correct + reviewStats.wrong;
  const total = plan.words.length * 2;
  document.getElementById('review-progress').innerHTML = `Задание <strong>${completed + 1}/${total}</strong>`;
  document.getElementById('review-direction').textContent = direction === 'grRu' ? 'Греческий → русский' : 'Русский → греческий';
  document.getElementById('review-question').textContent = direction === 'grRu' ? word.greek : word.translation;
  document.getElementById('review-example').innerHTML = word.example
    ? `<details><summary>Показать пример</summary><p>${escapeHtml(word.example)}</p></details>`
    : '';
  document.getElementById('review-options').innerHTML = currentReviewOptions.map((option, index) =>
    `<button class="study-option" onclick="selectReviewOption(${index})">${escapeHtml(option)}</button>`
  ).join('');
  document.getElementById('review-feedback').textContent = '';
  document.getElementById('review-feedback').className = 'study-feedback';
  document.getElementById('review-next-button').hidden = true;
}

function selectReviewOption(index) {
  if (!currentReviewQuestion) return;
  const { word, direction } = currentReviewQuestion;
  const expected = direction === 'grRu' ? word.translation : word.greek;
  const correct = currentReviewOptions[index] === expected;
  reviewStats[correct ? 'correct' : 'wrong']++;
  document.querySelectorAll('#review-options .study-option').forEach((option, optionIndex) => {
    option.disabled = true;
    if (currentReviewOptions[optionIndex] === expected) option.classList.add('correct');
    else if (optionIndex === index && !correct) option.classList.add('wrong');
  });
  const feedback = document.getElementById('review-feedback');
  feedback.textContent = correct ? 'Верно.' : `Правильный ответ: ${expected}`;
  feedback.className = `study-feedback ${correct ? 'correct' : 'wrong'}`;
  if (reviewQueue.length === 0) showReviewComplete(getCurrentPlan());
  else document.getElementById('review-next-button').hidden = false;
}

function showReviewComplete(plan) {
  document.getElementById('review-test').hidden = true;
  document.getElementById('review-complete').hidden = false;
  document.getElementById('review-result').textContent = `Правильно: ${reviewStats.correct}. С ошибками: ${reviewStats.wrong}.`;
  document.getElementById('review-reset-button').hidden = reviewStats.wrong === 0;
  if (reviewStats.wrong === 0) {
    plan.completedAt = new Date().toISOString();
    plan.reviewCount = (plan.reviewCount || 0) + 1;
    plan.needsReview = false;
    savePlan(plan);
    document.getElementById('plan-review-reminder').hidden = true;
    renderPlans();
  }
}

function resetPlanLearning() {
  if (!confirm('Сбросить прогресс изучения этого плана и начать заново?')) return;
  const plan = getCurrentPlan();
  if (!plan) return;
  plan.studyProgress = {};
  plan.status = 'in-progress';
  plan.completedAt = null;
  plan.reviewCount = 0;
  plan.needsReview = false;
  savePlan(plan);
  renderPlanWords(plan);
  renderStudy(plan);
  renderPlans();
  showPlanTab('study', document.querySelectorAll('.plan-tab')[1]);
}

function showPlans() {
  document.getElementById('detail-page').hidden = true;
  document.getElementById('plans-page').hidden = false;
  renderPlans();
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function onLanguageLevelChange(level) {
  currentLevel = normalizeLevel(level);
  localStorage.setItem(LANGUAGE_LEVEL_KEY, currentLevel);
  document.getElementById('lang-level-select').value = currentLevel;
  updateAvailableWordsNote();
}

function updateAvailableWordsNote() {
  const reservedWordIds = loadUsedWordIds();
  const available = wordPool.filter(word => isAvailableForLevel(word) && !reservedWordIds.has(word.id)).length;
  document.getElementById('create-plan-note').textContent = wordPool.length
    ? `Доступно ${available} новых слов уровня ${currentLevel} и ниже.`
    : 'Загружаем источники слов…';
}

async function loadWords() {
  const responses = await Promise.all(SOURCE_FILES.map(async ([type, file]) => {
    const response = await fetch(file);
    if (!response.ok) throw new Error(`Не удалось загрузить ${file}`);
    const data = await response.json();
    return (data.batches || []).flatMap(batch => batch.words || []).map(word => normalizeWord(type, word));
  }));
  const unique = new Map();
  responses.flat().forEach(word => { if (word.greek && !unique.has(word.id)) unique.set(word.id, word); });
  wordPool = [...unique.values()];
  updateAvailableWordsNote();
}

window.createPlan = createPlan;
window.openPlanConfig = openPlanConfig;
window.closePlanConfig = closePlanConfig;
window.confirmPlanConfig = confirmPlanConfig;
window.deletePlan = deletePlan;
window.openPlan = openPlan;
window.showPlans = showPlans;
window.resetWordProgress = resetWordProgress;
window.showPlanTab = showPlanTab;
window.selectStudyOption = selectStudyOption;
window.nextStudyQuestion = nextStudyQuestion;
window.startReview = startReview;
window.nextReviewQuestion = nextReviewQuestion;
window.selectReviewOption = selectReviewOption;
window.resetPlanLearning = resetPlanLearning;
window.onLanguageLevelChange = onLanguageLevelChange;

currentLevel = normalizeLevel(localStorage.getItem(LANGUAGE_LEVEL_KEY));
document.getElementById('lang-level-select').value = currentLevel;
document.querySelectorAll('input[name="plan-size"]').forEach(input => input.addEventListener('change', () => {
  document.getElementById('custom-plan-size').disabled = input.value !== 'custom' || !input.checked;
  updatePlanConfigNote();
}));
document.getElementById('custom-plan-size').addEventListener('input', updatePlanConfigNote);
document.getElementById('plan-level-select').addEventListener('change', updatePlanConfigNote);
renderPlans();
loadWords().catch(error => {
  console.error(error);
  document.getElementById('create-plan-note').textContent = 'Не удалось загрузить источники слов.';
});