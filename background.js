// background.js

importScripts('config.js');

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
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    const data = await res.json();
    if (data && data.length > 0) return data[0].playback_time;
    return null;
  } catch (error) {
    console.error("[Supabase GET Error]:", error);
    return null;
  }
}

async function saveOtgTimeToSupabase(userId, mediaId, episode, time) {
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
        playback_time: time
      })
    });
    
    if (!res.ok) {
      console.error("[Supabase Write Rejected]:", await res.text());
    }
  } catch (error) {
    console.error("[Supabase Network Pipeline Failed]:", error);
  }
}

async function deleteOtgTimeFromSupabase(userId, mediaId, episode) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/otg_saves?anilist_user_id=eq.${userId}&media_id=eq.${mediaId}&episode=eq.${episode}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    
    if (res.ok) {
      console.log(`[Supabase Cleanup]: Removed finished OTG save for Media ${mediaId} Ep ${episode}`);
    }
  } catch (error) {
    console.error("[Supabase Network Delete Failed]:", error);
  }
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
    return false; // FIXED: Changed to false (synchronous)
  }

  if (message.action === "AUTO_UPDATE_ANIME") {
    processAutoUpdate(sender.tab.title, sender.tab.id);
    sendResponse({ success: true }); // FIXED: Acknowledge receipt to close the channel
    return false; 

  } else if (message.action === "LIVE_VIDEO_PROGRESS") {
    
    const dynamicThreshold = message.threshold || 80;
    const currentPct = Math.floor(message.progress);
    
    if (currentPct > 0 && currentPct < dynamicThreshold) {
      chrome.action.setBadgeBackgroundColor({ color: '#3db4f2' }); 
      chrome.action.setBadgeText({ text: `${currentPct}%` }); 
    }

    if (message.isOtgLoaded === false && sender.tab && sender.tab.title) {
      (async () => {
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
      })();
      return true; // Keep channel open for async fetch
      
    } else if (message.resolvedData) {
      const { userId, mediaId, episode, cacheKey } = message.resolvedData;
      const now = Date.now();
      
      // FIXED: Only save to database if the episode is NOT finished
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
      return false; // Synchronous reply
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
    return true; // Keep channel open for async fetch
  }
  
  return false; // FIXED: Default to false to avoid channel hangs
});

async function processAutoUpdate(tabTitle, tabId) {
  try {
    const result = await findAniListMedia(tabTitle);
    if (!result || !result.media) return;

    const { media, episode, token } = result;
    const currentProg = media.mediaListEntry ? media.mediaListEntry.progress : 0;
    
    if (currentProg >= episode) return; 

    let newStatus = 'CURRENT';
    let startedAt = undefined;
    let completedAt = undefined;
    let isCompleted = false; 

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

    await apiRequest(mutation, variables, token);

    // FIXED: Remove the tab from RAM so closing it doesn't resurrect the DB row
    delete activeSessions[tabId];

    const userStorage = await chrome.storage.local.get(['anilistUserId']);
    if (userStorage.anilistUserId) {
      await deleteOtgTimeFromSupabase(userStorage.anilistUserId, media.id, episode);
    }

    chrome.action.setBadgeBackgroundColor({ color: '#4cca51' }); 
    chrome.action.setBadgeText({ text: '✓' });

    const animeName = media.title.english || media.title.romaji;
    
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
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  const session = activeSessions[tabId];
  if (session) {
    saveOtgTimeToSupabase(session.userId, session.mediaId, session.episode, session.time);
    delete activeSessions[tabId];
  }
});