// Popup script for Media Log
(function() {
  'use strict';

  // Media type emoji mapping
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

  const DAY_NAMES = {
    mon: '月曜',
    tue: '火曜',
    wed: '水曜',
    thu: '木曜',
    fri: '金曜',
    sat: '土曜',
    sun: '日曜'
  };

  const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  // GitHub settings
  const GITHUB_REPO = 'aztkp/media-log';
  const GITHUB_TOKEN_KEY = 'radiko_github_token';

  let currentVideoInfo = null;
  let currentTabId = null;
  let scheduleData = null;
  let scheduleSha = null;

  // ===== GitHub Token =====
  async function getGitHubToken() {
    const result = await chrome.storage.local.get(GITHUB_TOKEN_KEY);
    return result[GITHUB_TOKEN_KEY] || '';
  }

  async function setGitHubToken(token) {
    await chrome.storage.local.set({ [GITHUB_TOKEN_KEY]: token });
  }

  async function ensureToken() {
    let token = await getGitHubToken();
    if (!token) {
      token = prompt('GitHub Personal Access Token を入力（repo権限必要）\nhttps://github.com/settings/tokens/new');
      if (!token) return null;
      await setGitHubToken(token);
    }
    return token;
  }

  // ===== Tab Management =====
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');

      if (tab.dataset.tab === 'schedule' && !scheduleData) {
        loadScheduleData();
      }
      if (tab.dataset.tab === 'watchlist' && !scheduleData) {
        loadScheduleData().then(() => renderWatchlist());
      } else if (tab.dataset.tab === 'watchlist' && scheduleData) {
        renderWatchlist();
      }
    });
  });

  // ===== Record Tab =====
  const loadingEl = document.getElementById('loading');
  const notYoutubeEl = document.getElementById('not-youtube');
  const contentEl = document.getElementById('content');
  const videoTitleEl = document.getElementById('video-title');
  const videoChannelEl = document.getElementById('video-channel');
  const mediaTypeEl = document.getElementById('media-type');
  const dateSelectEl = document.getElementById('date-select');
  const datePickerEl = document.getElementById('date-picker');
  const dateRowEl = document.getElementById('date-row');
  const memoEl = document.getElementById('memo');
  const btnSaveEl = document.getElementById('btn-save');
  const btnWatchlistEl = document.getElementById('btn-watchlist');
  const btnDeleteEl = document.getElementById('btn-delete');
  const statusEl = document.getElementById('status');

  function formatDateForInput(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function showStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.className = 'status ' + (isError ? 'error' : 'success');
    setTimeout(() => {
      statusEl.textContent = '';
      statusEl.className = 'status';
    }, 3000);
  }

  mediaTypeEl.addEventListener('change', () => {
    const emoji = MEDIA_EMOJI[mediaTypeEl.value];
    btnSaveEl.textContent = `${emoji} 記録`;
  });

  dateSelectEl.addEventListener('change', () => {
    if (dateSelectEl.value === 'custom') {
      dateRowEl.classList.add('show-picker');
      datePickerEl.value = formatDateForInput(new Date());
    } else {
      dateRowEl.classList.remove('show-picker');
    }
  });

  function getSelectedDate() {
    const choice = dateSelectEl.value;
    if (choice === 'publish' && currentVideoInfo?.publishDate) {
      return new Date(currentVideoInfo.publishDate);
    } else if (choice === 'custom' && datePickerEl.value) {
      return new Date(datePickerEl.value + 'T00:00:00');
    }
    return new Date();
  }

  function sendMessage(action, data = {}) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(currentTabId, { action, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  btnSaveEl.addEventListener('click', async () => {
    if (!currentVideoInfo) return;

    const mediaType = mediaTypeEl.value;
    const emoji = MEDIA_EMOJI[mediaType];

    btnSaveEl.disabled = true;
    btnSaveEl.textContent = '保存中...';

    try {
      const targetDate = getSelectedDate();
      const response = await sendMessage('save', {
        entry: {
          title: currentVideoInfo.title,
          channel: currentVideoInfo.channel,
          url: currentVideoInfo.url,
          memo: memoEl.value.trim(),
          mediaType: mediaType,
          emoji: emoji
        },
        targetDate: targetDate.toISOString()
      });

      if (response?.success) {
        showStatus('✓ 記録しました');
        memoEl.value = '';
        updateDeleteButton();
      } else {
        showStatus(response?.error || '保存失敗', true);
      }
    } catch (e) {
      showStatus('エラー: ' + e.message, true);
    }

    btnSaveEl.disabled = false;
    btnSaveEl.textContent = `${emoji} 記録`;
  });

  // Watchlist button handler
  btnWatchlistEl.addEventListener('click', async () => {
    if (!currentVideoInfo) return;

    btnWatchlistEl.disabled = true;
    btnWatchlistEl.textContent = '...';

    try {
      const token = await ensureToken();
      if (!token) {
        showStatus('トークンが必要です', true);
        return;
      }

      // Load schedule data if not loaded
      if (!scheduleData) {
        await loadScheduleData();
      }

      // Add to watchlist
      const mediaType = mediaTypeEl.value;
      scheduleData.watchlist = scheduleData.watchlist || [];
      scheduleData.watchlist.push({
        title: currentVideoInfo.title,
        channel: currentVideoInfo.channel,
        url: currentVideoInfo.url,
        type: mediaType,
        status: 'want',
        addedAt: new Date().toISOString()
      });

      await saveScheduleData();
      showStatus('✓ 見たいリストに追加しました');
    } catch (e) {
      showStatus('エラー: ' + e.message, true);
    }

    btnWatchlistEl.disabled = false;
    btnWatchlistEl.textContent = '👀';
  });

  btnDeleteEl.addEventListener('click', async () => {
    try {
      const lastEntry = await sendMessage('getLastEntry');
      if (!lastEntry) {
        showStatus('削除できるエントリがありません', true);
        return;
      }

      if (!confirm(`「${lastEntry.title}」を削除しますか？`)) return;

      btnDeleteEl.disabled = true;
      btnDeleteEl.textContent = '...';

      const response = await sendMessage('delete');

      if (response?.success) {
        showStatus('✓ 削除しました');
        updateDeleteButton();
      } else {
        showStatus(response?.error || '削除失敗', true);
      }
    } catch (e) {
      showStatus('エラー: ' + e.message, true);
    }

    btnDeleteEl.disabled = false;
    btnDeleteEl.textContent = '🗑️';
  });

  async function updateDeleteButton() {
    try {
      const lastEntry = await sendMessage('getLastEntry');
      btnDeleteEl.disabled = !lastEntry;
    } catch (e) {
      btnDeleteEl.disabled = true;
    }
  }

  async function initRecordTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab.url || !tab.url.includes('youtube.com/watch')) {
        loadingEl.style.display = 'none';
        notYoutubeEl.style.display = 'block';
        return;
      }

      currentTabId = tab.id;

      const info = await sendMessage('getInfo');

      if (!info) {
        loadingEl.style.display = 'none';
        notYoutubeEl.style.display = 'block';
        return;
      }

      currentVideoInfo = info;

      videoTitleEl.textContent = info.title;
      videoChannelEl.textContent = info.channel;

      if (info.publishDate) {
        const pd = new Date(info.publishDate);
        const publishOption = dateSelectEl.querySelector('option[value="publish"]');
        publishOption.textContent = `投稿日 (${pd.getFullYear()}/${pd.getMonth() + 1}/${pd.getDate()})`;
        publishOption.disabled = false;
      }

      datePickerEl.value = formatDateForInput(new Date());
      await updateDeleteButton();

      loadingEl.style.display = 'none';
      contentEl.style.display = 'block';

    } catch (e) {
      console.error('Popup init error:', e);
      loadingEl.style.display = 'none';
      notYoutubeEl.style.display = 'block';
    }
  }

  // ===== Watchlist Tab =====
  const watchlistLoadingEl = document.getElementById('watchlist-loading');
  const watchlistContentEl = document.getElementById('watchlist-content');
  const watchlistStatusEl = document.getElementById('watchlist-status');
  const watchlistCategoriesEl = document.getElementById('watchlist-categories');
  const watchlistTitleEl = document.getElementById('watchlist-title');
  const watchlistTypeEl = document.getElementById('watchlist-type');
  const watchlistAddBtnEl = document.getElementById('watchlist-add-btn');

  // Category display order and names
  const WATCHLIST_CATEGORIES = {
    movie: '🎬 映画',
    anime: '🎌 アニメ',
    drama: '📺 ドラマ',
    game: '🎮 ゲーム',
    book: '📖 本',
    manga: '📚 漫画',
    youtube: '▶️ YouTube'
  };

  let currentFilter = 'all';
  let currentStatus = 'all';

  const STATUS_LABELS = {
    want: '👀',
    watching: '📺',
    done: '✓',
    hold: '⏸'
  };

  function showWatchlistStatus(message, isError = false) {
    watchlistStatusEl.textContent = message;
    watchlistStatusEl.style.color = isError ? '#f44336' : '#4caf50';
    setTimeout(() => {
      watchlistStatusEl.textContent = '';
    }, 3000);
  }

  // Filter button handlers (media type)
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderWatchlist();
    });
  });

  // Status filter handlers
  document.querySelectorAll('.status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentStatus = btn.dataset.status;
      renderWatchlist();
    });
  });

  // Add button handler
  if (watchlistAddBtnEl) {
    watchlistAddBtnEl.addEventListener('click', async () => {
      const title = watchlistTitleEl.value.trim();
      const type = watchlistTypeEl.value;

      if (!title) return;

      const token = await ensureToken();
      if (!token) {
        showWatchlistStatus('トークンが必要です', true);
        return;
      }

      if (!scheduleData) {
        await loadScheduleData();
      }

      scheduleData.watchlist = scheduleData.watchlist || [];
      scheduleData.watchlist.push({
        title: title,
        type: type,
        status: 'want',
        addedAt: new Date().toISOString()
      });

      await saveScheduleData();
      watchlistTitleEl.value = '';
      renderWatchlist();
      showWatchlistStatus('✓ 追加しました');
    });
  }

  function renderWatchlist() {
    if (!scheduleData || !watchlistCategoriesEl) return;

    const watchlist = scheduleData.watchlist || [];
    const statsEl = document.getElementById('watchlist-stats');

    // Calculate yearly stats
    const currentYear = new Date().getFullYear();
    const yearlyStats = {};
    watchlist.forEach(item => {
      if (item.status === 'done' && item.completedAt) {
        const year = new Date(item.completedAt).getFullYear();
        if (!yearlyStats[year]) yearlyStats[year] = {};
        const cat = item.type || 'movie';
        yearlyStats[year][cat] = (yearlyStats[year][cat] || 0) + 1;
      }
      // Also count old completed items (migrated data)
      if (item.completed && !item.status) {
        item.status = 'done';
      }
    });

    // Render stats
    if (statsEl) {
      const thisYearStats = yearlyStats[currentYear] || {};
      const statsHtml = Object.keys(WATCHLIST_CATEGORIES)
        .filter(cat => thisYearStats[cat])
        .map(cat => `<span class="watchlist-stats-item">${MEDIA_EMOJI[cat]}${thisYearStats[cat]}</span>`)
        .join('');

      statsEl.innerHTML = `
        <div class="watchlist-stats-year">${currentYear}年の記録</div>
        <div class="watchlist-stats-items">${statsHtml || '<span style="color:#666;">まだ記録なし</span>'}</div>
      `;
    }

    // Group by category, applying filters
    const grouped = {};
    watchlist.forEach((item, idx) => {
      const cat = item.type || 'movie';
      const status = item.status || (item.completed ? 'done' : 'want');

      // Apply status filter
      if (currentStatus !== 'all' && status !== currentStatus) return;

      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push({ ...item, idx, status });
    });

    // Determine which categories to show
    const categoriesToShow = currentFilter === 'all'
      ? Object.keys(WATCHLIST_CATEGORIES)
      : [currentFilter];

    // Render by category
    let html = '';
    categoriesToShow.forEach(cat => {
      const items = grouped[cat] || [];
      if (items.length === 0) return;

      const counts = { want: 0, watching: 0, done: 0, hold: 0 };
      items.forEach(i => counts[i.status || 'want']++);

      html += `
        <div class="watchlist-category">
          <div class="watchlist-category-header">
            <span>${WATCHLIST_CATEGORIES[cat]}</span>
            <span class="watchlist-category-count">${counts.want + counts.watching}件${counts.done > 0 ? ` ✓${counts.done}` : ''}</span>
          </div>
          ${items.map(item => `
            <div class="watchlist-item ${item.status === 'done' ? 'completed' : ''}">
              <button class="watchlist-item-status" data-idx="${item.idx}" title="ステータス変更">${STATUS_LABELS[item.status] || '👀'}</button>
              <div style="flex:1;min-width:0;">
                <div class="watchlist-item-title">${item.title}</div>
                ${item.note ? `<div class="watchlist-item-note">${item.note}</div>` : ''}
              </div>
              ${item.url ? `<a href="${item.url}" target="_blank" style="color:#4caf50;text-decoration:none;padding:2px;">▶</a>` : ''}
              <button class="watchlist-delete schedule-item-delete" data-idx="${item.idx}">×</button>
            </div>
          `).join('')}
        </div>
      `;
    });

    if (html === '') {
      html = '<div class="schedule-empty" style="text-align:center;padding:24px 0;">リストは空です</div>';
    }

    watchlistCategoriesEl.innerHTML = html;

    // Status cycle handlers: want -> watching -> done -> hold -> want
    const STATUS_CYCLE = ['want', 'watching', 'done', 'hold'];
    watchlistCategoriesEl.querySelectorAll('.watchlist-item-status').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.idx);
        const item = scheduleData.watchlist[idx];
        const currentStatusVal = item.status || (item.completed ? 'done' : 'want');
        const currentIdx = STATUS_CYCLE.indexOf(currentStatusVal);
        const nextStatus = STATUS_CYCLE[(currentIdx + 1) % STATUS_CYCLE.length];

        item.status = nextStatus;

        // Track completion date
        if (nextStatus === 'done' && !item.completedAt) {
          item.completedAt = new Date().toISOString();
        } else if (nextStatus !== 'done') {
          delete item.completedAt;
        }

        // Sync old completed field
        item.completed = (nextStatus === 'done');

        await saveScheduleData();
        renderWatchlist();
      });
    });

    // Delete handlers
    watchlistCategoriesEl.querySelectorAll('.watchlist-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.idx);
        scheduleData.watchlist.splice(idx, 1);
        await saveScheduleData();
        renderWatchlist();
        showWatchlistStatus('✓ 削除しました');
      });
    });

    watchlistLoadingEl.style.display = 'none';
    watchlistContentEl.style.display = 'block';
  }

  // ===== Schedule Tab =====
  const scheduleLoadingEl = document.getElementById('schedule-loading');
  const scheduleContentEl = document.getElementById('schedule-content');
  const scheduleStatusEl = document.getElementById('schedule-status');

  function showScheduleStatus(message, isError = false) {
    scheduleStatusEl.textContent = message;
    scheduleStatusEl.style.color = isError ? '#f44336' : '#4caf50';
    setTimeout(() => {
      scheduleStatusEl.textContent = '';
    }, 3000);
  }

  async function loadScheduleData() {
    const token = await ensureToken();
    if (!token) {
      scheduleLoadingEl.textContent = 'トークンが必要です';
      watchlistLoadingEl.textContent = 'トークンが必要です';
      return;
    }

    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/schedule.json`, {
        headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
      });

      if (!res.ok) throw new Error('データの読み込み失敗');

      const data = await res.json();
      scheduleSha = data.sha;
      // UTF-8 safe decode
      const binary = atob(data.content.replace(/\n/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      scheduleData = JSON.parse(new TextDecoder('utf-8').decode(bytes));

      // Ensure watchlist exists
      if (!scheduleData.watchlist) {
        scheduleData.watchlist = [];
      }

      renderSchedule();
      scheduleLoadingEl.style.display = 'none';
      scheduleContentEl.style.display = 'block';
    } catch (e) {
      console.error('Schedule load error:', e);
      scheduleLoadingEl.textContent = 'エラー: ' + e.message;
      watchlistLoadingEl.textContent = 'エラー: ' + e.message;
    }
  }

  function renderSchedule() {
    scheduleContentEl.innerHTML = '';

    DAY_ORDER.forEach(day => {
      const items = scheduleData.weekly[day] || [];
      const dayEl = document.createElement('div');
      dayEl.className = 'schedule-day';
      dayEl.innerHTML = `
        <div class="schedule-day-header">
          <span class="schedule-day-name">${DAY_NAMES[day]}</span>
          <button class="schedule-add-btn" data-day="${day}">+</button>
        </div>
        <div class="schedule-items" data-day="${day}">
          ${items.length === 0 ? '<div class="schedule-empty">番組なし</div>' : ''}
          ${items.map((item, idx) => `
            <div class="schedule-item">
              <span>${MEDIA_EMOJI[item.type] || '📻'}</span>
              <span class="schedule-item-name">${item.name}</span>
              <div class="schedule-item-actions">
                <button class="schedule-item-move" data-day="${day}" data-idx="${idx}" data-dir="up" ${idx === 0 ? 'disabled' : ''}>▲</button>
                <button class="schedule-item-move" data-day="${day}" data-idx="${idx}" data-dir="down" ${idx === items.length - 1 ? 'disabled' : ''}>▼</button>
                <button class="schedule-item-delete" data-day="${day}" data-idx="${idx}">×</button>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="add-form" data-day="${day}">
          <input type="text" placeholder="番組名" class="add-name">
          <select class="add-type">
            <option value="radio">📻</option>
            <option value="tv">📺</option>
            <option value="anime">🎌</option>
            <option value="streaming">🎧</option>
          </select>
          <button class="add-confirm">追加</button>
        </div>
      `;
      scheduleContentEl.appendChild(dayEl);
    });

    // Add button handlers
    scheduleContentEl.querySelectorAll('.schedule-add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const form = scheduleContentEl.querySelector(`.add-form[data-day="${btn.dataset.day}"]`);
        form.classList.toggle('show');
        form.querySelector('.add-name').focus();
      });
    });

    // Confirm add handlers
    scheduleContentEl.querySelectorAll('.add-confirm').forEach(btn => {
      btn.addEventListener('click', async () => {
        const form = btn.closest('.add-form');
        const day = form.dataset.day;
        const name = form.querySelector('.add-name').value.trim();
        const type = form.querySelector('.add-type').value;

        if (!name) return;

        scheduleData.weekly[day].push({ name, type });
        await saveScheduleData();
        renderSchedule();
      });
    });

    // Delete handlers
    scheduleContentEl.querySelectorAll('.schedule-item-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const day = btn.dataset.day;
        const idx = parseInt(btn.dataset.idx);

        scheduleData.weekly[day].splice(idx, 1);
        await saveScheduleData();
        renderSchedule();
      });
    });

    // Move handlers (reorder)
    scheduleContentEl.querySelectorAll('.schedule-item-move').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;

        const day = btn.dataset.day;
        const idx = parseInt(btn.dataset.idx);
        const dir = btn.dataset.dir;
        const items = scheduleData.weekly[day];

        if (dir === 'up' && idx > 0) {
          // Swap with previous item
          [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]];
        } else if (dir === 'down' && idx < items.length - 1) {
          // Swap with next item
          [items[idx], items[idx + 1]] = [items[idx + 1], items[idx]];
        }

        await saveScheduleData();
        renderSchedule();
      });
    });
  }

  async function saveScheduleData() {
    const token = await getGitHubToken();
    if (!token) return;

    try {
      const content = JSON.stringify(scheduleData, null, 2);
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/schedule.json`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: '📅 Update schedule',
          content: btoa(String.fromCharCode(...new TextEncoder().encode(content))),
          sha: scheduleSha
        })
      });

      if (!res.ok) throw new Error('保存失敗');

      const data = await res.json();
      scheduleSha = data.content.sha;

      // Update README
      await updateReadmeSchedule(token);

      showScheduleStatus('✓ 保存しました');
    } catch (e) {
      console.error('Schedule save error:', e);
      showScheduleStatus('エラー: ' + e.message, true);
    }
  }

  async function updateReadmeSchedule(token) {
    try {
      // Get current README
      const getRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/README.md`, {
        headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
      });

      if (!getRes.ok) return;

      const data = await getRes.json();
      // UTF-8 safe decode
      const binary = atob(data.content.replace(/\n/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      let content = new TextDecoder('utf-8').decode(bytes);

      // Build schedule table
      let scheduleTable = '| 曜日 | 番組 |\n|:--:|:--|\n';
      DAY_ORDER.forEach(day => {
        const items = scheduleData.weekly[day] || [];
        const dayName = DAY_NAMES[day].replace('曜', '');
        if (items.length === 0) {
          scheduleTable += `| ${dayName} | |\n`;
        } else {
          const itemStr = items.map(i => `${MEDIA_EMOJI[i.type] || '📻'} ${i.name}`).join('<br>');
          scheduleTable += `| ${dayName} | ${itemStr} |\n`;
        }
      });

      // Replace schedule section
      const scheduleStart = content.indexOf('## 週間スケジュール');
      const scheduleEnd = content.indexOf('\n---', scheduleStart);

      if (scheduleStart !== -1 && scheduleEnd !== -1) {
        const beforeSchedule = content.slice(0, scheduleStart);
        const afterSchedule = content.slice(scheduleEnd);
        content = beforeSchedule + '## 週間スケジュール\n\n毎週の定期視聴番組\n\n' + scheduleTable + afterSchedule;

        await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/README.md`, {
          method: 'PUT',
          headers: {
            'Authorization': `token ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: '📅 Update weekly schedule',
            content: btoa(String.fromCharCode(...new TextEncoder().encode(content))),
            sha: data.sha
          })
        });
      }
    } catch (e) {
      console.error('README update error:', e);
    }
  }

  // Initialize
  initRecordTab();
})();
