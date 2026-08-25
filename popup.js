// popup.js
const CLIENT_ID = window.ANILIST_CLIENT_ID || '45996'; 
const SECOND_CLIENT_ID = window.MAL_CLIENT_ID || '5f2a8c1ef34ae37bbc72eaf847bc52e3';
let accessToken = null;
let userId = null;
let currentSelectedAnime = null; 
let cachedWatchingList = []; 
let cachedAllScheduleList = []; 
let currentDayTabIndex = new Date().getDay(); 
let currentFilter = 'SCHEDULE'; 
const debounceTimers = {}; 
let currentThreshold = 80;
let currentMode = 'ANIME';
let detectedMedia = null;
let detectedEpisode = null;
let hiddenMediaIds = [];

// ✅ NEW: Centralized View Router
window.showAppView = function(targetViewId, showSearch = false) {
  const views = [
    'main-view', 'settings-view', 'detail-view', 'profile-view',
    'leaderboard-view', 'recommendation-view', 'autodetect-view', 'whitelist-view'
  ];
  
  // Hide all views, show only the target
  views.forEach(viewId => {
    const el = document.getElementById(viewId);
    if (el) {
      if (viewId === targetViewId) el.classList.remove('hidden');
      else el.classList.add('hidden');
    }
  });

  // Handle global search input
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    if (showSearch) searchInput.classList.remove('hidden');
    else searchInput.classList.add('hidden');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['anilistToken', 'trackingThreshold', 'currentMode'], (localRes) => {
    chrome.storage.sync.get(['hiddenMediaIds'], (syncRes) => {
      chrome.storage.local.remove('ignoredDomains'); 

      if (localRes.trackingThreshold) currentThreshold = localRes.trackingThreshold;
      if (syncRes.hiddenMediaIds) hiddenMediaIds = syncRes.hiddenMediaIds;
      if (localRes.currentMode) currentMode = localRes.currentMode;
      
      const modeIcon = document.getElementById('mode-icon');
      if (modeIcon) modeIcon.src = currentMode === 'ANIME' ? 'icons/monitor.svg' : 'icons/book-open.svg';
      
      currentFilter = currentMode === 'ANIME' ? 'SCHEDULE' : 'CURRENT';
      const viewLabel = document.getElementById('current-view-label');
      if (viewLabel) viewLabel.textContent = currentMode === 'ANIME' ? 'Schedule (My List) ▾' : 'Currently Reading ▾';
      
      updateDropdownMenu();
      if (localRes.anilistToken) {
        accessToken = localRes.anilistToken;
        updateAuthUI(true);
        initializeApp(); 
      } else {
        updateAuthUI(false);
      }
    });
  });

  document.getElementById('login-btn').addEventListener('click', handleLoginClick);
  document.getElementById('logout-btn').addEventListener('click', handleLogoutClick);
  
  const malLoginBtn = document.getElementById('mal-login-btn');
  if (malLoginBtn) malLoginBtn.addEventListener('click', handleMalLoginClick);

  const settingsAniBtn = document.getElementById('settings-anilist-link-btn');
  if (settingsAniBtn) settingsAniBtn.addEventListener('click', handleLoginClick);
  
  const settingsMalBtn = document.getElementById('settings-mal-link-btn');
  if (settingsMalBtn) settingsMalBtn.addEventListener('click', handleMalLoginClick);
  
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.malToken && changes.malToken.newValue) {
      const btn = document.getElementById('settings-mal-link-btn');
      if (btn) {
        btn.textContent = "✓ MAL Connected";
        btn.style.borderColor = "#4cca51";
        btn.style.color = "#4cca51";
        btn.disabled = true;
      }
    }
  });

  const syncShiinahBtn = document.getElementById('sync-shiinah-btn');
  if (syncShiinahBtn) {
    syncShiinahBtn.addEventListener('click', () => {
      const statusText = document.getElementById('sync-status-text');
      const progressContainer = document.getElementById('sync-progress-container');
      const progressBar = document.getElementById('sync-progress-bar');
      
      syncShiinahBtn.disabled = true;
      syncShiinahBtn.style.opacity = '0.5';
      if (progressContainer) progressContainer.classList.remove('hidden');
      if (progressBar) progressBar.style.width = '0%';
      if (statusText) {
        statusText.style.color = '#3db4f2';
        statusText.textContent = "Fetching and comparing libraries...";
      }
      chrome.runtime.sendMessage({ action: "SYNC_SMART_MERGE" });
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "SYNC_PROGRESS") {
      const progressBar = document.getElementById('sync-progress-bar');
      const statusText = document.getElementById('sync-status-text');
      if (progressBar) progressBar.style.width = `${(message.current / message.total) * 100}%`;
      if (statusText) statusText.textContent = `Syncing: ${message.current} / ${message.total} (${message.title})`;
    } else if (message.action === "SYNC_COMPLETE") {
      const statusText = document.getElementById('sync-status-text');
      const syncBtn = document.getElementById('sync-shiinah-btn');
      if (statusText) {
        statusText.textContent = `✅ Sync Complete! ${message.updatesMade} updates made.`;
        statusText.style.color = "#4cca51";
      }
      if (syncBtn) {
        syncBtn.disabled = false;
        syncBtn.style.opacity = '1';
      }
    }
  });

  // Global Back Buttons using the Router
  document.getElementById('back-btn')?.addEventListener('click', () => {
    window.showAppView('main-view', true);
  });
  document.getElementById('leaderboard-back-btn')?.addEventListener('click', () => {
    window.showAppView('main-view', true);
  });
  document.getElementById('profile-back-btn')?.addEventListener('click', () => {
    window.showAppView('main-view', true);
  });

  function updateDropdownMenu() {
    const dropdown = document.getElementById('filter-dropdown');
    if (!dropdown) return;
    
    if (currentMode === 'ANIME') {
      dropdown.innerHTML = `
        <div class="filter-option" data-value="SCHEDULE">Schedule (My List)</div>
        <div class="filter-option" data-value="SCHEDULE_ALL">Schedule (All Airing)</div>
        <div class="filter-option" data-value="CURRENT">Watching</div>
        <div class="filter-option" data-value="PLANNING">Planning</div>
        <div class="filter-option" data-value="UPCOMING">Upcoming (Next Season)</div>
        <div class="filter-option" data-value="UNFINISHED" style="border-top: 1px solid #2b3a4a; color: #3db4f2;">Unfinished (OTG)</div>
        <div class="filter-option" data-value="LEADERBOARD" style="border-top: 1px solid #2b3a4a; color: #E5C07B;">Global Leaderboard</div>
      `;
    } else {
      dropdown.innerHTML = `
        <div class="filter-option" data-value="CURRENT">Currently Reading</div>
        <div class="filter-option" data-value="PLANNING">Plan to Read</div>
        <div class="filter-option" data-value="COMPLETED">Completed</div>
        <div class="filter-option" data-value="UNFINISHED" style="border-top: 1px solid #2b3a4a; color: #3db4f2;">Unfinished (OTG)</div>
        <div class="filter-option" data-value="LEADERBOARD" style="border-top: 1px solid #2b3a4a; color: #E5C07B;">Global Leaderboard</div>
      `;
    }
  }

  const filterDropdown = document.getElementById('filter-dropdown');
  if (filterDropdown) {
    filterDropdown.addEventListener('click', (e) => {
      const target = e.target.closest('.filter-option');
      if (!target) return;
      currentFilter = target.dataset.value;
      document.getElementById('current-view-label').textContent = target.textContent + ' ▾';
      filterDropdown.classList.add('hidden');
      document.getElementById('search-input').value = '';

      if (currentFilter === 'LEADERBOARD') {
        window.showAppView('leaderboard-view', false);
        if (typeof loadLeaderboard === 'function') loadLeaderboard();
      } else if (currentFilter === 'UNFINISHED') {
        window.showAppView('main-view', true);
        document.getElementById('day-tabs').classList.add('hidden');
        if (typeof loadUnfinishedList === 'function') loadUnfinishedList();
      } else if (accessToken) {
        loadAnimeList();
      }
    });
  }

  const modeBtn = document.getElementById('mode-toggle-btn');
  if (modeBtn) {
    updateDropdownMenu();
    modeBtn.addEventListener('click', () => {
      currentMode = currentMode === 'ANIME' ? 'MANGA' : 'ANIME';
      
      const modeIcon = document.getElementById('mode-icon');
      if (modeIcon) modeIcon.src = currentMode === 'ANIME' ? 'icons/monitor.svg' : 'icons/book-open.svg';
      
      chrome.storage.local.set({ currentMode: currentMode });
      currentFilter = currentMode === 'ANIME' ? 'SCHEDULE' : 'CURRENT';
      const viewLabel = document.getElementById('current-view-label');
      if (viewLabel) viewLabel.textContent = currentMode === 'ANIME' ? 'Schedule (My List) ▾' : 'Currently Reading ▾';
      
      updateDropdownMenu();
      const searchInput = document.getElementById('search-input');
      if (searchInput) searchInput.value = ''; 
      
      const profileView = document.getElementById('profile-view');
      if (profileView && !profileView.classList.contains('hidden')) {
        if (typeof userId !== 'undefined' && userId) {
          if (typeof loadDetailedStats === 'function') loadDetailedStats(userId);
          const timeSavedEl = document.getElementById('time-saved-display');
          if (timeSavedEl && timeSavedEl.parentElement) {
            timeSavedEl.parentElement.style.display = currentMode === 'ANIME' ? 'block' : 'none';
          }
        }
      } else if (accessToken) {
        loadAnimeList();
      }
    });
  }

  document.getElementById('search-input').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    document.querySelectorAll('.anime-list-item').forEach(item => {
      const titleData = item.getAttribute('data-title') || '';
      item.style.display = titleData.includes(term) ? 'flex' : 'none';
    });
  });

  document.getElementById('user-profile').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('filter-dropdown').classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#user-profile') && !e.target.closest('#filter-dropdown')) {
      const dropdown = document.getElementById('filter-dropdown');
      if (dropdown) dropdown.classList.add('hidden');
    }
  });

  const hideToggle = document.getElementById('hide-title-toggle');
  if (hideToggle) {
    hideToggle.addEventListener('change', (e) => {
      if (!currentSelectedAnime) return;
      const id = currentSelectedAnime.media.id;
      if (e.target.checked) {
        if (!hiddenMediaIds.includes(id)) hiddenMediaIds.push(id);
      } else {
        hiddenMediaIds = hiddenMediaIds.filter(hid => hid !== id);
      }
      chrome.storage.sync.set({ hiddenMediaIds: hiddenMediaIds });
    });
  }

  const statusSelect = document.getElementById('status-select');
  if (statusSelect) {
    statusSelect.addEventListener('change', (e) => {
      if (e.target.value === 'COMPLETED' && currentSelectedAnime?.media?.episodes) {
        document.getElementById('episode-input').value = currentSelectedAnime.media.episodes;
      }
    });
  }

  const skipBtn = document.getElementById('skip-intro-btn');
  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: "SMART_SKIP" });
          chrome.storage.local.get(['timeSavedSeconds', 'lastSkipTimestamp'], (res) => {
            const now = Date.now();
            const lastSkip = res.lastSkipTimestamp || 0;
            if (now - lastSkip < 60000) {
              const originalText = skipBtn.textContent;
              skipBtn.textContent = "Cooldown!";
              skipBtn.style.color = "#e74c3c";
              setTimeout(() => { skipBtn.textContent = originalText; skipBtn.style.color = "#E5C07B"; }, 1500);
              return; 
            }
            const newTotal = (res.timeSavedSeconds || 0) + 90;
            chrome.storage.local.set({ timeSavedSeconds: newTotal, lastSkipTimestamp: now });
            const timeSavedDisplay = document.getElementById('time-saved-display');
            if (timeSavedDisplay) timeSavedDisplay.textContent = `${Math.floor(newTotal / 60)}m`;
          });
        }
      });
    });
  }

  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      window.showAppView('settings-view', false);
      
      chrome.storage.local.get(['trackingThreshold', 'whitelistedDomains', 'anilistToken', 'malToken', 'autoSkipEnabled', 'showUnlistedBadges'], (res) => {
        const threshold = res.trackingThreshold || 80;
        const slider = document.getElementById('threshold-slider');
        const display = document.getElementById('threshold-display');
        if (slider && display) { slider.value = threshold; display.textContent = `${threshold}%`; }
        
        const autoSkipToggle = document.getElementById('auto-skip-toggle');
        if (autoSkipToggle) autoSkipToggle.checked = !!res.autoSkipEnabled;

        const unlistedToggle = document.getElementById('unlisted-badge-toggle');
        if (unlistedToggle) unlistedToggle.checked = res.showUnlistedBadges !== false;

        renderWhitelistManager(res.whitelistedDomains || []);

        const aniLinkBtn = document.getElementById('settings-anilist-link-btn');
        const malLinkBtn = document.getElementById('settings-mal-link-btn');
        const syncSection = document.getElementById('cross-sync-section');
        
        let hasAniList = false; let hasMal = false;

        if (aniLinkBtn) {
          if (res.anilistToken) {
            hasAniList = true; aniLinkBtn.textContent = "✓ AniList Connected";
            aniLinkBtn.style.borderColor = "#4cca51"; aniLinkBtn.style.color = "#4cca51"; aniLinkBtn.disabled = true; 
          } else {
            aniLinkBtn.textContent = "Link to AniList"; aniLinkBtn.style.borderColor = "#3db4f2";
            aniLinkBtn.style.color = "#3db4f2"; aniLinkBtn.disabled = false;
          }
        }

        if (malLinkBtn) {
          if (res.malToken) {
            hasMal = true; malLinkBtn.textContent = "✓ MAL Connected";
            malLinkBtn.style.borderColor = "#4cca51"; malLinkBtn.style.color = "#4cca51"; malLinkBtn.disabled = true; 
          } else {
            malLinkBtn.textContent = "Link to MyAnimeList"; malLinkBtn.style.borderColor = "#5C7CE5"; 
            malLinkBtn.style.color = "#5C7CE5"; malLinkBtn.disabled = false;
          }
        }

        if (hasAniList && hasMal && syncSection) syncSection.classList.remove('hidden');
        else if (syncSection) syncSection.classList.add('hidden');
      });
    });
  }

  const settingsBackBtn = document.getElementById('settings-back-btn');
  if (settingsBackBtn) {
    settingsBackBtn.addEventListener('click', () => {
      loadAnimeList(true); 
    });
  }

  const thresholdSlider = document.getElementById('threshold-slider');
  if (thresholdSlider) {
    thresholdSlider.addEventListener('input', (e) => {
      const display = document.getElementById('threshold-display');
      if (display) display.textContent = `${e.target.value}%`;
    });
    thresholdSlider.addEventListener('change', (e) => {
      currentThreshold = parseInt(e.target.value, 10); 
      chrome.storage.local.set({ trackingThreshold: currentThreshold });
    });
  }

  const autoSkipToggle = document.getElementById('auto-skip-toggle');
  if (autoSkipToggle) {
    autoSkipToggle.addEventListener('change', (e) => chrome.storage.local.set({ autoSkipEnabled: e.target.checked }));
  }

  const unlistedToggle = document.getElementById('unlisted-badge-toggle');
  if (unlistedToggle) {
    unlistedToggle.addEventListener('change', (e) => chrome.storage.local.set({ showUnlistedBadges: e.target.checked, trigger_dom_refresh: Date.now() }));
  }

  const autodetectCancelBtn = document.getElementById('autodetect-cancel-btn');
  if (autodetectCancelBtn) {
    autodetectCancelBtn.addEventListener('click', () => {
      loadAnimeList(); 
    });
  }

  const handleWhitelist = (type) => {
    const hostnameEl = document.getElementById('whitelist-hostname');
    if (!hostnameEl) return;
    const hostname = hostnameEl.textContent.trim();

    chrome.storage.local.get(['whitelistedDomains'], (result) => {
      let domains = result.whitelistedDomains || [];
      domains = domains.filter(d => (typeof d === 'string' ? d : d.domain) !== hostname);
      domains.push({ domain: hostname, type: type });
      
      chrome.storage.local.set({ whitelistedDomains: domains }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && !tabs[0].url.includes('chrome://')) chrome.tabs.reload(tabs[0].id);
          window.close(); 
        });
      });
    });
  };

  const wlAnimeBtn = document.getElementById('whitelist-anime-btn');
  const wlMangaBtn = document.getElementById('whitelist-manga-btn');
  if (wlAnimeBtn) wlAnimeBtn.addEventListener('click', () => handleWhitelist('ANIME'));
  if (wlMangaBtn) wlMangaBtn.addEventListener('click', () => handleWhitelist('MANGA'));

  const whitelistCancelBtn = document.getElementById('whitelist-cancel-btn');
  if (whitelistCancelBtn) {
    const newCancelBtn = whitelistCancelBtn.cloneNode(true);
    whitelistCancelBtn.replaceWith(newCancelBtn);
    newCancelBtn.addEventListener('click', () => {
      loadAnimeList(); 
    });
  }

  const epInput = document.getElementById('episode-input');
  if (epInput) epInput.addEventListener('input', handleEpisodeInput);
  
  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) saveBtn.addEventListener('click', saveAnimeUpdate);

  const detailImg = document.getElementById('detail-image');
  if (detailImg) {
    detailImg.addEventListener('click', () => {
      if (currentSelectedAnime) {
        document.getElementById('modal-img').src = currentSelectedAnime.media.coverImage.large;
        document.getElementById('fullscreen-modal').classList.remove('hidden');
      }
    });
  }

  const fullModal = document.getElementById('fullscreen-modal');
  if (fullModal) {
    fullModal.addEventListener('click', () => fullModal.classList.add('hidden'));
  }

  const autoConfirmBtn = document.getElementById('autodetect-confirm-btn');
  if (autoConfirmBtn) autoConfirmBtn.addEventListener('click', handleAutoDetectConfirm);

  // Binding Event Listeners
  document.getElementById('bind-id-btn')?.addEventListener('click', () => {
    const inputVal = document.getElementById('bind-id-input').value;
    const parsed = parseMediaIdFromInput(inputVal);
    if (!parsed || !currentSelectedAnime) return;
    
    const btn = document.getElementById('bind-id-btn');
    btn.textContent = 'Binding...';
    btn.disabled = true;
  
    chrome.runtime.sendMessage({
      action: "REBIND_MEDIA_ID",
      oldMediaId: currentSelectedAnime.media.id,
      targetId: parsed.id,
      targetType: parsed.type,
      mediaType: currentMode,
      title: currentSelectedAnime.media.title.romaji,
      progress: parseInt(document.getElementById('episode-input').value, 10) || 0
    }, (res) => {
      btn.disabled = false;
      if (res && res.success) {
        btn.textContent = 'Bound! ✓';
        setTimeout(() => {
          btn.textContent = 'Bind';
          loadAnimeList(true);
        }, 800);
      } else {
        btn.textContent = 'Failed';
        setTimeout(() => { btn.textContent = 'Bind'; }, 1500);
      }
    });
  });
  
  document.getElementById('mark-unlisted-btn')?.addEventListener('click', () => {
    if (!currentSelectedAnime) return;
    const btn = document.getElementById('mark-unlisted-btn');
    btn.textContent = 'Updating...';
    btn.disabled = true;
  
    chrome.runtime.sendMessage({
      action: "MARK_AS_UNLISTED",
      oldMediaId: currentSelectedAnime.media.id,
      title: currentSelectedAnime.media.title.romaji,
      progress: parseInt(document.getElementById('episode-input').value, 10) || 0,
      mediaType: currentMode
    }, (res) => {
      btn.disabled = false;
      btn.textContent = 'Set as Unlisted (Local OTG Only)';
      loadAnimeList(true);
    });
  });
});

function parseMediaIdFromInput(inputVal) {
  if (!inputVal) return null;
  inputVal = inputVal.trim();
  const alMatch = inputVal.match(/anilist\.co\/(?:anime|manga)\/(\d+)/i);
  if (alMatch) return { type: 'AL', id: parseInt(alMatch[1], 10) };
  const malMatch = inputVal.match(/myanimelist\.net\/(?:anime|manga)\/(\d+)/i);
  if (malMatch) return { type: 'MAL', id: parseInt(malMatch[1], 10) };
  if (/^\d+$/.test(inputVal)) return { type: 'AL', id: parseInt(inputVal, 10) };
  return null;
}

// Authentication Logic
function handleLoginClick(e) {
  const btn = e ? e.currentTarget : document.getElementById('login-btn');
  const originalText = btn ? btn.textContent : "Log In";
  if (btn) btn.textContent = "Connecting...";

  const safeClientId = typeof CLIENT_ID !== 'undefined' ? CLIENT_ID : '45996';
  const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${safeClientId}&response_type=token`;

  chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirectUrlResult) => {
    if (chrome.runtime.lastError || !redirectUrlResult) {
      if (btn) btn.textContent = "Error - Check Console";
      setTimeout(() => { if (btn) btn.textContent = originalText; }, 3000);
      return;
    }
    const hash = new URL(redirectUrlResult).hash;
    const token = new URLSearchParams(hash.substring(1)).get('access_token');
    
    if (token) {
      accessToken = token;
      chrome.storage.local.set({ anilistToken: accessToken }, () => {
        updateAuthUI(true);
        initializeApp();
        if (btn && btn.id.includes('settings')) {
          btn.textContent = "✓ AniList Connected"; btn.style.borderColor = "#4cca51"; btn.style.color = "#4cca51";
        } else if (btn) btn.textContent = originalText; 
      });
    } else {
      if (btn) btn.textContent = "Failed to get token";
      setTimeout(() => { if (btn) btn.textContent = originalText; }, 3000);
    }
  });
}

function handleMalLoginClick(e) {
  const btn = e ? e.currentTarget : document.getElementById('settings-mal-link-btn');
  if (btn) btn.textContent = "Check browser window...";
  chrome.runtime.sendMessage({ action: "LOGIN_MAL" });
}

function handleLogoutClick() {
  chrome.storage.local.remove(['anilistToken', 'malToken', 'malRefreshToken', 'cachedList_data', 'cachedList_filter'], () => {
    accessToken = null; userId = null; currentSelectedAnime = null;
    cachedWatchingList = []; cachedAllScheduleList = []; currentFilter = 'SCHEDULE';
    
    document.getElementById('day-tabs').innerHTML = '';
    document.getElementById('anime-list').innerHTML = '';
    document.getElementById('current-view-label').textContent = 'Schedule (My List) ▾';
    chrome.action.setBadgeText({ text: '' }); 
    
    chrome.cookies.getAll({ domain: "anilist.co" }, (cookies) => {
      cookies.forEach(cookie => {
        const cookieUrl = "https://" + (cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain) + cookie.path;
        chrome.cookies.remove({ url: cookieUrl, name: cookie.name });
      });
    });
    updateAuthUI(false);
  });
}

function updateAuthUI(isLoggedIn) {
  const loginView = document.getElementById('login-view');
  const appView = document.getElementById('app-view');

  if (isLoggedIn) {
    if (loginView) loginView.classList.add('hidden');
    if (appView) appView.classList.remove('hidden');
    if (window.showAppView) window.showAppView('main-view', true);
  } else {
    if (loginView) loginView.classList.remove('hidden');
    if (appView) appView.classList.add('hidden');
  }
}

async function apiRequest(query, variables = {}) {
  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  return response.json();
}

async function initializeApp() {
  document.getElementById('anime-list').innerHTML = '';
  const viewerQuery = `query { Viewer { id name avatar { medium } options { profileColor } } }`;
  
  try {
    const data = await apiRequest(viewerQuery);
    const viewer = data.data.Viewer;
    userId = viewer.id;
    
    document.getElementById('user-avatar').src = viewer.avatar.medium;
    document.getElementById('user-name').textContent = viewer.name;

    const colorMap = { "blue": "#3db4f2", "purple": "#c063ff", "pink": "#fc9dd6", "orange": "#ef881a", "red": "#e13333", "green": "#4cca51", "gray": "#677b94" };
    const userColor = viewer.options?.profileColor;
    const hexColor = colorMap[userColor] || userColor || "#3db4f2";
    document.documentElement.style.setProperty('--anilist-color', hexColor);

    chrome.storage.local.set({ anilistUserId: userId, anilistUsername: viewer.name, anilistAvatar: viewer.avatar.medium });

    chrome.storage.local.get(['equippedBadge'], (res) => {
      if (res.equippedBadge) {
        const badgeImg = document.getElementById('user-active-badge');
        badgeImg.src = res.equippedBadge;
        badgeImg.classList.remove('hidden');
      }
    });

    if (typeof loadUserLevel === 'function') loadUserLevel(userId);

    chrome.runtime.sendMessage({ action: "FETCH_CLOUD_PREFS", userId: userId }, () => {
      chrome.storage.local.get(['cloud_mal_linked', 'malToken'], (prefs) => {
        const banner = document.getElementById('mal-link-banner');
        const linkBtn = document.getElementById('banner-mal-link-btn');
        if (prefs.cloud_mal_linked && !prefs.malToken && banner) {
          banner.classList.remove('hidden');
          linkBtn.addEventListener('click', handleMalLoginClick);
        } else if (banner) {
          banner.classList.add('hidden');
        }
      });
    });

    const foundAnimeOnTab = await checkCurrentTabForAnime();
    if (!foundAnimeOnTab) loadAnimeList(); 
  } catch (error) {}
}

function renderWhitelistManager(domains) {
  const container = document.getElementById('whitelist-manager-list');
  if (!container) return;
  container.innerHTML = '';

  if (domains.length === 0) {
    container.innerHTML = '<p class="placeholder-text">No sites whitelisted yet.</p>';
    return;
  }

  domains.forEach((d, index) => {
    const domainStr = typeof d === 'string' ? d : d.domain;
    const domainType = typeof d === 'string' ? 'ANIME' : (d.type || 'ANIME');

    const item = document.createElement('div');
    Object.assign(item.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid #1a2636', fontSize: '13px' });
    
    item.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <div class="domain-type-toggle ${domainType.toLowerCase()}" data-index="${index}" title="Toggle Anime/Manga">
          <div class="domain-type-indicator">${domainType === 'ANIME' ? 'A' : 'M'}</div>
        </div>
        <span>${domainStr}</span>
      </div>
      <button class="remove-domain-btn" data-index="${index}" style="background: transparent; color: #E06C75; border: none; cursor: pointer; font-weight: bold;">✕</button>
    `;
    container.appendChild(item);
  });

  document.querySelectorAll('.domain-type-toggle').forEach(toggle => {
    toggle.addEventListener('click', (e) => {
      const idx = e.currentTarget.getAttribute('data-index');
      let currentObj = domains[idx];
      if (typeof currentObj === 'string') currentObj = { domain: currentObj, type: 'MANGA' };
      else currentObj.type = currentObj.type === 'ANIME' ? 'MANGA' : 'ANIME';
      
      domains[idx] = currentObj;
      chrome.storage.local.set({ whitelistedDomains: domains }, () => renderWhitelistManager(domains));
    });
  });

  document.querySelectorAll('.remove-domain-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = e.target.getAttribute('data-index');
      domains.splice(idx, 1);
      chrome.storage.local.set({ whitelistedDomains: domains }, () => renderWhitelistManager(domains));
    });
  });
}

async function searchAnimeWithFallbacks(rawTitle, apiType) {
  const query = `
    query ($search: String, $type: MediaType) {
      Media (search: $search, type: $type, sort: SEARCH_MATCH) {
        id idMal status title { romaji english } coverImage { large medium } episodes chapters
        mediaListEntry { id progress status }
      }
    }
  `;

  async function doSearch(term) {
    const res = await apiRequest(query, { search: term, type: apiType });
    return res.data?.Media || null;
  }

  function getSearchPermutations(title) {
    const base = title.replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();
    const noBrackets = base.replace(/\[.*?\]|\(.*?\)/g, '').trim();
    const noPunc = noBrackets.replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
    const shortTerm = noPunc.split(' ').slice(0, 4).join(' '); 
    const splitDash = base.split(/[:\-]/)[0].trim();
    return [...new Set([base, noBrackets, noPunc, splitDash, shortTerm])].filter(t => t.length > 2);
  }

  const perms = getSearchPermutations(rawTitle);

  for (const term of perms) {
    let media = await doSearch(term);
    if (media) return media;
  }

  const endpoint = apiType === 'ANIME' ? 'anime' : 'manga';
  let resolvedMalId = null;
  let tenraiNode = null;

  for (const term of perms) {
    try {
      const tenraiRes = await fetch(`https://api.tenrai.org/v1/${endpoint}?q=${encodeURIComponent(term)}&limit=1`);
      if (tenraiRes.ok) {
        const tenraiData = await tenraiRes.json();
        if (tenraiData?.data && tenraiData.data.length > 0) {
          tenraiNode = tenraiData.data[0];
          resolvedMalId = tenraiNode.mal_id;

          const crossRefQuery = `query($idMal: Int, $type: MediaType) { Media(idMal: $idMal, type: $type) { id idMal status title { romaji english } coverImage { large medium } episodes chapters mediaListEntry { id progress status } } }`;
          const crossRefRes = await apiRequest(crossRefQuery, { idMal: resolvedMalId, type: apiType });
          
          if (crossRefRes.data?.Media) {
              return crossRefRes.data.Media; 
          }
          break; 
        }
      }
    } catch(e) {}
  }

  const storage = await chrome.storage.local.get(['malToken']);
  if (storage.malToken) {
    if (resolvedMalId) {
      try {
        const res = await fetch(`https://api.myanimelist.net/v2/${endpoint}/${resolvedMalId}?fields=id,title,alternative_titles,main_picture,status,num_episodes,num_chapters,my_list_status`, {
          headers: { 'Authorization': `Bearer ${storage.malToken}` }
        });
        const malNode = await res.json();
        if (malNode && malNode.id) {
          return {
            id: -malNode.id, idMal: malNode.id, isMalOnly: true, status: malNode.status ? malNode.status.toUpperCase() : "RELEASING",
            title: { romaji: malNode.title, english: malNode.alternative_titles?.en || malNode.title },
            coverImage: { large: malNode.main_picture?.large, medium: malNode.main_picture?.medium },
            episodes: apiType === 'ANIME' ? (malNode.num_episodes || null) : null, chapters: apiType === 'MANGA' ? (malNode.num_chapters || null) : null,
            mediaListEntry: malNode.my_list_status ? { progress: apiType === 'ANIME' ? malNode.my_list_status.num_episodes_watched : malNode.my_list_status.num_chapters_read, status: 'CURRENT' } : null
          };
        }
      } catch(e) {}
    }

    for (const term of perms) {
      try {
        const res = await fetch(`https://api.myanimelist.net/v2/${endpoint}?q=${encodeURIComponent(term)}&limit=1&fields=id,title,alternative_titles,main_picture,status,num_episodes,num_chapters,my_list_status`, {
          headers: { 'Authorization': `Bearer ${storage.malToken}` }
        });
        const data = await res.json();
        if (data?.data && data.data.length > 0) {
          const malNode = data.data[0].node;
          return {
            id: -malNode.id, idMal: malNode.id, isMalOnly: true, status: malNode.status ? malNode.status.toUpperCase() : "RELEASING",
            title: { romaji: malNode.title, english: malNode.alternative_titles?.en || malNode.title },
            coverImage: { large: malNode.main_picture?.large, medium: malNode.main_picture?.medium },
            episodes: apiType === 'ANIME' ? (malNode.num_episodes || null) : null, chapters: apiType === 'MANGA' ? (malNode.num_chapters || null) : null,
            mediaListEntry: malNode.my_list_status ? { progress: apiType === 'ANIME' ? malNode.my_list_status.num_episodes_watched : malNode.my_list_status.num_chapters_read, status: 'CURRENT' } : null
          };
        }
      } catch(e) {}
    }
  }

  if (tenraiNode) {
      return {
        id: -tenraiNode.mal_id, idMal: tenraiNode.mal_id, isMalOnly: true, status: tenraiNode.status ? tenraiNode.status.toUpperCase() : "RELEASING",
        title: { romaji: tenraiNode.title, english: tenraiNode.title_english || tenraiNode.title },
        coverImage: { large: tenraiNode.images?.jpg?.large_image_url || '', medium: tenraiNode.images?.jpg?.image_url || '' },
        episodes: apiType === 'ANIME' ? (tenraiNode.episodes || null) : null, chapters: apiType === 'MANGA' ? (tenraiNode.chapters || null) : null,
        mediaListEntry: null 
      };
  }
  return null; 
}

async function checkCurrentTabForAnime() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs || tabs.length === 0) return resolve(false);
      
      const title = tabs[0].title || "";
      let hostname = "unknown";
      try { if (tabs[0].url) hostname = new URL(tabs[0].url).hostname; } catch (e) {}

      let parsedTitle = "", parsedProgress = 0, detectedType = null; 

      const animeRegex = /(?:Watch\s+)?(.*?)\s*(?:[-|—–:~]+\s*)?(?:Season\s*\d+\s*)?(?:Episode|Ep|EP|E)\.?\s*0*(\d+)/i;
      const animeMatch = title.match(animeRegex);
      
      if (animeMatch && animeMatch[1] && animeMatch[2]) {
        parsedTitle = animeMatch[1].replace(/[-|—–:~]+$/g, '').replace(/\s+\(?(?:Sub|Dub)\)?$/i, '').trim();
        parsedProgress = parseInt(animeMatch[2], 10);
        detectedType = 'ANIME';
      } 
      else {
        const chapRegex = /(?:Chapter|Ch\.|Ch)\s*0*(\d+(\.\d+)?)/i;
        const looseRegex = /[-|\|]\s*0*(\d+(\.\d+)?)\s*(?:\||-|$)/;
        const chapMatch = title.match(chapRegex) || title.match(looseRegex);
        
        if (chapMatch) {
          parsedProgress = parseFloat(chapMatch[1]);
          const leftSide = title.substring(0, chapMatch.index).trim();
          let targetText = leftSide;
          
          const cleanLeft = leftSide.replace(/[()[\]|]/g, '').trim();
          if (cleanLeft === '' || /^(?:page\s*)?\d+\s*[-/]?\s*(?:\d+)?$/i.test(cleanLeft)) {
            const rightSide = title.substring(chapMatch.index + chapMatch[0].length).trim();
            targetText = rightSide.replace(/[-|—|\|]\s*[a-zA-Z0-9]+$/i, '').trim();
          }

          let clean = targetText.replace(/\b(?:Read|Watch|Free|English|Online|Scanlation|Scans|Scan|Manga|Manhwa|Manhua|Webtoon)\b/gi, '');
          parsedTitle = clean.replace(/^[-|—–:~,\|\s]+|[-|—–:~,\|\s]+$/g, '').replace(/\s{2,}/g, ' ').trim();
          detectedType = 'MANGA';
        }
      }

      chrome.storage.local.get(['whitelistedDomains'], async (result) => {
        const domains = result.whitelistedDomains || [];
        const safeDomains = domains.map(d => typeof d === 'string' ? d : d.domain).filter(Boolean);
        const safeTypes = domains.map(d => typeof d === 'string' ? 'ANIME' : (d.type || 'ANIME'));

        const isWhitelisted = safeDomains.some(d => hostname.includes(d) || d.includes(hostname));
        const keywordRegex = /anime|manga|manhwa|manhua|webtoon/i;
        const isAnimeSite = keywordRegex.test(title) || keywordRegex.test(hostname);
        const isValidHost = hostname !== "unknown" && !hostname.includes("chrome") && !hostname.includes("google.");

        if (!isWhitelisted && isValidHost && (detectedType || isAnimeSite)) {
           showWhitelistView(hostname);
           return resolve(true);
        }

        if (isWhitelisted) {
           const matchedIndex = safeDomains.findIndex(d => hostname.includes(d) || d.includes(hostname));
           const finalSearchType = matchedIndex !== -1 ? safeTypes[matchedIndex] : (detectedType || currentMode);

           if (finalSearchType && finalSearchType !== currentMode) {
              currentMode = finalSearchType;
              chrome.storage.local.set({ currentMode: currentMode });
              const modeIcon = document.getElementById('mode-icon');
              if (modeIcon) modeIcon.src = currentMode === 'ANIME' ? 'icons/monitor.svg' : 'icons/book-open.svg';
              currentFilter = currentMode === 'ANIME' ? 'SCHEDULE' : 'CURRENT';
              const viewLabel = document.getElementById('current-view-label');
              if (viewLabel) viewLabel.textContent = currentMode === 'ANIME' ? 'Schedule (My List) ▾' : 'Currently Reading ▾';
           }

           if (detectedType || parsedTitle) {
               try {
                   let media = await searchAnimeWithFallbacks(parsedTitle, finalSearchType);
                   if (!media && finalSearchType === 'MANGA') {
                     media = { id: -1, title: { romaji: parsedTitle || "Unknown Title", english: null }, coverImage: { medium: 'icons/icon128.png', large: 'icons/icon128.png' }, chapters: '?', mediaListEntry: null };
                   }
                   if (media) {
                     detectedMedia = media;
                     detectedEpisode = parsedProgress;
                     showAutoDetectView(media, parsedProgress, finalSearchType);
                     return resolve(true);
                   }
               } catch (e) {}
           }
        }
        return resolve(false); 
      });
    });
  });
}

function showWhitelistView(hostname) {
  window.showAppView('whitelist-view', false);
  const headerEl = document.querySelector('.header');
  if (headerEl) headerEl.classList.add('hidden');

  const hostEl = document.getElementById('whitelist-hostname');
  if (hostEl) hostEl.textContent = hostname;
}

function showAutoDetectView(media, progressNum, detectedType) {
  window.showAppView('autodetect-view', false);

  const badgesContainer = document.getElementById('autodetect-badges');
  if (badgesContainer) {
    badgesContainer.innerHTML = ''; 
    if (media.id > 0 && !media.isMalOnly) badgesContainer.innerHTML += `<span style="background: rgba(61,180,242,0.15); border: 1px solid #3db4f2; color: #3db4f2; padding: 2px 10px; border-radius: 12px; font-size: 10px; font-weight: bold; text-transform: uppercase;">AL Sync</span>`;
    if (media.idMal || media.isMalOnly) badgesContainer.innerHTML += `<span style="background: rgba(46,81,162,0.15); border: 1px solid #2E51A2; color: #5C7CE5; padding: 2px 10px; border-radius: 12px; font-size: 10px; font-weight: bold; text-transform: uppercase;">MAL Sync</span>`;
    if (media.id < 0) badgesContainer.innerHTML += `<span style="background: rgba(229,192,123,0.15); border: 1px solid #E5C07B; color: #E5C07B; padding: 2px 10px; border-radius: 12px; font-size: 10px; font-weight: bold; text-transform: uppercase;">OTG Local</span>`;
  }
  
  document.getElementById('autodetect-img').src = media.coverImage.medium;
  document.getElementById('autodetect-title').textContent = media.title.english || media.title.romaji;
  
  const progressTextEl = document.getElementById('video-progress-text');
  const progressBarEl = document.getElementById('video-progress-bar');
  if (progressTextEl) progressTextEl.textContent = detectedType === 'ANIME' ? 'Video Progress: 0.0%' : 'Reading Progress: 0.0%';
  if (progressBarEl) progressBarEl.style.width = '0%';
  
  const currentProg = media.mediaListEntry ? media.mediaListEntry.progress : 0;
  const epTextEl = document.getElementById('autodetect-ep');
  const confirmBtn = document.getElementById('autodetect-confirm-btn');
  const cancelBtn = document.getElementById('autodetect-cancel-btn');
  const actionsEl = document.querySelector('.autodetect-actions');
  const headerEl = document.querySelector('.autodetect-header');
  
  epTextEl.classList.remove('hidden');
  actionsEl.classList.remove('hidden');
  if (confirmBtn) confirmBtn.classList.add('hidden');
  
  if (cancelBtn) cancelBtn.textContent = detectedType === 'ANIME' ? 'View My Anime List' : 'View My Manga List';
  if (headerEl) headerEl.textContent = detectedType === 'ANIME' ? "We noticed you're watching..." : "We noticed you're reading...";
  const unit = detectedType === 'ANIME' ? 'Ep' : 'Ch';
  
  if (media.id < 0) {
    epTextEl.textContent = `Tracking ${unit} ${progressNum}... (Saved locally to OTG)`;
    epTextEl.style.color = "#E5C07B";
    if (confirmBtn) confirmBtn.classList.add('hidden'); 
  } else if (currentProg >= progressNum) {
    epTextEl.textContent = `✅ You are already at ${unit} ${currentProg}`;
    epTextEl.style.color = "#98C379"; 
  } else {
    epTextEl.textContent = detectedType === 'ANIME' ? `Tracking ${unit} ${progressNum}... (Auto-updates at ${currentThreshold}%)` : `Tracking ${unit} ${progressNum}... (Auto-updates via reader)`;
    epTextEl.style.color = "#E5C07B"; 
  }

  const skipBtn = document.getElementById('skip-intro-btn');
  if (skipBtn) {
    if (detectedType === 'MANGA') skipBtn.classList.add('hidden'); 
    else {
      skipBtn.classList.remove('hidden');
      skipBtn.textContent = '⏭ Checking Fallback Tier...';

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: "GET_ACTIVE_SKIP_TIER" }, (res) => {
            if (chrome.runtime.lastError || !res || !res.tierText) {
              skipBtn.textContent = '⏭ Skip 1:30 (Tier: Unknown)';
              skipBtn.style.color = "#e74c3c";
              skipBtn.style.borderColor = "#e74c3c";
            } else {
              skipBtn.textContent = `⏭ Skip 1:30 (${res.tierText})`;
              const tier = res.tierText;
              if (tier.includes("Tier 1") || tier.includes("Tier 2") || tier.includes("Tier 3") || tier.includes("AniSkip") || tier.includes("In-House") || tier.includes("HLS")) {
                skipBtn.style.color = "#4cca51";
              } else {
                skipBtn.style.color = "#E5C07B"; 
              }
            }
          });
        }
      });
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === "LIVE_VIDEO_PROGRESS") {
    const pct = message.progress.toFixed(1);
    const progressBar = document.getElementById('video-progress-bar');
    const progressText = document.getElementById('video-progress-text');
    const visualPct = Math.min(message.progress, 100).toFixed(1); 
    
    if (progressBar && progressText) {
      progressBar.style.width = visualPct + '%';
      progressText.textContent = `Video Progress: ${pct}%`;
    }

    const container = document.getElementById('video-progress-container');
    if (container && message.duration) {
      container.style.position = 'relative'; 
      
      let markerOverlay = document.getElementById('video-markers-overlay');
      if (!markerOverlay) {
        markerOverlay = document.createElement('div');
        markerOverlay.id = 'video-markers-overlay';
        markerOverlay.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible;';
        container.appendChild(markerOverlay);
      }

      let skipsToDraw = [];
      if (Array.isArray(message.aniSkipData) && message.aniSkipData.length > 0) skipsToDraw = message.aniSkipData;
      else if (Array.isArray(message.sessionSkips) && message.sessionSkips.length > 0) skipsToDraw = message.sessionSkips;

      markerOverlay.innerHTML = '';
      skipsToDraw.forEach(skip => {
        if (!skip.interval || skip.interval.startTime == null || skip.interval.endTime == null) return;
        const startPct = Math.max(0, (skip.interval.startTime / message.duration) * 100);
        const endPct = Math.min(100, (skip.interval.endTime / message.duration) * 100);
        const widthPct = Math.max(1, endPct - startPct);
        const isOP = skip.skipType === 'op';
        const blockColor = isOP ? '#FFD345' : '#E67E22';
        const labelText = isOP ? 'INTRO' : 'OUTRO';

        markerOverlay.innerHTML += `
          <div style="position: absolute; left: ${startPct}%; width: ${widthPct}%; height: 100%; background-color: ${blockColor}; opacity: 0.85; border-radius: 3px; z-index: 2;">
            <span style="position: absolute; top: -18px; left: 50%; transform: translateX(-50%); font-size: 10px; font-weight: 900; color: #ffffff; letter-spacing: 0.5px; text-shadow: 0 1px 3px rgba(0,0,0,0.8); white-space: nowrap;">
              ${labelText}
            </span>
          </div>
        `;
      });
    }

    if (message.progress >= currentThreshold) {
      const epTextEl = document.getElementById('autodetect-ep');
      if (epTextEl && !epTextEl.textContent.includes("✅") && !epTextEl.textContent.includes("already at")) {
        epTextEl.textContent = `✅ ${currentThreshold}% Reached! Auto-updated successfully.`;
        epTextEl.style.color = "#4cca51"; 
      }
    }
  }

  if (message.action === "LIVE_MANGA_PROGRESS") {
    const progressBar = document.getElementById('video-progress-bar');
    const progressText = document.getElementById('video-progress-text');
    
    if (progressBar && progressText) {
      progressBar.style.width = message.pct + '%';
      
      if (message.readingType === 'page') {
        const totalStr = message.total > 0 ? message.total.toString().padStart(2, '0') : '??';
        progressText.textContent = `Reading progress: ${message.progress.toString().padStart(2, '0')}/${totalStr} pages`;
      } else if (message.readingType === 'scroll') {
        progressText.textContent = `Reading progress: ${message.pct.toFixed(1)}%`;
      } else if (message.isCompleted) {
        progressText.textContent = 'Reading progress: Auto Completed';
      } else {
        progressText.textContent = 'Reading progress: Tracking...';
      }
    }
  }
});

async function handleAutoDetectConfirm() {
  const btn = document.getElementById('autodetect-confirm-btn');
  btn.textContent = 'Updating...';
  btn.disabled = true;

  let newStatus = 'CURRENT';
  const maxEp = detectedMedia.episodes;
  if (maxEp && detectedEpisode >= maxEp) {
    newStatus = 'COMPLETED';
    detectedEpisode = maxEp;
  }

  const mutation = `
    mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) {
      SaveMediaListEntry (mediaId: $mediaId, progress: $progress, status: $status) { id }
    }
  `;

  try {
    await apiRequest(mutation, { mediaId: detectedMedia.id, progress: detectedEpisode, status: newStatus });
    btn.textContent = 'Done!';
    setTimeout(() => {
      loadAnimeList(true); 
      btn.disabled = false;
      btn.textContent = 'Update Progress';
    }, 1000);
  } catch (error) {
    btn.textContent = 'Error';
    btn.disabled = false;
  }
}

function getTodayFuzzy() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

function updateUnwatchedBadge(entries) {
  let totalUnwatched = 0;
  entries.forEach(entry => {
    const media = entry.media;
    if (media.status === 'RELEASING' && media.nextAiringEpisode) {
      const progress = entry.progress || 0;
      const airedEpisodes = media.nextAiringEpisode.episode - 1;
      if (airedEpisodes > progress) totalUnwatched += (airedEpisodes - progress);
    }
  });
  if (totalUnwatched > 0) {
    chrome.action.setBadgeText({ text: totalUnwatched.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#E5C07B' });
  } else {
    chrome.action.setBadgeText({ text: '' }); 
  }
}

function getTabBadgeHtml(dayIndex, filterType) {
  if (cachedWatchingList.length === 0 && cachedAllScheduleList.length === 0) return '';
  const sourceList = filterType === 'SCHEDULE_ALL' ? cachedAllScheduleList : cachedWatchingList;
  const dayShows = sourceList.filter(entry => {
    if (!entry.media.nextAiringEpisode) return false;
    const airingDate = new Date(entry.media.nextAiringEpisode.airingAt * 1000);
    return airingDate.getDay() === dayIndex;
  });

  if (dayShows.length === 0) return ''; 

  let unwatchedCount = 0;
  dayShows.forEach(entry => {
    if (entry.media.status === 'RELEASING' && entry.media.nextAiringEpisode) {
       const progress = entry.progress || 0;
       const airedEpisodes = entry.media.nextAiringEpisode.episode - 1;
       if (airedEpisodes > progress) unwatchedCount += (airedEpisodes - progress);
    }
  });

  if (unwatchedCount > 0) return `<div class="tab-badge dot"></div>`;
  return `<div class="tab-badge check dot"></div>`; 
}

function renderDayTabs(filterType) {
  const tabsContainer = document.getElementById('day-tabs');
  tabsContainer.innerHTML = '';
  tabsContainer.classList.remove('hidden');

  const today = new Date();
  const currentDayIndex = today.getDay(); 
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - currentDayIndex);
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  for (let i = 0; i < 7; i++) {
    const date = new Date(sunday);
    date.setDate(sunday.getDate() + i);

    const btn = document.createElement('button');
    btn.className = `day-tab ${i === currentDayTabIndex ? 'active' : ''}`;
    
    const badgeHtml = getTabBadgeHtml(i, filterType);
    btn.innerHTML = `
      <span class="day-tab-name">${days[i]}</span>
      <span class="day-tab-date">${date.getDate()}</span>
      ${badgeHtml} 
    `;
    
    btn.addEventListener('click', () => {
      document.querySelectorAll('.day-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      currentDayTabIndex = i; 
      filterScheduleByDay(i, filterType);
    });
    
    tabsContainer.appendChild(btn);
  }
}

function filterScheduleByDay(dayIndex, filterType) {
  const sourceList = filterType === 'SCHEDULE_ALL' ? cachedAllScheduleList : cachedWatchingList;
  const filtered = sourceList.filter(entry => {
    if (!entry.media.nextAiringEpisode) return false;
    const airingDate = new Date(entry.media.nextAiringEpisode.airingAt * 1000);
    return airingDate.getDay() === dayIndex;
  });

  filtered.sort((a, b) => {
    const timeA = a.media.nextAiringEpisode ? a.media.nextAiringEpisode.timeUntilAiring : Infinity;
    const timeB = b.media.nextAiringEpisode ? b.media.nextAiringEpisode.timeUntilAiring : Infinity;
    return timeA - timeB;
  });

  renderAnimeList(filtered);
}

function getNextSeason() {
  const month = new Date().getMonth(); 
  const year = new Date().getFullYear();
  if (month >= 2 && month <= 4) return { season: 'SUMMER', year };
  if (month >= 5 && month <= 7) return { season: 'FALL', year };
  if (month >= 8 && month <= 10) return { season: 'WINTER', year: year + 1 };
  return { season: 'SPRING', year };
}

function renderSkeleton() {
  const container = document.getElementById('anime-list');
  let html = '';
  for(let i=0; i<5; i++) {
    html += `
      <div class="skeleton-item shimmer" style="display:flex; gap:10px; margin-bottom:8px; padding:10px; border-radius:10px; background:rgba(255,255,255,0.03);">
        <div class="skeleton-img" style="width:48px; height:68px; border-radius:6px; background:#111a26;"></div>
        <div class="skeleton-text" style="flex:1; display:flex; flex-direction:column; gap:8px; justify-content:center;">
          <div class="skeleton-line" style="height:12px; background:#111a26; border-radius:4px;"></div>
          <div class="skeleton-line short" style="height:12px; background:#111a26; border-radius:4px; width:50%;"></div>
        </div>
      </div>`;
  }
  container.innerHTML = html;
}

async function loadAnimeList(silent = false) {
  window.showAppView('main-view', true);
  
  const headerEl = document.querySelector('.header');
  if (headerEl) headerEl.classList.remove('hidden');

  const filter = currentFilter; 
  let query, variables;

  const dayTabs = document.getElementById('day-tabs');
  if (filter === 'SCHEDULE' || filter === 'SCHEDULE_ALL') {
    renderDayTabs(filter);
  } else {
    dayTabs.classList.add('hidden');
  }

  if (!silent) {
    chrome.storage.local.get(['cachedList_data', 'cachedList_filter'], (res) => {
      if (res.cachedList_filter === filter && res.cachedList_data) renderAnimeList(res.cachedList_data);
      else renderSkeleton();
    });
  }

  if (filter === 'SCHEDULE_ALL') {
    query = `
      query {
        Page(page: 1, perPage: 50) {
          media(status: RELEASING, type: ANIME, sort: POPULARITY_DESC) {
            id status title { romaji english } coverImage { medium large } episodes
            nextAiringEpisode { airingAt timeUntilAiring episode }
            mediaListEntry { progress status score }
          }
        }
      }
    `;
    variables = {};
  } else if (filter === 'UPCOMING') {
    const next = getNextSeason();
    query = `
      query ($season: MediaSeason, $seasonYear: Int) {
        Page(page: 1, perPage: 30) {
          media(season: $season, seasonYear: $seasonYear, type: ANIME, sort: POPULARITY_DESC) {
            id status title { romaji english } coverImage { medium large } episodes
            nextAiringEpisode { airingAt timeUntilAiring episode }
            mediaListEntry { progress status score }
          }
        }
      }
    `;
    variables = { season: next.season, seasonYear: next.year };
  } else {
    const apiStatus = (filter === 'SCHEDULE' && currentMode === 'ANIME') ? 'CURRENT' : filter;
    const apiType = currentMode; 
    
    const mediaFields = currentMode === 'ANIME' 
      ? `id idMal status title { romaji english } coverImage { medium large } episodes nextAiringEpisode { airingAt timeUntilAiring episode }`
      : `id idMal status title { romaji english } coverImage { medium large } chapters`;

    query = `
      query ($userId: Int, $status: MediaListStatus) {
        MediaListCollection(userId: $userId, type: ${apiType}, status: $status, sort: UPDATED_TIME_DESC) {
          lists {
            entries {
              progress status score updatedAt
              media {
                ${mediaFields}
              }
            }
          }
        }
      }
    `;
    variables = { userId: userId, status: apiStatus };
  }

  try {
    const response = await apiRequest(query, variables);
    if (response.errors) throw new Error(response.errors[0].message);

    let animeArray = [];
    if (filter === 'UPCOMING' || filter === 'SCHEDULE_ALL') {
      animeArray = response.data?.Page?.media?.map(media => {
        const userEntry = media.mediaListEntry;
        return { 
          media: media, progress: userEntry ? userEntry.progress : 0, 
          status: userEntry ? userEntry.status : 'PLANNING', score: userEntry ? userEntry.score : 0
        };
      }) || [];
    } else {
      const lists = response.data?.MediaListCollection?.lists || [];
      if (lists.length > 0 && lists[0].entries) animeArray = lists[0].entries;
    }

    if (userId) {
      try {
        const supabaseUrl = `${window.SUPABASE_URL || SUPABASE_URL}/rest/v1/otg_saves?anilist_user_id=eq.${userId}&select=media_id,source_url`;
        const otgRes = await fetch(supabaseUrl, { headers: { 'apikey': window.SUPABASE_KEY || SUPABASE_KEY, 'Authorization': `Bearer ${window.SUPABASE_KEY || SUPABASE_KEY}` } });
        const otgData = await otgRes.json();
        
        if (otgData && otgData.length) {
          const urlMap = {};
          otgData.forEach(save => { if (save.source_url) urlMap[save.media_id] = save.source_url; });
          animeArray.forEach(entry => {
            if (urlMap[entry.media.id]) entry.source_url = urlMap[entry.media.id];
          });
        }
      } catch (e) { console.error("OTG URL Fetch Error", e); }
    }

    chrome.storage.local.set({ cachedList_data: animeArray, cachedList_filter: filter });

    if (filter === 'CURRENT' || filter === 'SCHEDULE') updateUnwatchedBadge(animeArray);

    if (filter === 'SCHEDULE') {
      cachedWatchingList = animeArray; 
      renderDayTabs(filter); 
      filterScheduleByDay(currentDayTabIndex, filter); 
    } else if (filter === 'SCHEDULE_ALL') {
      cachedAllScheduleList = animeArray;
      renderDayTabs(filter); 
      filterScheduleByDay(currentDayTabIndex, filter);
    } else {
      renderAnimeList(animeArray);
    }
  } catch (error) {
    if (!silent) document.getElementById('anime-list').innerHTML = '<p class="placeholder-text">Failed to load list.</p>';
  }
}

function formatCountdown(seconds) {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function renderAnimeList(entries) {
  if (!document.getElementById('shiinah-badge-fix')) {
    const style = document.createElement('style');
    style.id = 'shiinah-badge-fix';
    style.textContent = `
      .grid-layout .action-buttons-container {
        position: absolute !important;
        top: 28px !important; 
        left: 6px !important;
        z-index: 50 !important;
        display: flex;
        gap: 4px;
      }
      .grid-layout .quick-add-btn, .grid-layout .resume-btn {
        position: static !important;
        padding: 2px 6px !important;
        height: 20px !important;
        min-width: 20px !important;
        border-radius: 10px !important;
        font-size: 10px !important;
        background: rgba(11, 17, 25, 0.85) !important;
        backdrop-filter: blur(2px);
      }
    `;
    document.head.appendChild(style);
  }

  const visibleEntries = entries.filter(e => !hiddenMediaIds.includes(e.media.id));
  const container = document.getElementById('anime-list');
  container.innerHTML = ''; 

  if (visibleEntries.length === 0) {
    container.innerHTML = `<p class="placeholder-text">No ${currentMode.toLowerCase()} found.</p>`;
    return;
  }

  chrome.storage.local.get(['desync_cache'], (res) => {
    const desyncCache = res.desync_cache || {};

    entries.forEach(entry => {
      const media = entry.media;
      const progress = entry.progress || 0;
      
      const totalMax = currentMode === 'ANIME' ? (media.episodes || '?') : (media.chapters || '?');
      const unit = currentMode === 'ANIME' ? 'Ep' : 'Ch';

      let countdownHtml = '';
      let maxAired = totalMax !== '?' ? totalMax : 0;
      
      if (currentMode === 'ANIME' && media.nextAiringEpisode) {
        const timeStr = formatCountdown(media.nextAiringEpisode.timeUntilAiring);
        const nextEp = media.nextAiringEpisode.episode;
        maxAired = nextEp - 1;
        const date = new Date(media.nextAiringEpisode.airingAt * 1000);
        const exactTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        countdownHtml = `
          <div class="countdown-text">Next: Ep ${nextEp} in ${timeStr}</div>
          <div class="exact-air-time">Airs at ${exactTime}</div>
        `;
      }

      const item = document.createElement('div');
      item.className = 'anime-list-item animated-view';
      item.style.position = 'relative'; 
      item.setAttribute('data-title', `${media.title.romaji.toLowerCase()} ${media.title.english ? media.title.english.toLowerCase() : ''}`);

      let quickActionHtml = '';
      if (entry.status !== 'CURRENT') {
        quickActionHtml = `
          <button class="ghost-btn quick-add-btn" title="Add to List">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </button>`;
      } else if (maxAired > 0 && progress < maxAired) {
        quickActionHtml = `
          <button class="ghost-btn quick-add-btn" title="Increment Progress">
            <span style="font-size: 13px; font-weight: bold;">+1</span>
          </button>
        `;
      }

      let resumeBtnHtml = '';
      if (entry.source_url) {
          const icon = currentMode === 'MANGA' ? 
              `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>` : 
              `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
          
          resumeBtnHtml = `
              <button class="ghost-btn resume-btn" data-url="${entry.source_url}" title="Resume ${currentMode === 'MANGA' ? 'Reading' : 'Watching'}">
                  ${icon}
              </button>
          `;
      }

      let desyncAlertHtml = '';
      if (desyncCache[media.id]) {
        desyncAlertHtml = `<div class="desync-warning-icon" data-id="${media.id}" style="position: absolute; top: -5px; left: -5px; background: #e74c3c; color: #fff; border: 2px solid #0b1119; border-radius: 50%; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 900; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.8); z-index: 60;" title="Sync Conflict! Click to resolve.">!</div>`;
      }

      item.innerHTML = `
        ${desyncAlertHtml}
        <img src="${media.coverImage.medium}" style="width: 48px; height: 68px; object-fit: cover; border-radius: 6px; box-shadow: 0 4px 8px rgba(0,0,0,0.3);">
        <div style="flex-grow: 1;">
          <div class="anime-title-text" style="font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;">
            ${media.title.romaji}
          </div>
          <div class="progress-text" style="font-size: 11px; color: #9fadbd;">
            ${unit}: ${progress} / ${totalMax}
          </div>
          ${countdownHtml}
        </div>
        <div class="action-buttons-container" style="display: flex; gap: 4px;">
          ${resumeBtnHtml}
          ${quickActionHtml}
        </div>
      `;

      const titleEl = item.querySelector('.anime-title-text');
      titleEl.addEventListener('mouseenter', () => titleEl.textContent = media.title.english || media.title.romaji);
      titleEl.addEventListener('mouseleave', () => titleEl.textContent = media.title.romaji);

      item.addEventListener('click', (e) => {
        if (!e.target.classList.contains('desync-warning-icon') && !e.target.closest('.action-buttons-container')) openDetailView(entry);
      });

      const warningIcon = item.querySelector('.desync-warning-icon');
      if (warningIcon) {
        warningIcon.addEventListener('click', (e) => {
          e.stopPropagation();
          const conf = desyncCache[media.id];
          openDesyncModal(conf);
        });
      }

      const quickBtn = item.querySelector('.quick-add-btn');
      if (quickBtn) {
        quickBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (entry.status !== 'CURRENT') quickUpdateStatus(media.id, 'CURRENT', quickBtn);
          else handleQuickPlusOneClick(entry, quickBtn, item.querySelector('.progress-text'));
        });
      }

      const resumeBtn = item.querySelector('.resume-btn');
      if (resumeBtn) {
          resumeBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const targetUrl = e.currentTarget.getAttribute('data-url');
              if (targetUrl) chrome.tabs.create({ url: targetUrl });
          });
      }

      container.appendChild(item);
    });
  }); 
}

function openDesyncModal(conflictData) {
  const modal = document.getElementById('desync-modal');
  const titleEl = document.getElementById('desync-title');
  const alBtn = document.getElementById('desync-al-btn');
  const malBtn = document.getElementById('desync-mal-btn');
  const cancelBtn = document.getElementById('desync-cancel-btn');

  titleEl.textContent = conflictData.title;
  alBtn.textContent = `AniList (Ep ${conflictData.alProgress})`;
  malBtn.textContent = `MAL (Ep ${conflictData.malProgress})`;

  modal.classList.remove('hidden');

  alBtn.onclick = () => {
    alBtn.textContent = "Syncing...";
    chrome.storage.local.get(['malToken'], async (res) => {
      if (res.malToken) {
        chrome.runtime.sendMessage({ action: "SAVE_ANIME_SCORE", mediaId: conflictData.malId, score: -1, isMalOnly: true, overrideProgress: conflictData.alProgress });
        await fetch(`https://api.myanimelist.net/v2/anime/${conflictData.malId}/my_list_status`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${res.malToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ num_watched_episodes: conflictData.alProgress, status: 'watching' }).toString()
        });
      }
      resolveModalAndReload(conflictData.mediaId);
    });
  };

  malBtn.onclick = () => {
    malBtn.textContent = "Syncing...";
    chrome.storage.local.get(['anilistToken'], async (res) => {
      if (res.anilistToken) {
        const mutation = `mutation ($mediaId: Int, $progress: Int) { SaveMediaListEntry (mediaId: $mediaId, progress: $progress) { id } }`;
        await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${res.anilistToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ query: mutation, variables: { mediaId: conflictData.mediaId, progress: conflictData.malProgress }})
        });
      }
      resolveModalAndReload(conflictData.mediaId);
    });
  };

  cancelBtn.onclick = () => modal.classList.add('hidden');

  function resolveModalAndReload(mediaId) {
    chrome.storage.local.get(['desync_cache'], (res) => {
      const cache = res.desync_cache || {};
      delete cache[mediaId];
      chrome.storage.local.set({ desync_cache: cache, trigger_dom_refresh: Date.now() }, () => {
        modal.classList.add('hidden');
        loadAnimeList(true); 
      });
    });
  }
}

function handleQuickPlusOneClick(entry, btnElement, progressTextElement) {
  const media = entry.media;
  const maxEpisodes = media.episodes || '?';
  
  entry.progress += 1;
  btnElement.innerHTML = `<span style="font-size: 13px; font-weight: bold;">+1</span>`; 
  if (progressTextElement) progressTextElement.textContent = `${currentMode === 'ANIME' ? 'Ep' : 'Ch'}: ${entry.progress} / ${maxEpisodes}`;

  let newStatus = 'CURRENT';
  let startedAt = undefined;
  let completedAt = undefined;

  if (entry.progress === 1) startedAt = getTodayFuzzy();
  
  if (maxEpisodes !== '?' && entry.progress >= maxEpisodes) {
    entry.progress = maxEpisodes;
    newStatus = 'COMPLETED';
    completedAt = getTodayFuzzy();
    btnElement.style.display = 'none'; 
  }

  clearTimeout(debounceTimers[media.id]);
  
  debounceTimers[media.id] = setTimeout(async () => {
    btnElement.disabled = true;
    const mutation = `
      mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
        SaveMediaListEntry (mediaId: $mediaId, progress: $progress, status: $status, startedAt: $startedAt, completedAt: $completedAt) { id }
      }
    `;

    const variables = { mediaId: media.id, progress: entry.progress, status: newStatus };
    if (startedAt) variables.startedAt = startedAt;
    if (completedAt) variables.completedAt = completedAt;

    try {
      const response = await apiRequest(mutation, variables);
      if (response.errors) throw new Error(JSON.stringify(response.errors));
      
      btnElement.disabled = false;
      loadAnimeList(true); 
    } catch (error) {
      btnElement.textContent = 'Err';
      btnElement.disabled = false;
    }
  }, 800); 
}

async function quickUpdateStatus(mediaId, newStatus, btnElement) {
  btnElement.innerHTML = '...';
  btnElement.disabled = true;
  const mutation = `mutation ($mediaId: Int, $status: MediaListStatus) { SaveMediaListEntry (mediaId: $mediaId, status: $status) { id } }`;
  try {
    const response = await apiRequest(mutation, { mediaId, status: newStatus });
    if (response.errors) throw new Error(JSON.stringify(response.errors));
    loadAnimeList(true); 
  } catch (error) {
    btnElement.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
    btnElement.disabled = false;
  }
}

function openDetailView(entry) {
  currentSelectedAnime = entry;
  document.getElementById('detail-image').src = entry.media.coverImage.large;
  document.getElementById('anime-title').textContent = entry.media.title.romaji;
  document.getElementById('episode-input').value = entry.progress || 0;
  document.getElementById('total-episodes').textContent = `/ ${entry.media.episodes || entry.media.chapters || '?'}`;
  document.getElementById('score-input').value = entry.score || '';
  
  const statusSelect = document.getElementById('status-select');
  statusSelect.value = entry.status || 'CURRENT';

  const bindInput = document.getElementById('bind-id-input');
  if (bindInput) {
    bindInput.value = entry.media.id > 0 ? entry.media.id : (entry.media.idMal || '');
  }

  window.showAppView('detail-view', false);
  document.getElementById('save-btn').textContent = 'Save Update';
  
  const hideToggle = document.getElementById('hide-title-toggle');
  if (hideToggle) hideToggle.checked = hiddenMediaIds.includes(entry.media.id);
}

function handleEpisodeInput(e) {
  const currentVal = parseInt(e.target.value, 10);
  const maxEpisodes = currentSelectedAnime.media.episodes;
  if (maxEpisodes && currentVal >= maxEpisodes) {
    document.getElementById('status-select').value = 'COMPLETED';
    e.target.value = maxEpisodes; 
  } else if (document.getElementById('status-select').value === 'COMPLETED' && currentVal < maxEpisodes) {
    document.getElementById('status-select').value = 'CURRENT';
  }
}

async function saveAnimeUpdate() {
  const saveBtn = document.getElementById('save-btn');
  saveBtn.textContent = 'Saving...';
  saveBtn.disabled = true;

  const newProgress = parseInt(document.getElementById('episode-input').value, 10) || 0;
  const newStatus = document.getElementById('status-select').value;
  const mediaId = currentSelectedAnime.media.id;

  let startedAt = undefined;
  let completedAt = undefined;
  const oldProgress = currentSelectedAnime.progress || 0;
  const oldStatus = currentSelectedAnime.status;

  if (newProgress === 1 && oldProgress === 0) startedAt = getTodayFuzzy();
  if (newStatus === 'COMPLETED' && oldStatus !== 'COMPLETED') completedAt = getTodayFuzzy();

  const mutation = `
    mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus, $scoreRaw: Int, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
      SaveMediaListEntry (mediaId: $mediaId, progress: $progress, status: $status, scoreRaw: $scoreRaw, startedAt: $startedAt, completedAt: $completedAt) { id status progress score }
    }
  `;

  const variables = { mediaId, progress: newProgress, status: newStatus };
  const scoreVal = document.getElementById('score-input').value;
  if (scoreVal !== '') variables.scoreRaw = parseInt(scoreVal, 10); 
  if (startedAt) variables.startedAt = startedAt;
  if (completedAt) variables.completedAt = completedAt;

  try {
    const response = await apiRequest(mutation, variables);
    if (response.errors) {
      saveBtn.textContent = 'Error! Try again';
    } else {
      saveBtn.textContent = 'Saved!';
      setTimeout(() => {
        loadAnimeList(true); 
        saveBtn.disabled = false;
      }, 1000);
    }
  } catch (error) {
    saveBtn.textContent = 'Error! Try again';
    saveBtn.disabled = false;
  }
}

async function loadUnfinishedList() {
  const container = document.getElementById('anime-list');
  renderSkeleton(); 

  try {
    const supabaseUrl = `${window.SUPABASE_URL || SUPABASE_URL}/rest/v1/otg_saves?anilist_user_id=eq.${userId}&select=*,custom_title,platform&order=updated_at.desc`;
    const res = await fetch(supabaseUrl, { headers: { 'apikey': window.SUPABASE_KEY || SUPABASE_KEY, 'Authorization': `Bearer ${window.SUPABASE_KEY || SUPABASE_KEY}` } });
    const otgSaves = await res.json();

    if (!otgSaves || otgSaves.length === 0) {
      container.innerHTML = `<p class="placeholder-text">You have no unfinished ${currentMode.toLowerCase()}.<br>Great job keeping a clean slate!</p>`;
      return;
    }

    const aniListIds = [...new Set(otgSaves.filter(s => s.platform === 'ANILIST' || !s.platform).map(s => s.media_id).filter(id => id > 0))];
    const malIds = [...new Set(otgSaves.filter(s => s.platform === 'MAL').map(s => s.media_id))];
    
    let fetchedMedia = [];

    if (aniListIds.length > 0) {
      const query = `query ($idIn: [Int]) { Page(page: 1, perPage: 50) { media(id_in: $idIn, type: ${currentMode}) { id title { romaji english } coverImage { medium large } episodes chapters mediaListEntry { progress status score } } } }`;
      const aniRes = await apiRequest(query, { idIn: aniListIds });
      if (aniRes.data?.Page?.media) fetchedMedia.push(...aniRes.data.Page.media.map(m => ({ ...m, platform: 'ANILIST' })));
    }

    const storage = await chrome.storage.local.get(['malToken']);
    if (malIds.length > 0 && storage.malToken) {
      for (const mId of malIds) {
        try {
          const endpoint = currentMode === 'ANIME' ? 'anime' : 'manga';
          const malRes = await fetch(`https://api.myanimelist.net/v2/${endpoint}/${mId}?fields=id,title,alternative_titles,main_picture,status,num_episodes,num_chapters,my_list_status`, {
            headers: { 'Authorization': `Bearer ${storage.malToken}` }
          });
          const malNode = await malRes.json();
          if (malNode && malNode.id) {
            fetchedMedia.push({
              id: malNode.id,
              platform: 'MAL',
              title: { romaji: malNode.title, english: malNode.alternative_titles?.en || malNode.title },
              coverImage: { medium: malNode.main_picture?.medium, large: malNode.main_picture?.large },
              episodes: currentMode === 'ANIME' ? malNode.num_episodes : null,
              chapters: currentMode === 'MANGA' ? malNode.num_chapters : null,
              mediaListEntry: malNode.my_list_status ? { progress: currentMode === 'ANIME' ? malNode.my_list_status.num_episodes_watched : malNode.my_list_status.num_chapters_read, status: 'CURRENT' } : null
            });
          }
        } catch(e) {}
      }
    }

    const mergedList = otgSaves.map(save => {
      if (save.platform === 'CUSTOM' || save.media_id < 0) {
        return {
          ...save,
          media: {
            id: save.media_id,
            title: { romaji: save.custom_title || 'Unknown Title', english: null },
            coverImage: { medium: 'icons/icon48.png', large: 'icons/icon128.png' },
            chapters: '?',
            mediaListEntry: { progress: 0, status: 'CURRENT', score: 0 }
          }
        };
      } else {
        const mediaMatch = fetchedMedia.find(m => m.id === save.media_id && m.platform === (save.platform || 'ANILIST'));
        return { ...save, media: mediaMatch || null };
      }
    }).filter(item => item.media !== null); 

    renderUnfinishedList(mergedList);
  } catch (error) {
    container.innerHTML = '<p class="placeholder-text" style="color: #e74c3c;">Failed to load OTG saves.</p>';
  }
}

function renderUnfinishedList(entries) {
  const container = document.getElementById('anime-list');
  container.innerHTML = ''; 

  if (entries.length === 0) {
    container.innerHTML = `<p class="placeholder-text">No unfinished ${currentMode.toLowerCase()} found.</p>`;
    return;
  }

  entries.forEach(entry => {
    const media = entry.media;
    
    const isManga = currentMode === 'MANGA';
    const unit = isManga ? 'Chapter' : 'Episode';
    const actionText = isManga ? '▶ Read' : '▶ Watch';
    let progressString = '';

    if (isManga) {
      if (entry.playback_time === 0) {
        progressString = 'Left off at: Auto-Saved URL';
      } else if (entry.playback_time <= 100 && entry.playback_time % 1 !== 0) {
        progressString = `Left off at: ${entry.playback_time.toFixed(1)}% Scrolled`;
      } else {
        progressString = `Left off at: Page ${Math.floor(entry.playback_time)}`;
      }
    } else {
      const mins = Math.floor(entry.playback_time / 60);
      const secs = Math.floor(entry.playback_time % 60).toString().padStart(2, '0');
      progressString = `Left off at: ${mins}:${secs}`;
    }

    const item = document.createElement('div');
    item.className = 'anime-list-item animated-view';
    item.setAttribute('data-title', `${media.title.romaji.toLowerCase()} ${media.title.english ? media.title.english.toLowerCase() : ''}`);

    const watchBtnHtml = entry.source_url ? `
      <button class="otg-watch-btn secondary-btn" data-url="${entry.source_url}" style="width: 100%; border-color: var(--anilist-color); color: var(--anilist-color); font-size: 11px;">
        ${actionText}
      </button>
    ` : '';

    item.innerHTML = `
      <img src="${media.coverImage.medium}" style="width: 48px; height: 68px; object-fit: cover; border-radius: 6px; box-shadow: 0 4px 8px rgba(0,0,0,0.3);">
      <div style="flex-grow: 1;">
        <div class="anime-title-text" style="font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;">
          ${media.title.romaji}
        </div>
        <div style="font-size: 11px; color: #E5C07B; margin-top: 2px;">Tracking ${unit} ${entry.episode}</div>
        <div style="font-size: 10px; color: #9fadbd; font-weight: bold;">${progressString}</div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px; min-width: 75px;">
        <button class="otg-finish-btn secondary-btn" data-media-id="${entry.media_id}" data-ep="${entry.episode}" style="width: 100%; border-color: #4cca51; color: #4cca51; font-size: 11px;">
          ✓ Finish
        </button>
        ${watchBtnHtml}
      </div>
    `;

    const titleEl = item.querySelector('.anime-title-text');
    titleEl.addEventListener('mouseenter', () => titleEl.textContent = media.title.english || media.title.romaji);
    titleEl.addEventListener('mouseleave', () => titleEl.textContent = media.title.romaji);

    item.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') {
        openDetailView({
          media: media, progress: media.mediaListEntry?.progress || 0,
          status: media.mediaListEntry?.status || 'CURRENT', score: media.mediaListEntry?.score || 0
        });
      }
    });

    const finishBtn = item.querySelector('.otg-finish-btn');
    finishBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const mId = e.target.getAttribute('data-media-id');
      const ep = e.target.getAttribute('data-ep');
      
      e.target.textContent = '...';
      e.target.disabled = true;

      const success = await deleteManualOtgSave(userId, mId, ep);
      if (success) {
        item.style.opacity = '0';
        setTimeout(() => {
          item.remove();
          if (container.children.length === 0) container.innerHTML = '<p class="placeholder-text">All caught up!</p>';
        }, 300);
      } else {
        e.target.textContent = 'Err';
        e.target.style.borderColor = '#e74c3c';
        e.target.style.color = '#e74c3c';
      }
    });

    const watchBtn = item.querySelector('.otg-watch-btn');
    if (watchBtn) {
      watchBtn.addEventListener('click', (e) => {
        e.stopPropagation(); 
        const targetUrl = e.target.getAttribute('data-url');
        if (targetUrl) chrome.tabs.create({ url: targetUrl });
      });
    }
    container.appendChild(item);
  });
}

async function deleteManualOtgSave(uId, mId, ep) {
  try {
    const url = `${window.SUPABASE_URL || SUPABASE_URL}/rest/v1/otg_saves?anilist_user_id=eq.${uId}&media_id=eq.${mId}&episode=eq.${ep}`;
    const res = await fetch(url, { method: 'DELETE', headers: { 'apikey': window.SUPABASE_KEY || SUPABASE_KEY, 'Authorization': `Bearer ${window.SUPABASE_KEY || SUPABASE_KEY}` } });
    return res.ok;
  } catch (error) { return false; }
}