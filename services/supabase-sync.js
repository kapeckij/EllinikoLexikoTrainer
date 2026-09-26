(function () {
  const trainerRoot = new URL('../', document.currentScript.src);
  const PREFIX = 'gr_';
  const TABLE = 'trainer_state';
  const config = window.TRAINER_SUPABASE_CONFIG || {};
  let client = null;
  let user = null;
  let syncEnabled = false;
  let applyingCloudState = false;
  let syncing = false;
  let syncPending = false;
  let syncPromise = null;
  let syncTimer = 0;
  let syncHealthy = false;
  let authReady = false;
  let statusMessage = 'Синхронизация не подключена';

  function collectState() {
    const storage = {};
    const storageRaw = {};
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(PREFIX)) continue;
      const raw = localStorage.getItem(key);
      storageRaw[key] = raw;
      try { storage[key] = JSON.parse(raw); } catch { storage[key] = raw; }
    }
    return { format: 'greek-trainer-state', version: 2, exportedAt: new Date().toISOString(), storage, storageRaw };
  }

  function getRawState(snapshot) {
    if (snapshot?.format !== 'greek-trainer-state' || !snapshot.storage || typeof snapshot.storage !== 'object') {
      throw new Error('Облачные данные имеют неизвестный формат.');
    }
    if (snapshot.version === 2 && snapshot.storageRaw && typeof snapshot.storageRaw === 'object') {
      return Object.entries(snapshot.storageRaw).map(([key, value]) => {
        if (!key.startsWith(PREFIX) || typeof value !== 'string' || !(key in snapshot.storage)) {
          throw new Error('Облачные данные повреждены.');
        }
        return [key, value];
      });
    }
    if (snapshot.version === 1) {
      return Object.entries(snapshot.storage).map(([key, value]) => {
        if (!key.startsWith(PREFIX)) throw new Error('Облачные данные содержат недопустимый ключ.');
        return [key, key === 'gr_language_level' && typeof value === 'string' ? value : JSON.stringify(value)];
      });
    }
    throw new Error('Версия облачных данных не поддерживается.');
  }

  function readLocalEntries() {
    return Object.entries(collectState().storageRaw);
  }

  function hasUsefulLocalState(entries) {
    return entries.some(([key]) => key !== 'gr_language_level');
  }

  function statesMatch(localEntries, cloudEntries) {
    if (localEntries.length !== cloudEntries.length) return false;
    const cloud = new Map(cloudEntries);
    return localEntries.every(([key, value]) => cloud.get(key) === value);
  }

  function applyRawState(entries) {
    applyingCloudState = true;
    try {
      for (let index = localStorage.length - 1; index >= 0; index--) {
        const key = localStorage.key(index);
        if (key && key.startsWith(PREFIX)) localStorage.removeItem(key);
      }
      entries.forEach(([key, value]) => localStorage.setItem(key, value));
    } finally {
      applyingCloudState = false;
    }
  }

  function snapshotForCloud() { return collectState(); }

  async function pushState() {
    if (!syncEnabled || !user) return;
    if (syncing) {
      syncPending = true;
      return syncPromise;
    }
    syncing = true;
    let successful = false;
    syncPromise = (async () => {
      do {
        syncPending = false;
        setStatus('Синхронизация…');
        try {
          const { error } = await client.from(TABLE).upsert({
            user_id: user.id,
            state: snapshotForCloud(),
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id' });
          if (error) throw error;
          successful = true;
          setStatus('Синхронизация выполнена', false, true);
        } catch (error) {
          successful = false;
          setStatus(`Ошибка синхронизации: ${error.message}`, true);
        }
      } while (syncPending && syncEnabled && user);
      return successful;
    })();
    try {
      await syncPromise;
    } finally {
      syncing = false;
      syncPromise = null;
    }
    return successful;
  }

  function scheduleSync() {
    if (!syncEnabled || applyingCloudState) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushState, 700);
  }

  function installStorageSync() {
    for (const method of ['setItem', 'removeItem']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (key, ...args) {
        const result = original.call(this, key, ...args);
        if (this === localStorage && String(key).startsWith(PREFIX)) scheduleSync();
        return result;
      };
    }
    window.addEventListener('storage', event => {
      if (event.key?.startsWith(PREFIX)) scheduleSync();
    });
  }

  let currentSession = null;
  let reconcilingUserId = null;

  async function reconcileSession(session) {
    currentSession = session;
    if (!session) {
      user = null;
      window.trainerCurrentUser = null;
      syncEnabled = false;
      window.dispatchEvent(new CustomEvent('trainer-auth-changed'));
      setAccountUI();
      return;
    }
    if (user?.id === session.user.id && syncEnabled) {
      setAccountUI();
      return;
    }
    if (reconcilingUserId === session.user.id) return;
    reconcilingUserId = session.user.id;
    user = session.user;
    window.trainerCurrentUser = session.user;
    window.dispatchEvent(new CustomEvent('trainer-auth-changed'));
    syncEnabled = false;
    setStatus('Загрузка состояния аккаунта…');

    try {
      const { data, error } = await client.from(TABLE).select('state').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      const localEntries = readLocalEntries();

      if (!data) {
        if (hasUsefulLocalState(localEntries)) {
          const transferLocal = window.confirm('Найден локальный прогресс. ОК — перенести его в облачный аккаунт; Отмена — пока оставить синхронизацию выключенной.');
          if (transferLocal) {
            syncEnabled = true;
            await pushState();
          } else {
            setStatus('Вход выполнен · данные пока только в этом браузере');
          }
        } else {
          syncEnabled = true;
          await pushState();
        }
        return;
      }

      const cloudEntries = getRawState(data.state);
      if (statesMatch(localEntries, cloudEntries)) {
        syncEnabled = true;
        setStatus('Синхронизация готова');
        return;
      }

      applyRawState(cloudEntries);
      syncEnabled = true;
      setStatus(`Облачные данные загружены · ${user.email || 'Google'}`);
      window.location.reload();
    } catch (error) {
      syncEnabled = false;
      setStatus(`Ошибка подключения к облаку: ${error.message}`, true);
    } finally {
      reconcilingUserId = null;
      setAccountUI();
    }
  }

  function setStatus(message, isError = false) {
    statusMessage = message;
    syncHealthy = !isError && Boolean(syncEnabled && user);
    status.textContent = syncHealthy ? '✓' : (isError || user ? '!' : '');
    status.style.color = syncHealthy ? '#22c55e' : '#eab308';
    status.title = message;
    status.setAttribute('aria-label', message);
  }

  async function signIn() {
    if (!client) return;
    if (currentSession && !syncEnabled) {
      await reconcileSession(currentSession);
      return;
    }
    if (currentSession) {
      try {
        clearTimeout(syncTimer);
        await pushState();
        syncEnabled = false;
        await client.auth.signOut({ scope: 'local' });
      } catch (error) {
        setStatus(`Не удалось выйти: ${error.message}`, true);
      }
      return;
    }
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}${window.location.pathname}` }
    });
    if (error) setStatus(`Не удалось начать вход: ${error.message}`, true);
  }

  window.syncTrainerNow = async function () {
    if (!client || !user || !currentSession) {
      setStatus('Сначала войдите в аккаунт Google', true);
      return false;
    }
    clearTimeout(syncTimer);
    syncEnabled = true;
    return pushState();
  };

  function setAccountUI() {
    account.style.visibility = authReady ? 'visible' : 'hidden';
    if (!client) {
      authReady = true;
      account.style.visibility = 'visible';
      profileLink.hidden = false;
      profileLink.setAttribute('aria-label', 'Открыть профиль');
      profileEmail.hidden = true;
      status.textContent = '';
      action.textContent = 'Войти через Google';
      action.disabled = true;
      const configured = Boolean(config.url && config.publishableKey);
      action.title = configured ? 'Проверьте загрузку CDN Supabase' : 'Добавьте Supabase publishable key в supabase-config.js';
      action.setAttribute('aria-label', action.title);
      setStatus(configured ? 'Не загружена библиотека Supabase; проверьте подключение к сети' : 'Вход не настроен: добавьте publishable key в supabase-config.js');
      return;
    }
    action.disabled = false;
    profileLink.hidden = false;
    profileEmail.hidden = !currentSession;
    profileEmail.textContent = currentSession?.user?.email || '';
    profileLink.href = new URL('pages/profile/index.html', trainerRoot).href;
    status.textContent = currentSession ? (syncHealthy ? '✓' : '!') : '';
    status.style.color = syncHealthy ? '#22c55e' : '#eab308';
    status.title = currentSession ? statusMessage : '';
    status.setAttribute('aria-label', currentSession ? statusMessage : '');
    profileLink.setAttribute('aria-label', currentSession
      ? `Профиль ${currentSession.user.email || ''}. ${statusMessage}`
      : 'Открыть профиль');
    action.textContent = currentSession ? '↪' : 'Войти через Google';
    action.title = currentSession ? 'Выйти из аккаунта' : 'Войти через Google и синхронизировать прогресс';
    action.setAttribute('aria-label', action.title);
  }

  installStorageSync();

  const account = document.createElement('div');
  account.className = 'trainer-account';
  account.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;gap:7px;width:clamp(190px,28vw,330px);min-width:0;min-height:34px;visibility:hidden;color:#e2e8f0;font:12px system-ui,sans-serif';
  const responsiveStyles = document.createElement('style');
  responsiveStyles.textContent = '.trainer-profile-link:hover{border-color:#5b8fff!important;color:#5b8fff!important}.trainer-profile-link[aria-label="Открыть профиль"]{width:38px!important;height:38px!important;padding:0!important;justify-content:center}.trainer-profile-link[aria-label="Открыть профиль"] .trainer-sync-status{display:none!important}@media(max-width:600px){.trainer-profile-link{max-width:clamp(112px,32vw,170px)!important}.trainer-account{gap:4px!important;width:clamp(190px,54vw,300px)!important}.trainer-account button{padding:6px 7px!important}.lang-level-floating{gap:5px!important}.lang-level-control{gap:5px!important}}';
  document.head.append(responsiveStyles);
  const profileLink = document.createElement('a');
  profileLink.className = 'trainer-profile-link';
  profileLink.href = new URL('pages/profile/index.html', trainerRoot).href;
  profileLink.title = 'Открыть профиль';
  profileLink.setAttribute('aria-label', 'Открыть профиль');
  profileLink.style.cssText = 'display:flex;align-items:center;gap:6px;min-width:34px;max-width:240px;height:34px;padding:0 7px;border:1px solid #2d3148;border-radius:7px;color:#e2e8f0;text-decoration:none;overflow:hidden';
  const profileIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  profileIcon.className = 'trainer-profile-icon';
  profileIcon.setAttribute('aria-hidden', 'true');
  profileIcon.setAttribute('viewBox', '0 0 24 24');
  profileIcon.setAttribute('width', '18');
  profileIcon.setAttribute('height', '18');
  profileIcon.setAttribute('fill', 'none');
  profileIcon.setAttribute('stroke', 'currentColor');
  profileIcon.setAttribute('stroke-width', '2');
  profileIcon.setAttribute('stroke-linecap', 'round');
  profileIcon.setAttribute('stroke-linejoin', 'round');
  profileIcon.style.cssText = 'display:block;width:18px;height:18px;flex:none';
  const profileHead = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  profileHead.setAttribute('cx', '12');
  profileHead.setAttribute('cy', '8');
  profileHead.setAttribute('r', '4');
  const profileBody = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  profileBody.setAttribute('d', 'M5 21a7 7 0 0 1 14 0');
  profileIcon.append(profileHead, profileBody);
  const profileEmail = document.createElement('span');
  profileEmail.className = 'trainer-profile-email';
  profileEmail.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
  const status = document.createElement('span');
  status.className = 'trainer-sync-status';
  status.style.cssText = 'display:inline-grid;place-items:center;width:20px;height:20px;flex:none;font-size:16px;font-weight:800';
  profileLink.append(profileIcon, profileEmail, status);
  const action = document.createElement('button');
  action.type = 'button';
  action.style.cssText = 'flex:none;padding:6px 9px;border:1px solid #2d3148;border-radius:7px;background:#252840;color:#e2e8f0;font:600 12px system-ui,sans-serif;cursor:pointer';
  action.addEventListener('click', signIn);
  account.append(action, profileLink);
  const accountSlot = document.getElementById('account-slot');
  const levelControl = document.querySelector('.lang-level-floating, .lang-level-control');
  if (accountSlot) accountSlot.append(account);
  else if (levelControl) levelControl.prepend(account);
  else document.body.append(account);

  if (!config.url || !config.publishableKey || !window.supabase?.createClient) {
    setAccountUI();
    return;
  }

  client = window.supabase.createClient(config.url, config.publishableKey);
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') {
      authReady = true;
      currentSession = session;
      user = session?.user || null;
      window.trainerCurrentUser = user;
      if (user) setStatus('Проверяю данные аккаунта…');
      setAccountUI();
      window.dispatchEvent(new CustomEvent('trainer-auth-changed'));
    }
    setTimeout(() => reconcileSession(session), 0);
  });
})();