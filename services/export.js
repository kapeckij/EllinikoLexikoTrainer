(function () {
  function collectTrainerState() {
    const storage = {};
    const storageRaw = {};
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith('gr_')) continue;
      const value = localStorage.getItem(key);
      storageRaw[key] = value;
      try { storage[key] = JSON.parse(value); } catch { storage[key] = value; }
    }
    return {
      format: 'greek-trainer-state',
      version: 2,
      exportedAt: new Date().toISOString(),
      storage,
      storageRaw
    };
  }

  function exportTrainerState() {
    const blob = new Blob([JSON.stringify(collectTrainerState(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `greek-trainer-state-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function validateTrainerState(data) {
    if (!data || data.format !== 'greek-trainer-state' || ![1, 2].includes(data.version)) {
      throw new Error('Формат или версия файла не поддерживается.');
    }
    if (!data.storage || typeof data.storage !== 'object' || Array.isArray(data.storage)) {
      throw new Error('В файле отсутствуют данные тренажёра.');
    }

    const entries = Object.entries(data.storage);
    if (entries.some(([key]) => !key.startsWith('gr_'))) {
      throw new Error('Файл содержит недопустимые ключи данных.');
    }

    if (data.version === 2) {
      if (!data.storageRaw || typeof data.storageRaw !== 'object' || Array.isArray(data.storageRaw)) {
        throw new Error('В файле отсутствуют исходные значения хранилища.');
      }
      if (Object.keys(data.storage).length !== Object.keys(data.storageRaw).length) {
        throw new Error('Файл содержит неполный снимок хранилища.');
      }
      return Object.entries(data.storageRaw).map(([key, value]) => {
        if (!key.startsWith('gr_') || typeof value !== 'string' || !(key in data.storage)) {
          throw new Error('Файл содержит некорректные значения хранилища.');
        }
        return [key, value];
      });
    }

    return entries.map(([key, value]) => [
      key,
      key === 'gr_language_level' && typeof value === 'string' ? value : JSON.stringify(value)
    ]);
  }

  async function importTrainerState(file) {
    if (!file || file.size > 20 * 1024 * 1024) throw new Error('Файл не выбран или превышает 20 МБ.');
    const data = JSON.parse(await file.text());
    const importedEntries = validateTrainerState(data);
    if (!window.confirm('Импорт заменит все текущие данные тренажёра в этом браузере. Продолжить?')) return;

    const previousEntries = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key && key.startsWith('gr_')) previousEntries.push([key, localStorage.getItem(key)]);
    }

    const clearTrainerState = () => {
      for (let index = localStorage.length - 1; index >= 0; index--) {
        const key = localStorage.key(index);
        if (key.startsWith('gr_')) localStorage.removeItem(key);
      }
    };

    try {
      clearTrainerState();
      importedEntries.forEach(([key, value]) => localStorage.setItem(key, value));
    } catch (error) {
      clearTrainerState();
      previousEntries.forEach(([key, value]) => localStorage.setItem(key, value));
      throw new Error(`Не удалось восстановить данные; прежнее состояние восстановлено. ${error.message}`);
    }

    window.alert('Данные тренажёра импортированы. Страница будет перезагружена.');
    window.location.reload();
  }

  window.collectTrainerState = collectTrainerState;
  window.exportTrainerState = exportTrainerState;
  window.importTrainerState = importTrainerState;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.hidden = true;
  fileInput.addEventListener('change', async () => {
    try {
      await importTrainerState(fileInput.files[0]);
    } catch (error) {
      window.alert(`Не удалось импортировать данные: ${error.message}`);
    } finally {
      fileInput.value = '';
    }
  });
  window.openTrainerImport = () => fileInput.click();
  document.body.append(fileInput);
})();