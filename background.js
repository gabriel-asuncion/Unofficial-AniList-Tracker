// background.js

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "AUTO_UPDATE_ANIME") {
    const actualTabTitle = sender.tab.title;
    processAutoUpdate(actualTabTitle, sender.tab.id);
  } else if (message.action === "LIVE_VIDEO_PROGRESS") {
    // --- NEW: Visual Tracking Badge ---
    // If the video is playing but hasn't hit 80% yet, show the red 'recording/playing' badge
    if (message.progress > 0 && message.progress < 80) {
      chrome.action.setBadgeBackgroundColor({ color: '#E06C75' }); // Red color
      chrome.action.setBadgeText({ text: '▶' }); 
    }
  }
  return true; 
});

async function processAutoUpdate(tabTitle, tabId) {
  const storage = await chrome.storage.local.get(['anilistToken']);
  const token = storage.anilistToken;
  if (!token) return; 

  const regex = /(?:Watch\s+)?(.*?)\s*(?:[-|—–:~]+\s*)?(?:Season\s*\d+\s*)?(?:Episode|Ep|EP|E)\.?\s*0*(\d+)/i;
  const match = tabTitle.match(regex);

  if (!match || !match[1] || !match[2]) return;

  let parsedTitle = match[1].replace(/[-|—–:~]+$/g, '').trim(); 
  parsedTitle = parsedTitle.replace(/\s+\(?(?:Sub|Dub)\)?$/i, '').trim();
  const parsedEp = parseInt(match[2], 10);

  try {
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
    
    if (!media) return; 

    const currentProg = media.mediaListEntry ? media.mediaListEntry.progress : 0;
    if (currentProg >= parsedEp) return; 

    let newStatus = 'CURRENT';
    let startedAt = undefined;
    let completedAt = undefined;

    if (parsedEp === 1 && currentProg === 0) startedAt = getTodayFuzzy();
    if (media.episodes && parsedEp >= media.episodes) {
      newStatus = 'COMPLETED';
      completedAt = getTodayFuzzy();
    }

    const mutation = `
      mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
        SaveMediaListEntry (mediaId: $mediaId, progress: $progress, status: $status, startedAt: $startedAt, completedAt: $completedAt) { id }
      }
    `;

    const variables = { mediaId: media.id, progress: parsedEp, status: newStatus };
    if (startedAt) variables.startedAt = startedAt;
    if (completedAt) variables.completedAt = completedAt;

    await apiRequest(mutation, variables, token);

    // --- NEW: Persistent Green Checkmark ---
    chrome.action.setBadgeBackgroundColor({ color: '#98C379' }); // Green color
    chrome.action.setBadgeText({ text: '✓' });
    // Note: We removed the setTimeout here! The checkmark will stay permanently 
    // until the user opens the popup, which triggers the unwatched count recalculation.

    const animeName = media.title.english || media.title.romaji;
    chrome.tabs.sendMessage(tabId, {
      action: "SHOW_SUCCESS_TOAST",
      message: `${animeName} updated to Episode ${parsedEp}!`
    }, { frameId: 0 }); 

  } catch (error) {
    console.error("Auto-Update Process Failed:", error);
  }
}