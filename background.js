// background.js
importScripts('config.js', 'achievements.js');

let activeSessions = {};
let lastSaveTimes = {};

async function getSessionData(key, defaultVal = {}) {
  const res = await chrome.storage.session.get([key]);
  return res[key] || defaultVal;
}

async function setSessionData(key, value) {
  await chrome.storage.session.set({ [key]: value });
}

// ==========================================
// 🚀 THE OFFLINE QUEUE SYSTEM
// ==========================================

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "processOfflineQueue") {
    processOfflineQueue();
  } else if (alarm.name === "airingCheck") {
    checkForNewEpisodes(); 
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("processOfflineQueue", { periodInMinutes: 15 });
  chrome.alarms.create("airingCheck", { periodInMinutes: 30 }); 
});

// background.js - Targeted Fixes for the Offline Queue

async function queueFailedUpdate(mediaId, progress, status, token) {
  const res = await chrome.storage.local.get(['offlineQueue']);
  let offlineQueue = res.offlineQueue || [];
  
  // 1. Deduplication: Find if this anime is already in the offline queue
  const existingIndex = offlineQueue.findIndex(item => item.mediaId === mediaId);
  
  if (existingIndex > -1) {
    // Only update it if the new progress is higher than the queued one
    if (progress > offlineQueue[existingIndex].progress) {
      offlineQueue[existingIndex] = { mediaId, progress, status, token, timestamp: Date.now() };
      console.log(`[Offline Queue] Updated Media ${mediaId} to higher progress ${progress}.`);
    }
  } else {
    // Not in queue, add it fresh
    offlineQueue.push({ mediaId, progress, status, token, timestamp: Date.now() });
    console.log(`[Offline Queue] Saved Media ${mediaId} Ep/Ch ${progress} for later.`);
  }
  
  await chrome.storage.local.set({ offlineQueue });
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
      console.log(`[Offline Queue] Success! Synced Media ${item.mediaId} Progress ${item.progress}`);
    } catch (e) {
      console.log(`[Offline Queue] Still offline. Keeping Media ${item.mediaId} in queue.`);
      remainingQueue.push(item);
    }
    
    // ✅ ADDED: 1-second delay between batch requests to respect rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  await chrome.storage.local.set({ offlineQueue: remainingQueue });
}

// ==========================================
// 🌐 CORE NETWORK HELPERS
// ==========================================

async function apiRequest(query, variables, token) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ query, variables })
  });
  return response.json();
}

function getTodayFuzzy() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

// ==========================================
// 🌐 MAL API ADAPTER
// ==========================================

async function malApiRequest(endpoint, method = 'GET', data = null, token) {
  const options = {
    method: method,
    headers: { 'Authorization': `Bearer ${token}` }
  };
  
  if (data && method !== 'GET') {
    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    options.body = new URLSearchParams(data).toString();
  }
  
  const response = await fetch(`https://api.myanimelist.net/v2/${endpoint}`, options);
  if (!response.ok) throw new Error(`MAL API Error: ${response.status}`);
  return response.json();
}

function standardizeMalMedia(malNode, listStatus, type) {
  let standardStatus = 'PLANNING';
  if (listStatus) {
    if (listStatus.status === 'watching' || listStatus.status === 'reading') standardStatus = 'CURRENT';
    else if (listStatus.status === 'completed') standardStatus = 'COMPLETED';
    else if (listStatus.status === 'on_hold') standardStatus = 'PAUSED';
    else if (listStatus.status === 'dropped') standardStatus = 'DROPPED';
    else if (listStatus.status === 'plan_to_watch' || listStatus.status === 'plan_to_read') standardStatus = 'PLANNING';
  }

  return {
    id: -malNode.id,
    idMal: malNode.id,
    isMalOnly: true,
    status: malNode.status ? malNode.status.toUpperCase() : "RELEASING",
    title: { 
      romaji: malNode.title, 
      english: malNode.alternative_titles?.en || malNode.title 
    },
    coverImage: { 
      large: malNode.main_picture?.large || '', 
      medium: malNode.main_picture?.medium || '' 
    },
    episodes: type === 'ANIME' ? (malNode.num_episodes || null) : null,
    chapters: type === 'MANGA' ? (malNode.num_chapters || null) : null,
    mediaListEntry: listStatus ? {
      id: malNode.id,
      progress: type === 'ANIME' ? listStatus.num_episodes_watched : listStatus.num_chapters_read,
      status: standardStatus,
      score: listStatus.score || 0
    } : null
  };
}

async function updateMalProgress(malId, progress, status, type, token) {
  const endpoint = type === 'ANIME' ? `anime/${malId}/my_list_status` : `manga/${malId}/my_list_status`;
  
  let malStatus = 'plan_to_watch';
  if (type === 'MANGA') {
    if (status === 'CURRENT') malStatus = 'reading';
    else if (status === 'COMPLETED') malStatus = 'completed';
    else if (status === 'PAUSED') malStatus = 'on_hold';
    else if (status === 'DROPPED') malStatus = 'dropped';
    else malStatus = 'plan_to_read';
  } else {
    if (status === 'CURRENT') malStatus = 'watching';
    else if (status === 'COMPLETED') malStatus = 'completed';
    else if (status === 'PAUSED') malStatus = 'on_hold';
    else if (status === 'DROPPED') malStatus = 'dropped';
  }

  const payload = { status: malStatus };
  if (type === 'ANIME') payload.num_watched_episodes = progress;
  if (type === 'MANGA') payload.num_chapters_read = progress;

  return await safeMalApiRequest(endpoint, 'PUT', payload, token);
}

async function refreshMalToken() {
  const storage = await chrome.storage.local.get(['malRefreshToken']);
  if (!storage.malRefreshToken) return null;

  try {
    const response = await fetch('https://myanimelist.net/v1/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: SECOND_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: storage.malRefreshToken
      })
    });

    const data = await response.json();
    if (data.access_token) {
      await chrome.storage.local.set({
        malToken: data.access_token,
        malRefreshToken: data.refresh_token
      });
      return data.access_token;
    }
    return null;
  } catch (error) {
    console.error("Failed to refresh MAL token:", error);
    return null;
  }
}

async function safeMalApiRequest(endpoint, method = 'GET', data = null, token) {
  try {
    return await malApiRequest(endpoint, method, data, token);
  } catch (error) {
    if (error.message.includes('401')) {
      console.log("MAL token expired. Attempting refresh...");
      const newToken = await refreshMalToken();
      if (newToken) {
        return await malApiRequest(endpoint, method, data, newToken);
      }
    }
    throw error;
  }
}

function hashStringToNegativeInt(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; 
  }
  return -Math.abs(hash || 999999);
}

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

async function saveOtgTimeToSupabase(userId, mediaId, episode, time, sourceUrl, customTitle = null, platform = 'ANILIST') {
  try {
    const url = `${SUPABASE_URL}/rest/v1/otg_saves?on_conflict=anilist_user_id,media_id,episode`;
    const res = await fetch(url, {
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
        playback_time: Math.round(time), // ✅ Safety: Convert to integer
        source_url: sourceUrl,
        custom_title: customTitle,
        platform: platform
      })
    });
    
    // ✅ Add error logging so we can see if Supabase rejects it
    if (!res.ok) {
      const errorText = await res.text();
      console.error("[OTG Save Error] Supabase rejected the update:", res.status, errorText);
    }
  } catch (error) {
    console.error("[OTG Save Error] Network failure:", error);
  }
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

  const regex = /(?:Watch\s+)?(.*?)\s*(?:[-|—–:~]+\s*)?(?:Season\s*\d+\s*)?\b(?:Episode|Ep)\b\.?\s*0*(\d+)/i;
  const match = tabTitle.match(regex);
  if (!match || !match[1] || !match[2]) return null;

  let parsedTitle = match[1].replace(/[-|—–:~]+$/g, '').replace(/\s+\(?(?:Sub|Dub)\)?$/i, '').trim();
  const episode = parseInt(match[2], 10);

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

async function processAutoUpdate(tabTitle, tabId, trueWatchSeconds, frameId = 0) {
  try {
    const result = await findAniListMedia(tabTitle);
    
    if (!result || !result.media) {
      chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
      chrome.action.setBadgeText({ text: 'ERR' });
      return;
    }

    const { media, episode, token } = result;
    const intEpisode = Math.floor(episode);
    
    const currentProg = media.mediaListEntry ? media.mediaListEntry.progress : 0;
    const animeName = media.title.english || media.title.romaji;
    let isCompleted = false; 
    let xpData = null; // ✅ FIX: Declared at top level of try-block

    const storage = await chrome.storage.local.get(['anilistUserId', 'malToken']);
    let updatedPlatforms = [];

    if (currentProg < intEpisode) {
      let newStatus = 'CURRENT';
      let startedAt = undefined;
      let completedAt = undefined;
      
      if (intEpisode === 1 && currentProg === 0) startedAt = getTodayFuzzy();
      if (media.episodes && intEpisode >= media.episodes) {
        newStatus = 'COMPLETED';
        completedAt = getTodayFuzzy();
        isCompleted = true; 
      }

      try {
        const mutation = `
          mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
            SaveMediaListEntry (mediaId: $mediaId, progress: $progress, status: $status, startedAt: $startedAt, completedAt: $completedAt) { id }
          }
        `;
        const variables = { mediaId: media.id, progress: intEpisode, status: newStatus };
        if (startedAt) variables.startedAt = startedAt;
        if (completedAt) variables.completedAt = completedAt;

        await apiRequest(mutation, variables, token);
        updatedPlatforms.push("AniList");
        
        chrome.storage.local.get(['full_watchlist_cache'], (res) => {
            if (res.full_watchlist_cache && res.full_watchlist_cache.data) {
                const entry = res.full_watchlist_cache.data.find(e => e.media.id === media.id);
                if (entry) {
                    entry.progress = intEpisode;
                    entry.status = newStatus;
                } else {
                    res.full_watchlist_cache.data.push({ progress: intEpisode, status: newStatus, media: media });
                }
                chrome.storage.local.set({ full_watchlist_cache: res.full_watchlist_cache });
            }
            setTimeout(() => chrome.storage.local.set({ trigger_dom_refresh: Date.now() }), 500);
        });
        processOfflineQueue();
      } catch (networkError) {
        queueFailedUpdate(media.id, intEpisode, newStatus, token);
      }

      let malIdToUse = media.idMal;
      if (!malIdToUse && storage.malToken) {
        try {
          const officialTitle = media.title.english || media.title.romaji;
          const malSearch = await malApiRequest(`anime?q=${encodeURIComponent(officialTitle)}&limit=1`, 'GET', null, storage.malToken);
          if (malSearch.data?.length > 0) malIdToUse = malSearch.data[0].node.id;
        } catch(e) {}
      }

      if (malIdToUse && storage.malToken) {
        try {
          await updateMalProgress(malIdToUse, intEpisode, newStatus, 'ANIME', storage.malToken);
          updatedPlatforms.push("MAL");
        } catch (e) {
          console.error("MAL Dual-Sync Failed:", e);
        }
      }

      if (storage.anilistUserId) {
        xpData = await syncUserStatsToSupabase(storage.anilistUserId, trueWatchSeconds);
      }
      
    } else if (media.episodes && currentProg >= media.episodes) {
      isCompleted = true;
    }

    if (activeSessions[tabId]) {
      delete activeSessions[tabId];
    }

    if (storage.anilistUserId) {
      await deleteOtgTimeFromSupabase(storage.anilistUserId, media.id, intEpisode);
    }

    chrome.action.setBadgeBackgroundColor({ color: '#4cca51' }); 
    chrome.action.setBadgeText({ text: '✓' });
    
    let platformText = updatedPlatforms.length > 1 ? "both AniList & MAL" : (updatedPlatforms[0] || "API");
    let toastMessage = `${animeName} updated to Episode ${intEpisode} on ${platformText}!`;
    
    if (updatedPlatforms.length === 0 && currentProg >= intEpisode) {
        toastMessage = `${animeName} is already at Episode ${intEpisode}!`;
    }

    if (isCompleted) {
      chrome.tabs.sendMessage(tabId, { action: "SHOW_RATING_MODAL", mediaId: media.id, malId: media.idMal, isMalOnly: media.isMalOnly, animeName: animeName, mediaType: 'ANIME' }, { frameId: frameId }).catch(() => {});
    } else if (updatedPlatforms.length > 0) {
      chrome.tabs.sendMessage(tabId, { action: "SHOW_SUCCESS_TOAST", message: toastMessage, xpData: xpData }, { frameId: frameId }).catch(() => {}); 
    }

  } catch (error) {
    console.error("Auto-Update Process Failed:", error);
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
    chrome.action.setBadgeText({ text: 'ERR' });
  }
}

// --- UNIFIED MANGA SEARCHER ---
async function findUnifiedManga(cleanTitle, chapter) {
  const storage = await chrome.storage.local.get(['anilistToken', 'malToken']);
  
  // 1. Try AniList First
  if (storage.anilistToken) {
    const aniQuery = `
      query ($search: String) {
        Media (search: $search, type: MANGA, sort: SEARCH_MATCH) {
          id idMal status title { romaji english } coverImage { large } chapters
          mediaListEntry { id progress status }
        }
      }
    `;
    try {
      const aniRes = await apiRequest(aniQuery, { search: cleanTitle }, storage.anilistToken);
      if (aniRes.data?.Media) {
        let foundMedia = aniRes.data.Media;
        
        // Robust MAL Fallback if AniList lacks idMal mapping
        if (!foundMedia.idMal && storage.malToken) {
          try {
            const officialTitle = foundMedia.title.english || foundMedia.title.romaji;
            let malSearch = await malApiRequest(`manga?q=${encodeURIComponent(officialTitle)}&limit=1`, 'GET', null, storage.malToken);
            
            // Try Romaji if English fails
            if ((!malSearch.data || malSearch.data.length === 0) && foundMedia.title.romaji) {
               malSearch = await malApiRequest(`manga?q=${encodeURIComponent(foundMedia.title.romaji)}&limit=1`, 'GET', null, storage.malToken);
            }
            
            // Try truncated Romaji (First 3 words) if both fail
            if ((!malSearch.data || malSearch.data.length === 0) && foundMedia.title.romaji) {
               const shortRomaji = foundMedia.title.romaji.split(' ').slice(0, 3).join(' ');
               malSearch = await malApiRequest(`manga?q=${encodeURIComponent(shortRomaji)}&limit=1`, 'GET', null, storage.malToken);
            }

            if (malSearch.data?.length > 0) {
              foundMedia.idMal = malSearch.data[0].node.id;
            }
          } catch(e) {}
        }

        return { media: foundMedia, chapter, token: storage.anilistToken, platform: 'ANILIST' };
      }
    } catch (e) { console.log("AniList search failed, falling back to MAL..."); }
  }

  // 2. Try MAL directly if AniList returned null
  if (storage.malToken) {
    try {
      const searchRes = await malApiRequest(`manga?q=${encodeURIComponent(cleanTitle)}&limit=1&fields=id,title,alternative_titles,main_picture,status,num_chapters,my_list_status`, 'GET', null, storage.malToken);
      
      if (searchRes.data && searchRes.data.length > 0) {
        const malNode = searchRes.data[0].node;
        const standardizedMedia = standardizeMalMedia(malNode, malNode.my_list_status, 'MANGA');
        return { media: standardizedMedia, chapter, token: storage.malToken, platform: 'MAL' };
      }
    } catch (e) { console.log("MAL search failed, falling back to Custom OTG..."); }
  }

  return null; 
}

async function processMangaAutoUpdate(cleanTitle, chapter, tabId, trueReadSeconds, frameId = 0) {
  try {
    const result = await findUnifiedManga(cleanTitle, chapter);
    
    if (!result || !result.media) {
      chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
      chrome.action.setBadgeText({ text: 'ERR' });
      return;
    }

    const { media, token, platform } = result;
    const intChapter = Math.floor(result.chapter);
    
    const currentProg = media.mediaListEntry ? media.mediaListEntry.progress : 0;
    const mangaName = media.title.english || media.title.romaji;
    let isCompleted = false; 
    let xpData = null; // ✅ FIX: Declared at top level of try-block

    const storage = await chrome.storage.local.get(['anilistUserId', 'malToken']);
    let updatedPlatforms = [];

    if (currentProg < intChapter) {
      let newStatus = 'CURRENT';
      let startedAt = undefined;
      let completedAt = undefined;
      
      if (intChapter === 1 && currentProg === 0) startedAt = getTodayFuzzy();
      if (media.chapters && intChapter >= media.chapters && media.status === 'FINISHED') {
        newStatus = 'COMPLETED';
        completedAt = getTodayFuzzy();
        isCompleted = true; 
      }

      if (platform === 'ANILIST') {
        try {
          const mutation = `
            mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
              SaveMediaListEntry (mediaId: $mediaId, progress: $progress, status: $status, startedAt: $startedAt, completedAt: $completedAt) { id }
            }
          `;
          const variables = { mediaId: media.id, progress: intChapter, status: newStatus };
          if (startedAt) variables.startedAt = startedAt;
          if (completedAt) variables.completedAt = completedAt;
          
          await apiRequest(mutation, variables, token);
          updatedPlatforms.push("AniList");
          
          chrome.storage.local.get(['full_watchlist_cache'], (res) => {
              if (res.full_watchlist_cache && res.full_watchlist_cache.data) {
                  const entry = res.full_watchlist_cache.data.find(e => e.media.id === media.id);
                  if (entry) {
                      entry.progress = intChapter;
                      entry.status = newStatus;
                  } else {
                      res.full_watchlist_cache.data.push({ progress: intChapter, status: newStatus, media: media });
                  }
                  chrome.storage.local.set({ full_watchlist_cache: res.full_watchlist_cache });
              }
              setTimeout(() => chrome.storage.local.set({ trigger_dom_refresh: Date.now() }), 500);
          });
          processOfflineQueue();
        } catch (networkError) {
          queueFailedUpdate(media.id, intChapter, newStatus, token);
        }

        if (media.idMal && storage.malToken) {
          try {
            await updateMalProgress(media.idMal, intChapter, newStatus, 'MANGA', storage.malToken);
            updatedPlatforms.push("MAL");
          } catch (e) {
            console.error("MAL Dual-Sync Failed:", e);
          }
        }
      } else if (platform === 'MAL') {
        try {
          await updateMalProgress(media.idMal || Math.abs(media.id), intChapter, newStatus, 'MANGA', token);
          updatedPlatforms.push("MAL");
        } catch (e) {
          console.error("MAL Update Failed:", e);
        }
      }

      if (storage.anilistUserId) {
        xpData = await syncUserStatsToSupabase(storage.anilistUserId, trueReadSeconds);
      }
      
    } else if (media.chapters && currentProg >= media.chapters && media.status === 'FINISHED') {
      isCompleted = true;
    }

    const activeSessions = await getSessionData('activeSessions');
    if (activeSessions[tabId]) {
      delete activeSessions[tabId];
      await setSessionData('activeSessions', activeSessions);
    }

    if (storage.anilistUserId) {
      await deleteOtgTimeFromSupabase(storage.anilistUserId, media.id, intChapter);
    }

    chrome.action.setBadgeBackgroundColor({ color: '#4cca51' }); 
    chrome.action.setBadgeText({ text: '✓' });
    
    let platformText = updatedPlatforms.length > 1 ? "both AniList & MAL" : (updatedPlatforms[0] || "API");
    let toastMessage = `${mangaName} updated to Chapter ${intChapter} on ${platformText}!`;
    
    if (updatedPlatforms.length === 0 && currentProg >= intChapter) {
        toastMessage = `${mangaName} is already at Chapter ${intChapter}!`;
    }

    if (isCompleted) {
      chrome.tabs.sendMessage(tabId, { action: "SHOW_RATING_MODAL", mediaId: media.id, malId: media.idMal, isMalOnly: media.isMalOnly, animeName: mangaName, mediaType: 'MANGA' });
    } else {
      chrome.tabs.sendMessage(tabId, { action: "SHOW_SUCCESS_TOAST", message: toastMessage, xpData: xpData }); 
    }

  } catch (error) {
    console.error("Manga Auto-Update Process Failed:", error);
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
    chrome.action.setBadgeText({ text: 'ERR' });
  }
}

async function syncUserStatsToSupabase(userId, addedSeconds, isRetroactive = false) {
  if (!isRetroactive && (!addedSeconds || addedSeconds < 5)) return null;

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

    // ✅ SURGICAL FIX 1: Return the exact XP data needed for the Toast UI animation
    return {
      level: newLevel,
      totalMinutes: totalMinutes,
      gainedMins: Math.floor(addedSeconds / 60)
    };

  } catch (error) { 
    console.error("Sync Failed:", error); 
    return null;
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  const session = activeSessions[tabId];
  if (session) {
    saveOtgTimeToSupabase(session.userId, session.mediaId, session.episode, session.time, session.url, session.customTitle, session.platform);
    delete activeSessions[tabId];
  }
});

// ==========================================
// 📡 THE MESSAGE LISTENER
// ==========================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ✅ SURGICAL FIX 1: Removed the 'sender.tab.active' guard so background tracking continues when the popup is open!

  if (message.action === "AUTO_UPDATE_ANIME") {
    // ✅ Add sender.frameId to the end of the arguments
    processAutoUpdate(sender.tab.title, sender.tab.id, message.trueWatchSeconds || 0, sender.frameId);
    sendResponse({ success: true }); 
    return false; 
  }
  
  else if (message.action === "GET_USER_WATCHLIST") {
    chrome.storage.local.get(['full_watchlist_cache', 'anilistToken', 'anilistUserId'], async (res) => {
      // Use cache if it's less than 2 hours old AND not empty
      if (res.full_watchlist_cache && res.full_watchlist_cache.data.length > 0 && (Date.now() - res.full_watchlist_cache.timestamp < 7200000)) {
        sendResponse({ watchlist: res.full_watchlist_cache.data });
        return;
      }
      
      if (res.anilistToken && res.anilistUserId) {
        try {
          const query = `
            query($userId: Int) {
              MediaListCollection(userId: $userId, type: ANIME) {
                lists { entries { progress status score media { id idMal chapters episodes format nextAiringEpisode { airingAt episode } title { romaji english } } } }
              }
            }
          `;
          const apiRes = await apiRequest(query, { userId: res.anilistUserId }, res.anilistToken);
          let allEntries = [];
          if (apiRes.data && apiRes.data.MediaListCollection && apiRes.data.MediaListCollection.lists) {
              apiRes.data.MediaListCollection.lists.forEach(l => allEntries.push(...l.entries));
          }
          if (allEntries.length > 0) {
              chrome.storage.local.set({ full_watchlist_cache: { timestamp: Date.now(), data: allEntries }});
          }
          sendResponse({ watchlist: allEntries });
        } catch(e) {
          sendResponse({ watchlist: res.full_watchlist_cache?.data || [] });
        }
      } else {
        sendResponse({ watchlist: [] });
      }
    });
    return true;
  }

  else if (message.action === "FETCH_MEDIA_STATS") {
    const cacheKey = `stats_v3_${message.mediaId}`; 
    
    chrome.storage.local.get(['anilistToken', cacheKey], async (res) => {
      if (res[cacheKey] && (Date.now() - res[cacheKey].timestamp < 86400000)) {
        console.log(`[Shiinah API] Using cached stats for ID: ${message.mediaId}`);
        sendResponse({ stats: res[cacheKey].data }); 
        return;
      }

      console.log(`[Shiinah API] Fetching fresh stats for ID: ${message.mediaId}`);
      let stats = { al: null, meta: null };

      if (res.anilistToken) {
        const alQuery = `query($id: Int) { Media(id: $id) { status format chapters episodes stats { scoreDistribution { score amount } } } }`;
        try {
          const alRes = await apiRequest(alQuery, { id: message.mediaId }, res.anilistToken);
          if (alRes.data?.Media) {
            stats.al = alRes.data.Media.stats || null;
            stats.meta = {
              status: alRes.data.Media.status,
              chapters: alRes.data.Media.chapters,
              episodes: alRes.data.Media.episodes,
              format: alRes.data.Media.format
            };
            console.log(`[Shiinah API] AniList stats fetched successfully.`);
          }
        } catch (e) {
          console.error(`[Shiinah API] AniList fetch failed:`, e);
        }
      }

      if (stats.al) {
        chrome.storage.local.set({ [cacheKey]: { timestamp: Date.now(), data: stats } });
      }
      
      console.log(`[Shiinah API] Sending stats back to UI:`, stats);
      sendResponse({ stats: stats }); 
    });
    return true; 
  }

  // --- INLINE TRACKING: SEARCH & FETCH FOR UNLISTED SHOWS ---
  else if (message.action === "SEARCH_AND_FETCH_STATS") {
    chrome.storage.local.get(['anilistToken', 'malToken'], async (res) => {
      try {
        let searchTitle = message.title
          .replace(/\.{3}$/g, '') 
          .replace(/Ep\s*\d+/i, '') 
          .replace(/Ch\s*\d+/i, '')
          .replace(/Season\s*\d+/i, '') 
          .replace(/[^\w\s]/g, ' ') 
          .replace(/\s+/g, ' ')
          .trim();

        const mediaType = message.mediaType || 'ANIME';
        console.log(`[Shiinah Search] Looking up unlisted title: "${searchTitle}"`);
        
        const searchQuery = `query ($search: String) { Media (search: $search, type: ${mediaType}, sort: SEARCH_MATCH) { id idMal status format chapters episodes title { romaji english } mediaListEntry { id progress status } } }`;
        let searchRes = await apiRequest(searchQuery, { search: searchTitle }, res.anilistToken);
        
        if (!searchRes.data?.Media) {
          let shortTitle = searchTitle.split(' ').slice(0, 3).join(' ');
          searchRes = await apiRequest(searchQuery, { search: shortTitle }, res.anilistToken);
        }

        let media = searchRes.data?.Media || null;

        if (!media && res.malToken) {
          try {
            const endpoint = mediaType === 'MANGA' ? 'manga' : 'anime';
            const malSearch = await malApiRequest(`${endpoint}?q=${encodeURIComponent(searchTitle)}&limit=1&fields=id,title,alternative_titles,main_picture,status,num_chapters,num_episodes`, 'GET', null, res.malToken);
            if (malSearch.data?.length > 0) {
              const malNode = malSearch.data[0].node;
              media = standardizeMalMedia(malNode, null, mediaType);
            }
          } catch(e) {}
        }

        if (!media) {
          console.log(`[Shiinah Search] No media found for: "${searchTitle}"`);
          sendResponse({ error: "Not found" });
          return;
        }

        if (!media.idMal && !media.isMalOnly && res.malToken) {
          try {
            const endpoint = mediaType === 'MANGA' ? 'manga' : 'anime';
            const officialTitle = media.title.english || media.title.romaji;
            let malSearch = await malApiRequest(`${endpoint}?q=${encodeURIComponent(officialTitle)}&limit=1`, 'GET', null, res.malToken);
            
            if ((!malSearch.data || malSearch.data.length === 0) && media.title.romaji) {
               malSearch = await malApiRequest(`${endpoint}?q=${encodeURIComponent(media.title.romaji)}&limit=1`, 'GET', null, res.malToken);
            }

            if (malSearch.data?.length > 0) {
              media.idMal = malSearch.data[0].node.id;
            }
          } catch(e) {}
        }

        let stats = { al: null, meta: { status: media.status, chapters: media.chapters, episodes: media.episodes, format: media.format } };

        if (res.anilistToken && media.id > 0) {
          const alQuery = `query($id: Int) { Media(id: $id) { stats { scoreDistribution { score amount } } } }`;
          try {
            const alRes = await apiRequest(alQuery, { id: media.id }, res.anilistToken);
            stats.al = alRes.data?.Media?.stats || null;
            console.log(`[Shiinah Search] Search stats mapped successfully.`);
          } catch (e) {
            console.error(`[Shiinah Search] Search stats fetch failed:`, e);
          }
        }

        console.log(`[Shiinah Search] Sending search stats back to UI:`, stats);
        sendResponse({ stats: stats, media: media });
      } catch (e) {
        console.error(`[Shiinah Search] Fatal search error:`, e);
        sendResponse({ error: e.message });
      }
    });
    return true; 
  }

  // --- INLINE TRACKING: SEARCH & FETCH FOR UNLISTED SHOWS ---
  else if (message.action === "SEARCH_AND_FETCH_STATS") {
    chrome.storage.local.get(['anilistToken', 'malToken'], async (res) => {
      try {
        let searchTitle = message.title
          .replace(/\.{3}$/g, '') 
          .replace(/Ep\s*\d+/i, '') 
          .replace(/Ch\s*\d+/i, '')
          .replace(/Season\s*\d+/i, '') 
          .replace(/[^\w\s]/g, ' ') 
          .replace(/\s+/g, ' ')
          .trim();

        const mediaType = message.mediaType || 'ANIME';
        
        // FIX: Added 'mediaListEntry' to this query so the background script can double-check if you are tracking it!
        const searchQuery = `query ($search: String) { Media (search: $search, type: ${mediaType}, sort: SEARCH_MATCH) { id idMal status format chapters episodes title { romaji english } mediaListEntry { id progress status } } }`;
        let searchRes = await apiRequest(searchQuery, { search: searchTitle }, res.anilistToken);
        
        if (!searchRes.data?.Media) {
          let shortTitle = searchTitle.split(' ').slice(0, 3).join(' ');
          searchRes = await apiRequest(searchQuery, { search: shortTitle }, res.anilistToken);
        }

        let media = searchRes.data?.Media || null;

        if (!media && res.malToken) {
          try {
            const endpoint = mediaType === 'MANGA' ? 'manga' : 'anime';
            const malSearch = await malApiRequest(`${endpoint}?q=${encodeURIComponent(searchTitle)}&limit=1&fields=id,title,alternative_titles,main_picture,status,num_chapters,num_episodes`, 'GET', null, res.malToken);
            if (malSearch.data?.length > 0) {
              const malNode = malSearch.data[0].node;
              media = standardizeMalMedia(malNode, null, mediaType);
            }
          } catch(e) {}
        }

        if (!media) {
          sendResponse({ error: "Not found" });
          return;
        }

        if (!media.idMal && !media.isMalOnly && res.malToken) {
          try {
            const endpoint = mediaType === 'MANGA' ? 'manga' : 'anime';
            const officialTitle = media.title.english || media.title.romaji;
            let malSearch = await malApiRequest(`${endpoint}?q=${encodeURIComponent(officialTitle)}&limit=1`, 'GET', null, res.malToken);
            
            if ((!malSearch.data || malSearch.data.length === 0) && media.title.romaji) {
               malSearch = await malApiRequest(`${endpoint}?q=${encodeURIComponent(media.title.romaji)}&limit=1`, 'GET', null, res.malToken);
            }

            if (malSearch.data?.length > 0) {
              media.idMal = malSearch.data[0].node.id;
            }
          } catch(e) {}
        }

        let stats = { al: null, meta: { status: media.status, chapters: media.chapters, episodes: media.episodes, format: media.format } };

        if (res.anilistToken && media.id > 0) {
          const alQuery = `query($id: Int) { Media(id: $id) { stats { scoreDistribution { score amount } } } }`;
          try {
            const alRes = await apiRequest(alQuery, { id: media.id }, res.anilistToken);
            stats.al = alRes.data?.Media?.stats || null;
          } catch (e) {}
        }

        sendResponse({ stats: stats, media: media });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    });
    return true; 
  }
  
  // ✅ SURGICAL FIX 3: Deduplicated ADD_TO_WATCHLIST & wired to the Reactivity Bridge
  else if (message.action === "ADD_TO_WATCHLIST") {
    chrome.storage.local.get(['anilistToken', 'malToken'], async (res) => {
      let alSuccess = false;
      let malSuccess = false;
      let attemptedAL = false;
      let attemptedMAL = false;
      
      const mediaType = message.mediaType || 'ANIME';

      // 1. Add to AniList
      if (res.anilistToken && message.mediaId && message.mediaId > 0) {
        attemptedAL = true;
        const mutation = `mutation ($mediaId: Int, $status: MediaListStatus) { SaveMediaListEntry (mediaId: $mediaId, status: $status) { id } }`;
        try {
          const alRes = await apiRequest(mutation, { mediaId: message.mediaId, status: 'CURRENT' }, res.anilistToken);
          if (!alRes.errors) alSuccess = true;
        } catch (e) { console.error("AL Add Failed:", e); }
      }

      // 2. Add to MAL
      const malIdToUse = message.malId || (message.mediaId < 0 ? Math.abs(message.mediaId) : null);
      if (res.malToken && malIdToUse) {
        attemptedMAL = true;
        try {
          const endpoint = mediaType === 'MANGA' ? `manga/${malIdToUse}/my_list_status` : `anime/${malIdToUse}/my_list_status`;
          const statusVal = mediaType === 'MANGA' ? 'reading' : 'watching';
          await safeMalApiRequest(endpoint, 'PUT', { status: statusVal }, res.malToken);
          malSuccess = true;
        } catch (e) { console.error("MAL Add Failed:", e); }
      }

      // 3. Evaluate truth and trigger DOM refresh
      let overallSuccess = false;
      if (attemptedAL && attemptedMAL) overallSuccess = alSuccess && malSuccess;
      else if (attemptedAL) overallSuccess = alSuccess;
      else if (attemptedMAL) overallSuccess = malSuccess;

      if (overallSuccess) {
         chrome.storage.local.remove('full_watchlist_cache');
         chrome.storage.local.set({ trigger_dom_refresh: Date.now() });
      }

      sendResponse({ success: overallSuccess });
    });
    return true;
  }
  
  else if (message.action === "LIVE_VIDEO_PROGRESS") {
    // ✅ SURGICAL FIX: Lock the badge updates to the specific tab ID to prevent conflicts
    if (message.hasTriggeredUpdate) {
      chrome.action.setBadgeBackgroundColor({ color: '#4cca51', tabId: sender.tab.id });
      chrome.action.setBadgeText({ text: '✓', tabId: sender.tab.id });
    } else if (message.progress > 0) {
      chrome.action.setBadgeBackgroundColor({ color: '#3db4f2', tabId: sender.tab.id });
      chrome.action.setBadgeText({ text: `${Math.floor(message.progress)}%`, tabId: sender.tab.id });
    }

    if (message.isOtgLoaded === false && sender.tab) {
      (async () => {
        try {
          const result = await findAniListMedia(sender.tab.title);
          let storage = await chrome.storage.local.get(['anilistUserId']);

          if (result && result.media && storage.anilistUserId) {
            const mediaId = result.media.id;
            const episode = result.episode;
            const cacheKey = `${storage.anilistUserId}_${mediaId}_${episode}_anime`;
            
            deleteOldEpisodesFromSupabase(storage.anilistUserId, mediaId, episode);
            lastSaveTimes[cacheKey] = Date.now(); 

            const savedData = await getOtgTimeFromSupabase(storage.anilistUserId, mediaId, episode);
            
            sendResponse({
              otgTime: savedData ? savedData.time : null,
              resolvedData: { mediaId: mediaId, malId: result.media.idMal, episode: episode, cacheKey, platform: 'ANILIST' }
            });
          } else {
            sendResponse({ otgTime: null, resolvedData: null });
          }
        } catch(e) { sendResponse({ otgTime: null, resolvedData: null }); }
      })();
      return true;
    } else if (message.resolvedData && message.currentTime) {
      const { mediaId, episode, cacheKey, platform } = message.resolvedData;
      const now = Date.now();
      const tabUrl = sender.tab ? sender.tab.url : null;
      
      if (!message.hasTriggeredUpdate) {
        chrome.storage.local.get(['anilistUserId'], (res) => {
          const userId = res.anilistUserId;
          if (userId) {
            activeSessions[sender.tab.id] = { userId, mediaId, episode, time: message.currentTime, url: tabUrl, customTitle: null, platform };
            
            if (!lastSaveTimes[cacheKey] || now - lastSaveTimes[cacheKey] > 5000) {
              lastSaveTimes[cacheKey] = now;
              saveOtgTimeToSupabase(userId, mediaId, episode, message.currentTime, tabUrl, null, platform);
            }
          }
        });
      }
      sendResponse({ otgTime: null });
      return false;
    }
    
    sendResponse({ success: true });
    return false;
  }

  else if (message.action === "AUTO_UPDATE_MANGA") {
    // ✅ Add sender.frameId to the end of the arguments
    processMangaAutoUpdate(message.cleanTitle, message.chapter, sender.tab.id, message.trueReadSeconds || 0, sender.frameId);
    sendResponse({ success: true }); 
    return false; 
  }

  else if (message.action === "LIVE_MANGA_PROGRESS") {
    chrome.action.setBadgeBackgroundColor({ color: message.isCompleted ? '#4cca51' : '#3db4f2' });
    if (message.readingType === 'page') {
      chrome.action.setBadgeText({ text: `${message.progress}` }); 
    } else if (message.readingType === 'scroll') {
      chrome.action.setBadgeText({ text: `${Math.floor(message.pct)}%` }); 
    } else {
      if (message.isCompleted) chrome.action.setBadgeText({ text: '✓' });
      else chrome.action.setBadgeText({ text: '...' });
    }
    
    if (message.isOtgLoaded === false && message.parsedTitle && message.chapter !== null) {
      (async () => {
        try {
          let storage = await chrome.storage.local.get(['anilistToken', 'anilistUserId', 'malToken']);
          if (!storage.anilistUserId) return sendResponse({ otgTime: null });

          const result = await findUnifiedManga(message.parsedTitle, message.chapter);

          let mediaId;
          let isCustom = false;
          let customTitle = null;
          let platformType = 'CUSTOM';

          if (result && result.media) {
            mediaId = result.media.id;
            platformType = result.platform || 'ANILIST';
          } else {
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
            resolvedData: { userId: storage.anilistUserId, mediaId, episode, cacheKey, isCustom, customTitle, platform: platformType } 
          });

        } catch (error) { sendResponse({ otgTime: null }); }
      })();
      return true; 
      
    } else if (message.resolvedData) {
      const { userId, mediaId, episode, cacheKey, customTitle, platform } = message.resolvedData;
      const now = Date.now();
      const tabUrl = sender.tab ? sender.tab.url : null;
      
      const saveValue = message.readingType === 'scroll' ? message.pct : (message.readingType === 'page' ? message.progress : 0);

      if (!message.isCompleted) {
        if (sender.tab && sender.tab.id) {
          activeSessions[sender.tab.id] = { userId, mediaId, episode, time: saveValue, url: tabUrl, customTitle, platform };
        }
        
        if (!lastSaveTimes[cacheKey] || now - lastSaveTimes[cacheKey] > 5000) {
          lastSaveTimes[cacheKey] = now;
          saveOtgTimeToSupabase(userId, mediaId, episode, saveValue, tabUrl, customTitle, platform);
        }
      }
      sendResponse({ otgTime: null });
      return false; 
    }
    
    sendResponse({ success: true });
    return false;
  }
  else if (message.action === "SAVE_LEARNED_SKIP") {
    chrome.storage.local.get(['learnedSkips'], (res) => {
      let skips = res.learnedSkips || {};
      if (!skips[message.mediaId]) skips[message.mediaId] = { op: [], ed: [] };

      if (message.isOP) skips[message.mediaId].op.push(message.duration);
      else skips[message.mediaId].ed.push(message.duration);

      chrome.storage.local.set({ learnedSkips: skips });
    });
    return false;
  }
  else if (message.action === "GET_LEARNED_SKIP") {
    chrome.storage.local.get(['learnedSkips'], (res) => {
      let skips = res.learnedSkips || {};
      let data = skips[message.mediaId];
      
      if (!data) return sendResponse({ op: 85, ed: 85 }); 

      let avgOp = data.op.length ? Math.round(data.op.reduce((a,b)=>a+b,0)/data.op.length) : 85;
      let avgEd = data.ed.length ? Math.round(data.ed.reduce((a,b)=>a+b,0)/data.ed.length) : 85;

      sendResponse({ op: avgOp - 1, ed: avgEd - 1 }); 
    });
    return true; 
  }
  else if (message.action === "FETCH_ANISKIP") {
    const url = `https://api.aniskip.com/v2/skip-times/${message.malId}/${message.episode}?types=op&types=ed&episodeLength=0`;
    
    fetch(url)
      .then(res => res.json())
      .then(data => sendResponse(data))
      .catch(err => sendResponse({ found: false }));
    return true; 
  }
  else if (message.action === "SAVE_ANIME_SCORE") {
    chrome.storage.local.get(['anilistToken', 'malToken'], async (res) => {
      let success = false;
      
      if (!message.isMalOnly && res.anilistToken) {
        const mutation = `mutation ($mediaId: Int, $scoreRaw: Int) { SaveMediaListEntry(mediaId: $mediaId, scoreRaw: $scoreRaw) { id score } }`;
        try {
          await apiRequest(mutation, { mediaId: message.mediaId, scoreRaw: message.score }, res.anilistToken);
          success = true;
        } catch (error) {}
      }

      const targetMalId = message.isMalOnly ? message.mediaId : message.malId;
      if (targetMalId && res.malToken) {
        try {
          const endpoint = message.mediaType === 'MANGA' ? `manga/${targetMalId}/my_list_status` : `anime/${targetMalId}/my_list_status`;
          const malScore = Math.round(message.score / 10); 
          await safeMalApiRequest(endpoint, 'PUT', { score: malScore }, res.malToken);
          success = true;
        } catch (error) { 
          console.error("MAL Score Save Failed:", error); 
        }
      }
      
      sendResponse({ success });
    });
    return true; 
  }
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
  else if (message.action === "LOGIN_MAL") {
    (async () => {
      try {
        const cleanClientId = typeof MAL_CLIENT_ID !== 'undefined' ? MAL_CLIENT_ID.trim() : "";
        if (!cleanClientId || cleanClientId.includes('YOUR_MAL_CLIENT_ID')) {
          console.error("🚨 MAL Client ID is missing or default in config.js!");
          return;
        }

        function generateCodeVerifier() {
          const validChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
          let verifier = '';
          const randomValues = new Uint8Array(128);
          crypto.getRandomValues(randomValues);
          for (let i = 0; i < randomValues.length; i++) {
            verifier += validChars[randomValues[i] % validChars.length];
          }
          return verifier;
        }

        const codeVerifier = generateCodeVerifier();
        const state = generateCodeVerifier().substring(0, 16); 
        
        let redirectUri = chrome.identity.getRedirectURL(); 
        if (!redirectUri.endsWith('/')) redirectUri += '/';

        const authUrl = `https://myanimelist.net/v1/oauth2/authorize?response_type=code&client_id=${cleanClientId}&code_challenge=${codeVerifier}&code_challenge_method=plain&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;

        const redirectUrlResult = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
        const url = new URL(redirectUrlResult);
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');

        if (returnedState !== state) return;

        if (code) {
          const tokenResponse = await fetch('https://myanimelist.net/v1/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: cleanClientId,
              code: code,
              code_verifier: codeVerifier,
              grant_type: 'authorization_code',
              redirect_uri: redirectUri
            })
          });

          const tokenData = await tokenResponse.json();
          if (tokenData.access_token) {
            await chrome.storage.local.set({
              malToken: tokenData.access_token,
              malRefreshToken: tokenData.refresh_token
            });
          }
        }
      } catch (err) {
        console.error("🚨 Background Auth Flow Crashed:", err);
      }
    })();
    return false; 
  }
  else if (message.action === "SYNC_SMART_MERGE") {
    (async () => {
      try {
        const storage = await chrome.storage.local.get(['anilistToken', 'anilistUserId', 'malToken']);
        if (!storage.anilistToken || !storage.malToken || !storage.anilistUserId) return;

        const alQuery = `
          query ($userId: Int) {
            MediaListCollection(userId: $userId, type: ANIME) {
              lists { entries { progress status media { id idMal title { english romaji } } } }
            }
          }
        `;
        const alRes = await apiRequest(alQuery, { userId: storage.anilistUserId }, storage.anilistToken);
        const alEntries = [];
        alRes.data?.MediaListCollection?.lists?.forEach(l => alEntries.push(...l.entries));

        let malEntries = [];
        let nextUrl = `https://api.myanimelist.net/v2/users/@me/animelist?fields=list_status&limit=1000`;
        while (nextUrl) {
          const malRes = await fetch(nextUrl, { headers: { 'Authorization': `Bearer ${storage.malToken}` } });
          const malData = await malRes.json();
          if (malData.data) malEntries.push(...malData.data);
          nextUrl = malData.paging?.next || null;
        }

        const alMap = new Map();
        alEntries.forEach(e => { if (e.media?.idMal) alMap.set(e.media.idMal, e); });
        
        const malMap = new Map();
        malEntries.forEach(e => malMap.set(e.node.id, e));

        const syncQueue = []; 

        alMap.forEach((alEntry, idMal) => {
          const malEntry = malMap.get(idMal);
          const alProg = alEntry.progress || 0;
          const title = alEntry.media.title.english || alEntry.media.title.romaji;

          if (!malEntry) {
            syncQueue.push({ platform: 'MAL', id: idMal, progress: alProg, status: alEntry.status, title });
          } else {
            const malProg = malEntry.list_status.num_episodes_watched || 0;
            if (alProg > malProg) {
              syncQueue.push({ platform: 'MAL', id: idMal, progress: alProg, status: alEntry.status, title });
            } else if (malProg > alProg) {
              syncQueue.push({ platform: 'AL', id: alEntry.media.id, progress: malProg, status: malEntry.list_status.status, title });
            }
          }
        });

        malMap.forEach((malEntry, idMal) => {
          if (!alMap.has(idMal)) {
            syncQueue.push({ 
              platform: 'AL_LOOKUP', idMal: idMal, 
              progress: malEntry.list_status.num_episodes_watched, 
              status: malEntry.list_status.status, 
              title: malEntry.node.title 
            });
          }
        });

        if (syncQueue.length === 0) {
          chrome.runtime.sendMessage({ action: "SYNC_COMPLETE", updatesMade: 0 }).catch(() => {});
          return;
        }

        for(let i = 0; i < syncQueue.length; i++) {
          const task = syncQueue[i];
          chrome.runtime.sendMessage({ action: "SYNC_PROGRESS", current: i + 1, total: syncQueue.length, title: task.title }).catch(()=>{});

          try {
            if (task.platform === 'MAL') {
              await updateMalProgress(task.id, task.progress, task.status, 'ANIME', storage.malToken);
            } else if (task.platform === 'AL') {
              let aniStatus = 'CURRENT';
              if (task.status === 'completed') aniStatus = 'COMPLETED';
              if (task.status === 'on_hold') aniStatus = 'PAUSED';
              if (task.status === 'dropped') aniStatus = 'DROPPED';
              if (task.status === 'plan_to_watch') aniStatus = 'PLANNING';

              const saveMut = `mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) { SaveMediaListEntry (mediaId: $mediaId, progress: $progress, status: $status) { id } }`;
              await apiRequest(saveMut, { mediaId: task.id, progress: task.progress, status: aniStatus }, storage.anilistToken);
            } else if (task.platform === 'AL_LOOKUP') {
              const findQuery = `query($idMal: Int) { Media(idMal: $idMal, type: ANIME) { id } }`;
              const findRes = await apiRequest(findQuery, { idMal: task.idMal }, storage.anilistToken);
              await new Promise(resolve => setTimeout(resolve, 500)); 

              if (findRes.data && findRes.data.Media) {
                const anilistId = findRes.data.Media.id;
                let aniStatus = 'CURRENT';
                if (task.status === 'completed') aniStatus = 'COMPLETED';
                if (task.status === 'on_hold') aniStatus = 'PAUSED';
                if (task.status === 'dropped') aniStatus = 'DROPPED';
                if (task.status === 'plan_to_watch') aniStatus = 'PLANNING';

                const saveMut = `mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) { SaveMediaListEntry (mediaId: $mediaId, progress: $progress, status: $status) { id } }`;
                await apiRequest(saveMut, { mediaId: anilistId, progress: task.progress, status: aniStatus }, storage.anilistToken);
              }
            }
          } catch (e) { console.error(`Failed to sync ${task.title}:`, e); }

          await new Promise(resolve => setTimeout(resolve, 1500)); 
        }

        chrome.runtime.sendMessage({ action: "SYNC_COMPLETE", updatesMade: syncQueue.length }).catch(() => {});
      } catch (err) { console.error("Smart Merge Error:", err); }
    })();
    return false;
  }
  return false; 
});

async function checkForNewEpisodes() {
  const storage = await chrome.storage.local.get(['anilistToken', 'anilistUserId', 'lastNotifiedEpisodes']);
  if (!storage.anilistToken || !storage.anilistUserId) return;

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
    let lastNotified = storage.lastNotifiedEpisodes || {};
    let newlyAired = [];

    const nowSeconds = Math.floor(Date.now() / 1000);

    entries.forEach(entry => {
      const media = entry.media;
      if (media.nextAiringEpisode) {
        const airTime = media.nextAiringEpisode.airingAt;
        const epNum = media.nextAiringEpisode.episode;
        
        if (nowSeconds >= airTime && (nowSeconds - airTime) < 7200) {
          const cacheKey = `${media.id}_${epNum}`;
          
          if (!lastNotified[cacheKey]) {
            newlyAired.push({ title: media.title.english || media.title.romaji, episode: epNum });
            lastNotified[cacheKey] = true;
          }
        }
      }
    });

    if (newlyAired.length > 0) {
      await chrome.storage.local.set({ lastNotifiedEpisodes: lastNotified });
      
      newlyAired.forEach(anime => {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'New Episode Available! 🍿',
          message: `Episode ${anime.episode} of ${anime.title} just finished airing in Japan.`
        });
      });
    }
  } catch(error) {
    console.error("[Notifications Engine] Failed to fetch schedule:", error);
  }
}