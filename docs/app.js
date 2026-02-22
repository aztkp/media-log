// Media Log Web App
(function() {
  'use strict';

  const GITHUB_REPO = 'aztkp/media-log';
  const STORAGE_KEY = 'media_log_token';

  const MEDIA_NAMES = {
    movie: '映画', anime: 'アニメ', drama: 'ドラマ', tv: 'テレビ',
    game: 'ゲーム', book: '本', manga: '漫画', radio: 'ラジオ', streaming: '配信'
  };

  function mediaChip(type, showLabel = true) {
    const name = MEDIA_NAMES[type] || type;
    return `<span class="media-chip ${type}">${showLabel ? name : ''}</span>`;
  }

  const STATUS_EMOJI = { want: '☆', watching: '👀', done: '✓', hold: '⏸' };
  const DAY_NAMES = { mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土', sun: '日' };
  const DAY_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  let scheduleData = null;
  let scheduleSha = null;
  let currentAllFilter = 'all';

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
            <div class="crop-box" id="crop-box"></div>
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
      const container = img.parentElement;
      let cropX = 0, cropY = 0, cropSize = 0;
      let imgOffsetX = 0, imgOffsetY = 0;
      let isDragging = false;
      let startX, startY, startCropX, startCropY;

      img.onload = () => {
        const imgRect = img.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        imgOffsetX = imgRect.left - containerRect.left;
        imgOffsetY = imgRect.top - containerRect.top;
        cropSize = Math.min(imgRect.width, imgRect.height);
        cropX = (imgRect.width - cropSize) / 2;
        cropY = (imgRect.height - cropSize) / 2;
        updateCropBox();
      };

      function updateCropBox() {
        cropBox.style.width = cropSize + 'px';
        cropBox.style.height = cropSize + 'px';
        cropBox.style.left = (cropX + imgOffsetX) + 'px';
        cropBox.style.top = (cropY + imgOffsetY) + 'px';
      }

      cropBox.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startCropX = cropX;
        startCropY = cropY;
        e.preventDefault();
      });

      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', () => isDragging = false);

      cropBox.addEventListener('touchstart', (e) => {
        isDragging = true;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startCropX = cropX;
        startCropY = cropY;
        e.preventDefault();
      });

      document.addEventListener('touchmove', handleMove);
      document.addEventListener('touchend', () => isDragging = false);

      function handleMove(e) {
        if (!isDragging) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const rect = img.getBoundingClientRect();

        cropX = Math.max(0, Math.min(rect.width - cropSize, startCropX + (clientX - startX)));
        cropY = Math.max(0, Math.min(rect.height - cropSize, startCropY + (clientY - startY)));
        updateCropBox();
      }

      function cleanup() {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('touchmove', handleMove);
        modal.remove();
      }

      document.getElementById('crop-cancel').onclick = () => { cleanup(); resolve(null); };
      document.getElementById('crop-cancel-btn').onclick = () => { cleanup(); resolve(null); };

      document.getElementById('crop-confirm').onclick = () => {
        const rect = img.getBoundingClientRect();
        const scaleX = img.naturalWidth / rect.width;
        const scaleY = img.naturalHeight / rect.height;

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

  function getTodayDayKey() {
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    return days[new Date().getDay()];
  }

  // API
  async function fetchData() {
    const token = getToken();
    if (!token) {
      document.getElementById('settings-modal').classList.add('show');
      return null;
    }

    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/schedule.json`, {
        headers: { 'Authorization': `token ${token}` }
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      scheduleSha = data.sha;
      scheduleData = JSON.parse(b64decode(data.content));
      if (!scheduleData.watchlist) scheduleData.watchlist = [];
      if (!scheduleData.weekly) scheduleData.weekly = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
      return scheduleData;
    } catch (e) {
      showToast('データの読み込みに失敗しました', 'error');
      return null;
    }
  }

  async function saveData() {
    const token = getToken();
    if (!token || !scheduleData) return false;

    try {
      // Always get latest SHA before saving to avoid conflicts
      if (!scheduleSha) {
        const latest = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/schedule.json`, {
          headers: { 'Authorization': `token ${token}` }
        });
        if (latest.ok) {
          const latestData = await latest.json();
          scheduleSha = latestData.sha;
        }
      }

      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/schedule.json`, {
        method: 'PUT',
        headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '📊 Update media log',
          content: b64encode(JSON.stringify(scheduleData, null, 2)),
          sha: scheduleSha
        })
      });

      if (res.status === 409) {
        // SHA conflict - fetch latest and retry once
        console.log('SHA conflict, fetching latest...');
        const latest = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/schedule.json`, {
          headers: { 'Authorization': `token ${token}` }
        });
        if (latest.ok) {
          const latestData = await latest.json();
          scheduleSha = latestData.sha;
          // Retry once
          const retry = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/schedule.json`, {
            method: 'PUT',
            headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: '📊 Update media log',
              content: b64encode(JSON.stringify(scheduleData, null, 2)),
              sha: scheduleSha
            })
          });
          if (retry.ok) {
            const data = await retry.json();
            scheduleSha = data.content.sha;
            showToast('保存しました');
            return true;
          }
        }
      }

      if (!res.ok) {
        console.error('Save failed:', res.status, await res.text());
        throw new Error('Failed');
      }

      const data = await res.json();
      scheduleSha = data.content.sha;
      showToast('保存しました');
      return true;
    } catch (e) {
      console.error('Save error:', e);
      showToast('保存に失敗しました', 'error');
      return false;
    }
  }

  // Weekly Calendar
  let editingWeekly = false;

  function renderWeeklyCalendar() {
    const container = document.getElementById('weekly-calendar');
    if (!container) return;
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
            <span class="day-show-name">${s.name}</span>
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

  async function recordRadioShow(day, idx) {
    const show = scheduleData.weekly[day][idx];

    scheduleData.watchlist.push({
      title: show.name,
      type: show.type || 'radio',
      status: 'done',
      completedAt: new Date().toISOString(),
      image: show.image || undefined
    });

    await saveData();
    renderAll();
    showToast(`「${show.name}」を記録しました`);
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
      <button class="btn btn-primary" id="add-radio-save" style="width:100%;margin-top:12px;">追加</button>
    `;

    modal.classList.add('show');

    document.getElementById('add-radio-save').addEventListener('click', async () => {
      const name = document.getElementById('add-radio-name').value.trim();
      const type = document.getElementById('add-radio-type').value;
      if (!name) return;

      if (!scheduleData.weekly[day]) scheduleData.weekly[day] = [];
      scheduleData.weekly[day].push({ name, type });

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

    const yearDone = watchlist.filter(i => i.status === 'done' && i.completedAt && new Date(i.completedAt).getFullYear() === year);
    const monthDone = yearDone.filter(i => new Date(i.completedAt).getMonth() === month);
    const backlog = watchlist.filter(i => i.status === 'want' || i.status === 'watching');

    const statsRow = document.getElementById('stats-row');
    if (statsRow) {
      statsRow.innerHTML = `
        <div class="stat-card">
          <div class="stat-value">${yearDone.length}</div>
          <div class="stat-label">${year}年の完了</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${monthDone.length}</div>
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
          <div class="section-title">👀 視聴中・優先</div>
          <div class="category-items" data-category="watching">
            ${watching.map((item, i) => renderBacklogItem(item, true, i, watching.length)).join('')}
          </div>
        </div>
      `;
    }

    // Category sections
    const categoryOrder = ['movie', 'anime', 'drama', 'tv', 'game', 'book', 'manga'];
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
    const progressText = item.episodes ? `${item.currentEpisode || 0}/${item.episodes}話` : '';
    const progressPct = item.episodes ? Math.round((item.currentEpisode || 0) / item.episodes * 100) : 0;

    return `
      <div class="backlog-item ${isWatching ? 'watching' : ''}">
        <button class="backlog-item-status" data-idx="${item.idx}" title="ステータス変更">
          ${STATUS_EMOJI[item.status] || '👀'}
        </button>
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
  }

  async function incrementProgress(idx) {
    const item = scheduleData.watchlist[idx];
    if (!item.episodes) return;

    item.currentEpisode = Math.min((item.currentEpisode || 0) + 1, item.episodes);

    if (item.currentEpisode >= item.episodes) {
      item.status = 'done';
      item.completedAt = new Date().toISOString();
      showToast(`「${item.title}」完了！`);
    }

    await saveData();
    renderAll();
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
      item.completedAt = new Date().toISOString();
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
    const showEpisodes = ['anime', 'drama', 'tv'].includes(item.type);

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
        <label class="form-label">話数（連続ものの場合）</label>
        <div class="episode-inputs">
          <input type="number" class="form-input" id="edit-current-ep" value="${item.currentEpisode || 0}" min="0" placeholder="現在">
          <span class="episode-sep">/</span>
          <input type="number" class="form-input" id="edit-total-ep" value="${item.episodes || ''}" min="1" placeholder="全話数">
          <span class="episode-label">話</span>
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
      episodesGroup.style.display = ['anime', 'drama', 'tv'].includes(e.target.value) ? '' : 'none';
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

    document.getElementById('edit-status').addEventListener('change', (e) => {
      const dateGroup = document.getElementById('edit-date-group');
      if (e.target.value === 'done') {
        dateGroup.style.display = '';
        if (!document.getElementById('edit-date').value) {
          document.getElementById('edit-date').value = new Date().toISOString().split('T')[0];
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
        if (dateVal) {
          item.completedAt = new Date(dateVal).toISOString();
        } else if (!item.completedAt) {
          item.completedAt = new Date().toISOString();
        }
      } else {
        delete item.completedAt;
      }
      item.status = newStatus;

      await saveData();
      modal.classList.remove('show');
      renderAll();
    });
  }

  // History
  let historyViewMode = 'list';

  function renderHistory() {
    if (!scheduleData) return;

    const container = document.getElementById('history-content');
    const contribContainer = document.getElementById('history-contrib');
    if (!container) return;

    const doneItems = scheduleData.watchlist
      .map((item, idx) => ({ ...item, idx }))
      .filter(i => i.status === 'done' && i.completedAt)
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

        const categoryOrder = ['movie', 'anime', 'drama', 'tv', 'game', 'book', 'manga', 'radio'];
        let contribHtml = '<div class="contrib-compact">';
        categoryOrder.forEach(type => {
          const items = byType[type] || [];
          if (items.length === 0) return;
          contribHtml += `<div class="contrib-row-compact">
            ${mediaChip(type, false)}
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

    let html = '';

    if (historyViewMode === 'shelf') {
      // Shelf view - simple tile grid
      html = `<div class="shelf-grid">
        ${doneItems.map(item => `
          <div class="shelf-item" data-idx="${item.idx}">
            ${item.image
              ? `<img class="shelf-cover" src="${item.image}" alt="${item.title}">`
              : `<div class="shelf-cover shelf-placeholder">${mediaChip(item.type)}</div>`
            }
            <div class="shelf-title">${item.title}</div>
          </div>
        `).join('')}
      </div>`;
    } else {
      // Timeline view - grouped by date
      const grouped = {};
      doneItems.forEach(item => {
        const date = formatDate(item.completedAt);
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push(item);
      });

      Object.entries(grouped).forEach(([date, items]) => {
        html += `<div class="history-group">
          <div class="history-date">${date}</div>
          <div class="history-items">
            ${items.map(item => `
              <div class="history-item">
                ${item.image ? `<img src="${item.image}" class="history-item-img">` : ''}
                <div class="history-item-body">
                  <div class="history-item-header">
                    ${mediaChip(item.type, false)}
                    <span class="history-item-title">${item.title}</span>
                  </div>
                  ${item.note ? `<div class="history-item-note">${item.note}</div>` : ''}
                </div>
                <div class="history-item-actions">
                  <button class="btn btn-sm" data-idx="${item.idx}" data-action="edit-history">✏️</button>
                  <button class="btn btn-sm btn-danger" data-idx="${item.idx}" data-action="delete-history">🗑️</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>`;
      });
    }

    container.innerHTML = html;

    // Attach events
    container.querySelectorAll('.shelf-item').forEach(item => {
      item.addEventListener('click', () => openEditModal(parseInt(item.dataset.idx)));
    });

    container.querySelectorAll('[data-action="edit-history"]').forEach(btn => {
      btn.addEventListener('click', () => openEditModal(parseInt(btn.dataset.idx)));
    });

    container.querySelectorAll('[data-action="delete-history"]').forEach(btn => {
      btn.addEventListener('click', () => deleteHistoryItem(parseInt(btn.dataset.idx)));
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

  // All List
  function renderAllList() {
    if (!scheduleData) return;

    const container = document.getElementById('all-content');
    const contribContainer = document.getElementById('all-contrib');
    if (!container) return;

    // Render GitHub-style contribution graph for done items
    if (contribContainer) {
      const doneItems = scheduleData.watchlist.filter(i => i.status === 'done');
      const byType = {};
      doneItems.forEach(item => {
        const type = item.type || 'movie';
        if (!byType[type]) byType[type] = [];
        byType[type].push(item);
      });

      const categoryOrder = ['movie', 'anime', 'drama', 'tv', 'game', 'book', 'manga'];
      let contribHtml = '<div class="contrib-grid">';
      categoryOrder.forEach(type => {
        const items = byType[type] || [];
        if (items.length === 0) return;
        contribHtml += `<div class="contrib-row">
          <div class="contrib-label">${mediaChip(type)} <span class="contrib-count">${items.length}</span></div>
          <div class="contrib-squares">
            ${items.map(() => `<div class="contrib-square ${type}"></div>`).join('')}
          </div>
        </div>`;
      });
      contribHtml += '</div>';
      contribContainer.innerHTML = doneItems.length > 0 ? contribHtml : '';
    }

    let items = scheduleData.watchlist.map((item, idx) => ({ ...item, idx }));

    if (currentAllFilter !== 'all') {
      items = items.filter(i => (i.status || 'want') === currentAllFilter);
    }

    if (items.length === 0) {
      container.innerHTML = '<div class="empty">アイテムがありません</div>';
      return;
    }

    container.innerHTML = items.map(item => `
      <div class="backlog-item">
        <button class="backlog-item-status" data-idx="${item.idx}">
          ${STATUS_EMOJI[item.status] || '👀'}
        </button>
        <div class="backlog-item-content">
          <div class="backlog-item-title">${item.title}</div>
          <div class="backlog-item-meta">${mediaChip(item.type)}</div>
        </div>
        <div class="backlog-item-actions">
          <button class="btn btn-sm" data-idx="${item.idx}" data-action="edit">✏️</button>
          <button class="btn btn-sm" data-idx="${item.idx}" data-action="delete">×</button>
        </div>
      </div>
    `).join('');

    attachItemEvents(container);
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
      addedAt: new Date().toISOString()
    });

    await saveData();
    document.getElementById('quick-title').value = '';
    renderAll();
  }

  // Render All
  function renderAll() {
    renderWeeklyCalendar();
    renderStats();
    renderBacklog();
    renderHistory();
    renderAllList();
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


    // All list filters
    document.querySelectorAll('#all-filters .filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#all-filters .filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentAllFilter = btn.dataset.filter;
        renderAllList();
      });
    });

    // History view toggle
    document.getElementById('btn-view-list')?.addEventListener('click', () => {
      historyViewMode = 'list';
      document.getElementById('btn-view-list').classList.add('active');
      document.getElementById('btn-view-shelf').classList.remove('active');
      renderHistory();
    });

    document.getElementById('btn-view-shelf')?.addEventListener('click', () => {
      historyViewMode = 'shelf';
      document.getElementById('btn-view-shelf').classList.add('active');
      document.getElementById('btn-view-list').classList.remove('active');
      renderHistory();
    });

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
