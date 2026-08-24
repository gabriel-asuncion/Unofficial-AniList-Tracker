// background.js
import { MAL_CLIENT_ID } from './config.js';
import { apiRequest, findAniListMedia, hashStringToNegativeInt } from './api/anilist.js';
import { malApiRequest, standardizeMalMedia, safeMalApiRequest, updateMalProgress } from './api/mal.js';
import { 
  processOfflineQueue, activeSessions, lastSaveTimes, saveOtgTimeToSupabase, 
  deleteOldEpisodesFromSupabase, getOtgTimeFromSupabase, syncUserStatsToSupabase, 
  processAutoUpdate, processMangaAutoUpdate 
} from './api/tracker.js';

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "processOfflineQueue") processOfflineQueue();
  else if (alarm.name === "airingCheck") { checkForNewEpisodes(); checkListDesync(); }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("processOfflineQueue", { periodInMinutes: 15 });
  chrome.alarms.create("airingCheck", { periodInMinutes: 30 }); 
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const session = activeSessions[tabId];
  if (session) {
    saveOtgTimeToSupabase(session.userId, session.mediaId, session.episode, session.time, session.url, session.customTitle, session.platform);
    delete activeSessions[tabId];
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "AUTO_UPDATE_ANIME") {
    processAutoUpdate(sender.tab.title, sender.tab.id, message.trueWatchSeconds || 0, sender.frameId);
    sendResponse({ success: true }); 
    return false; 
  }
  
  else if (message.action === "GET_USER_WATCHLIST") {
    const mType = message.mediaType || 'ANIME'; 
    const cacheKey = `full_watchlist_cache_${mType}`;

    chrome.storage.local.get([cacheKey, 'anilistToken', 'anilistUserId'], async (res) => {
      if (res[cacheKey] && res[cacheKey].data.length > 0 && (Date.now() - res[cacheKey].timestamp < 7200000)) {
        sendResponse({ watchlist: res[cacheKey].data });
        return;
      }
      if (res.anilistToken && res.anilistUserId) {
        try {
          const query = `query($userId: Int) { MediaListCollection(userId: $userId, type: ${mType}) { lists { entries { progress status score media { id idMal chapters episodes format nextAiringEpisode { airingAt episode } title { romaji english } } } } } }`;
          const apiRes = await apiRequest(query, { userId: res.anilistUserId }, res.anilistToken);
          let allEntries = [];
          if (apiRes.data && apiRes.data.MediaListCollection && apiRes.data.MediaListCollection.lists) {
              apiRes.data.MediaListCollection.lists.forEach(l => allEntries.push(...l.entries));
          }
          if (allEntries.length > 0) chrome.storage.local.set({ [cacheKey]: { timestamp: Date.now(), data: allEntries }});
          sendResponse({ watchlist: allEntries });
        } catch(e) { sendResponse({ watchlist: res[cacheKey]?.data || [] }); }
      } else sendResponse({ watchlist: [] });
    });
    return true;
  }

  else if (message.action === "FETCH_MEDIA_STATS") {
    const cacheKey = `stats_v3_${message.mediaId}`; 
    chrome.storage.local.get(['anilistToken', cacheKey], async (res) => {
      if (res[cacheKey] && (Date.now() - res[cacheKey].timestamp < 86400000)) {
        sendResponse({ stats: res[cacheKey].data }); 
        return;
      }
      let stats = { al: null, meta: null };
      if (res.anilistToken) {
        const alQuery = `query($id: Int) { Media(id: $id) { status format chapters episodes stats { scoreDistribution { score amount } } } }`;
        try {
          const alRes = await apiRequest(alQuery, { id: message.mediaId }, res.anilistToken);
          if (alRes.data?.Media) {
            stats.al = alRes.data.Media.stats || null;
            stats.meta = { status: alRes.data.Media.status, chapters: alRes.data.Media.chapters, episodes: alRes.data.Media.episodes, format: alRes.data.Media.format };
          }
        } catch (e) {}
      }
      if (stats.al) chrome.storage.local.set({ [cacheKey]: { timestamp: Date.now(), data: stats } });
      sendResponse({ stats: stats }); 
    });
    return true; 
  }

  else if (message.action === "SEARCH_AND_FETCH_STATS") {
    chrome.storage.local.get(['anilistToken', 'malToken'], async (res) => {
      try {
        let searchTitle = message.title.replace(/\.{3}$/g, '').replace(/Ep\s*\d+/i, '').replace(/Ch\s*\d+/i, '').replace(/Season\s*\d+/i, '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
        const mediaType = message.mediaType || 'ANIME';
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
        if (!media) return sendResponse({ error: "Not found" });

        if (!media.idMal && !media.isMalOnly && res.malToken) {
          try {
            const endpoint = mediaType === 'MANGA' ? 'manga' : 'anime';
            const officialTitle = media.title.english || media.title.romaji;
            let malSearch = await malApiRequest(`${endpoint}?q=${encodeURIComponent(officialTitle)}&limit=1`, 'GET', null, res.malToken);
            if ((!malSearch.data || malSearch.data.length === 0) && media.title.romaji) malSearch = await malApiRequest(`${endpoint}?q=${encodeURIComponent(media.title.romaji)}&limit=1`, 'GET', null, res.malToken);
            if (malSearch.data?.length > 0) media.idMal = malSearch.data[0].node.id;
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
      } catch (e) { sendResponse({ error: e.message }); }
    });
    return true; 
  }
  
  else if (message.action === "ADD_TO_WATCHLIST") {
    chrome.storage.local.get(['anilistToken', 'malToken'], async (res) => {
      let alSuccess = false, malSuccess = false, attemptedAL = false, attemptedMAL = false;
      const mediaType = message.mediaType || 'ANIME';

      if (res.anilistToken && message.mediaId && message.mediaId > 0) {
        attemptedAL = true;
        const mutation = `mutation ($mediaId: Int, $status: MediaListStatus) { SaveMediaListEntry (mediaId: $mediaId, status: $status) { id } }`;
        try {
          const alRes = await apiRequest(mutation, { mediaId: message.mediaId, status: 'CURRENT' }, res.anilistToken);
          if (!alRes.errors) alSuccess = true;
        } catch (e) {}
      }

      const malIdToUse = message.malId || (message.mediaId < 0 ? Math.abs(message.mediaId) : null);
      if (res.malToken && malIdToUse) {
        attemptedMAL = true;
        try {
          const endpoint = mediaType === 'MANGA' ? `manga/${malIdToUse}/my_list_status` : `anime/${malIdToUse}/my_list_status`;
          await safeMalApiRequest(endpoint, 'PUT', { status: mediaType === 'MANGA' ? 'reading' : 'watching' }, res.malToken);
          malSuccess = true;
        } catch (e) {}
      }

      let overallSuccess = false;
      if (attemptedAL && attemptedMAL) overallSuccess = alSuccess && malSuccess;
      else if (attemptedAL) overallSuccess = alSuccess;
      else if (attemptedMAL) overallSuccess = malSuccess;

      if (overallSuccess) {
         chrome.storage.local.remove(['full_watchlist_cache_ANIME', 'full_watchlist_cache_MANGA']); 
         chrome.storage.local.set({ trigger_dom_refresh: Date.now() });
      }
      sendResponse({ success: overallSuccess });
    });
    return true;
  }
  
  else if (message.action === "LIVE_VIDEO_PROGRESS") {
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
            const mediaId = result.media.id, episode = result.episode;
            const cacheKey = `${storage.anilistUserId}_${mediaId}_${episode}_anime`;
            deleteOldEpisodesFromSupabase(storage.anilistUserId, mediaId, episode);
            lastSaveTimes[cacheKey] = Date.now(); 
            const savedData = await getOtgTimeFromSupabase(storage.anilistUserId, mediaId, episode);
            sendResponse({ otgTime: savedData ? savedData.time : null, resolvedData: { mediaId: mediaId, malId: result.media.idMal, episode: episode, cacheKey, platform: 'ANILIST' } });
          } else sendResponse({ otgTime: null, resolvedData: null });
        } catch(e) { sendResponse({ otgTime: null, resolvedData: null }); }
      })();
      return true;
    } else if (message.resolvedData && message.currentTime) {
      const { mediaId, episode, cacheKey, platform } = message.resolvedData;
      const now = Date.now(), tabUrl = sender.tab ? sender.tab.url : null;
      if (!message.hasTriggeredUpdate) {
        chrome.storage.local.get(['anilistUserId'], (res) => {
          if (res.anilistUserId) {
            activeSessions[sender.tab.id] = { userId: res.anilistUserId, mediaId, episode, time: message.currentTime, url: tabUrl, customTitle: null, platform };
            if (!lastSaveTimes[cacheKey] || now - lastSaveTimes[cacheKey] > 5000) {
              lastSaveTimes[cacheKey] = now;
              saveOtgTimeToSupabase(res.anilistUserId, mediaId, episode, message.currentTime, tabUrl, null, platform);
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
    processMangaAutoUpdate(message.cleanTitle, message.chapter, sender.tab.id, message.readingData || {}, sender.frameId);
    sendResponse({ success: true }); 
    return false; 
  }

  else if (message.action === "LIVE_MANGA_PROGRESS") {
    chrome.action.setBadgeBackgroundColor({ color: message.isCompleted ? '#4cca51' : '#3db4f2' });
    if (message.readingType === 'page') chrome.action.setBadgeText({ text: `${message.progress}` }); 
    else if (message.readingType === 'scroll') chrome.action.setBadgeText({ text: `${Math.floor(message.pct)}%` }); 
    else {
      if (message.isCompleted) chrome.action.setBadgeText({ text: '✓' });
      else chrome.action.setBadgeText({ text: '...' });
    }
    
    if (message.isOtgLoaded === false && message.parsedTitle && message.chapter !== null) {
      (async () => {
        try {
          let storage = await chrome.storage.local.get(['anilistToken', 'anilistUserId', 'malToken']);
          if (!storage.anilistUserId) return sendResponse({ otgTime: null });
          const result = await findUnifiedManga(message.parsedTitle, message.chapter);
          let mediaId, isCustom = false, customTitle = null, platformType = 'CUSTOM';

          if (result && result.media) { mediaId = result.media.id; platformType = result.platform || 'ANILIST'; } 
          else { mediaId = hashStringToNegativeInt(message.parsedTitle); isCustom = true; customTitle = message.parsedTitle; }

          const episode = message.chapter;
          const cacheKey = `${storage.anilistUserId}_${mediaId}_${episode}_manga`;
          deleteOldEpisodesFromSupabase(storage.anilistUserId, mediaId, episode);
          lastSaveTimes[cacheKey] = Date.now(); 
          
          const savedData = await getOtgTimeFromSupabase(storage.anilistUserId, mediaId, episode);
          sendResponse({ otgTime: savedData ? savedData.time : null, otgUrl: savedData ? savedData.url : null, resolvedData: { userId: storage.anilistUserId, mediaId, episode, cacheKey, isCustom, customTitle, platform: platformType } });
        } catch (error) { sendResponse({ otgTime: null }); }
      })();
      return true; 
    } else if (message.resolvedData) {
      const { userId, mediaId, episode, cacheKey, customTitle, platform } = message.resolvedData;
      const now = Date.now(), tabUrl = sender.tab ? sender.tab.url : null;
      const saveValue = message.readingType === 'scroll' ? message.pct : (message.readingType === 'page' ? message.progress : 0);

      if (!message.isCompleted) {
        if (sender.tab && sender.tab.id) activeSessions[sender.tab.id] = { userId, mediaId, episode, time: saveValue, url: tabUrl, customTitle, platform };
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
    fetch(`https://api.aniskip.com/v2/skip-times/${message.malId}/${message.episode}?types=op&types=ed&episodeLength=0`)
      .then(res => res.json()).then(data => sendResponse(data)).catch(err => sendResponse({ found: false }));
    return true; 
  }
  else if (message.action === "SAVE_ANIME_SCORE") {
    chrome.storage.local.get(['anilistToken', 'malToken'], async (res) => {
      let success = false;
      if (!message.isMalOnly && res.anilistToken) {
        const mutation = `mutation ($mediaId: Int, $scoreRaw: Int) { SaveMediaListEntry(mediaId: $mediaId, scoreRaw: $scoreRaw) { id score } }`;
        try { await apiRequest(mutation, { mediaId: message.mediaId, scoreRaw: message.score }, res.anilistToken); success = true; } catch (error) {}
      }
      const targetMalId = message.isMalOnly ? message.mediaId : message.malId;
      if (targetMalId && res.malToken) {
        try {
          const endpoint = message.mediaType === 'MANGA' ? `manga/${targetMalId}/my_list_status` : `anime/${targetMalId}/my_list_status`;
          await safeMalApiRequest(endpoint, 'PUT', { score: Math.round(message.score / 10) }, res.malToken);
          success = true;
        } catch (error) {}
      }
      sendResponse({ success });
    });
    return true; 
  }
  else if (message.action === "SYNC_PAST_HISTORY") {
    chrome.storage.local.get(['anilistToken', 'anilistUserId'], async (res) => {
      if (!res.anilistToken || !res.anilistUserId) return sendResponse({ success: false });
      const query = `query ($userId: Int) { MediaListCollection(userId: $userId, type: ANIME) { lists { entries { progress media { format duration episodes } } } } }`;
      try {
        const response = await apiRequest(query, { userId: res.anilistUserId }, res.anilistToken);
        let totalRetroMinutes = 0;
        response.data.MediaListCollection.lists.forEach(list => {
          list.entries.forEach(entry => {
            const eps = entry.progress || 0, dur = entry.media.duration || 24; 
            let deduction = 3; 
            if (entry.media.format === 'MOVIE') deduction = 0; else if (dur < 12) deduction = 1.5;
            let trueDur = dur - deduction; if (trueDur < 1) trueDur = dur; 
            totalRetroMinutes += (trueDur * eps);
          });
        });
        await syncUserStatsToSupabase(res.anilistUserId, totalRetroMinutes * 60, true);
        sendResponse({ success: true, minutes: totalRetroMinutes });
      } catch (e) { sendResponse({ success: false }); }
    });
    return true; 
  }
  else if (message.action === "LOGIN_MAL") {
    (async () => {
      try {
        const cleanClientId = typeof MAL_CLIENT_ID !== 'undefined' ? MAL_CLIENT_ID.trim() : "";
        if (!cleanClientId || cleanClientId.includes('YOUR_MAL_CLIENT_ID')) return;
        function generateCodeVerifier() {
          const validChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
          let verifier = ''; const randomValues = new Uint8Array(128); crypto.getRandomValues(randomValues);
          for (let i = 0; i < randomValues.length; i++) verifier += validChars[randomValues[i] % validChars.length];
          return verifier;
        }
        const codeVerifier = generateCodeVerifier(), state = generateCodeVerifier().substring(0, 16); 
        let redirectUri = chrome.identity.getRedirectURL(); if (!redirectUri.endsWith('/')) redirectUri += '/';
        const authUrl = `https://myanimelist.net/v1/oauth2/authorize?response_type=code&client_id=${cleanClientId}&code_challenge=${codeVerifier}&code_challenge_method=plain&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;

        const redirectUrlResult = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
        const url = new URL(redirectUrlResult);
        const code = url.searchParams.get('code'), returnedState = url.searchParams.get('state');

        if (returnedState === state && code) {
          const tokenResponse = await fetch('https://myanimelist.net/v1/oauth2/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: cleanClientId, code: code, code_verifier: codeVerifier, grant_type: 'authorization_code', redirect_uri: redirectUri })
          });
          const tokenData = await tokenResponse.json();
          if (tokenData.access_token) await chrome.storage.local.set({ malToken: tokenData.access_token, malRefreshToken: tokenData.refresh_token });
        }
      } catch (err) {}
    })();
    return false; 
  }
  else if (message.action === "SYNC_SMART_MERGE") {
    (async () => {
      try {
        const storage = await chrome.storage.local.get(['anilistToken', 'anilistUserId', 'malToken']);
        if (!storage.anilistToken || !storage.malToken || !storage.anilistUserId) return;

        const alQuery = `query ($userId: Int) { MediaListCollection(userId: $userId, type: ANIME) { lists { entries { progress status media { id idMal title { english romaji } } } } } }`;
        const alRes = await apiRequest(alQuery, { userId: storage.anilistUserId }, storage.anilistToken);
        const alEntries = []; alRes.data?.MediaListCollection?.lists?.forEach(l => alEntries.push(...l.entries));

        let malEntries = []; let nextUrl = `https://api.myanimelist.net/v2/users/@me/animelist?fields=list_status&limit=1000`;
        while (nextUrl) {
          const malRes = await fetch(nextUrl, { headers: { 'Authorization': `Bearer ${storage.malToken}` } });
          const malData = await malRes.json();
          if (malData.data) malEntries.push(...malData.data);
          nextUrl = malData.paging?.next || null;
        }

        const alMap = new Map(); alEntries.forEach(e => { if (e.media?.idMal) alMap.set(e.media.idMal, e); });
        const malMap = new Map(); malEntries.forEach(e => malMap.set(e.node.id, e));

        const syncQueue = []; 
        alMap.forEach((alEntry, idMal) => {
          const malEntry = malMap.get(idMal);
          const alProg = alEntry.progress || 0, title = alEntry.media.title.english || alEntry.media.title.romaji;
          if (!malEntry) syncQueue.push({ platform: 'MAL', id: idMal, progress: alProg, status: alEntry.status, title });
          else {
            const malProg = malEntry.list_status.num_episodes_watched || 0;
            if (alProg > malProg) syncQueue.push({ platform: 'MAL', id: idMal, progress: alProg, status: alEntry.status, title });
            else if (malProg > alProg) syncQueue.push({ platform: 'AL', id: alEntry.media.id, progress: malProg, status: malEntry.list_status.status, title });
          }
        });

        malMap.forEach((malEntry, idMal) => {
          if (!alMap.has(idMal)) syncQueue.push({ platform: 'AL_LOOKUP', idMal: idMal, progress: malEntry.list_status.num_episodes_watched, status: malEntry.list_status.status, title: malEntry.node.title });
        });

        if (syncQueue.length === 0) return chrome.runtime.sendMessage({ action: "SYNC_COMPLETE", updatesMade: 0 }).catch(() => {});

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
              const findRes = await apiRequest(`query($idMal: Int) { Media(idMal: $idMal, type: ANIME) { id } }`, { idMal: task.idMal }, storage.anilistToken);
              await new Promise(resolve => setTimeout(resolve, 500)); 
              if (findRes.data && findRes.data.Media) {
                const anilistId = findRes.data.Media.id;
                let aniStatus = 'CURRENT';
                if (task.status === 'completed') aniStatus = 'COMPLETED';
                if (task.status === 'on_hold') aniStatus = 'PAUSED';
                if (task.status === 'dropped') aniStatus = 'DROPPED';
                if (task.status === 'plan_to_watch') aniStatus = 'PLANNING';
                await apiRequest(`mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) { SaveMediaListEntry (mediaId: $mediaId, progress: $progress, status: $status) { id } }`, { mediaId: anilistId, progress: task.progress, status: aniStatus }, storage.anilistToken);
              }
            }
          } catch (e) {}
          await new Promise(resolve => setTimeout(resolve, 1500)); 
        }
        chrome.runtime.sendMessage({ action: "SYNC_COMPLETE", updatesMade: syncQueue.length }).catch(() => {});
      } catch (err) {}
    })();
    return false;
  }
  else if (message.action === "FETCH_CLOUD_PREFS") {
    (async () => {
      try {
        const getUrl = `${SUPABASE_URL}/rest/v1/user_stats?anilist_user_id=eq.${message.userId}&select=tracking_data`;
        const getRes = await fetch(getUrl, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
        const data = await getRes.json();
        if (data && data.length > 0 && data[0].tracking_data?.cloud_settings) {
          const cloud = data[0].tracking_data.cloud_settings;
          await chrome.storage.local.set({ trackingThreshold: cloud.threshold, autoSkipEnabled: cloud.autoSkip, cloud_mal_linked: cloud.linked_mal });
        }
        sendResponse({ success: true });
      } catch (e) { sendResponse({ success: false }); }
    })();
    return true;
  }
  return false; 
});

async function checkForNewEpisodes() {
  const storage = await chrome.storage.local.get(['anilistToken', 'anilistUserId', 'lastNotifiedEpisodes']);
  if (!storage.anilistToken || !storage.anilistUserId) return;
  try {
    const query = `query ($userId: Int) { MediaListCollection(userId: $userId, type: ANIME, status: CURRENT) { lists { entries { media { id title { romaji english } nextAiringEpisode { airingAt episode } } } } } }`;
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
        const airTime = media.nextAiringEpisode.airingAt, epNum = media.nextAiringEpisode.episode;
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
        chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title: 'New Episode Available! 🍿', message: `Episode ${anime.episode} of ${anime.title} just finished airing in Japan.` });
      });
    }
  } catch(error) {}
}

async function checkListDesync() {
  const storage = await chrome.storage.local.get(['anilistToken', 'anilistUserId', 'malToken']);
  if (!storage.anilistToken || !storage.malToken || !storage.anilistUserId) return;
  try {
    const alQuery = `query ($userId: Int) { MediaListCollection(userId: $userId, type: ANIME, status: CURRENT) { lists { entries { progress status media { id idMal title { english romaji } } } } } }`;
    const alRes = await apiRequest(alQuery, { userId: storage.anilistUserId }, storage.anilistToken);
    const alEntries = []; alRes.data?.MediaListCollection?.lists?.forEach(l => alEntries.push(...l.entries));

    let malEntries = []; let nextUrl = `https://api.myanimelist.net/v2/users/@me/animelist?status=watching&fields=list_status&limit=1000`;
    while (nextUrl) {
      const malRes = await fetch(nextUrl, { headers: { 'Authorization': `Bearer ${storage.malToken}` } });
      const malData = await malRes.json();
      if (malData.data) malEntries.push(...malData.data);
      nextUrl = malData.paging?.next || null;
    }
    const malMap = new Map(); malEntries.forEach(e => malMap.set(e.node.id, e));

    const desyncCache = {};
    alEntries.forEach(alEntry => {
      if (alEntry.media?.idMal) {
        const malEntry = malMap.get(alEntry.media.idMal);
        if (malEntry) {
          const alProg = alEntry.progress || 0, malProg = malEntry.list_status.num_episodes_watched || 0;
          if (alProg !== malProg) {
            desyncCache[alEntry.media.id] = { mediaId: alEntry.media.id, malId: alEntry.media.idMal, title: alEntry.media.title.english || alEntry.media.title.romaji, alProgress: alProg, malProgress: malProg, status: alEntry.status };
          }
        }
      }
    });
    await chrome.storage.local.set({ desync_cache: desyncCache });
  } catch (e) {}
}