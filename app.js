const LANGUAGE_LEVEL_KEY = 'gr_language_level';
const LEARNING_PLANS_KEY = 'gr_learning_plans';
const LANGUAGE_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const LEVEL_RANK = { A1: 0, A2: 1, B1: 2, B2: 3, C1: 4 };

let verbsData = null;
let numeralsData = null;
let introLinkingsData = null;
let nounsData = null;
let adjectivesData = null;
let adverbsData = null;

function normalizeLanguageLevel(level) {
  const normalized = String(level || '').toUpperCase().trim();
  return LANGUAGE_LEVELS.includes(normalized) ? normalized : null;
}

function isVisibleByLanguageLevel(itemLevel, selectedLevel) {
  const normalizedItemLevel = normalizeLanguageLevel(itemLevel);
  const normalizedSelectedLevel = normalizeLanguageLevel(selectedLevel) || 'C1';
  if (!normalizedItemLevel) return true;
  return LEVEL_RANK[normalizedItemLevel] <= LEVEL_RANK[normalizedSelectedLevel];
}

function setCount(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function updateCategoryCounts() {
  const level = normalizeLanguageLevel(localStorage.getItem(LANGUAGE_LEVEL_KEY)) || 'C1';
  const visible = words => words.filter(w => isVisibleByLanguageLevel(w.languageLevel, level)).length;

  const batchSources = [
    { data: verbsData,         id: 'count-verbs' },
    { data: introLinkingsData, id: 'count-intro-linkings' },
    { data: adverbsData,       id: 'count-adverbs' },
    { data: adjectivesData,    id: 'count-adjectives' },
    { data: nounsData,         id: 'count-nouns' },
  ];

  batchSources.forEach(({ data, id }) => {
    if (data && Array.isArray(data.batches)) {
      setCount(id, visible(data.batches.flatMap(b => b.words || [])) + ' слов');
    }
  });

  if (numeralsData) {
    const quantitative = (numeralsData.groups || []).flatMap(g => g.numbers || []);
    const ordinals = numeralsData.ordinals || [];
    setCount('count-numerals',
      visible(quantitative) + ' + ' + visible(ordinals));
  }
}

async function safeJson(res) {
  if (!res.ok) return null;
  try { return await res.json(); } catch (e) { console.error('JSON parse error:', res.url, e); return null; }
}

async function loadCategoryData() {
  const [verbsRes, numeralsRes, introRes, nounsRes, adjRes, advRes] = await Promise.all([
    fetch('resources/verbs-data.json'),
    fetch('resources/numerals-data.json'),
    fetch('resources/intro-and-linkings-data.json'),
    fetch('resources/nouns-data.json'),
    fetch('resources/adjectives-data.json'),
    fetch('resources/adverbs-data.json')
  ]);

  [verbsData, numeralsData, introLinkingsData, nounsData, adjectivesData, adverbsData] = await Promise.all([
    safeJson(verbsRes),
    safeJson(numeralsRes),
    safeJson(introRes),
    safeJson(nounsRes),
    safeJson(adjRes),
    safeJson(advRes)
  ]);

  updateCategoryCounts();
  searchIndex = null; // reset index after data reload
}

// ===== SEARCH =====
function buildSearchIndex() {
  const index = [];
  if (verbsData && Array.isArray(verbsData.batches))
    verbsData.batches.flatMap(b => b.words || []).forEach(w => index.push({ type: 'verb', w }));
  if (nounsData && Array.isArray(nounsData.batches))
    nounsData.batches.flatMap(b => b.words || []).forEach(w => index.push({ type: 'noun', w }));
  if (adjectivesData && Array.isArray(adjectivesData.batches))
    adjectivesData.batches.flatMap(b => b.words || []).forEach(w => index.push({ type: 'adj', w }));
  if (adverbsData && Array.isArray(adverbsData.batches))
    adverbsData.batches.flatMap(b => b.words || []).forEach(w => index.push({ type: 'adv', w }));
  if (introLinkingsData && Array.isArray(introLinkingsData.batches))
    introLinkingsData.batches.flatMap(b => b.words || []).forEach(w => index.push({ type: 'link', w }));
  return index;
}

let searchIndex = null;
let searchDebounce = null;

function getSearchIndex() {
  if (!searchIndex) searchIndex = buildSearchIndex();
  return searchIndex;
}

function escapeHtml(s) {
  return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}

function stripAccents(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ς/g, 'σ');
}

function matchesQuery(entry, q) {
  const { type, w } = entry;
  const fields = type === 'verb'
    ? [w.present, w.future, w.past, w.translation]
    : (type === 'noun' || type === 'adj')
      ? [w.male, w.female, w.neuter, w.translation]
      : [w.greek, w.greekWord, w.translation];
  return fields.some(f => f && stripAccents(f).includes(q));
}

function renderEntry(entry) {
  const { type, w } = entry;
  const labels = { verb: 'глаг', noun: 'сущ', adj: 'прил', adv: 'нар', link: 'связ' };
  let forms = '';
  if (type === 'verb') {
    forms = [w.present, w.future, w.past].filter(Boolean)
      .map(p => `<span>${escapeHtml(p)}</span>`).join('<span class="sr-sep">/</span>');
  } else if (type === 'noun' || type === 'adj') {
    forms = [w.male, w.female, w.neuter].filter(p => p && p !== '-')
      .map(p => `<span>${escapeHtml(p)}</span>`).join('<span class="sr-sep">/</span>');
  } else {
    forms = `<span>${escapeHtml(w.greek || w.greekWord || '')}</span>`;
  }
  return `<div class="search-result-row">
    <span class="sr-type">${labels[type] || type}</span>
    <span class="sr-forms">${forms}</span>
    <span class="sr-translation">${escapeHtml(w.translation || '')}</span>
  </div>`;
}

function runSearch(query) {
  const q = stripAccents(query.trim());
  const meta = document.getElementById('search-meta');
  const results = document.getElementById('search-results');
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.style.display = q ? '' : 'none';
  if (q.length < 2) {
    meta.textContent = q.length === 0 ? '' : 'Введите не менее 2 символов…';
    results.innerHTML = '';
    return;
  }
  const matches = getSearchIndex().filter(e => matchesQuery(e, q));
  if (matches.length === 0) {
    meta.textContent = 'Ничего не найдено';
    results.innerHTML = `<div class="search-empty">По запросу «${escapeHtml(query.trim())}» ничего не найдено</div>`;
    return;
  }
  const limit = 80;
  meta.textContent = matches.length > limit ? `Найдено ${matches.length} — показаны первые ${limit}` : `Найдено: ${matches.length}`;
  results.innerHTML = matches.slice(0, limit).map(renderEntry).join('');
}

function onSearchInput(value) {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => runSearch(value), 180);
}

function clearSearch() {
  const input = document.getElementById('search-input');
  if (input) { input.value = ''; input.focus(); }
  runSearch('');
}

function onLanguageLevelChange(level) {
  const normalized = normalizeLanguageLevel(level) || 'C1';
  localStorage.setItem(LANGUAGE_LEVEL_KEY, normalized);
  const select = document.getElementById('lang-level-select');
  if (select) select.value = normalized;
  updateCategoryCounts();
}

function initLanguageLevelControl() {
  const stored = normalizeLanguageLevel(localStorage.getItem(LANGUAGE_LEVEL_KEY)) || 'C1';
  const select = document.getElementById('lang-level-select');
  if (select) select.value = stored;
}

function loadLearningPlans() {
  try {
    const plans = JSON.parse(localStorage.getItem(LEARNING_PLANS_KEY) || '[]');
    return Array.isArray(plans) ? plans : [];
  } catch {
    return [];
  }
}

function refreshLearningReviewStatuses(plans) {
  const intervals = [1, 3, 7, 14, 30];
  const now = Date.now();
  let changed = false;
  plans.forEach(plan => {
    const previous = plan.needsReview;
    if (plan.status !== 'completed' || !plan.completedAt) {
      plan.needsReview = false;
    } else {
      const index = Math.min(plan.reviewCount || 0, intervals.length - 1);
      plan.needsReview = new Date(plan.completedAt).getTime() + intervals[index] * 86400000 <= now;
    }
    if (plan.needsReview !== previous) changed = true;
  });
  if (changed) localStorage.setItem(LEARNING_PLANS_KEY, JSON.stringify(plans));
  return plans;
}

function updateLearningPlanStats() {
  const plans = refreshLearningReviewStatuses(loadLearningPlans());
  const inProgress = plans.filter(plan => plan.status !== 'completed').length;
  const completed = plans.filter(plan => plan.status === 'completed').length;
  const needsReview = plans.filter(plan => plan.needsReview).length;
  setCount('learning-plans-total', plans.length);
  setCount('learning-plans-progress', inProgress);
  setCount('learning-plans-complete', completed);
  setCount('learning-plans-review', needsReview);
}

function updateHomeTopOffset() {
  const topBlock = document.querySelector('.home-top-sticky');
  if (!topBlock) return;
  const topValue = parseFloat(getComputedStyle(topBlock).top) || 0;
  const offset = Math.ceil(topBlock.getBoundingClientRect().height + topValue);
  document.documentElement.style.setProperty('--home-top-offset', offset + 'px');
}

function showHomeTab(name, btn) {
  document.querySelectorAll('.home-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.home-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('home-panel-' + name).classList.add('active');
  if (name === 'learnings') updateLearningPlanStats();
}

window.onLanguageLevelChange = onLanguageLevelChange;
window.showHomeTab = showHomeTab;
window.onSearchInput = onSearchInput;
window.clearSearch = clearSearch;

initLanguageLevelControl();
updateLearningPlanStats();
updateHomeTopOffset();
window.addEventListener('resize', updateHomeTopOffset);
window.addEventListener('load', updateHomeTopOffset);
loadCategoryData().catch(() => {
  setCount('count-verbs', '-');
  setCount('count-numerals', '-');
  setCount('count-intro-linkings', '-');
  setCount('count-nouns', '-');
  setCount('count-adjectives', '-');
  setCount('count-adverbs', '-');
});
