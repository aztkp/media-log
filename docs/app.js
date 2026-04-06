// Media Log Web App
(function() {
  'use strict';

  const GITHUB_REPO = 'aztkp/media-log';
  const STORAGE_KEY = 'media_log_token';

  const MEDIA_NAMES = {
    movie: '映画', anime: 'アニメ', drama: 'ドラマ', tv: 'テレビ', comedy: 'お笑い',
    game: 'ゲーム', book: '本', manga: '漫画', radio: 'ラジオ', streaming: '配信', youtube: '動画',
    event: 'できごと'
  };

  function mediaChip(type, showLabel = true) {
    const name = MEDIA_NAMES[type] || type;
    return `<span class="media-chip ${type}">${showLabel ? name : ''}</span>`;
  }

  const STATUS_EMOJI = { want: '☆', watching: '👀', done: '✓', hold: '⏸' };
  const EPISODE_TYPES = ['anime', 'drama', 'tv', 'youtube', 'streaming', 'book'];

  function getEpisodeUnit(type) {
    return type === 'book' ? '章' : '話';
  }
  const DAY_NAMES = { mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土', sun: '日' };
  const DAY_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  let scheduleData = null;
  let scheduleSha = null;

  // Utils
  function b64decode(str) {
    const binary = atob(str.replace(/\n/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  function b64encode(str) {
    return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
  }

  function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = 'toast ' + type + ' show';
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  function getToken() { return localStorage.getItem(STORAGE_KEY) || ''; }
  function setToken(t) { localStorage.setItem(STORAGE_KEY, t); }

  // Get unique thumbnails from youtube items
  function getYoutubeThumbnails() {
    if (!scheduleData || !scheduleData.watchlist) return [];
    const urls = new Set();
    scheduleData.watchlist.forEach(item => {
      if (item.type === 'youtube' && item.image) {
        urls.add(item.image);
      }
    });
    return Array.from(urls);
  }

  async function handleImageUpload(file, previewEl, inputEl) {
    const token = getToken();
    if (!token) {
      showToast('トークンが設定されていません', 'error');
      return;
    }

    // Read file as data URL first
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    // Open crop modal
    const croppedBase64 = await openCropModal(dataUrl);
    if (!croppedBase64) return;

    // Show loading state
    previewEl.outerHTML = '<div class="image-placeholder" id="image-preview">アップロード中...</div>';
    const newPreview = document.getElementById('image-preview');

    try {
      // Generate unique filename
      const filename = `images/${Date.now()}.jpg`;

      // Upload to GitHub
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filename}`, {
        method: 'PUT',
        headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '📷 Upload image',
          content: croppedBase64
        })
      });

      if (!res.ok) throw new Error('Upload failed');

      const imageUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/${filename}`;

      // Update preview
      newPreview.outerHTML = `<img src="${imageUrl}" class="image-preview" id="image-preview">`;
      inputEl.value = imageUrl;
      showToast('画像をアップロードしました');

    } catch (e) {
      console.error('Image upload error:', e);
      newPreview.outerHTML = '<div class="image-placeholder" id="image-preview">クリックまたはドロップで画像を追加</div>';
      showToast('画像のアップロードに失敗しました', 'error');
    }
  }

  function openCropModal(dataUrl) {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'modal-overlay show';
      modal.id = 'crop-modal';

      modal.innerHTML = `
        <div class="modal" style="max-width:500px;">
          <div class="modal-header">
            <div class="modal-title">画像をトリミング</div>
            <button class="modal-close" id="crop-cancel">&times;</button>
          </div>
          <div class="crop-container">
            <img src="${dataUrl}" id="crop-image">
            <div class="crop-box" id="crop-box">
              <div class="crop-resize-handle" id="crop-resize"></div>
            </div>
          </div>
          <div style="margin-top:12px;display:flex;gap:8px;">
            <button class="btn" id="crop-cancel-btn" style="flex:1;">キャンセル</button>
            <button class="btn btn-primary" id="crop-confirm" style="flex:1;">切り取り</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const img = document.getElementById('crop-image');
      const cropBox = document.getElementById('crop-box');
      const resizeHandle = document.getElementById('crop-resize');
      const container = img.parentElement;
      let cropX = 0, cropY = 0, cropSize = 0;
      let imgOffsetX = 0, imgOffsetY = 0, imgWidth = 0, imgHeight = 0;
      let isDragging = false, isResizing = false;
      let startX, startY, startCropX, startCropY, startSize;

      img.onload = () => {
        const imgRect = img.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        imgOffsetX = imgRect.left - containerRect.left;
        imgOffsetY = imgRect.top - containerRect.top;
        imgWidth = imgRect.width;
        imgHeight = imgRect.height;
        cropSize = Math.min(imgWidth, imgHeight) * 0.8;
        cropX = (imgWidth - cropSize) / 2;
        cropY = (imgHeight - cropSize) / 2;
        updateCropBox();
      };

      function updateCropBox() {
        cropBox.style.width = cropSize + 'px';
        cropBox.style.height = cropSize + 'px';
        cropBox.style.left = (cropX + imgOffsetX) + 'px';
        cropBox.style.top = (cropY + imgOffsetY) + 'px';
      }

      // Resize handle events
      resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startSize = cropSize;
        e.preventDefault();
        e.stopPropagation();
      });

      resizeHandle.addEventListener('touchstart', (e) => {
        isResizing = true;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startSize = cropSize;
        e.preventDefault();
        e.stopPropagation();
      });

      // Drag events
      cropBox.addEventListener('mousedown', (e) => {
        if (isResizing) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startCropX = cropX;
        startCropY = cropY;
        e.preventDefault();
      });

      cropBox.addEventListener('touchstart', (e) => {
        if (isResizing) return;
        isDragging = true;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startCropX = cropX;
        startCropY = cropY;
        e.preventDefault();
      });

      function handleMove(e) {
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        if (isResizing) {
          const delta = Math.max(clientX - startX, clientY - startY);
          const minSize = 50;
          const maxSize = Math.min(imgWidth - cropX, imgHeight - cropY);
          cropSize = Math.max(minSize, Math.min(maxSize, startSize + delta));
          updateCropBox();
        } else if (isDragging) {
          cropX = Math.max(0, Math.min(imgWidth - cropSize, startCropX + (clientX - startX)));
          cropY = Math.max(0, Math.min(imgHeight - cropSize, startCropY + (clientY - startY)));
          updateCropBox();
        }
      }

      function handleEnd() {
        isDragging = false;
        isResizing = false;
      }

      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleEnd);
      document.addEventListener('touchmove', handleMove);
      document.addEventListener('touchend', handleEnd);

      function cleanup() {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleEnd);
        document.removeEventListener('touchmove', handleMove);
        document.removeEventListener('touchend', handleEnd);
        modal.remove();
      }

      document.getElementById('crop-cancel').onclick = () => { cleanup(); resolve(null); };
      document.getElementById('crop-cancel-btn').onclick = () => { cleanup(); resolve(null); };

      document.getElementById('crop-confirm').onclick = () => {
        const scaleX = img.naturalWidth / imgWidth;
        const scaleY = img.naturalHeight / imgHeight;

        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 400;
        const ctx = canvas.getContext('2d');

        ctx.drawImage(
          img,
          cropX * scaleX, cropY * scaleY,
          cropSize * scaleX, cropSize * scaleY,
          0, 0, 400, 400
        );

        const base64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
        cleanup();
        resolve(base64);
      };
    });
  }

  function formatDate(d) {
    if (!d) return '';
    const date = new Date(d);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  // Get local date key (YYYY-MM-DD) from ISO string
  function getLocalDateKey(isoString) {
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Get adjusted date (before 5am is treated as previous day)
  function getAdjustedNow() {
    const now = new Date();
    if (now.getHours() < 5) {
      now.setDate(now.getDate() - 1);
    }
    return now;
  }

  function getAdjustedDateString() {
    const d = getAdjustedNow();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getAdjustedISOString() {
    return getAdjustedNow().toISOString();
  }

  function getTodayDayKey() {
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    return days[getAdjustedNow().getDay()];
  }

  // API
  async function fetchData() {
    const token = getToken();
    if (!token) {
      document.getElementById('settings-modal').classList.add('show');
      return null;
    }

    try {
      // Fetch main schedule.json
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/schedule.json`, {
        headers: { 'Authorization': `token ${token}` }
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      scheduleSha = data.sha;
      scheduleData = JSON.parse(b64decode(data.content));
      if (!scheduleData.watchlist) scheduleData.watchlist = [];
      if (!scheduleData.weekly) scheduleData.weekly = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };

      // Fetch archive files (non-blocking, merge into watchlist)
      fetchArchiveData(token);

      return scheduleData;
    } catch (e) {
      showToast('データの読み込みに失敗しました', 'error');
      return null;
    }
  }

  // Fetch archive data and merge into scheduleData.watchlist
  async function fetchArchiveData(token) {
    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/archive`, {
        headers: { 'Authorization': `token ${token}` }
      });
      if (!res.ok) return; // No archive folder yet

      const files = await res.json();
      const archiveFiles = files.filter(f => f.name.endsWith('.json'));

      for (const file of archiveFiles) {
        const fileRes = await fetch(file.download_url);
        if (fileRes.ok) {
          const items = await fileRes.json();
          // Merge archive items into watchlist (avoid duplicates)
          const existingIds = new Set(scheduleData.watchlist.map(i => i.completedAt + i.title));
          for (const item of items) {
            const id = item.completedAt + item.title;
            if (!existingIds.has(id)) {
              scheduleData.watchlist.push(item);
              existingIds.add(id);
            }
          }
        }
      }
      // Re-render views after archive loaded
      if (typeof renderHistory === 'function') renderHistory();
      if (typeof renderBookshelf === 'function') renderBookshelf();
    } catch (e) {
      console.log('No archive data or failed to fetch:', e);
    }
  }

  // Archive data (past months' watchlist items)
  let archiveData = [];

  // Get current month key (YYYY-MM)
  function getCurrentMonthKey() {
    const d = getAdjustedNow();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  // Get month key from date string
  function getMonthKey(dateStr) {
    if (!dateStr) return null;
    return dateStr.slice(0, 7);
  }

  // Fetch latest remote schedule.json data and SHA
  async function fetchRemoteData(token) {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/schedule.json`, {
      headers: { 'Authorization': `token ${token}` }
    });
    if (!res.ok) throw new Error('Failed to fetch remote data');
    const meta = await res.json();
    return {
      data: JSON.parse(b64decode(meta.content)),
      sha: meta.sha
    };
  }

  // Unique key for watchlist item identification
  function getItemKey(item) {
    return (item.addedAt || '') + '|' + item.title;
  }

  // Pick the item with more progress or later timestamp
  function pickNewerItem(local, remote) {
    if (local.status === 'done' && remote.status !== 'done') return local;
    if (remote.status === 'done' && local.status !== 'done') return remote;
    if ((local.currentEpisode || 0) > (remote.currentEpisode || 0)) return local;
    if ((remote.currentEpisode || 0) > (local.currentEpisode || 0)) return remote;
    if ((local.episodeHistory?.length || 0) > (remote.episodeHistory?.length || 0)) return local;
    if ((remote.episodeHistory?.length || 0) > (local.episodeHistory?.length || 0)) return remote;
    const localTime = local.completedAt || local.addedAt || '';
    const remoteTime = remote.completedAt || remote.addedAt || '';
    return localTime >= remoteTime ? local : remote;
  }

  // Merge two watchlists with union strategy
  function mergeWatchlists(local, remote) {
    const merged = new Map();
    for (const item of remote) {
      merged.set(getItemKey(item), item);
    }
    for (const item of local) {
      const key = getItemKey(item);
      if (merged.has(key)) {
        merged.set(key, pickNewerItem(item, merged.get(key)));
      } else {
        merged.set(key, item);
      }
    }
    return Array.from(merged.values());
  }

  // Merge weekly schedules with union strategy
  function mergeWeekly(local, remote) {
    const merged = {};
    for (const day of Object.keys(DAY_NAMES)) {
      const localShows = local[day] || [];
      const remoteShows = remote[day] || [];
      const seen = new Set();
      const result = [];
      for (const show of remoteShows) {
        seen.add(show.name + '|' + show.type);
        result.push(show);
      }
      for (const show of localShows) {
        if (!seen.has(show.name + '|' + show.type)) result.push(show);
      }
      merged[day] = result;
    }
    return merged;
  }

  // Merge challenges with union strategy
  function mergeChallenges(local, remote) {
    const merged = new Map();
    for (const c of remote) {
      merged.set((c.createdAt || '') + '|' + c.title, c);
    }
    for (const c of local) {
      const key = (c.createdAt || '') + '|' + c.title;
      if (!merged.has(key)) merged.set(key, c);
    }
    return Array.from(merged.values());
  }

  // Save with fetch-merge-save strategy to handle multi-device sync
  async function saveData(retryCount = 0) {
    const token = getToken();
    if (!token || !scheduleData) return false;

    try {
      const currentMonth = getCurrentMonthKey();

      // Filter local watchlist to current month + non-completed
      const localItems = scheduleData.watchlist.filter(item => {
        const month = getMonthKey(item.completedAt);
        return !month || month === currentMonth || item.status !== 'completed';
      });

      // Fetch latest remote data
      const remote = await fetchRemoteData(token);

      // Merge local changes with remote data
      const mergedWatchlist = mergeWatchlists(localItems, remote.data.watchlist || []);
      const mergedWeekly = mergeWeekly(scheduleData.weekly, remote.data.weekly || {});
      const mergedChallenges = mergeChallenges(scheduleData.challenges || [], remote.data.challenges || []);

      const savePayload = {
        weekly: mergedWeekly,
        watchlist: mergedWatchlist,
        challenges: mergedChallenges
      };

      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/schedule.json`, {
        method: 'PUT',
        headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '📊 Update media log',
          content: b64encode(JSON.stringify(savePayload)),
          sha: remote.sha
        })
      });

      if (res.status === 409) {
        if (retryCount < 2) {
          console.log('Conflict during merge-save, retrying...');
          return await saveData(retryCount + 1);
        }
        throw new Error('Conflict after max retries');
      }

      if (!res.ok) {
        console.error('Save failed:', res.status, await res.text());
        throw new Error('Failed');
      }

      const data = await res.json();
      scheduleSha = data.content.sha;

      // Update local state with merged data
      scheduleData.watchlist = mergedWatchlist;
      scheduleData.weekly = mergedWeekly;
      scheduleData.challenges = mergedChallenges;

      showToast('保存しました');
      return true;
    } catch (e) {
      console.error('Save error:', e);
      showToast('保存に失敗しました', 'error');
      return false;
    }
  }

  // Archive past months' data to separate files
  async function archivePastMonths() {
    const token = getToken();
    if (!token || !scheduleData) return;

    const currentMonth = getCurrentMonthKey();

    // Group completed items by month
    const byMonth = {};
    for (const item of scheduleData.watchlist) {
      if (item.status === 'completed' && item.completedAt) {
        const month = getMonthKey(item.completedAt);
        if (month && month < currentMonth) {
          if (!byMonth[month]) byMonth[month] = [];
          byMonth[month].push(item);
        }
      }
    }

    if (Object.keys(byMonth).length === 0) {
      showToast('アーカイブするデータがありません');
      return;
    }

    showToast('アーカイブ中...');

    try {
      for (const [month, items] of Object.entries(byMonth)) {
        const path = `archive/${month}.json`;

        // Check if file exists
        let existingSha = null;
        let existingItems = [];
        try {
          const check = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
            headers: { 'Authorization': `token ${token}` }
          });
          if (check.ok) {
            const fileData = await check.json();
            existingSha = fileData.sha;
            existingItems = JSON.parse(b64decode(fileData.content));
          }
        } catch (e) {}

        // Merge with existing items
        const existingIds = new Set(existingItems.map(i => i.completedAt + i.title));
        for (const item of items) {
          const id = item.completedAt + item.title;
          if (!existingIds.has(id)) {
            existingItems.push(item);
          }
        }

        // Save archive file
        const body = {
          message: `📦 Archive ${month}`,
          content: b64encode(JSON.stringify(existingItems))
        };
        if (existingSha) body.sha = existingSha;

        await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      }

      // Remove archived items from watchlist
      scheduleData.watchlist = scheduleData.watchlist.filter(item => {
        if (item.status !== 'completed' || !item.completedAt) return true;
        const month = getMonthKey(item.completedAt);
        return !month || month >= currentMonth;
      });

      // Save updated schedule.json
      await saveData();
      showToast('アーカイブ完了');
    } catch (e) {
      console.error('Archive error:', e);
      showToast('アーカイブに失敗しました', 'error');
    }
  }

  // Weekly Calendar
  let editingWeekly = false;

  function renderWeeklyCalendar() {
    const container = document.getElementById('weekly-calendar');
    if (!container) return;
    container.classList.toggle('editing', editingWeekly);
    const today = getTodayDayKey();

    let html = '';
    DAY_ORDER.forEach(day => {
      const shows = scheduleData?.weekly[day] || [];
      const isToday = day === today;

      html += `<div class="day-card ${isToday ? 'today' : ''}">
        <div class="day-card-header">
          ${DAY_NAMES[day]}
          ${editingWeekly ? `<button class="day-add-btn" data-day="${day}" title="追加">+</button>` : ''}
        </div>
        ${shows.length === 0 ? '<div class="day-empty">-</div>' : ''}
        ${shows.map((s, i) => `
          <div class="day-show ${s.image ? 'has-image' : ''}">
            ${s.image ? `<img src="${s.image}" class="day-show-img">` : mediaChip(s.type || 'radio', false)}
            ${s.url ? `<a href="${s.url}" target="_blank" class="day-show-name day-show-link">${s.name}</a>` : `<span class="day-show-name">${s.name}</span>`}
            ${editingWeekly ? `
              <span class="day-show-actions">
                <button class="day-edit-btn" data-day="${day}" data-idx="${i}" title="編集">✏️</button>
                <button class="day-move-btn" data-day="${day}" data-idx="${i}" data-dir="up" ${i === 0 ? 'disabled' : ''}>▲</button>
                <button class="day-move-btn" data-day="${day}" data-idx="${i}" data-dir="down" ${i === shows.length - 1 ? 'disabled' : ''}>▼</button>
                <button class="day-del-btn" data-day="${day}" data-idx="${i}">×</button>
              </span>
            ` : `
              <button class="day-record-btn" data-day="${day}" data-idx="${i}" title="記録">✓</button>
            `}
          </div>
        `).join('')}
      </div>`;
    });

    container.innerHTML = html;
    attachWeeklyEvents(container);
  }

  function attachWeeklyEvents(container) {
    // Record button (non-edit mode)
    container.querySelectorAll('.day-record-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        recordRadioShow(btn.dataset.day, parseInt(btn.dataset.idx));
      });
    });

    if (!editingWeekly) return;

    container.querySelectorAll('.day-add-btn').forEach(btn => {
      btn.addEventListener('click', () => openAddRadioModal(btn.dataset.day));
    });

    container.querySelectorAll('.day-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openEditRadioModal(btn.dataset.day, parseInt(btn.dataset.idx)));
    });

    container.querySelectorAll('.day-move-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const day = btn.dataset.day;
        const idx = parseInt(btn.dataset.idx);
        const dir = btn.dataset.dir;
        const shows = scheduleData.weekly[day];

        if (dir === 'up' && idx > 0) {
          [shows[idx - 1], shows[idx]] = [shows[idx], shows[idx - 1]];
        } else if (dir === 'down' && idx < shows.length - 1) {
          [shows[idx], shows[idx + 1]] = [shows[idx + 1], shows[idx]];
        }
        await saveData();
        renderWeeklyCalendar();
      });
    });

    container.querySelectorAll('.day-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const day = btn.dataset.day;
        const idx = parseInt(btn.dataset.idx);
        const show = scheduleData.weekly[day][idx];
        if (!confirm(`「${show.name}」を削除しますか？`)) return;
        scheduleData.weekly[day].splice(idx, 1);
        await saveData();
        renderWeeklyCalendar();
      });
    });
  }

  function recordRadioShow(day, idx) {
    const show = scheduleData.weekly[day][idx];
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');

    content.innerHTML = `
      <div class="episode-record-header">
        <span class="episode-record-title">記録を追加</span>
      </div>
      <div class="form-group">
        <label class="form-label">タイトル</label>
        <input type="text" class="form-input" id="record-title" value="${show.name}">
      </div>
      <div class="form-group">
        <label class="form-label">メモ（任意）</label>
        <textarea class="form-textarea" id="record-note" placeholder="感想やメモを入力..."></textarea>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="btn" id="record-cancel" style="flex:1;">キャンセル</button>
        <button class="btn btn-primary" id="record-save" style="flex:1;">記録</button>
      </div>
    `;

    modal.classList.add('show');

    document.getElementById('record-cancel').addEventListener('click', () => {
      modal.classList.remove('show');
    });

    document.getElementById('record-save').addEventListener('click', async () => {
      const title = document.getElementById('record-title').value.trim() || show.name;
      const note = document.getElementById('record-note').value.trim();

      scheduleData.watchlist.push({
        title,
        type: show.type || 'radio',
        status: 'done',
        completedAt: getAdjustedISOString(),
        image: show.image || undefined,
        note: note || undefined
      });

      await saveData();
      modal.classList.remove('show');
      renderAll();
      showToast(`「${title}」を記録しました`);
    });
  }

  function openEditRadioModal(day, idx) {
    const show = scheduleData.weekly[day][idx];
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');

    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">番組名</label>
        <input type="text" class="form-input" id="edit-radio-name" value="${show.name || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">種類</label>
        <select class="form-select" id="edit-radio-type">
          <option value="radio" ${show.type === 'radio' ? 'selected' : ''}>📻 ラジオ</option>
          <option value="tv" ${show.type === 'tv' ? 'selected' : ''}>📺 テレビ</option>
          <option value="streaming" ${show.type === 'streaming' ? 'selected' : ''}>🎧 配信</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">URL（聴取・視聴リンク）</label>
        <input type="url" class="form-input" id="edit-radio-url" value="${show.url || ''}" placeholder="https://...">
      </div>
      <div class="form-group">
        <label class="form-label">画像</label>
        <div class="image-upload-area">
          ${show.image ? `<img src="${show.image}" class="image-preview" id="image-preview">` : '<div class="image-placeholder" id="image-preview">クリックで画像を設定</div>'}
          <input type="file" id="edit-image-file" accept="image/*" style="display:none">
          <input type="hidden" id="edit-image" value="${show.image || ''}">
        </div>
      </div>
      <button class="btn btn-primary" id="edit-radio-save" style="width:100%;margin-top:12px;">保存</button>
    `;

    modal.classList.add('show');

    // Image upload handlers
    const imagePreview = document.getElementById('image-preview');
    const imageFileInput = document.getElementById('edit-image-file');
    const imageInput = document.getElementById('edit-image');

    imagePreview?.addEventListener('click', () => imageFileInput.click());
    imageFileInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleImageUpload(file, imagePreview, imageInput);
    });

    document.getElementById('edit-radio-save').addEventListener('click', async () => {
      show.name = document.getElementById('edit-radio-name').value.trim();
      show.type = document.getElementById('edit-radio-type').value;
      show.url = document.getElementById('edit-radio-url').value.trim() || undefined;
      show.image = document.getElementById('edit-image').value || undefined;

      await saveData();
      modal.classList.remove('show');
      renderWeeklyCalendar();
      showToast('番組を更新しました');
    });
  }

  function openAddRadioModal(day) {
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');

    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">番組名</label>
        <input type="text" class="form-input" id="add-radio-name" placeholder="番組名を入力">
      </div>
      <div class="form-group">
        <label class="form-label">種類</label>
        <select class="form-select" id="add-radio-type">
          <option value="radio">📻 ラジオ</option>
          <option value="tv">📺 テレビ</option>
          <option value="streaming">🎧 配信</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">URL（聴取・視聴リンク）</label>
        <input type="url" class="form-input" id="add-radio-url" placeholder="https://...">
      </div>
      <button class="btn btn-primary" id="add-radio-save" style="width:100%;margin-top:12px;">追加</button>
    `;

    modal.classList.add('show');

    document.getElementById('add-radio-save').addEventListener('click', async () => {
      const name = document.getElementById('add-radio-name').value.trim();
      const type = document.getElementById('add-radio-type').value;
      const url = document.getElementById('add-radio-url').value.trim();
      if (!name) return;

      if (!scheduleData.weekly[day]) scheduleData.weekly[day] = [];
      scheduleData.weekly[day].push({ name, type, url: url || undefined });

      await saveData();
      modal.classList.remove('show');
      renderWeeklyCalendar();
      showToast('追加しました');
    });
  }

  // Stats
  function renderStats() {
    if (!scheduleData) return;

    const watchlist = scheduleData.watchlist || [];
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    // Count each episode as 1 item
    let yearCount = 0;
    let monthCount = 0;
    watchlist.forEach(item => {
      // Count episode history
      if (item.episodeHistory && item.episodeHistory.length > 0) {
        item.episodeHistory.forEach(ep => {
          const d = new Date(ep.watchedAt);
          if (d.getFullYear() === year) {
            yearCount++;
            if (d.getMonth() === month) monthCount++;
          }
        });
      }
      // Count single items (without episodes)
      if (item.status === 'done' && item.completedAt && !item.episodes) {
        const d = new Date(item.completedAt);
        if (d.getFullYear() === year) {
          yearCount++;
          if (d.getMonth() === month) monthCount++;
        }
      }
    });
    const backlog = watchlist.filter(i => i.status === 'want' || i.status === 'watching');

    const statsRow = document.getElementById('stats-row');
    if (statsRow) {
      statsRow.innerHTML = `
        <div class="stat-card">
          <div class="stat-value">${yearCount}</div>
          <div class="stat-label">${year}年の完了</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${monthCount}</div>
          <div class="stat-label">${month + 1}月の完了</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${backlog.length}</div>
          <div class="stat-label">バックログ</div>
        </div>
      `;
    }
  }

  // Backlog
  function renderBacklog() {
    if (!scheduleData) return;

    const container = document.getElementById('backlog-content');
    if (!container) return;

    const items = scheduleData.watchlist
      .map((item, idx) => ({ ...item, idx }))
      .filter(i => i.status === 'want' || i.status === 'watching');

    if (items.length === 0) {
      container.innerHTML = '<div class="empty">バックログは空です</div>';
      return;
    }

    // Separate watching (priority) items
    const watching = items.filter(i => i.status === 'watching');
    const want = items.filter(i => i.status === 'want');

    // Group want items by category
    const grouped = {};
    want.forEach(item => {
      const type = item.type || 'movie';
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(item);
    });

    let html = '';

    // Priority section (watching)
    if (watching.length > 0) {
      html += `
        <div class="priority-section">
          <div class="section-title">👀 In Progress</div>
          <div class="category-items" data-category="watching">
            ${watching.map((item, i) => renderBacklogItem(item, true, i, watching.length)).join('')}
          </div>
        </div>
      `;
    }

    // Category sections
    const categoryOrder = ['movie', 'anime', 'drama', 'tv', 'comedy', 'game', 'book', 'manga', 'youtube', 'event'];
    categoryOrder.forEach(type => {
      const typeItems = grouped[type];
      if (!typeItems || typeItems.length === 0) return;

      html += `
        <div class="category-section">
          <div class="category-header">
            ${mediaChip(type, false)}
            <span class="category-name">${MEDIA_NAMES[type]}</span>
            <span class="category-count">${typeItems.length}件</span>
          </div>
          <div class="category-items" data-category="${type}">
            ${typeItems.map((item, i) => renderBacklogItem(item, false, i, typeItems.length)).join('')}
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
    attachItemEvents(container);
  }

  function renderBacklogItem(item, isWatching, indexInCategory, categoryLength) {
    const progressText = item.episodes ? `${item.currentEpisode || 0}/${item.episodes}${getEpisodeUnit(item.type)}` : '';
    const progressPct = item.episodes ? Math.round((item.currentEpisode || 0) / item.episodes * 100) : 0;

    return `
      <div class="backlog-item ${isWatching ? 'watching' : ''}">
        ${item.image ? `<img src="${item.image}" class="backlog-item-img ${isWatching ? 'clickable' : ''}" ${isWatching ? `data-idx="${item.idx}" data-action="complete"` : ''} title="${isWatching ? 'クリックで完了' : ''}">` : `
        <button class="backlog-item-status" data-idx="${item.idx}" title="ステータス変更">
          ${STATUS_EMOJI[item.status] || '👀'}
        </button>
        `}
        <div class="backlog-item-content">
          <div class="backlog-item-title">${item.title}</div>
          <div class="backlog-item-meta">
            ${isWatching ? mediaChip(item.type) : ''}
            ${progressText ? `<span class="progress-text">${progressText}</span>` : ''}
          </div>
          ${item.episodes ? `<div class="progress-bar"><div class="progress-fill" style="width:${progressPct}%"></div></div>` : ''}
        </div>
        <div class="backlog-item-actions">
          ${item.episodes ? `<button class="btn btn-sm btn-progress" data-idx="${item.idx}" data-action="progress" title="進捗+1">+1</button>` : ''}
          <button class="btn btn-sm btn-move" data-idx="${item.idx}" data-action="move-up" ${indexInCategory === 0 ? 'disabled' : ''}>▲</button>
          <button class="btn btn-sm btn-move" data-idx="${item.idx}" data-action="move-down" ${indexInCategory === categoryLength - 1 ? 'disabled' : ''}>▼</button>
          <button class="btn btn-sm" data-idx="${item.idx}" data-action="edit">✏️</button>
          <button class="btn btn-sm" data-idx="${item.idx}" data-action="delete">×</button>
        </div>
      </div>
    `;
  }

  function attachItemEvents(container) {
    container.querySelectorAll('.backlog-item-status').forEach(btn => {
      btn.addEventListener('click', () => cycleStatus(parseInt(btn.dataset.idx)));
    });

    container.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => openEditModal(parseInt(btn.dataset.idx)));
    });

    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => deleteItem(parseInt(btn.dataset.idx)));
    });

    container.querySelectorAll('[data-action="progress"]').forEach(btn => {
      btn.addEventListener('click', () => incrementProgress(parseInt(btn.dataset.idx)));
    });

    container.querySelectorAll('[data-action="move-up"]').forEach(btn => {
      btn.addEventListener('click', () => moveItem(parseInt(btn.dataset.idx), 'up'));
    });

    container.querySelectorAll('[data-action="move-down"]').forEach(btn => {
      btn.addEventListener('click', () => moveItem(parseInt(btn.dataset.idx), 'down'));
    });

    container.querySelectorAll('[data-action="complete"]').forEach(img => {
      img.addEventListener('click', () => completeItem(parseInt(img.dataset.idx)));
    });
  }

  async function completeItem(idx) {
    const item = scheduleData.watchlist[idx];
    item.status = 'done';
    item.completedAt = getAdjustedISOString();
    await saveData();
    renderAll();
    showToast(`「${item.title}」完了！`);
  }

  function incrementProgress(idx) {
    const item = scheduleData.watchlist[idx];
    if (!item.episodes) return;

    const newEpisode = Math.min((item.currentEpisode || 0) + 1, item.episodes);
    const isComplete = newEpisode >= item.episodes;

    // Show modal for episode note
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');

    content.innerHTML = `
      <div class="episode-record-header">
        <span class="episode-record-title">${item.title}</span>
        <span class="episode-record-num">第${newEpisode}話${isComplete ? ' (最終話)' : ''}</span>
      </div>
      <div class="form-group">
        <label class="form-label">メモ（任意）</label>
        <textarea class="form-textarea" id="episode-note" placeholder="感想やメモを入力..."></textarea>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="btn" id="episode-skip" style="flex:1;">スキップ</button>
        <button class="btn btn-primary" id="episode-save" style="flex:1;">記録</button>
      </div>
    `;

    modal.classList.add('show');

    const saveEpisode = async (note) => {
      item.currentEpisode = newEpisode;

      // Record episode history
      if (!item.episodeHistory) item.episodeHistory = [];
      item.episodeHistory.push({
        episode: newEpisode,
        watchedAt: getAdjustedISOString(),
        note: note || undefined
      });

      if (isComplete) {
        item.status = 'done';
        item.completedAt = getAdjustedISOString();
        showToast(`「${item.title}」完了！`);
      }

      await saveData();
      modal.classList.remove('show');
      renderAll();
    };

    document.getElementById('episode-skip').addEventListener('click', () => saveEpisode(''));
    document.getElementById('episode-save').addEventListener('click', () => {
      const note = document.getElementById('episode-note').value.trim();
      saveEpisode(note);
    });
  }

  async function moveItem(idx, direction) {
    const item = scheduleData.watchlist[idx];
    const status = item.status || 'want';
    const type = item.type || 'movie';

    // Find items in same category
    const sameCategory = scheduleData.watchlist
      .map((it, i) => ({ ...it, idx: i }))
      .filter(it => (it.status || 'want') === status && (status === 'watching' || (it.type || 'movie') === type));

    const posInCategory = sameCategory.findIndex(it => it.idx === idx);
    if (posInCategory === -1) return;

    const targetPos = direction === 'up' ? posInCategory - 1 : posInCategory + 1;
    if (targetPos < 0 || targetPos >= sameCategory.length) return;

    const targetIdx = sameCategory[targetPos].idx;

    // Swap in the original array
    [scheduleData.watchlist[idx], scheduleData.watchlist[targetIdx]] =
      [scheduleData.watchlist[targetIdx], scheduleData.watchlist[idx]];

    await saveData();
    renderAll();
  }

  async function cycleStatus(idx) {
    const STATUS_CYCLE = ['want', 'watching', 'done', 'hold'];
    const item = scheduleData.watchlist[idx];
    const curr = STATUS_CYCLE.indexOf(item.status || 'want');
    const next = STATUS_CYCLE[(curr + 1) % STATUS_CYCLE.length];

    item.status = next;
    if (next === 'done' && !item.completedAt) {
      item.completedAt = getAdjustedISOString();
    } else if (next !== 'done') {
      delete item.completedAt;
    }

    await saveData();
    renderAll();
  }

  async function deleteItem(idx) {
    if (!confirm('削除しますか？')) return;
    scheduleData.watchlist.splice(idx, 1);
    await saveData();
    renderAll();
  }

  function openEditModal(idx) {
    const item = scheduleData.watchlist[idx];
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');

    const completedDate = item.completedAt ? item.completedAt.split('T')[0] : '';
    const showEpisodes = EPISODE_TYPES.includes(item.type);

    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">タイトル</label>
        <input type="text" class="form-input" id="edit-title" value="${item.title || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">メディア</label>
        <select class="form-select" id="edit-type">
          ${Object.entries(MEDIA_NAMES).map(([k, v]) =>
            `<option value="${k}" ${item.type === k ? 'selected' : ''}>${v}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">ステータス</label>
        <select class="form-select" id="edit-status">
          <option value="want" ${item.status === 'want' ? 'selected' : ''}>☆ 見たい</option>
          <option value="watching" ${item.status === 'watching' ? 'selected' : ''}>👀 視聴中</option>
          <option value="done" ${item.status === 'done' ? 'selected' : ''}>✓ 完了</option>
          <option value="hold" ${item.status === 'hold' ? 'selected' : ''}>⏸ 保留</option>
        </select>
      </div>
      <div class="form-group" id="edit-episodes-group" style="${showEpisodes ? '' : 'display:none'}">
        <label class="form-label" id="edit-episodes-label">${item.type === 'book' ? '章数' : '話数'}（連続ものの場合）</label>
        <div class="episode-inputs">
          <input type="number" class="form-input" id="edit-current-ep" value="${item.currentEpisode || 0}" min="0" placeholder="現在">
          <span class="episode-sep">/</span>
          <input type="number" class="form-input" id="edit-total-ep" value="${item.episodes || ''}" min="1" placeholder="${item.type === 'book' ? '全章数' : '全話数'}">
          <span class="episode-label" id="edit-episode-unit">${getEpisodeUnit(item.type)}</span>
        </div>
      </div>
      <div class="form-group" id="edit-date-group" style="${item.status === 'done' ? '' : 'display:none'}">
        <label class="form-label">完了日</label>
        <input type="date" class="form-input" id="edit-date" value="${completedDate}">
      </div>
      <div class="form-group">
        <label class="form-label">画像</label>
        <div class="image-upload-area">
          ${item.image ? `<img src="${item.image}" class="image-preview" id="image-preview">` : '<div class="image-placeholder" id="image-preview">クリックまたはドロップで画像を追加</div>'}
          <input type="file" id="edit-image-file" accept="image/*" style="display:none">
          <input type="hidden" id="edit-image" value="${item.image || ''}">
        </div>
        ${item.image ? '<button type="button" class="btn btn-sm" id="remove-image" style="margin-top:6px">画像を削除</button>' : ''}
        ${item.type === 'youtube' ? (() => {
          const thumbs = getYoutubeThumbnails().filter(url => url !== item.image);
          if (thumbs.length === 0) return '';
          return `
            <div class="past-thumbnails">
              <div class="past-thumbnails-label">過去のサムネイルから選択</div>
              <div class="past-thumbnails-grid">
                ${thumbs.map(url => `<img src="${url}" class="past-thumbnail" data-url="${url}">`).join('')}
              </div>
            </div>
          `;
        })() : ''}
      </div>
      <div class="form-group">
        <label class="form-label">メモ</label>
        <textarea class="form-textarea" id="edit-note">${item.note || ''}</textarea>
      </div>
      <button class="btn btn-primary" id="edit-save" style="width:100%;margin-top:12px;">保存</button>
    `;

    modal.classList.add('show');

    document.getElementById('edit-type').addEventListener('change', (e) => {
      const episodesGroup = document.getElementById('edit-episodes-group');
      const isEpisodeType = EPISODE_TYPES.includes(e.target.value);
      episodesGroup.style.display = isEpisodeType ? '' : 'none';
      if (isEpisodeType) {
        const unit = getEpisodeUnit(e.target.value);
        document.getElementById('edit-episodes-label').textContent = (e.target.value === 'book' ? '章数' : '話数') + '（連続ものの場合）';
        document.getElementById('edit-episode-unit').textContent = unit;
        document.getElementById('edit-total-ep').placeholder = e.target.value === 'book' ? '全章数' : '全話数';
      }
    });

    // Image upload
    const imagePreview = document.getElementById('image-preview');
    const imageFileInput = document.getElementById('edit-image-file');
    const imageInput = document.getElementById('edit-image');

    imagePreview?.addEventListener('click', () => imageFileInput.click());

    imagePreview?.addEventListener('dragover', (e) => {
      e.preventDefault();
      imagePreview.classList.add('dragover');
    });

    imagePreview?.addEventListener('dragleave', () => {
      imagePreview.classList.remove('dragover');
    });

    imagePreview?.addEventListener('drop', (e) => {
      e.preventDefault();
      imagePreview.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        handleImageUpload(file, imagePreview, imageInput);
      }
    });

    imageFileInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        handleImageUpload(file, imagePreview, imageInput);
      }
    });

    document.getElementById('remove-image')?.addEventListener('click', () => {
      imageInput.value = '';
      imagePreview.outerHTML = '<div class="image-placeholder" id="image-preview">クリックまたはドロップで画像を追加</div>';
    });

    // Past thumbnail selection
    document.querySelectorAll('.past-thumbnail').forEach(thumb => {
      thumb.addEventListener('click', () => {
        const url = thumb.dataset.url;
        imageInput.value = url;
        const preview = document.getElementById('image-preview');
        if (preview.tagName === 'IMG') {
          preview.src = url;
        } else {
          preview.outerHTML = `<img src="${url}" class="image-preview" id="image-preview">`;
        }
        // Highlight selected thumbnail
        document.querySelectorAll('.past-thumbnail').forEach(t => t.classList.remove('selected'));
        thumb.classList.add('selected');
      });
    });

    document.getElementById('edit-status').addEventListener('change', (e) => {
      const dateGroup = document.getElementById('edit-date-group');
      if (e.target.value === 'done') {
        dateGroup.style.display = '';
        if (!document.getElementById('edit-date').value) {
          document.getElementById('edit-date').value = getAdjustedDateString();
        }
      } else {
        dateGroup.style.display = 'none';
      }
    });

    document.getElementById('edit-save').addEventListener('click', async () => {
      item.title = document.getElementById('edit-title').value.trim();
      item.type = document.getElementById('edit-type').value;
      const newStatus = document.getElementById('edit-status').value;
      item.note = document.getElementById('edit-note').value.trim() || undefined;
      item.image = document.getElementById('edit-image').value.trim() || undefined;

      // Episodes
      const totalEp = parseInt(document.getElementById('edit-total-ep').value) || 0;
      const currentEp = parseInt(document.getElementById('edit-current-ep').value) || 0;
      if (totalEp > 0) {
        item.episodes = totalEp;
        item.currentEpisode = Math.min(currentEp, totalEp);
      } else {
        delete item.episodes;
        delete item.currentEpisode;
      }

      if (newStatus === 'done') {
        const dateVal = document.getElementById('edit-date').value;
        const oldDate = item.completedAt ? item.completedAt.split('T')[0] : '';
        if (dateVal && dateVal !== oldDate) {
          // Date changed - set to current time on that date
          const newDate = new Date(dateVal + 'T' + getAdjustedISOString().split('T')[1]);
          item.completedAt = newDate.toISOString();
        } else if (!item.completedAt) {
          item.completedAt = getAdjustedISOString();
        }
        // If date unchanged, keep original completedAt with its time
      } else {
        delete item.completedAt;
      }
      item.status = newStatus;

      await saveData();
      modal.classList.remove('show');
      renderAll();
    });
  }

  // Timeline View
  function renderTimeline() {
    if (!scheduleData) return;

    const container = document.getElementById('timeline-content');
    const contribContainer = document.getElementById('timeline-contrib');
    if (!container) return;

    // Build timeline entries: expand episode history for items with episodes
    const timelineEntries = [];
    scheduleData.watchlist.forEach((item, idx) => {
      // Add episode history entries
      if (item.episodeHistory && item.episodeHistory.length > 0) {
        item.episodeHistory.forEach(ep => {
          timelineEntries.push({
            ...item,
            idx,
            isEpisode: true,
            episodeNum: ep.episode,
            episodeNote: ep.note,
            completedAt: ep.watchedAt,
            displayTitle: `${item.title} 第${ep.episode}話`
          });
        });
      }
      // Add completed item (for items without episode history, or single items like movies)
      if (item.status === 'done' && item.completedAt && !item.episodes) {
        timelineEntries.push({
          ...item,
          idx,
          isEpisode: false,
          displayTitle: item.title
        });
      }
    });

    const doneItems = timelineEntries
      .filter(i => i.completedAt)
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

    // Render compact GitHub-style contrib graph
    if (contribContainer) {
      if (doneItems.length === 0) {
        contribContainer.innerHTML = '';
      } else {
        const byType = {};
        doneItems.forEach(item => {
          const type = item.type || 'movie';
          if (!byType[type]) byType[type] = [];
          byType[type].push(item);
        });

        const categoryOrder = ['movie', 'anime', 'drama', 'tv', 'comedy', 'game', 'book', 'manga', 'youtube', 'radio', 'event'];
        let contribHtml = '<div class="contrib-compact">';
        categoryOrder.forEach(type => {
          const items = byType[type] || [];
          if (items.length === 0) return;
          contribHtml += `<div class="contrib-row-compact">
            <div class="contrib-label-compact">${mediaChip(type)}</div>
            <div class="contrib-squares-compact">
              ${items.map(() => `<div class="contrib-square-sm ${type}"></div>`).join('')}
            </div>
          </div>`;
        });
        contribHtml += '</div>';
        contribContainer.innerHTML = contribHtml;
      }
    }

    if (doneItems.length === 0) {
      container.innerHTML = '<div class="empty">まだ記録がありません</div>';
      return;
    }

    // Timeline view - grouped by date (local timezone)
    const grouped = {};
    doneItems.forEach(item => {
      const dateKey = getLocalDateKey(item.completedAt);
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(item);
    });

    let html = '';
    Object.entries(grouped)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .forEach(([dateKey, items]) => {
        // Sort items within group by time descending (newest first)
        items.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
        const date = formatDate(dateKey);
      html += `<div class="history-group">
        <div class="history-date">${date}</div>
        <div class="history-items">
          ${items.map(item => {
            const isEvent = item.type === 'event';
            const thumbnail = isEvent && item.music?.artwork ? item.music.artwork : item.image;
            const noteText = item.isEpisode ? item.episodeNote : item.note;
            const displayNote = isEvent && noteText ? truncateNote(noteText) : noteText;
            return `
            <div class="history-item ${item.isEpisode ? 'episode-entry' : ''} ${isEvent ? 'event-entry' : ''}">
              ${thumbnail ? `<img src="${thumbnail}" class="history-item-img">` : ''}
              <div class="history-item-body">
                <div class="history-item-header">
                  ${mediaChip(item.type, false)}
                  <span class="history-item-title">${item.displayTitle || item.title}</span>
                </div>
                ${displayNote ? `<div class="history-item-note">${escapeHtml(displayNote)}</div>` : ''}
                ${isEvent && item.music?.title ? `<div class="history-item-music">🎵 ${item.music.title}${item.music.artist ? ' - ' + item.music.artist : ''}</div>` : ''}
              </div>
              <div class="history-item-actions">
                ${item.isEpisode ? `
                <button class="btn btn-sm" data-idx="${item.idx}" data-episode="${item.episodeNum}" data-action="edit-episode">✏️</button>
                ` : isEvent ? `
                <button class="btn btn-sm" data-idx="${item.idx}" data-action="edit-diary">✏️</button>
                <button class="btn btn-sm btn-danger" data-idx="${item.idx}" data-action="delete-diary">🗑️</button>
                ` : `
                <button class="btn btn-sm" data-idx="${item.idx}" data-action="edit-history">✏️</button>
                <button class="btn btn-sm btn-danger" data-idx="${item.idx}" data-action="delete-history">🗑️</button>
                `}
              </div>
            </div>
          `;}).join('')}
        </div>
      </div>`;
    });

    container.innerHTML = html;

    container.querySelectorAll('[data-action="edit-history"]').forEach(btn => {
      btn.addEventListener('click', () => openEditModal(parseInt(btn.dataset.idx)));
    });

    container.querySelectorAll('[data-action="edit-episode"]').forEach(btn => {
      btn.addEventListener('click', () => openEditEpisodeModal(parseInt(btn.dataset.idx), parseInt(btn.dataset.episode)));
    });

    container.querySelectorAll('[data-action="delete-history"]').forEach(btn => {
      btn.addEventListener('click', () => deleteHistoryItem(parseInt(btn.dataset.idx)));
    });

    container.querySelectorAll('[data-action="edit-diary"]').forEach(btn => {
      btn.addEventListener('click', () => openEditDiaryModal(parseInt(btn.dataset.idx)));
    });

    container.querySelectorAll('[data-action="delete-diary"]').forEach(btn => {
      btn.addEventListener('click', () => deleteDiaryEntry(parseInt(btn.dataset.idx)));
    });
  }

  // Shelf View
  function renderShelf() {
    if (!scheduleData) return;

    const container = document.getElementById('shelf-content');
    if (!container) return;

    const doneItems = scheduleData.watchlist
      .map((item, idx) => ({ ...item, idx }))
      .filter(i => i.status === 'done')
      .sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));

    if (doneItems.length === 0) {
      container.innerHTML = '<div class="empty">まだ記録がありません</div>';
      return;
    }

    container.innerHTML = `<div class="shelf-grid">
      ${doneItems.map(item => {
        const thumbnail = item.type === 'event' && item.music?.artwork ? item.music.artwork : item.image;
        return `
        <div class="shelf-item" data-idx="${item.idx}">
          ${thumbnail
            ? `<img class="shelf-cover" src="${thumbnail}" alt="${item.title}">`
            : `<div class="shelf-cover shelf-placeholder">${mediaChip(item.type)}</div>`
          }
          <div class="shelf-title">${item.title}</div>
        </div>
      `;}).join('')}
    </div>`;

    container.querySelectorAll('.shelf-item').forEach(item => {
      item.addEventListener('click', () => openEditModal(parseInt(item.dataset.idx)));
    });
  }

  // Gacha
  function runGacha() {
    if (!scheduleData) return;

    const wantItems = scheduleData.watchlist
      .map((item, idx) => ({ ...item, idx }))
      .filter(i => i.status === 'want' || i.status === 'watching');

    const resultEl = document.getElementById('gacha-result');
    if (!resultEl) return;

    if (wantItems.length === 0) {
      resultEl.innerHTML = '<div class="empty">見たいリストにアイテムがありません</div>';
      return;
    }

    // Show spinning animation
    resultEl.innerHTML = '<div class="gacha-spinning">🎰</div>';

    setTimeout(() => {
      const selected = wantItems[Math.floor(Math.random() * wantItems.length)];
      resultEl.innerHTML = `
        <div class="gacha-item">
          <div class="gacha-item-type">${mediaChip(selected.type)}</div>
          <div class="gacha-item-title">${selected.title}</div>
          ${selected.note ? `<div style="color:var(--text-secondary);font-size:13px;">${selected.note}</div>` : ''}
          <div class="gacha-item-actions">
            <button class="btn" id="gacha-reroll">もう一回</button>
            <button class="btn btn-primary" id="gacha-start" data-idx="${selected.idx}">視聴開始</button>
          </div>
        </div>
      `;

      document.getElementById('gacha-reroll')?.addEventListener('click', runGacha);
      document.getElementById('gacha-start')?.addEventListener('click', async () => {
        const idx = parseInt(document.getElementById('gacha-start').dataset.idx);
        scheduleData.watchlist[idx].status = 'watching';
        await saveData();
        renderAll();
        showToast('視聴開始しました！');
      });
    }, 500);
  }

  // Challenges
  function renderChallenges() {
    if (!scheduleData) return;

    const container = document.getElementById('challenges-content');
    if (!container) return;

    if (!scheduleData.challenges) scheduleData.challenges = [];

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Calculate completed items for current month (including each episode as 1 item)
    const monthlyEntries = [];
    scheduleData.watchlist.forEach(item => {
      const type = item.type || 'movie';
      // Add episode history entries
      if (item.episodeHistory && item.episodeHistory.length > 0) {
        item.episodeHistory.forEach(ep => {
          const d = new Date(ep.watchedAt);
          if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
            monthlyEntries.push({ type, isEpisode: true });
          }
        });
      }
      // Add completed single items (movies, etc. without episodes)
      if (item.status === 'done' && item.completedAt && !item.episodes) {
        const d = new Date(item.completedAt);
        if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
          monthlyEntries.push({ type, isEpisode: false });
        }
      }
    });

    // Group by type
    const monthlyByType = {};
    monthlyEntries.forEach(entry => {
      monthlyByType[entry.type] = (monthlyByType[entry.type] || 0) + 1;
    });

    let html = '';

    // Active challenges
    const activeChallenges = scheduleData.challenges.filter(c => !c.completed);
    if (activeChallenges.length > 0) {
      html += '<div class="challenges-section"><div class="section-title">🎯 進行中のチャレンジ</div>';
      activeChallenges.forEach((challenge, idx) => {
        const progress = calculateChallengeProgress(challenge, monthlyEntries, monthlyByType);
        const pct = Math.min(100, Math.round(progress.current / progress.target * 100));
        const isComplete = progress.current >= progress.target;

        html += `
          <div class="challenge-card ${isComplete ? 'complete' : ''}">
            <div class="challenge-header">
              <span class="challenge-title">${challenge.title}</span>
              <button class="btn btn-sm" data-challenge-idx="${idx}" data-action="delete-challenge">×</button>
            </div>
            <div class="challenge-progress">
              <div class="challenge-progress-bar">
                <div class="challenge-progress-fill" style="width:${pct}%"></div>
              </div>
              <div class="challenge-progress-text">${progress.current} / ${progress.target}</div>
            </div>
            ${isComplete ? '<div class="challenge-complete-badge">🎉 達成！</div>' : ''}
          </div>
        `;
      });
      html += '</div>';
    }

    // Monthly summary
    html += `
      <div class="challenges-section">
        <div class="section-title">📊 今月の実績 (${currentMonth + 1}月)</div>
        <div class="monthly-summary">
          <div class="monthly-total">
            <span class="monthly-total-value">${monthlyEntries.length}</span>
            <span class="monthly-total-label">本完了</span>
          </div>
          <div class="monthly-breakdown">
            ${Object.entries(monthlyByType).map(([type, count]) =>
              `<div class="monthly-type">${mediaChip(type)} ${count}</div>`
            ).join('')}
          </div>
        </div>
      </div>
    `;

    // Add new challenge button
    html += `
      <div class="challenges-section">
        <button class="btn btn-primary" id="btn-add-challenge" style="width:100%;">+ チャレンジを追加</button>
      </div>
    `;

    container.innerHTML = html;

    // Event listeners
    document.getElementById('btn-add-challenge')?.addEventListener('click', openAddChallengeModal);

    container.querySelectorAll('[data-action="delete-challenge"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.challengeIdx);
        if (!confirm('このチャレンジを削除しますか？')) return;
        scheduleData.challenges.splice(idx, 1);
        await saveData();
        renderChallenges();
      });
    });
  }

  function calculateChallengeProgress(challenge, monthlyEntries, monthlyByType) {
    if (challenge.type === 'monthly') {
      return { current: monthlyEntries.length, target: challenge.target };
    } else if (challenge.type === 'genre') {
      return { current: monthlyByType[challenge.mediaType] || 0, target: challenge.target };
    }
    return { current: 0, target: challenge.target };
  }

  function openAddChallengeModal() {
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');

    const now = new Date();
    const monthName = `${now.getMonth() + 1}月`;

    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">チャレンジタイプ</label>
        <select class="form-select" id="challenge-type">
          <option value="monthly">${monthName}に全体で○本完了する</option>
          <option value="genre">${monthName}に[ジャンル]を○本完了する</option>
        </select>
      </div>
      <div class="form-group" id="challenge-genre-group" style="display:none;">
        <label class="form-label">ジャンル</label>
        <select class="form-select" id="challenge-genre">
          ${Object.entries(MEDIA_NAMES).map(([k, v]) =>
            `<option value="${k}">${v}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">目標数</label>
        <input type="number" class="form-input" id="challenge-target" value="5" min="1">
      </div>
      <button class="btn btn-primary" id="challenge-save" style="width:100%;margin-top:12px;">追加</button>
    `;

    modal.classList.add('show');

    document.getElementById('challenge-type').addEventListener('change', (e) => {
      document.getElementById('challenge-genre-group').style.display =
        e.target.value === 'genre' ? '' : 'none';
    });

    document.getElementById('challenge-save').addEventListener('click', async () => {
      const type = document.getElementById('challenge-type').value;
      const target = parseInt(document.getElementById('challenge-target').value) || 5;
      const genre = document.getElementById('challenge-genre').value;

      const now = new Date();
      const monthName = `${now.getMonth() + 1}月`;

      let title;
      if (type === 'monthly') {
        title = `${monthName}に全体で${target}本完了する`;
      } else {
        title = `${monthName}に${MEDIA_NAMES[genre]}を${target}本完了する`;
      }

      if (!scheduleData.challenges) scheduleData.challenges = [];
      scheduleData.challenges.push({
        type,
        target,
        mediaType: type === 'genre' ? genre : null,
        title,
        createdAt: getAdjustedISOString(),
        month: now.getMonth(),
        year: now.getFullYear(),
        completed: false
      });

      await saveData();
      modal.classList.remove('show');
      renderChallenges();
      showToast('チャレンジを追加しました');
    });
  }

  function openEditEpisodeModal(idx, episodeNum) {
    const item = scheduleData.watchlist[idx];
    const episode = item.episodeHistory?.find(ep => ep.episode === episodeNum);
    if (!episode) return;

    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');

    content.innerHTML = `
      <div class="episode-record-header">
        <span class="episode-record-title">${item.title}</span>
        <span class="episode-record-num">第${episodeNum}話</span>
      </div>
      <div class="form-group">
        <label class="form-label">メモ</label>
        <textarea class="form-textarea" id="episode-note">${episode.note || ''}</textarea>
      </div>
      <button class="btn btn-primary" id="episode-update" style="width:100%;margin-top:12px;">保存</button>
    `;

    modal.classList.add('show');

    document.getElementById('episode-update').addEventListener('click', async () => {
      episode.note = document.getElementById('episode-note').value.trim() || undefined;
      await saveData();
      modal.classList.remove('show');
      renderAll();
      showToast('メモを更新しました');
    });
  }

  async function deleteHistoryItem(idx) {
    const item = scheduleData.watchlist[idx];
    if (!confirm(`「${item.title}」を完全に削除しますか？`)) return;

    scheduleData.watchlist.splice(idx, 1);
    await saveData();
    renderAll();
    showToast('削除しました');
  }

  async function undoComplete(idx) {
    const item = scheduleData.watchlist[idx];
    if (!confirm(`「${item.title}」を見たいリストに戻しますか？`)) return;

    item.status = 'want';
    delete item.completedAt;

    await saveData();
    renderAll();
    showToast('見たいリストに戻しました');
  }

  // Monthly Summary
  function renderMonthlySummary() {
    if (!scheduleData) return;

    const container = document.getElementById('summary-content');
    if (!container) return;

    // Build all completed entries with dates
    const entries = [];
    scheduleData.watchlist.forEach(item => {
      const type = item.type || 'movie';
      // Add episode history entries
      if (item.episodeHistory && item.episodeHistory.length > 0) {
        item.episodeHistory.forEach(ep => {
          entries.push({
            type,
            date: new Date(ep.watchedAt),
            title: `${item.title} 第${ep.episode}話`
          });
        });
      }
      // Add single items (without episodes)
      if (item.status === 'done' && item.completedAt && !item.episodes) {
        entries.push({
          type,
          date: new Date(item.completedAt),
          title: item.title
        });
      }
    });

    if (entries.length === 0) {
      container.innerHTML = '<div class="empty">まだ記録がありません</div>';
      return;
    }

    // Group by year-month
    const byMonth = {};
    entries.forEach(entry => {
      const key = `${entry.date.getFullYear()}-${String(entry.date.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth[key]) byMonth[key] = [];
      byMonth[key].push(entry);
    });

    // Sort months descending
    const sortedMonths = Object.keys(byMonth).sort((a, b) => b.localeCompare(a));

    let html = '';
    sortedMonths.forEach(monthKey => {
      const monthEntries = byMonth[monthKey];
      const [year, month] = monthKey.split('-');

      // Count by type
      const typeCount = {};
      monthEntries.forEach(entry => {
        typeCount[entry.type] = (typeCount[entry.type] || 0) + 1;
      });

      const categoryOrder = ['movie', 'anime', 'drama', 'tv', 'comedy', 'game', 'book', 'manga', 'youtube', 'radio', 'streaming', 'event'];

      html += `
        <div class="summary-month">
          <div class="summary-month-header">
            <span class="summary-month-title">${year}年${parseInt(month)}月</span>
            <span class="summary-month-total">${monthEntries.length}本</span>
          </div>
          <div class="summary-types">
            ${categoryOrder.map(type => {
              const count = typeCount[type];
              if (!count) return '';
              return `<div class="summary-type-item">
                ${mediaChip(type, false)}
                <span>${MEDIA_NAMES[type]}</span>
                <span class="summary-type-count">${count}</span>
              </div>`;
            }).join('')}
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  // Quick Add
  async function quickAdd() {
    const title = document.getElementById('quick-title').value.trim();
    const type = document.getElementById('quick-type').value;

    if (!title) return;

    scheduleData.watchlist.push({
      title,
      type,
      status: 'want',
      addedAt: getAdjustedISOString()
    });

    await saveData();
    document.getElementById('quick-title').value = '';
    renderAll();
  }

  // Apple Music API
  async function fetchAppleMusicInfo(url) {
    // Extract track ID from Apple Music URL
    // Format: https://music.apple.com/jp/album/xxx/123?i=456 or https://music.apple.com/jp/song/xxx/456
    const trackIdMatch = url.match(/[?&]i=(\d+)/);
    const songIdMatch = url.match(/\/song\/[^/]+\/(\d+)/);
    const trackId = trackIdMatch ? trackIdMatch[1] : (songIdMatch ? songIdMatch[1] : null);

    if (!trackId) {
      throw new Error('トラックIDが見つかりません');
    }

    // Use iTunes Search API (CORS-friendly)
    const res = await fetch(`https://itunes.apple.com/lookup?id=${trackId}&country=jp`);
    if (!res.ok) throw new Error('API error');

    const data = await res.json();
    if (!data.results || data.results.length === 0) {
      throw new Error('曲が見つかりません');
    }

    const track = data.results[0];
    return {
      title: track.trackName || track.collectionName,
      artist: track.artistName,
      artwork: track.artworkUrl100?.replace('100x100', '400x400') || track.artworkUrl60,
      url: track.trackViewUrl || url
    };
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function truncateNote(text, maxLength = 100) {
    if (!text) return '';
    // Replace newlines with spaces and truncate
    const oneLine = text.replace(/\n+/g, ' ').trim();
    if (oneLine.length <= maxLength) return oneLine;
    return oneLine.substring(0, maxLength) + '...';
  }

  async function saveDiaryEntry() {
    const dateVal = document.getElementById('diary-date').value;
    const title = document.getElementById('diary-title').value.trim();
    const content = document.getElementById('diary-content').value.trim();
    const musicTitle = document.getElementById('diary-music-title').value;
    const musicArtist = document.getElementById('diary-music-artist').value;
    const musicArtwork = document.getElementById('diary-music-artwork').value;
    const musicLink = document.getElementById('diary-music-link').value;

    if (!title && !content) {
      showToast('タイトルか内容を入力してください', 'error');
      return;
    }

    // Use selected date with current time
    const selectedDate = dateVal ? new Date(dateVal + 'T' + new Date().toTimeString().split(' ')[0]) : new Date();

    const entry = {
      title: title || '無題',
      type: 'event',
      status: 'done',
      completedAt: selectedDate.toISOString(),
      note: content || undefined,
      music: (musicTitle || musicArtist) ? {
        title: musicTitle || undefined,
        artist: musicArtist || undefined,
        artwork: musicArtwork || undefined,
        url: musicLink || undefined
      } : undefined
    };

    scheduleData.watchlist.push(entry);
    await saveData();

    // Clear form
    document.getElementById('diary-date').value = getAdjustedDateString();
    document.getElementById('diary-title').value = '';
    document.getElementById('diary-content').value = '';
    clearMusicPreview();

    renderAll();
    showToast('日記を記録しました');
  }

  function clearMusicPreview() {
    document.getElementById('diary-music-url').value = '';
    document.getElementById('diary-music-title').value = '';
    document.getElementById('diary-music-artist').value = '';
    document.getElementById('diary-music-artwork').value = '';
    document.getElementById('diary-music-link').value = '';
    document.getElementById('diary-music-preview').style.display = 'none';
  }

  function openEditDiaryModal(idx) {
    const item = scheduleData.watchlist[idx];
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');

    const hasMusic = item.music && (item.music.title || item.music.artist);
    const dateVal = item.completedAt ? item.completedAt.split('T')[0] : '';

    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">日付</label>
        <input type="date" class="form-input" id="edit-diary-date" value="${dateVal}">
      </div>
      <div class="form-group">
        <label class="form-label">タイトル</label>
        <input type="text" class="form-input" id="edit-diary-title" value="${item.title || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">内容</label>
        <textarea class="form-textarea diary-textarea" id="edit-diary-content">${item.note || ''}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">その時の音楽</label>
        <div class="music-url-row">
          <input type="text" class="form-input" id="edit-diary-music-url" placeholder="Apple Music URLを貼り付け...">
          <button class="btn" id="edit-diary-music-fetch" type="button">取得</button>
        </div>
        <div class="music-preview" id="edit-diary-music-preview" style="display:${hasMusic ? 'flex' : 'none'};">
          ${item.music?.artwork ? `<img class="music-preview-artwork" src="${item.music.artwork}" alt="">` : '<span style="font-size:24px;">🎵</span>'}
          <div class="music-preview-info">
            <div class="music-preview-title">${item.music?.title || ''}</div>
            <div class="music-preview-artist">${item.music?.artist || ''}</div>
          </div>
          <button class="btn btn-sm" id="edit-diary-music-clear" type="button">×</button>
        </div>
        <input type="hidden" id="edit-diary-music-title" value="${item.music?.title || ''}">
        <input type="hidden" id="edit-diary-music-artist" value="${item.music?.artist || ''}">
        <input type="hidden" id="edit-diary-music-artwork" value="${item.music?.artwork || ''}">
        <input type="hidden" id="edit-diary-music-link" value="${item.music?.url || ''}">
      </div>
      <button class="btn btn-primary" id="edit-diary-save" style="width:100%;margin-top:12px;">保存</button>
    `;

    modal.classList.add('show');

    // Fetch music info
    document.getElementById('edit-diary-music-fetch').addEventListener('click', async () => {
      const url = document.getElementById('edit-diary-music-url').value.trim();
      if (!url) {
        showToast('URLを入力してください', 'error');
        return;
      }

      try {
        const btn = document.getElementById('edit-diary-music-fetch');
        btn.textContent = '...';
        btn.disabled = true;

        const info = await fetchAppleMusicInfo(url);

        document.getElementById('edit-diary-music-title').value = info.title || '';
        document.getElementById('edit-diary-music-artist').value = info.artist || '';
        document.getElementById('edit-diary-music-artwork').value = info.artwork || '';
        document.getElementById('edit-diary-music-link').value = info.url || '';

        // Update preview
        const preview = document.getElementById('edit-diary-music-preview');
        preview.innerHTML = `
          <img class="music-preview-artwork" src="${info.artwork || ''}" alt="">
          <div class="music-preview-info">
            <div class="music-preview-title">${info.title || ''}</div>
            <div class="music-preview-artist">${info.artist || ''}</div>
          </div>
          <button class="btn btn-sm" id="edit-diary-music-clear" type="button">×</button>
        `;
        preview.style.display = 'flex';

        // Re-attach clear handler
        document.getElementById('edit-diary-music-clear').addEventListener('click', clearEditMusicPreview);

        btn.textContent = '取得';
        btn.disabled = false;
        showToast('曲情報を取得しました');
      } catch (e) {
        document.getElementById('edit-diary-music-fetch').textContent = '取得';
        document.getElementById('edit-diary-music-fetch').disabled = false;
        showToast(e.message || '取得に失敗しました', 'error');
      }
    });

    function clearEditMusicPreview() {
      document.getElementById('edit-diary-music-url').value = '';
      document.getElementById('edit-diary-music-title').value = '';
      document.getElementById('edit-diary-music-artist').value = '';
      document.getElementById('edit-diary-music-artwork').value = '';
      document.getElementById('edit-diary-music-link').value = '';
      document.getElementById('edit-diary-music-preview').style.display = 'none';
    }

    document.getElementById('edit-diary-music-clear')?.addEventListener('click', clearEditMusicPreview);

    document.getElementById('edit-diary-save').addEventListener('click', async () => {
      const newDateVal = document.getElementById('edit-diary-date').value;
      item.title = document.getElementById('edit-diary-title').value.trim() || '無題';
      item.note = document.getElementById('edit-diary-content').value.trim() || undefined;

      // Update date if changed
      if (newDateVal) {
        const oldDate = item.completedAt ? item.completedAt.split('T')[0] : '';
        if (newDateVal !== oldDate) {
          const newDate = new Date(newDateVal + 'T' + new Date().toTimeString().split(' ')[0]);
          item.completedAt = newDate.toISOString();
        }
      }

      const musicTitle = document.getElementById('edit-diary-music-title').value;
      const musicArtist = document.getElementById('edit-diary-music-artist').value;
      const musicArtwork = document.getElementById('edit-diary-music-artwork').value;
      const musicLink = document.getElementById('edit-diary-music-link').value;

      item.music = (musicTitle || musicArtist) ? {
        title: musicTitle || undefined,
        artist: musicArtist || undefined,
        artwork: musicArtwork || undefined,
        url: musicLink || undefined
      } : undefined;

      await saveData();
      modal.classList.remove('show');
      renderAll();
      showToast('日記を更新しました');
    });
  }

  async function deleteDiaryEntry(idx) {
    const item = scheduleData.watchlist[idx];
    if (!confirm(`「${item.title}」を削除しますか？`)) return;

    scheduleData.watchlist.splice(idx, 1);
    await saveData();
    renderAll();
    showToast('削除しました');
  }

  // Render All
  function renderAll() {
    renderWeeklyCalendar();
    renderStats();
    renderBacklog();
    renderTimeline();
    renderShelf();
    renderMonthlySummary();
    renderChallenges();
  }

  // Init
  async function init() {
    // Tabs
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
      });
    });



    // Diary
    const diaryDateInput = document.getElementById('diary-date');
    if (diaryDateInput) {
      diaryDateInput.value = getAdjustedDateString();
    }
    document.getElementById('diary-save')?.addEventListener('click', saveDiaryEntry);

    document.getElementById('diary-music-fetch')?.addEventListener('click', async () => {
      const url = document.getElementById('diary-music-url').value.trim();
      if (!url) {
        showToast('URLを入力してください', 'error');
        return;
      }

      try {
        const btn = document.getElementById('diary-music-fetch');
        btn.textContent = '...';
        btn.disabled = true;

        const info = await fetchAppleMusicInfo(url);

        document.getElementById('diary-music-title').value = info.title || '';
        document.getElementById('diary-music-artist').value = info.artist || '';
        document.getElementById('diary-music-artwork').value = info.artwork || '';
        document.getElementById('diary-music-link').value = info.url || '';

        // Show preview
        document.getElementById('diary-music-artwork').value = info.artwork || '';
        const preview = document.getElementById('diary-music-preview');
        document.getElementById('diary-music-artwork').setAttribute('data-src', info.artwork || '');
        preview.querySelector('.music-preview-artwork').src = info.artwork || '';
        preview.querySelector('.music-preview-title').textContent = info.title || '';
        preview.querySelector('.music-preview-artist').textContent = info.artist || '';
        preview.style.display = 'flex';

        btn.textContent = '取得';
        btn.disabled = false;
        showToast('曲情報を取得しました');
      } catch (e) {
        document.getElementById('diary-music-fetch').textContent = '取得';
        document.getElementById('diary-music-fetch').disabled = false;
        showToast(e.message || '取得に失敗しました', 'error');
      }
    });

    document.getElementById('diary-music-clear')?.addEventListener('click', clearMusicPreview);

    // Gacha
    document.getElementById('btn-gacha')?.addEventListener('click', runGacha);

    // Quick add
    document.getElementById('quick-add-btn')?.addEventListener('click', quickAdd);
    document.getElementById('quick-title')?.addEventListener('keypress', e => {
      if (e.key === 'Enter') quickAdd();
    });

    // Modals
    document.getElementById('modal-close')?.addEventListener('click', () => {
      document.getElementById('edit-modal').classList.remove('show');
    });

    document.getElementById('edit-modal')?.addEventListener('click', e => {
      if (e.target.id === 'edit-modal') {
        document.getElementById('edit-modal').classList.remove('show');
      }
    });

    // Settings
    document.getElementById('btn-settings')?.addEventListener('click', () => {
      document.getElementById('settings-token').value = getToken();
      document.getElementById('settings-modal').classList.add('show');
    });

    document.getElementById('settings-close')?.addEventListener('click', () => {
      document.getElementById('settings-modal').classList.remove('show');
    });

    document.getElementById('settings-save')?.addEventListener('click', async () => {
      setToken(document.getElementById('settings-token').value.trim());
      document.getElementById('settings-modal').classList.remove('show');
      showToast('設定を保存しました');
      await loadData();
    });

    document.getElementById('settings-archive')?.addEventListener('click', async () => {
      if (confirm('過去月のデータをアーカイブしますか？')) {
        await archivePastMonths();
      }
    });

    // Refresh
    document.getElementById('btn-refresh')?.addEventListener('click', loadData);

    // Weekly edit toggle
    document.getElementById('btn-edit-weekly')?.addEventListener('click', () => {
      editingWeekly = !editingWeekly;
      const btn = document.getElementById('btn-edit-weekly');
      btn.textContent = editingWeekly ? '✓ 完了' : '✏️ 編集';
      btn.classList.toggle('btn-primary', editingWeekly);
      renderWeeklyCalendar();
    });


    // Load
    await loadData();
  }

  async function loadData() {
    await fetchData();
    if (scheduleData) renderAll();
  }

  init();
})();
