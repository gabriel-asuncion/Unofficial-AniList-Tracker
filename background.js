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

// --- NEW: Housekeeping function for skipped episodes ---
async function deleteOldEpisodesFromSupabase(userId, mediaId, currentEpisode) {
  try {
    // We use "episode=lt.${currentEpisode}" to target only older episodes
    const url = `${SUPABASE_URL}/rest/v1/otg_saves?anilist_user_id=eq.${userId}&media_id=eq.${mediaId}&episode=lt.${currentEpisode}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    
    if (res.ok) {
      console.log(`[Supabase Housekeeping]: Cleared orphaned saves before Ep ${currentEpisode}`);
    }
  } catch (error) {
    console.error("[Supabase Housekeeping Failed]:", error);
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
          // --- NEW: Strict try/catch wrapper ensures the channel always closes ---
          const result = await findAniListMedia(sender.tab.title);
          let storage = await chrome.storage.local.get(['anilistUserId']);
          let userId = storage.anilistUserId;

          if (!userId && result && result.token) {
            try {
              const viewerData = await apiRequest(`query { Viewer { id } }`, {}, result.token);
              userId = viewerData.data?.Viewer?.id;
              if (userId) await chrome.storage.local.set({ anilistUserId: userId });
            } catch(e) {
              console.error("[AniList Quick Update] Failed to fetch Viewer ID", e);
            }
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
          // If a network error causes a crash, gracefully catch it and close the channel!
          console.error("[AniList Quick Update] Async listener crashed:", error);
          sendResponse({ otgTime: null }); 
        }
      })();
      return true; // Keep channel open for async fetch
      
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
      return false; // Synchronous reply
      
    } else {
      // --- NEW: Catch-all safety net for stray messages ---
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
    return true; // Keep channel open for async fetch
  }
  
  return false; // FIXED: Default to false to avoid channel hangs
});

async function processAutoUpdate(tabTitle, tabId) {
  try {
    const result = await findAniListMedia(tabTitle);
    
    // If we can't find the anime, show an error badge so it doesn't get stuck on "..."
    if (!result || !result.media) {
      chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
      chrome.action.setBadgeText({ text: 'ERR' });
      return;
    }

    const { media, episode, token } = result;
    const currentProg = media.mediaListEntry ? media.mediaListEntry.progress : 0;
    const animeName = media.title.english || media.title.romaji;
    let isCompleted = false; 

    // --- NEW: The Early Cleanup Fix ---
    // If the user already watched this episode, skip the AniList API call,
    // but STILL clean up Supabase and show the success checkmark!
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

      await apiRequest(mutation, variables, token);
    } else if (media.episodes && currentProg >= media.episodes) {
      // Catch edge case: Ensure modal shows if they re-watch a finished series finale
      isCompleted = true;
    }

    // --- GUARANTEED CLEANUP & UI UPDATE ---
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