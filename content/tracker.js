// content/tracker.js

window.activeWatchSeconds = 0;
window.resumedOtgTime = 0; 
window.hasTriggeredUpdate = false;
window.currentUrl = location.href; 
window.currentVideoSrc = ""; 
window.otgLoaded = false;
window.otgSaveLock = false; 
window.resolvedOtgData = null; 
window.aniSkipData = null; 
window.activeSkipTier = "Detecting...";
window.skipButtonMounted = false;
window.customSkipBtnMounted = false;
window.learnedSkipData = { op: 85, ed: 85 };
window.manualSeekStart = 0;
window.sessionSkips = [];
window.customBtnAppearedAt = 0; 
window.lastSkipTime = 0; 
window.hasCheckedForSkips = false;

document.addEventListener("visibilitychange", async () => {
  if (typeof window.getActiveMediaType === 'function' && window.getActiveMediaType() !== 'ANIME') return;
  if (window.trackedVideo && 'autoPictureInPicture' in window.trackedVideo) return; 

  if (document.visibilityState === "hidden") {
    if (window.trackedVideo && !window.trackedVideo.paused && !document.pictureInPictureElement) {
      try { await window.trackedVideo.requestPictureInPicture(); } catch (e) {}
    }
  } else if (document.visibilityState === "visible") {
    if (document.pictureInPictureElement && window.trackedVideo && document.pictureInPictureElement === window.trackedVideo) {
      try { await document.exitPictureInPicture(); } catch (e) {}
    }
  }
});

window.startMediaTrackers = function(matchedDomain) {
  if (!matchedDomain) return;

  const trackerIntervalId = setInterval(() => {
    if (!chrome.runtime?.id) { clearInterval(trackerIntervalId); return; }
    if (document.visibilityState !== 'visible' || window.getActiveMediaType() !== 'ANIME') return;

    if (location.href !== window.currentUrl || (window.trackedVideo && !window.trackedVideo.isConnected)) {
      window.activeWatchSeconds = 0; window.resumedOtgTime = 0; window.currentUrl = location.href;
      window.trackedVideo = null; window.currentVideoSrc = ""; window.hasTriggeredUpdate = false; 
      window.otgLoaded = false; window.resolvedOtgData = null; window.aniSkipData = null; 
      window.sessionSkips = []; window.customBtnAppearedAt = 0;
      window.hasCheckedForSkips = false;
      if (window.skipButtonMounted) window.unmountSkipButton(); 
    }

    if (window.trackedVideo && !window.trackedVideo.paused && document.visibilityState === 'visible') {
      window.activeWatchSeconds++;
    }

    if (!window.trackedVideo || isNaN(window.trackedVideo.duration) || window.trackedVideo.duration < 300) {
      const videos = window.getDeepVideos(document);
      let maxDuration = 0; let longestVideo = null;
      
      videos.forEach(v => {
        if (!isNaN(v.duration) && v.duration > maxDuration) { maxDuration = v.duration; longestVideo = v; }
      });
      
      if (maxDuration > 300) {
        window.trackedVideo = longestVideo;
        
        if ('autoPictureInPicture' in window.trackedVideo) {
          window.trackedVideo.autoPictureInPicture = true;
        }

        if (!window.trackedVideo.hasAttribute('data-seek-tracked')) {
          window.trackedVideo.setAttribute('data-seek-tracked', 'true');
          window.trackedVideo.addEventListener('seeking', () => { if (window.manualSeekStart === 0) window.manualSeekStart = window.trackedVideo.currentTime; });
          window.trackedVideo.addEventListener('seeked', () => {
            if (window.manualSeekStart > 0 && window.resolvedOtgData) {
              let diff = window.trackedVideo.currentTime - window.manualSeekStart;
              if (diff > 70 && diff < 100) {
                let isOP = window.manualSeekStart < (window.trackedVideo.duration * 0.5);
                chrome.runtime.sendMessage({ action: "SAVE_LEARNED_SKIP", mediaId: window.resolvedOtgData.mediaId, episode: window.resolvedOtgData.episode, isOP: isOP, duration: diff });
                if (isOP) window.learnedSkipData.op = Math.round(diff) - 1; else window.learnedSkipData.ed = Math.round(diff) - 1;
              }
              window.manualSeekStart = 0;
            }
          });
        }
      }
    }

    if (window.trackedVideo && !isNaN(window.trackedVideo.duration) && window.trackedVideo.duration > 0) {
      if (window.trackedVideo.src !== window.currentVideoSrc) {
        window.currentVideoSrc = window.trackedVideo.src; window.hasTriggeredUpdate = false; 
        window.otgLoaded = false; window.resumedOtgTime = 0; window.resolvedOtgData = null; 
        window.aniSkipData = null; window.customBtnAppearedAt = 0; 
        window.hasCheckedForSkips = false;
        if (window.skipButtonMounted) window.unmountSkipButton(); 
      }

      if (window.resolvedOtgData && !window.hasCheckedForSkips && window.resolvedOtgData.platform === 'ANILIST') {
         window.hasCheckedForSkips = true;
         chrome.runtime.sendMessage({
           action: "CHECK_EPISODE_GAP", mediaId: window.resolvedOtgData.mediaId, episode: window.resolvedOtgData.episode
         }, (gapRes) => {
           if (gapRes && gapRes.hasGap && typeof window.showSkipWarningToast === 'function') {
             window.showSkipWarningToast(gapRes.missingEps, window.resolvedOtgData.episode, window.resolvedOtgData.mediaId, window.resolvedOtgData.malId, gapRes.targetProgress);
           }
         });
      }

      if (Date.now() - window.lastSkipTime < 15000) {
        if (window.skipButtonMounted) window.unmountSkipButton();
        if (window.customSkipBtnMounted) {
          const customBtn = document.getElementById('shiinah-custom-hotzone');
          if (customBtn) customBtn.style.display = 'none';
        }
      } else {
        if (window.aniSkipData && Array.isArray(window.aniSkipData)) {
          const ct = window.trackedVideo.currentTime;
          const activeSkip = window.aniSkipData.find(skip => ct >= skip.interval.startTime && ct <= skip.interval.endTime);
          
          if (activeSkip) { 
            if (window.autoSkipEnabled && activeSkip.interval.endTime) {
              window.lastSkipTime = Date.now();
              window.trackedVideo.currentTime = activeSkip.interval.endTime;
              window.showInPageToast('success', 'Auto-Skipped', activeSkip.skipType === 'ed' ? 'Outro auto-skipped!' : 'Intro auto-skipped!');
            } else {
              if (!window.skipButtonMounted) window.mountSkipButton(activeSkip); 
            }
          } else { 
            if (window.skipButtonMounted) window.unmountSkipButton(); 
          }
        }

        if (window.customSkipBtnMounted && window.trackedVideo && window.aniSkipData === "not_found") {
          const customBtn = document.getElementById('shiinah-custom-hotzone');
          if (customBtn) {
            const pct = window.trackedVideo.currentTime / window.trackedVideo.duration;
            if (pct < 0.5 || pct > 0.8) {
              if (customBtn.style.display !== 'block') {
                customBtn.style.display = 'block';
                window.customBtnAppearedAt = window.trackedVideo.currentTime; 
              }
            } else { 
              customBtn.style.display = 'none'; 
              window.customBtnAppearedAt = 0; 
            }
          }
        }
      }

      if (window.otgSaveLock) return;

      let sendOtgStatus = window.otgLoaded;
      if (window.otgLoaded === false) { window.otgLoaded = 'fetching'; sendOtgStatus = false; }

      try {
        chrome.runtime.sendMessage({
          action: "LIVE_VIDEO_PROGRESS", progress: (window.trackedVideo.currentTime / window.trackedVideo.duration) * 100,
          threshold: window.userThreshold, currentTime: window.trackedVideo.currentTime, duration: window.trackedVideo.duration, 
          aniSkipData: window.aniSkipData, sessionSkips: window.sessionSkips, isOtgLoaded: sendOtgStatus,
          resolvedData: window.resolvedOtgData, hasTriggeredUpdate: window.hasTriggeredUpdate
        }, (response) => {
          if (chrome.runtime.lastError) return;
          
          if (response && response.resolvedData) {
            window.resolvedOtgData = response.resolvedData;

            if (!window.aniSkipData && window.resolvedOtgData.malId) {
              // 1. Fetch Learned Skip Data (To pass into the subtitle parser as a baseline)
              chrome.runtime.sendMessage({ action: "GET_LEARNED_SKIP", mediaId: window.resolvedOtgData.mediaId, episode: window.resolvedOtgData.episode }, (learnedRes) => {
                if (learnedRes) window.learnedSkipData = learnedRes;

                // 2. Fetch AniSkip API
                chrome.runtime.sendMessage({ action: "FETCH_ANISKIP", malId: window.resolvedOtgData.malId, episode: window.resolvedOtgData.episode }, async (skipRes) => {
                  if (skipRes && skipRes.found && skipRes.results && skipRes.results.length > 0) {
                    window.aniSkipData = skipRes.results; window.activeSkipTier = "AniSkip API";
                    
                    // Passive Learning: Save the API's durations for future episodes!
                    window.aniSkipData.forEach(skip => {
                      const duration = skip.interval.endTime - skip.interval.startTime;
                      chrome.runtime.sendMessage({ action: "SAVE_LEARNED_SKIP", mediaId: window.resolvedOtgData.mediaId, episode: window.resolvedOtgData.episode, isOP: skip.skipType === 'op', duration: duration });
                    });

                  } else {
                    // 3. Subtitle AI (Pass learnedData into the engine)
                    const subResult = await window.fetchAndAnalyzeSubtitles(window.trackedVideo.duration, window.learnedSkipData);
                    
                    if (subResult && subResult.found) {
                      window.aniSkipData = subResult.results; window.activeSkipTier = "Subtitle AI";
                    } else {
                      // 4. Fallback to Custom Skip Button (Tier 3)
                      window.aniSkipData = "not_found"; window.activeSkipTier = "Smart Skip";
                      if (!window.customSkipBtnMounted) window.mountCustomSkipButton();
                    }
                  }
                });
              });
            }
          }

          if (response && response.otgTime !== undefined && response.otgTime !== null && window.otgLoaded === 'fetching') {
            window.otgLoaded = true; const targetTime = response.otgTime;
            if (targetTime > 5 && window.trackedVideo.currentTime < 15) {
              window.resumedOtgTime = targetTime; 
              const executeSeek = () => {
                try {
                  window.trackedVideo.currentTime = targetTime;
                  const mins = Math.floor(targetTime / 60); const secs = Math.floor(targetTime % 60).toString().padStart(2, '0');
                  window.showInPageToast('info', 'OTG Resumed', `Jumped to ${mins}:${secs} successfully.`);
                } catch (err) {}
              };
              if (window.trackedVideo.readyState >= 1) executeSeek();
              else { window.trackedVideo.addEventListener('loadedmetadata', executeSeek, { once: true }); window.trackedVideo.addEventListener('canplay', executeSeek, { once: true }); }
            }
          } else if (response && (response.otgTime === null || response.otgTime === undefined) && window.otgLoaded === 'fetching') {
            window.otgLoaded = true; 
          }
        }); 
      } catch (e) {
        if (e.message.includes("Extension context invalidated")) clearInterval(trackerIntervalId);
      }

      if (window.trackedVideo.duration > 180 && window.trackedVideo.currentTime > 60 && (window.trackedVideo.currentTime / window.trackedVideo.duration) * 100 >= window.userThreshold && !window.hasTriggeredUpdate) {
        window.hasTriggeredUpdate = true;
        try { chrome.runtime.sendMessage({ action: "AUTO_UPDATE_ANIME", trueWatchSeconds: window.activeWatchSeconds + window.resumedOtgTime }).catch(() => {}); } catch(e) {}
      }
    }
  }, 1000);

  // Manga Tracking...
  let mangaWatchSeconds = 0; let hasTriggeredMangaUpdate = false;
  let currentMangaUrl = location.href; let currentRawTitle = document.title;
  let mangaOtgLoaded = false; let resolvedMangaOtgData = null; let lastTriggeredChapter = null;

  const mangaIntervalId = setInterval(() => {
    if (!chrome.runtime?.id) { clearInterval(mangaIntervalId); return; }
    if (document.visibilityState !== 'visible' || window.getActiveMediaType() !== 'MANGA') return;

    if (location.href !== currentMangaUrl || document.title !== currentRawTitle) {
      mangaWatchSeconds = 0; hasTriggeredMangaUpdate = false;
      currentMangaUrl = location.href; currentRawTitle = document.title;
      mangaOtgLoaded = false; resolvedMangaOtgData = null;
    }

    const scrollPx = document.documentElement.scrollTop || document.body.scrollTop;
    const maxScroll = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const scrollPct = maxScroll > 0 ? (scrollPx / maxScroll) * 100 : 100;

    if (document.visibilityState === 'visible') mangaWatchSeconds++;

    const parsedData = window.cleanMangaTitle(currentRawTitle);
    let readingType = 'fallback'; let currentProg = 0; let totalProg = 0; let visualPct = 0;

    const pageMatch = currentRawTitle.match(/(?:page\s*)?(\d+)\s*(?:\/|of)\s*(\d+)/i);
    const prefixMatch = currentRawTitle.match(/^(?:page\s*)?(\d+)\s*[-|\|]/i);

    if (pageMatch) {
      readingType = 'page'; currentProg = parseInt(pageMatch[1], 10); totalProg = parseInt(pageMatch[2], 10); visualPct = (currentProg / totalProg) * 100;
    } else if (prefixMatch) {
      readingType = 'page'; currentProg = parseInt(prefixMatch[1], 10);
      const domMatch = document.body.innerText.match(/(?:page\s*)?\d+\s*(?:\/|of)\s*(\d+)/i);
      totalProg = domMatch ? parseInt(domMatch[1], 10) : 0; visualPct = totalProg > 0 ? (currentProg / totalProg) * 100 : 100; 
    } else if (maxScroll > 150) {
      readingType = 'scroll'; currentProg = scrollPct; visualPct = scrollPct;
    } else {
      readingType = 'fallback'; visualPct = Math.min((mangaWatchSeconds / 15) * 100, 100);
    }

    let sendMangaOtgStatus = mangaOtgLoaded;
    if (mangaOtgLoaded === false) { mangaOtgLoaded = 'fetching'; sendMangaOtgStatus = false; }

    try {
      chrome.runtime.sendMessage({
        action: "LIVE_MANGA_PROGRESS", readingType: readingType, progress: currentProg, total: totalProg, pct: visualPct,
        isCompleted: hasTriggeredMangaUpdate, isOtgLoaded: sendMangaOtgStatus,
        parsedTitle: parsedData.title, chapter: parsedData.chapter, resolvedData: resolvedMangaOtgData
      }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.resolvedData) {
          resolvedMangaOtgData = response.resolvedData;
          if (response.resolvedData.isCustom && mangaOtgLoaded === 'fetching') {
            window.showInPageToast('warning', 'Not on AniList', `"${response.resolvedData.customTitle}" was not found. Progress is securely saved locally to your OTG account!`);
          }
        }
        if (response && response.otgTime !== undefined && response.otgTime !== null && mangaOtgLoaded === 'fetching') {
          mangaOtgLoaded = true;
          if (readingType === 'scroll' && response.otgTime > 5) {
            const targetPct = response.otgTime; const targetScroll = maxScroll * (targetPct / 100);
            window.scrollTo({ top: targetScroll, behavior: 'smooth' });
            window.showInPageToast('info', 'OTG Resumed', `Scrolled to ${targetPct.toFixed(1)}% successfully.`);
          } else if (readingType === 'page' && response.otgTime > 0) {
            const cleanCurrentUrl = window.location.href.split('#')[0].replace(/\/$/, '');
            const cleanSavedUrl = response.otgUrl ? response.otgUrl.split('#')[0].replace(/\/$/, '') : null;
            if (currentProg !== response.otgTime && cleanSavedUrl && cleanCurrentUrl !== cleanSavedUrl) {
              window.showInPageToast('info', 'OTG Resuming', `Jumping to Page ${response.otgTime}...`);
              setTimeout(() => { window.location.href = response.otgUrl; }, 1500); 
            } else if (currentProg === response.otgTime) {
              window.showInPageToast('info', 'OTG Resumed', `Welcome back to Page ${response.otgTime}!`);
            }
          }
        } else if (response && (response.otgTime === null || response.otgTime === undefined) && mangaOtgLoaded === 'fetching') {
          mangaOtgLoaded = true; 
        }
      });
    } catch (e) {}

    if (!hasTriggeredMangaUpdate) {
      let shouldTrigger = false;
      if (readingType === 'page') {
        if (totalProg > 0 && currentProg >= totalProg) shouldTrigger = true;
        else if (totalProg === 0 && mangaWatchSeconds >= 15) shouldTrigger = true;
      } else if (readingType === 'scroll') {
        if (scrollPct >= 90) shouldTrigger = true;
      } else {
        if (mangaWatchSeconds >= 15) shouldTrigger = true;
      }

      if (shouldTrigger) {
        hasTriggeredMangaUpdate = true;
        const parsedData = window.cleanMangaTitle(currentRawTitle);
        if (parsedData.title && parsedData.chapter !== null && parsedData.chapter !== lastTriggeredChapter) {
          lastTriggeredChapter = parsedData.chapter; 
          try { 
            chrome.runtime.sendMessage({ 
              action: "AUTO_UPDATE_MANGA", cleanTitle: parsedData.title, chapter: parsedData.chapter, 
              readingData: { readingType: readingType, totalPages: totalProg, scrollHeight: document.documentElement.scrollHeight, viewportHeight: document.documentElement.clientHeight, trueReadSeconds: mangaWatchSeconds }
            }).catch(() => {}); 
          } catch(e) {}
        }
      }
    }
  }, 1000);
};