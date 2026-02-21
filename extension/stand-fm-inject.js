// Stand.fm Radio Log - Record Stand.fm episodes to GitHub
(function() {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');

  // ===== GitHub Settings =====
  const GITHUB_TOKEN_KEY = 'radiko_github_token';
  const GITHUB_REPO = 'aztkp/media-log';
  const LAST_ENTRY_KEY = 'radiko_last_entry_standfm';

  function getGitHubToken() {
    return localStorage.getItem(GITHUB_TOKEN_KEY) || '';
  }

  function setGitHubToken(token) {
    localStorage.setItem(GITHUB_TOKEN_KEY, token);
  }

  // ===== Last Entry Storage (for delete feature) =====
  function saveLastEntry(entry) {
    localStorage.setItem(LAST_ENTRY_KEY, JSON.stringify(entry));
  }

  function getLastEntry() {
    const data = localStorage.getItem(LAST_ENTRY_KEY);
    return data ? JSON.parse(data) : null;
  }

  function clearLastEntry() {
    localStorage.removeItem(LAST_ENTRY_KEY);
  }

  // ===== Stand.fm Info =====
  function getEpisodeInfo() {
    // Get data from __NEXT_DATA__ script tag
    const nextDataEl = document.getElementById('__NEXT_DATA__');
    if (!nextDataEl) return null;

    try {
      const data = JSON.parse(nextDataEl.textContent);
      const props = data?.props?.pageProps;

      if (!props) return null;

      // Get episode ID from URL
      const match = window.location.pathname.match(/\/episodes\/([^/]+)/);
      if (!match) return null;

      const episodeId = match[1];
      const episode = props.episodes?.[episodeId] || props.episode;
      if (!episode) return null;

      // Get channel info
      const channelId = episode.channelId;
      const channel = props.channels?.[channelId] || props.channel;

      const title = episode.title || 'Unknown Title';
      const channelName = channel?.title || 'Unknown Channel';
      const url = window.location.href;

      // Publish date from Unix timestamp (milliseconds)
      let publishDate = null;
      if (episode.publishedAt) {
        publishDate = new Date(episode.publishedAt);
      } else if (episode.createdAt) {
        publishDate = new Date(episode.createdAt);
      }

      return { title, channel: channelName, url, publishDate };
    } catch (e) {
      console.error('[StandFmRadio] Failed to parse __NEXT_DATA__:', e);
      return null;
    }
  }

  // ===== Toast Notification =====
  function showToast(msg, duration = 2000) {
    let toast = document.getElementById('standfm-radio-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'standfm-radio-toast';
      toast.style.cssText = `
        position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
        background: #333; color: #fff; padding: 12px 24px; border-radius: 8px;
        font-size: 14px; z-index: 99999; opacity: 0; transition: opacity 0.3s;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => { toast.style.opacity = '0'; }, duration);
  }

  // ===== GitHub Save =====
  async function saveToGitHub(entry, targetDate) {
    let token = getGitHubToken();
    if (!token) {
      token = prompt('GitHub Personal Access Token を入力（repo権限必要）\nhttps://github.com/settings/tokens/new');
      if (!token) return false;
      setGitHubToken(token);
    }

    const yearMonth = `${targetDate.getFullYear()}-${pad(targetDate.getMonth() + 1)}`;
    const filePath = `logs/${yearMonth}.md`;
    const day = targetDate.getDate();
    const month = targetDate.getMonth() + 1;

    // Build entry markdown
    let entryMd = `### 🎙️ ${entry.channel} - ${entry.title}\n\n`;
    if (entry.memo) {
      entryMd += `> ${entry.memo}\n\n`;
    }
    entryMd += `[stand.fm](${entry.url})\n\n---\n\n`;

    try {
      // Get current file
      const getRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`, {
        headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
      });

      let content, sha;
      if (getRes.ok) {
        const data = await getRes.json();
        sha = data.sha;
        content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
      } else {
        content = `# ${targetDate.getFullYear()}年${month}月\n\n`;
      }

      // Add day section if needed
      const dayHeader = `## ${month}/${day}`;
      if (!content.includes(dayHeader)) {
        content += `${dayHeader}\n\n`;
      }

      // Insert entry after day header
      const dayIdx = content.indexOf(dayHeader);
      const insertPos = content.indexOf('\n\n', dayIdx) + 2;
      content = content.slice(0, insertPos) + entryMd + content.slice(insertPos);

      // Commit to GitHub
      const putBody = {
        message: `🎙️ ${entry.channel} - ${entry.title}`,
        content: btoa(unescape(encodeURIComponent(content)))
      };
      if (sha) putBody.sha = sha;

      const putRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(putBody)
      });

      if (!putRes.ok) {
        const err = await putRes.json();
        if (err.message?.includes('Bad credentials')) {
          localStorage.removeItem(GITHUB_TOKEN_KEY);
          showToast('トークン無効 - 再入力');
          return false;
        }
        throw new Error(err.message);
      }

      // Update calendar
      const shortTitle = entry.title.length > 15 ? entry.title.slice(0, 14) + '…' : entry.title;
      await updateCalendar(token, targetDate, shortTitle);

      // Save last entry info for delete feature
      saveLastEntry({
        title: entry.title,
        channel: entry.channel,
        url: entry.url,
        shortTitle: shortTitle,
        filePath: filePath,
        dayHeader: dayHeader,
        targetDate: targetDate.toISOString(),
        savedAt: new Date().toISOString()
      });

      return true;
    } catch (e) {
      console.error('[StandFmRadio] GitHub error:', e);
      return false;
    }
  }

  async function updateCalendar(token, date, title) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const yearMonth = `${year}-${pad(month)}`;
    const dayStr = String(day);

    const updates = [
      { path: 'logs/README.md', linkPrefix: '' },
      { path: 'README.md', linkPrefix: 'logs/' }
    ];

    for (const { path, linkPrefix } of updates) {
      try {
        const getRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
          headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
        });

        if (!getRes.ok) continue;

        const data = await getRes.json();
        let content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
        const sha = data.sha;

        const monthHeader = `## ${year}年${month}月`;
        const calendarSection = path === 'README.md' ? '## 聴取カレンダー' : null;

        if (!content.includes(monthHeader)) {
          const cal = generateCalendar(year, month);
          if (calendarSection && content.includes(calendarSection)) {
            const idx = content.indexOf(calendarSection);
            const insertPos = content.indexOf('\n\n', idx) + 2;
            content = content.slice(0, insertPos) + `### ${year}年${month}月\n\n` + cal + '\n\n' + content.slice(insertPos);
          } else if (!calendarSection) {
            const insertPos = content.indexOf('\n\n') + 2;
            content = content.slice(0, insertPos) + monthHeader + '\n\n' + cal + '\n\n---\n\n' + content.slice(insertPos);
          }
        }

        const linkPath = `${linkPrefix}${yearMonth}.md#${month}${day}`;
        const escapedLinkPath = linkPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        if (content.includes(`[${dayStr}](${linkPath})`)) {
          const cellRegex = new RegExp(`(\\[${dayStr}\\]\\(${escapedLinkPath}\\))([^|]*)( \\|)`, 'g');
          const match = cellRegex.exec(content);
          if (match) {
            const existingPrograms = match[2];
            if (!existingPrograms.includes(title)) {
              const newCell = `${match[1]}${existingPrograms}<br>・${title}${match[3]}`;
              content = content.replace(match[0], newCell);
            }
          }
        } else if (content.includes(`](${linkPath})`)) {
          const oldFormatRegex = new RegExp(`\\[${dayStr}[^\\]]*\\]\\(${escapedLinkPath}\\)([^|]*)( \\|)`, 'g');
          const match = oldFormatRegex.exec(content);
          if (match) {
            const existingAfterLink = match[1];
            const newCell = `[${dayStr}](${linkPath})${existingAfterLink}<br>・${title}${match[2]}`;
            content = content.replace(match[0], newCell);
          }
        } else {
          const plainDayRegex = new RegExp(`(\\| )${dayStr}( \\|)`, 'g');
          content = content.replace(plainDayRegex, `$1[${dayStr}](${linkPath})<br>・${title}$2`);
        }

        await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
          method: 'PUT',
          headers: {
            'Authorization': `token ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: `📅 ${month}/${day} ${title}`,
            content: btoa(unescape(encodeURIComponent(content))),
            sha: sha
          })
        });
      } catch (e) {
        console.error('[StandFmRadio] Calendar update error for', path, ':', e);
      }
    }
  }

  function generateCalendar(year, month) {
    const firstDay = new Date(year, month - 1, 1).getDay();
    const lastDate = new Date(year, month, 0).getDate();

    let cal = '| 日 | 月 | 火 | 水 | 木 | 金 | 土 |\n';
    cal += '|:--:|:--:|:--:|:--:|:--:|:--:|:--:|\n';

    let row = '|';
    for (let i = 0; i < firstDay; i++) {
      row += '  |';
    }

    for (let d = 1; d <= lastDate; d++) {
      row += ` ${d} |`;
      if ((firstDay + d) % 7 === 0) {
        cal += row + '\n';
        row = '|';
      }
    }

    if (row !== '|') {
      while (row.split('|').length <= 8) {
        row += '  |';
      }
      cal += row + '\n';
    }

    return cal;
  }

  // ===== Delete Feature =====
  async function deleteLastEntry() {
    const lastEntry = getLastEntry();
    if (!lastEntry) {
      showToast('削除できるエントリがありません');
      return false;
    }

    let token = getGitHubToken();
    if (!token) {
      showToast('トークンが設定されていません');
      return false;
    }

    try {
      // Delete from log file
      const logRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${lastEntry.filePath}`, {
        headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
      });

      if (logRes.ok) {
        const logData = await logRes.json();
        let logContent = decodeURIComponent(escape(atob(logData.content.replace(/\n/g, ''))));

        // Remove the entry block (### 🎙️ ... ---\n\n)
        const entryPattern = `### 🎙️ ${lastEntry.channel} - ${lastEntry.title}`;
        const entryIdx = logContent.indexOf(entryPattern);
        if (entryIdx !== -1) {
          const endPattern = '---\n\n';
          const endIdx = logContent.indexOf(endPattern, entryIdx);
          if (endIdx !== -1) {
            logContent = logContent.slice(0, entryIdx) + logContent.slice(endIdx + endPattern.length);

            await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${lastEntry.filePath}`, {
              method: 'PUT',
              headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                message: `🗑️ Delete: ${lastEntry.channel} - ${lastEntry.title}`,
                content: btoa(unescape(encodeURIComponent(logContent))),
                sha: logData.sha
              })
            });
          }
        }
      }

      // Delete from calendars
      const targetDate = new Date(lastEntry.targetDate);
      await removeFromCalendar(token, targetDate, lastEntry.shortTitle);

      clearLastEntry();
      return true;
    } catch (e) {
      console.error('[StandFmRadio] Delete error:', e);
      return false;
    }
  }

  async function removeFromCalendar(token, date, title) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const yearMonth = `${year}-${pad(month)}`;
    const dayStr = String(day);

    const updates = [
      { path: 'logs/README.md', linkPrefix: '' },
      { path: 'README.md', linkPrefix: 'logs/' }
    ];

    for (const { path, linkPrefix } of updates) {
      try {
        const getRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
          headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
        });

        if (!getRes.ok) continue;

        const data = await getRes.json();
        let content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
        const sha = data.sha;

        const linkPath = `${linkPrefix}${yearMonth}.md#${month}${day}`;

        // Remove the title from calendar cell
        const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Remove <br>・title pattern
        content = content.replace(new RegExp(`<br>・${escapedTitle}`, 'g'), '');

        // If only the link remains without any programs, revert to plain day number
        const linkPattern = `[${dayStr}](${linkPath})`;
        if (content.includes(linkPattern) && !content.includes(`${linkPattern}<br>`)) {
          const escapedLinkPath = linkPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const cellRegex = new RegExp(`\\[${dayStr}\\]\\(${escapedLinkPath}\\)( \\|)`, 'g');
          content = content.replace(cellRegex, `${dayStr}$1`);
        }

        await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
          method: 'PUT',
          headers: {
            'Authorization': `token ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: `🗑️ Remove from calendar: ${month}/${day}`,
            content: btoa(unescape(encodeURIComponent(content))),
            sha: sha
          })
        });
      } catch (e) {
        console.error('[StandFmRadio] Calendar remove error for', path, ':', e);
      }
    }
  }

  // ===== UI =====
  function createUI() {
    // Check if already created
    if (document.getElementById('standfm-radio-container')) return;

    const info = getEpisodeInfo();
    if (!info) {
      // Retry after a short delay (Next.js hydration)
      setTimeout(createUI, 1000);
      return;
    }

    const container = document.createElement('div');
    container.id = 'standfm-radio-container';
    container.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 99999;
      background: #1a1a2e; border-radius: 12px; padding: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex; flex-direction: column; gap: 8px;
      min-width: 200px;
    `;

    // Date select dropdown
    const dateSelect = document.createElement('select');
    dateSelect.id = 'standfm-radio-date';
    dateSelect.style.cssText = `
      background: #333; border: none; border-radius: 6px;
      padding: 8px 12px; color: #fff; font-size: 13px;
      outline: none; cursor: pointer;
    `;

    const todayOption = document.createElement('option');
    todayOption.value = 'today';
    todayOption.textContent = '今日';
    dateSelect.appendChild(todayOption);

    const publishOption = document.createElement('option');
    publishOption.value = 'publish';
    if (info.publishDate) {
      const pd = info.publishDate;
      publishOption.textContent = `投稿日 (${pd.getFullYear()}/${pd.getMonth() + 1}/${pd.getDate()})`;
      publishOption.disabled = false;
    } else {
      publishOption.textContent = '投稿日 (取得不可)';
      publishOption.disabled = true;
    }
    dateSelect.appendChild(publishOption);

    // Memo input
    const memoInput = document.createElement('input');
    memoInput.id = 'standfm-radio-memo';
    memoInput.type = 'text';
    memoInput.placeholder = 'メモ（任意）';
    memoInput.style.cssText = `
      background: #333; border: none; border-radius: 6px;
      padding: 8px 12px; color: #fff; font-size: 13px;
      outline: none;
    `;

    // Button container
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display: flex; gap: 8px;';

    // Save button
    const saveBtn = document.createElement('button');
    saveBtn.id = 'standfm-radio-save';
    saveBtn.textContent = '🎙️ 記録';
    saveBtn.style.cssText = `
      background: #e94560; border: none; border-radius: 6px;
      padding: 10px 16px; color: #fff; font-size: 14px;
      cursor: pointer; font-weight: 500; flex: 1;
      transition: background 0.2s;
    `;
    saveBtn.onmouseover = () => saveBtn.style.background = '#ff6b6b';
    saveBtn.onmouseout = () => saveBtn.style.background = '#e94560';

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.id = 'standfm-radio-delete';
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = '直前のエントリを削除';
    deleteBtn.style.cssText = `
      background: #555; border: none; border-radius: 6px;
      padding: 10px 12px; color: #fff; font-size: 14px;
      cursor: pointer; transition: background 0.2s;
    `;
    deleteBtn.onmouseover = () => deleteBtn.style.background = '#777';
    deleteBtn.onmouseout = () => deleteBtn.style.background = '#555';

    // Update delete button state
    function updateDeleteBtnState() {
      const lastEntry = getLastEntry();
      deleteBtn.disabled = !lastEntry;
      deleteBtn.style.opacity = lastEntry ? '1' : '0.5';
      deleteBtn.style.cursor = lastEntry ? 'pointer' : 'not-allowed';
    }
    updateDeleteBtnState();

    saveBtn.onclick = async () => {
      const currentInfo = getEpisodeInfo();
      if (!currentInfo) {
        showToast('エピソード情報を取得できません');
        return;
      }

      const memo = memoInput.value.trim();
      const dateChoice = dateSelect.value;

      let targetDate;
      if (dateChoice === 'publish' && currentInfo.publishDate) {
        targetDate = currentInfo.publishDate;
      } else {
        targetDate = new Date();
      }

      saveBtn.disabled = true;
      saveBtn.textContent = '保存中...';

      const entry = {
        title: currentInfo.title,
        channel: currentInfo.channel,
        url: currentInfo.url,
        memo: memo,
        savedAt: new Date().toISOString()
      };

      const success = await saveToGitHub(entry, targetDate);

      if (success) {
        showToast('✓ 記録しました');
        memoInput.value = '';
        updateDeleteBtnState();
      } else {
        showToast('✗ 保存失敗');
      }

      saveBtn.disabled = false;
      saveBtn.textContent = '🎙️ 記録';
    };

    deleteBtn.onclick = async () => {
      const lastEntry = getLastEntry();
      if (!lastEntry) return;

      if (!confirm(`「${lastEntry.title}」を削除しますか？`)) return;

      deleteBtn.disabled = true;
      deleteBtn.textContent = '...';

      const success = await deleteLastEntry();

      if (success) {
        showToast('✓ 削除しました');
        updateDeleteBtnState();
      } else {
        showToast('✗ 削除失敗');
      }

      deleteBtn.disabled = false;
      deleteBtn.textContent = '🗑️';
    };

    btnContainer.appendChild(saveBtn);
    btnContainer.appendChild(deleteBtn);

    // Toggle button (minimize)
    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = '−';
    toggleBtn.style.cssText = `
      position: absolute; top: 4px; right: 8px;
      background: transparent; border: none; color: #888;
      font-size: 18px; cursor: pointer; padding: 0;
    `;
    toggleBtn.onclick = () => {
      const isHidden = dateSelect.style.display === 'none';
      dateSelect.style.display = isHidden ? 'block' : 'none';
      memoInput.style.display = isHidden ? 'block' : 'none';
      btnContainer.style.display = isHidden ? 'flex' : 'none';
      toggleBtn.textContent = isHidden ? '−' : '+';
      container.style.minWidth = isHidden ? '200px' : 'auto';
    };

    container.appendChild(toggleBtn);
    container.appendChild(dateSelect);
    container.appendChild(memoInput);
    container.appendChild(btnContainer);
    document.body.appendChild(container);
  }

  // ===== Init =====
  function init() {
    // Only on episode pages
    if (!window.location.pathname.startsWith('/episodes/')) return;

    // Wait for page to load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createUI);
    } else {
      createUI();
    }
  }

  // Handle SPA navigation
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => {
        document.getElementById('standfm-radio-container')?.remove();
        init();
      }, 500);
    }
  }).observe(document.body, { subtree: true, childList: true });

  init();
})();
