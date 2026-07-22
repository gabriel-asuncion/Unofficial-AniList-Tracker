// background.js
importScripts('config.js', 'achievements.js');

let lastSaveTimes = {}; 
let activeSessions = {}; 

// ==========================================
// 🚀 THE OFFLINE QUEUE SYSTEM
// ==========================================

// Check the offline queue every 15 mins, and airing schedule every 30 mins
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "processOfflineQueue") {
    processOfflineQueue();
  } else if (alarm.name === "airingCheck") {
    checkForNewEpisodes(); // NEW: Trigger the notification engine
  }
});

// Create the alarms when the extension starts
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("processOfflineQueue", { periodInMinutes: 15 });
  chrome.alarms.create("airingCheck", { periodInMinutes: 30 }); // NEW: 30 min interval
});

async function queueFailedUpdate(mediaId, progress, status, token) {
  const res = await chrome.storage.local.get(['offlineQueue']);
  const offlineQueue = res.offlineQueue || [];
  
  // Prevent duplicate queues for the same episode
  const isDupe = offlineQueue.some(item => item.mediaId === mediaId && item.progress === progress);
  if (!isDupe) {
    offlineQueue.push({ mediaId, progress, status, token, timestamp: Date.now() });
    await chrome.storage.local.set({ offlineQueue });
    console.log(`[Offline Queue] Network failed. Saved Media ${mediaId} Ep ${progress} for later.`);
  }
}

async function processOfflineQueue() {
  const res = await chrome.storage.local.get(['offlineQueue']);
  const offlineQueue = res.offlineQueue || [];
  
  if (offlineQueue.length === 0) return;
  console.log(`[Offline Queue] Attempting to sync ${offlineQueue.length} pending updates...`);
  
  let remainingQueue = [];

  for (const item of offlineQueue) {
    const mutation = `
      mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) {
        SaveMediaListEntry (mediaId: $mediaId, progress: $progress, status: $status) { id }
      }
    `;
    try {
      const apiRes = await apiRequest(mutation, { mediaId: item.mediaId, progress: item.progress, status: item.status }, item.token);
      if (apiRes.errors) throw new Error("API Rejected");
      console.log(`[Offline Queue] Success! Synced Media ${item.mediaId} Ep ${item.progress}`);
    } catch (e) {
      console.log(`[Offline Queue] Still offline. Keeping Media ${item.mediaId} in queue.`);
      remainingQueue.push(item); // Keep in queue if it fails again
    }
  }
  
  await chrome.storage.local.set({ offlineQueue: remainingQueue });
}


// ==========================================
// 🌐 CORE NETWORK HELPERS
// ==========================================

async function apiRequest(query, variables, token) {
  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ query, variables })
  });
  return response.json();
}

function getTodayFuzzy() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}
// NEW: Converts a title string into a unique negative integer
function hashStringToNegativeInt(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; 
  }
  return -Math.abs(hash || 999999);
}

// NEW: Now selects and returns both playback_time and source_url
async function getOtgTimeFromSupabase(userId, mediaId, episode) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/otg_saves?anilist_user_id=eq.${userId}&media_id=eq.${mediaId}&episode=eq.${episode}&select=playback_time,source_url`;
    const res = await fetch(url, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
    const data = await res.json();
    
    if (data && data.length > 0) {
      return { time: data[0].playback_time, url: data[0].source_url };
    }
    return null;
  } catch (error) { return null; }
}

// UPDATED: Now accepts customTitle
async function saveOtgTimeToSupabase(userId, mediaId, episode, time, sourceUrl, customTitle = null) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/otg_saves?on_conflict=anilist_user_id,media_id,episode`;
    await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates' 
      },
      body: JSON.stringify({ 
        anilist_user_id: userId, 
        media_id: mediaId, 
        episode: episode, 
        playback_time: time,
        source_url: sourceUrl,
        custom_title: customTitle // NEW: Save the title for non-AniList manga
      })
    });
  } catch (error) {}
}

async function deleteOtgTimeFromSupabase(userId, mediaId, episode) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/otg_saves?anilist_user_id=eq.${userId}&media_id=eq.${mediaId}&episode=eq.${episode}`;
    await fetch(url, { method: 'DELETE', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
  } catch (error) {}
}

async function deleteOldEpisodesFromSupabase(userId, mediaId, currentEpisode) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/otg_saves?anilist_user_id=eq.${userId}&media_id=eq.${mediaId}&episode=lt.${currentEpisode}`;
    await fetch(url, { method: 'DELETE', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
  } catch (error) {}
}

async function findAniListMedia(tabTitle) {
  const storage = await chrome.storage.local.get(['anilistToken']);
  const token = storage.anilistToken;
  if (!token) return null;

  const regex = /(?:Watch\s+)?(.*?)\s*(?:[-|—–:~]+\s*)?(?:Season\s*\d+\s*)?(?:Episode|Ep|EP|E)\.?\s*0*(\d+)/i;
  const match = tabTitle.match(regex);
  if (!match || !match[1] || !match[2]) return null;

  let parsedTitle = match[1].replace(/[-|—–:~]+$/g, '').replace(/\s+\(?(?:Sub|Dub)\)?$/i, '').trim();
  const episode = parseInt(match[2], 10);

  // --- UPDATED: Added 'idMal' to the query so AniSkip can use it! ---
  const query = `
    query ($search: String) {
      Media (search: $search, type: ANIME, sort: SEARCH_MATCH) {
        id idMal title { romaji english } coverImage { large } episodes
        mediaListEntry { id progress status }
      }
    }
  `;

  async function doSearch(term) {
    const res = await apiRequest(query, { search: term }, token);
    return res.data?.Media || null;
  }

  let media = await doSearch(parsedTitle);
  if (!media) {
    let noBrackets = parsedTitle.replace(/\[.*?\]|\(.*?\)[^\w\s]*/g, '').trim();
    media = await doSearch(noBrackets);
    if (!media) {
      let noPunctuation = noBrackets.replace(/[?!,]/g, '').replace(/\s+/g, ' ').trim();
      media = await doSearch(noPunctuation);
      if (!media) {
         let splitTitle = parsedTitle.split(/[:\-]/)[0].trim();
         media = await doSearch(splitTitle);
      }
    }
  }

  return { media, episode, token };
}

// ==========================================
// ⚙️ THE MAIN PROCESSING ENGINE
// ==========================================

async function processAutoUpdate(tabTitle, tabId, trueWatchSeconds) {
  try {
    const result = await findAniListMedia(tabTitle);
    
    if (!result || !result.media) {
      chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
      chrome.action.setBadgeText({ text: 'ERR' });
      return;
    }

    const { media, episode, token } = result;
    const currentProg = media.mediaListEntry ? media.mediaListEntry.progress : 0;
    const animeName = media.title.english || media.title.romaji;
    let isCompleted = false; 

    if (currentProg < episode) {
      let newStatus = 'CURRENT';
      let startedAt = undefined;
      let completedAt = undefined;
      
      if (episode === 1 && currentProg === 0) startedAt = getTodayFuzzy();
      if (media.episodes && episode >= media.episodes) {
        newStatus = 'COMPLETED';
        completedAt = getTodayFuzzy();
        isCompleted = true; 
      }

      const mutation = `
        mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
          SaveMediaListEntry (mediaId: $mediaId, progress: $progress, status: $status, startedAt: $startedAt, completedAt: $completedAt) { id }
        }
      `;

      const variables = { mediaId: media.id, progress: episode, status: newStatus };
      if (startedAt) variables.startedAt = startedAt;
      if (completedAt) variables.completedAt = completedAt;

      try {
        await apiRequest(mutation, variables, token);
        // If successful, attempt to clear any offline queue items!
        processOfflineQueue(); 
      } catch (networkError) {
        // --- NEW: If AniList fails, push to our Offline Queue! ---
        queueFailedUpdate(media.id, episode, newStatus, token);
      }

      const userStorage = await chrome.storage.local.get(['anilistUserId']);
      if (userStorage.anilistUserId) {
        syncUserStatsToSupabase(userStorage.anilistUserId, trueWatchSeconds);
      }
      
    } else if (media.episodes && currentProg >= media.episodes) {
      isCompleted = true;
    }

    delete activeSessions[tabId];

    const userStorage = await chrome.storage.local.get(['anilistUserId']);
    if (userStorage.anilistUserId) {
      await deleteOtgTimeFromSupabase(userStorage.anilistUserId, media.id, episode);
    }

    chrome.action.setBadgeBackgroundColor({ color: '#4cca51' }); 
    chrome.action.setBadgeText({ text: '✓' });
    
    if (isCompleted) {
      chrome.tabs.sendMessage(tabId, {
        action: "SHOW_RATING_MODAL",
        mediaId: media.id,
        animeName: animeName
      }, { frameId: 0 });
    } else {
      chrome.tabs.sendMessage(tabId, {
        action: "SHOW_SUCCESS_TOAST",
        message: `${animeName} updated to Episode ${episode}!`
      }, { frameId: 0 }); 
    }

  } catch (error) {
    console.error("Auto-Update Process Failed:", error);
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
    chrome.action.setBadgeText({ text: 'ERR' });
  }
}

// --- NEW: MANGA SEARCHER ---
async function findAniListManga(cleanTitle, chapter) {
  const storage = await chrome.storage.local.get(['anilistToken']);
  const token = storage.anilistToken;
  if (!token) return null;

  // Added "status" to the requested Media fields
  const query = `
    query ($search: String) {
      Media (search: $search, type: MANGA, sort: SEARCH_MATCH) {
        id status title { romaji english } coverImage { large } chapters
        mediaListEntry { id progress status }
      }
    }
  `;

  try {
    const res = await apiRequest(query, { search: cleanTitle }, token);
    const media = res.data?.Media || null;
    return { media, chapter, token };
  } catch (e) {
    return null;
  }
}

// --- NEW: MANGA AUTO-UPDATE PROCESSOR ---
async function processMangaAutoUpdate(cleanTitle, chapter, tabId, trueReadSeconds) {
  try {
    const result = await findAniListManga(cleanTitle, chapter);
    
    if (!result || !result.media) {
      chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
      chrome.action.setBadgeText({ text: 'ERR' });
      return;
    }

    const { media, token } = result;
    const currentProg = media.mediaListEntry ? media.mediaListEntry.progress : 0;
    const mangaName = media.title.english || media.title.romaji;
    let isCompleted = false; 

    if (currentProg < chapter) {
      let newStatus = 'CURRENT';
      let startedAt = undefined;
      let completedAt = undefined;
      
      if (chapter === 1 && currentProg === 0) startedAt = getTodayFuzzy();
      
      // STRICT COMPLETION: Must reach final chapter AND series must be fully published
      if (media.chapters && chapter >= media.chapters && media.status === 'FINISHED') {
        newStatus = 'COMPLETED';
        completedAt = getTodayFuzzy();
        isCompleted = true; 
      }

      const mutation = `
        mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
          SaveMediaListEntry (mediaId: $mediaId, progress: $progress, status: $status, startedAt: $startedAt, completedAt: $completedAt) { id }
        }
      `;

      const variables = { mediaId: media.id, progress: chapter, status: newStatus };
      if (startedAt) variables.startedAt = startedAt;
      if (completedAt) variables.completedAt = completedAt;

      try {
        await apiRequest(mutation, variables, token);
        processOfflineQueue(); 
      } catch (networkError) {
        queueFailedUpdate(media.id, chapter, newStatus, token);
      }

      const userStorage = await chrome.storage.local.get(['anilistUserId']);
      if (userStorage.anilistUserId) {
        syncUserStatsToSupabase(userStorage.anilistUserId, trueReadSeconds);
      }
      
    } else if (media.chapters && currentProg >= media.chapters && media.status === 'FINISHED') {
      // Catch edge case where they reread the final chapter of a finished series
      isCompleted = true;
    }

    delete activeSessions[tabId];

    const userStorage = await chrome.storage.local.get(['anilistUserId']);
    if (userStorage.anilistUserId) {
      await deleteOtgTimeFromSupabase(userStorage.anilistUserId, media.id, chapter);
    }

    chrome.action.setBadgeBackgroundColor({ color: '#4cca51' }); 
    chrome.action.setBadgeText({ text: '✓' });
    
    if (isCompleted) {
      chrome.tabs.sendMessage(tabId, {
        action: "SHOW_RATING_MODAL",
        mediaId: media.id,
        animeName: mangaName
      }, { frameId: 0 });
    } else {
      chrome.tabs.sendMessage(tabId, {
        action: "SHOW_SUCCESS_TOAST",
        message: `${mangaName} updated to Chapter ${chapter}!`
      }, { frameId: 0 }); 
    }

  } catch (error) {
    console.error("Manga Auto-Update Process Failed:", error);
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
    chrome.action.setBadgeText({ text: 'ERR' });
  }
}

async function syncUserStatsToSupabase(userId, addedSeconds, isRetroactive = false) {
  if (!isRetroactive && (!addedSeconds || addedSeconds < 5)) return;

  try {
    const storage = await chrome.storage.local.get(['anilistUsername', 'anilistAvatar', 'timeSavedSeconds']);
    
    let currentSeconds = 0;
    let unlockedTrophies = [];
    let trackingData = {};

    const getUrl = `${SUPABASE_URL}/rest/v1/user_stats?anilist_user_id=eq.${userId}&select=true_watch_seconds,unlocked_achievements,tracking_data`;
    const getRes = await fetch(getUrl, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
    const data = await getRes.json();
    
    if (data && data.length > 0) {
      currentSeconds = data[0].true_watch_seconds || 0;
      unlockedTrophies = data[0].unlocked_achievements || [];
      trackingData = data[0].tracking_data || {};
    }

    const totalSeconds = currentSeconds + addedSeconds;
    const totalMinutes = totalSeconds / 60;
    let newLevel = Math.floor(1 + 99 * Math.sqrt(totalMinutes / 500000));
    if (newLevel > 100) newLevel = 100;

    const todayStr = new Date().toDateString();
    
    if (trackingData.last_watch_date === todayStr) {
      trackingData.episodes_today = (trackingData.episodes_today || 0) + 1;
    } else {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      if (trackingData.last_watch_date === yesterday.toDateString()) {
        trackingData.streak = (trackingData.streak || 0) + 1;
      } else {
        trackingData.streak = 1; 
      }
      trackingData.episodes_today = 1;
      trackingData.last_watch_date = todayStr;
    }
    
    trackingData.total_time_saved = (trackingData.total_time_saved || 0) + (storage.timeSavedSeconds || 0);
    await chrome.storage.local.set({ timeSavedSeconds: 0 }); 
    trackingData.total_episodes_tracked = (trackingData.total_episodes_tracked || 0) + 1;

    if (isRetroactive) trackingData.has_synced_history = true;

    let newlyUnlocked = [];
    const currentStats = {
      totalEpisodesTracked: trackingData.total_episodes_tracked || 0,
      episodesToday: trackingData.episodes_today || 0,
      streak: trackingData.streak || 0,
      timeSavedSeconds: trackingData.total_time_saved || 0,
      trueWatchSeconds: totalSeconds,
      level: newLevel,
      hourOfDay: new Date().getHours(),
      dayOfWeek: new Date().getDay(),
      completedSeries: trackingData.completed_series || 0, 
      ratingsSubmitted: trackingData.ratings_submitted || 0  
    };

    ACHIEVEMENTS.forEach(achievement => {
      if (!unlockedTrophies.includes(achievement.id) && achievement.check(currentStats)) {
        newlyUnlocked.push(achievement.id);
      }
    });

    if (newlyUnlocked.length > 0) {
      unlockedTrophies = [...unlockedTrophies, ...newlyUnlocked];
      console.log("🏆 Achievements Unlocked:", newlyUnlocked);
    }

    const upsertUrl = `${SUPABASE_URL}/rest/v1/user_stats?on_conflict=anilist_user_id`;
    await fetch(upsertUrl, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        anilist_user_id: userId,
        username: storage.anilistUsername || "Unknown",
        avatar_url: storage.anilistAvatar || "",
        true_watch_seconds: totalSeconds,
        level: newLevel,
        unlocked_achievements: unlockedTrophies,
        tracking_data: trackingData
      })
    });
  } catch (error) { console.error("Sync Failed:", error); }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  const session = activeSessions[tabId];
  if (session) {
    // Pass the saved session.url to the Supabase function
    saveOtgTimeToSupabase(session.userId, session.mediaId, session.episode, session.time, session.url);
    delete activeSessions[tabId];
  }
});


// ==========================================
// 📡 THE MESSAGE LISTENER
// ==========================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender && sender.tab && !sender.tab.active) {
    sendResponse({ otgTime: null });
    return false; 
  }

  // 1. AUTO-UPDATE (ANIME)
  if (message.action === "AUTO_UPDATE_ANIME") {
    processAutoUpdate(sender.tab.title, sender.tab.id, message.trueWatchSeconds || 0);
    sendResponse({ success: true }); 
    return false; 
  } 
  
  // --- NEW: 1b. AUTO-UPDATE (MANGA) ---
  else if (message.action === "AUTO_UPDATE_MANGA") {
    processMangaAutoUpdate(message.cleanTitle, message.chapter, sender.tab.id, message.trueReadSeconds || 0);
    sendResponse({ success: true }); 
    return false; 
  }

  // --- LIVE MANGA PROGRESS & BADGE TRACKER ---
  else if (message.action === "LIVE_MANGA_PROGRESS") {
    // 1. Badge Updates
    chrome.action.setBadgeBackgroundColor({ color: message.isCompleted ? '#4cca51' : '#3db4f2' });
    if (message.readingType === 'page') {
      chrome.action.setBadgeText({ text: `${message.progress}` }); 
    } else if (message.readingType === 'scroll') {
      chrome.action.setBadgeText({ text: `${Math.floor(message.pct)}%` }); 
    } else {
      if (message.isCompleted) chrome.action.setBadgeText({ text: '✓' });
      else chrome.action.setBadgeText({ text: '...' });
    }
    
    // 2. OTG Database Saving Logic
    if (message.isOtgLoaded === false && message.parsedTitle && message.chapter !== null) {
      (async () => {
        try {
          const query = `query ($search: String) { Media (search: $search, type: MANGA, sort: SEARCH_MATCH) { id } }`;
          let storage = await chrome.storage.local.get(['anilistToken', 'anilistUserId']);
          if (!storage.anilistToken || !storage.anilistUserId) return sendResponse({ otgTime: null });

          const res = await apiRequest(query, { search: message.parsedTitle }, storage.anilistToken);
          const media = res.data?.Media;

          // NEW: Fallback Logic
          let mediaId;
          let isCustom = false;
          let customTitle = null;

          if (media) {
            mediaId = media.id;
          } else {
            // Generate a negative ID and flag it as custom!
            mediaId = hashStringToNegativeInt(message.parsedTitle);
            isCustom = true;
            customTitle = message.parsedTitle;
          }

          const episode = message.chapter;
          const cacheKey = `${storage.anilistUserId}_${mediaId}_${episode}_manga`;

          deleteOldEpisodesFromSupabase(storage.anilistUserId, mediaId, episode);
          lastSaveTimes[cacheKey] = Date.now(); 
          
          const savedData = await getOtgTimeFromSupabase(storage.anilistUserId, mediaId, episode);
          const savedTime = savedData ? savedData.time : null;
          const savedUrl = savedData ? savedData.url : null;

          sendResponse({ 
            otgTime: savedTime, 
            otgUrl: savedUrl, 
            // Pass the custom flags down to content.js
            resolvedData: { userId: storage.anilistUserId, mediaId, episode, cacheKey, isCustom, customTitle } 
          });

        } catch (error) { sendResponse({ otgTime: null }); }
      })();
      return true; 
      
    } else if (message.resolvedData) {
      // NEW: Extract customTitle from the resolved data
      const { userId, mediaId, episode, cacheKey, customTitle } = message.resolvedData;
      const now = Date.now();
      const tabUrl = sender.tab ? sender.tab.url : null;
      
      const saveValue = message.readingType === 'scroll' ? message.pct : (message.readingType === 'page' ? message.progress : 0);

      if (!message.isCompleted) {
        if (sender.tab && sender.tab.id) {
          activeSessions[sender.tab.id] = { userId, mediaId, episode, time: saveValue, url: tabUrl };
        }
        
        if (!lastSaveTimes[cacheKey] || now - lastSaveTimes[cacheKey] > 5000) {
          lastSaveTimes[cacheKey] = now;
          // Pass the custom title into the save function
          saveOtgTimeToSupabase(userId, mediaId, episode, saveValue, tabUrl, customTitle);
        }
      }
      sendResponse({ otgTime: null });
      return false; 
    }
    
    sendResponse({ success: true });
    return false;
  }

  // --- 3. NEW: THE ANISKIP NETWORK FETCHER (OP & ED) ---
  else if (message.action === "FETCH_ANISKIP") {
    // We now fetch BOTH Opening (op) and Ending (ed) times!
    const url = `https://api.aniskip.com/v2/skip-times/${message.malId}/${message.episode}?types=op&types=ed&episodeLength=0`;
    
    fetch(url)
      .then(res => res.json())
      .then(data => sendResponse(data))
      .catch(err => sendResponse({ found: false }));
    return true; 
  }
  
  // 4. SAVE SCORE MODAL
  else if (message.action === "SAVE_ANIME_SCORE") {
    const mutation = `mutation ($mediaId: Int, $scoreRaw: Int) { SaveMediaListEntry(mediaId: $mediaId, scoreRaw: $scoreRaw) { id score } }`;
    chrome.storage.local.get(['anilistToken'], async (res) => {
      if (res.anilistToken) {
        try {
          await apiRequest(mutation, { mediaId: message.mediaId, scoreRaw: message.score }, res.anilistToken);
          sendResponse({ success: true });
        } catch (error) { sendResponse({ success: false }); }
      } else { sendResponse({ success: false }); }
    });
    return true; 
  }

  // 5. RETROACTIVE HISTORY SYNC
  else if (message.action === "SYNC_PAST_HISTORY") {
    chrome.storage.local.get(['anilistToken', 'anilistUserId'], async (res) => {
      if (!res.anilistToken || !res.anilistUserId) {
        sendResponse({ success: false });
        return;
      }
      const query = `query ($userId: Int) { MediaListCollection(userId: $userId, type: ANIME) { lists { entries { progress media { format duration episodes } } } } }`;
      try {
        const response = await apiRequest(query, { userId: res.anilistUserId }, res.anilistToken);
        let totalRetroMinutes = 0;
        response.data.MediaListCollection.lists.forEach(list => {
          list.entries.forEach(entry => {
            const eps = entry.progress || 0;
            const dur = entry.media.duration || 24; 
            let deduction = 3; 
            if (entry.media.format === 'MOVIE') deduction = 0;
            else if (dur < 12) deduction = 1.5;
            let trueDur = dur - deduction;
            if (trueDur < 1) trueDur = dur; 
            totalRetroMinutes += (trueDur * eps);
          });
        });
        const totalRetroSeconds = totalRetroMinutes * 60;
        await syncUserStatsToSupabase(res.anilistUserId, totalRetroSeconds, true);
        sendResponse({ success: true, minutes: totalRetroMinutes });
      } catch (e) { sendResponse({ success: false }); }
    });
    return true; 
  }
  
  return false; 
});

// ==========================================
// 🔔 AIRING NOTIFICATIONS ENGINE
// ==========================================

async function checkForNewEpisodes() {
  const storage = await chrome.storage.local.get(['anilistToken', 'anilistUserId', 'lastNotifiedEpisodes']);
  if (!storage.anilistToken || !storage.anilistUserId) return;

  // Query AniList for shows the user is currently watching
  const query = `
    query ($userId: Int) {
      MediaListCollection(userId: $userId, type: ANIME, status: CURRENT) {
        lists {
          entries {
            media {
              id title { romaji english }
              nextAiringEpisode { airingAt episode }
            }
          }
        }
      }
    }
  `;

  try {
    const res = await apiRequest(query, { userId: storage.anilistUserId }, storage.anilistToken);
    const lists = res.data?.MediaListCollection?.lists || [];
    if (lists.length === 0) return;
    
    const entries = lists[0].entries || [];
    let lastNotified = storage.lastNotifiedEpisodes || {}; // Cache to prevent spamming notifications
    let newlyAired = [];

    const nowSeconds = Math.floor(Date.now() / 1000);

    entries.forEach(entry => {
      const media = entry.media;
      if (media.nextAiringEpisode) {
        const airTime = media.nextAiringEpisode.airingAt;
        const epNum = media.nextAiringEpisode.episode;
        
        // Check if the episode aired in the past 2 hours
        if (nowSeconds >= airTime && (nowSeconds - airTime) < 7200) {
          const cacheKey = `${media.id}_${epNum}`;
          
          // If we haven't already notified the user for this exact episode, queue it up!
          if (!lastNotified[cacheKey]) {
            newlyAired.push({ title: media.title.english || media.title.romaji, episode: epNum });
            lastNotified[cacheKey] = true;
          }
        }
      }
    });

    // Fire the native desktop notifications
    if (newlyAired.length > 0) {
      await chrome.storage.local.set({ lastNotifiedEpisodes: lastNotified });
      
      newlyAired.forEach(anime => {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png', // Ensure this file exists in your icons folder!
          title: 'New Episode Available! 🍿',
          message: `Episode ${anime.episode} of ${anime.title} just finished airing in Japan.`
        });
      });
    }
  } catch(error) {
    console.error("[Notifications Engine] Failed to fetch schedule:", error);
  }
}