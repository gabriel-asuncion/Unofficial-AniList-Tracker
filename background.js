// background.js
importScripts('config.js', 'achievements.js');

let lastSaveTimes = {}; 
let activeSessions = {}; 

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

// --- Supabase REST API Helpers ---
async function getOtgTimeFromSupabase(userId, mediaId, episode) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/otg_saves?anilist_user_id=eq.${userId}&media_id=eq.${mediaId}&episode=eq.${episode}&select=playback_time`;
    const res = await fetch(url, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
    const data = await res.json();
    if (data && data.length > 0) return data[0].playback_time;
    return null;
  } catch (error) { return null; }
}

async function saveOtgTimeToSupabase(userId, mediaId, episode, time) {
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
      body: JSON.stringify({ anilist_user_id: userId, media_id: mediaId, episode: episode, playback_time: time })
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

  const query = `
    query ($search: String) {
      Media (search: $search, type: ANIME, sort: SEARCH_MATCH) {
        id title { romaji english } coverImage { large } episodes
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender && sender.tab && !sender.tab.active) {
    sendResponse({ otgTime: null });
    return false; 
  }

  if (message.action === "AUTO_UPDATE_ANIME") {
    // PASS TRUE WATCH SECONDS TO THE PROCESSOR
    processAutoUpdate(sender.tab.title, sender.tab.id, message.trueWatchSeconds || 0);
    sendResponse({ success: true }); 
    return false; 

  } else if (message.action === "LIVE_VIDEO_PROGRESS") {
    
    const dynamicThreshold = message.threshold || 80;
    const currentPct = Math.floor(message.progress);
    
    if (!message.hasTriggeredUpdate) {
      if (currentPct > 0 && currentPct < dynamicThreshold) {
        chrome.action.setBadgeBackgroundColor({ color: '#3db4f2' }); 
        chrome.action.setBadgeText({ text: `${currentPct}%` }); 
      } else if (currentPct >= dynamicThreshold) {
        chrome.action.setBadgeBackgroundColor({ color: '#f39c12' }); 
        chrome.action.setBadgeText({ text: `...` }); 
      }
    }

    if (message.isOtgLoaded === false && sender.tab && sender.tab.title) {
      (async () => {
        try {
          const result = await findAniListMedia(sender.tab.title);
          let storage = await chrome.storage.local.get(['anilistUserId']);
          let userId = storage.anilistUserId;

          if (!userId && result && result.token) {
            try {
              const viewerData = await apiRequest(`query { Viewer { id } }`, {}, result.token);
              userId = viewerData.data?.Viewer?.id;
              if (userId) await chrome.storage.local.set({ anilistUserId: userId });
            } catch(e) {}
          }

          if (result && result.media && userId) {
            const mediaId = result.media.id;
            const episode = result.episode;
            const cacheKey = `${userId}_${mediaId}_${episode}`;

            deleteOldEpisodesFromSupabase(userId, mediaId, episode);

            lastSaveTimes[cacheKey] = Date.now(); 
            
            const savedTime = await getOtgTimeFromSupabase(userId, mediaId, episode);

            if (savedTime && savedTime > 10) {
              sendResponse({ otgTime: savedTime, resolvedData: { userId, mediaId, episode, cacheKey } });
            } else {
              sendResponse({ otgTime: null, resolvedData: { userId, mediaId, episode, cacheKey } });
            }
          } else {
            sendResponse({ otgTime: null });
          }
        } catch (error) {
          sendResponse({ otgTime: null }); 
        }
      })();
      return true; 
      
    } else if (message.resolvedData) {
      const { userId, mediaId, episode, cacheKey } = message.resolvedData;
      const now = Date.now();
      
      if (!message.hasTriggeredUpdate) {
        if (sender.tab && sender.tab.id) {
          activeSessions[sender.tab.id] = { userId, mediaId, episode, time: message.currentTime };
        }
        
        if (!lastSaveTimes[cacheKey] || now - lastSaveTimes[cacheKey] > 5000) {
          lastSaveTimes[cacheKey] = now;
          saveOtgTimeToSupabase(userId, mediaId, episode, message.currentTime);
        }
      }
      sendResponse({ otgTime: null });
      return false; 
      
    } else {
      sendResponse({ otgTime: null });
      return false; 
    }
    
  } else if (message.action === "SAVE_ANIME_SCORE") {
    const mutation = `mutation ($mediaId: Int, $scoreRaw: Int) { SaveMediaListEntry(mediaId: $mediaId, scoreRaw: $scoreRaw) { id score } }`;
    chrome.storage.local.get(['anilistToken'], async (res) => {
      if (res.anilistToken) {
        try {
          await apiRequest(mutation, { mediaId: message.mediaId, scoreRaw: message.score }, res.anilistToken);
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false });
        }
      } else {
        sendResponse({ success: false });
      }
    });
    return true; 
  }
  
  return false; 
});

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

      // SYNTAX BUG FIXED: Variables defined only once!
      const variables = { mediaId: media.id, progress: episode, status: newStatus };
      if (startedAt) variables.startedAt = startedAt;
      if (completedAt) variables.completedAt = completedAt;

      await apiRequest(mutation, variables, token);

      // LEADERBOARD SYNC
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

chrome.tabs.onRemoved.addListener((tabId) => {
  const session = activeSessions[tabId];
  if (session) {
    saveOtgTimeToSupabase(session.userId, session.mediaId, session.episode, session.time);
    delete activeSessions[tabId];
  }
});

// --- UPDATED: Advanced Leveling Math, JSON Sync & Achievement Engine ---
async function syncUserStatsToSupabase(userId, addedSeconds, isRetroactive = false) {
  if (!isRetroactive && (!addedSeconds || addedSeconds < 5)) { // (Set to 5s for testing, change to 180s later)
    console.log(`[Anti-Cheat] Ignored ${addedSeconds}s. Too short.`);
    return;
  }

  try {
    const storage = await chrome.storage.local.get(['anilistUsername', 'anilistAvatar', 'timeSavedSeconds']);
    
    // 1. Fetch current data from Supabase
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

    // 2. Process XP & Level
    const totalSeconds = currentSeconds + addedSeconds;
    const totalMinutes = totalSeconds / 60;
    let newLevel = Math.floor(1 + 99 * Math.sqrt(totalMinutes / 500000));
    if (newLevel > 100) newLevel = 100;

    // 3. Update Tracking JSON (Daily Streaks & Episode Counts)
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

    // --- NEW: Cloud Toggle for the Sync Button ---
    if (isRetroactive) {
      trackingData.has_synced_history = true;
    }

    // 4. CHECK ACHIEVEMENTS (Dynamic Array Loop)
    let newlyUnlocked = [];

    // Bundle all the current stats into one object for the checker functions
    const currentStats = {
      totalEpisodesTracked: trackingData.total_episodes_tracked || 0,
      episodesToday: trackingData.episodes_today || 0,
      streak: trackingData.streak || 0,
      timeSavedSeconds: trackingData.total_time_saved || 0,
      trueWatchSeconds: totalSeconds,
      level: newLevel,
      hourOfDay: new Date().getHours(),
      dayOfWeek: new Date().getDay(),
      completedSeries: trackingData.completed_series || 0, // NEW: Tracked locally in JSON
      ratingsSubmitted: trackingData.ratings_submitted || 0  // NEW: Tracked locally in JSON
    };

    // Loop through our achievements.js dictionary
    ACHIEVEMENTS.forEach(achievement => {
      // If they don't have it yet, and they meet the conditions...
      if (!unlockedTrophies.includes(achievement.id) && achievement.check(currentStats)) {
        newlyUnlocked.push(achievement.id);
      }
    });

    // Merge new trophies
    if (newlyUnlocked.length > 0) {
      unlockedTrophies = [...unlockedTrophies, ...newlyUnlocked];
      console.log("🏆 Achievements Unlocked:", newlyUnlocked);
      
      // Optional: You can send a message to content.js here to show a specific Achievement UI Toast!
    }

    // 5. Save everything back to Supabase in ONE single network request!
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
    console.log(`[Cloud Sync] Level: ${newLevel} | Streak: ${trackingData.streak} | Eps Today: ${trackingData.episodes_today}`);
  } catch (error) { console.error("Sync Failed:", error); }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 1. Ignore inactive tabs
  if (sender && sender.tab && !sender.tab.active) {
    sendResponse({ otgTime: null });
    return false; 
  }

  // 2. Handle Auto-Updates
  if (message.action === "AUTO_UPDATE_ANIME") {
    processAutoUpdate(sender.tab.title, sender.tab.id, message.trueWatchSeconds || 0);
    sendResponse({ success: true }); 
    return false; 
  } 
  
  // 3. Handle Live Progress Updates
  else if (message.action === "LIVE_VIDEO_PROGRESS") {
    const dynamicThreshold = message.threshold || 80;
    const currentPct = Math.floor(message.progress);
    
    if (!message.hasTriggeredUpdate) {
      if (currentPct > 0 && currentPct < dynamicThreshold) {
        chrome.action.setBadgeBackgroundColor({ color: '#3db4f2' }); 
        chrome.action.setBadgeText({ text: `${currentPct}%` }); 
      } else if (currentPct >= dynamicThreshold) {
        chrome.action.setBadgeBackgroundColor({ color: '#f39c12' }); 
        chrome.action.setBadgeText({ text: `...` }); 
      }
    }

    if (message.isOtgLoaded === false && sender.tab && sender.tab.title) {
      (async () => {
        try {
          const result = await findAniListMedia(sender.tab.title);
          let storage = await chrome.storage.local.get(['anilistUserId']);
          let userId = storage.anilistUserId;

          if (!userId && result && result.token) {
            try {
              const viewerData = await apiRequest(`query { Viewer { id } }`, {}, result.token);
              userId = viewerData.data?.Viewer?.id;
              if (userId) await chrome.storage.local.set({ anilistUserId: userId });
            } catch(e) {}
          }

          if (result && result.media && userId) {
            const mediaId = result.media.id;
            const episode = result.episode;
            const cacheKey = `${userId}_${mediaId}_${episode}`;

            deleteOldEpisodesFromSupabase(userId, mediaId, episode);

            lastSaveTimes[cacheKey] = Date.now(); 
            const savedTime = await getOtgTimeFromSupabase(userId, mediaId, episode);

            if (savedTime && savedTime > 10) {
              sendResponse({ otgTime: savedTime, resolvedData: { userId, mediaId, episode, cacheKey } });
            } else {
              sendResponse({ otgTime: null, resolvedData: { userId, mediaId, episode, cacheKey } });
            }
          } else {
            sendResponse({ otgTime: null });
          }
        } catch (error) {
          sendResponse({ otgTime: null }); 
        }
      })();
      return true; // Keep channel open
      
    } else if (message.resolvedData) {
      const { userId, mediaId, episode, cacheKey } = message.resolvedData;
      const now = Date.now();
      
      if (!message.hasTriggeredUpdate) {
        if (sender.tab && sender.tab.id) {
          activeSessions[sender.tab.id] = { userId, mediaId, episode, time: message.currentTime };
        }
        
        if (!lastSaveTimes[cacheKey] || now - lastSaveTimes[cacheKey] > 5000) {
          lastSaveTimes[cacheKey] = now;
          saveOtgTimeToSupabase(userId, mediaId, episode, message.currentTime);
        }
      }
      sendResponse({ otgTime: null });
      return false; 
    } 
    return false;
  } 
  
  // 4. Handle Score Saving
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

  // 5. MERGED: Handle Retroactive Sync!
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
    return true; // Keep channel open
  }
  
  return false; // Fallback
});