// api/anilist.js
import { malApiRequest, standardizeMalMedia } from './mal.js';

export async function apiRequest(query, variables, token) {
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ query, variables })
  });
  return response.json();
}

export function getTodayFuzzy() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

export function hashStringToNegativeInt(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; 
  }
  return -Math.abs(hash || 999999);
}

export function getSearchPermutations(title) {
  const base = title.replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();
  const noBrackets = base.replace(/\[.*?\]|\(.*?\)/g, '').trim();
  const noPunc = noBrackets.replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
  const shortTerm = noPunc.split(' ').slice(0, 4).join(' '); 
  const splitDash = base.split(/[:\-]/)[0].trim();
  return [...new Set([base, noBrackets, noPunc, splitDash, shortTerm])].filter(t => t.length > 2);
}

export async function findAniListMedia(tabTitle) {
  const storage = await chrome.storage.local.get(['anilistToken']);
  const token = storage.anilistToken;
  if (!token) return null;

  const regex = /(?:Watch\s+)?(.*?)\s*(?:[-|—–:~]+\s*)?(?:Season\s*\d+\s*)?\b(?:Episode|Ep)\b\.?\s*0*(\d+)/i;
  const match = tabTitle.match(regex);
  if (!match || !match[1] || !match[2]) return null;

  const parsedTitle = match[1].replace(/[-|—–:~]+$/g, '').replace(/\s+\(?(?:Sub|Dub)\)?$/i, '').trim();
  const episode = parseInt(match[2], 10);
  const perms = getSearchPermutations(parsedTitle);

  const query = `
    query ($search: String) {
      Media (search: $search, type: ANIME, sort: SEARCH_MATCH) {
        id idMal title { romaji english } coverImage { large } episodes
        mediaListEntry { id progress status }
      }
    }
  `;

  for (const term of perms) {
    const res = await apiRequest(query, { search: term }, token);
    if (res.data?.Media) return { media: res.data.Media, episode, token };
  }

  for (const term of perms) {
    try {
      const tRes = await fetch(`https://api.tenrai.org/v1/anime?q=${encodeURIComponent(term)}&limit=1`);
      if (tRes.ok) {
        const tData = await tRes.json();
        if (tData?.data && tData.data.length > 0) {
          const malId = tData.data[0].mal_id;
          const crossRefQuery = `query($idMal: Int) { Media(idMal: $idMal, type: ANIME) { id idMal title { romaji english } coverImage { large } episodes mediaListEntry { id progress status } } }`;
          const crossRefRes = await apiRequest(crossRefQuery, { idMal: malId }, token);
          if (crossRefRes.data?.Media) return { media: crossRefRes.data.Media, episode, token };
        }
      }
    } catch (e) {}
  }
  return null;
}

export async function findUnifiedManga(cleanTitle, chapter) {
  const storage = await chrome.storage.local.get(['anilistToken', 'malToken']);
  const perms = getSearchPermutations(cleanTitle);
  let resolvedMalId = null;
  
  if (storage.anilistToken) {
    const aniQuery = `query ($search: String) { Media (search: $search, type: MANGA, sort: SEARCH_MATCH) { id idMal status title { romaji english } coverImage { large } chapters mediaListEntry { id progress status } } }`;
    for (const term of perms) {
      try {
        const aniRes = await apiRequest(aniQuery, { search: term }, storage.anilistToken);
        if (aniRes.data?.Media) return { media: aniRes.data.Media, chapter, token: storage.anilistToken, platform: 'ANILIST' };
      } catch (e) {}
    }
    for (const term of perms) {
      try {
        const tenraiRes = await fetch(`https://api.tenrai.org/v1/manga?q=${encodeURIComponent(term)}&limit=1`);
        if (tenraiRes.ok) {
          const tenraiData = await tenraiRes.json();
          if (tenraiData?.data && tenraiData.data.length > 0) {
            resolvedMalId = tenraiData.data[0].mal_id;
            const crossRefQuery = `query($idMal: Int) { Media(idMal: $idMal, type: MANGA) { id idMal status title { romaji english } coverImage { large } chapters mediaListEntry { id progress status } } }`;
            const crossRefRes = await apiRequest(crossRefQuery, { idMal: resolvedMalId }, storage.anilistToken);
            if (crossRefRes.data?.Media) return { media: crossRefRes.data.Media, chapter, token: storage.anilistToken, platform: 'ANILIST' };
            break;
          }
        }
      } catch (e) {}
    }
  }

  if (storage.malToken) {
    if (resolvedMalId) {
      try {
        const searchRes = await malApiRequest(`manga/${resolvedMalId}?fields=id,title,alternative_titles,main_picture,status,num_chapters,my_list_status`, 'GET', null, storage.malToken);
        if (searchRes && searchRes.id) {
          const standardizedMedia = standardizeMalMedia(searchRes, searchRes.my_list_status, 'MANGA');
          return { media: standardizedMedia, chapter, token: storage.malToken, platform: 'MAL' };
        }
      } catch (e) {}
    }
    for (const term of perms) {
      try {
        const searchRes = await malApiRequest(`manga?q=${encodeURIComponent(term)}&limit=1&fields=id,title,alternative_titles,main_picture,status,num_chapters,my_list_status`, 'GET', null, storage.malToken);
        if (searchRes.data && searchRes.data.length > 0) {
          const malNode = searchRes.data[0].node;
          const standardizedMedia = standardizeMalMedia(malNode, malNode.my_list_status, 'MANGA');
          return { media: standardizedMedia, chapter, token: storage.malToken, platform: 'MAL' };
        }
      } catch (e) {}
    }
  }
  return null; 
}