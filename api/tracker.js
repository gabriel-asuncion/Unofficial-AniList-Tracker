// api/tracker.js
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';
import { ACHIEVEMENTS } from '../achievements.js';
import { apiRequest, findAniListMedia, findUnifiedManga, getTodayFuzzy } from './anilist.js';
import { updateMalProgress, malApiRequest } from './mal.js';

export const activeSessions = {};
export const lastSaveTimes = {};

export async function getSessionData(key, defaultVal = {}) {
  const res = await chrome.storage.session.get([key]);
  return res[key] || defaultVal;
}

export async function setSessionData(key, value) {
  await chrome.storage.session.set({ [key]: value });
}

export async function queueFailedUpdate(mediaId, progress, status, token) {
  const res = await chrome.storage.local.get(['offlineQueue']);
  let offlineQueue = res.offlineQueue || [];
  const existingIndex = offlineQueue.findIndex(item => item.mediaId === mediaId);
  
  if (existingIndex > -1) {
    if (progress > offlineQueue[existingIndex].progress) {
      offlineQueue[existingIndex] = { mediaId, progress, status, token, timestamp: Date.now() };
    }
  } else {
    offlineQueue.push({ mediaId, progress, status, token, timestamp: Date.now() });
  }
  await chrome.storage.local.set({ offlineQueue });
}

export async function processOfflineQueue() {
  const res = await chrome.storage.local.get(['offlineQueue']);
  const offlineQueue = res.offlineQueue || [];
  if (offlineQueue.length === 0) return;
  
  let remainingQueue = [];
  for (const item of offlineQueue) {
    const mutation = `mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) { SaveMediaListEntry (mediaId: $mediaId, progress: $progress, status: $status) { id } }`;
    try {
      const apiRes = await apiRequest(mutation, { mediaId: item.mediaId, progress: item.progress, status: item.status }, item.token);
      if (apiRes.errors) throw new Error("API Rejected");
    } catch (e) {
      remainingQueue.push(item);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await chrome.storage.local.set({ offlineQueue: remainingQueue });
}

export async function getOtgTimeFromSupabase(userId, mediaId, episode) {
  try {
    const safeEp = Math.floor(episode);
    const url = `${SUPABASE_URL}/rest/v1/otg_saves?anilist_user_id=eq.${userId}&media_id=eq.${mediaId}&episode=eq.${safeEp}&select=playback_time,source_url`;
    const res = await fetch(url, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
    const data = await res.json();
    if (data && data.length > 0) return { time: data[0].playback_time, url: data[0].source_url };
    return null;
  } catch (error) { return null; }
}

export async function saveOtgTimeToSupabase(userId, mediaId, episode, time, sourceUrl, customTitle = null, platform = 'ANILIST') {
  try {
    const safeEp = Math.floor(episode);
    const url = `${SUPABASE_URL}/rest/v1/otg_saves?on_conflict=anilist_user_id,media_id,episode`;
    await fetch(url, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ anilist_user_id: userId, media_id: mediaId, episode: safeEp, playback_time: Math.round(time), source_url: sourceUrl, custom_title: customTitle, platform: platform })
    });
  } catch (error) {}
}

export async function deleteOtgTimeFromSupabase(userId, mediaId, episode) {
  try {
    const safeEp = Math.floor(episode);
    const url = `${SUPABASE_URL}/rest/v1/otg_saves?anilist_user_id=eq.${userId}&media_id=eq.${mediaId}&episode=eq.${safeEp}`;
    await fetch(url, { method: 'DELETE', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
  } catch (error) {}
}

export async function deleteOldEpisodesFromSupabase(userId, mediaId, currentEpisode) {
  try {
    const safeEp = Math.floor(currentEpisode);
    const url = `${SUPABASE_URL}/rest/v1/otg_saves?anilist_user_id=eq.${userId}&media_id=eq.${mediaId}&episode=lt.${safeEp}`;
    await fetch(url, { method: 'DELETE', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
  } catch (error) {}
}

export async function syncUserStatsToSupabase(userId, addedSeconds, isRetroactive = false) {
  if (!isRetroactive && (!addedSeconds || addedSeconds < 5)) return null;
  try {
    const storage = await chrome.storage.local.get(['anilistUsername', 'anilistAvatar', 'timeSavedSeconds', 'trackingThreshold', 'autoSkipEnabled', 'malToken']);
    let currentSeconds = 0, unlockedTrophies = [], trackingData = {};

    const getUrl = `${SUPABASE_URL}/rest/v1/user_stats?anilist_user_id=eq.${userId}&select=true_watch_seconds,unlocked_achievements,tracking_data`;
    const getRes = await fetch(getUrl, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
    const data = await getRes.json();
    
    if (data && data.length > 0) {
      currentSeconds = data[0].true_watch_seconds || 0;
      unlockedTrophies = data[0].unlocked_achievements || [];
      trackingData = data[0].tracking_data || {};
    }

    trackingData.cloud_settings = { threshold: storage.trackingThreshold || 80, autoSkip: storage.autoSkipEnabled || false, linked_mal: !!storage.malToken };
    const totalSeconds = currentSeconds + addedSeconds;
    const totalMinutes = totalSeconds / 60;
    let newLevel = Math.floor(1 + 99 * Math.sqrt(totalMinutes / 500000));
    if (newLevel > 100) newLevel = 100;

    const todayStr = new Date().toDateString();
    if (trackingData.last_watch_date === todayStr) {
      trackingData.episodes_today = (trackingData.episodes_today || 0) + 1;
    } else {
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      if (trackingData.last_watch_date === yesterday.toDateString()) trackingData.streak = (trackingData.streak || 0) + 1;
      else trackingData.streak = 1; 
      trackingData.episodes_today = 1;
      trackingData.last_watch_date = todayStr;
    }
    
    trackingData.total_time_saved = (trackingData.total_time_saved || 0) + (storage.timeSavedSeconds || 0);
    await chrome.storage.local.set({ timeSavedSeconds: 0 }); 
    trackingData.total_episodes_tracked = (trackingData.total_episodes_tracked || 0) + 1;
    if (isRetroactive) trackingData.has_synced_history = true;

    let newlyUnlocked = [];
    const currentStats = {
      totalEpisodesTracked: trackingData.total_episodes_tracked || 0, episodesToday: trackingData.episodes_today || 0, streak: trackingData.streak || 0,
      timeSavedSeconds: trackingData.total_time_saved || 0, trueWatchSeconds: totalSeconds, level: newLevel, hourOfDay: new Date().getHours(),
      dayOfWeek: new Date().getDay(), completedSeries: trackingData.completed_series || 0, ratingsSubmitted: trackingData.ratings_submitted || 0  
    };

    ACHIEVEMENTS.forEach(achievement => {
      if (!unlockedTrophies.includes(achievement.id) && achievement.check(currentStats)) newlyUnlocked.push(achievement.id);
    });

    if (newlyUnlocked.length > 0) unlockedTrophies = [...unlockedTrophies, ...newlyUnlocked];

    const upsertUrl = `${SUPABASE_URL}/rest/v1/user_stats?on_conflict=anilist_user_id`;
    await fetch(upsertUrl, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ anilist_user_id: userId, username: storage.anilistUsername || "Unknown", avatar_url: storage.anilistAvatar || "", true_watch_seconds: totalSeconds, level: newLevel, unlocked_achievements: unlockedTrophies, tracking_data: trackingData })
    });
    return { level: newLevel, totalMinutes: totalMinutes, gainedMins: Math.floor(addedSeconds / 60) };
  } catch (error) { return null; }
}

export async function processAutoUpdate(tabTitle, tabId, trueWatchSeconds, frameId = 0) {
  let xpData = null; 
  try {
    const result = await findAniListMedia(tabTitle);
    if (!result || !result.media) {
      chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' }); chrome.action.setBadgeText({ text: 'ERR' });
      return;
    }

    const { media, episode, token } = result;
    const intEpisode = Math.floor(episode);
    const currentProg = media.mediaListEntry ? media.mediaListEntry.progress : 0;
    const animeName = media.title.english || media.title.romaji;
    let isCompleted = false; 
    const storage = await chrome.storage.local.get(['anilistUserId', 'malToken']);
    let updatedPlatforms = [];

    if (currentProg < intEpisode) {
      let newStatus = 'CURRENT', startedAt = undefined, completedAt = undefined;
      if (intEpisode === 1 && currentProg === 0) startedAt = getTodayFuzzy();
      if (media.episodes && intEpisode >= media.episodes) { newStatus = 'COMPLETED'; completedAt = getTodayFuzzy(); isCompleted = true; }

      try {
        const mutation = `mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) { SaveMediaListEntry (mediaId: $mediaId, progress: $progress, status: $status, startedAt: $startedAt, completedAt: $completedAt) { id } }`;
        const variables = { mediaId: media.id, progress: intEpisode, status: newStatus };
        if (startedAt) variables.startedAt = startedAt; if (completedAt) variables.completedAt = completedAt;
        await apiRequest(mutation, variables, token);
        updatedPlatforms.push("AniList");
        
        chrome.storage.local.get(['full_watchlist_cache'], (res) => {
            if (res.full_watchlist_cache && res.full_watchlist_cache.data) {
                const entry = res.full_watchlist_cache.data.find(e => e.media.id === media.id);
                if (entry) { entry.progress = intEpisode; entry.status = newStatus; } 
                else { res.full_watchlist_cache.data.push({ progress: intEpisode, status: newStatus, media: media }); }
                chrome.storage.local.set({ full_watchlist_cache: res.full_watchlist_cache });
            }
            setTimeout(() => chrome.storage.local.set({ trigger_dom_refresh: Date.now() }), 500);
        });
        processOfflineQueue();
      } catch (networkError) { queueFailedUpdate(media.id, intEpisode, newStatus, token); }

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
        } catch (e) {}
      }
      if (storage.anilistUserId) xpData = await syncUserStatsToSupabase(storage.anilistUserId, trueWatchSeconds);
    } else if (media.episodes && currentProg >= media.episodes) isCompleted = true;

    if (activeSessions[tabId]) delete activeSessions[tabId];
    if (storage.anilistUserId) await deleteOtgTimeFromSupabase(storage.anilistUserId, media.id, intEpisode);

    chrome.action.setBadgeBackgroundColor({ color: '#4cca51' }); chrome.action.setBadgeText({ text: '✓' });
    let platformText = updatedPlatforms.length > 1 ? "both AniList & MAL" : (updatedPlatforms[0] || "API");
    let toastMessage = `${animeName} updated to Episode ${intEpisode} on ${platformText}!`;
    if (updatedPlatforms.length === 0 && currentProg >= intEpisode) toastMessage = `${animeName} is already at Episode ${intEpisode}!`;

    if (isCompleted) {
      chrome.tabs.sendMessage(tabId, { action: "SHOW_RATING_MODAL", mediaId: media.id, malId: media.idMal, isMalOnly: media.isMalOnly, animeName: animeName, mediaType: 'ANIME' }, { frameId: frameId }).catch(() => {});
    } else if (updatedPlatforms.length > 0) {
      chrome.tabs.sendMessage(tabId, { action: "SHOW_SUCCESS_TOAST", message: toastMessage, xpData: xpData }, { frameId: frameId }).catch(() => {}); 
    }
  } catch (error) {
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' }); chrome.action.setBadgeText({ text: 'ERR' });
  }
}

export async function processMangaAutoUpdate(cleanTitle, chapter, tabId, readingData, frameId = 0) {
  let xpData = null; 
  try {
    const result = await findUnifiedManga(cleanTitle, chapter);
    if (!result || !result.media) {
      chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' }); chrome.action.setBadgeText({ text: 'ERR' });
      return;
    }

    const { media, token, platform } = result;
    const intChapter = Math.floor(result.chapter);
    const currentProg = media.mediaListEntry ? media.mediaListEntry.progress : 0;
    const mangaName = media.title.english || media.title.romaji;
    let isCompleted = false, updatedPlatforms = [];
    const storage = await chrome.storage.local.get(['anilistUserId', 'malToken']);

    if (currentProg < intChapter) {
      let newStatus = 'CURRENT', startedAt = undefined, completedAt = undefined;
      if (intChapter === 1 && currentProg === 0) startedAt = getTodayFuzzy();
      if (media.chapters && intChapter >= media.chapters && media.status === 'FINISHED') { newStatus = 'COMPLETED'; completedAt = getTodayFuzzy(); isCompleted = true; }

      if (platform === 'ANILIST') {
        try {
          const mutation = `mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) { SaveMediaListEntry (mediaId: $mediaId, progress: $progress, status: $status, startedAt: $startedAt, completedAt: $completedAt) { id } }`;
          const variables = { mediaId: media.id, progress: intChapter, status: newStatus };
          if (startedAt) variables.startedAt = startedAt; if (completedAt) variables.completedAt = completedAt;
          await apiRequest(mutation, variables, token);
          updatedPlatforms.push("AniList");
          
          chrome.storage.local.get(['full_watchlist_cache'], (res) => {
              if (res.full_watchlist_cache && res.full_watchlist_cache.data) {
                  const entry = res.full_watchlist_cache.data.find(e => e.media.id === media.id);
                  if (entry) { entry.progress = intChapter; entry.status = newStatus; } 
                  else { res.full_watchlist_cache.data.push({ progress: intChapter, status: newStatus, media: media }); }
                  chrome.storage.local.set({ full_watchlist_cache: res.full_watchlist_cache });
              }
              setTimeout(() => chrome.storage.local.set({ trigger_dom_refresh: Date.now() }), 500);
          });
          processOfflineQueue();
        } catch (networkError) { queueFailedUpdate(media.id, intChapter, newStatus, token); }

        if (media.idMal && storage.malToken) {
          try {
            await updateMalProgress(media.idMal, intChapter, newStatus, 'MANGA', storage.malToken);
            updatedPlatforms.push("MAL");
          } catch (e) {}
        }
      } else if (platform === 'MAL') {
        try {
          await updateMalProgress(media.idMal || Math.abs(media.id), intChapter, newStatus, 'MANGA', token);
          updatedPlatforms.push("MAL");
        } catch (e) {}
      }

      if (storage.anilistUserId) {
        let calculatedXp = 1; 
        if (readingData && readingData.readingType === 'page' && readingData.totalPages > 0) {
          calculatedXp += Math.floor(readingData.totalPages / 5);
        } else if (readingData && readingData.readingType === 'scroll' && readingData.viewportHeight > 0) {
          const virtualPages = Math.floor(readingData.scrollHeight / readingData.viewportHeight);
          calculatedXp += Math.floor(virtualPages / 14);
        }
        if (calculatedXp > 50) calculatedXp = 50;
        xpData = await syncUserStatsToSupabase(storage.anilistUserId, calculatedXp * 60);
      }
      
    } else if (media.chapters && currentProg >= media.chapters && media.status === 'FINISHED') isCompleted = true;

    if (activeSessions[tabId]) delete activeSessions[tabId];
    if (storage.anilistUserId) await deleteOtgTimeFromSupabase(storage.anilistUserId, media.id, intChapter);

    chrome.action.setBadgeBackgroundColor({ color: '#4cca51' }); chrome.action.setBadgeText({ text: '✓' });
    let platformText = updatedPlatforms.length > 1 ? "both AniList & MAL" : (updatedPlatforms[0] || "API");
    let toastMessage = `${mangaName} updated to Chapter ${intChapter} on ${platformText}!`;
    if (updatedPlatforms.length === 0 && currentProg >= intChapter) toastMessage = `${mangaName} is already at Chapter ${intChapter}!`;

    if (isCompleted) chrome.tabs.sendMessage(tabId, { action: "SHOW_RATING_MODAL", mediaId: media.id, malId: media.idMal, isMalOnly: media.isMalOnly, animeName: mangaName, mediaType: 'MANGA' });
    else chrome.tabs.sendMessage(tabId, { action: "SHOW_SUCCESS_TOAST", message: toastMessage, xpData: xpData }); 

  } catch (error) {
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' }); chrome.action.setBadgeText({ text: 'ERR' });
  }
}