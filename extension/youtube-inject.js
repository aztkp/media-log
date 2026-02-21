// YouTube Radio Log - Record YouTube radio to GitHub
(function() {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');

  // ===== GitHub Settings =====
  const GITHUB_TOKEN_KEY = 'radiko_github_token';
  const GITHUB_REPO = 'aztkp/media-log';
  const LAST_ENTRY_KEY = 'radiko_last_entry';

  async function getGitHubToken() {
    const result = await chrome.storage.local.get(GITHUB_TOKEN_KEY);
    return result[GITHUB_TOKEN_KEY] || '';
  }

  async function setGitHubToken(token) {
    await chrome.storage.local.set({ [GITHUB_TOKEN_KEY]: token });
  }

  // ===== Last Entry Storage (for delete feature) =====
  async function saveLastEntry(entry) {
    await chrome.storage.local.set({ [LAST_ENTRY_KEY]: entry });
  }

  async function getLastEntry() {
    const result = await chrome.storage.local.get(LAST_ENTRY_KEY);
    return result[LAST_ENTRY_KEY] || null;
  }

  async function clearLastEntry() {
    await chrome.storage.local.remove(LAST_ENTRY_KEY);
  }

  // ===== YouTube Info =====
  function getVideoInfo() {
    // Video title
    const titleEl = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string') ||
                    document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
                    document.querySelector('#title h1 yt-formatted-string');
    const title = titleEl?.textContent?.trim() || document.title.replace(' - YouTube', '').trim();

    // Channel name
    const channelEl = document.querySelector('#channel-name a') ||
                      document.querySelector('ytd-channel-name a') ||
                      document.querySelector('#owner #channel-name a');
    const channel = channelEl?.textContent?.trim() || 'Unknown Channel';

    // Video URL (clean, without timestamp params)
    const url = window.location.href.split('&t=')[0];

    // Publish date
    const publishDate = getPublishDate();

    return { title, channel, url, publishDate: publishDate?.toISOString() || null };
  }

  function getPublishDate() {
    // Multiple selectors for different YouTube UI versions
    const selectors = [
      // New YouTube UI (2024+)
      '#info-container yt-formatted-string.ytd-video-primary-info-renderer',
      'ytd-watch-metadata #info-container #info-strings yt-formatted-string',
      '#description-inner ytd-video-primary-info-renderer #info-strings yt-formatted-string',
      // Standard selectors
      '#info-strings yt-formatted-string',
      'ytd-video-primary-info-renderer #info-strings span',
      '#info span.ytd-video-primary-info-renderer',
      // Description area (when expanded)
      '#description #info-container yt-formatted-string',
      'ytd-watch-metadata #description #info yt-formatted-string',
      // Below video info
      '#below #info-strings yt-formatted-string',
      '#below ytd-watch-metadata #info yt-formatted-string'
    ];

    let dateText = null;

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const text = el.textContent?.trim();
        if (text && isDateLikeText(text)) {
          dateText = text;
          break;
        }
      }
      if (dateText) break;
    }

    if (!dateText) return null;

    return parseDateText(dateText);
  }

  function isDateLikeText(text) {
    // Check if text looks like a date
    return /\d{4}年\d{1,2}月\d{1,2}日/.test(text) ||
           /\d+(日|週間|か月|年)前/.test(text) ||
           /[A-Za-z]+\s+\d{1,2},?\s+\d{4}/.test(text) ||
           /\d{4}\/\d{1,2}\/\d{1,2}/.test(text);
  }

  function parseDateText(dateText) {
    // Parse Japanese date format: "2024年1月15日"
    const jpMatch = dateText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (jpMatch) {
      return new Date(parseInt(jpMatch[1]), parseInt(jpMatch[2]) - 1, parseInt(jpMatch[3]));
    }

    // Parse relative date: "1日前", "2週間前", "3か月前"
    const relativeMatch = dateText.match(/(\d+)(日|週間|か月|年)前/);
    if (relativeMatch) {
      const num = parseInt(relativeMatch[1]);
      const unit = relativeMatch[2];
      const now = new Date();

      switch (unit) {
        case '日':
          now.setDate(now.getDate() - num);
          break;
        case '週間':
          now.setDate(now.getDate() - num * 7);
          break;
        case 'か月':
          now.setMonth(now.getMonth() - num);
          break;
        case '年':
          now.setFullYear(now.getFullYear() - num);
          break;
      }
      return now;
    }

    // Parse English format: "Jan 15, 2024" or "January 15, 2024"
    const enMatch = dateText.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
    if (enMatch) {
      const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const monthIdx = months.findIndex(m => enMatch[1].toLowerCase().startsWith(m));
      if (monthIdx !== -1) {
        return new Date(parseInt(enMatch[3]), monthIdx, parseInt(enMatch[2]));
      }
    }

    // Parse format: "2024/1/15"
    const slashMatch = dateText.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (slashMatch) {
      return new Date(parseInt(slashMatch[1]), parseInt(slashMatch[2]) - 1, parseInt(slashMatch[3]));
    }

    return null;
  }

  // ===== GitHub Save =====
  async function saveToGitHub(entry, targetDate) {
    let token = await getGitHubToken();
    if (!token) {
      token = prompt('GitHub Personal Access Token を入力（repo権限必要）\nhttps://github.com/settings/tokens/new');
      if (!token) return { success: false, error: 'トークンが必要です' };
      await setGitHubToken(token);
    }

    const yearMonth = `${targetDate.getFullYear()}-${pad(targetDate.getMonth() + 1)}`;
    const filePath = `logs/${yearMonth}.md`;
    const day = targetDate.getDate();
    const month = targetDate.getMonth() + 1;

    // Build entry markdown
    const emoji = entry.emoji || '📻';
    let entryMd = `### ${emoji} ${entry.channel} - ${entry.title}\n\n`;
    if (entry.memo) {
      entryMd += `> ${entry.memo}\n\n`;
    }
    entryMd += `[YouTube](${entry.url})\n\n---\n\n`;

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
        message: `${emoji} ${entry.channel} - ${entry.title}`,
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
          await chrome.storage.local.remove(GITHUB_TOKEN_KEY);
          return { success: false, error: 'トークン無効 - 再入力してください' };
        }
        throw new Error(err.message);
      }

      // Update calendar
      const shortTitle = entry.title.length > 15 ? entry.title.slice(0, 14) + '…' : entry.title;
      await updateCalendar(token, targetDate, shortTitle);

      // Save last entry info for delete feature
      await saveLastEntry({
        title: entry.title,
        channel: entry.channel,
        url: entry.url,
        emoji: emoji,
        shortTitle: shortTitle,
        filePath: filePath,
        dayHeader: dayHeader,
        targetDate: targetDate.toISOString(),
        savedAt: new Date().toISOString()
      });

      return { success: true };
    } catch (e) {
      console.error('[YouTubeRadio] GitHub error:', e);
      return { success: false, error: e.message };
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
        console.error('[YouTubeRadio] Calendar update error for', path, ':', e);
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
    const lastEntry = await getLastEntry();
    if (!lastEntry) {
      return { success: false, error: '削除できるエントリがありません' };
    }

    let token = await getGitHubToken();
    if (!token) {
      return { success: false, error: 'トークンが設定されていません' };
    }

    try {
      // Delete from log file
      const logRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${lastEntry.filePath}`, {
        headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
      });

      if (logRes.ok) {
        const logData = await logRes.json();
        let logContent = decodeURIComponent(escape(atob(logData.content.replace(/\n/g, ''))));

        // Remove the entry block (### {emoji} ... ---\n\n)
        const emoji = lastEntry.emoji || '📻';
        const entryPattern = `### ${emoji} ${lastEntry.channel} - ${lastEntry.title}`;
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

      await clearLastEntry();
      return { success: true };
    } catch (e) {
      console.error('[YouTubeRadio] Delete error:', e);
      return { success: false, error: e.message };
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
        // Pattern: <br>・{title} or just ・{title} at the start
        const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Remove <br>・title pattern
        content = content.replace(new RegExp(`<br>・${escapedTitle}`, 'g'), '');

        // If only the link remains without any programs, revert to plain day number
        const linkPattern = `[${dayStr}](${linkPath})`;
        if (content.includes(linkPattern) && !content.includes(`${linkPattern}<br>`)) {
          // Check if there are no more programs after the link
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
        console.error('[YouTubeRadio] Calendar remove error for', path, ':', e);
      }
    }
  }

  // ===== Message Listener (for popup communication) =====
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const handleAsync = async () => {
      switch (request.action) {
        case 'getInfo':
          return getVideoInfo();

        case 'getLastEntry':
          return await getLastEntry();

        case 'save':
          const targetDate = new Date(request.targetDate);
          return await saveToGitHub(request.entry, targetDate);

        case 'delete':
          return await deleteLastEntry();

        default:
          return null;
      }
    };

    handleAsync().then(sendResponse);
    return true; // Keep the message channel open for async response
  });

  // ===== Init =====
  function init() {
    // Only log on video pages
    if (window.location.pathname.startsWith('/watch')) {
      console.log('[YouTubeRadio] Content script loaded');
    }
  }

  init();
})();
