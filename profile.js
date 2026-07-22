// profile.js
// Handles the Profile Dashboard, Detailed Stats, Leaderboard, and Gamification UI

document.addEventListener('DOMContentLoaded', () => {
  
  // --- 1. PROFILE NAVIGATION LISTENERS ---
  const userAvatar = document.getElementById('user-avatar');
  if (userAvatar) {
    userAvatar.addEventListener('click', (e) => {
      e.stopPropagation(); 
      document.getElementById('main-view').classList.add('hidden');
      document.getElementById('search-input').classList.add('hidden');
      document.getElementById('filter-dropdown').classList.add('hidden');
      document.getElementById('leaderboard-view').classList.add('hidden');
      document.getElementById('profile-view').classList.remove('hidden');
      
      chrome.storage.local.get(['timeSavedSeconds'], (res) => {
        const totalSecs = res.timeSavedSeconds || 0;
        const mins = Math.floor(totalSecs / 60);
        document.getElementById('time-saved-display').textContent = `${mins}m`;
      });

      // userId is defined globally in popup.js
      if (typeof userId !== 'undefined' && userId) {
        loadLeaderboard();
        loadAchievementsUI(userId); 
        loadDetailedStats(userId);
      }
    });
  }

  const profileBackBtn = document.getElementById('profile-back-btn');
  if (profileBackBtn) {
    profileBackBtn.addEventListener('click', () => {
      document.getElementById('profile-view').classList.add('hidden');
      // loadAnimeList is defined globally in popup.js
      if (typeof loadAnimeList === 'function') loadAnimeList(); 
    });
  }

  // --- 2. SYNC HISTORY LISTENER ---
  const syncHistoryBtn = document.getElementById('sync-history-btn');
  if (syncHistoryBtn) {
    syncHistoryBtn.addEventListener('click', (e) => {
      const btn = e.target;
      btn.textContent = "Syncing with AniList...";
      btn.disabled = true;
      
      chrome.runtime.sendMessage({ action: "SYNC_PAST_HISTORY" }, (response) => {
        if (response && response.success) {
          btn.textContent = `Added ${Math.floor(response.minutes).toLocaleString()} mins!`;
          btn.style.color = "#4cca51";
          
          setTimeout(() => {
            if (typeof userId !== 'undefined' && userId) loadUserLevel(userId); 
            btn.classList.add('hidden');
          }, 2000);
        } else {
          btn.textContent = "Sync Failed.";
          btn.disabled = false;
        }
      });
    });
  }
});

// --- 3. PROFILE DATA FUNCTIONS ---

async function loadUserLevel(currentUserId) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/user_stats?anilist_user_id=eq.${currentUserId}&select=level,true_watch_seconds`;
    const res = await fetch(url, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
    const data = await res.json();
    
    if (data && data.length > 0) {
      const { level, true_watch_seconds } = data[0];
      const currentMinutes = Math.floor(true_watch_seconds / 60);
      
      const userLevelEl = document.getElementById('user-level');
      if (userLevelEl) userLevelEl.textContent = `Lv. ${level}`;
      
      const currentLevelBaseMins = 500000 * Math.pow((level - 1) / 99, 2);
      const nextLevelMins = 500000 * Math.pow(level / 99, 2);
      
      let pct = 100;
      let hoverText = "MAX LEVEL";
      
      if (level < 100) {
        const minsIntoLevel = currentMinutes - currentLevelBaseMins;
        const minsRequiredForNext = nextLevelMins - currentLevelBaseMins;
        pct = Math.min(100, Math.max(0, (minsIntoLevel / minsRequiredForNext) * 100));
        hoverText = `${Math.floor(currentMinutes).toLocaleString()} / ${Math.floor(nextLevelMins).toLocaleString()} mins`;
      }

      document.getElementById('xp-progress-bar').style.width = `${pct}%`;
      document.getElementById('xp-hover-text').textContent = hoverText;
    }
  } catch (e) { console.error("Failed to load XP", e); }
}

async function loadLeaderboard() {
  const container = document.getElementById('leaderboard-container');
  container.innerHTML = '<p class="placeholder-text">Syncing with global database...</p>';
  
  try {
    const url = `${SUPABASE_URL}/rest/v1/user_stats?order=true_watch_seconds.desc&limit=10`;
    const res = await fetch(url, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
    const topUsers = await res.json();
    
    container.innerHTML = '';
    
    if (!topUsers || topUsers.length === 0) {
      container.innerHTML = '<p class="placeholder-text">No data yet. Be the first to level up!</p>';
      return;
    }

    topUsers.forEach((user, index) => {
      // Relies on global userId from popup.js
      const isMe = (typeof userId !== 'undefined') && user.anilist_user_id === userId;
      const row = document.createElement('div');
      
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.padding = '8px 5px';
      row.style.borderBottom = '1px solid #1a2636';
      row.style.backgroundColor = isMe ? 'rgba(61, 180, 242, 0.1)' : 'transparent';
      
      const rankColor = index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : index === 2 ? '#CD7F32' : '#9fadbd';

      row.innerHTML = `
        <div style="width: 20px; font-weight: bold; color: ${rankColor}; font-size: 14px;">#${index + 1}</div>
        <img src="${user.avatar_url || ''}" style="width: 24px; height: 24px; border-radius: 50%; margin: 0 10px; object-fit: cover;">
        <div style="flex-grow: 1; font-size: 13px; color: ${isMe ? '#3db4f2' : '#fff'}; font-weight: ${isMe ? 'bold' : 'normal'};">
          ${user.username}
        </div>
        <div style="font-size: 12px; font-weight: bold; color: #E5C07B; background: rgba(229, 192, 123, 0.1); padding: 2px 6px; border-radius: 4px;">
          Lv. ${user.level}
        </div>
      `;
      container.appendChild(row);
    });
  } catch (error) {
     container.innerHTML = '<p class="placeholder-text" style="color: #e74c3c;">Failed to load leaderboard.</p>';
  }
}

async function loadAchievementsUI(currentUserId) {
  const container = document.getElementById('achievements-container');
  if (!container) return;
  container.innerHTML = '<p class="placeholder-text">Loading achievements...</p>';

  try {
    const url = `${SUPABASE_URL}/rest/v1/user_stats?anilist_user_id=eq.${currentUserId}&select=unlocked_achievements,tracking_data,true_watch_seconds`;
    const res = await fetch(url, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
    const data = await res.json();

    if (!data || data.length === 0) return;

    const unlockedIds = data[0].unlocked_achievements || [];
    const trackingData = data[0].tracking_data || {};
    const trueWatchSeconds = data[0].true_watch_seconds || 0;

    const syncBtn = document.getElementById('sync-history-btn');
    if (trackingData.has_synced_history && syncBtn) {
      syncBtn.classList.add('hidden');
    } else if (syncBtn) {
      syncBtn.classList.remove('hidden');
    }

    const currentStats = {
      totalEpisodesTracked: trackingData.total_episodes_tracked || 0,
      episodesToday: trackingData.episodes_today || 0,
      streak: trackingData.streak || 0,
      timeSavedSeconds: trackingData.total_time_saved || 0,
      trueWatchSeconds: trueWatchSeconds,
      level: Math.floor(1 + 99 * Math.sqrt((trueWatchSeconds / 60) / 500000)),
      completedSeries: trackingData.completed_series || 0,
      ratingsSubmitted: trackingData.ratings_submitted || 0
    };

    const unlockedList = ACHIEVEMENTS.filter(a => unlockedIds.includes(a.id)).reverse(); 
    const lockedList = ACHIEVEMENTS.filter(a => !unlockedIds.includes(a.id));
    const allSorted = [...unlockedList, ...lockedList];

    chrome.storage.local.get(['equippedBadge'], (storageRes) => {
      const activeIconPath = storageRes.equippedBadge || null;
      let html = '';

      allSorted.forEach((achieve, index) => {
        const isUnlocked = index < unlockedList.length;
        let progressHtml = '';
        
        if (!isUnlocked && achieve.progress) {
          const [current, max] = achieve.progress(currentStats);
          const displayCurrent = Math.floor(current);
          const pct = Math.min(100, Math.max(0, (displayCurrent / max) * 100));
          progressHtml = `
            <div class="achieve-prog-track">
              <div class="achieve-prog-fill" style="width: ${pct}%"></div>
              <div class="achieve-prog-text">${displayCurrent.toLocaleString()} / ${max.toLocaleString()}</div>
            </div>
          `;
        }

        const hiddenClass = index >= 3 ? 'hidden-achievement hidden' : '';
        const imgUrl = chrome.runtime.getURL(achieve.icon);
        const iconHtml = `<img src="${imgUrl}" alt="${achieve.name}" style="width: 32px; height: 32px; object-fit: contain; flex-shrink: 0;">`;
        
        let toggleHtml = '';
        if (isUnlocked) {
          const isChecked = (activeIconPath === achieve.icon) ? 'checked' : '';
          toggleHtml = `
            <input type="radio" name="badge-selector" class="badge-radio" value="${achieve.icon}" ${isChecked} 
                   style="cursor: pointer; width: 18px; height: 18px; accent-color: #E5C07B;" title="Equip this badge">
          `;
        } else {
          toggleHtml = `<div style="width: 18px; height: 18px; border: 1px dashed #555; border-radius: 3px;" title="Locked"></div>`;
        }
        
        html += `
          <div class="achieve-card ${isUnlocked ? 'unlocked' : 'locked'} ${hiddenClass}" 
               style="display: flex; align-items: center; justify-content: space-between; background-color: #151f2e; padding: 10px 12px; border-radius: 8px; border: 1px solid #2b3a4a; margin-bottom: 8px; opacity: ${isUnlocked ? '1' : '0.5'};">
            
            <div style="display: flex; gap: 12px; align-items: center; flex-grow: 1;">
              ${iconHtml}
              <div class="achieve-info" style="display: flex; flex-direction: column;">
                <div class="achieve-title" style="color: #fff; font-weight: bold; font-size: 14px;">${achieve.name}</div>
                <div class="achieve-desc" style="color: #9fadbd; font-size: 12px;">${achieve.description}</div>
                ${progressHtml}
              </div>
            </div>
            
            <div style="padding-left: 10px; display: flex; align-items: center; justify-content: center;">
              ${toggleHtml}
            </div>

          </div>
        `;
      });

      if (allSorted.length > 3) {
        html += `<button id="view-more-achievements" class="secondary-btn" style="width: 100%; margin-top: 8px;">View All Achievements</button>`;
      }

      container.innerHTML = html;

      document.querySelectorAll('.badge-radio').forEach(radio => {
        radio.addEventListener('change', (e) => {
          const selectedIcon = e.target.value;
          chrome.storage.local.set({ equippedBadge: selectedIcon });
          
          const headerBadge = document.getElementById('user-active-badge');
          if (headerBadge) {
            headerBadge.src = chrome.runtime.getURL(selectedIcon);
            headerBadge.classList.remove('hidden');
          }
        });
      });

      const viewMoreBtn = document.getElementById('view-more-achievements');
      if (viewMoreBtn) {
        viewMoreBtn.addEventListener('click', () => {
          document.querySelectorAll('.hidden-achievement').forEach(el => el.classList.remove('hidden'));
          viewMoreBtn.remove();
        });
      }
    });

  } catch (error) {
    container.innerHTML = '<p class="placeholder-text">Failed to load achievements.</p>';
  }
}

async function loadDetailedStats(currentUserId) {
  // 1. DYNAMIC GRAPHQL ROUTING
  const isManga = currentMode === 'MANGA';
  const statType = isManga ? 'manga' : 'anime';
  const customFields = isManga ? 'chaptersRead volumesRead' : 'episodesWatched minutesWatched';

  const query = `
    query ($userId: Int) {
      User(id: $userId) {
        statistics {
          ${statType} {
            count meanScore
            ${customFields}
            statuses(sort: COUNT_DESC) { count status }
            genres(limit: 6, sort: COUNT_DESC) { count genre }
            tags(limit: 6, sort: COUNT_DESC) { count tag { name } }
            formats(limit: 5, sort: COUNT_DESC) { count format }
            scores { count score } 
          }
        }
      }
    }
  `;

  try {
    const res = await apiRequest(query, { userId: currentUserId });
    
    if (res.errors) {
      throw new Error(res.errors[0].message);
    }

    const stats = res.data.User.statistics[statType];
    
    if (typeof userTopGenres !== 'undefined') {
      userTopGenres = stats.genres.slice(0, 5).map(g => g.genre);
    }

    // 2. DYNAMIC SUMMARY GRID UI
    let val2, lbl2, val3, lbl3;
    let icon1, icon2, icon3;

    if (isManga) {
      icon1 = '📚'; icon2 = '📖'; icon3 = '📦';
      val2 = stats.chaptersRead.toLocaleString();
      lbl2 = 'Chapters';
      val3 = stats.volumesRead.toLocaleString();
      lbl3 = 'Volumes';
    } else {
      icon1 = '📺'; icon2 = '▶️'; icon3 = '🕒';
      val2 = stats.episodesWatched.toLocaleString();
      lbl2 = 'Episodes';
      const mins = stats.minutesWatched;
      const days = Math.floor(mins / 1440);
      const hours = Math.floor((mins % 1440) / 60);
      val3 = days > 0 ? `${days}d ${hours}h` : `${hours}h ${mins % 60}m`;
      lbl3 = 'Watch Time';
    }
    
    document.getElementById('profile-summary-grid').innerHTML = `
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(255,255,255,0.05); color: #fff;">${icon1}</div>
        <div class="stat-info">
          <span class="stat-value">${stats.count.toLocaleString()}</span>
          <span class="stat-label">${isManga ? 'Series' : 'Shows'}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(61,180,242,0.1); color: var(--anilist-color);">${icon2}</div>
        <div class="stat-info">
          <span class="stat-value">${val2}</span>
          <span class="stat-label">${lbl2}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(229,192,123,0.1); color: #E5C07B;">${icon3}</div>
        <div class="stat-info">
          <span class="stat-value">${val3}</span>
          <span class="stat-label">${lbl3}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(76,202,81,0.1); color: #4cca51;">⭐</div>
        <div class="stat-info">
          <span class="stat-value">${stats.meanScore > 0 ? stats.meanScore : '0.0'}</span>
          <span class="stat-label">Mean Score</span>
        </div>
      </div>
    `;

    // The rest of the donut chart, genre grids, and score charts use identical data structures!
    const statusColors = {
      'CURRENT': 'var(--anilist-color)', 'COMPLETED': '#4cca51', 'PAUSED': '#f39c12', 
      'DROPPED': '#e74c3c', 'PLANNING': '#9fadbd'
    };
    const statusNames = {
      'CURRENT': isManga ? 'Reading' : 'Watching', 
      'COMPLETED': 'Completed', 'PAUSED': 'On Hold', 'DROPPED': 'Dropped', 
      'PLANNING': isManga ? 'Plan to Read' : 'Plan to Watch'
    };

    let conicString = '';
    let currentDegree = 0;
    let legendHtml = '';
    const totalStatusCount = stats.statuses.reduce((sum, s) => sum + s.count, 0);

    stats.statuses.forEach((s) => {
      const percentage = (s.count / totalStatusCount) * 100;
      const color = statusColors[s.status] || '#fff';
      
      conicString += `${color} ${currentDegree}% ${currentDegree + percentage}%, `;
      currentDegree += percentage;

      legendHtml += `
        <div class="legend-item">
          <div><span class="legend-dot" style="background-color: ${color};"></span>${statusNames[s.status] || s.status}</div>
          <b>${s.count}</b>
        </div>
      `;
    });

    document.getElementById('profile-collection-card').classList.remove('hidden');
    document.getElementById('donut-total-count').textContent = totalStatusCount;
    document.getElementById('status-donut').style.background = `conic-gradient(${conicString.slice(0, -2)})`;
    document.getElementById('status-legend-list').innerHTML = legendHtml;

    if (stats.genres.length > 0 || stats.tags.length > 0) {
      document.getElementById('profile-genres-card').classList.remove('hidden');
      
      const genresData = stats.genres || [];
      const themesData = stats.tags || [];

      const renderPrefGrid = (data, isTheme) => {
        if (!data || data.length === 0) {
          document.getElementById('genres-grid').innerHTML = '<p class="placeholder-text">No data available.</p>';
          return;
        }
        
        const maxCount = data[0].count; 
        let html = '';
        
        data.forEach(item => {
          const pct = (item.count / maxCount) * 100;
          const labelName = isTheme ? item.tag.name : item.genre; 
          
          html += `
            <div class="pref-card">
              <div class="pref-name">${labelName}</div>
              <div class="pref-count">${item.count}</div>
              <div class="pref-bar-bg"><div class="pref-bar-fill" style="width: ${pct}%;"></div></div>
            </div>
          `;
        });
        document.getElementById('genres-grid').innerHTML = html;
      };

      renderPrefGrid(genresData, false);

      const genreTab = document.getElementById('tab-genres');
      const themeTab = document.getElementById('tab-themes');

      genreTab.addEventListener('click', () => {
        genreTab.classList.add('active');
        themeTab.classList.remove('active');
        renderPrefGrid(genresData, false);
      });

      themeTab.addEventListener('click', () => {
        themeTab.classList.add('active');
        genreTab.classList.remove('active');
        renderPrefGrid(themesData, true);
      });
    }

    if (stats.formats && stats.formats.length > 0) {
      document.getElementById('profile-formats-card').classList.remove('hidden');
      const maxFormat = stats.formats[0].count;
      let formatHtml = '';

      stats.formats.forEach(f => {
        const pct = (f.count / maxFormat) * 100;
        formatHtml += `
          <div class="format-item">
            <div class="format-header"><span>${f.format}</span><span>${f.count}</span></div>
            <div class="pref-bar-bg"><div class="pref-bar-fill" style="width: ${pct}%; background-color: var(--anilist-color);"></div></div>
          </div>
        `;
      });
      document.getElementById('formats-list').innerHTML = formatHtml;
    } else {
       document.getElementById('profile-formats-card').classList.add('hidden');
    }

    // --- RENDER INTERACTIVE SCORE CHART ---
    if (stats.scores && stats.scores.length > 0) {
      document.getElementById('profile-scores-card').classList.remove('hidden');
      const chartContainer = document.getElementById('score-chart-container');
      const tooltip = document.getElementById('score-chart-tooltip');
      chartContainer.innerHTML = '';
      
      const maxScoreCount = Math.max(...stats.scores.map(s => s.count));
      const sortedScores = stats.scores.sort((a, b) => a.score - b.score);

      sortedScores.forEach(scoreData => {
        const heightPct = Math.max(5, (scoreData.count / maxScoreCount) * 100);
        
        const barWrapper = document.createElement('div');
        Object.assign(barWrapper.style, {
          flex: '1', display: 'flex', flexDirection: 'column', 
          alignItems: 'center', justifyContent: 'flex-end', height: '100%', cursor: 'pointer'
        });

        const bar = document.createElement('div');
        Object.assign(bar.style, {
          width: '100%', height: `${heightPct}%`, 
          backgroundColor: 'var(--anilist-color-bg)', 
          borderTopLeftRadius: '4px', borderTopRightRadius: '4px',
          transition: 'all 0.2s ease', border: '1px solid transparent'
        });

        const label = document.createElement('span');
        label.textContent = scoreData.score;
        Object.assign(label.style, {
          fontSize: '9px', color: '#9fadbd', marginTop: '4px'
        });

        barWrapper.addEventListener('mouseenter', () => {
          bar.style.backgroundColor = 'var(--anilist-color)';
          bar.style.boxShadow = '0 0 8px var(--anilist-color)';
          label.style.color = '#fff';
          label.style.fontWeight = 'bold';
          tooltip.innerHTML = `Score <b style="color: #fff;">${scoreData.score}</b> awarded <b style="color: #fff;">${scoreData.count}</b> times`;
        });

        barWrapper.addEventListener('mouseleave', () => {
          bar.style.backgroundColor = 'var(--anilist-color-bg)';
          bar.style.boxShadow = 'none';
          label.style.color = '#9fadbd';
          label.style.fontWeight = 'normal';
          tooltip.textContent = 'Hover over a bar to see details';
        });

        barWrapper.appendChild(bar);
        barWrapper.appendChild(label);
        chartContainer.appendChild(barWrapper);
      });
    } else {
        document.getElementById('profile-scores-card').classList.add('hidden');
    }

  } catch (error) {
    console.error("Failed to load AniList stats:", error);
    document.getElementById('profile-summary-grid').innerHTML = `<p class="placeholder-text">Failed to load statistics: ${error.message}</p>`;
  }
}