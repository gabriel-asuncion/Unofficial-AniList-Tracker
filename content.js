// content.js

// 1. FIRST STEP: Check the whitelist before doing ANYTHING
chrome.storage.local.get(['whitelistedDomains'], (result) => {
  const domains = result.whitelistedDomains || [];
  const currentHost = window.location.hostname;
  
  // Allow subdomains (e.g., if 'anime.nexus' is whitelisted, 'www.anime.nexus' works)
  const isWhitelisted = domains.some(d => currentHost.includes(d));

  if (!isWhitelisted) {
    // Zero background footprint! The script dies here instantly on normal websites.
    return; 
  }

  // --- ONLY RUNS IF SITE IS WHITELISTED ---
  let hasTriggeredUpdate = false;
  let trackedVideo = null;
  let userThreshold = 80; // Default
  chrome.storage.local.get(['trackingThreshold'], (res) => {
    if (res.trackingThreshold) userThreshold = res.trackingThreshold;
  });

  function getDeepVideos(root) {
    let videos = Array.from(root.querySelectorAll('video'));
    let allElements = root.querySelectorAll('*');
    for (let el of allElements) {
      if (el.shadowRoot) {
        videos = videos.concat(getDeepVideos(el.shadowRoot));
      }
    }
    return videos;
  }

  const trackerIntervalId = setInterval(() => {
    if (!chrome.runtime?.id) {
      clearInterval(trackerIntervalId);
      return; 
    }

    if (!trackedVideo || isNaN(trackedVideo.duration) || trackedVideo.duration < 1) {
      const videos = getDeepVideos(document);
      trackedVideo = videos.find(v => !isNaN(v.duration) && v.duration > 10);
    }

    if (trackedVideo && !isNaN(trackedVideo.duration) && trackedVideo.duration > 0) {
      const progressRaw = trackedVideo.currentTime / trackedVideo.duration;
      const progressPct = progressRaw * 100;

      try {
        chrome.runtime.sendMessage({
          action: "LIVE_VIDEO_PROGRESS",
          progress: progressPct
        }).catch(() => {}); 
      } catch (e) {
        if (e.message.includes("Extension context invalidated")) {
          clearInterval(trackerIntervalId);
          return;
        }
      }

      if (progressPct >= userThreshold && !hasTriggeredUpdate) {
        hasTriggeredUpdate = true;
        console.log("AniList Tracker: 80% reached! Firing update...");
        try {
          chrome.runtime.sendMessage({ action: "AUTO_UPDATE_ANIME" }).catch(() => {});
        } catch(e) {
          if (e.message.includes("Extension context invalidated")) {
            clearInterval(trackerIntervalId);
            return;
          }
        }
      }
    }
  }, 1000); 

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "SHOW_SUCCESS_TOAST") {
      showInPageToast(request.message);
    } 
    // NEW: Skip Button Logic!
    else if (request.action === "SKIP_TIME" && trackedVideo) {
      trackedVideo.currentTime += request.amount;
    }
    return true; 
  });

  function showInPageToast(messageText) {
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.top = '20px';
    toast.style.right = '-350px'; 
    toast.style.backgroundColor = '#111A26'; 
    toast.style.color = '#E5C07B'; 
    toast.style.border = '1px solid #9EB3C8';
    toast.style.padding = '15px 20px';
    toast.style.borderRadius = '8px';
    toast.style.boxShadow = '0 10px 25px rgba(0,0,0,0.8)';
    toast.style.zIndex = '2147483647'; 
    toast.style.fontFamily = 'sans-serif';
    toast.style.fontSize = '14px';
    toast.style.fontWeight = 'bold';
    toast.style.transition = 'right 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    toast.innerHTML = `🌟 <span>${messageText}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => { toast.style.right = '20px'; }, 100);
    setTimeout(() => {
      toast.style.right = '-350px';
      setTimeout(() => { toast.remove(); }, 500); 
    }, 4000);
  }
});