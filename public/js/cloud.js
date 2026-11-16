(() => {
  const CLOUD_PASS_KEY = "cloud_pass";
  const CLOUD_REV_KEY = "cloud_rev";
  const CLOUD_DIRTY_KEY = "cloud_dirty";
  const CLOUD_LAST_SYNC_KEY = "cloud_last_sync";
  const SYNC_DELAY = 500; // 手機點選後 0.5 秒快速合併上傳

  let cloudPass = sessionStorage.getItem(CLOUD_PASS_KEY) || localStorage.getItem(CLOUD_PASS_KEY) || "";
  let isConnected = false;
  let isEditMode = false;
  let hasPass = false;
  let isPushing = false;
  let isPulling = false;
  let isApplyingRemote = false;
  let syncTimer = null;
  let ws = null;
  let wsRetryDelay = 2000;
  let wsRetryTimer = null;

  const dirtyKeys = new Set(JSON.parse(localStorage.getItem(CLOUD_DIRTY_KEY) || "[]"));

  function isSyncKey(key) {
    return key && !key.startsWith("cloud_") && !key.startsWith("ui_") && key !== "currentClass";
  }

  function getSyncKeys() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (isSyncKey(k)) keys.push(k);
    }
    return keys;
  }

  function saveDirty() {
    localStorage.setItem(CLOUD_DIRTY_KEY, JSON.stringify([...dirtyKeys]));
  }

  function updateUI(stateText, stateClass) {
    const pill = document.getElementById("syncStatusPill");
    const textEl = document.getElementById("syncStatusText");
    if (pill && textEl) {
      pill.className = `status-pill ${stateClass || ""}`;
      textEl.textContent = stateText;
    }

    const modePill = document.getElementById("editModePill");
    const modeIcon = document.getElementById("editModeIcon");
    const modeText = document.getElementById("editModeText");
    if (modePill && modeIcon && modeText) {
      modePill.className = `mode-pill ${isEditMode ? "unlocked" : "locked"}`;
      modeIcon.textContent = isEditMode ? "✏️" : "🔒";
      modeText.textContent = isEditMode ? "編輯模式" : "檢視模式";
    }

    const heroUnlockBtn = document.getElementById("heroUnlockBtn");
    if (heroUnlockBtn) {
      heroUnlockBtn.style.display = isEditMode ? "none" : "inline-flex";
    }

    const detailEl = document.getElementById("settingsSyncDetail");
    if (detailEl) {
      if (!isConnected) detailEl.textContent = "❌ 尚未連線";
      else detailEl.textContent = isEditMode ? "✏️ 編輯模式（即時雲端同步）" : "👀 檢視模式（唯讀同步）";
    }

    const lastEl = document.getElementById("settingsLastSync");
    if (lastEl) {
      lastEl.textContent = localStorage.getItem(CLOUD_LAST_SYNC_KEY) || "尚未同步";
    }
  }

  function markDirty(key) {
    if (isApplyingRemote) return;
    dirtyKeys.add(key);
    saveDirty();
    updateUI(`待同步 (${dirtyKeys.size})`, "syncing");
    schedulePush();
  }

  function schedulePush() {
    if (!syncTimer && isEditMode) {
      syncTimer = setTimeout(() => {
        syncTimer = null;
        pushChanges(false);
      }, SYNC_DELAY);
    }
  }

  const origSetItem = localStorage.setItem;
  localStorage.setItem = function (key, value) {
    if (!isEditMode && !isApplyingRemote && isSyncKey(key)) return;
    const strVal = String(value);
    const changed = isSyncKey(key) && localStorage.getItem(key) !== strVal;
    origSetItem.call(localStorage, key, strVal);
    if (changed) markDirty(key);
  };

  const origRemoveItem = localStorage.removeItem;
  localStorage.removeItem = function (key) {
    if (!isEditMode && !isApplyingRemote && isSyncKey(key)) return;
    const existed = isSyncKey(key) && localStorage.getItem(key) !== null;
    origRemoveItem.call(localStorage, key);
    if (existed) markDirty(key);
  };

  async function apiFetch(path, method = "GET", body = null, keepalive = false) {
    const headers = {};
    if (cloudPass) headers["X-Pass"] = encodeURIComponent(cloudPass);
    if (body) headers["Content-Type"] = "application/json";
    const res = await fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      keepalive,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function pushChanges(keepalive = false) {
    if (isPushing || dirtyKeys.size === 0 || !isEditMode) return dirtyKeys.size === 0;
    isPushing = true;
    if (!keepalive) updateUI("同步中...", "syncing");

    const keys = [...dirtyKeys];
    const set = {};
    const del = [];
    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (v === null) del.push(k);
      else set[k] = v;
    }
    dirtyKeys.clear();
    saveDirty();

    try {
      const res = await apiFetch("/api/data", "POST", { set, del }, keepalive);
      const localRev = Number(localStorage.getItem(CLOUD_REV_KEY) || "0");
      if (res.prev === localRev) {
        localStorage.setItem(CLOUD_REV_KEY, String(res.rev));
      }
      localStorage.setItem(CLOUD_LAST_SYNC_KEY, new Date().toLocaleString("zh-TW"));
      updateUI("已同步", "synced");
      return true;
    } catch (err) {
      for (const k of keys) dirtyKeys.add(k);
      saveDirty();
      updateUI("同步失敗", "error");
      if (err.status === 401) {
        isEditMode = false;
        savePass("", false);
        updateUI("密碼失效", "error");
        window.showToast && window.showToast("編輯權限已失效，請重新輸入密碼");
      }
      return false;
    } finally {
      isPushing = false;
      if (dirtyKeys.size > 0 && isEditMode && !keepalive) schedulePush();
    }
  }

  function applyRemote(res) {
    let changed = 0;
    isApplyingRemote = true;
    try {
      if (res.full) {
        if (res.rev === 0) {
          if (isEditMode) getSyncKeys().forEach((k) => dirtyKeys.add(k));
        } else {
          getSyncKeys().forEach((k) => {
            if (!(k in res.data)) {
              localStorage.removeItem(k);
              changed++;
            }
          });
          dirtyKeys.clear();
        }
      }
      for (const [k, v] of Object.entries(res.data || {})) {
        if (localStorage.getItem(k) !== v) {
          localStorage.setItem(k, v);
          changed++;
        }
        dirtyKeys.delete(k);
      }
      for (const k of res.del || []) {
        if (localStorage.getItem(k) !== null) {
          localStorage.removeItem(k);
          changed++;
        }
        dirtyKeys.delete(k);
      }
    } finally {
      isApplyingRemote = false;
    }
    saveDirty();
    localStorage.setItem(CLOUD_REV_KEY, String(res.rev));
    localStorage.setItem(CLOUD_LAST_SYNC_KEY, new Date().toLocaleString("zh-TW"));
    return changed;
  }

  async function pullChanges(silent = true) {
    if (isPulling || isPushing) return;
    if (dirtyKeys.size > 0 && isEditMode) {
      await pushChanges(false);
    }
    isPulling = true;
    try {
      const since = Number(localStorage.getItem(CLOUD_REV_KEY) || "0");
      let res;
      try {
        res = await apiFetch(`/api/data?since=${since}`, "GET");
      } catch (err) {
        if (err.status === 401) {
          isEditMode = false;
          savePass("", false);
          res = await apiFetch(`/api/data?since=${since}`, "GET");
        } else {
          throw err;
        }
      }
      isConnected = true;
      hasPass = Boolean(res.hasPass);
      isEditMode = Boolean(res.editable);
      const changed = applyRemote(res);
      updateUI(dirtyKeys.size > 0 ? `待同步 (${dirtyKeys.size})` : "已同步", dirtyKeys.size > 0 ? "syncing" : "synced");
      if (changed > 0 && typeof window.onCloudDataUpdated === "function") {
        window.onCloudDataUpdated();
        if (!silent && window.showToast) window.showToast("☁️ 已同步雲端最新資料");
      } else if (!silent && window.showToast) {
        window.showToast("☁️ 目前已是最新資料");
      }
      if (dirtyKeys.size > 0 && isEditMode) pushChanges(false);
    } catch (err) {
      isConnected = false;
      updateUI("離線", "error");
    } finally {
      isPulling = false;
    }
  }

  function connectWS() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    try {
      ws = new WebSocket(`${proto}//${location.host}/api/ws`);
    } catch {
      return;
    }
    ws.onopen = () => {
      wsRetryDelay = 2000;
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg && msg.type === "rev") {
          const localRev = Number(localStorage.getItem(CLOUD_REV_KEY) || "0");
          if (msg.rev > localRev && !isPushing) {
            pullChanges(true);
          }
        }
      } catch {
        // ignore
      }
    };
    ws.onclose = () => {
      ws = null;
      if (wsRetryTimer) clearTimeout(wsRetryTimer);
      wsRetryTimer = setTimeout(() => {
        wsRetryTimer = null;
        if (document.visibilityState === "visible") connectWS();
      }, wsRetryDelay);
      wsRetryDelay = Math.min(wsRetryDelay * 1.5, 15000);
    };
    ws.onerror = () => {
      try { ws.close(); } catch {}
    };
  }

  function savePass(pass, remember) {
    cloudPass = pass;
    sessionStorage.removeItem(CLOUD_PASS_KEY);
    localStorage.removeItem(CLOUD_PASS_KEY);
    if (pass) {
      (remember ? localStorage : sessionStorage).setItem(CLOUD_PASS_KEY, pass);
    }
  }

  async function authenticate(pass, remember) {
    savePass(pass, remember);
    const res = await apiFetch("/api/auth", "POST", {});
    hasPass = Boolean(res.hasPass);
    isEditMode = Boolean(res.editable);
    updateUI(dirtyKeys.size > 0 ? `待同步 (${dirtyKeys.size})` : "已同步", "synced");
    if (dirtyKeys.size > 0 && isEditMode) {
      await pushChanges(false);
    } else {
      await pullChanges(true);
    }
    return isEditMode;
  }

  async function lockEdit() {
    if (dirtyKeys.size > 0) {
      await pushChanges(false);
    }
    isEditMode = false;
    savePass("", false);
    updateUI("已同步", "synced");
  }

  function requireEdit() {
    if (isEditMode) return true;
    if (typeof window.openAuthModal === "function") {
      window.openAuthModal("目前為檢視模式，請輸入管理密碼後再進行修改。");
    }
    return false;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (dirtyKeys.size > 0 && isEditMode) {
        clearTimeout(syncTimer);
        syncTimer = null;
        pushChanges(true);
      }
    } else if (document.visibilityState === "visible") {
      pullChanges(true);
      connectWS();
    }
  });

  window.addEventListener("pagehide", () => {
    if (dirtyKeys.size > 0 && isEditMode) {
      clearTimeout(syncTimer);
      syncTimer = null;
      pushChanges(true);
    }
  });

  window.addEventListener("focus", () => {
    pullChanges(true);
  });

  setInterval(() => {
    if (document.visibilityState === "visible" && (!ws || ws.readyState !== WebSocket.OPEN)) {
      pullChanges(true);
    }
  }, 5000);

  window.CloudSync = {
    init: async () => {
      updateUI("載入中...", "syncing");
      await pullChanges(true);
      connectWS();
    },
    pullNow: () => pullChanges(false),
    pushNow: () => pushChanges(false),
    authenticate,
    lockEdit,
    requireEdit,
    isEdit: () => isEditMode,
    hasPassSet: () => hasPass,
    isSyncKey,
    markDirty,
  };
})();
