const PROFILE_SECTIONS = [
  { name: 'Глаголы', file: '../../resources/verbs-data.json', key: 'gr_progress', words: data => data.batches.flatMap(batch => batch.words) },
  { name: 'Существительные', file: '../../resources/nouns-data.json', key: 'gr_nouns_progress', words: data => data.batches.flatMap(batch => batch.words) },
  { name: 'Прилагательные', file: '../../resources/adjectives-data.json', key: 'gr_adjectives_progress', words: data => data.batches.flatMap(batch => batch.words) },
  { name: 'Наречия', file: '../../resources/adverbs-data.json', key: 'gr_adverbs_progress', words: data => data.batches.flatMap(batch => batch.words) },
  { name: 'Вводные и связки', file: '../../resources/intro-and-linkings-data.json', key: 'gr_intro_linkings_progress', words: data => data.batches.flatMap(batch => batch.words) },
  { name: 'Числительные', file: '../../resources/numerals-data.json', key: 'gr_numerals_progress', words: data => [...data.groups.flatMap(group => group.numbers), ...data.ordinals] }
];
const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14, 30];

function readProgress(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
}

function summarizeSection(section, data) {
  const words = section.words(data);
  const progress = readProgress(section.key);
  let known = 0;
  let learning = 0;
  Object.values(progress).forEach(item => {
    if (!item?.seen) return;
    if ((item.interval || 0) >= 7) known++;
    else learning++;
  });
  const studied = known + learning;
  return { name: section.name, known, learning, studied, fresh: Math.max(words.length - studied, 0), total: words.length };
}

function refreshPlanDue(plan, now) {
  if (plan.status !== 'completed' || !plan.completedAt) return false;
  const index = Math.min(plan.reviewCount || 0, REVIEW_INTERVALS_DAYS.length - 1);
  return new Date(plan.completedAt).getTime() + REVIEW_INTERVALS_DAYS[index] * 86400000 <= now;
}

function renderProfile(sections) {
  const rows = sections.map(section => `<tr>
    <td class="progress-main">${section.name}</td>
    <td>${section.studied}</td><td class="progress-known">${section.known}</td>
    <td class="progress-learning">${section.learning}</td><td>${section.fresh}</td><td>${section.total}</td>
  </tr>`).join('');
  document.getElementById('profile-progress-body').innerHTML = rows;
  document.getElementById('summary-total').textContent = sections.reduce((sum, section) => sum + section.studied, 0);
  document.getElementById('summary-known').textContent = sections.reduce((sum, section) => sum + section.known, 0);
  document.getElementById('summary-learning').textContent = sections.reduce((sum, section) => sum + section.learning, 0);

  const plans = readProgress('gr_learning_plans');
  const list = Array.isArray(plans) ? plans : [];
  const now = Date.now();
  const completed = list.filter(plan => plan.status === 'completed').length;
  const due = list.filter(plan => refreshPlanDue(plan, now)).length;
  document.getElementById('summary-plans').textContent = list.length;
  document.getElementById('plans-total').textContent = list.length;
  document.getElementById('plans-active').textContent = list.length - completed;
  document.getElementById('plans-completed').textContent = completed;
  document.getElementById('plans-review').textContent = due;
  document.getElementById('profile-email').textContent = window.trainerCurrentUser?.email || 'Локальные данные этого браузера';
}

function renderProfileUser() {
  document.getElementById('profile-email').textContent = window.trainerCurrentUser?.email || 'Локальные данные этого браузера';
}

async function loadProfile() {
  const responses = await Promise.all(PROFILE_SECTIONS.map(async section => {
    const response = await fetch(section.file);
    if (!response.ok) throw new Error(`Не удалось загрузить ${section.name}`);
    return summarizeSection(section, await response.json());
  }));
  renderProfile(responses);
}

function onProfileLevelChange(level) {
  localStorage.setItem('gr_language_level', level);
}

async function syncProfileNow() {
  const button = document.getElementById('profile-sync');
  const message = document.getElementById('profile-sync-message');
  button.disabled = true;
  message.textContent = 'Сохраняю текущее состояние аккаунта в облако…';
  try {
    const synced = await window.syncTrainerNow();
    message.textContent = synced ? 'Все текущие данные отправлены в облако.' : 'Не удалось синхронизировать. Проверьте индикатор рядом с уровнем языка.';
  } finally {
    button.disabled = false;
  }
}

document.getElementById('profile-export').addEventListener('click', window.exportTrainerState);
document.getElementById('profile-import').addEventListener('click', window.openTrainerImport);
document.getElementById('profile-sync').addEventListener('click', syncProfileNow);
window.addEventListener('trainer-auth-changed', renderProfileUser);
document.getElementById('lang-level-select').value = localStorage.getItem('gr_language_level') || 'C1';
window.onProfileLevelChange = onProfileLevelChange;

loadProfile().catch(error => {
  document.getElementById('profile-progress-body').innerHTML = `<tr><td colspan="6">${error.message}</td></tr>`;
});