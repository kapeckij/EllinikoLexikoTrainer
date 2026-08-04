const LANGUAGE_LEVEL_KEY = 'gr_language_level';
const LANGUAGE_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const LEVEL_RANK = { A1: 0, A2: 1, B1: 2, B2: 3, C1: 4 };

let verbsData = null;
let numeralsData = null;
let introLinkingsData = null;

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
  const selectedLevel = normalizeLanguageLevel(localStorage.getItem(LANGUAGE_LEVEL_KEY)) || 'C1';

  if (verbsData && Array.isArray(verbsData.batches)) {
    const verbs = verbsData.batches.flatMap(batch => (batch.verbs || []));
    const visibleVerbs = verbs.filter(v => isVisibleByLanguageLevel(v.languageLevel, selectedLevel));
    setCount('count-verbs', visibleVerbs.length + ' слов');
  }

  if (introLinkingsData && Array.isArray(introLinkingsData.batches)) {
    const words = introLinkingsData.batches.flatMap(batch => (batch.words || []));
    const visibleWords = words.filter(w => isVisibleByLanguageLevel(w.languageLevel, selectedLevel));
    setCount('count-intro-linkings', visibleWords.length + ' слов');
  }

  if (numeralsData) {
    const quantitative = (numeralsData.groups || []).flatMap(group => (group.numbers || []));
    const ordinals = numeralsData.ordinals || [];
    const visibleQuantitative = quantitative.filter(n => isVisibleByLanguageLevel(n.languageLevel, selectedLevel));
    const visibleOrdinals = ordinals.filter(o => isVisibleByLanguageLevel(o.languageLevel, selectedLevel));
    setCount('count-numerals', visibleQuantitative.length + ' + ' + visibleOrdinals.length);
  }
}

async function loadCategoryData() {
  const [verbsRes, numeralsRes, introRes] = await Promise.all([
    fetch('verbs/data.json'),
    fetch('numerals/data.json'),
    fetch('intro_and_linkings/data.json')
  ]);

  verbsData = verbsRes.ok ? await verbsRes.json() : null;
  numeralsData = numeralsRes.ok ? await numeralsRes.json() : null;
  introLinkingsData = introRes.ok ? await introRes.json() : null;

  updateCategoryCounts();
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

function showHomeTab(name, btn) {
  document.querySelectorAll('.home-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.home-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('home-panel-' + name).classList.add('active');
}

window.onLanguageLevelChange = onLanguageLevelChange;
window.showHomeTab = showHomeTab;

initLanguageLevelControl();
loadCategoryData().catch(() => {
  setCount('count-verbs', '-');
  setCount('count-numerals', '-');
  setCount('count-intro-linkings', '-');
});
