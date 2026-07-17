const CLIENT_ID = ANILIST_CLIENT_ID; // Directly reads the global variable from config.js
let accessToken = null;
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
      if (accessToken) loadAnimeList();
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

  // --- SKIP INTRO BUTTON ---
  const skipBtn = document.getElementById('skip-intro-btn');
  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: "SKIP_TIME", amount: 90 });
        }
      });
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

  const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${CLIENT_ID}&response_type=token`;
  
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
        btn.textContent = originalText; // reset for next time
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