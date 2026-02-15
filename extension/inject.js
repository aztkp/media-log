// Radiko Skip - Injected into MAIN world
(function() {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  const formatTimeStr = (d) => d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  const parseTime = (s) => new Date(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8), +s.slice(8,10), +s.slice(10,12), +s.slice(12,14));
  // ISO 8601 format for API
  const formatISO = (d) => d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '+09:00';

  // ===== Logging Functions =====
  const STORAGE_KEY = 'radiko_skip_logs';
  const GITHUB_TOKEN_KEY = 'radiko_github_token';
  const GITHUB_REPO = 'aztkp/my-radiko';

  function getLogs() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  function saveLogs(logs) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
    } catch (e) {
      console.error('[RadikoSkip] Failed to save logs:', e);
    }
  }

  function getGitHubToken() {
    return localStorage.getItem(GITHUB_TOKEN_KEY) || '';
  }

  function setGitHubToken(token) {
    localStorage.setItem(GITHUB_TOKEN_KEY, token);
  }

  async function saveToGitHub(entry) {
    let token = getGitHubToken();
    if (!token) {
      token = prompt('GitHub Personal Access Token を入力（repo権限必要）\nhttps://github.com/settings/tokens/new');
      if (!token) return false;
      setGitHubToken(token);
    }

    // Use program broadcast date, not save date
    const programDate = entry.programTime ? parseTime(entry.programTime) : new Date(entry.savedAt);
    const yearMonth = `${programDate.getFullYear()}-${pad(programDate.getMonth() + 1)}`;
    const filePath = `logs/${yearMonth}.md`;
    const day = programDate.getDate();
    const month = programDate.getMonth() + 1;
    const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][programDate.getDay()];
    // Show program start time
    const time = entry.programTime ? `${entry.programTime.slice(8,10)}:${entry.programTime.slice(10,12)}` : entry.savedAt.slice(11, 16);

    // Build entry markdown
    let entryMd = `### ${time} - ${entry.stationId} - ${entry.programTitle || '番組名不明'}\n\n`;
    if (entry.memo) {
      entryMd += `> ${entry.memo}\n\n`;
    }
    if (entry.songs && entry.songs.length > 0) {
      entryMd += '**曲リスト:**\n';
      entry.songs.forEach(song => {
        const songTime = song.time ? song.time.slice(11, 16) : '';
        entryMd += `- ${songTime} ${song.title} / ${song.artist}\n`;
      });
      entryMd += '\n';
    }
    entryMd += `[番組リンク](${entry.url})\n\n---\n\n`;

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
        content = `# ${programDate.getFullYear()}年${month}月\n\n`;
      }

      // Add day section if needed (format: ## 2/11 for anchor link compatibility)
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
        message: `📻 ${entry.stationId} - ${entry.programTitle || time}`,
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

      return true;
    } catch (e) {
      console.error('[RadikoSkip] GitHub error:', e);
      return false;
    }
  }

  function getCurrentProgramInfo() {
    const hash = location.hash;
    const match = hash.match(/#!?\/(ts|live)\/([A-Z0-9-]+)\/(\d+)?/i);
    const stationId = match ? match[2] : '';
    const programTime = match ? match[3] : '';

    // Try to get program title from page
    const titleEl = document.querySelector('h1');
    const programTitle = titleEl ? titleEl.textContent.trim() : '';

    return {
      stationId,
      programTime,
      programTitle,
      url: location.href
    };
  }

  function saveListeningLog(memo) {
    const logs = getLogs();
    const now = new Date();
    const programInfo = getCurrentProgramInfo();

    const entry = {
      id: Date.now(),
      savedAt: now.toISOString(),
      stationId: programInfo.stationId,
      programTitle: programInfo.programTitle,
      programTime: programInfo.programTime,
      url: programInfo.url,
      memo: memo || '',
      songs: [...cachedSongs].map(s => ({
        title: s.title,
        artist: s.artist_name,
        time: s.displayed_start_time
      }))
    };

    logs.push(entry);
    saveLogs(logs);
    return entry;
  }



  function getCurrentPosition() {
    if (!window.player?._player?._audio || !window.player._fttm) return null;
    const audio = window.player._player._audio;
    const fttm = window.player._fttm;
    let baseTimeStr = window.__rskLastSeek;
    if (!baseTimeStr && window.player._player._url) {
      const url = new URL(window.player._player._url);
      baseTimeStr = url.searchParams.get('seek');
    }
    let baseTime = baseTimeStr ? parseTime(baseTimeStr) : fttm;
    return new Date(baseTime.getTime() + audio.currentTime * 1000);
  }

  function formatDisplayTime(date, fttm) {
    const elapsed = Math.floor((date - fttm) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    return mins + ':' + pad(secs);
  }

  function formatDuration(ms) {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return mins + ':' + pad(secs);
  }

  // Extract station ID from URL hash
  function getStationId() {
    const hash = location.hash;
    // e.g., #!/ts/FMJ/20250215010000 or #!/live/FMJ
    const match = hash.match(/#!?\/(ts|live)\/([A-Z0-9-]+)/i);
    return match ? match[2] : null;
  }

  // Fetch songs from radiko music API
  let cachedSongs = [];
  let lastFetchTime = 0;
  const FETCH_INTERVAL = 30000; // 30 seconds

  async function fetchSongs() {
    const stationId = getStationId();
    if (!stationId || !window.player?._fttm || !window.player?._totm) {
      return [];
    }

    const now = Date.now();
    if (now - lastFetchTime < FETCH_INTERVAL && cachedSongs.length > 0) {
      return cachedSongs;
    }

    const fttm = window.player._fttm;
    const totm = window.player._totm;
    const startTime = formatISO(fttm);
    const endTime = formatISO(totm);

    const url = `https://api.radiko.jp/music/api/v1/noas/${stationId}?start_time_gte=${encodeURIComponent(startTime)}&end_time_lt=${encodeURIComponent(endTime)}`;

    try {
      const res = await fetch(url);
      if (!res.ok) return cachedSongs;
      const data = await res.json();
      cachedSongs = data.data || [];
      lastFetchTime = now;
      return cachedSongs;
    } catch (e) {
      return cachedSongs;
    }
  }

  // Parse ISO time string to Date
  function parseISO(s) {
    return new Date(s);
  }

  // Find the song playing at a given time
  function findCurrentSong(songs, currentTime) {
    if (!songs || songs.length === 0 || !currentTime) return null;

    const currentMs = currentTime.getTime();

    for (let i = 0; i < songs.length; i++) {
      const song = songs[i];
      const startMs = parseISO(song.displayed_start_time).getTime();
      // Use next song's start as end, or program end if last song
      const nextSong = songs[i + 1];
      const endMs = nextSong ? parseISO(nextSong.displayed_start_time).getTime() : (window.player?._totm?.getTime() || Infinity);

      if (startMs <= currentMs && currentMs < endMs) {
        return { ...song, _endTime: endMs };
      }
    }
    return null;
  }

  // Update now-playing display
  let lastSongTitle = '';

  async function updateNowPlaying() {
    const titleEl = document.getElementById('rsk-track-title');
    const artistEl = document.getElementById('rsk-track-artist');
    const artworkEl = document.getElementById('rsk-artwork');
    const programEl = document.getElementById('rsk-track-program');

    if (!titleEl) return;

    const currentPos = getCurrentPosition();
    if (!currentPos) {
      titleEl.textContent = '再生位置を取得中...';
      artistEl.textContent = '';
      return;
    }

    const songs = await fetchSongs();
    const song = findCurrentSong(songs, currentPos);

    if (song) {
      // Update only if song changed
      if (song.title !== lastSongTitle) {
        lastSongTitle = song.title;
        titleEl.textContent = song.title;
        artistEl.textContent = song.artist_name || '';
        artworkEl.style.display = '';

        // Update artwork
        if (song.music_info?.jacket?.large) {
          artworkEl.src = song.music_info.jacket.large;
        } else if (song.music_info?.jacket?.medium) {
          artworkEl.src = song.music_info.jacket.medium;
        } else {
          artworkEl.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='%23333' width='100' height='100'/%3E%3Ctext x='50' y='55' text-anchor='middle' fill='%23666' font-size='30'%3E♪%3C/text%3E%3C/svg%3E";
        }

        // Show program info if available
        if (programEl) {
          programEl.textContent = '';
        }
      }
    } else {
      // No song info - hide track info
      if (lastSongTitle !== '__talk__') {
        lastSongTitle = '__talk__';
        titleEl.textContent = '';
        artistEl.textContent = '';
        artworkEl.style.display = 'none';
        if (programEl) {
          programEl.textContent = '';
        }
      }
    }
  }

  // Update song list display
  function updateSongList() {
    const listEl = document.getElementById('rsk-songlist');
    if (!listEl) return;

    const currentPos = getCurrentPosition();
    const currentStr = currentPos ? formatTimeStr(currentPos) : '';

    // Hide if no songs (talk program)
    if (cachedSongs.length === 0) {
      listEl.style.display = 'none';
      return;
    }
    listEl.style.display = '';

    // Check if list needs rebuilding
    const existingItems = listEl.querySelectorAll('.rsk-song-item');
    if (existingItems.length !== cachedSongs.length) {
      // Rebuild the list
      listEl.innerHTML = cachedSongs.map((song, i) => {
        const startTime = song.displayed_start_time;
        // Parse ISO time: 2026-02-14T20:07:00+09:00
        const timeStr = startTime.slice(11, 16); // "20:07"
        return `
          <div class="rsk-song-item" data-index="${i}" data-start="${startTime}">
            <div class="rsk-song-item-time">${timeStr}</div>
            <div class="rsk-song-item-title">${song.title || '不明'}</div>
            <div class="rsk-song-item-artist">${song.artist_name || ''}</div>
          </div>
        `;
      }).join('');

      // Add click handlers to seek to song
      listEl.querySelectorAll('.rsk-song-item').forEach(item => {
        item.addEventListener('click', () => {
          const startTime = item.dataset.start;
          if (startTime && window.player?._fttm && window.player?._totm) {
            const targetDate = parseISO(startTime);
            const fttm = window.player._fttm;
            const totm = window.player._totm;
            const duration = totm - fttm;
            const elapsed = targetDate - fttm;
            const ratio = Math.max(0, Math.min(1, elapsed / duration));
            seekTo(ratio);
          }
        });
      });
    }

    // Update playing state
    const currentMs = currentPos ? currentPos.getTime() : 0;
    listEl.querySelectorAll('.rsk-song-item').forEach(item => {
      const index = parseInt(item.dataset.index);
      const song = cachedSongs[index];
      const startMs = parseISO(song.displayed_start_time).getTime();
      const nextSong = cachedSongs[index + 1];
      const endMs = nextSong ? parseISO(nextSong.displayed_start_time).getTime() : (window.player?._totm?.getTime() || Infinity);

      const isPlaying = currentMs >= startMs && currentMs < endMs;
      item.classList.toggle('playing', isPlaying);

      // Scroll to playing song
      if (isPlaying && !item.dataset.scrolled) {
        item.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        item.dataset.scrolled = 'true';
      } else if (!isPlaying) {
        item.dataset.scrolled = '';
      }
    });
  }

  function updateTimeDisplay() {
    const timeEl = document.getElementById('rsk-time');
    const sliderEl = document.getElementById('rsk-slider');
    if (!timeEl) return;

    const pos = getCurrentPosition();
    if (pos && window.player?._fttm && window.player?._totm) {
      const fttm = window.player._fttm;
      const totm = window.player._totm;
      const elapsed = pos - fttm;
      const duration = totm - fttm;
      const ratio = Math.min(1, Math.max(0, elapsed / duration));

      timeEl.textContent = formatDisplayTime(pos, fttm);

      if (sliderEl && !sliderEl.dataset.dragging) {
        sliderEl.value = ratio * 100;
      }
    }
  }

  function showToast(text) {
    const existing = document.querySelector('.rsk-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'rsk-toast';
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 800);
  }

  function seekTo(ratio) {
    if (!window.player?._player?._audio || !window.player._fttm || !window.player._totm) return;

    const fttm = window.player._fttm;
    const totm = window.player._totm;
    const duration = totm - fttm;

    let targetTime = new Date(fttm.getTime() + duration * ratio);

    // Clamp
    if (targetTime < fttm) targetTime = new Date(fttm.getTime());
    if (targetTime >= totm) targetTime = new Date(totm.getTime() - 1000);

    const newSeekStr = formatTimeStr(targetTime);

    const url = new URL(window.player._player._url);
    url.searchParams.set('seek', newSeekStr);

    const displayTime = formatDisplayTime(targetTime, fttm);
    showToast('→ ' + displayTime);

    console.log('[RadikoSkip] Seek to', newSeekStr);

    window.__rskLastSeek = newSeekStr;

    window.player._player.load(url.toString());
    setTimeout(() => {
      if (window.player._player._audio.paused) {
        window.player._player._audio.play().catch(()=>{});
      }
      updateTimeDisplay();
    }, 300);
  }

  function rskSkip(seconds) {
    if (!window.player?._player?._audio) {
      console.log('[RadikoSkip] No player');
      return;
    }

    const fttm = window.player._fttm;
    const totm = window.player._totm;

    const currentPos = getCurrentPosition();
    if (!currentPos) return;

    const newPos = new Date(currentPos.getTime() + seconds * 1000);

    // Clamp to program bounds
    if (newPos < fttm) newPos.setTime(fttm.getTime());
    if (newPos >= totm) newPos.setTime(totm.getTime() - 1000);

    const newSeekStr = formatTimeStr(newPos);

    // Build new URL
    const url = new URL(window.player._player._url);
    url.searchParams.set('seek', newSeekStr);

    console.log('[RadikoSkip]', formatTimeStr(currentPos), '->', newSeekStr);

    // Show toast with new position
    const displayTime = formatDisplayTime(newPos, fttm);
    showToast((seconds > 0 ? '+' : '') + seconds + 's → ' + displayTime);

    // Store BEFORE loading
    window.__rskLastSeek = newSeekStr;

    window.player._player.load(url.toString());
    setTimeout(() => {
      if (window.player._player._audio.paused) {
        window.player._player._audio.play().catch(()=>{});
      }
      updateTimeDisplay();
    }, 300);
  }

  // Make skip function global for keyboard shortcuts
  window.rskSkip = rskSkip;

  // Listen for skip requests from background script
  window.addEventListener('radiko-skip-request', (e) => {
    rskSkip(e.detail.seconds);
  });

  function addButtons() {
    if (document.querySelector('.rsk-float')) return;

    const style = document.createElement('style');
    style.textContent = `
      .rsk-float {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 999999;
        background: linear-gradient(to top, rgba(0,0,0,0.98) 0%, rgba(20,20,20,0.98) 100%);
        padding: 20px 40px 28px;
        box-shadow: 0 -8px 40px rgba(0,0,0,0.7);
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-height: 50vh;
      }

      /* シークバー */
      .rsk-seek-section {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .rsk-slider {
        width: 100%;
        height: 6px;
        -webkit-appearance: none;
        appearance: none;
        background: rgba(255,255,255,0.2);
        border-radius: 3px;
        cursor: pointer;
        transition: height 0.15s;
      }
      .rsk-slider:hover {
        height: 10px;
      }
      .rsk-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #fff;
        cursor: pointer;
        box-shadow: 0 2px 10px rgba(0,0,0,0.5);
        transition: transform 0.15s;
      }
      .rsk-slider:hover::-webkit-slider-thumb {
        transform: scale(1.3);
      }
      .rsk-slider::-moz-range-thumb {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #fff;
        border: none;
        cursor: pointer;
      }
      .rsk-ticks {
        display: flex;
        justify-content: space-between;
        padding: 0 2px;
      }
      .rsk-tick {
        color: rgba(255,255,255,0.4);
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 11px;
        flex: 1;
        text-align: center;
      }
      .rsk-tick:first-child { text-align: left; flex: 0; }
      .rsk-tick:last-child { text-align: right; flex: 0; }

      /* メインコントロール */
      .rsk-main {
        display: flex;
        align-items: center;
        gap: 32px;
      }

      /* 楽曲情報 */
      .rsk-now-playing {
        display: flex;
        align-items: center;
        gap: 16px;
        flex: 1;
        min-width: 0;
      }
      .rsk-artwork {
        width: 72px;
        height: 72px;
        border-radius: 8px;
        background: #333;
        object-fit: cover;
        flex-shrink: 0;
      }
      .rsk-track-info {
        flex: 1;
        min-width: 0;
      }
      .rsk-track-title {
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 18px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-bottom: 4px;
      }
      .rsk-track-artist {
        color: rgba(255,255,255,0.6);
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 14px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .rsk-track-program {
        color: rgba(255,255,255,0.4);
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 12px;
        margin-top: 2px;
      }

      /* 時間表示 */
      .rsk-time-section {
        display: flex;
        align-items: baseline;
        gap: 6px;
        flex-shrink: 0;
      }
      .rsk-time-current {
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 36px;
        font-weight: 300;
        font-variant-numeric: tabular-nums;
      }
      .rsk-time-total {
        color: rgba(255,255,255,0.5);
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 20px;
        font-weight: 300;
      }

      /* コントロールボタン */
      .rsk-controls {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-shrink: 0;
      }
      .rsk-btn {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        border: none;
        background: rgba(255,255,255,0.1);
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .rsk-btn:hover {
        background: rgba(255,255,255,0.2);
        transform: scale(1.08);
      }
      .rsk-btn:active {
        transform: scale(0.95);
      }
      .rsk-play-btn {
        width: 64px;
        height: 64px;
        font-size: 28px;
        background: #fff;
        color: #000;
      }
      .rsk-play-btn:hover {
        background: #e0e0e0;
      }

      /* 曲リスト */
      .rsk-songlist {
        display: flex;
        gap: 12px;
        overflow-x: auto;
        padding: 8px 0;
        scrollbar-width: thin;
        scrollbar-color: rgba(255,255,255,0.3) transparent;
      }
      .rsk-songlist::-webkit-scrollbar {
        height: 6px;
      }
      .rsk-songlist::-webkit-scrollbar-track {
        background: transparent;
      }
      .rsk-songlist::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.3);
        border-radius: 3px;
      }
      .rsk-song-item {
        flex-shrink: 0;
        width: 180px;
        padding: 12px;
        background: rgba(255,255,255,0.05);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .rsk-song-item:hover {
        background: rgba(255,255,255,0.1);
      }
      .rsk-song-item.playing {
        background: rgba(10,132,255,0.3);
        border: 1px solid rgba(10,132,255,0.5);
      }
      .rsk-song-item-time {
        color: rgba(255,255,255,0.5);
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 11px;
        margin-bottom: 4px;
      }
      .rsk-song-item-title {
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-bottom: 2px;
      }
      .rsk-song-item-artist {
        color: rgba(255,255,255,0.6);
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 11px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* 倍速ボタン */
      .rsk-speed-section {
        display: flex;
        align-items: center;
        gap: 6px;
        padding-left: 20px;
        border-left: 1px solid rgba(255,255,255,0.15);
        flex-shrink: 0;
      }
      .rsk-speed-btn {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        border: none;
        background: transparent;
        color: rgba(255,255,255,0.5);
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }
      .rsk-speed-btn:hover {
        color: #fff;
        background: rgba(255,255,255,0.1);
      }
      .rsk-speed-btn.active {
        background: #0a84ff;
        color: #fff;
      }

      /* メモ・エクスポート */
      .rsk-memo-section {
        display: flex;
        align-items: center;
        gap: 12px;
        padding-left: 20px;
        border-left: 1px solid rgba(255,255,255,0.15);
        flex-shrink: 0;
      }
      .rsk-memo-input {
        width: 200px;
        height: 36px;
        padding: 0 12px;
        border: none;
        border-radius: 8px;
        background: rgba(255,255,255,0.1);
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 13px;
        outline: none;
      }
      .rsk-memo-input::placeholder {
        color: rgba(255,255,255,0.4);
      }
      .rsk-memo-input:focus {
        background: rgba(255,255,255,0.15);
      }
      .rsk-export-btn {
        height: 36px;
        padding: 0 16px;
        border: none;
        border-radius: 8px;
        background: rgba(255,255,255,0.1);
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
      }
      .rsk-export-btn:hover {
        background: rgba(255,255,255,0.2);
      }
      .rsk-save-btn {
        height: 36px;
        padding: 0 16px;
        border: none;
        border-radius: 8px;
        background: #0a84ff;
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }
      .rsk-save-btn:hover {
        background: #0070e0;
      }

      /* トースト */
      .rsk-toast {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0,0,0,0.85);
        backdrop-filter: blur(20px);
        color: white;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 32px;
        font-weight: 500;
        padding: 20px 40px;
        border-radius: 16px;
        z-index: 9999999;
        pointer-events: none;
        animation: rsk-fade 0.8s ease-out forwards;
      }
      @keyframes rsk-fade {
        0% { opacity: 1; }
        70% { opacity: 1; }
        100% { opacity: 0; }
      }
    `;
    document.head.appendChild(style);

    const container = document.createElement('div');
    container.className = 'rsk-float';
    container.innerHTML = `
      <div class="rsk-songlist" id="rsk-songlist"></div>
      <div class="rsk-seek-section">
        <input type="range" class="rsk-slider" id="rsk-slider" min="0" max="100" value="0">
        <div class="rsk-ticks" id="rsk-ticks"></div>
      </div>
      <div class="rsk-main">
        <div class="rsk-now-playing">
          <button class="rsk-btn rsk-play-btn" id="rsk-play-btn">▶</button>
          <img class="rsk-artwork" id="rsk-artwork" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='%23333' width='100' height='100'/%3E%3Ctext x='50' y='55' text-anchor='middle' fill='%23666' font-size='30'%3E♪%3C/text%3E%3C/svg%3E">
          <div class="rsk-track-info">
            <div class="rsk-track-title" id="rsk-track-title">楽曲情報を取得中...</div>
            <div class="rsk-track-artist" id="rsk-track-artist"></div>
            <div class="rsk-track-program" id="rsk-track-program"></div>
          </div>
        </div>
        <div class="rsk-time-section">
          <span class="rsk-time-current" id="rsk-time">0:00</span>
          <span class="rsk-time-total">/ <span id="rsk-duration">--:--</span></span>
        </div>
        <div class="rsk-controls">
          <button class="rsk-btn" data-skip="-30">-30</button>
          <button class="rsk-btn" data-skip="-10">-10</button>
          <button class="rsk-btn" data-skip="10">+10</button>
          <button class="rsk-btn" data-skip="30">+30</button>
        </div>
        <div class="rsk-speed-section">
          <button class="rsk-speed-btn" data-speed="0.5">0.5</button>
          <button class="rsk-speed-btn active" data-speed="1">1x</button>
          <button class="rsk-speed-btn" data-speed="1.5">1.5</button>
          <button class="rsk-speed-btn" data-speed="2">2x</button>
        </div>
        <div class="rsk-memo-section">
          <input type="text" class="rsk-memo-input" id="rsk-memo" placeholder="メモを入力...">
          <button class="rsk-save-btn" id="rsk-save">保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(container);

    // Play/Pause button
    const playBtn = document.getElementById('rsk-play-btn');
    const updatePlayButton = () => {
      const audio = window.player?._player?._audio;
      if (audio) {
        playBtn.textContent = audio.paused ? '▶' : '❚❚';
      }
    };
    playBtn.addEventListener('click', () => {
      const audio = window.player?._player?._audio;
      if (audio) {
        if (audio.paused) {
          audio.play().catch(() => {});
        } else {
          audio.pause();
        }
        updatePlayButton();
      }
    });
    // Listen for play/pause state changes
    setInterval(updatePlayButton, 500);

    // Skip buttons
    container.querySelectorAll('[data-skip]').forEach(btn => {
      btn.addEventListener('click', () => rskSkip(parseInt(btn.dataset.skip)));
    });

    // Speed buttons
    container.querySelectorAll('[data-speed]').forEach(btn => {
      btn.addEventListener('click', () => {
        const speed = parseFloat(btn.dataset.speed);
        if (window.player?._player?._audio) {
          window.player._player._audio.playbackRate = speed;
          container.querySelectorAll('[data-speed]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          showToast(speed + 'x');
        }
      });
    });

    // Slider events
    const slider = document.getElementById('rsk-slider');

    slider.addEventListener('mousedown', () => {
      slider.dataset.dragging = 'true';
    });

    slider.addEventListener('mouseup', () => {
      slider.dataset.dragging = '';
      const ratio = slider.value / 100;
      seekTo(ratio);
    });

    slider.addEventListener('change', () => {
      if (!slider.dataset.dragging) {
        const ratio = slider.value / 100;
        seekTo(ratio);
      }
    });

    // Update duration display and ticks
    let ticksGenerated = false;
    const updateDuration = () => {
      const durationEl = document.getElementById('rsk-duration');
      const ticksEl = document.getElementById('rsk-ticks');
      if (durationEl && window.player?._fttm && window.player?._totm) {
        const duration = window.player._totm - window.player._fttm;
        const totalMins = Math.floor(duration / 60000);
        durationEl.textContent = '/ ' + formatDuration(duration);

        // Generate ticks only once
        if (!ticksGenerated && ticksEl && totalMins > 0) {
          ticksGenerated = true;
          ticksEl.innerHTML = '';

          // Determine tick interval based on duration
          let interval;
          if (totalMins <= 10) interval = 2;
          else if (totalMins <= 30) interval = 5;
          else if (totalMins <= 60) interval = 10;
          else interval = 15;

          // Generate tick marks
          for (let m = 0; m <= totalMins; m += interval) {
            const tick = document.createElement('span');
            tick.className = 'rsk-tick';
            tick.textContent = m + '';
            ticksEl.appendChild(tick);
          }
          // Add final tick if not aligned
          if (totalMins % interval !== 0) {
            const tick = document.createElement('span');
            tick.className = 'rsk-tick';
            tick.textContent = totalMins + '';
            ticksEl.appendChild(tick);
          }
        }
      }
    };

    // Update time display every 500ms
    setInterval(() => {
      updateTimeDisplay();
      updateDuration();
    }, 500);

    // Save button
    const saveBtn = document.getElementById('rsk-save');
    const memoInput = document.getElementById('rsk-memo');
    saveBtn.addEventListener('click', async () => {
      const memo = memoInput.value.trim();
      const entry = saveListeningLog(memo);
      memoInput.value = '';

      saveBtn.textContent = '...';
      saveBtn.disabled = true;

      const success = await saveToGitHub(entry);

      saveBtn.textContent = '保存';
      saveBtn.disabled = false;

      showToast(success ? 'GitHub保存完了' : '保存失敗');
    });

    // Enter key to save
    memoInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        saveBtn.click();
      }
    });

    // Update now-playing info every 2 seconds
    setInterval(() => {
      updateNowPlaying();
      updateSongList();
    }, 2000);
    // Initial fetch
    setTimeout(() => {
      updateNowPlaying();
      updateSongList();
    }, 1000);

    console.log('[RadikoSkip] UI ready');
  }

  function init() {
    const tryAdd = () => {
      if ((location.hash.includes('/ts/') || location.hash.includes('/live/')) && document.querySelector('.player-area')) {
        addButtons();
      }
    };

    tryAdd();
    setInterval(tryAdd, 1000);

    window.addEventListener('hashchange', () => {
      document.querySelector('.rsk-float')?.remove();
      window.__rskLastSeek = null;
      // Reset song cache
      cachedSongs = [];
      lastFetchTime = 0;
      lastSongTitle = '';
      setTimeout(tryAdd, 500);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
