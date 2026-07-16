const CLIENT_ID = '45996'; // <-- Remember your Client ID!
let accessToken = null;
let userId = null;
let currentSelectedAnime = null; 
let cachedWatchingList = []; 
let cachedAllScheduleList = []; 
let currentDayTabIndex = new Date().getDay(); 
let currentFilter = 'SCHEDULE'; 
const debounceTimers = {}; 
let progressInterval = null; // Add this near the top of popup.js

// Auto-detect variables
let detectedMedia = null;
let detectedEpisode = null;

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['anilistToken'], (result) => {
    if (result.anilistToken) {
      accessToken = result.anilistToken;
      updateAuthUI(true);
      initializeApp(); 
    } else {
      updateAuthUI(false);
    }
  });

  

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
      document.getElementById('filter-dropdown').classList.add('hidden');
    }
  });

  document.getElementById('status-select').addEventListener('change', (e) => {
    if (e.target.value === 'COMPLETED' && currentSelectedAnime?.media?.episodes) {
      document.getElementById('episode-input').value = currentSelectedAnime.media.episodes;
    }
  });

  // --- NEW: Skip Intro Button ---
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

  // --- NEW: Settings Navigation ---
  document.getElementById('settings-btn').addEventListener('click', () => {
    document.getElementById('main-view').classList.add('hidden');
    document.getElementById('search-input').classList.add('hidden');
    document.getElementById('autodetect-view').classList.add('hidden');
    document.getElementById('settings-view').classList.remove('hidden');
    
    // Load current settings
    chrome.storage.local.get(['trackingThreshold', 'whitelistedDomains'], (res) => {
      const threshold = res.trackingThreshold || 80;
      document.getElementById('threshold-slider').value = threshold;
      document.getElementById('threshold-display').textContent = `${threshold}%`;
      renderWhitelistManager(res.whitelistedDomains || []);
    });
  });

  document.getElementById('settings-back-btn').addEventListener('click', () => {
    document.getElementById('settings-view').classList.add('hidden');
    loadAnimeList(); // Go back to main list
  });

  // --- NEW: Threshold Slider Logic ---
  const thresholdSlider = document.getElementById('threshold-slider');
  thresholdSlider.addEventListener('input', (e) => {
    document.getElementById('threshold-display').textContent = `${e.target.value}%`;
  });
  thresholdSlider.addEventListener('change', (e) => {
    chrome.storage.local.set({ trackingThreshold: parseInt(e.target.value, 10) });
  });

  document.getElementById('autodetect-cancel-btn').addEventListener('click', () => {
    // if (progressInterval) clearInterval(progressInterval); // Clean up the interval
    document.getElementById('autodetect-view').classList.add('hidden');
    loadAnimeList(); 
  });

  // --- CRASH-PROOF WHITELIST LISTENERS ---
  const whitelistCancelBtn = document.getElementById('whitelist-cancel-btn');
  if (whitelistCancelBtn) {
    whitelistCancelBtn.addEventListener('click', () => {
      document.getElementById('whitelist-view').classList.add('hidden');
      loadAnimeList(); // Skip tracking and just load normal schedule
    });
  } else {
    console.warn("Whitelist Cancel button not found in HTML!");
  }

  const whitelistConfirmBtn = document.getElementById('whitelist-confirm-btn');
  if (whitelistConfirmBtn) {
    whitelistConfirmBtn.addEventListener('click', () => {
      const hostname = document.getElementById('whitelist-hostname').textContent;
      
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
  } else {
    console.warn("Whitelist Confirm button not found in HTML!");
  }

  document.getElementById('episode-input').addEventListener('input', handleEpisodeInput);
  document.getElementById('save-btn').addEventListener('click', saveAnimeUpdate);

  document.getElementById('detail-image').addEventListener('click', () => {
    if (currentSelectedAnime) {
      document.getElementById('modal-img').src = currentSelectedAnime.media.coverImage.large;
      document.getElementById('fullscreen-modal').classList.remove('hidden');
    }
  });

  document.getElementById('fullscreen-modal').addEventListener('click', () => {
    document.getElementById('fullscreen-modal').classList.add('hidden');
  });

  document.getElementById('autodetect-confirm-btn').addEventListener('click', handleAutoDetectConfirm);
});

function handleLoginClick() {
  const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${CLIENT_ID}&response_type=token`;
  chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirectUrlResult) => {
    if (chrome.runtime.lastError || !redirectUrlResult) return;
    const hash = new URL(redirectUrlResult).hash;
    const token = new URLSearchParams(hash.substring(1)).get('access_token');
    if (token) {
      accessToken = token;
      chrome.storage.local.set({ anilistToken: accessToken }, () => {
        updateAuthUI(true);
        initializeApp();
      });
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

  if (isLoggedIn) {
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    autodetectView.classList.add('hidden'); // Reset
  } else {
    loginView.classList.remove('hidden');
    appView.classList.add('hidden');
    detailView.classList.add('hidden');
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

// --- NEW AUTO-DETECT LOGIC ---

async function initializeApp() {
  document.getElementById('anime-list').innerHTML = '';
  const viewerQuery = `query { Viewer { id name avatar { medium } } }`;
  try {
    const data = await apiRequest(viewerQuery);
    const viewer = data.data.Viewer;
    userId = viewer.id;
    
    document.getElementById('user-avatar').src = viewer.avatar.medium;
    document.getElementById('user-name').textContent = viewer.name;

    // Before loading the normal list, check the active tab!
    const foundAnimeOnTab = await checkCurrentTabForAnime();
    if (!foundAnimeOnTab) {
      loadAnimeList(); 
    }
  } catch (error) {
    console.error("Error fetching Viewer ID:", error);
  }
}

// --- NEW: Whitelist Manager Renderer ---
function renderWhitelistManager(domains) {
  const container = document.getElementById('whitelist-manager-list');
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

  // Add delete listeners
  document.querySelectorAll('.remove-domain-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = e.target.getAttribute('data-index');
      domains.splice(idx, 1);
      chrome.storage.local.set({ whitelistedDomains: domains }, () => {
        renderWhitelistManager(domains); // Re-render instantly
      });
    });
  });
}

// --- SMART SEARCH HELPER ---
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
    console.log(`AniList Search Attempt: "${term}"`);
    const res = await apiRequest(query, { search: term });
    return res.data?.Media || null;
  }

  // Attempt 1: The raw cleaned title
  let media = await doSearch(rawTitle);
  if (media) return media;

  // Attempt 2: Strip parentheses and anything inside them (e.g., "(And Proud of it)!")
  let noBrackets = rawTitle.replace(/\[.*?\]|\(.*?\)[^\w\s]*/g, '').trim();
  if (noBrackets && noBrackets !== rawTitle) {
    media = await doSearch(noBrackets);
    if (media) return media;
  }

  // Attempt 3: Strip aggressive punctuation (?, !, commas)
  let noPunctuation = noBrackets.replace(/[?!,]/g, '').replace(/\s+/g, ' ').trim();
  if (noPunctuation && noPunctuation !== noBrackets) {
    media = await doSearch(noPunctuation);
    if (media) return media;
  }

  // Attempt 4: Split at the first colon or dash (grabs just the main franchise name)
  let splitTitle = rawTitle.split(/[:\-]/)[0].trim();
  if (splitTitle && splitTitle !== rawTitle && splitTitle.length > 3) {
    media = await doSearch(splitTitle);
    if (media) return media;
  }

  return null; // Total failure
}

async function checkCurrentTabForAnime() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs || tabs.length === 0) return resolve(false);
      
      const title = tabs[0].title || "";
      let hostname = "unknown";

      // CRITICAL FIX: Safely parse the URL. Chrome blocks URLs on New Tab or Extension pages!
      try {
        if (tabs[0].url) {
          hostname = new URL(tabs[0].url).hostname;
        }
      } catch (e) {
        console.log("Could not parse tab URL (likely a restricted browser page).");
      }

      const regex = /(?:Watch\s+)?(.*?)\s*(?:[-|—–:~]+\s*)?(?:Season\s*\d+\s*)?(?:Episode|Ep|EP|E)\.?\s*0*(\d+)/i;
      const match = title.match(regex);

      if (match && match[1] && match[2]) {
        // --- WHITELIST INTERCEPTOR ---
        chrome.storage.local.get(['whitelistedDomains'], async (result) => {
          const domains = result.whitelistedDomains || [];
          const isWhitelisted = domains.some(d => hostname.includes(d));

          if (!isWhitelisted) {
            // It looks like an anime, but isn't whitelisted. Ask the user!
            showWhitelistView(hostname);
            return resolve(true); // Stop the normal list from loading
          }

          // If it IS whitelisted, proceed with the normal smart search logic
          let parsedTitle = match[1].replace(/[-|—–:~]+$/g, '').trim(); 
          parsedTitle = parsedTitle.replace(/\s+\(?(?:Sub|Dub)\)?$/i, '').trim();
          const parsedEp = parseInt(match[2], 10);
          
          try {
            const media = await searchAnimeWithFallbacks(parsedTitle);
            
            if (media) {
              console.log(`Auto-Detect Check: Found AniList Match ->`, media.title.romaji);
              detectedMedia = media;
              detectedEpisode = parsedEp;
              showAutoDetectView(media, parsedEp);
              return resolve(true);
            }
          } catch (e) {
            console.error("Auto-detect AniList search failed", e);
          }
          resolve(false);
        });
      } else {
        resolve(false); // No anime title detected, load normal list
      }
    });
  });
}

// --- NEW PROGRESS BAR HELPER ---
function updateProgressBar(progressValue) {
  const pct = progressValue.toFixed(1);
  const progressBar = document.getElementById('video-progress-bar');
  const progressText = document.getElementById('video-progress-text');
  
  // Cap the visual bar at 100% so it doesn't overflow
  const visualPct = Math.min(progressValue, 100).toFixed(1);

  if (progressBar && progressText) {
    progressBar.style.width = visualPct + '%';
    progressText.textContent = `Video Progress: ${pct}%`;
  }
}

function showWhitelistView(hostname) {
  document.getElementById('main-view').classList.add('hidden');
  document.getElementById('search-input').classList.add('hidden'); 
  document.getElementById('autodetect-view').classList.add('hidden');
  document.getElementById('whitelist-view').classList.remove('hidden');
  
  document.getElementById('whitelist-hostname').textContent = hostname;
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
  
  // Ensure the action container is visible
  epTextEl.classList.remove('hidden');
  actionsEl.classList.remove('hidden');
  
  // UI UPGRADE: Hide the manual update button completely to enforce the 80% rule!
  confirmBtn.classList.add('hidden');
  cancelBtn.textContent = 'View My Anime List'; // Repurpose the cancel button
  
  if (currentProg >= ep) {
    epTextEl.textContent = `✅ You are already at Ep ${currentProg}`;
    epTextEl.style.color = "#98C379"; 
  } else {
    epTextEl.textContent = `Tracking Ep ${ep}... (Auto-updates at 80%)`;
    epTextEl.style.color = "#E5C07B"; // Gold color to indicate it is actively tracking
  }
}

// --- Listen for the LIVE_VIDEO_PROGRESS pushed from content.js ---
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "LIVE_VIDEO_PROGRESS") {
    const pct = message.progress.toFixed(1);
    
    const progressBar = document.getElementById('video-progress-bar');
    const progressText = document.getElementById('video-progress-text');
    const visualPct = Math.min(message.progress, 100).toFixed(1); // Cap visual bar at 100%
    
    if (progressBar && progressText) {
      progressBar.style.width = visualPct + '%';
      progressText.textContent = `Video Progress: ${pct}%`;
    }

    // NEW UPGRADE: If the popup is open when we hit 80%, dynamically update the UI!
    if (message.progress >= 80) {
      const epTextEl = document.getElementById('autodetect-ep');
      
      // Only change the text if it hasn't already been changed
      if (!epTextEl.textContent.includes("✅") && !epTextEl.textContent.includes("already at")) {
        epTextEl.textContent = "✅ 80% Reached! Auto-updated successfully.";
        epTextEl.style.color = "#98C379"; // Turn text green
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
      // if (progressInterval) clearInterval(progressInterval); // Clean up the interval
      document.getElementById('autodetect-view').classList.add('hidden');
      loadAnimeList(); 
      btn.disabled = false;
      btn.textContent = 'Update Progress';
    }, 1000);
  } catch (error) {
    console.error("Auto-detect update failed", error);
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
  
  // --- NEW: Hide the tracker views when loading the list! ---
  document.getElementById('autodetect-view').classList.add('hidden');
  document.getElementById('whitelist-view').classList.add('hidden');

  const filter = currentFilter; 
  let query, variables;
  // ... rest of the function remains exactly the same ...

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
  const container = document.getElementById('anime-list');
  container.innerHTML = ''; 

  if (entries.length === 0) {
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

    // Safely construct variables, omitting undefined ones
    const variables = { mediaId: media.id, progress: entry.progress, status: newStatus };
    if (startedAt) variables.startedAt = startedAt;
    if (completedAt) variables.completedAt = completedAt;

    try {
      const response = await apiRequest(mutation, variables);
      // Properly throw the error so the catch block can read it
      if (response.errors) throw new Error(JSON.stringify(response.errors));
      
      btnElement.disabled = false;
      loadAnimeList(true); 
    } catch (error) {
      console.error("Quick +1 Failed:", error.message);
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
    console.error("Quick Add Failed:", error.message);
    btnElement.textContent = 'Add';
    btnElement.disabled = false;
  }
}

// --- DETAIL VIEW LOGIC ---

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

  // FIX: Changed 'scoreRaw' to 'score' in the return fields inside the curly braces below!
  const mutation = `
    mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus, $scoreRaw: Int, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
      SaveMediaListEntry (mediaId: $mediaId, progress: $progress, status: $status, scoreRaw: $scoreRaw, startedAt: $startedAt, completedAt: $completedAt) {
        id status progress score 
      }
    }
  `;

  // Safely build the variables object
  const variables = {
    mediaId,
    progress: newProgress,
    status: newStatus
  };

  // Only append scoreRaw if the user typed a valid number
  const scoreVal = document.getElementById('score-input').value;
  if (scoreVal !== '') {
    variables.scoreRaw = parseInt(scoreVal, 10); // Forces it to be an Integer
  }

  // Only append dates if they were triggered
  if (startedAt) variables.startedAt = startedAt;
  if (completedAt) variables.completedAt = completedAt;

  try {
    const response = await apiRequest(mutation, variables);
    if (response.errors) {
      console.error("Mutation errors:", JSON.stringify(response.errors, null, 2));
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
    console.error("Failed to save:", error);
    saveBtn.textContent = 'Error! Try again';
    saveBtn.disabled = false;
  }
}