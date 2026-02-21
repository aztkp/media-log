// Media Log Web App
(function() {
  'use strict';

  const GITHUB_REPO = 'aztkp/media-log';
  const STORAGE_KEY = 'media_log_token';

  const MEDIA_EMOJI = {
    radio: '📻',
    tv: '📺',
    movie: '🎬',
    streaming: '🎧',
    anime: '🎌',
    drama: '📺',
    game: '🎮',
    book: '📖',
    manga: '📚',
    youtube: '▶️'
  };

  const MEDIA_NAMES = {
    movie: '映画',
    anime: 'アニメ',
    drama: 'ドラマ',
    game: 'ゲーム',
    book: '本',
    manga: '漫画',
    youtube: 'YouTube',
    radio: 'ラジオ',
    tv: 'テレビ',
    streaming: '配信'
  };

  const STATUS_LABELS = {
    want: '👀 見たい',
    watching: '📺 視聴中',
    done: '✓ 完了',
    hold: '⏸ 保留'
  };

  const STATUS_EMOJI = {
    want: '👀',
    watching: '📺',
    done: '✓',
    hold: '⏸'
  };

  const DAY_NAMES = {
    mon: '月曜', tue: '火曜', wed: '水曜', thu: '木曜',
    fri: '金曜', sat: '土曜', sun: '日曜'
  };

  const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  let scheduleData = null;
  let scheduleSha = null;
  let currentMediaFilter = 'all';
  let currentStatusFilter = 'all';
  let searchQuery = '';

  // ===== Utils =====
  function b64decode(str) {
    const binary = atob(str.replace(/\n/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  }

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    return btoa(String.fromCharCode(...bytes));
  }

  function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + type + ' show';
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  function getToken() {
    return localStorage.getItem(STORAGE_KEY) || '';
  }

  function setToken(token) {
    localStorage.setItem(STORAGE_KEY, token);
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }

  // ===== API =====
  async function fetchScheduleData() {
    const token = getToken();
    if (!token) {
      document.getElementById('settings-modal').classList.add('show');
      return null;
    }

    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/schedule.json`, {
        headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
      });

      if (!res.ok) throw new Error('Failed to fetch');

      const data = await res.json();
      scheduleSha = data.sha;
      scheduleData = JSON.parse(b64decode(data.content));

      if (!scheduleData.watchlist) scheduleData.watchlist = [];
      if (!scheduleData.weekly) scheduleData.weekly = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };

      return scheduleData;
    } catch (e) {
      console.error('Fetch error:', e);
      showToast('データの読み込みに失敗しました', 'error');
      return null;
    }
  }

  async function saveScheduleData() {
    const token = getToken();
    if (!token || !scheduleData) return false;

    try {
      const content = JSON.stringify(scheduleData, null, 2);
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/schedule.json`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: '📊 Update media log',
          content: b64encode(content),
          sha: scheduleSha
        })
      });

      if (!res.ok) throw new Error('Failed to save');

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

  // ===== Stats =====
  function updateStats() {
    if (!scheduleData) return;

    const watchlist = scheduleData.watchlist || [];
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // Year stats
    const yearItems = watchlist.filter(item => {
      if (item.status !== 'done' || !item.completedAt) return false;
      const d = new Date(item.completedAt);
      return d.getFullYear() === currentYear;
    });

    const yearByType = {};
    yearItems.forEach(item => {
      const type = item.type || 'movie';
      yearByType[type] = (yearByType[type] || 0) + 1;
    });

    document.getElementById('stats-year-total').textContent = yearItems.length;
    document.getElementById('stats-year-detail').textContent = `${currentYear}年に完了したコンテンツ`;
    document.getElementById('stats-year-breakdown').innerHTML = Object.entries(yearByType)
      .map(([type, count]) => `<div class="stats-item">${MEDIA_EMOJI[type]} <span class="stats-item-count">${count}</span></div>`)
      .join('');

    // Month stats
    const monthItems = watchlist.filter(item => {
      if (item.status !== 'done' || !item.completedAt) return false;
      const d = new Date(item.completedAt);
      return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    });

    const monthByType = {};
    monthItems.forEach(item => {
      const type = item.type || 'movie';
      monthByType[type] = (monthByType[type] || 0) + 1;
    });

    document.getElementById('stats-month-total').textContent = monthItems.length;
    document.getElementById('stats-month-detail').textContent = `${currentMonth + 1}月に完了したコンテンツ`;
    document.getElementById('stats-month-breakdown').innerHTML = Object.entries(monthByType)
      .map(([type, count]) => `<div class="stats-item">${MEDIA_EMOJI[type]} <span class="stats-item-count">${count}</span></div>`)
      .join('');

    // Backlog stats
    const backlogItems = watchlist.filter(item => item.status === 'want' || item.status === 'watching');
    const backlogByType = {};
    backlogItems.forEach(item => {
      const type = item.type || 'movie';
      backlogByType[type] = (backlogByType[type] || 0) + 1;
    });

    document.getElementById('stats-backlog-total').textContent = backlogItems.length;
    document.getElementById('stats-backlog-breakdown').innerHTML = Object.entries(backlogByType)
      .map(([type, count]) => `<div class="stats-item">${MEDIA_EMOJI[type]} <span class="stats-item-count">${count}</span></div>`)
      .join('');
  }

  // ===== Watchlist =====
  function renderWatchlist() {
    if (!scheduleData) return;

    const container = document.getElementById('watchlist-content');
    const watchlist = scheduleData.watchlist || [];

    // Filter items
    let filtered = watchlist.map((item, idx) => ({ ...item, idx }));

    if (currentMediaFilter !== 'all') {
      filtered = filtered.filter(item => item.type === currentMediaFilter);
    }

    if (currentStatusFilter !== 'all') {
      filtered = filtered.filter(item => (item.status || 'want') === currentStatusFilter);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        item.title.toLowerCase().includes(q) ||
        (item.note && item.note.toLowerCase().includes(q))
      );
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📭</div>
          <div>該当するアイテムがありません</div>
        </div>
      `;
      return;
    }

    // Group by type
    const grouped = {};
    filtered.forEach(item => {
      const type = item.type || 'movie';
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(item);
    });

    let html = '';
    Object.keys(MEDIA_NAMES).forEach(type => {
      const items = grouped[type];
      if (!items || items.length === 0) return;

      const doneCount = items.filter(i => i.status === 'done').length;
      const pendingCount = items.length - doneCount;

      html += `
        <div class="category-section">
          <div class="category-header">
            <div class="category-title">
              ${MEDIA_EMOJI[type]} ${MEDIA_NAMES[type]}
            </div>
            <div class="category-count">${pendingCount}件${doneCount > 0 ? ` / ✓${doneCount}` : ''}</div>
          </div>
          <div class="watchlist-grid">
            ${items.map(item => renderItemCard(item)).join('')}
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    // Attach event listeners
    container.querySelectorAll('.item-status-btn').forEach(btn => {
      btn.addEventListener('click', () => cycleStatus(parseInt(btn.dataset.idx)));
    });

    container.querySelectorAll('.item-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openEditModal(parseInt(btn.dataset.idx)));
    });

    container.querySelectorAll('.item-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteItem(parseInt(btn.dataset.idx)));
    });
  }

  function renderItemCard(item) {
    const status = item.status || 'want';
    const isCompleted = status === 'done';

    return `
      <div class="item-card ${isCompleted ? 'completed' : ''}">
        <div class="item-card-header">
          <button class="item-status-btn" data-idx="${item.idx}" title="ステータス変更">
            ${STATUS_EMOJI[status]}
          </button>
          <div class="item-title">${item.title}</div>
        </div>
        <div class="item-meta">
          <span class="item-tag">${STATUS_LABELS[status]}</span>
          ${item.completedAt ? `<span class="item-tag">✓ ${formatDate(item.completedAt)}</span>` : ''}
          ${item.url ? `<a href="${item.url}" target="_blank" class="item-tag" style="color: var(--accent);">🔗 リンク</a>` : ''}
        </div>
        ${item.note ? `<div class="item-note">${item.note}</div>` : ''}
        <div class="item-actions">
          <button class="item-action-btn item-edit-btn" data-idx="${item.idx}">✏️ 編集</button>
          <button class="item-action-btn item-delete-btn danger" data-idx="${item.idx}">🗑️ 削除</button>
        </div>
      </div>
    `;
  }

  async function cycleStatus(idx) {
    const STATUS_CYCLE = ['want', 'watching', 'done', 'hold'];
    const item = scheduleData.watchlist[idx];
    const currentStatus = item.status || 'want';
    const currentIdx = STATUS_CYCLE.indexOf(currentStatus);
    const nextStatus = STATUS_CYCLE[(currentIdx + 1) % STATUS_CYCLE.length];

    item.status = nextStatus;

    if (nextStatus === 'done' && !item.completedAt) {
      item.completedAt = new Date().toISOString();
    } else if (nextStatus !== 'done') {
      delete item.completedAt;
    }

    await saveScheduleData();
    updateStats();
    renderWatchlist();
  }

  async function deleteItem(idx) {
    const item = scheduleData.watchlist[idx];
    if (!confirm(`「${item.title}」を削除しますか？`)) return;

    scheduleData.watchlist.splice(idx, 1);
    await saveScheduleData();
    updateStats();
    renderWatchlist();
  }

  function openEditModal(idx) {
    const item = scheduleData.watchlist[idx];
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');

    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">タイトル</label>
        <input type="text" class="form-input" id="edit-title" value="${item.title || ''}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">メディア</label>
          <select class="form-select" id="edit-type">
            ${Object.entries(MEDIA_NAMES).map(([key, name]) =>
              `<option value="${key}" ${item.type === key ? 'selected' : ''}>${MEDIA_EMOJI[key]} ${name}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">ステータス</label>
          <select class="form-select" id="edit-status">
            ${Object.entries(STATUS_LABELS).map(([key, label]) =>
              `<option value="${key}" ${(item.status || 'want') === key ? 'selected' : ''}>${label}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">URL</label>
        <input type="text" class="form-input" id="edit-url" value="${item.url || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">メモ</label>
        <textarea class="form-textarea" id="edit-note">${item.note || ''}</textarea>
      </div>
      <div class="form-row" style="margin-top: 16px;">
        <button class="btn btn-primary" id="edit-save">保存</button>
      </div>
    `;

    modal.classList.add('show');

    document.getElementById('edit-save').addEventListener('click', async () => {
      item.title = document.getElementById('edit-title').value.trim();
      item.type = document.getElementById('edit-type').value;
      item.status = document.getElementById('edit-status').value;
      item.url = document.getElementById('edit-url').value.trim() || undefined;
      item.note = document.getElementById('edit-note').value.trim() || undefined;

      if (item.status === 'done' && !item.completedAt) {
        item.completedAt = new Date().toISOString();
      } else if (item.status !== 'done') {
        delete item.completedAt;
      }

      await saveScheduleData();
      modal.classList.remove('show');
      updateStats();
      renderWatchlist();
    });
  }

  // ===== History =====
  function renderHistory() {
    if (!scheduleData) return;

    const container = document.getElementById('history-content');
    const watchlist = scheduleData.watchlist || [];

    // Get completed items
    const completed = watchlist
      .filter(item => item.status === 'done' && item.completedAt)
      .map((item, idx) => ({ ...item, idx }))
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

    if (completed.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📭</div>
          <div>完了した記録がありません</div>
        </div>
      `;
      return;
    }

    // Group by date
    const grouped = {};
    completed.forEach(item => {
      const date = formatDate(item.completedAt);
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(item);
    });

    let html = '<div class="history-timeline">';
    Object.entries(grouped).forEach(([date, items]) => {
      html += `
        <div class="history-date-group">
          <div class="history-date">${date}</div>
          <div class="history-items">
            ${items.map(item => `
              <div class="history-item">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                  <span style="font-size: 24px;">${MEDIA_EMOJI[item.type] || '🎬'}</span>
                  <div>
                    <div style="font-weight: 500;">${item.title}</div>
                    <div style="font-size: 12px; color: var(--text-muted);">${MEDIA_NAMES[item.type] || ''}</div>
                  </div>
                </div>
                ${item.note ? `<div class="item-note">${item.note}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    });
    html += '</div>';

    container.innerHTML = html;
  }

  // ===== Schedule =====
  function renderSchedule() {
    if (!scheduleData) return;

    const container = document.getElementById('schedule-content');

    let html = '<div class="schedule-grid">';
    DAY_ORDER.forEach(day => {
      const items = scheduleData.weekly[day] || [];

      html += `
        <div class="schedule-day">
          <div class="schedule-day-header">
            <span class="schedule-day-name">${DAY_NAMES[day]}</span>
            <button class="btn" style="padding: 4px 8px; font-size: 12px;" data-day="${day}" data-action="add">+</button>
          </div>
          <div class="schedule-items" data-day="${day}">
            ${items.length === 0 ? '<div style="color: var(--text-muted); font-size: 12px;">番組なし</div>' : ''}
            ${items.map((item, idx) => `
              <div class="schedule-item">
                <span>${MEDIA_EMOJI[item.type] || '📻'}</span>
                <span class="schedule-item-name">${item.name}</span>
                <div class="schedule-item-actions">
                  <button class="schedule-item-btn" data-day="${day}" data-idx="${idx}" data-action="up" ${idx === 0 ? 'disabled' : ''}>▲</button>
                  <button class="schedule-item-btn" data-day="${day}" data-idx="${idx}" data-action="down" ${idx === items.length - 1 ? 'disabled' : ''}>▼</button>
                  <button class="schedule-item-btn" data-day="${day}" data-idx="${idx}" data-action="delete">×</button>
                </div>
              </div>
            `).join('')}
          </div>
          <div class="schedule-add-form" data-day="${day}">
            <div class="form-row">
              <input type="text" class="form-input" placeholder="番組名" data-day="${day}" data-field="name" style="font-size: 12px; padding: 8px;">
              <select class="form-select" data-day="${day}" data-field="type" style="font-size: 12px; padding: 8px; width: auto;">
                <option value="radio">📻</option>
                <option value="tv">📺</option>
                <option value="anime">🎌</option>
                <option value="streaming">🎧</option>
              </select>
            </div>
            <button class="btn btn-primary" style="width: 100%; margin-top: 8px; font-size: 12px;" data-day="${day}" data-action="confirm">追加</button>
          </div>
        </div>
      `;
    });
    html += '</div>';

    container.innerHTML = html;

    // Add event listeners
    container.querySelectorAll('[data-action="add"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const form = container.querySelector(`.schedule-add-form[data-day="${btn.dataset.day}"]`);
        form.classList.toggle('show');
      });
    });

    container.querySelectorAll('[data-action="confirm"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const day = btn.dataset.day;
        const nameInput = container.querySelector(`input[data-day="${day}"][data-field="name"]`);
        const typeSelect = container.querySelector(`select[data-day="${day}"][data-field="type"]`);
        const name = nameInput.value.trim();
        const type = typeSelect.value;

        if (!name) return;

        scheduleData.weekly[day].push({ name, type });
        await saveScheduleData();
        renderSchedule();
      });
    });

    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const day = btn.dataset.day;
        const idx = parseInt(btn.dataset.idx);
        scheduleData.weekly[day].splice(idx, 1);
        await saveScheduleData();
        renderSchedule();
      });
    });

    container.querySelectorAll('[data-action="up"], [data-action="down"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        const day = btn.dataset.day;
        const idx = parseInt(btn.dataset.idx);
        const items = scheduleData.weekly[day];

        if (btn.dataset.action === 'up' && idx > 0) {
          [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]];
        } else if (btn.dataset.action === 'down' && idx < items.length - 1) {
          [items[idx], items[idx + 1]] = [items[idx + 1], items[idx]];
        }

        await saveScheduleData();
        renderSchedule();
      });
    });
  }

  // ===== Add Item =====
  async function addItem() {
    const title = document.getElementById('add-title').value.trim();
    const type = document.getElementById('add-type').value;
    const status = document.getElementById('add-status').value;
    const url = document.getElementById('add-url').value.trim();
    const note = document.getElementById('add-note').value.trim();

    if (!title) {
      showToast('タイトルを入力してください', 'error');
      return;
    }

    const item = {
      title,
      type,
      status,
      addedAt: new Date().toISOString()
    };

    if (url) item.url = url;
    if (note) item.note = note;

    if (status === 'done') {
      item.completedAt = new Date().toISOString();
    }

    scheduleData.watchlist.push(item);
    await saveScheduleData();

    // Clear form
    document.getElementById('add-title').value = '';
    document.getElementById('add-url').value = '';
    document.getElementById('add-note').value = '';

    showToast('追加しました');
    updateStats();
    renderWatchlist();

    // Switch to watchlist tab
    document.querySelector('[data-tab="watchlist"]').click();
  }

  // ===== Init =====
  async function init() {
    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');

        if (tab.dataset.tab === 'history') renderHistory();
        if (tab.dataset.tab === 'schedule') renderSchedule();
      });
    });

    // Media filters
    document.querySelectorAll('#media-filters .filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#media-filters .filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMediaFilter = btn.dataset.filter;
        renderWatchlist();
      });
    });

    // Status filters
    document.querySelectorAll('#status-filters .filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#status-filters .filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentStatusFilter = btn.dataset.status;
        renderWatchlist();
      });
    });

    // Search
    document.getElementById('search-input').addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderWatchlist();
    });

    // Add item
    document.getElementById('add-submit').addEventListener('click', addItem);

    // Modals
    document.getElementById('modal-close').addEventListener('click', () => {
      document.getElementById('edit-modal').classList.remove('show');
    });

    document.getElementById('edit-modal').addEventListener('click', (e) => {
      if (e.target.id === 'edit-modal') {
        document.getElementById('edit-modal').classList.remove('show');
      }
    });

    // Settings
    document.getElementById('btn-settings').addEventListener('click', () => {
      document.getElementById('settings-token').value = getToken();
      document.getElementById('settings-modal').classList.add('show');
    });

    document.getElementById('settings-close').addEventListener('click', () => {
      document.getElementById('settings-modal').classList.remove('show');
    });

    document.getElementById('settings-save').addEventListener('click', async () => {
      const token = document.getElementById('settings-token').value.trim();
      setToken(token);
      document.getElementById('settings-modal').classList.remove('show');
      showToast('設定を保存しました');
      await loadData();
    });

    // Refresh
    document.getElementById('btn-refresh').addEventListener('click', loadData);

    // Load data
    await loadData();
  }

  async function loadData() {
    await fetchScheduleData();
    if (scheduleData) {
      updateStats();
      renderWatchlist();
    }
  }

  // Start
  init();
})();
