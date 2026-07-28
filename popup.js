// popup.js
// CORE LOGIC: Auth, API Routing, Anime List Rendering, and Auto-Detect

const CLIENT_ID = ANILIST_CLIENT_ID; 
const SECOND_CLIENT_ID = MAL_CLIENT_ID;
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

// Auto-detect variables
let detectedMedia = null;
let detectedEpisode = null;
let hiddenMediaIds = [];



document.addEventListener('DOMContentLoaded', () => {
  // 1. INITIAL BOOT: Load token, threshold, mode, and hidden titles
  chrome.storage.local.get(['anilistToken', 'trackingThreshold', 'currentMode'], (localRes) => {
    chrome.storage.sync.get(['hiddenMediaIds'], (syncRes) => {
      if (localRes.trackingThreshold) currentThreshold = localRes.trackingThreshold;
      if (syncRes.hiddenMediaIds) hiddenMediaIds = syncRes.hiddenMediaIds;
      
      // NEW: Load saved mode and update the button icon
      if (localRes.currentMode) currentMode = localRes.currentMode;
      const modeBtn = document.getElementById('mode-toggle-btn');
      if (modeBtn) modeBtn.textContent = currentMode === 'ANIME' ? '📺' : '📖';
      
      // --- FIX: SET INITIAL FILTER & UI LABEL BASED ON SAVED MODE ---
      currentFilter = currentMode === 'ANIME' ? 'SCHEDULE' : 'CURRENT';
      const viewLabel = document.getElementById('current-view-label');
      if (viewLabel) viewLabel.textContent = currentMode === 'ANIME' ? 'Schedule (My List) ▾' : 'Currently Reading ▾';
      // --------------------------------------------------------------
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

  // --- CORE UI LISTENERS ---
  document.getElementById('login-btn').addEventListener('click', handleLoginClick);
  document.getElementById('logout-btn').addEventListener('click', handleLogoutClick);
  
  // Attach MAL login to the main login screen button
  const malLoginBtn = document.getElementById('mal-login-btn');
  if (malLoginBtn) malLoginBtn.addEventListener('click', handleMalLoginClick);

  // Attach auth flows to the Settings Menu link buttons
  const settingsAniBtn = document.getElementById('settings-anilist-link-btn');
  if (settingsAniBtn) settingsAniBtn.addEventListener('click', handleLoginClick);
  
  const settingsMalBtn = document.getElementById('settings-mal-link-btn');
  if (settingsMalBtn) settingsMalBtn.addEventListener('click', handleMalLoginClick);
  
  // --- NEW: REACTIVE UI LISTENER ---
  // This listens for the background script saving the token and updates the UI instantly
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

// --- NEW: SMART MERGE LISTENER ---
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

  // Listen for Live Sync Progress
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "SYNC_PROGRESS") {
      const progressBar = document.getElementById('sync-progress-bar');
      const statusText = document.getElementById('sync-status-text');
      
      if (progressBar) {
        const pct = (message.current / message.total) * 100;
        progressBar.style.width = `${pct}%`;
      }
      if (statusText) {
        statusText.textContent = `Syncing: ${message.current} / ${message.total} (${message.title})`;
      }
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

  const syncMalToAniBtn = document.getElementById('sync-mal-to-ani-btn');
  if (syncMalToAniBtn) {
    syncMalToAniBtn.addEventListener('click', () => {
      const statusText = document.getElementById('sync-status-text');
      syncMalToAniBtn.disabled = true;
      syncMalToAniBtn.textContent = "Syncing...";
      if (statusText) statusText.textContent = "Fetching lists & comparing data...";
      
      chrome.runtime.sendMessage({ action: "SYNC_MAL_TO_ANI" });
    });
  }

  document.getElementById('back-btn').addEventListener('click', () => {
    document.getElementById('detail-view').classList.add('hidden');
    document.getElementById('main-view').classList.remove('hidden');
  });

  // --- DYNAMIC DROPDOWN GENERATOR ---
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
    
    // Event delegation is now handled by a single listener on the dropdown container
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
        document.getElementById('main-view').classList.add('hidden');
        document.getElementById('search-input').classList.add('hidden');
        document.getElementById('profile-view').classList.add('hidden');
        document.getElementById('leaderboard-view').classList.remove('hidden');
        if (typeof loadLeaderboard === 'function') loadLeaderboard();
      } else if (currentFilter === 'UNFINISHED') {
        document.getElementById('leaderboard-view').classList.add('hidden');
        document.getElementById('profile-view').classList.add('hidden');
        document.getElementById('main-view').classList.remove('hidden');
        document.getElementById('day-tabs').classList.add('hidden');
        document.getElementById('search-input').classList.remove('hidden');
        loadUnfinishedList();
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
      
      modeBtn.textContent = currentMode === 'ANIME' ? '📺' : '📖';
      chrome.storage.local.set({ currentMode: currentMode });
      
      currentFilter = currentMode === 'ANIME' ? 'SCHEDULE' : 'CURRENT';
      const viewLabel = document.getElementById('current-view-label');
      if (viewLabel) viewLabel.textContent = currentMode === 'ANIME' ? 'Schedule (My List) ▾' : 'Currently Reading ▾';
      
      updateDropdownMenu();
      const searchInput = document.getElementById('search-input');
      if (searchInput) searchInput.value = ''; 
      
      // --- NEW: CONTEXT-AWARE REFRESH LOGIC ---
      const profileView = document.getElementById('profile-view');
      
      // Check if the user is currently looking at their profile
      if (profileView && !profileView.classList.contains('hidden')) {
        if (typeof userId !== 'undefined' && userId) {
          // Refresh the detailed stats dynamically
          if (typeof loadDetailedStats === 'function') loadDetailedStats(userId);
          
          // Hide/Show the "Time Saved" element based on the mode
          const timeSavedEl = document.getElementById('time-saved-display');
          if (timeSavedEl && timeSavedEl.parentElement) {
            timeSavedEl.parentElement.style.display = currentMode === 'ANIME' ? 'block' : 'none';
          }
        }
      } else if (accessToken) {
        // If they are on the main dashboard, reload the list normally
        if (typeof loadAnimeList === 'function') loadAnimeList();
      }
      // ----------------------------------------
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

  // --- TIME WIZARD / SKIP LOGIC ---
  const skipBtn = document.getElementById('skip-intro-btn');
  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: "SKIP_TIME", amount: 90 });
          
          chrome.storage.local.get(['timeSavedSeconds', 'lastSkipTimestamp'], (res) => {
            const now = Date.now();
            const lastSkip = res.lastSkipTimestamp || 0;
            
            if (now - lastSkip < 60000) {
              const originalText = skipBtn.textContent;
              skipBtn.textContent = "Cooldown!";
              skipBtn.style.color = "#e74c3c";
              setTimeout(() => { 
                skipBtn.textContent = originalText; 
                skipBtn.style.color = "#E5C07B";
              }, 1500);
              return; 
            }

            const newTotal = (res.timeSavedSeconds || 0) + 90;
            chrome.storage.local.set({ timeSavedSeconds: newTotal, lastSkipTimestamp: now });
            
            const timeSavedDisplay = document.getElementById('time-saved-display');
            if (timeSavedDisplay) {
              timeSavedDisplay.textContent = `${Math.floor(newTotal / 60)}m`;
            }
          });
        }
      });
    });
  }

  // --- SETTINGS NAVIGATION ---
  // --- SETTINGS NAVIGATION ---
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      document.getElementById('main-view').classList.add('hidden');
      document.getElementById('search-input').classList.add('hidden');
      document.getElementById('autodetect-view').classList.add('hidden');
      document.getElementById('settings-view').classList.remove('hidden');
      
      // FETCH ALL SETTINGS AND TOKENS
      chrome.storage.local.get(['trackingThreshold', 'whitelistedDomains', 'anilistToken', 'malToken'], (res) => {
        // 1. Threshold Slider
        const threshold = res.trackingThreshold || 80;
        const slider = document.getElementById('threshold-slider');
        const display = document.getElementById('threshold-display');
        if (slider && display) {
          slider.value = threshold;
          display.textContent = `${threshold}%`;
        }
        
        // 2. Whitelist Manager
        renderWhitelistManager(res.whitelistedDomains || []);

        // 3. Connected Accounts UI
        const aniLinkBtn = document.getElementById('settings-anilist-link-btn');
        const malLinkBtn = document.getElementById('settings-mal-link-btn');
        const syncSection = document.getElementById('cross-sync-section'); // NEW
        
        let hasAniList = false;
        let hasMal = false;

        if (aniLinkBtn) {
          if (res.anilistToken) {
            hasAniList = true;
            aniLinkBtn.textContent = "✓ AniList Connected";
            aniLinkBtn.style.borderColor = "#4cca51";
            aniLinkBtn.style.color = "#4cca51";
            aniLinkBtn.disabled = true; 
          } else {
            aniLinkBtn.textContent = "Link to AniList";
            aniLinkBtn.style.borderColor = "#3db4f2";
            aniLinkBtn.style.color = "#3db4f2";
            aniLinkBtn.disabled = false;
          }
        }

        if (malLinkBtn) {
          if (res.malToken) {
            hasMal = true;
            malLinkBtn.textContent = "✓ MAL Connected";
            malLinkBtn.style.borderColor = "#4cca51";
            malLinkBtn.style.color = "#4cca51";
            malLinkBtn.disabled = true; 
          } else {
            malLinkBtn.textContent = "Link to MyAnimeList";
            malLinkBtn.style.borderColor = "#5C7CE5"; 
            malLinkBtn.style.color = "#5C7CE5";
            malLinkBtn.disabled = false;
          }
        }

        // Unhide the Sync feature only if both are connected!
        if (hasAniList && hasMal && syncSection) {
          syncSection.classList.remove('hidden');
        } else if (syncSection) {
          syncSection.classList.add('hidden');
        }
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

  // Save ignored domain when user clicks "Skip for now"
  const whitelistCancelBtn = document.getElementById('whitelist-cancel-btn');
  if (whitelistCancelBtn) {
    whitelistCancelBtn.addEventListener('click', () => {
      const hostnameEl = document.getElementById('whitelist-hostname');
      if (hostnameEl) {
        const hostname = hostnameEl.textContent;
        chrome.storage.local.get(['ignoredDomains'], (result) => {
          const ignored = result.ignoredDomains || [];
          if (!ignored.includes(hostname)) {
            ignored.push(hostname);
            chrome.storage.local.set({ ignoredDomains: ignored });
          }
        });
      }
      
      document.getElementById('whitelist-view').classList.add('hidden');
      loadAnimeList(); 
    });
  }

  // Broad Keyword & Strict Title Detector
  async function checkCurrentTabForAnime() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (!tabs || tabs.length === 0) return resolve(false);
        
        const title = tabs[0].title || "";
        let hostname = "unknown";
        try { if (tabs[0].url) hostname = new URL(tabs[0].url).hostname; } catch (e) {}

        let parsedTitle = "";
        let parsedProgress = 0;
        let detectedType = null; 

        // 1. Anime Episode Regex
        const animeRegex = /(?:Watch\s+)?(.*?)\s*(?:[-|—–:~]+\s*)?(?:Season\s*\d+\s*)?(?:Episode|Ep|EP|E)\.?\s*0*(\d+)/i;
        const animeMatch = title.match(animeRegex);
        
        if (animeMatch && animeMatch[1] && animeMatch[2]) {
          parsedTitle = animeMatch[1].replace(/[-|—–:~]+$/g, '').replace(/\s+\(?(?:Sub|Dub)\)?$/i, '').trim();
          parsedProgress = parseInt(animeMatch[2], 10);
          detectedType = 'ANIME';
        } 
        // 2. Manga Chapter Regex
        else {
          const chapRegex = /(?:Chapter|Ch\.|Ch)\s*0*(\d+(\.\d+)?)/i;
          const looseRegex = /[-|\|]\s*0*(\d+(\.\d+)?)\s*(?:\||-|$)/;
          
          const chapMatch = title.match(chapRegex) || title.match(looseRegex);
          
          if (chapMatch) {
            parsedProgress = parseFloat(chapMatch[1]);
            const leftSide = title.substring(0, chapMatch.index).trim();
            const rightSide = title.substring(chapMatch.index + chapMatch[0].length).trim();
            let targetText = "";
            
            const cleanLeft = leftSide.replace(/[()[\]|]/g, '').trim();
            if (cleanLeft === '' || /^(?:page\s*)?\d+\s*[-/]?\s*(?:\d+)?$/i.test(cleanLeft)) {
              targetText = rightSide.replace(/[-|—|\|]\s*[a-zA-Z0-9]+$/i, '').trim();
            } else {
              targetText = leftSide;
            }

            let clean = targetText.replace(/\b(?:Read|Watch|Free|English|Online|Scanlation|Scans|Scan|Manga|Manhwa|Manhua|Webtoon)\b/gi, '');
            clean = clean.replace(/\[.*?\]|\(.*?\)/g, '');
            parsedTitle = clean.replace(/^[-|—–:~,\|\s]+|[-|—–:~,\|\s]+$/g, '').replace(/\s{2,}/g, ' ').trim();
            detectedType = 'MANGA';
          }
        }

        // Whitelist & Ignored Domain Checks
        chrome.storage.local.get(['whitelistedDomains', 'ignoredDomains'], async (result) => {
          const domains = result.whitelistedDomains || [];
          const ignored = result.ignoredDomains || [];
          
          const isWhitelisted = domains.some(d => hostname.includes(d));
          const isIgnored = ignored.some(d => hostname.includes(d));

          if (detectedType) {
            if (!isWhitelisted && !isIgnored) {
              showWhitelistView(hostname);
              return resolve(true); 
            }
            
            if (isWhitelisted) {
              try {
                let media = await searchAnimeWithFallbacks(parsedTitle, detectedType);
                
                if (!media && detectedType === 'MANGA') {
                  media = {
                    id: -1, 
                    title: { romaji: parsedTitle, english: null },
                    coverImage: { medium: 'icons/icon128.png', large: 'icons/icon128.png' }, 
                    chapters: '?',
                    mediaListEntry: null 
                  };
                }

                if (media) {
                  detectedMedia = media;
                  detectedEpisode = parsedProgress; 
                  showAutoDetectView(media, parsedProgress, detectedType);
                  return resolve(true);
                }
              } catch (e) {}
            }
            resolve(false);
          } else {
            // Broad Domain/Title Keyword Fallback
            const keywordRegex = /anime|manga|manhwa|manhua|webtoon/i;
            const isAnimeSite = keywordRegex.test(title) || keywordRegex.test(hostname);
            const isValidHost = hostname !== "unknown" && !hostname.includes("chrome") && !hostname.includes("google.");

            if (isAnimeSite && isValidHost && !isWhitelisted && !isIgnored) {
              showWhitelistView(hostname);
              return resolve(true);
            }
            
            resolve(false);
          }
        });
      });
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
    fullModal.addEventListener('click', () => fullModal.classList.add('hidden'));
  }

  const autoConfirmBtn = document.getElementById('autodetect-confirm-btn');
  if (autoConfirmBtn) autoConfirmBtn.addEventListener('click', handleAutoDetectConfirm);
});

// ==========================================
// 🔐 AUTHENTICATION LOGIC
// ==========================================

function handleLoginClick(e) {
  const btn = e ? e.currentTarget : document.getElementById('login-btn');
  const originalText = btn ? btn.textContent : "Log In";
  
  if (btn) btn.textContent = "Connecting...";

  const safeClientId = typeof CLIENT_ID !== 'undefined' ? CLIENT_ID : '45996';
  const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${safeClientId}&response_type=token`;

  chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirectUrlResult) => {
    if (chrome.runtime.lastError) {
      if (btn) btn.textContent = "Error - Check Console";
      setTimeout(() => { if (btn) btn.textContent = originalText; }, 3000);
      return;
    }
    if (!redirectUrlResult) {
      if (btn) btn.textContent = originalText;
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
          btn.textContent = "✓ AniList Connected";
          btn.style.borderColor = "#4cca51";
          btn.style.color = "#4cca51";
        } else if (btn) {
          btn.textContent = originalText; 
        }
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

  // Ping the background script to launch the persistent Auth Flow
  chrome.runtime.sendMessage({ action: "LOGIN_MAL" });

  // Note: The popup will close automatically when the auth window steals focus. 
  // When you reopen the popup, it will read the newly saved token and show "✓ MAL Connected"!
}

function handleLogoutClick() {
  chrome.storage.local.remove(['anilistToken', 'malToken', 'malRefreshToken', 'cachedList_data', 'cachedList_filter'], () => {
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


// ==========================================
// 📡 API CORE & BOOTSTRAP
// ==========================================

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
  
  // NEW: Added options { profileColor } to the query!
  const viewerQuery = `query { Viewer { id name avatar { medium } options { profileColor } } }`;
  
  try {
    const data = await apiRequest(viewerQuery);
    const viewer = data.data.Viewer;
    userId = viewer.id;
    
    document.getElementById('user-avatar').src = viewer.avatar.medium;
    document.getElementById('user-name').textContent = viewer.name;

    // --- NEW: PROFILE COLOR SYNC LOGIC ---
    const colorMap = {
      "blue": "#3db4f2", "purple": "#c063ff", "pink": "#fc9dd6",
      "orange": "#ef881a", "red": "#e13333", "green": "#4cca51", "gray": "#677b94"
    };
    // Map the string to a hex, or use the custom hex if the user is an AniList Donator
    const userColor = viewer.options?.profileColor;
    const hexColor = colorMap[userColor] || userColor || "#3db4f2";
    
    // Inject the color globally into the CSS variables
    document.documentElement.style.setProperty('--anilist-color', hexColor);
    // -------------------------------------

    chrome.storage.local.set({ 
      anilistUserId: userId,
      anilistUsername: viewer.name,
      anilistAvatar: viewer.avatar.medium
    });

    chrome.storage.local.get(['equippedBadge'], (res) => {
      if (res.equippedBadge) {
        const badgeImg = document.getElementById('user-active-badge');
        badgeImg.src = res.equippedBadge;
        badgeImg.classList.remove('hidden');
      }
    });

    if (typeof loadUserLevel === 'function') loadUserLevel(userId);

    const foundAnimeOnTab = await checkCurrentTabForAnime();
    if (!foundAnimeOnTab) loadAnimeList(); 
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
      chrome.storage.local.set({ whitelistedDomains: domains }, () => renderWhitelistManager(domains));
    });
  });
}

// ==========================================
// 🔍 AUTO-DETECT ENGINE
// ==========================================

// NEW: Added apiType as a parameter
async function searchAnimeWithFallbacks(rawTitle, apiType) {
  const query = `
    query ($search: String) {
      Media (search: $search, type: ${apiType}, sort: SEARCH_MATCH) {
        id idMal status title { romaji english } coverImage { large medium } episodes chapters
        mediaListEntry { id progress status }
      }
    }
  `;

  async function doSearch(term) {
    const res = await apiRequest(query, { search: term });
    return res.data?.Media || null;
  }

  // 1. Try AniList First
  let media = await doSearch(rawTitle);
  
  if (!media) {
    let noBrackets = rawTitle.replace(/\[.*?\]|\(.*?\)[^\w\s]*/g, '').trim();
    if (noBrackets && noBrackets !== rawTitle) media = await doSearch(noBrackets);
    
    if (!media) {
      let noPunctuation = noBrackets.replace(/[?!,]/g, '').replace(/\s+/g, ' ').trim();
      if (noPunctuation && noPunctuation !== noBrackets) media = await doSearch(noPunctuation);
      
      if (!media) {
        let splitTitle = rawTitle.split(/[:\-]/)[0].trim();
        if (splitTitle && splitTitle !== rawTitle && splitTitle.length > 3) media = await doSearch(splitTitle);
      }
    }
  }

  if (media) return media;

  // 2. NEW: Try MyAnimeList (MAL) Fallback
  const storage = await chrome.storage.local.get(['malToken']);
  if (storage.malToken) {
    const endpoint = apiType === 'ANIME' ? 'anime' : 'manga';
    
    async function doMalSearch(term) {
      try {
        const res = await fetch(`https://api.myanimelist.net/v2/${endpoint}?q=${encodeURIComponent(term)}&limit=1&fields=id,title,alternative_titles,main_picture,status,num_episodes,num_chapters,my_list_status`, {
          headers: { 'Authorization': `Bearer ${storage.malToken}` }
        });
        const data = await res.json();
        
        if (data && data.data && data.data.length > 0) {
          const malNode = data.data[0].node;
          // Format MAL data to perfectly mimic AniList structure for the UI
          return {
            id: malNode.id,
            idMal: malNode.id,
            isMalOnly: true, // Flag to identify this as a MAL-exclusive find
            status: malNode.status ? malNode.status.toUpperCase() : "RELEASING",
            title: { romaji: malNode.title, english: malNode.alternative_titles?.en || malNode.title },
            coverImage: { large: malNode.main_picture?.large, medium: malNode.main_picture?.medium },
            episodes: apiType === 'ANIME' ? (malNode.num_episodes || null) : null,
            chapters: apiType === 'MANGA' ? (malNode.num_chapters || null) : null,
            mediaListEntry: malNode.my_list_status ? {
              progress: apiType === 'ANIME' ? malNode.my_list_status.num_episodes_watched : malNode.my_list_status.num_chapters_read,
              status: 'CURRENT'
            } : null
          };
        }
      } catch(e) { console.error("MAL Fallback Search Failed", e); }
      return null;
    }

    let malMedia = await doMalSearch(rawTitle);
    if (!malMedia) malMedia = await doMalSearch(rawTitle.replace(/\[.*?\]|\(.*?\)[^\w\s]*/g, '').trim());
    if (malMedia) return malMedia;
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

      let parsedTitle = "";
      let parsedProgress = 0;
      let detectedType = null; 

      // 1. Try Anime Regex First (Strict Match)
      const animeRegex = /(?:Watch\s+)?(.*?)\s*(?:[-|—–:~]+\s*)?(?:Season\s*\d+\s*)?(?:Episode|Ep|EP|E)\.?\s*0*(\d+)/i;
      const animeMatch = title.match(animeRegex);
      
      if (animeMatch && animeMatch[1] && animeMatch[2]) {
        parsedTitle = animeMatch[1].replace(/[-|—–:~]+$/g, '').replace(/\s+\(?(?:Sub|Dub)\)?$/i, '').trim();
        parsedProgress = parseInt(animeMatch[2], 10);
        detectedType = 'ANIME';
      } 
      // 2. Try Manga Regex if Anime fails (Strict Match)
      else {
        const chapRegex = /(?:Chapter|Ch\.|Ch)\s*0*(\d+(\.\d+)?)/i;
        const looseRegex = /[-|\|]\s*0*(\d+(\.\d+)?)\s*(?:\||-|$)/;
        
        const chapMatch = title.match(chapRegex) || title.match(looseRegex);
        
        if (chapMatch) {
          parsedProgress = parseFloat(chapMatch[1]);
          const leftSide = title.substring(0, chapMatch.index).trim();
          const rightSide = title.substring(chapMatch.index + chapMatch[0].length).trim();
          let targetText = "";
          
          const cleanLeft = leftSide.replace(/[()[\]|]/g, '').trim();
          if (cleanLeft === '' || /^(?:page\s*)?\d+\s*[-/]?\s*(?:\d+)?$/i.test(cleanLeft)) {
            targetText = rightSide.replace(/[-|—|\|]\s*[a-zA-Z0-9]+$/i, '').trim();
          } else {
            targetText = leftSide;
          }

          let clean = targetText.replace(/\b(?:Read|Watch|Free|English|Online|Scanlation|Scans|Scan|Manga|Manhwa|Manhua|Webtoon)\b/gi, '');
          clean = clean.replace(/\[.*?\]|\(.*?\)/g, '');
          parsedTitle = clean.replace(/^[-|—–:~,\|\s]+|[-|—–:~,\|\s]+$/g, '').replace(/\s{2,}/g, ' ').trim();
          detectedType = 'MANGA';
        }
      }

      // Fetch domains to determine if we should prompt the user
      chrome.storage.local.get(['whitelistedDomains', 'ignoredDomains'], async (result) => {
        const domains = result.whitelistedDomains || [];
        const ignored = result.ignoredDomains || [];
        
        const isWhitelisted = domains.some(d => hostname.includes(d));
        const isIgnored = ignored.some(d => hostname.includes(d));

        // 3. Process the results if a strict episode/chapter match was found
        if (detectedType) {
          if (!isWhitelisted && !isIgnored) {
            showWhitelistView(hostname);
            return resolve(true); 
          }
          
          if (isWhitelisted) {
            try {
              let media = await searchAnimeWithFallbacks(parsedTitle, detectedType);
              
              if (!media && detectedType === 'MANGA') {
                media = {
                  id: -1, 
                  title: { romaji: parsedTitle, english: null },
                  coverImage: { medium: 'icons/icon128.png', large: 'icons/icon128.png' }, 
                  chapters: '?',
                  mediaListEntry: null 
                };
              }

              if (media) {
                detectedMedia = media;
                detectedEpisode = parsedProgress; 
                showAutoDetectView(media, parsedProgress, detectedType);
                return resolve(true);
              }
            } catch (e) {}
          }
          resolve(false);
        } else {
          // 4. --- NEW: Broad Domain/Title Check for Whitelist Prompt ---
          const keywordRegex = /anime|manga|manhwa|manhua|webtoon/i;
          const isAnimeSite = keywordRegex.test(title) || keywordRegex.test(hostname);
          
          // Ensure we don't accidentally prompt on Google searches or extension pages
          const isValidHost = hostname !== "unknown" && !hostname.includes("chrome") && !hostname.includes("google.");

          if (isAnimeSite && isValidHost && !isWhitelisted && !isIgnored) {
            showWhitelistView(hostname);
            return resolve(true);
          }
          
          resolve(false);
        }
      });
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

// NEW: Added detectedType as a parameter
function showAutoDetectView(media, progressNum, detectedType) {
  document.getElementById('main-view').classList.add('hidden');
  document.getElementById('search-input').classList.add('hidden'); 
  document.getElementById('autodetect-view').classList.remove('hidden');

  // NEW: DYNAMIC SYNC BADGES
  const badgesContainer = document.getElementById('autodetect-badges');
  if (badgesContainer) {
    badgesContainer.innerHTML = ''; // Clear previous
    
    // AniList Badge (Only if it came from AniList)
    if (media.id > 0 && !media.isMalOnly) {
      badgesContainer.innerHTML += `<span style="background: rgba(61,180,242,0.15); border: 1px solid #3db4f2; color: #3db4f2; padding: 2px 10px; border-radius: 12px; font-size: 10px; font-weight: bold; text-transform: uppercase;">AL Sync</span>`;
    }
    
    // MAL Badge (If it has a MAL ID from AniList, or if it was found exclusively on MAL)
    if (media.idMal || media.isMalOnly) {
       badgesContainer.innerHTML += `<span style="background: rgba(46,81,162,0.15); border: 1px solid #2E51A2; color: #5C7CE5; padding: 2px 10px; border-radius: 12px; font-size: 10px; font-weight: bold; text-transform: uppercase;">MAL Sync</span>`;
    }

    // OTG Local Badge (If it's a negative ID custom manga)
    if (media.id < 0) {
      badgesContainer.innerHTML += `<span style="background: rgba(229,192,123,0.15); border: 1px solid #E5C07B; color: #E5C07B; padding: 2px 10px; border-radius: 12px; font-size: 10px; font-weight: bold; text-transform: uppercase;">OTG Local</span>`;
    }
  }
  
  document.getElementById('autodetect-img').src = media.coverImage.medium;
  document.getElementById('autodetect-title').textContent = media.title.english || media.title.romaji;
  
  // NEW: Reset progress bar UI and set correct terminology
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
  
// DYNAMIC TEXT LABELS based on detectedType
  if (cancelBtn) cancelBtn.textContent = detectedType === 'ANIME' ? 'View My Anime List' : 'View My Manga List';
  if (headerEl) headerEl.textContent = detectedType === 'ANIME' ? "We noticed you're watching..." : "We noticed you're reading...";
  const unit = detectedType === 'ANIME' ? 'Ep' : 'Ch';
  
  // --- NEW: CUSTOM MANGA UI LOGIC ---
  if (media.id < 0) {
    epTextEl.textContent = `Tracking ${unit} ${progressNum}... (Saved locally to OTG)`;
    epTextEl.style.color = "#E5C07B";
    if (confirmBtn) confirmBtn.classList.add('hidden'); // Hide the AniList sync button
  } 
  // --- STANDARD ANILIST UI LOGIC ---
  else if (currentProg >= progressNum) {
    epTextEl.textContent = `✅ You are already at ${unit} ${currentProg}`;
    epTextEl.style.color = "#98C379"; 
  } else {
    if (detectedType === 'ANIME') {
      epTextEl.textContent = `Tracking ${unit} ${progressNum}... (Auto-updates at ${currentThreshold}%)`;
    } else {
      epTextEl.textContent = `Tracking ${unit} ${progressNum}... (Auto-updates via reader)`;
    }
    epTextEl.style.color = "#E5C07B"; 
  }


  // --- ANISKIP LOGIC ---
  const skipBtn = document.getElementById('skip-intro-btn');
  if (skipBtn) {
    if (detectedType === 'MANGA') {
      skipBtn.classList.add('hidden'); // No intros in manga!
    } else {
      skipBtn.classList.remove('hidden');
      skipBtn.textContent = '⏭ Checking Fallback Tier...';

      // Query the active tab to get the current fallback tier from content.js
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: "GET_ACTIVE_SKIP_TIER" }, (res) => {
            if (chrome.runtime.lastError || !res) {
              skipBtn.textContent = '⏭ Skip 1:30 (Tier: Unknown)';
              skipBtn.style.color = "#e74c3c";
              skipBtn.style.borderColor = "#e74c3c";
            } else {
              skipBtn.textContent = `⏭ Skip 1:30 (${res.tierText})`;
              
              // Color code the button based on the active dev tier!
              if (res.tierText.includes("Tier 1") || res.tierText.includes("Tier 2") || res.tierText.includes("Tier 3")) {
                skipBtn.style.color = "#4cca51";
                skipBtn.style.borderColor = "#4cca51";
              } else {
                // Warning color for behavioral fallback
                skipBtn.style.color = "#E5C07B"; 
                skipBtn.style.borderColor = "#E5C07B";
              }
            }
          });
        }
      });
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender && sender.tab && !sender.tab.active) return;

  // --- EXISTING VIDEO LISTENER ---
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

  // --- NEW MANGA LISTENER ---
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

// ==========================================
// 📺 CORE ANIME LIST RENDERER
// ==========================================

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

  if (unwatchedCount > 0) return `<div class="tab-badge">${unwatchedCount}</div>`;
  return `<div class="tab-badge check">✓</div>`; 
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
    // HYBRID API ROUTER
    const apiStatus = (filter === 'SCHEDULE' && currentMode === 'ANIME') ? 'CURRENT' : filter;
    const apiType = currentMode; // 'ANIME' or 'MANGA'
    
    // Dynamically request chapters vs episodes based on mode, NOW INCLUDING idMal
    const mediaFields = currentMode === 'ANIME' 
      ? `id idMal status title { romaji english } coverImage { medium large } episodes nextAiringEpisode { airingAt timeUntilAiring episode }`
      : `id idMal status title { romaji english } coverImage { medium large } chapters`;

    // Sort by UPDATED_TIME_DESC so recently read manga stack at the top!
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
  const visibleEntries = entries.filter(e => !hiddenMediaIds.includes(e.media.id));
  const container = document.getElementById('anime-list');
  container.innerHTML = ''; 

  if (visibleEntries.length === 0) {
    container.innerHTML = `<p class="placeholder-text">No ${currentMode.toLowerCase()} found.</p>`;
    return;
  }

  entries.forEach(entry => {
    const media = entry.media;
    const progress = entry.progress || 0;
    
    // Dynamically check for chapters vs episodes
    const totalMax = currentMode === 'ANIME' ? (media.episodes || '?') : (media.chapters || '?');
    const unit = currentMode === 'ANIME' ? 'Ep' : 'Ch';

    let countdownHtml = '';
    let maxAired = totalMax !== '?' ? totalMax : 0;
    
    // Countdown logic strictly for Anime Mode
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
          ${unit}: ${progress} / ${totalMax}
        </div>
        ${countdownHtml}
      </div>
      ${quickActionHtml}
    `;

    const titleEl = item.querySelector('.anime-title-text');
    titleEl.addEventListener('mouseenter', () => titleEl.textContent = media.title.english || media.title.romaji);
    titleEl.addEventListener('mouseleave', () => titleEl.textContent = media.title.romaji);

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

// ==========================================
// ✏️ UPDATING & DETAIL VIEWS
// ==========================================

function handleQuickPlusOneClick(entry, btnElement, progressTextElement) {
  const media = entry.media;
  const maxEpisodes = media.episodes || '?';
  
  entry.progress += 1;
  btnElement.textContent = `+1`; 
  if (progressTextElement) progressTextElement.textContent = `Ep: ${entry.progress} / ${maxEpisodes}`;

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
  const mutation = `mutation ($mediaId: Int, $status: MediaListStatus) { SaveMediaListEntry (mediaId: $mediaId, status: $status) { id } }`;
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

// ==========================================
// 🚧 UNFINISHED (OTG) VIEW LOGIC
// ==========================================

async function loadUnfinishedList() {
  const container = document.getElementById('anime-list');
  renderSkeleton(); 

  try {
    // 1. Fetch from Supabase (now includes platform!)
    const supabaseUrl = `${SUPABASE_URL}/rest/v1/otg_saves?anilist_user_id=eq.${userId}&select=*,custom_title,platform&order=updated_at.desc`;
    const res = await fetch(supabaseUrl, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
    const otgSaves = await res.json();

    if (!otgSaves || otgSaves.length === 0) {
      container.innerHTML = `<p class="placeholder-text">You have no unfinished ${currentMode.toLowerCase()}.<br>Great job keeping a clean slate!</p>`;
      return;
    }

    // 2. Separate by Platform
    const aniListIds = [...new Set(otgSaves.filter(s => s.platform === 'ANILIST' || !s.platform).map(s => s.media_id).filter(id => id > 0))];
    const malIds = [...new Set(otgSaves.filter(s => s.platform === 'MAL').map(s => s.media_id))];
    
    let fetchedMedia = [];

    // 3. Fetch from AniList
    if (aniListIds.length > 0) {
      const query = `query ($idIn: [Int]) { Page(page: 1, perPage: 50) { media(id_in: $idIn, type: ${currentMode}) { id title { romaji english } coverImage { medium large } episodes chapters mediaListEntry { progress status score } } } }`;
      const aniRes = await apiRequest(query, { idIn: aniListIds });
      if (aniRes.data?.Page?.media) fetchedMedia.push(...aniRes.data.Page.media.map(m => ({ ...m, platform: 'ANILIST' })));
    }

    // 4. Fetch from MAL
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

    // 5. Merge Data
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
    
    // DYNAMIC TERMINOLOGY
    const isManga = currentMode === 'MANGA';
    const unit = isManga ? 'Chapter' : 'Episode';
    const actionText = isManga ? '▶ Read' : '▶ Watch';
    let progressString = '';

    if (isManga) {
      // Manga Progress Formatting (Scroll % or Pages)
      if (entry.playback_time === 0) {
        progressString = 'Left off at: Auto-Saved URL';
      } else if (entry.playback_time <= 100 && entry.playback_time % 1 !== 0) {
        progressString = `Left off at: ${entry.playback_time.toFixed(1)}% Scrolled`;
      } else {
        progressString = `Left off at: Page ${Math.floor(entry.playback_time)}`;
      }
    } else {
      // Anime Progress Formatting (MM:SS)
      const mins = Math.floor(entry.playback_time / 60);
      const secs = Math.floor(entry.playback_time % 60).toString().padStart(2, '0');
      progressString = `Left off at: ${mins}:${secs}`;
    }

    const item = document.createElement('div');
    item.className = 'anime-list-item animated-view';
    item.setAttribute('data-title', `${media.title.romaji.toLowerCase()} ${media.title.english ? media.title.english.toLowerCase() : ''}`);

    const watchBtnHtml = entry.source_url ? `
      <button class="otg-watch-btn" data-url="${entry.source_url}" 
              style="background: transparent; color: var(--anilist-color); border: 1px solid var(--anilist-color); padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold; transition: 0.2s; width: 100%;">
        ${actionText}
      </button>
    ` : '';

    item.innerHTML = `
      <img src="${media.coverImage.medium}" style="width: 40px; height: 55px; object-fit: cover; border-radius: 4px; margin-right: 10px;">
      <div style="flex-grow: 1;">
        <div class="anime-title-text" style="font-weight: bold; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;">
          ${media.title.romaji}
        </div>
        <div style="font-size: 12px; color: #E5C07B; margin-top: 2px;">Tracking ${unit} ${entry.episode}</div>
        <div style="font-size: 11px; color: #9fadbd; font-weight: bold;">${progressString}</div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px; min-width: 75px;">
        <button class="otg-finish-btn" data-media-id="${entry.media_id}" data-ep="${entry.episode}" 
                style="background: transparent; color: #4cca51; border: 1px solid #4cca51; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold; transition: 0.2s; width: 100%;">
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
        e.target.textContent = 'Error';
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
    const url = `${SUPABASE_URL}/rest/v1/otg_saves?anilist_user_id=eq.${uId}&media_id=eq.${mId}&episode=eq.${ep}`;
    const res = await fetch(url, { method: 'DELETE', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
    return res.ok;
  } catch (error) { return false; }
}