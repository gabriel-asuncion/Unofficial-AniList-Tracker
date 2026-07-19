// content.js

chrome.storage.local.get(['whitelistedDomains', 'trackingThreshold'], (result) => {
  const domains = result.whitelistedDomains || [];
  
  let hostsToCheck = [window.location.hostname];
  if (window.location.ancestorOrigins) {
    for (let i = 0; i < window.location.ancestorOrigins.length; i++) {
      try { hostsToCheck.push(new URL(window.location.ancestorOrigins[i]).hostname); } catch(e) {}
    }
  }

  const isWhitelisted = domains.some(d => hostsToCheck.some(h => h.includes(d)));
  if (!isWhitelisted) return; 

  // --- TRACKING VARIABLES ---
  let hasTriggeredUpdate = false;
  let trackedVideo = null;
  let currentVideoSrc = ""; 
  let userThreshold = result.trackingThreshold || 80; 
  let currentUrl = location.href; 
  
  // OTG Sync Variables
  let otgLoaded = false;
  let otgSaveLock = false; 
  let resolvedOtgData = null; 

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.trackingThreshold) userThreshold = changes.trackingThreshold.newValue;
  });

  function getDeepVideos(root) {
    let videos = Array.from(root.querySelectorAll('video'));
    let allElements = root.querySelectorAll('*');
    for (let el of allElements) {
      if (el.shadowRoot) videos = videos.concat(getDeepVideos(el.shadowRoot));
    }
    return videos;
  }

  const trackerIntervalId = setInterval(() => {
    if (!chrome.runtime?.id) {
      clearInterval(trackerIntervalId);
      return; 
    }

    // 1. SPA Navigation Detector (URL changes)
    if (location.href !== currentUrl) {
      console.log("[AniList Quick Update] URL changed! Resetting tracker for new episode.");
      currentUrl = location.href;
      trackedVideo = null;        
      currentVideoSrc = "";       
      hasTriggeredUpdate = false; 
      otgLoaded = false;          
      resolvedOtgData = null;     
    }

    // 2. NEW: Aggressive Ghost Video Detector
    // If the site swaps the video player WITHOUT changing the URL, this catches it!
    if (trackedVideo && !trackedVideo.isConnected) {
      console.log("[AniList Quick Update] Ghost video detected! Hunting for the new player...");
      trackedVideo = null;
      currentVideoSrc = "";
      hasTriggeredUpdate = false;
      otgLoaded = false;
      resolvedOtgData = null;
    }

    // 3. Find the video if we don't have one
    if (!trackedVideo || isNaN(trackedVideo.duration) || trackedVideo.duration < 300) {
      const videos = getDeepVideos(document);
      let maxDuration = 0;
      let longestVideo = null;
      
      videos.forEach(v => {
        if (!isNaN(v.duration) && v.duration > maxDuration) {
          maxDuration = v.duration;
          longestVideo = v;
        }
      });
      
      if (maxDuration > 300) {
        trackedVideo = longestVideo;
        console.log("[AniList Quick Update] Found new video player!");
      }
    }

    if (trackedVideo && !isNaN(trackedVideo.duration) && trackedVideo.duration > 0) {
      
      if (trackedVideo.src !== currentVideoSrc) {
        currentVideoSrc = trackedVideo.src;
        hasTriggeredUpdate = false; 
        otgLoaded = false; 
        resolvedOtgData = null; 
      }

      if (otgSaveLock) return;

      try {
        chrome.runtime.sendMessage({
          action: "LIVE_VIDEO_PROGRESS",
          progress: (trackedVideo.currentTime / trackedVideo.duration) * 100,
          threshold: userThreshold,
          currentTime: trackedVideo.currentTime,
          isOtgLoaded: otgLoaded,
          resolvedData: resolvedOtgData,
          hasTriggeredUpdate: hasTriggeredUpdate 
        }, (response) => {
          if (chrome.runtime.lastError) return;
          
          if (response && response.resolvedData) {
            resolvedOtgData = response.resolvedData;
          }

          if (response && response.otgTime && !otgLoaded) {
             otgLoaded = true; 
             otgSaveLock = true; 
             
             const targetTime = response.otgTime;
             console.log(`[AniList Quick Update] Database OTG Match Found! Jumping to ${targetTime}s.`);

             trackedVideo.currentTime = targetTime;
             
             setTimeout(() => {
               if (Math.abs(trackedVideo.currentTime - targetTime) > 5) {
                 console.log("[AniList Quick Update] Player reset the time. Forcing jump again!");
                 trackedVideo.currentTime = targetTime;
               }
             }, 1500);

             setTimeout(() => { 
               otgSaveLock = false; 
             }, 5000);

             const mins = Math.floor(targetTime / 60);
             const secs = Math.floor(targetTime % 60).toString().padStart(2, '0');
             
             showInPageToast('info', 'OTG Resumed', `Playback jumped to ${mins}:${secs} successfully.`);
             
          } else if (response && response.otgTime === null && !otgLoaded) {
             otgLoaded = true; 
          }
        }); 
      } catch (e) {
        if (e.message.includes("Extension context invalidated")) clearInterval(trackerIntervalId);
      }

      if ((trackedVideo.currentTime / trackedVideo.duration) * 100 >= userThreshold && !hasTriggeredUpdate) {
        hasTriggeredUpdate = true;
        try {
          chrome.runtime.sendMessage({ action: "AUTO_UPDATE_ANIME" }).catch(() => {});
        } catch(e) {}
      }
    }
  }, 1000); 

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "SHOW_SUCCESS_TOAST") {
      showInPageToast('success', 'Update Successful', request.message);
    }
    else if (request.action === "SKIP_TIME" && trackedVideo) {
      trackedVideo.currentTime += request.amount;
    }
    else if (request.action === "SHOW_RATING_MODAL") {
      showRatingModal(request.mediaId, request.animeName);
    }
    return true; 
  });

  function showInPageToast(type, title, description) {
    const existingToast = document.getElementById('anilist-quick-update-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.id = 'anilist-quick-update-toast';
    
    Object.assign(toast.style, {
      position: 'fixed', top: '20px', right: '-400px', backgroundColor: '#1f1f1f', color: '#ffffff',
      border: '1px solid #333', padding: '14px 18px', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
      zIndex: '2147483647', fontFamily: 'system-ui, -apple-system, sans-serif', display: 'flex',
      alignItems: 'flex-start', gap: '14px', width: '340px', transition: 'right 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
      boxSizing: 'border-box'
    });

    const icons = {
      success: `<svg fill="#4cca51" viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="12"/><path fill="#1f1f1f" d="M10 15.5l-3.5-3.5 1.4-1.4 2.1 2.1 5.4-5.4 1.4 1.4z"/></svg>`,
      info: `<svg fill="#777" viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="12"/><path fill="#1f1f1f" d="M11 7h2v2h-2zm0 4h2v6h-2z"/></svg>`,
      warning: `<svg fill="#f39c12" viewBox="0 0 24 24" width="22" height="22"><path d="M12 2L1 21h22L12 2zm-1 14v-4h2v4h-2zm0 4v-2h2v2h-2z"/></svg>`,
      error: `<svg fill="#e74c3c" viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="12"/><path fill="#1f1f1f" d="M15.5 14.1l-1.4 1.4-2.1-2.1-2.1 2.1-1.4-1.4 2.1-2.1-2.1-2.1 1.4-1.4 2.1 2.1 2.1-2.1 1.4 1.4-2.1 2.1z"/></svg>`
    };

    const closeSvg = `<svg style="cursor:pointer; opacity:0.5; transition:opacity 0.2s;" width="18" height="18" fill="none" stroke="#aaa" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

    toast.innerHTML = `
      <div style="flex-shrink: 0; margin-top: 1px;">${icons[type] || icons.info}</div>
      <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 4px;">
        <span style="font-size: 15px; font-weight: 600; color: #fff; line-height: 1.2; letter-spacing: 0.3px;">${title}</span>
        <span style="font-size: 13px; font-weight: 400; color: #aaa; line-height: 1.4;">${description}</span>
      </div>
      <div class="toast-close-btn" style="flex-shrink: 0; display: flex; align-items: center; justify-content: center; padding: 2px;">
        ${closeSvg}
      </div>
    `;

    document.body.appendChild(toast);

    const closeBtn = toast.querySelector('.toast-close-btn');
    closeBtn.addEventListener('mouseenter', () => closeBtn.firstElementChild.style.opacity = '1');
    closeBtn.addEventListener('mouseleave', () => closeBtn.firstElementChild.style.opacity = '0.5');
    closeBtn.addEventListener('click', () => { toast.style.right = '-400px'; setTimeout(() => toast.remove(), 400); });

    requestAnimationFrame(() => { setTimeout(() => { toast.style.right = '20px'; }, 100); });
    setTimeout(() => {
      if (document.body.contains(toast)) {
        toast.style.right = '-400px';
        setTimeout(() => { if (document.body.contains(toast)) toast.remove(); }, 400);
      }
    }, 5000); 
  }
});

function showRatingModal(mediaId, animeName) {
  const existing = document.getElementById('anilist-rating-modal-container');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.id = 'anilist-rating-modal-container';
  Object.assign(container.style, {
    position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
    backgroundColor: 'rgba(0, 0, 0, 0.85)', zIndex: '2147483647',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'system-ui, -apple-system, sans-serif'
  });

  const modal = document.createElement('div');
  Object.assign(modal.style, {
    backgroundColor: '#1f1f1f', border: '1px solid #333',
    padding: '24px', borderRadius: '12px', width: '320px',
    boxShadow: '0 10px 40px rgba(0,0,0,0.9)', color: '#fff',
    display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'center'
  });

  modal.innerHTML = `
    <div>
      <h2 style="margin: 0 0 8px 0; font-size: 20px; color: #4cca51;">Series Completed! 🎉</h2>
      <p style="margin: 0; font-size: 14px; color: #aaa; line-height: 1.4;">You finished <b style="color: #fff;">${animeName}</b>. How would you rate it?</p>
    </div>
    <input type="number" id="anilist-score-input" min="0" max="100" placeholder="Score (0-100)" style="
      background-color: #0b1119; color: #fff; border: 1px solid #333;
      padding: 12px; border-radius: 8px; font-size: 18px; text-align: center;
      outline: none; width: 100%; box-sizing: border-box; font-weight: bold;
    ">
    <div style="display: flex; gap: 10px; margin-top: 5px;">
      <button id="anilist-skip-rating" style="
        flex: 1; padding: 12px; background: transparent; color: #aaa;
        border: 1px solid #555; border-radius: 8px; cursor: pointer; font-weight: bold; transition: 0.2s;
      ">Skip</button>
      <button id="anilist-submit-rating" style="
        flex: 1; padding: 12px; background: #3db4f2; color: #fff;
        border: none; border-radius: 8px; cursor: pointer; font-weight: bold; transition: 0.2s;
      ">Submit</button>
    </div>
  `;

  container.appendChild(modal);
  document.body.appendChild(container);

  const skipBtn = document.getElementById('anilist-skip-rating');
  const submitBtn = document.getElementById('anilist-submit-rating');
  const scoreInput = document.getElementById('anilist-score-input');

  skipBtn.addEventListener('mouseenter', () => skipBtn.style.color = '#fff');
  skipBtn.addEventListener('mouseleave', () => skipBtn.style.color = '#aaa');
  submitBtn.addEventListener('mouseenter', () => submitBtn.style.backgroundColor = '#2c9ad1');
  submitBtn.addEventListener('mouseleave', () => submitBtn.style.backgroundColor = '#3db4f2');

  skipBtn.addEventListener('click', () => {
    container.remove();
  });

  submitBtn.addEventListener('click', () => {
    const score = parseInt(scoreInput.value, 10);
    if (isNaN(score) || score < 0 || score > 100) {
      scoreInput.style.borderColor = '#e74c3c';
      return;
    }
    
    submitBtn.textContent = 'Saving...';
    submitBtn.disabled = true;

    chrome.runtime.sendMessage({ action: "SAVE_ANIME_SCORE", mediaId, score }, (response) => {
      container.remove();
    });
  });
}