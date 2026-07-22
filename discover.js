// discover.js
// Handles the Anime Recommendation Engine and Blacklist filtering

let userExcludedMediaIds = [];
let recommendationClickCount = 0;
let recommendationPool = [];

document.addEventListener('DOMContentLoaded', () => {
  // Navigation Event Listeners
  document.getElementById('open-discover-btn')?.addEventListener('click', async () => {
    document.getElementById('profile-view').classList.add('hidden');
    document.getElementById('recommendation-view').classList.remove('hidden');
    document.getElementById('rec-content').classList.add('hidden');
    document.getElementById('rec-loading').classList.remove('hidden');
    
    // If we haven't fetched the user's blocklist yet, do it now!
    if (userExcludedMediaIds.length === 0) {
      await fetchUserBlacklist();
    }
    
    loadNextRecommendation(0); 
  });

  document.getElementById('rec-back-btn')?.addEventListener('click', () => {
    document.getElementById('recommendation-view').classList.add('hidden');
    document.getElementById('profile-view').classList.remove('hidden');
  });

  document.getElementById('rec-next-btn')?.addEventListener('click', () => {
    recommendationClickCount++;
    loadNextRecommendation(0); 
  });
});

// Fetch the user's ENTIRE anime list so we don't recommend things they know
async function fetchUserBlacklist() {
  const query = `
    query ($userId: Int) {
      MediaListCollection(userId: $userId, type: ANIME) {
        lists { entries { mediaId } }
      }
    }
  `;
  try {
    // Relies on `userId` and `apiRequest` from popup.js
    const res = await apiRequest(query, { userId: userId });
    let ids = new Set();
    res.data.MediaListCollection.lists.forEach(list => {
      list.entries.forEach(entry => ids.add(entry.mediaId));
    });
    userExcludedMediaIds = Array.from(ids);
  } catch (e) { console.error("Failed to fetch blacklist"); }
}

// The Core Recommendation Logic
async function loadNextRecommendation(attempt = 0) {
  document.getElementById('rec-content').classList.add('hidden');
  document.getElementById('rec-loading').classList.remove('hidden');
  
  const loadingText = document.getElementById('rec-loading');

  if (recommendationPool.length === 0) {
    if (attempt > 5) {
      loadingText.innerHTML = "You've watched so much anime, we couldn't find a quick match!<br><br>Click Next to dive deeper.";
      return; 
    }

    const isWildcard = (recommendationClickCount + 1) % 3 === 0;
    const randomPage = Math.floor(Math.random() * 20) + 1;
    
    let variables = { page: randomPage };
    let filterString = "";
    let queryArgs = "$page: Int"; 

    // Relies on `userTopGenres` from popup.js
    if (isWildcard && userTopGenres.length > 0) {
      filterString = ", genre_not_in: $genres";
      variables.genres = userTopGenres;
      queryArgs += ", $genres: [String]";
      document.getElementById('rec-wildcard-badge').classList.remove('hidden');
    } else if (userTopGenres.length > 0) {
      filterString = ", genre_in: $genres";
      variables.genres = userTopGenres;
      queryArgs += ", $genres: [String]";
      document.getElementById('rec-wildcard-badge').classList.add('hidden');
    } else {
      document.getElementById('rec-wildcard-badge').classList.add('hidden');
    }

    const query = `
      query (${queryArgs}) {
        Page(page: $page, perPage: 20) {
          media(type: ANIME, sort: POPULARITY_DESC, isAdult: false ${filterString}) {
            id
            title { romaji english native }
            coverImage { extraLarge }
            description
            genres
          }
        }
      }
    `;

    try {
      loadingText.textContent = `Searching page ${randomPage} archives...`;
      
      const res = await apiRequest(query, variables);
      if (res.errors) throw new Error(res.errors[0].message);
      
      const fetchedAnime = res.data.Page.media;
      
      recommendationPool = fetchedAnime.filter(anime => !userExcludedMediaIds.includes(anime.id));
      
      if (recommendationPool.length === 0) {
        return loadNextRecommendation(attempt + 1);
      }
    } catch (e) {
      console.error("Discovery Engine Error:", e);
      loadingText.textContent = "Failed to fetch recommendations.";
      return;
    }
  }

  const anime = recommendationPool.pop();
  userExcludedMediaIds.push(anime.id); 

  document.getElementById('rec-cover').src = anime.coverImage.extraLarge;
  document.getElementById('rec-title').textContent = anime.title.english || anime.title.romaji;
  
  const altTitle = anime.title.english ? anime.title.romaji : (anime.title.native || '');
  document.getElementById('rec-alt-title').textContent = altTitle;

  const cleanDesc = anime.description ? anime.description.replace(/<br><br>/g, '\n').replace(/<[^>]*>?/gm, '') : 'No synopsis available.';
  document.getElementById('rec-synopsis').textContent = cleanDesc;

  const tagsContainer = document.getElementById('rec-tags');
  tagsContainer.innerHTML = '';
  anime.genres.slice(0, 4).forEach(genre => {
    const tag = document.createElement('div');
    tag.className = 'rec-tag';
    tag.textContent = genre;
    tagsContainer.appendChild(tag);
  });

  loadingText.classList.add('hidden');
  document.getElementById('rec-content').classList.remove('hidden');
  loadingText.textContent = "Finding the perfect anime...";
}