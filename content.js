// content.js

window.siteForcedType = null; 
window.autoSkipEnabled = false; 
window.userThreshold = 80; 
window.showUnlistedBadges = true;
window.trackedVideo = null;

chrome.storage.local.get(['whitelistedDomains', 'trackingThreshold', 'autoSkipEnabled', 'showUnlistedBadges'], (result) => {
  const domains = result.whitelistedDomains || [];
  window.autoSkipEnabled = result.autoSkipEnabled || false; 
  window.userThreshold = result.trackingThreshold || 80; 
  window.showUnlistedBadges = result.showUnlistedBadges !== false; 

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.showUnlistedBadges) window.showUnlistedBadges = changes.showUnlistedBadges.newValue;
    if (changes.trackingThreshold) window.userThreshold = changes.trackingThreshold.newValue;
    if (changes.autoSkipEnabled) window.autoSkipEnabled = changes.autoSkipEnabled.newValue; 
  });
  
  let hostsToCheck = [window.location.hostname];
  if (window.location.ancestorOrigins) {
    for (let i = 0; i < window.location.ancestorOrigins.length; i++) {
      try { hostsToCheck.push(new URL(window.location.ancestorOrigins[i]).hostname); } catch(e) {}
    }
  }

  const matchedDomain = domains.find(d => hostsToCheck.some(h => h.includes(typeof d === 'string' ? d : d.domain)));
  const isHubSite = hostsToCheck.some(h => h.includes('anilist.co') || h.includes('myanimelist.net'));
  
  if (!matchedDomain && !isHubSite) return; 

  window.siteForcedType = matchedDomain ? (typeof matchedDomain === 'string' ? 'ANIME' : (matchedDomain.type || 'ANIME')) : 'ANIME';

  if (typeof window.startMediaTrackers === 'function') {
    window.startMediaTrackers(matchedDomain);
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "SHOW_SUCCESS_TOAST") {
       window.showInPageToast('success', 'Update Successful', request.message, request.xpData);
       sendResponse({ success: true });
    }
    else if (request.action === "SMART_SKIP" && window.trackedVideo) {
      let skipped = false; const ct = window.trackedVideo.currentTime;
      if (window.aniSkipData && Array.isArray(window.aniSkipData)) {
        const activeSkip = window.aniSkipData.find(skip => ct >= skip.interval.startTime && ct <= skip.interval.endTime);
        if (activeSkip && activeSkip.interval.endTime) {
          window.trackedVideo.currentTime = activeSkip.interval.endTime; skipped = true;
          window.showInPageToast('success', 'Skipped', activeSkip.skipType === 'ed' ? 'Outro skipped successfully!' : 'Intro skipped successfully!');
        }
      }
      if (!skipped) {
        const isOP = ct < (window.trackedVideo.duration * 0.5);
        const skipAmount = (window.aniSkipData === "not_found" && window.learnedSkipData) ? (isOP ? window.learnedSkipData.op : window.learnedSkipData.ed) : 90;
        const oldTime = window.trackedVideo.currentTime; window.trackedVideo.currentTime += skipAmount;
        window.sessionSkips.push({ skipType: isOP ? 'op' : 'ed', interval: { startTime: oldTime, endTime: window.trackedVideo.currentTime } });
        window.showInPageToast('info', 'Skipped', `Skipped forward ${skipAmount} seconds.`);
      }
      sendResponse({ success: true });
    }
    else if (request.action === "SKIP_TIME" && window.trackedVideo) {
      window.trackedVideo.currentTime += request.amount;
      sendResponse({ success: true });
    }
    else if (request.action === "SHOW_RATING_MODAL") {
      window.showRatingToast(request.mediaId, request.animeName);
      sendResponse({ success: true });
    }
    else if (request.action === "GET_ACTIVE_SKIP_TIER") {
  sendResponse({ 
    tierText: typeof activeSkipTier !== 'undefined' && activeSkipTier ? activeSkipTier : "Detecting..." 
      });
    } else {
      sendResponse({ success: false });
    }
    return false; 
  });

  let shiinahScannerInterval = null;
  let cachedWatchlist = [];

  function initSmartTracker() {
    if (!chrome || !chrome.runtime || !chrome.runtime.id) return;
    
    const scanDOM = () => {
      if (!chrome.runtime?.id) { clearInterval(shiinahScannerInterval); return; }
      const cardSelectors = '[data-slot="card"], .anime-card, .series-card, .manga-card, .card, [class*="card"], a[href*="/anime/"], a[href*="/series/"], a[href*="/manga/"], a[href*="/chapter/"], a[href*="/watch/"], button[aria-label*="episode" i], button[aria-label*="chapter" i], li[x-data]';
      
      document.querySelectorAll(cardSelectors).forEach(card => {
         if (card.tagName === 'A' && card.childElementCount === 0) return;
         if (typeof window.processAnimeCard === 'function') window.processAnimeCard(card, cachedWatchlist);
      });
      
      document.querySelectorAll('.shiinah-tooltip-container').forEach(tooltip => {
        if (tooltip._linkedBadge && !document.body.contains(tooltip._linkedBadge)) tooltip.remove();
      });
    };

    const fetchAndBuild = (forceRedraw = false) => {
      const pageMediaType = typeof window.getActiveMediaType === 'function' ? window.getActiveMediaType() : 'ANIME'; 
      chrome.runtime.sendMessage({ action: "GET_USER_WATCHLIST", mediaType: pageMediaType }, (response) => {
        if (chrome.runtime.lastError) return;
        let merged = new Map();
        if (response && response.watchlist) response.watchlist.forEach(entry => merged.set(entry.media.id, entry));
        
        chrome.storage.local.get(['cachedList_data', 'currentMode'], (res) => {
          if (res.cachedList_data && res.currentMode === pageMediaType) res.cachedList_data.forEach(entry => merged.set(entry.media.id, entry));
          cachedWatchlist = Array.from(merged.values());
          if (forceRedraw) scanDOM(); 
        });
      });
    };

    fetchAndBuild(true);
    
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.trigger_dom_refresh || changes.cachedList_data || changes.full_watchlist_cache_ANIME || changes.full_watchlist_cache_MANGA) {
        document.querySelectorAll('.shiinah-wrapper-marked').forEach(card => {
            card.removeAttribute('data-shiinah-scanned');
            card.classList.remove('shiinah-wrapper-marked');
            const badge = card.querySelector('.shiinah-inline-badge');
            if (badge) badge.remove();
        });
        
        document.querySelectorAll('.shiinah-tooltip-container').forEach(el => el.remove());
        fetchAndBuild(true);
      }
    });

    if (!shiinahScannerInterval) {
      shiinahScannerInterval = setInterval(scanDOM, 2500);
    }
  }
  
  setTimeout(initSmartTracker, 1000);
});