// api/mal.js
import { MAL_CLIENT_ID } from '../config.js';

export async function malApiRequest(endpoint, method = 'GET', data = null, token) {
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

export function standardizeMalMedia(malNode, listStatus, type) {
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
    title: { romaji: malNode.title, english: malNode.alternative_titles?.en || malNode.title },
    coverImage: { large: malNode.main_picture?.large || '', medium: malNode.main_picture?.medium || '' },
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

export async function refreshMalToken() {
  const storage = await chrome.storage.local.get(['malRefreshToken']);
  if (!storage.malRefreshToken) return null;

  try {
    const response = await fetch('https://myanimelist.net/v1/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: MAL_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: storage.malRefreshToken
      })
    });

    const data = await response.json();
    if (data.access_token) {
      await chrome.storage.local.set({ malToken: data.access_token, malRefreshToken: data.refresh_token });
      return data.access_token;
    }
    return null;
  } catch (error) {
    console.error("Failed to refresh MAL token:", error);
    return null;
  }
}

export async function safeMalApiRequest(endpoint, method = 'GET', data = null, token) {
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

export async function updateMalProgress(malId, progress, status, type, token) {
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