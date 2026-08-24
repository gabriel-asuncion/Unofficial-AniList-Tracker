// content/parser.js
const IGNORE_UI_WORDS = new Set([
  'home', 'browse', 'discover', 'explore', 'search', 'filter', 'filters', 'categories', 'category', 'genres', 'genre', 'tags', 'tag',
  'directory', 'library', 'collection', 'latest', 'recent', 'recently', 'new', 'newest', 'popular', 'trending', 'featured', 'recommended', 
  'top', 'top rated', 'highest rated', 'most viewed', 'most popular', 'ongoing', 'completed', 'upcoming', 'airing', 'finished', 'coming soon',
  'schedule', 'calendar', 'today', 'yesterday', 'this week', 'this month', 'this season', 'season', 'winter', 'spring', 'summer', 'fall', 
  'tv', 'movie', 'movies', 'ova', 'ona', 'special', 'music', 'cm', 'pv', 'promo', 'trailer', 'episodes', 'episode', 'ep', 'chapters', 'chapter', 'ch',
  'volumes', 'volume', 'vol', 'continue', 'continue watching', 'continue reading', 'start reading', 'start watching', 'watch now', 'read now', 
  'watch', 'read', 'play', 'play now', 'details', 'more details', 'read more', 'show more', 'show less', 'load more', 'see more', 'view more', 
  'view all', 'view', 'open', 'close', 'expand', 'collapse', 'next', 'previous', 'prev', 'back', 'forward', 'go', 'submit', 'cancel', 'done', 
  'finish', 'continue', 'login', 'log in', 'logout', 'log out', 'sign in', 'sign up', 'register', 'create account', 'forgot password', 'profile', 'account', 
  'settings', 'preferences', 'history', 'watch history', 'reading history', 'notifications', 'notification', 'messages', 'favorites', 'favourites', 
  'bookmark', 'bookmarks', 'add to list', 'my list', 'list', 'lists', 'comments', 'comment', 'reviews', 'review', 'discussion', 'discussions', 
  'forum', 'forums', 'reply', 'replies', 'share', 'report', 'follow', 'unfollow', 'like', 'likes', 'favorite', 'favourite', 'vote', 'votes', 
  'sub', 'dub', 'raw', 'aud', 'softsub', 'hardsub', 'server', 'servers', 'stream', 'streaming', 'download', 'downloads', 'mirror', 'mirrors', 
  'quality', 'resolution', 'autoplay', 'autonext', 'skip intro', 'skip outro', 'fullscreen', 'pip', 'picture in picture', 'speed', 'volume',
  'online', 'offline', 'available', 'unavailable', 'active', 'inactive', 'loading', 'loaded', 'error', 'failed', 'success', 'retry', 'refresh', 
  'reload', 'search results', 'no results', 'search...', 'clear', 'sort', 'sort by', 'ascending', 'descending', 'page', 'pages', 'first', 'last', 
  'older', 'newer', 'advertisement', 'advertisements', 'sponsored', 'promo', 'announcement', 'news', 'events', 'score distribution', 'current progress', 
  'al stats', 'mal stats', 'statistics', 'stats', 'rating', 'ratings', 'rank', 'ranking', 'popularity', 'favorites', 'members', 'users', 'general', 'overview', 
  'summary', 'info', 'information', 'description', 'all', 'none', 'other', 'more', 'less', 'yes', 'no', 'ok', 'okay', 'mon', 'monday', 'tue', 'tuesday', 'wed', 'wednesday', 'thu', 'thursday', 'fri', 'friday', 'sat', 'saturday', 'sun', 'sunday'
]);

function getDeepVideos(root = document) {
  let videos = Array.from(root.querySelectorAll('video'));
  let allElements = root.querySelectorAll('*');
  for (let el of allElements) {
    if (el.shadowRoot) videos = videos.concat(getDeepVideos(el.shadowRoot));
  }
  return videos;
}

function getActiveMediaType() {
  const title = document.title || "";
  const url = window.location.href || "";
  
  const animeRegex = /(?:Watch\s+)?(.*?)\s*(?:[-|—–:~]+\s*)?(?:Season\s*\d+\s*)?\b(?:Episode|Ep)\b\.?\s*0*(\d+)/i;
  if (animeRegex.test(title)) return 'ANIME';
  
  const chapRegex = /\b(?:Chapter|Chap|Ch)\b\.?\s*0*(\d+(\.\d+)?)/i;
  const looseRegex = /[-|\|]\s*0*(\d+(\.\d+)?)\s*(?:\||-|$)/;
  if (chapRegex.test(title)) return 'MANGA';
  
  const isMangaSite = /manga|manhwa|manhua|webtoon|comic|read/i.test(title) || /manga|manhwa|manhua|webtoon|comic|read/i.test(url) || siteForcedType === 'MANGA';
  if (isMangaSite && looseRegex.test(title)) return 'MANGA';
  
  const videos = getDeepVideos();
  if (videos.some(v => !isNaN(v.duration) && v.duration > 100)) return 'ANIME';
  
  return siteForcedType || 'ANIME'; 
}

function cleanMangaTitle(rawTitle) {
  let chapter = null; let targetText = rawTitle; const url = window.location.href || "";
  const chapRegex = /\b(?:Chapter|Chap|Ch)\b\.?\s*0*(\d+(\.\d+)?)/i;
  const looseRegex = /[-|\|]\s*0*(\d+(\.\d+)?)\s*(?:\||-|$)/;
  let chapMatch = rawTitle.match(chapRegex);
  
  if (!chapMatch) {
    const isMangaSite = /manga|manhwa|manhua|webtoon|comic|read/i.test(rawTitle) || /manga|manhwa|manhua|webtoon|comic|read/i.test(url);
    if (isMangaSite) chapMatch = rawTitle.match(looseRegex);
  }
  if (chapMatch) {
    chapter = parseFloat(chapMatch[1]);
    const leftSide = rawTitle.substring(0, chapMatch.index).trim();
    const rightSide = rawTitle.substring(chapMatch.index + chapMatch[0].length).trim();
    const cleanLeft = leftSide.replace(/[()[\]|]/g, '').trim();
    if (cleanLeft === '' || /^(?:page\s*)?\d+\s*[-/]?\s*(?:\d+)?$/i.test(cleanLeft)) targetText = rightSide.replace(/[-|—|\|]\s*[a-zA-Z0-9]+$/i, '').trim();
    else targetText = leftSide;
  }
  let clean = targetText.replace(/\b(?:Read|Watch|Free|English|Online|Scanlation|Scans|Scan|Manga|Manhwa|Manhua|Webtoon)\b/gi, '');
  clean = clean.replace(/\[.*?\]|\(.*?\)/g, '');
  clean = clean.replace(/^[-|—–:~,\|\s]+|[-|—–:~,\|\s]+$/g, '').replace(/\s{2,}/g, ' ').trim();
  return { title: clean, chapter: chapter };
}

function normalizeTitle(title) {
  if (!title) return "";
  return title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function extractSeasonNumber(text) {
  const sMatch = text.match(/\b(?:season|part)\s+(\d+)\b/i) || text.match(/\b(\d+)(?:st|nd|rd|th)\s+(?:season|part)\b/i) || text.match(/\b(\d+)\b$/); 
  return sMatch ? parseInt(sMatch[1], 10) : null;
}

function isTitleMatch(normRaw, normTarget) {
  if (!normRaw || !normTarget) return false;
  if (normRaw === normTarget) return true;
  
  const rawSeason = extractSeasonNumber(normRaw);
  const targetSeason = extractSeasonNumber(normTarget);
  
  if (rawSeason && targetSeason && rawSeason !== targetSeason) return false;
  if (rawSeason && rawSeason > 1 && !targetSeason) return false; 
  if (targetSeason && targetSeason > 1 && !rawSeason) return false; 

  if (normRaw.length >= 4 && normTarget.startsWith(normRaw)) return true;
  if (normTarget.length >= 4 && normRaw.startsWith(normTarget)) return true;
  if (normRaw.length > 8 && normTarget.includes(normRaw)) return true;
  if (normTarget.length > 8 && normRaw.includes(normTarget)) return true;
  return false;
}

function isPageTitleMatch(pageTitle, targetTitle) {
  return isTitleMatch(pageTitle, targetTitle); 
}

function getPageMainShowTitle() {
  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
  const h1Text = document.querySelector('h1')?.textContent || '';
  let candidate = h1Text.trim() || ogTitle.trim() || document.title || '';
  candidate = candidate.replace(/^(?:Watch|Stream|Read)\s+/i, '').replace(/\s*(?:-?\s*(Watch Free|Online Free|English Sub|Subbed|Dubbed)).*$/i, '').replace(/\s*\|.*$/g, '').replace(/\s*-?\s*Anime Nexus.*$/i, '').replace(/\s*\(\d{4}\).*$/g, '').trim();
  return candidate;
}

function parseSubtitlesForOpEd(vttContent, videoDuration, targetDuration = 88) {
  if (!vttContent || typeof vttContent !== 'string') return null;

  const parseTimestamp = (timeStr) => {
    const parts = timeStr.trim().split(':');
    let seconds = 0;
    if (parts.length === 3) seconds = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
    else if (parts.length === 2) seconds = parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    return seconds;
  };

  const lines = vttContent.split(/\r?\n/);
  const cues = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('-->')) {
      const times = lines[i].split('-->');
      const start = parseTimestamp(times[0]);
      const end = parseTimestamp(times[1]);
      let text = '';
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== '' && !lines[j].includes('-->')) {
        text += lines[j] + ' '; j++;
      }
      const isSongLyric = /[♪♫]|<i>|<\/i>|<c\.lyrics>/i.test(text);
      const isShortSign = text.trim().split(/\s+/).length <= 2;
      cues.push({ start, end, text: text.trim(), isSongLyric, isShortSign });
    }
  }

  if (cues.length === 0) return null;
  const maxSearchTime = Math.min(videoDuration * 0.5, 720);

  for (let t = 0; t <= maxSearchTime - targetDuration; t += 5) {
    const windowStart = t;
    const windowEnd = t + targetDuration;
    const dialogueCount = cues.filter(c => c.start >= windowStart && c.end <= windowEnd && !c.isSongLyric && !c.isShortSign).length;
    if (dialogueCount <= 1) return { found: true, type: 'op', interval: { startTime: windowStart, endTime: windowEnd } };
  }
  return null;
}

async function fetchAndAnalyzeSubtitles(videoDuration, targetDuration) {
  try {
    const trackElements = Array.from(document.querySelectorAll('track'));
    const subTrack = trackElements.find(t => t.src && (t.kind === 'subtitles' || t.kind === 'captions' || t.src.includes('.vtt')));

    if (subTrack && subTrack.src) {
      const res = await fetch(subTrack.src);
      if (res.ok) {
        const vttText = await res.text();
        return parseSubtitlesForOpEd(vttText, videoDuration, targetDuration); 
      }
    }
  } catch (e) {}
  return null;
}

function isValidTitle(normText) {
  if (!normText || normText.length < 3) return false;
  return !IGNORE_UI_WORDS.has(normText);
}