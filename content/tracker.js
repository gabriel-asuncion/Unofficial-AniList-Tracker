// content/tracker.js

let activeWatchSeconds = 0;
let resumedOtgTime = 0; 
let hasTriggeredUpdate = false;
let currentUrl = location.href; 
let currentVideoSrc = ""; 
let otgLoaded = false;
let otgSaveLock = false; 
let resolvedOtgData = null; 
let aniSkipData = null; 
let activeSkipTier = "Detecting...";
let skipButtonMounted = false;
let customSkipBtnMounted = false;
let learnedSkipData = { op: 85, ed: 85 };
let manualSeekStart = 0;
let sessionSkips = [];
let customBtnAppearedAt = 0; 
let lastSkipTime = 0; 
let skipSyncInterval = null;
let customSkipSyncInterval = null;

document.addEventListener("visibilitychange", async () => {
  if (typeof getActiveMediaType === 'function' && getActiveMediaType() !== 'ANIME') return;
  if (trackedVideo && 'autoPictureInPicture' in trackedVideo) return; 

  if (document.visibilityState === "hidden") {
    if (trackedVideo && !trackedVideo.paused && !document.pictureInPictureElement) {
      try { await trackedVideo.requestPictureInPicture(); } catch (e) {}
    }
  } else if (document.visibilityState === "visible") {
    if (document.pictureInPictureElement && trackedVideo && document.pictureInPictureElement === trackedVideo) {
      try { await document.exitPictureInPicture(); } catch (e) {}
    }
  }
});

let hlsSkipData = null;
const script = document.createElement('script');
script.src = chrome.runtime.getURL('hls-interceptor.js');
script.onload = () => script.remove(); 
(document.head || document.documentElement).appendChild(script);

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return;
  if (event.data.type === 'HLS_DISCONTINUITY_FOUND') {
    hlsSkipData = { skipType: 'op', interval: event.data.interval };
  }
});

function startMediaTrackers(matchedDomain) {
  if (!matchedDomain) return;

  const trackerIntervalId = setInterval(() => {
    if (!chrome.runtime?.id) { clearInterval(trackerIntervalId); return; }
    if (document.visibilityState !== 'visible' || getActiveMediaType() !== 'ANIME') return;

    if (location.href !== currentUrl || (trackedVideo && !trackedVideo.isConnected)) {
      activeWatchSeconds = 0; resumedOtgTime = 0; currentUrl = location.href;
      trackedVideo = null; currentVideoSrc = ""; hasTriggeredUpdate = false; 
      otgLoaded = false; resolvedOtgData = null; aniSkipData = null; 
      sessionSkips = []; customBtnAppearedAt = 0;
      if (skipButtonMounted) unmountSkipButton(); 
    }

    if (trackedVideo && !trackedVideo.paused && document.visibilityState === 'visible') {
      activeWatchSeconds++;
    }

    if (!trackedVideo || isNaN(trackedVideo.duration) || trackedVideo.duration < 300) {
      const videos = getDeepVideos(document);
      let maxDuration = 0; let longestVideo = null;
      
      videos.forEach(v => {
        if (!isNaN(v.duration) && v.duration > maxDuration) { maxDuration = v.duration; longestVideo = v; }
      });
      
      if (maxDuration > 300) {
        trackedVideo = longestVideo;
        
        if ('autoPictureInPicture' in trackedVideo) {
          trackedVideo.autoPictureInPicture = true;
        }

        if (!trackedVideo.hasAttribute('data-seek-tracked')) {
          trackedVideo.setAttribute('data-seek-tracked', 'true');
          trackedVideo.addEventListener('seeking', () => { if (manualSeekStart === 0) manualSeekStart = trackedVideo.currentTime; });
          trackedVideo.addEventListener('seeked', () => {
            if (manualSeekStart > 0 && resolvedOtgData) {
              let diff = trackedVideo.currentTime - manualSeekStart;
              if (diff > 70 && diff < 100) {
                let isOP = manualSeekStart < (trackedVideo.duration * 0.5);
                chrome.runtime.sendMessage({ action: "SAVE_LEARNED_SKIP", mediaId: resolvedOtgData.mediaId, isOP: isOP, duration: diff });
                if (isOP) learnedSkipData.op = Math.round(diff) - 1; else learnedSkipData.ed = Math.round(diff) - 1;
              }
              manualSeekStart = 0;
            }
          });
        }
      }
    }

    if (trackedVideo && !isNaN(trackedVideo.duration) && trackedVideo.duration > 0) {
      if (trackedVideo.src !== currentVideoSrc) {
        currentVideoSrc = trackedVideo.src; hasTriggeredUpdate = false; 
        otgLoaded = false; resumedOtgTime = 0; resolvedOtgData = null; 
        aniSkipData = null; hlsSkipData = null; customBtnAppearedAt = 0; 
        if (skipButtonMounted) unmountSkipButton(); 
      }

      if (Date.now() - lastSkipTime < 15000) {
        if (skipButtonMounted) unmountSkipButton();
        if (customSkipBtnMounted) {
          const customBtn = document.getElementById('shiinah-custom-hotzone');
          if (customBtn) customBtn.style.display = 'none';
        }
      } else {
        if (aniSkipData && Array.isArray(aniSkipData)) {
          const ct = trackedVideo.currentTime;
          const activeSkip = aniSkipData.find(skip => ct >= skip.interval.startTime && ct <= skip.interval.endTime);
          
          if (activeSkip) { 
            if (autoSkipEnabled && activeSkip.interval.endTime) {
              lastSkipTime = Date.now();
              trackedVideo.currentTime = activeSkip.interval.endTime;
              showInPageToast('success', 'Auto-Skipped', activeSkip.skipType === 'ed' ? 'Outro auto-skipped!' : 'Intro auto-skipped!');
            } else {
              if (!skipButtonMounted) mountSkipButton(activeSkip); 
            }
          } else { 
            if (skipButtonMounted) unmountSkipButton(); 
          }
        }

        if (customSkipBtnMounted && trackedVideo && aniSkipData === "not_found") {
          const customBtn = document.getElementById('shiinah-custom-hotzone');
          if (customBtn) {
            const pct = trackedVideo.currentTime / trackedVideo.duration;
            if (pct < 0.5 || pct > 0.8) {
              if (customBtn.style.display !== 'block') {
                customBtn.style.display = 'block';
                customBtnAppearedAt = trackedVideo.currentTime; 
              }
            } else { 
              customBtn.style.display = 'none'; 
              customBtnAppearedAt = 0; 
            }
          }
        }
      }

      if (otgSaveLock) return;

      let sendOtgStatus = otgLoaded;
      if (otgLoaded === false) { otgLoaded = 'fetching'; sendOtgStatus = false; }

      try {
        chrome.runtime.sendMessage({
          action: "LIVE_VIDEO_PROGRESS", progress: (trackedVideo.currentTime / trackedVideo.duration) * 100,
          threshold: userThreshold, currentTime: trackedVideo.currentTime, duration: trackedVideo.duration, 
          aniSkipData: aniSkipData, sessionSkips: sessionSkips, isOtgLoaded: sendOtgStatus,
          resolvedData: resolvedOtgData, hasTriggeredUpdate: hasTriggeredUpdate
        }, (response) => {
          if (chrome.runtime.lastError) return;
          
          if (response && response.resolvedData) {
            resolvedOtgData = response.resolvedData;

            if (!aniSkipData && resolvedOtgData.malId) {
              chrome.runtime.sendMessage({
                action: "FETCH_ANISKIP", malId: resolvedOtgData.malId, episode: resolvedOtgData.episode
              }, async (skipRes) => {
                if (skipRes && skipRes.found && skipRes.results && skipRes.results.length > 0) {
                  aniSkipData = skipRes.results; activeSkipTier = "AniSkip API";
                } else {
                  const targetDuration = learnedSkipData ? learnedSkipData.op : 88;
                  const subResult = await fetchAndAnalyzeSubtitles(trackedVideo.duration, targetDuration);
                  if (subResult && subResult.found) {
                    aniSkipData = [{ skipType: subResult.type, interval: subResult.interval }]; activeSkipTier = "In-House Data";
                  } else if (typeof hlsSkipData !== 'undefined' && hlsSkipData) {
                    aniSkipData = [hlsSkipData]; activeSkipTier = "HLS Intercept";
                  } else {
                    aniSkipData = "not_found"; activeSkipTier = "Learned Behavior";
                    chrome.runtime.sendMessage({ action: "GET_LEARNED_SKIP", mediaId: resolvedOtgData.mediaId }, (learnedRes) => {
                      if (learnedRes) learnedSkipData = learnedRes;
                      if (!customSkipBtnMounted) mountCustomSkipButton();
                    });
                  }
                }
              });
            }
          }

          if (response && response.otgTime !== undefined && response.otgTime !== null && otgLoaded === 'fetching') {
            otgLoaded = true; const targetTime = response.otgTime;
            if (targetTime > 5 && trackedVideo.currentTime < 15) {
              resumedOtgTime = targetTime; 
              const executeSeek = () => {
                try {
                  trackedVideo.currentTime = targetTime;
                  const mins = Math.floor(targetTime / 60); const secs = Math.floor(targetTime % 60).toString().padStart(2, '0');
                  showInPageToast('info', 'OTG Resumed', `Jumped to ${mins}:${secs} successfully.`);
                } catch (err) {}
              };
              if (trackedVideo.readyState >= 1) executeSeek();
              else { trackedVideo.addEventListener('loadedmetadata', executeSeek, { once: true }); trackedVideo.addEventListener('canplay', executeSeek, { once: true }); }
            }
          } else if (response && (response.otgTime === null || response.otgTime === undefined) && otgLoaded === 'fetching') {
            otgLoaded = true; 
          }
        }); 
      } catch (e) {
        if (e.message.includes("Extension context invalidated")) clearInterval(trackerIntervalId);
      }

      if (trackedVideo.duration > 180 && trackedVideo.currentTime > 60 && (trackedVideo.currentTime / trackedVideo.duration) * 100 >= userThreshold && !hasTriggeredUpdate) {
        hasTriggeredUpdate = true;
        try { chrome.runtime.sendMessage({ action: "AUTO_UPDATE_ANIME", trueWatchSeconds: activeWatchSeconds + resumedOtgTime }).catch(() => {}); } catch(e) {}
      }
    }
  }, 1000);

  let mangaWatchSeconds = 0; let hasTriggeredMangaUpdate = false;
  let currentMangaUrl = location.href; let currentRawTitle = document.title;
  let mangaOtgLoaded = false; let resolvedMangaOtgData = null; let lastTriggeredChapter = null;

  const mangaIntervalId = setInterval(() => {
    if (!chrome.runtime?.id) { clearInterval(mangaIntervalId); return; }
    if (document.visibilityState !== 'visible' || getActiveMediaType() !== 'MANGA') return;

    if (location.href !== currentMangaUrl || document.title !== currentRawTitle) {
      mangaWatchSeconds = 0; hasTriggeredMangaUpdate = false;
      currentMangaUrl = location.href; currentRawTitle = document.title;
      mangaOtgLoaded = false; resolvedMangaOtgData = null;
    }

    const scrollPx = document.documentElement.scrollTop || document.body.scrollTop;
    const maxScroll = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const scrollPct = maxScroll > 0 ? (scrollPx / maxScroll) * 100 : 100;

    if (document.visibilityState === 'visible') mangaWatchSeconds++;

    const parsedData = cleanMangaTitle(currentRawTitle);
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
            showInPageToast('warning', 'Not on AniList', `"${response.resolvedData.customTitle}" was not found. Progress is securely saved locally to your OTG account!`);
          }
        }
        if (response && response.otgTime !== undefined && response.otgTime !== null && mangaOtgLoaded === 'fetching') {
          mangaOtgLoaded = true;
          if (readingType === 'scroll' && response.otgTime > 5) {
            const targetPct = response.otgTime; const targetScroll = maxScroll * (targetPct / 100);
            window.scrollTo({ top: targetScroll, behavior: 'smooth' });
            showInPageToast('info', 'OTG Resumed', `Scrolled to ${targetPct.toFixed(1)}% successfully.`);
          } else if (readingType === 'page' && response.otgTime > 0) {
            const cleanCurrentUrl = window.location.href.split('#')[0].replace(/\/$/, '');
            const cleanSavedUrl = response.otgUrl ? response.otgUrl.split('#')[0].replace(/\/$/, '') : null;
            if (currentProg !== response.otgTime && cleanSavedUrl && cleanCurrentUrl !== cleanSavedUrl) {
              showInPageToast('info', 'OTG Resuming', `Jumping to Page ${response.otgTime}...`);
              setTimeout(() => { window.location.href = response.otgUrl; }, 1500); 
            } else if (currentProg === response.otgTime) {
              showInPageToast('info', 'OTG Resumed', `Welcome back to Page ${response.otgTime}!`);
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
        const parsedData = cleanMangaTitle(currentRawTitle);
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
}