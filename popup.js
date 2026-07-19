const CLIENT_ID = ANILIST_CLIENT_ID; // Directly reads the global variable from config.js
let accessToken = null;

let userTopGenres = [];
let userExcludedMediaIds = [];
let recommendationClickCount = 0;
let recommendationPool = [];

let userId = null;
let currentSelectedAnime = null; 
let cachedWatchingList = []; 
let cachedAllScheduleList = []; 
let currentDayTabIndex = new Date().getDay(); 
let currentFilter = 'SCHEDULE'; 
const debounceTimers = {}; 
let progressInterval = null; 
let currentThreshold = 80;

// Auto-detect variables
let detectedMedia = null;
let detectedEpisode = null;
let hiddenMediaIds = [];

document.addEventListener('DOMContentLoaded', () => {
  // 1. INITIAL BOOT: Load token and threshold
  // 1. INITIAL BOOT: Load token, threshold, and hidden titles
  chrome.storage.local.get(['anilistToken', 'trackingThreshold'], (localRes) => {
    chrome.storage.sync.get(['hiddenMediaIds'], (syncRes) => {
      if (localRes.trackingThreshold) currentThreshold = localRes.trackingThreshold;
      if (syncRes.hiddenMediaIds) hiddenMediaIds = syncRes.hiddenMediaIds;
      
      if (localRes.anilistToken) {
        accessToken = localRes.anilistToken;
        updateAuthUI(true);
        initializeApp(); 
      } else {
        updateAuthUI(false);
      }
    });
  });

  // --- CORE LISTENERS ---
  document.getElementById('login-btn').addEventListener('click', handleLoginClick);
  document.getElementById('logout-btn').addEventListener('click', handleLogoutClick);
  
  document.getElementById('back-btn').addEventListener('click', () => {
    document.getElementById('detail-view').classList.add('hidden');
    document.getElementById('main-view').classList.remove('hidden');
  });

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

  document.querySelectorAll('.filter-option').forEach(option => {
    option.addEventListener('click', (e) => {
      currentFilter = e.target.dataset.value; 
      document.getElementById('current-view-label').textContent = e.target.textContent + ' ▾';
      document.getElementById('filter-dropdown').classList.add('hidden');
      document.getElementById('search-input').value = ''; 
      
      // View Replacement Logic
      if (currentFilter === 'LEADERBOARD') {
        document.getElementById('main-view').classList.add('hidden');
        document.getElementById('search-input').classList.add('hidden');
        document.getElementById('profile-view').classList.add('hidden');
        document.getElementById('leaderboard-view').classList.remove('hidden');
        loadLeaderboard();
        loadAchievementsUI(userId);
      } else if (accessToken) {
        document.getElementById('leaderboard-view').classList.add('hidden');
        document.getElementById('profile-view').classList.add('hidden');
        document.getElementById('main-view').classList.remove('hidden');
        loadAnimeList();
      }
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#user-profile') && !e.target.closest('#filter-dropdown')) {
      const dropdown = document.getElementById('filter-dropdown');
      if (dropdown) dropdown.classList.add('hidden');
    }
  });

  // --- NEW: Hide Title Toggle ---
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

  // --- SKIP INTRO BUTTON & TIME WIZARD (ANTI-SPAM) ---
  const skipBtn = document.getElementById('skip-intro-btn');
  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          // 1. Always physically skip the video for the user
          chrome.tabs.sendMessage(tabs[0].id, { action: "SKIP_TIME", amount: 90 });
          
          // 2. Anti-Spam Logic: Check the last time they earned the stat
          chrome.storage.local.get(['timeSavedSeconds', 'lastSkipTimestamp'], (res) => {
            const now = Date.now();
            const lastSkip = res.lastSkipTimestamp || 0;
            
            // 60-second cooldown (60000 milliseconds)
            if (now - lastSkip < 60000) {
              console.log("[Anti-Spam] Skip registered, but on cooldown for stats.");
              
              // Optional: Visual feedback that it didn't count for stats
              const originalText = skipBtn.textContent;
              skipBtn.textContent = "Cooldown!";
              skipBtn.style.color = "#e74c3c";
              setTimeout(() => { 
                skipBtn.textContent = originalText; 
                skipBtn.style.color = "#E5C07B";
              }, 1500);
              
              return; // Stop here, don't award stats!
            }

            // 3. Award the stats if the cooldown has passed
            const newTotal = (res.timeSavedSeconds || 0) + 90;
            chrome.storage.local.set({ 
              timeSavedSeconds: newTotal,
              lastSkipTimestamp: now // Reset the cooldown timer
            });
            
            console.log(`[Time Wizard] Total time saved: ${newTotal} seconds!`);
            
            // Update UI instantly if they are looking at the profile
            const timeSavedDisplay = document.getElementById('time-saved-display');
            if (timeSavedDisplay) {
              timeSavedDisplay.textContent = `${Math.floor(newTotal / 60)}m`;
            }
          });
        }
      });
    });
  }

  // --- UPDATED: PROFILE VIEW NAVIGATION ---
  const userAvatar = document.getElementById('user-avatar');
  if (userAvatar) {
    userAvatar.addEventListener('click', (e) => {
      e.stopPropagation(); 
      document.getElementById('main-view').classList.add('hidden');
      document.getElementById('search-input').classList.add('hidden');
      document.getElementById('filter-dropdown').classList.add('hidden');
      document.getElementById('leaderboard-view').classList.add('hidden');
      document.getElementById('profile-view').classList.remove('hidden');
      
      // Only check time saved locally, remove the hasSyncedHistory check!
      chrome.storage.local.get(['timeSavedSeconds'], (res) => {
        const totalSecs = res.timeSavedSeconds || 0;
        const mins = Math.floor(totalSecs / 60);
        document.getElementById('time-saved-display').textContent = `${mins}m`;
      });

      loadLeaderboard();
      loadAchievementsUI(userId); 
      loadDetailedStats(userId);
    });
  }
  

  const profileBackBtn = document.getElementById('profile-back-btn');
  if (profileBackBtn) {
    profileBackBtn.addEventListener('click', () => {
      document.getElementById('profile-view').classList.add('hidden');
      loadAnimeList(); 
    });
  }

  // --- SETTINGS NAVIGATION (Fixed Copy-Paste Bug) ---
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      document.getElementById('main-view').classList.add('hidden');
      document.getElementById('search-input').classList.add('hidden');
      document.getElementById('autodetect-view').classList.add('hidden');
      document.getElementById('settings-view').classList.remove('hidden');
      
      // Load current settings correctly!
      chrome.storage.local.get(['trackingThreshold', 'whitelistedDomains'], (res) => {
        const threshold = res.trackingThreshold || 80;
        const slider = document.getElementById('threshold-slider');
        const display = document.getElementById('threshold-display');
        
        if (slider && display) {
          slider.value = threshold;
          display.textContent = `${threshold}%`;
        }
        renderWhitelistManager(res.whitelistedDomains || []);
      });
    });
  }

  const settingsBackBtn = document.getElementById('settings-back-btn');
  if (settingsBackBtn) {
    settingsBackBtn.addEventListener('click', () => {
      document.getElementById('settings-view').classList.add('hidden');
      loadAnimeList(); 
    });
  }

  // --- THRESHOLD SLIDER LOGIC ---
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

  const autodetectCancelBtn = document.getElementById('autodetect-cancel-btn');
  if (autodetectCancelBtn) {
    autodetectCancelBtn.addEventListener('click', () => {
      document.getElementById('autodetect-view').classList.add('hidden');
      loadAnimeList(); 
    });
  }

  // --- WHITELIST LISTENERS ---
  const whitelistCancelBtn = document.getElementById('whitelist-cancel-btn');
  if (whitelistCancelBtn) {
    whitelistCancelBtn.addEventListener('click', () => {
      document.getElementById('whitelist-view').classList.add('hidden');
      loadAnimeList(); 
    });
  }

  const whitelistConfirmBtn = document.getElementById('whitelist-confirm-btn');
  if (whitelistConfirmBtn) {
    whitelistConfirmBtn.addEventListener('click', () => {
      const hostnameEl = document.getElementById('whitelist-hostname');
      if (!hostnameEl) return;
      
      const hostname = hostnameEl.textContent;
      chrome.storage.local.get(['whitelistedDomains'], (result) => {
        const domains = result.whitelistedDomains || [];
        if (!domains.includes(hostname)) {
          domains.push(hostname);
          chrome.storage.local.set({ whitelistedDomains: domains }, () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              if (tabs[0]) chrome.tabs.reload(tabs[0].id);
              window.close(); 
            });
          });
        }
      });
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
    fullModal.addEventListener('click', () => {
      fullModal.classList.add('hidden');
    });
  }

  const autoConfirmBtn = document.getElementById('autodetect-confirm-btn');
  if (autoConfirmBtn) autoConfirmBtn.addEventListener('click', handleAutoDetectConfirm);
});

// --- UPDATED: Transparent Error Handling for Login ---
function handleLoginClick() {
  const btn = document.getElementById('login-btn');
  const originalText = btn.textContent;
  btn.textContent = "Connecting...";

  const safeClientId = typeof ANILIST_CLIENT_ID !== 'undefined' ? ANILIST_CLIENT_ID : '45996';
  
  // FIXED: We removed the redirect_uri parameter. 
  // AniList will automatically use the exact URL you saved in your dashboard!
  const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${safeClientId}&response_type=token`;
  
  console.log("Attempting to launch WebAuthFlow with URL:", authUrl);

  chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirectUrlResult) => {
    if (chrome.runtime.lastError) {
      console.error("Auth Error:", chrome.runtime.lastError.message);
      btn.textContent = "Error - Check Console";
      setTimeout(() => { btn.textContent = originalText; }, 3000);
      return;
    }
    
    if (!redirectUrlResult) {
      btn.textContent = originalText;
      return;
    }
    
    const hash = new URL(redirectUrlResult).hash;
    const token = new URLSearchParams(hash.substring(1)).get('access_token');
    
    if (token) {
      accessToken = token;
      chrome.storage.local.set({ anilistToken: accessToken }, () => {
        updateAuthUI(true);
        initializeApp();
        btn.textContent = originalText; 
      });
    } else {
      btn.textContent = "Failed to get token";
      setTimeout(() => { btn.textContent = originalText; }, 3000);
    }
  });
}

function handleLogoutClick() {
  chrome.storage.local.remove(['anilistToken', 'cachedList_data', 'cachedList_filter'], () => {
    accessToken = null;
    userId = null;
    currentSelectedAnime = null;
    cachedWatchingList = [];
    cachedAllScheduleList = [];
    currentFilter = 'SCHEDULE';
    
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
  const detailView = document.getElementById('detail-view');
  const autodetectView = document.getElementById('autodetect-view');
  const settingsView = document.getElementById('settings-view');

  if (isLoggedIn) {
    if (loginView) loginView.classList.add('hidden');
    if (appView) appView.classList.remove('hidden');
    if (autodetectView) autodetectView.classList.add('hidden'); 
    if (settingsView) settingsView.classList.add('hidden');
  } else {
    if (loginView) loginView.classList.remove('hidden');
    if (appView) appView.classList.add('hidden');
    if (detailView) detailView.classList.add('hidden');
  }
}

async function apiRequest(query, variables = {}) {
  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ query, variables })
  });
  return response.json();
}

async function initializeApp() {
  document.getElementById('anime-list').innerHTML = '';
  const viewerQuery = `query { Viewer { id name avatar { medium } } }`;
  try {
    const data = await apiRequest(viewerQuery);
    const viewer = data.data.Viewer;
    userId = viewer.id;
    
    document.getElementById('user-avatar').src = viewer.avatar.medium;
    document.getElementById('user-name').textContent = viewer.name;

    // Cache profile for background sync
    chrome.storage.local.set({ 
      anilistUserId: userId,
      anilistUsername: viewer.name,
      anilistAvatar: viewer.avatar.medium
    });

    // Load initial level tag next to name
    loadUserLevel(userId);

    const foundAnimeOnTab = await checkCurrentTabForAnime();
    if (!foundAnimeOnTab) {
      loadAnimeList(); 
    }
  } catch (error) {
    console.error("Error fetching Viewer ID:", error);
  }
}

function renderWhitelistManager(domains) {
  const container = document.getElementById('whitelist-manager-list');
  if (!container) return;
  
  container.innerHTML = '';

  if (domains.length === 0) {
    container.innerHTML = '<p style="font-size: 12px; text-align: center; opacity: 0.7; margin: 10px 0;">No sites whitelisted yet.</p>';
    return;
  }

  domains.forEach((domain, index) => {
    const item = document.createElement('div');
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';
    item.style.padding = '8px 10px';
    item.style.borderBottom = '1px solid #1a2636';
    item.style.fontSize = '13px';
    
    item.innerHTML = `
      <span>${domain}</span>
      <button class="remove-domain-btn" data-index="${index}" style="background: transparent; color: #E06C75; border: none; cursor: pointer; font-weight: bold;">✕</button>
    `;
    container.appendChild(item);
  });

  document.querySelectorAll('.remove-domain-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = e.target.getAttribute('data-index');
      domains.splice(idx, 1);
      chrome.storage.local.set({ whitelistedDomains: domains }, () => {
        renderWhitelistManager(domains);
      });
    });
  });
}

async function searchAnimeWithFallbacks(rawTitle) {
  const query = `
    query ($search: String) {
      Media (search: $search, type: ANIME, sort: SEARCH_MATCH) {
        id status title { romaji english } coverImage { large medium } episodes
        mediaListEntry { id progress status }
      }
    }
  `;

  async function doSearch(term) {
    const res = await apiRequest(query, { search: term });
    return res.data?.Media || null;
  }

  let media = await doSearch(rawTitle);
  if (media) return media;

  let noBrackets = rawTitle.replace(/\[.*?\]|\(.*?\)[^\w\s]*/g, '').trim();
  if (noBrackets && noBrackets !== rawTitle) {
    media = await doSearch(noBrackets);
    if (media) return media;
  }

  let noPunctuation = noBrackets.replace(/[?!,]/g, '').replace(/\s+/g, ' ').trim();
  if (noPunctuation && noPunctuation !== noBrackets) {
    media = await doSearch(noPunctuation);
    if (media) return media;
  }

  let splitTitle = rawTitle.split(/[:\-]/)[0].trim();
  if (splitTitle && splitTitle !== rawTitle && splitTitle.length > 3) {
    media = await doSearch(splitTitle);
    if (media) return media;
  }

  return null; 
}

async function checkCurrentTabForAnime() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs || tabs.length === 0) return resolve(false);
      
      const title = tabs[0].title || "";
      let hostname = "unknown";

      try {
        if (tabs[0].url) {
          hostname = new URL(tabs[0].url).hostname;
        }
      } catch (e) {}

      const regex = /(?:Watch\s+)?(.*?)\s*(?:[-|—–:~]+\s*)?(?:Season\s*\d+\s*)?(?:Episode|Ep|EP|E)\.?\s*0*(\d+)/i;
      const match = title.match(regex);

      if (match && match[1] && match[2]) {
        chrome.storage.local.get(['whitelistedDomains'], async (result) => {
          const domains = result.whitelistedDomains || [];
          const isWhitelisted = domains.some(d => hostname.includes(d));

          if (!isWhitelisted) {
            showWhitelistView(hostname);
            return resolve(true); 
          }

          let parsedTitle = match[1].replace(/[-|—–:~]+$/g, '').trim(); 
          parsedTitle = parsedTitle.replace(/\s+\(?(?:Sub|Dub)\)?$/i, '').trim();
          const parsedEp = parseInt(match[2], 10);
          
          try {
            const media = await searchAnimeWithFallbacks(parsedTitle);
            if (media) {
              detectedMedia = media;
              detectedEpisode = parsedEp;
              showAutoDetectView(media, parsedEp);
              return resolve(true);
            }
          } catch (e) {
            console.error("Search failed", e);
          }
          resolve(false);
        });
      } else {
        resolve(false); 
      }
    });
  });
}

function showWhitelistView(hostname) {
  document.getElementById('main-view').classList.add('hidden');
  document.getElementById('search-input').classList.add('hidden'); 
  document.getElementById('autodetect-view').classList.add('hidden');
  document.getElementById('whitelist-view').classList.remove('hidden');
  
  const hostEl = document.getElementById('whitelist-hostname');
  if (hostEl) hostEl.textContent = hostname;
}

function showAutoDetectView(media, ep) {
  document.getElementById('main-view').classList.add('hidden');
  document.getElementById('search-input').classList.add('hidden'); 
  document.getElementById('autodetect-view').classList.remove('hidden');
  
  document.getElementById('autodetect-img').src = media.coverImage.medium;
  document.getElementById('autodetect-title').textContent = media.title.english || media.title.romaji;
  
  const currentProg = media.mediaListEntry ? media.mediaListEntry.progress : 0;
  
  const epTextEl = document.getElementById('autodetect-ep');
  const confirmBtn = document.getElementById('autodetect-confirm-btn');
  const cancelBtn = document.getElementById('autodetect-cancel-btn');
  const actionsEl = document.querySelector('.autodetect-actions');
  
  epTextEl.classList.remove('hidden');
  actionsEl.classList.remove('hidden');
  if (confirmBtn) confirmBtn.classList.add('hidden');
  if (cancelBtn) cancelBtn.textContent = 'View My Anime List'; 
  
  if (currentProg >= ep) {
    epTextEl.textContent = `✅ You are already at Ep ${currentProg}`;
    epTextEl.style.color = "#98C379"; 
  } else {
    epTextEl.textContent = `Tracking Ep ${ep}... (Auto-updates at ${currentThreshold}%)`;
    epTextEl.style.color = "#E5C07B"; 
  }
}

// NEW: Added 'sender' to the parameters
chrome.runtime.onMessage.addListener((message, sender) => {
  
  // NEW: Ignore background tab broadcasts to stop the popup UI from flickering
  if (sender && sender.tab && !sender.tab.active) return;

  if (message.action === "LIVE_VIDEO_PROGRESS") {
    const pct = message.progress.toFixed(1);
    const progressBar = document.getElementById('video-progress-bar');
    const progressText = document.getElementById('video-progress-text');
    const visualPct = Math.min(message.progress, 100).toFixed(1); 
    
    if (progressBar && progressText) {
      progressBar.style.width = visualPct + '%';
      progressText.textContent = `Video Progress: ${pct}%`;
    }

    if (message.progress >= currentThreshold) {
      const epTextEl = document.getElementById('autodetect-ep');
      if (epTextEl && !epTextEl.textContent.includes("✅") && !epTextEl.textContent.includes("already at")) {
        epTextEl.textContent = `✅ ${currentThreshold}% Reached! Auto-updated successfully.`;
        epTextEl.style.color = "#4cca51"; 
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
      document.getElementById('autodetect-view').classList.add('hidden');
      loadAnimeList(); 
      btn.disabled = false;
      btn.textContent = 'Update Progress';
    }, 1000);
  } catch (error) {
    btn.textContent = 'Error';
    btn.disabled = false;
  }
}

// --- TAB & DATA LOGIC (UNCHANGED BELOW THIS LINE) ---

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
      if (airedEpisodes > progress) {
        totalUnwatched += (airedEpisodes - progress);
      }
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
       if (airedEpisodes > progress) {
         unwatchedCount += (airedEpisodes - progress);
       }
    }
  });

  if (unwatchedCount > 0) {
    return `<div class="tab-badge">${unwatchedCount}</div>`;
  } else {
    return `<div class="tab-badge check">✓</div>`; 
  }
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
      <div class="skeleton-item shimmer">
        <div class="skeleton-img"></div>
        <div class="skeleton-text">
          <div class="skeleton-line"></div>
          <div class="skeleton-line short"></div>
        </div>
      </div>`;
  }
  container.innerHTML = html;
}

async function loadAnimeList(silent = false) {
  document.getElementById('main-view').classList.remove('hidden'); 
  document.getElementById('search-input').classList.remove('hidden');
  
  const adView = document.getElementById('autodetect-view');
  const wlView = document.getElementById('whitelist-view');
  const setView = document.getElementById('settings-view');
  if (adView) adView.classList.add('hidden');
  if (wlView) wlView.classList.add('hidden');
  if (setView) setView.classList.add('hidden');

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
      if (res.cachedList_filter === filter && res.cachedList_data) {
         renderAnimeList(res.cachedList_data);
      } else {
         renderSkeleton();
      }
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
    const apiStatus = filter === 'SCHEDULE' ? 'CURRENT' : filter;
    query = `
      query ($userId: Int, $status: MediaListStatus) {
        MediaListCollection(userId: $userId, type: ANIME, status: $status) {
          lists {
            entries {
              progress status score
              media {
                id status title { romaji english } coverImage { medium large } episodes
                nextAiringEpisode { airingAt timeUntilAiring episode }
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
          media: media, 
          progress: userEntry ? userEntry.progress : 0, 
          status: userEntry ? userEntry.status : 'PLANNING',
          score: userEntry ? userEntry.score : 0
        };
      }) || [];
    } else {
      const lists = response.data?.MediaListCollection?.lists || [];
      if (lists.length > 0 && lists[0].entries) {
        animeArray = lists[0].entries;
      }
    }

    chrome.storage.local.set({ cachedList_data: animeArray, cachedList_filter: filter });

    if (filter === 'CURRENT' || filter === 'SCHEDULE') {
      updateUnwatchedBadge(animeArray);
    }

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
    console.error("Error fetching list:", error);
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
  const visibleEntries = entries.filter(e => !hiddenMediaIds.includes(e.media.id));
  const container = document.getElementById('anime-list');
  container.innerHTML = ''; 

  if (visibleEntries.length === 0) {
    container.innerHTML = '<p class="placeholder-text">No anime scheduled/found.</p>';
    return;
  }

  entries.forEach(entry => {
    const media = entry.media;
    const progress = entry.progress || 0;
    const totalEpisodes = media.episodes || '?';

    let countdownHtml = '';
    let maxAired = totalEpisodes !== '?' ? totalEpisodes : 0;
    
    if (media.nextAiringEpisode) {
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
    item.className = 'anime-list-item';
    item.setAttribute('data-title', `${media.title.romaji.toLowerCase()} ${media.title.english ? media.title.english.toLowerCase() : ''}`);

    let quickActionHtml = '';
    if (entry.status !== 'CURRENT') {
      quickActionHtml = `<button class="quick-add-btn">Add</button>`;
    } else if (progress < maxAired || maxAired === 0) {
      quickActionHtml = `<button class="quick-add-btn">+1</button>`;
    }

    item.innerHTML = `
      <img src="${media.coverImage.medium}" style="width: 40px; height: 55px; object-fit: cover; border-radius: 4px; margin-right: 10px;">
      <div style="flex-grow: 1;">
        <div class="anime-title-text" style="font-weight: bold; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;">
          ${media.title.romaji}
        </div>
        <div class="progress-text" style="font-size: 12px; opacity: 0.8;">
          Ep: ${progress} / ${totalEpisodes}
        </div>
        ${countdownHtml}
      </div>
      ${quickActionHtml}
    `;

    const titleEl = item.querySelector('.anime-title-text');
    titleEl.addEventListener('mouseenter', () => {
      titleEl.textContent = media.title.english || media.title.romaji; 
    });
    titleEl.addEventListener('mouseleave', () => {
      titleEl.textContent = media.title.romaji;
    });

    item.addEventListener('click', () => openDetailView(entry));

    const quickActionBtn = item.querySelector('.quick-add-btn');
    if (quickActionBtn) {
      quickActionBtn.addEventListener('click', (e) => {
        e.stopPropagation(); 
        if (entry.status !== 'CURRENT') {
          quickActionBtn.textContent = '...';
          quickActionBtn.disabled = true;
          quickUpdateStatus(media.id, 'CURRENT', quickActionBtn);
        } else {
          handleQuickPlusOneClick(entry, quickActionBtn, item.querySelector('.progress-text'));
        }
      });
    }

    container.appendChild(item);
  });
}

function handleQuickPlusOneClick(entry, btnElement, progressTextElement) {
  const media = entry.media;
  const maxEpisodes = media.episodes || '?';
  
  entry.progress += 1;
  btnElement.textContent = `+1`; 
  if (progressTextElement) {
    progressTextElement.textContent = `Ep: ${entry.progress} / ${maxEpisodes}`;
  }

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
      btnElement.textContent = 'Error';
      btnElement.disabled = false;
    }
  }, 800); 
}

async function quickUpdateStatus(mediaId, newStatus, btnElement) {
  btnElement.textContent = '...';
  btnElement.disabled = true;

  const mutation = `
    mutation ($mediaId: Int, $status: MediaListStatus) {
      SaveMediaListEntry (mediaId: $mediaId, status: $status) { id }
    }
  `;

  try {
    const response = await apiRequest(mutation, { mediaId, status: newStatus });
    if (response.errors) throw new Error(JSON.stringify(response.errors));

    loadAnimeList(true); 
  } catch (error) {
    btnElement.textContent = 'Add';
    btnElement.disabled = false;
  }
}

function openDetailView(entry) {
  currentSelectedAnime = entry;
  
  document.getElementById('detail-image').src = entry.media.coverImage.large;
  document.getElementById('anime-title').textContent = entry.media.title.romaji;
  document.getElementById('episode-input').value = entry.progress || 0;
  document.getElementById('total-episodes').textContent = `/ ${entry.media.episodes || '?'}`;
  document.getElementById('score-input').value = entry.score || '';
  
  const statusSelect = document.getElementById('status-select');
  statusSelect.value = entry.status || 'CURRENT';

  document.getElementById('main-view').classList.add('hidden');
  document.getElementById('detail-view').classList.remove('hidden');
  document.getElementById('save-btn').textContent = 'Save Update';
  const hideToggle = document.getElementById('hide-title-toggle');
  if (hideToggle) {
    hideToggle.checked = hiddenMediaIds.includes(entry.media.id);
  }
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
      SaveMediaListEntry (mediaId: $mediaId, progress: $progress, status: $status, scoreRaw: $scoreRaw, startedAt: $startedAt, completedAt: $completedAt) {
        id status progress score 
      }
    }
  `;

  const variables = {
    mediaId,
    progress: newProgress,
    status: newStatus
  };

  const scoreVal = document.getElementById('score-input').value;
  if (scoreVal !== '') {
    variables.scoreRaw = parseInt(scoreVal, 10); 
  }

  if (startedAt) variables.startedAt = startedAt;
  if (completedAt) variables.completedAt = completedAt;

  try {
    const response = await apiRequest(mutation, variables);
    if (response.errors) {
      saveBtn.textContent = 'Error! Try again';
    } else {
      saveBtn.textContent = 'Saved!';
      setTimeout(() => {
        document.getElementById('detail-view').classList.add('hidden');
        document.getElementById('main-view').classList.remove('hidden');
        loadAnimeList(true); 
        saveBtn.disabled = false;
      }, 1000);
    }
  } catch (error) {
    saveBtn.textContent = 'Error! Try again';
    saveBtn.disabled = false;
  }
}

// --- UPDATED: Fetch User Level & Render Progress Bar ---
async function loadUserLevel(userId) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/user_stats?anilist_user_id=eq.${userId}&select=level,true_watch_seconds`;
    const res = await fetch(url, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
    const data = await res.json();
    
    if (data && data.length > 0) {
      const { level, true_watch_seconds } = data[0];
      const currentMinutes = Math.floor(true_watch_seconds / 60);
      
      // Update Name Badge
      const userLevelEl = document.getElementById('user-level');
      if (userLevelEl) userLevelEl.textContent = `Lv. ${level}`;
      
      // Calculate XP thresholds for the progress bar
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

// --- UPDATED: Handle Retroactive Sync Click (Cloud State) ---
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
          
          // Removed the local storage set here. Background.js handles it in the cloud now!
          
          setTimeout(() => {
            loadUserLevel(userId); 
            btn.classList.add('hidden'); // Hide the button immediately after success
          }, 2000);
        } else {
          btn.textContent = "Sync Failed.";
          btn.disabled = false;
        }
      });
    });
  }

// --- NEW: Fetch Global Leaderboard ---
async function loadLeaderboard() {
  const container = document.getElementById('leaderboard-container');
  container.innerHTML = '<p class="placeholder-text">Syncing with global database...</p>';
  
  try {
    // Fetch top 10 users ordered by true watch time
    const url = `${SUPABASE_URL}/rest/v1/user_stats?order=true_watch_seconds.desc&limit=10`;
    const res = await fetch(url, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
    const topUsers = await res.json();
    
    container.innerHTML = '';
    
    if (!topUsers || topUsers.length === 0) {
      container.innerHTML = '<p class="placeholder-text">No data yet. Be the first to level up!</p>';
      return;
    }

    topUsers.forEach((user, index) => {
      const isMe = user.anilist_user_id === userId;
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

// --- NEW: Render Achievements UI ---
async function loadAchievementsUI(userId) {
  const container = document.getElementById('achievements-container');
  if (!container) return;
  container.innerHTML = '<p class="placeholder-text">Loading achievements...</p>';

  try {
    const url = `${SUPABASE_URL}/rest/v1/user_stats?anilist_user_id=eq.${userId}&select=unlocked_achievements,tracking_data,true_watch_seconds`;
    const res = await fetch(url, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
    const data = await res.json();

    if (!data || data.length === 0) return;

    const unlockedIds = data[0].unlocked_achievements || [];
    const trackingData = data[0].tracking_data || {};
    const trueWatchSeconds = data[0].true_watch_seconds || 0;

    // --- NEW: Hide the Sync Button based on Cloud Data! ---
    const syncBtn = document.getElementById('sync-history-btn');
    if (trackingData.has_synced_history && syncBtn) {
      syncBtn.classList.add('hidden');
    } else if (syncBtn) {
      syncBtn.classList.remove('hidden');
    }

    // Bundle stats to calculate progress bars accurately
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

    // Split achievements into Unlocked and Locked arrays
    const unlockedList = ACHIEVEMENTS.filter(a => unlockedIds.includes(a.id)).reverse(); // Show newest first
    const lockedList = ACHIEVEMENTS.filter(a => !unlockedIds.includes(a.id));
    const allSorted = [...unlockedList, ...lockedList];

    let html = '';

    allSorted.forEach((achieve, index) => {
      const isUnlocked = index < unlockedList.length;
      let progressHtml = '';
      
      // If locked and supports progress tracking, draw the bar!
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

      // Hide anything beyond the first 3 items
      const hiddenClass = index >= 3 ? 'hidden-achievement hidden' : '';
      
      html += `
        <div class="achieve-card ${isUnlocked ? 'unlocked' : 'locked'} ${hiddenClass}">
          <div class="achieve-icon">${achieve.icon}</div>
          <div class="achieve-info">
            <div class="achieve-title">${achieve.name}</div>
            <div class="achieve-desc">${achieve.description}</div>
            ${progressHtml}
          </div>
        </div>
      `;
    });

    if (allSorted.length > 3) {
      html += `<button id="view-more-achievements" class="secondary-btn" style="width: 100%; margin-top: 8px;">View All Achievements</button>`;
    }

    container.innerHTML = html;

    // View More Button Logic
    const viewMoreBtn = document.getElementById('view-more-achievements');
    if (viewMoreBtn) {
      viewMoreBtn.addEventListener('click', () => {
        document.querySelectorAll('.hidden-achievement').forEach(el => el.classList.remove('hidden'));
        viewMoreBtn.remove();
      });
    }

  } catch (error) {
    container.innerHTML = '<p class="placeholder-text">Failed to load achievements.</p>';
  }
}

// --- UPDATED: Fetch and Render AniList Lifetime Statistics ---
async function loadDetailedStats(userId) {
  // NEW: Added 'tags' to the GraphQL query to fetch Themes (Isekai, etc.)
  const query = `
    query ($userId: Int) {
      User(id: $userId) {
        statistics {
          anime {
            count
            episodesWatched
            minutesWatched
            meanScore
            statuses(sort: COUNT_DESC) { count status }
            genres(limit: 6, sort: COUNT_DESC) { count genre }
            tags(limit: 6, sort: COUNT_DESC) { count tag { name } }
            formats(limit: 5, sort: COUNT_DESC) { count format }
          }
        }
      }
    }
  `;

  try {
    const res = await apiRequest(query, { userId: userId });
    const stats = res.data.User.statistics.anime;
    userTopGenres = stats.genres.slice(0, 5).map(g => g.genre);
    // 1. Render Summary Grid
    const mins = stats.minutesWatched;
    const days = Math.floor(mins / 1440);
    const hours = Math.floor((mins % 1440) / 60);
    const watchTimeStr = days > 0 ? `${days}d ${hours}h` : `${hours}h ${mins % 60}m`;
    
    document.getElementById('profile-summary-grid').innerHTML = `
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(255,255,255,0.05); color: #fff;">📺</div>
        <div class="stat-info">
          <span class="stat-value">${stats.count.toLocaleString()}</span>
          <span class="stat-label">Shows</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(61,180,242,0.1); color: #3db4f2;">▶️</div>
        <div class="stat-info">
          <span class="stat-value">${stats.episodesWatched.toLocaleString()}</span>
          <span class="stat-label">Episodes</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(229,192,123,0.1); color: #E5C07B;">🕒</div>
        <div class="stat-info">
          <span class="stat-value">${watchTimeStr}</span>
          <span class="stat-label">Watch Time</span>
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

    // 2. Render Collection Status (Donut Chart)
    const statusColors = {
      'CURRENT': '#3db4f2', 'COMPLETED': '#4cca51', 'PAUSED': '#f39c12', 
      'DROPPED': '#e74c3c', 'PLANNING': '#9fadbd'
    };
    const statusNames = {
      'CURRENT': 'Watching', 'COMPLETED': 'Completed', 'PAUSED': 'On Hold', 'DROPPED': 'Dropped', 'PLANNING': 'Plan to Watch'
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

    // 3. Render Preferences Grid & Tab Logic
    if (stats.genres.length > 0 || stats.tags.length > 0) {
      document.getElementById('profile-genres-card').classList.remove('hidden');
      
      const genresData = stats.genres || [];
      const themesData = stats.tags || [];

      // Helper function to draw the grid based on the active tab
      const renderPrefGrid = (data, isTheme) => {
        if (!data || data.length === 0) {
          document.getElementById('genres-grid').innerHTML = '<p class="placeholder-text">No data available.</p>';
          return;
        }
        
        const maxCount = data[0].count; // Used for progress bar width
        let html = '';
        
        data.forEach(item => {
          const pct = (item.count / maxCount) * 100;
          const labelName = isTheme ? item.tag.name : item.genre; // AniList nests the tag name
          
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

      // Draw Genres by default on load
      renderPrefGrid(genresData, false);

      // Handle Tab Clicks
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

    // 4. Render Formats List
    if (stats.formats.length > 0) {
      document.getElementById('profile-formats-card').classList.remove('hidden');
      const maxFormat = stats.formats[0].count;
      let formatHtml = '';

      stats.formats.forEach(f => {
        const pct = (f.count / maxFormat) * 100;
        formatHtml += `
          <div class="format-item">
            <div class="format-header"><span>${f.format}</span><span>${f.count}</span></div>
            <div class="pref-bar-bg"><div class="pref-bar-fill" style="width: ${pct}%; background-color: #3db4f2;"></div></div>
          </div>
        `;
      });
      document.getElementById('formats-list').innerHTML = formatHtml;
    }

  } catch (error) {
    console.error("Failed to load AniList stats:", error);
    document.getElementById('profile-summary-grid').innerHTML = '<p class="placeholder-text">Failed to load statistics.</p>';
  }
}

// --- NEW: ANIME DISCOVERY ENGINE ---

// 1. Navigation Event Listeners
document.getElementById('open-discover-btn')?.addEventListener('click', async () => {
  document.getElementById('profile-view').classList.add('hidden');
  document.getElementById('recommendation-view').classList.remove('hidden');
  document.getElementById('rec-content').classList.add('hidden');
  document.getElementById('rec-loading').classList.remove('hidden');
  
  // If we haven't fetched the user's blocklist yet, do it now!
  if (userExcludedMediaIds.length === 0) {
    await fetchUserBlacklist();
  }
  
  loadNextRecommendation(0); // Pass 0 to reset the safety attempt counter
});

document.getElementById('rec-back-btn')?.addEventListener('click', () => {
  document.getElementById('recommendation-view').classList.add('hidden');
  document.getElementById('profile-view').classList.remove('hidden');
});

document.getElementById('rec-next-btn')?.addEventListener('click', () => {
  recommendationClickCount++;
  loadNextRecommendation(0); // Pass 0 to reset the safety attempt counter
});

// 2. Fetch the user's ENTIRE anime list so we don't recommend things they know
async function fetchUserBlacklist() {
  const query = `
    query ($userId: Int) {
      MediaListCollection(userId: $userId, type: ANIME) {
        lists { entries { mediaId } }
      }
    }
  `;
  try {
    const res = await apiRequest(query, { userId: userId });
    let ids = new Set();
    res.data.MediaListCollection.lists.forEach(list => {
      list.entries.forEach(entry => ids.add(entry.mediaId));
    });
    userExcludedMediaIds = Array.from(ids);
  } catch (e) { console.error("Failed to fetch blacklist"); }
}

// 3. The Core Recommendation Logic
async function loadNextRecommendation(attempt = 0) {
  document.getElementById('rec-content').classList.add('hidden');
  document.getElementById('rec-loading').classList.remove('hidden');
  
  const loadingText = document.getElementById('rec-loading');

  // Check if we need to fetch a new batch of anime
  if (recommendationPool.length === 0) {
    
    // SAFETY NET: Prevent infinite loops for power users who have watched everything
    if (attempt > 5) {
      loadingText.innerHTML = "You've watched so much anime, we couldn't find a quick match!<br><br>Click Next to dive deeper.";
      return; 
    }

    const isWildcard = (recommendationClickCount + 1) % 3 === 0;
    
    // Increase depth to 20 pages (Top 400 anime) so veterans get results!
    const randomPage = Math.floor(Math.random() * 20) + 1;
    
    let variables = { page: randomPage };
    let filterString = "";
    let queryArgs = "$page: Int"; // Dynamically build to prevent GraphQL syntax errors

    if (isWildcard && userTopGenres.length > 0) {
      filterString = ", genre_not_in: $genres";
      variables.genres = userTopGenres;
      queryArgs += ", $genres: [String]";
      document.getElementById('rec-wildcard-badge').classList.remove('hidden');
    } else if (userTopGenres.length > 0) {
      filterString = ", genre_in: $genres";
      variables.genres = userTopGenres;
      queryArgs += ", $genres: [String]";
      document.getElementById('rec-wildcard-badge').classList.add('hidden');
    } else {
      document.getElementById('rec-wildcard-badge').classList.add('hidden');
    }

    const query = `
      query (${queryArgs}) {
        Page(page: $page, perPage: 20) {
          media(type: ANIME, sort: POPULARITY_DESC, isAdult: false ${filterString}) {
            id
            title { romaji english native }
            coverImage { extraLarge }
            description
            genres
          }
        }
      }
    `;

    try {
      loadingText.textContent = `Searching page ${randomPage} archives...`;
      
      const res = await apiRequest(query, variables);
      
      // Catch GraphQL errors properly
      if (res.errors) throw new Error(res.errors[0].message);
      
      const fetchedAnime = res.data.Page.media;
      
      // Filter out anything the user has already watched or planned!
      recommendationPool = fetchedAnime.filter(anime => !userExcludedMediaIds.includes(anime.id));
      
      // If filtering emptied the pool, try again recursively with a higher attempt counter
      if (recommendationPool.length === 0) {
        return loadNextRecommendation(attempt + 1);
      }
    } catch (e) {
      console.error("Discovery Engine Error:", e);
      loadingText.textContent = "Failed to fetch recommendations.";
      return;
    }
  }

  // 4. Render the UI
  const anime = recommendationPool.pop();
  
  // Add to local blacklist so we don't show it again in this session
  userExcludedMediaIds.push(anime.id); 

  document.getElementById('rec-cover').src = anime.coverImage.extraLarge;
  document.getElementById('rec-title').textContent = anime.title.english || anime.title.romaji;
  
  const altTitle = anime.title.english ? anime.title.romaji : (anime.title.native || '');
  document.getElementById('rec-alt-title').textContent = altTitle;

  const cleanDesc = anime.description ? anime.description.replace(/<br><br>/g, '\n').replace(/<[^>]*>?/gm, '') : 'No synopsis available.';
  document.getElementById('rec-synopsis').textContent = cleanDesc;

  const tagsContainer = document.getElementById('rec-tags');
  tagsContainer.innerHTML = '';
  anime.genres.slice(0, 4).forEach(genre => {
    const tag = document.createElement('div');
    tag.className = 'rec-tag';
    tag.textContent = genre;
    tagsContainer.appendChild(tag);
  });

  loadingText.classList.add('hidden');
  document.getElementById('rec-content').classList.remove('hidden');
  
  // Reset the loading text for the next time it's needed
  loadingText.textContent = "Finding the perfect anime...";
}
