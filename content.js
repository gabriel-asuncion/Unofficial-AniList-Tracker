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

  // ==========================================
  // 🧠 SMART MEDIA DETECTOR
  // ==========================================
  function getActiveMediaType() {
    const title = document.title || "";
    
    // 1. Test for Anime
    const animeRegex = /(?:Watch\s+)?(.*?)\s*(?:[-|—–:~]+\s*)?(?:Season\s*\d+\s*)?(?:Episode|Ep|EP|E)\.?\s*0*(\d+)/i;
    if (animeRegex.test(title)) return 'ANIME';
    
    // 2. Test for Manga
    const chapRegex = /(?:Chapter|Ch\.|Ch)\s*0*(\d+(\.\d+)?)/i;
    const looseRegex = /[-|\|]\s*0*(\d+(\.\d+)?)\s*(?:\||-|$)/;
    if (chapRegex.test(title) || looseRegex.test(title)) return 'MANGA';
    
    // 3. Fallback: If there's a video element on the page, assume Anime
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.some(v => v.duration > 300 || isNaN(v.duration))) return 'ANIME';
    
    return null;
  }

  // ==========================================
  // 📺 ANIME TRACKING ENGINE
  // ==========================================
  
  let activeWatchSeconds = 0;
  let hasTriggeredUpdate = false;
  let trackedVideo = null;
  let currentUrl = location.href; 
  let currentVideoSrc = ""; 
  let userThreshold = result.trackingThreshold || 80; 
  let otgLoaded = false;
  let otgSaveLock = false; 
  let resolvedOtgData = null; 
  let aniSkipData = null; 
  let skipButtonMounted = false;

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
  
  // NEW: Accept activeSkip object to dynamically set text and skip destination
    function mountSkipButton(activeSkip) {
      if (document.getElementById('aniskip-float-btn')) return;
      
      const btn = document.createElement('button');
      btn.id = 'aniskip-float-btn';
      // Dynamically change text based on the skipType ('op' or 'ed')
      btn.innerHTML = activeSkip.skipType === 'ed' ? '▶ Skip Outro' : '▶ Skip Intro';
      
      Object.assign(btn.style, {
        position: 'absolute', bottom: '70px', right: '30px', zIndex: '2147483647',
        backgroundColor: 'rgba(21, 31, 46, 0.85)', color: '#fff', border: '1px solid #3db4f2',
        padding: '12px 20px', borderRadius: '6px', cursor: 'pointer',
        fontFamily: 'system-ui, sans-serif', fontWeight: 'bold', fontSize: '15px',
        transition: 'all 0.2s ease', backdropFilter: 'blur(4px)', boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
      });

      btn.addEventListener('mouseenter', () => btn.style.backgroundColor = 'rgba(61, 180, 242, 0.9)');
      btn.addEventListener('mouseleave', () => btn.style.backgroundColor = 'rgba(21, 31, 46, 0.85)');
      
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); 
        if (trackedVideo && activeSkip && activeSkip.interval.endTime) {
          trackedVideo.currentTime = activeSkip.interval.endTime; // Skip to the end of this specific interval
          const toastMsg = activeSkip.skipType === 'ed' ? 'Outro skipped successfully!' : 'Intro skipped successfully!';
          showInPageToast('success', 'Skipped', toastMsg);
          unmountSkipButton();
        }
      });

      const container = trackedVideo.parentElement;
      if (window.getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
      }
      container.appendChild(btn);
      skipButtonMounted = true;
    }

  function unmountSkipButton() {
    const btn = document.getElementById('aniskip-float-btn');
    if (btn) btn.remove();
    skipButtonMounted = false;
  }

  const trackerIntervalId = setInterval(() => {
    if (!chrome.runtime?.id) {
      clearInterval(trackerIntervalId);
      return; 
    }
    
    // GUARD: Only run if the active page is an Anime!
    if (getActiveMediaType() !== 'ANIME') return;

    if (location.href !== currentUrl || (trackedVideo && !trackedVideo.isConnected)) {
      activeWatchSeconds = 0;
      currentUrl = location.href;
      trackedVideo = null;        
      currentVideoSrc = "";       
      hasTriggeredUpdate = false; 
      otgLoaded = false;          
      resolvedOtgData = null;  
      aniSkipData = null; 
      if (skipButtonMounted) unmountSkipButton(); 
    }

    if (trackedVideo && !trackedVideo.paused && document.visibilityState === 'visible') {
      activeWatchSeconds++;
    }

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
      if (maxDuration > 300) trackedVideo = longestVideo;
    }

    if (trackedVideo && !isNaN(trackedVideo.duration) && trackedVideo.duration > 0) {
      
      if (trackedVideo.src !== currentVideoSrc) {
        currentVideoSrc = trackedVideo.src;
        hasTriggeredUpdate = false; 
        otgLoaded = false; 
        resolvedOtgData = null; 
        aniSkipData = null; 
        if (skipButtonMounted) unmountSkipButton(); 
      }

      if (aniSkipData && Array.isArray(aniSkipData)) {
          const ct = trackedVideo.currentTime;
          
          // Find the first skip interval that the current time falls inside of
          const activeSkip = aniSkipData.find(skip => ct >= skip.interval.startTime && ct <= skip.interval.endTime);

          if (activeSkip) {
            if (!skipButtonMounted) mountSkipButton(activeSkip);
          } else {
            if (skipButtonMounted) unmountSkipButton();
          }
        }

      if (otgSaveLock) return;

      // NEW: Ensure we only ask the background script for OTG data ONCE
        let sendOtgStatus = otgLoaded;
        if (otgLoaded === false) {
          otgLoaded = 'fetching';
          sendOtgStatus = false;
        }

        try {
          chrome.runtime.sendMessage({
            action: "LIVE_VIDEO_PROGRESS",
            progress: (trackedVideo.currentTime / trackedVideo.duration) * 100,
            threshold: userThreshold,
            currentTime: trackedVideo.currentTime,
            isOtgLoaded: sendOtgStatus, // Sends 'false' once, then 'fetching'
            resolvedData: resolvedOtgData,
            hasTriggeredUpdate: hasTriggeredUpdate 
          }, (response) => {
            if (chrome.runtime.lastError) return;
            
            if (response && response.resolvedData) {
              resolvedOtgData = response.resolvedData;

              if (!aniSkipData && resolvedOtgData.malId) {
                aniSkipData = "fetching"; 
                chrome.runtime.sendMessage({
                  action: "FETCH_ANISKIP",
                  malId: resolvedOtgData.malId,
                  episode: resolvedOtgData.episode
                }, (skipRes) => {
                  if (skipRes && skipRes.found && skipRes.results && skipRes.results.length > 0) {
                    aniSkipData = skipRes.results;
                  } else {
                    aniSkipData = "not_found"; 
                  }
                });
              }
            }

        // --- UPDATED: BULLETPROOF OTG SEEK & TOAST ENGINE ---
        if (response && response.otgTime !== undefined && response.otgTime !== null && otgLoaded === 'fetching') {
          otgLoaded = true;
          const targetTime = response.otgTime;

          // Resume playback if saved position is greater than 5 seconds and user is near video start
          if (targetTime > 5 && trackedVideo.currentTime < 15) {
            
            const executeSeek = () => {
              try {
                trackedVideo.currentTime = targetTime;
                
                const mins = Math.floor(targetTime / 60);
                const secs = Math.floor(targetTime % 60).toString().padStart(2, '0');
                showInPageToast('info', 'OTG Resumed', `Jumped to ${mins}:${secs} successfully.`);
              } catch (err) {
                console.error("[OTG Seek Error]:", err);
              }
            };

            // If video metadata is already loaded, seek immediately
            if (trackedVideo.readyState >= 1) {
              executeSeek();
            } else {
              // Otherwise, wait for the video player metadata to load before seeking
              trackedVideo.addEventListener('loadedmetadata', executeSeek, { once: true });
              trackedVideo.addEventListener('canplay', executeSeek, { once: true });
            }
          }
        } else if (response && response.otgTime === null && otgLoaded === 'fetching') {
          otgLoaded = true; 
        }
          }); 
        } catch (e) {
          if (e.message.includes("Extension context invalidated")) clearInterval(trackerIntervalId);
        }

      // NEW: Guard against glitchy 0-second metadata loads instantly completing the series!
      if (trackedVideo.duration > 180 && trackedVideo.currentTime > 60 && (trackedVideo.currentTime / trackedVideo.duration) * 100 >= userThreshold && !hasTriggeredUpdate) {
        hasTriggeredUpdate = true;
        try {
          chrome.runtime.sendMessage({ action: "AUTO_UPDATE_ANIME", trueWatchSeconds: activeWatchSeconds }).catch(() => {});
        } catch(e) {}
      }
    }
  }, 1000); 

  // ==========================================
  // 📖 MANGA TRACKING ENGINE
  // ==========================================
  
  let mangaWatchSeconds = 0;
  let hasTriggeredMangaUpdate = false;
  let currentMangaUrl = location.href;
  let currentRawTitle = document.title;
  
  // Manga OTG Variables
  let mangaOtgLoaded = false;
  let resolvedMangaOtgData = null;

  // NEW: Track the last updated chapter to prevent toast spam on page flips
  let lastTriggeredChapter = null;
  
  function cleanMangaTitle(rawTitle) {
    let chapter = null;
    let targetText = rawTitle;
    
    const chapRegex = /(?:Chapter|Ch\.|Ch)\s*0*(\d+(\.\d+)?)/i;
    const looseRegex = /[-|\|]\s*0*(\d+(\.\d+)?)\s*(?:\||-|$)/;
    
    const chapMatch = rawTitle.match(chapRegex) || rawTitle.match(looseRegex);
    
    if (chapMatch) {
      chapter = parseFloat(chapMatch[1]);
      const leftSide = rawTitle.substring(0, chapMatch.index).trim();
      const rightSide = rawTitle.substring(chapMatch.index + chapMatch[0].length).trim();
      const cleanLeft = leftSide.replace(/[()[\]|]/g, '').trim();
      if (cleanLeft === '' || /^(?:page\s*)?\d+\s*[-/]?\s*(?:\d+)?$/i.test(cleanLeft)) {
        targetText = rightSide.replace(/[-|—|\|]\s*[a-zA-Z0-9]+$/i, '').trim();
      } else {
        targetText = leftSide;
      }
    }

    let clean = targetText.replace(/\b(?:Read|Watch|Free|English|Online|Scanlation|Scans|Scan|Manga|Manhwa|Manhua|Webtoon)\b/gi, '');
    clean = clean.replace(/\[.*?\]|\(.*?\)/g, '');
    clean = clean.replace(/^[-|—–:~,\|\s]+|[-|—–:~,\|\s]+$/g, '').replace(/\s{2,}/g, ' ').trim();

    return { title: clean, chapter: chapter };
  }

  const mangaIntervalId = setInterval(() => {
    if (!chrome.runtime?.id) {
      clearInterval(mangaIntervalId);
      return; 
    }

    if (getActiveMediaType() !== 'MANGA') return;

    if (location.href !== currentMangaUrl || document.title !== currentRawTitle) {
      mangaWatchSeconds = 0;
      hasTriggeredMangaUpdate = false;
      currentMangaUrl = location.href;
      currentRawTitle = document.title;
      // NEW: Reset OTG state on page change
      mangaOtgLoaded = false;
      resolvedMangaOtgData = null;
    }

    const scrollPx = document.documentElement.scrollTop || document.body.scrollTop;
    const maxScroll = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const scrollPct = maxScroll > 0 ? (scrollPx / maxScroll) * 100 : 100;

    if (document.visibilityState === 'visible') {
      mangaWatchSeconds++;
    }

    // NEW: Clean the title early so we can pass it to the OTG searcher
    const parsedData = cleanMangaTitle(currentRawTitle);

    let readingType = 'fallback';
    let currentProg = 0;
    let totalProg = 0;
    let visualPct = 0;

    const pageMatch = currentRawTitle.match(/(?:page\s*)?(\d+)\s*(?:\/|of)\s*(\d+)/i);
    const prefixMatch = currentRawTitle.match(/^(?:page\s*)?(\d+)\s*[-|\|]/i);

    if (pageMatch) {
      readingType = 'page';
      currentProg = parseInt(pageMatch[1], 10);
      totalProg = parseInt(pageMatch[2], 10);
      visualPct = (currentProg / totalProg) * 100;
    } else if (prefixMatch) {
      readingType = 'page';
      currentProg = parseInt(prefixMatch[1], 10);
      const domMatch = document.body.innerText.match(/(?:page\s*)?\d+\s*(?:\/|of)\s*(\d+)/i);
      totalProg = domMatch ? parseInt(domMatch[1], 10) : 0;
      visualPct = totalProg > 0 ? (currentProg / totalProg) * 100 : 100; 
    } else if (maxScroll > 150) {
      readingType = 'scroll';
      currentProg = scrollPct;
      visualPct = scrollPct;
    } else {
      readingType = 'fallback';
      visualPct = Math.min((mangaWatchSeconds / 15) * 100, 100);
    }

    // NEW: Ensure we only ask the background script for OTG data ONCE
    let sendMangaOtgStatus = mangaOtgLoaded;
    if (mangaOtgLoaded === false) {
      mangaOtgLoaded = 'fetching';
      sendMangaOtgStatus = false;
    }

    try {
      chrome.runtime.sendMessage({
        action: "LIVE_MANGA_PROGRESS",
        readingType: readingType,
        progress: currentProg,
        total: totalProg,
        pct: visualPct,
        isCompleted: hasTriggeredMangaUpdate,
        isOtgLoaded: sendMangaOtgStatus,
        parsedTitle: parsedData.title,
        chapter: parsedData.chapter,
        resolvedData: resolvedMangaOtgData
      }, (response) => {
        if (chrome.runtime.lastError) return;
        
        if (response && response.resolvedData) {
          resolvedMangaOtgData = response.resolvedData;
          
          // NEW: Fire the specialized toast exactly once when we realize it's a custom manga
          if (response.resolvedData.isCustom && mangaOtgLoaded === 'fetching') {
            showInPageToast(
              'warning', 
              'Not on AniList', 
              `"${response.resolvedData.customTitle}" was not found. Progress is securely saved locally to your OTG account!`
            );
          }
        }

        // Unlock the state once the background script responds
        if (response && response.otgTime !== undefined && response.otgTime !== null && mangaOtgLoaded === 'fetching') {
          mangaOtgLoaded = true;
          
          // 1. AUTO-SCROLL FOR VERTICAL MANGA
          if (readingType === 'scroll' && response.otgTime > 5) {
            const targetPct = response.otgTime;
            const targetScroll = maxScroll * (targetPct / 100);
            window.scrollTo({ top: targetScroll, behavior: 'smooth' });
            showInPageToast('info', 'OTG Resumed', `Scrolled to ${targetPct.toFixed(1)}% successfully.`);
          }
          // 2. AUTO-REDIRECT FOR PAGINATED MANGA
          else if (readingType === 'page' && response.otgTime > 0) {
            // Clean the URLs to ignore trailing slashes or # hashes (prevents infinite refresh loops)
            const cleanCurrentUrl = window.location.href.split('#')[0].replace(/\/$/, '');
            const cleanSavedUrl = response.otgUrl ? response.otgUrl.split('#')[0].replace(/\/$/, '') : null;

            // If on the wrong page, redirect to the exact URL
            if (currentProg !== response.otgTime && cleanSavedUrl && cleanCurrentUrl !== cleanSavedUrl) {
              showInPageToast('info', 'OTG Resuming', `Jumping to Page ${response.otgTime}...`);
              
              // Give the user 1.5 seconds to see the toast before redirecting
              setTimeout(() => {
                window.location.href = response.otgUrl;
              }, 1500); 
            } 
            // If already on the right page, welcome them back
            else if (currentProg === response.otgTime) {
              showInPageToast('info', 'OTG Resumed', `Welcome back to Page ${response.otgTime}!`);
            }
          }
        } else if (response && response.otgTime === null && mangaOtgLoaded === 'fetching') {
          mangaOtgLoaded = true; 
        }
      });
    } catch (e) {}

    // 3. The Upgraded Update Trigger
    if (!hasTriggeredMangaUpdate) {
      let shouldTrigger = false;

      // Logic branch based on how the user is reading
      if (readingType === 'page') {
        // Trigger ONLY if they reached the final page, or if the total is unknown and 15s passed
        if (totalProg > 0 && currentProg >= totalProg) {
          shouldTrigger = true;
        } else if (totalProg === 0 && mangaWatchSeconds >= 15) {
          shouldTrigger = true;
        }
      } else if (readingType === 'scroll') {
        // Trigger if scrolled 90% down
        if (scrollPct >= 90) shouldTrigger = true;
      } else {
        // Fallback timer for sites we can't parse
        if (mangaWatchSeconds >= 15) shouldTrigger = true;
      }

      if (shouldTrigger) {
        hasTriggeredMangaUpdate = true;
        const parsedData = cleanMangaTitle(currentRawTitle);
        
        // Ensure we found a chapter AND it's not the one we just finished!
        if (parsedData.title && parsedData.chapter !== null && parsedData.chapter !== lastTriggeredChapter) {
          console.log(`[Manga Tracker] Triggered! Title: "${parsedData.title}", Chapter: ${parsedData.chapter}`);
          
          // Memorize this chapter so we don't spam the toast on the next page flip
          lastTriggeredChapter = parsedData.chapter; 
          
          try {
            chrome.runtime.sendMessage({ 
              action: "AUTO_UPDATE_MANGA", 
              cleanTitle: parsedData.title,
              chapter: parsedData.chapter,
              trueReadSeconds: mangaWatchSeconds 
            }).catch(() => {});
          } catch(e) {}
        }
      }
    }
  }, 1000);

  // ==========================================
  // 🍞 TOAST & MODAL UI SYSTEMS (SHARED)
  // ==========================================

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

    skipBtn.addEventListener('click', () => container.remove());

    submitBtn.addEventListener('click', () => {
      const score = parseInt(scoreInput.value, 10);
      if (isNaN(score) || score < 0 || score > 100) {
        scoreInput.style.borderColor = '#e74c3c';
        return;
      }
      submitBtn.textContent = 'Saving...';
      submitBtn.disabled = true;
      chrome.runtime.sendMessage({ action: "SAVE_ANIME_SCORE", mediaId, score }, () => {
        container.remove();
      });
    });
  }
});