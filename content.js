// content.js - Unified Playback & Skip Engine

let siteForcedType = null; 

chrome.storage.local.get(['whitelistedDomains', 'trackingThreshold'], (result) => {
  const domains = result.whitelistedDomains || [];
  
  let hostsToCheck = [window.location.hostname];
  if (window.location.ancestorOrigins) {
    for (let i = 0; i < window.location.ancestorOrigins.length; i++) {
      try { hostsToCheck.push(new URL(window.location.ancestorOrigins[i]).hostname); } catch(e) {}
    }
  }

  const matchedDomain = domains.find(d => hostsToCheck.some(h => h.includes(typeof d === 'string' ? d : d.domain)));
  if (!matchedDomain) return; 

  siteForcedType = typeof matchedDomain === 'string' ? 'ANIME' : (matchedDomain.type || 'ANIME');

  // ==========================================
  // 🕸️ HLS NETWORK INTERCEPTOR
  // ==========================================
  let hlsSkipData = null;

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('hls-interceptor.js');
  script.onload = () => script.remove(); 
  (document.head || document.documentElement).appendChild(script);

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'HLS_DISCONTINUITY_FOUND') {
      console.log("[HLS Analyzer]: Discontinuity OP/ED Found!", event.data.interval);
      hlsSkipData = { skipType: 'op', interval: event.data.interval };
    }
  });

  // ==========================================
  // 🧠 SMART MEDIA DETECTOR
  // ==========================================
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
    
    return siteForcedType; 
  }

  // ==========================================
  // 📜 WEBVTT SUBTITLE PARSER & ANALYZER
  // ==========================================
  function parseSubtitlesForOpEd(vttContent, videoDuration) {
    if (!vttContent || typeof vttContent !== 'string') return null;

    const parseTimestamp = (timeStr) => {
      const parts = timeStr.trim().split(':');
      let seconds = 0;
      if (parts.length === 3) {
        seconds = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
      } else if (parts.length === 2) {
        seconds = parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
      }
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
          text += lines[j] + ' ';
          j++;
        }
        
        const isSongLyric = /[♪♫]|<i>|<\/i>|<c\.lyrics>/i.test(text);
        const isShortSign = text.trim().split(/\s+/).length <= 2;

        cues.push({ start, end, text: text.trim(), isSongLyric, isShortSign });
      }
    }

    if (cues.length === 0) return null;

    const maxSearchTime = Math.min(videoDuration * 0.5, 720);
    const windowDuration = 88; 

    for (let t = 0; t <= maxSearchTime - windowDuration; t += 5) {
      const windowStart = t;
      const windowEnd = t + windowDuration;

      const dialogueCount = cues.filter(c => 
        c.start >= windowStart && 
        c.end <= windowEnd && 
        !c.isSongLyric && 
        !c.isShortSign
      ).length;

      if (dialogueCount <= 1) {
        return { found: true, type: 'op', interval: { startTime: windowStart, endTime: windowEnd } };
      }
    }
    return null;
  }

  async function fetchAndAnalyzeSubtitles(videoDuration) {
    try {
      const trackElements = Array.from(document.querySelectorAll('track'));
      const subTrack = trackElements.find(t => t.src && (t.kind === 'subtitles' || t.kind === 'captions' || t.src.includes('.vtt')));

      if (subTrack && subTrack.src) {
        const res = await fetch(subTrack.src);
        if (res.ok) {
          const vttText = await res.text();
          return parseSubtitlesForOpEd(vttText, videoDuration);
        }
      }
    } catch (e) {
      console.log("[Subtitle Probe]: No readable subtitle tracks found.");
    }
    return null;
  }

  // ==========================================
  // 📺 ANIME TRACKING & PLAYBACK ENGINE
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
  let activeSkipTier = "Detecting...";
  let skipButtonMounted = false;
  let customSkipBtnMounted = false;
  let learnedSkipData = { op: 85, ed: 85 };
  let manualSeekStart = 0;

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.trackingThreshold) userThreshold = changes.trackingThreshold.newValue;
  });

  function getDeepVideos(root = document) {
    let videos = Array.from(root.querySelectorAll('video'));
    let allElements = root.querySelectorAll('*');
    for (let el of allElements) {
      if (el.shadowRoot) videos = videos.concat(getDeepVideos(el.shadowRoot));
    }
    return videos;
  }

  let skipSyncInterval = null;

  function mountSkipButton(activeSkip) {
    if (document.getElementById('aniskip-float-btn')) return;
    
    const btn = document.createElement('button');
    btn.id = 'aniskip-float-btn';
    btn.innerHTML = activeSkip.skipType === 'ed' ? '▶ Skip Outro' : '▶ Skip Intro';
    
    Object.assign(btn.style, {
      position: 'fixed', zIndex: '2147483647',
      backgroundColor: 'rgba(21, 31, 46, 0.85)', color: '#fff', border: '1px solid #3db4f2',
      padding: '12px 20px', borderRadius: '6px', cursor: 'pointer',
      fontFamily: 'system-ui, sans-serif', fontWeight: 'bold', fontSize: '15px',
      transition: 'all 0.2s ease', backdropFilter: 'blur(4px)', boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
      pointerEvents: 'auto'
    });

    btn.addEventListener('mouseenter', () => btn.style.backgroundColor = 'rgba(61, 180, 242, 0.9)');
    btn.addEventListener('mouseleave', () => btn.style.backgroundColor = 'rgba(21, 31, 46, 0.85)');
    
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation(); 
      if (trackedVideo && activeSkip && activeSkip.interval.endTime) {
        trackedVideo.currentTime = activeSkip.interval.endTime;
        showInPageToast('success', 'Skipped', activeSkip.skipType === 'ed' ? 'Outro skipped successfully!' : 'Intro skipped successfully!');
        unmountSkipButton();
      }
    });

    const container = document.fullscreenElement || document.body;
    container.appendChild(btn);
    skipButtonMounted = true;

    // Track the video position and mathematically pin the button to the bottom right
    if (skipSyncInterval) clearInterval(skipSyncInterval);
    skipSyncInterval = setInterval(() => {
      if (!trackedVideo) return;
      const currentContainer = document.fullscreenElement || document.body;
      if (btn.parentElement !== currentContainer) currentContainer.appendChild(btn);
      
      const rect = trackedVideo.getBoundingClientRect();
      btn.style.bottom = (window.innerHeight - rect.bottom + 70) + 'px';
      btn.style.right = (window.innerWidth - rect.right + 30) + 'px';
    }, 50);
  }

  function unmountSkipButton() {
    const btn = document.getElementById('aniskip-float-btn');
    if (btn) btn.remove();
    if (skipSyncInterval) clearInterval(skipSyncInterval);
    skipButtonMounted = false;
  }

  let customSkipSyncInterval = null;

  function mountCustomSkipButton() {
    if (document.getElementById('shiinah-custom-hotzone')) return;

    const btn = document.createElement('div');
    btn.id = 'shiinah-custom-hotzone';
    
    Object.assign(btn.style, {
      position: 'fixed', width: '160px', height: '100px',
      backgroundColor: 'rgba(255, 255, 255, 0.01)', cursor: 'pointer', zIndex: '2147483647',
      borderRadius: '8px', display: 'none', transition: 'background-color 0.2s ease',
      alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto'
    });

    const hoverText = document.createElement('span');
    Object.assign(hoverText.style, {
      backgroundColor: 'rgba(21, 31, 46, 0.9)', color: '#4cca51',
      border: '1px solid #4cca51', padding: '10px 16px', borderRadius: '6px',
      fontFamily: 'system-ui, sans-serif', fontWeight: 'bold', fontSize: '14px',
      display: 'none', pointerEvents: 'none', backdropFilter: 'blur(4px)',
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
    });
    btn.appendChild(hoverText);

    const formatTime = (secs) => {
      const m = Math.floor(secs / 60);
      const s = Math.floor(secs % 60).toString().padStart(2, '0');
      return `${m}:${s}`;
    };

    btn.addEventListener('mouseenter', () => {
      btn.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
      if (trackedVideo) {
        const isOP = trackedVideo.currentTime < (trackedVideo.duration * 0.5);
        const skipAmount = isOP ? learnedSkipData.op : learnedSkipData.ed;
        hoverText.textContent = `⏭ Skip: ${formatTime(skipAmount)}`;
      }
      hoverText.style.display = 'block';
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.backgroundColor = 'rgba(255, 255, 255, 0.01)';
      hoverText.style.display = 'none';
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation(); 
      if (!trackedVideo) return;
      const isOP = trackedVideo.currentTime < (trackedVideo.duration * 0.5);
      const skipAmount = isOP ? learnedSkipData.op : learnedSkipData.ed;
      trackedVideo.currentTime += skipAmount;
      showInPageToast('info', 'Custom Skip', `Skipped ${skipAmount}s using learned data!`);
      hoverText.style.display = 'none';
      btn.style.display = 'none';
    });

    const container = document.fullscreenElement || document.body;
    container.appendChild(btn);
    customSkipBtnMounted = true;

    // Track the video position and mathematically pin the hotzone
    if (customSkipSyncInterval) clearInterval(customSkipSyncInterval);
    customSkipSyncInterval = setInterval(() => {
      if (!trackedVideo) return;
      const currentContainer = document.fullscreenElement || document.body;
      if (btn.parentElement !== currentContainer) currentContainer.appendChild(btn);
      
      const rect = trackedVideo.getBoundingClientRect();
      btn.style.top = (rect.top + (rect.height * 0.10)) + 'px';
      btn.style.right = (window.innerWidth - rect.right + (rect.width * 0.05)) + 'px';
    }, 50);
  }

  const trackerIntervalId = setInterval(() => {
    if (!chrome.runtime?.id) {
      clearInterval(trackerIntervalId);
      return; 
    }
    
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
      
      if (maxDuration > 300) {
        trackedVideo = longestVideo;
        
        if (!trackedVideo.hasAttribute('data-seek-tracked')) {
          trackedVideo.setAttribute('data-seek-tracked', 'true');
          trackedVideo.addEventListener('seeking', () => { if (manualSeekStart === 0) manualSeekStart = trackedVideo.currentTime; });
          trackedVideo.addEventListener('seeked', () => {
            if (manualSeekStart > 0 && resolvedOtgData) {
              let diff = trackedVideo.currentTime - manualSeekStart;
              if (diff > 70 && diff < 100) {
                let isOP = manualSeekStart < (trackedVideo.duration * 0.5);
                chrome.runtime.sendMessage({ action: "SAVE_LEARNED_SKIP", mediaId: resolvedOtgData.mediaId, isOP: isOP, duration: diff });
                if (isOP) learnedSkipData.op = Math.round(diff) - 1;
                else learnedSkipData.ed = Math.round(diff) - 1;
              }
              manualSeekStart = 0;
            }
          });
        }
      }
    }

    if (trackedVideo && !isNaN(trackedVideo.duration) && trackedVideo.duration > 0) {
      if (trackedVideo.src !== currentVideoSrc) {
        currentVideoSrc = trackedVideo.src;
        hasTriggeredUpdate = false; 
        otgLoaded = false; 
        resolvedOtgData = null; 
        aniSkipData = null; 
        hlsSkipData = null;
        if (skipButtonMounted) unmountSkipButton(); 
      }

      if (aniSkipData && Array.isArray(aniSkipData)) {
        const ct = trackedVideo.currentTime;
        const activeSkip = aniSkipData.find(skip => ct >= skip.interval.startTime && ct <= skip.interval.endTime);
        if (activeSkip) { if (!skipButtonMounted) mountSkipButton(activeSkip); } 
        else { if (skipButtonMounted) unmountSkipButton(); }
      }

      if (customSkipBtnMounted && trackedVideo && aniSkipData === "not_found") {
        const customBtn = document.getElementById('shiinah-custom-hotzone');
        if (customBtn) {
          const pct = trackedVideo.currentTime / trackedVideo.duration;
          if (pct < 0.5 || pct > 0.8) customBtn.style.display = 'flex';
          else customBtn.style.display = 'none';
        }
      }

      if (otgSaveLock) return;

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
          isOtgLoaded: sendOtgStatus,
          resolvedData: resolvedOtgData,
          hasTriggeredUpdate: hasTriggeredUpdate 
        }, (response) => {
          if (chrome.runtime.lastError) return;
          
          if (response && response.resolvedData) {
            resolvedOtgData = response.resolvedData;

            if (!aniSkipData && resolvedOtgData.malId) {
              chrome.runtime.sendMessage({
                action: "FETCH_ANISKIP", malId: resolvedOtgData.malId, episode: resolvedOtgData.episode
              }, async (skipRes) => {
                if (skipRes && skipRes.found && skipRes.results && skipRes.results.length > 0) {
                  aniSkipData = skipRes.results;
                  activeSkipTier = "Tier 1: AniSkip API";
                } else {
                  const subResult = await fetchAndAnalyzeSubtitles(trackedVideo.duration);
                  if (subResult && subResult.found) {
                    aniSkipData = [{ skipType: subResult.type, interval: subResult.interval }];
                    activeSkipTier = "Tier 2: Subtitles";
                  } else if (typeof hlsSkipData !== 'undefined' && hlsSkipData) {
                    aniSkipData = [hlsSkipData];
                    activeSkipTier = "Tier 3: HLS Intercept";
                  } else {
                    aniSkipData = "not_found"; 
                    activeSkipTier = "Tier 4: Learned Behavior";
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
            otgLoaded = true;
            const targetTime = response.otgTime;
            if (targetTime > 5 && trackedVideo.currentTime < 15) {
              const executeSeek = () => {
                try {
                  trackedVideo.currentTime = targetTime;
                  const mins = Math.floor(targetTime / 60);
                  const secs = Math.floor(targetTime % 60).toString().padStart(2, '0');
                  showInPageToast('info', 'OTG Resumed', `Jumped to ${mins}:${secs} successfully.`);
                } catch (err) {}
              };
              if (trackedVideo.readyState >= 1) {
                executeSeek();
              } else {
                trackedVideo.addEventListener('loadedmetadata', executeSeek, { once: true });
                trackedVideo.addEventListener('canplay', executeSeek, { once: true });
              }
            }
          // ✅ SURGICAL FIX: Prevent 'fetching' state from getting stuck if undefined
          } else if (response && (response.otgTime === null || response.otgTime === undefined) && otgLoaded === 'fetching') {
            otgLoaded = true; 
          }
        }); 
      } catch (e) {
        if (e.message.includes("Extension context invalidated")) clearInterval(trackerIntervalId);
      }

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
  let mangaOtgLoaded = false;
  let resolvedMangaOtgData = null;
  let lastTriggeredChapter = null;
  
  function cleanMangaTitle(rawTitle) {
    let chapter = null;
    let targetText = rawTitle;
    const url = window.location.href || "";
    
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
      mangaOtgLoaded = false;
      resolvedMangaOtgData = null;
    }

    const scrollPx = document.documentElement.scrollTop || document.body.scrollTop;
    const maxScroll = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const scrollPct = maxScroll > 0 ? (scrollPx / maxScroll) * 100 : 100;

    if (document.visibilityState === 'visible') mangaWatchSeconds++;

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

    let sendMangaOtgStatus = mangaOtgLoaded;
    if (mangaOtgLoaded === false) {
      mangaOtgLoaded = 'fetching';
      sendMangaOtgStatus = false;
    }

    try {
      chrome.runtime.sendMessage({
        action: "LIVE_MANGA_PROGRESS",
        readingType: readingType, progress: currentProg, total: totalProg, pct: visualPct,
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
            const targetPct = response.otgTime;
            const targetScroll = maxScroll * (targetPct / 100);
            window.scrollTo({ top: targetScroll, behavior: 'smooth' });
            showInPageToast('info', 'OTG Resumed', `Scrolled to ${targetPct.toFixed(1)}% successfully.`);
          }
          else if (readingType === 'page' && response.otgTime > 0) {
            const cleanCurrentUrl = window.location.href.split('#')[0].replace(/\/$/, '');
            const cleanSavedUrl = response.otgUrl ? response.otgUrl.split('#')[0].replace(/\/$/, '') : null;

            if (currentProg !== response.otgTime && cleanSavedUrl && cleanCurrentUrl !== cleanSavedUrl) {
              showInPageToast('info', 'OTG Resuming', `Jumping to Page ${response.otgTime}...`);
              setTimeout(() => { window.location.href = response.otgUrl; }, 1500); 
            } 
            else if (currentProg === response.otgTime) {
              showInPageToast('info', 'OTG Resumed', `Welcome back to Page ${response.otgTime}!`);
            }
          }
        // ✅ SURGICAL FIX: Prevent 'fetching' state from getting stuck if undefined
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
          try { chrome.runtime.sendMessage({ action: "AUTO_UPDATE_MANGA", cleanTitle: parsedData.title, chapter: parsedData.chapter, trueReadSeconds: mangaWatchSeconds }).catch(() => {}); } catch(e) {}
        }
      }
    }
  }, 1000);

  // ==========================================
  // 🍞 TOAST & MODAL UI SYSTEMS
  // ==========================================
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "SHOW_SUCCESS_TOAST") {
       showInPageToast('success', 'Update Successful', request.message);
       sendResponse({ success: true });
    }
    // ✅ SMART SKIP ROUTER: Checks for exact data before defaulting to 90s
    else if (request.action === "SMART_SKIP" && trackedVideo) {
      let skipped = false;
      const ct = trackedVideo.currentTime;
      
      if (aniSkipData && Array.isArray(aniSkipData)) {
        const activeSkip = aniSkipData.find(skip => ct >= skip.interval.startTime && ct <= skip.interval.endTime);
        if (activeSkip && activeSkip.interval.endTime) {
          trackedVideo.currentTime = activeSkip.interval.endTime;
          skipped = true;
          showInPageToast('success', 'Skipped', activeSkip.skipType === 'ed' ? 'Outro skipped successfully!' : 'Intro skipped successfully!');
        }
      }
      
      if (!skipped) {
        const isOP = ct < (trackedVideo.duration * 0.5);
        const skipAmount = (aniSkipData === "not_found" && learnedSkipData) ? (isOP ? learnedSkipData.op : learnedSkipData.ed) : 90;
        trackedVideo.currentTime += skipAmount;
        showInPageToast('info', 'Skipped', `Skipped forward ${skipAmount} seconds.`);
      }
      sendResponse({ success: true });
    }
    else if (request.action === "SKIP_TIME" && trackedVideo) {
      trackedVideo.currentTime += request.amount;
      sendResponse({ success: true });
    }
    else if (request.action === "SHOW_RATING_MODAL") {
      showRatingModal(request.mediaId, request.animeName);
      sendResponse({ success: true });
    }
    else if (request.action === "GET_ACTIVE_SKIP_TIER") {
      sendResponse({ tierText: activeSkipTier });
    } else {
      sendResponse({ success: false });
    }
    // ✅ SURGICAL FIX 1: Return false to safely close the message channel and kill the console error!
    return false; 
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

    // ✅ SURGICAL FIX: Attach to fullscreen element so it isn't hidden behind the video player
    const container = document.fullscreenElement || document.body;
    container.appendChild(toast);

    const closeBtn = toast.querySelector('.toast-close-btn');
    closeBtn.addEventListener('mouseenter', () => closeBtn.firstElementChild.style.opacity = '1');
    closeBtn.addEventListener('mouseleave', () => closeBtn.firstElementChild.style.opacity = '0.5');
    closeBtn.addEventListener('click', () => { toast.style.right = '-400px'; setTimeout(() => toast.remove(), 400); });

    requestAnimationFrame(() => { setTimeout(() => { toast.style.right = '20px'; }, 100); });
    setTimeout(() => {
      if (container.contains(toast)) {
        toast.style.right = '-400px';
        setTimeout(() => { if (container.contains(toast)) toast.remove(); }, 400);
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

  // ==========================================
  // 🏷️ SMART CARD-BASED DOM SCANNER & TOOLTIP
  // ==========================================
  const SVG_UNLISTED = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><style>svg { overflow: visible; }@keyframes kf_pulse_1_transform_0 {  0% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  20% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }  100% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }}@keyframes kf_pulse_1_stroke_0 {  0% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #FFD345; }  10% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #FFD345; }  20% { stroke: rgba(255, 211, 69, 0); }  100% { stroke: rgba(255, 211, 69, 0); }}#pulse_1 { transform-origin: 0 0; animation: kf_pulse_1_transform_0 2s linear infinite, kf_pulse_1_stroke_0 2s linear infinite;}@keyframes kf_pulse_2_transform_0 {  0% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  10% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  30% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }  100% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }}@keyframes kf_pulse_2_stroke_0 {  0% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #FFD345; }  20% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #FFD345; }  30% { stroke: rgba(255, 211, 69, 0); }  100% { stroke: rgba(255, 211, 69, 0); }}#pulse_2 { transform-origin: 0 0; animation: kf_pulse_2_transform_0 2s linear infinite, kf_pulse_2_stroke_0 2s linear infinite;}@keyframes kf_pulse_3_transform_0 {  0% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  20% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  40% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }  100% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }}@keyframes kf_pulse_3_stroke_0 {  0% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #FFD345; }  10.05% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #4CCA51; }  20% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #FFD345; }  30% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #FFD345; }  40% { stroke: rgba(255, 211, 69, 0); }  100% { stroke: rgba(255, 211, 69, 0); }}#pulse_3 { transform-origin: 0 0; animation: kf_pulse_3_transform_0 2s linear infinite, kf_pulse_3_stroke_0 2s linear infinite;}</style><g id="watchlist_no"><circle id="pulse_1" cx="12" cy="12" r="11.5" stroke="#FFD345"/><circle id="pulse_2" cx="12" cy="12" r="11.5" stroke="#FFD345"/><circle id="pulse_3" cx="12" cy="12" r="11.5" stroke="#FFD345"/><circle id="bg" cx="12" cy="12" r="12" fill="#FFD345"/><path id="i" transform="translate(9 4)" d="M3.648 3.744C2.976 3.744 2.472 3.592 2.136 3.288C1.8 2.968 1.632 2.528 1.632 1.968C1.632 1.408 1.848 0.944 2.28 0.576C2.728 0.192 3.28 0 3.936 0C4.528 0 5.008 0.144 5.376 0.432C5.744 0.72 5.928 1.128 5.928 1.656C5.928 2.296 5.72 2.808 5.304 3.192C4.888 3.56 4.336 3.744 3.648 3.744ZM1.344 16.632C0.832 16.632 0.48 16.528 0.288 16.32C0.096 16.112 0 15.784 0 15.336C0 15.208 0.016 14.984 0.048 14.664C0.304 11.736 0.728 9.072 1.32 6.672C1.448 6.176 1.656 5.832 1.944 5.64C2.248 5.432 2.728 5.328 3.384 5.328C4.072 5.328 4.416 5.608 4.416 6.168C4.416 6.248 4.4 6.4 4.368 6.624C3.648 10.048 3.216 12.92 3.072 15.24C3.04 15.752 2.888 16.112 2.616 16.32C2.344 16.528 1.92 16.632 1.344 16.632Z" fill="white"/></g></svg>`)}`;
  // const SVG_YES = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><style>@keyframes kf_outline_transform_0 {  0% {animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px);  }  15.85% {animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);transform: translate(12px, 12px) scaleX(0.8) scaleY(0.8) translate(-12px, -12px);  }  33.1% {animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);transform: translate(12px, 12px) scaleX(0.95) scaleY(0.95) translate(-12px, -12px);  }  57.95% {animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);transform: translate(12px, 12px) scaleX(0.61) scaleY(0.61) translate(-12px, -12px);  }  85.5% {transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px);  }  100% {transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px);  }}#outline {  transform-origin: 0 0;  animation: kf_outline_transform_0 2s linear infinite;}@keyframes kf_fill_transform_0 {  0% {animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px);  }  19.9% {animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);transform: translate(12px, 12px) scaleX(0.57) scaleY(0.57) translate(-12px, -12px);  }  34.95% {animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);transform: translate(12px, 12px) scaleX(0.6) scaleY(0.6) translate(-12px, -12px);  }  46.25% {animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);transform: translate(12px, 12px) scaleX(0.99) scaleY(0.99) translate(-12px, -12px);  }  63.65% {animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);transform: translate(12px, 12px) scaleX(0.33) scaleY(0.33) translate(-12px, -12px);  }  83.45% {transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px);  }  100% {transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px);  }}#fill {  transform-origin: 0 0;  animation: kf_fill_transform_0 2s linear infinite;}@keyframes kf_check_group_transform_0 {  0% {animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);transform: translateX(4px) translateY(4px) translate(8px, 8px) rotate(0rad) translate(-8px, -8px);  }  30% {transform: translateX(4px) translateY(4px) translate(8px, 8px) rotate(-1.571rad) translate(-8px, -8px);  }  42.5% {animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);transform: translateX(4px) translateY(4px) translate(8px, 8px) rotate(-1.571rad) translate(-8px, -8px);  }  50% {transform: translateX(4px) translateY(4px) translate(8px, 8px) rotate(0rad) translate(-8px, -8px);  }  100% {transform: translateX(4px) translateY(4px) translate(8px, 8px) rotate(0rad) translate(-8px, -8px);  }}#check_group {  transform-origin: 0 0;  animation: kf_check_group_transform_0 2s linear infinite;}</style><g id="new_ok" clip-path="url(#clip0_304_952)"><circle id="outline" cx="12" cy="12" r="11.5" stroke="#4CCA51"/><circle id="fill" cx="12" cy="12" r="12" fill="#4CCA51"/><g id="check_group" clip-path="url(#clip1_304_952)" transform="translate(4 4)"><rect id="left" transform="matrix(-0.707107 -0.707107 -0.707107 0.707107 7.4248 12.6567)" width="8.72559" height="2.5" rx="2" fill="white"><animate attributeName="width" values="8.726; 8.139; 7.553; 6.966; 6.38; 5.793; 5.207; 4.62; 4.034; 3.447; 2.86; 2.274; 1.687; 1.547; 1.406; 1.266; 1.125; 0.984; 0.844; 0.703; 0.563; 0.422; 0.281; 0.141; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0; 0.007; 0.013; 0.019; 0.026; 0.032; 0.039; 0.045; 0.051; 0.058; 0.064; 0.071; 0.077; 0.26; 0.443; 0.626; 0.809; 0.992; 1.175; 1.358; 1.541; 1.724; 1.907; 2.09; 2.273; 2.45; 2.626; 2.803; 2.979; 3.156; 3.332; 3.509; 3.685; 3.862; 4.039; 4.215; 4.392; 4.753; 5.114; 5.475; 5.836; 6.198; 6.559; 6.92; 7.281; 7.642; 8.003; 8.364; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726; 8.726" keyTimes="0; 0.0132; 0.0264; 0.0396; 0.0528; 0.066; 0.0793; 0.0925; 0.1057; 0.1189; 0.1321; 0.1453; 0.1585; 0.1617; 0.1648; 0.168; 0.1712; 0.1743; 0.1775; 0.1807; 0.1838; 0.187; 0.1902; 0.1933; 0.1965; 0.1967; 0.1969; 0.1971; 0.1973; 0.1975; 0.1978; 0.198; 0.1982; 0.1984; 0.1986; 0.1988; 0.199; 0.2074; 0.2158; 0.2243; 0.2327; 0.2411; 0.2495; 0.2579; 0.2663; 0.2748; 0.2832; 0.2916; 0.3; 0.3009; 0.3018; 0.3026; 0.3035; 0.3044; 0.3053; 0.3061; 0.307; 0.3079; 0.3088; 0.3096; 0.3105; 0.3122; 0.3139; 0.3156; 0.3173; 0.319; 0.3208; 0.3225; 0.3242; 0.3259; 0.3276; 0.3293; 0.331; 0.3325; 0.3341; 0.3356; 0.3372; 0.3387; 0.3403; 0.3418; 0.3433; 0.3449; 0.3464; 0.348; 0.3495; 0.3558; 0.3621; 0.3684; 0.3747; 0.381; 0.3873; 0.3935; 0.3998; 0.4061; 0.4124; 0.4187; 0.425; 0.4281; 0.4313; 0.4344; 0.4375; 0.4406; 0.4438; 0.4469; 0.45; 0.4531; 0.4563; 0.4594; 0.4625; 0.4656; 0.4688; 0.4719; 0.475; 0.4781; 0.4813; 0.4844; 0.4875; 0.4906; 0.4938; 0.4969; 0.5; 0.5065; 0.5129; 0.5194; 0.5258; 0.5323; 0.5387; 0.5452; 0.5517; 0.5581; 0.5646; 0.571; 0.5775; 0.5777; 0.5778; 0.578; 0.5782; 0.5783; 0.5785; 0.5787; 0.5788; 0.579; 0.5792; 0.5793; 0.5795; 0.5843; 0.589; 0.5938; 0.5985; 0.6032; 0.608; 0.6128; 0.6175; 0.6223; 0.627; 0.6318; 0.6365; 0.6411; 0.6457; 0.6503; 0.6548; 0.6594; 0.664; 0.6686; 0.6732; 0.6778; 0.6823; 0.6869; 0.6915; 0.7009; 0.7103; 0.7196; 0.729; 0.7384; 0.7478; 0.7571; 0.7665; 0.7759; 0.7853; 0.7946; 0.804; 0.8065; 0.8091; 0.8116; 0.8142; 0.8167; 0.8193; 0.8218; 0.8243; 0.8269; 0.8294; 0.832; 0.8345; 0.8362; 0.8379; 0.8396; 0.8413; 0.843; 0.8448; 0.8465; 0.8482; 0.8499; 0.8516; 0.8533; 0.855; 0.8671; 0.8792; 0.8913; 0.9033; 0.9154; 0.9275; 0.9396; 0.9517; 0.9638; 0.9758; 0.9879; 1" dur="2s" calcMode="linear" repeatCount="indefinite" /></rect><rect id="right" transform="translate(4 12.6567) rotate(-45)" width="15.1949" height="2.5" rx="2" fill="white"><animate attributeName="width" values="15.195; 14.676; 14.157; 13.639; 13.12; 12.601; 12.082; 11.564; 11.045; 10.526; 10.007; 9.489; 8.97; 8.845; 8.721; 8.597; 8.472; 8.348; 8.224; 8.099; 7.975; 7.85; 7.726; 7.602; 7.477; 7.469; 7.461; 7.453; 7.445; 7.436; 7.428; 7.42; 7.412; 7.404; 7.396; 7.387; 7.379; 7.049; 6.718; 6.387; 6.057; 5.726; 5.396; 5.065; 4.735; 4.404; 4.074; 3.743; 3.412; 3.378; 3.344; 3.309; 3.275; 3.241; 3.206; 3.172; 3.137; 3.103; 3.069; 3.034; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 3; 4.016; 5.032; 6.049; 7.065; 8.081; 9.097; 10.114; 11.13; 12.146; 13.162; 14.179; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195; 15.195" keyTimes="0; 0.0132; 0.0264; 0.0396; 0.0528; 0.066; 0.0793; 0.0925; 0.1057; 0.1189; 0.1321; 0.1453; 0.1585; 0.1617; 0.1648; 0.168; 0.1712; 0.1743; 0.1775; 0.1807; 0.1838; 0.187; 0.1902; 0.1933; 0.1965; 0.1967; 0.1969; 0.1971; 0.1973; 0.1975; 0.1978; 0.198; 0.1982; 0.1984; 0.1986; 0.1988; 0.199; 0.2074; 0.2158; 0.2243; 0.2327; 0.2411; 0.2495; 0.2579; 0.2663; 0.2748; 0.2832; 0.2916; 0.3; 0.3009; 0.3018; 0.3026; 0.3035; 0.3044; 0.3053; 0.3061; 0.307; 0.3079; 0.3088; 0.3096; 0.3105; 0.3122; 0.3139; 0.3156; 0.3173; 0.319; 0.3208; 0.3225; 0.3242; 0.3259; 0.3276; 0.3293; 0.331; 0.3325; 0.3341; 0.3356; 0.3372; 0.3387; 0.3403; 0.3418; 0.3433; 0.3449; 0.3464; 0.348; 0.3495; 0.3558; 0.3621; 0.3684; 0.3747; 0.381; 0.3873; 0.3935; 0.3998; 0.4061; 0.4124; 0.4187; 0.425; 0.4281; 0.4313; 0.4344; 0.4375; 0.4406; 0.4438; 0.4469; 0.45; 0.4531; 0.4563; 0.4594; 0.4625; 0.4656; 0.4688; 0.4719; 0.475; 0.4781; 0.4813; 0.4844; 0.4875; 0.4906; 0.4938; 0.4969; 0.5; 0.5065; 0.5129; 0.5194; 0.5258; 0.5323; 0.5387; 0.5452; 0.5517; 0.5581; 0.5646; 0.571; 0.5775; 0.5777; 0.5778; 0.578; 0.5782; 0.5783; 0.5785; 0.5787; 0.5788; 0.579; 0.5792; 0.5793; 0.5795; 0.5843; 0.589; 0.5938; 0.5985; 0.6032; 0.608; 0.6128; 0.6175; 0.6223; 0.627; 0.6318; 0.6365; 0.6411; 0.6457; 0.6503; 0.6548; 0.6594; 0.664; 0.6686; 0.6732; 0.6778; 0.6823; 0.6869; 0.6915; 0.7009; 0.7103; 0.7196; 0.729; 0.7384; 0.7478; 0.7571; 0.7665; 0.7759; 0.7853; 0.7946; 0.804; 0.8065; 0.8091; 0.8116; 0.8142; 0.8167; 0.8193; 0.8218; 0.8243; 0.8269; 0.8294; 0.832; 0.8345; 0.8362; 0.8379; 0.8396; 0.8413; 0.843; 0.8448; 0.8465; 0.8482; 0.8499; 0.8516; 0.8533; 0.855; 0.8671; 0.8792; 0.8913; 0.9033; 0.9154; 0.9275; 0.9396; 0.9517; 0.9638; 0.9758; 0.9879; 1" dur="2s" calcMode="linear" repeatCount="indefinite" /></rect></g></g><defs><clipPath id="clip0_304_952"><rect width="24" height="24" fill="white"/></clipPath><clipPath id="clip1_304_952"><rect width="16" height="16" fill="white"/></clipPath></defs></svg></div>`;
  const SVG_NO = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><style>@keyframes kf_outline_transform_0 {  0% {    animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);    transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px);  }  15.85% {    animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);    transform: translate(12px, 12px) scaleX(0.8) scaleY(0.8) translate(-12px, -12px);  }  33.1% {    animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);    transform: translate(12px, 12px) scaleX(0.95) scaleY(0.95) translate(-12px, -12px);  }  57.95% {    animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);    transform: translate(12px, 12px) scaleX(0.61) scaleY(0.61) translate(-12px, -12px);  }  85.5% {    transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px);  }  100% {    transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px);  }}#outline {  transform-origin: 0 0;  animation: kf_outline_transform_0 2s linear infinite;}@keyframes kf_fill_transform_0 {  0% {    animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);    transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px);  }  19.9% {    animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);    transform: translate(12px, 12px) scaleX(0.57) scaleY(0.57) translate(-12px, -12px);  }  34.95% {    animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);    transform: translate(12px, 12px) scaleX(0.6) scaleY(0.6) translate(-12px, -12px);  }  46.25% {    animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);    transform: translate(12px, 12px) scaleX(0.99) scaleY(0.99) translate(-12px, -12px);  }  63.65% {    animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);    transform: translate(12px, 12px) scaleX(0.33) scaleY(0.33) translate(-12px, -12px);  }  83.45% {    transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px);  }  100% {    transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px);  }}#fill {  transform-origin: 0 0;  animation: kf_fill_transform_0 2s linear infinite;}@keyframes kf_check_group_transform_0 {  0% {    animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);    transform: translateX(4px) translateY(4px) translate(8px, 8px) rotate(0rad) translate(-8px, -8px);  }  30% {    transform: translateX(4px) translateY(4px) translate(8px, 8px) rotate(-1.571rad) translate(-8px, -8px);  }  42.5% {    animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);    transform: translateX(4px) translateY(4px) translate(8px, 8px) rotate(-1.571rad) translate(-8px, -8px);  }  50% {    transform: translateX(4px) translateY(4px) translate(8px, 8px) rotate(0rad) translate(-8px, -8px);  }  100% {    transform: translateX(4px) translateY(4px) translate(8px, 8px) rotate(0rad) translate(-8px, -8px);  }}#check_group {  transform-origin: 0 0;  animation: kf_check_group_transform_0 2s linear infinite;}@keyframes kf_left_transform_0 {  0% {    animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);    transform: translateX(14.789px) translateY(13px) translate(-6.894px, -5.127px) rotate(0rad) translate(6.894px, 5.127px) rotate(-2.356rad) scaleX(1) scaleY(-1);  }  26.75% {    animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);    transform: translateX(14.789px) translateY(13px) translate(-6.894px, -5.127px) rotate(0.367rad) translate(6.894px, 5.127px) rotate(-2.356rad) scaleX(1) scaleY(-1);  }  53.65% {    transform: translateX(14.789px) translateY(13px) translate(-6.894px, -5.127px) rotate(0rad) translate(6.894px, 5.127px) rotate(-2.356rad) scaleX(1) scaleY(-1);  }  100% {    transform: translateX(14.789px) translateY(13px) translate(-6.894px, -5.127px) rotate(0rad) translate(6.894px, 5.127px) rotate(-2.356rad) scaleX(1) scaleY(-1);  }}#left {  transform-origin: 0 0;  animation: kf_left_transform_0 2s linear infinite;}@keyframes kf_right_transform_0 {  0% {    animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);    transform: translateX(1px) translateY(13px) translate(6.894px, -5.127px) rotate(0rad) translate(-6.894px, 5.127px) rotate(-0.785rad) scaleX(1) scaleY(1);  }  26.75% {    animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);    transform: translateX(1px) translateY(13px) translate(6.894px, -5.127px) rotate(-0.785rad) translate(-6.894px, 5.127px) rotate(-0.785rad) scaleX(1) scaleY(1);  }  66.36% {    transform: translateX(1px) translateY(13px) translate(6.894px, -5.127px) rotate(0rad) translate(-6.894px, 5.127px) rotate(-0.785rad) scaleX(1) scaleY(1);  }  100% {    transform: translateX(1px) translateY(13px) translate(6.894px, -5.127px) rotate(0rad) translate(-6.894px, 5.127px) rotate(-0.785rad) scaleX(1) scaleY(1);  }}#right {  transform-origin: 0 0;  animation: kf_right_transform_0 2s linear infinite;}</style><g id="new_nok" clip-path="url(#clip0_304_958)"><circle id="outline" cx="12" cy="12" r="11.5" stroke="#E74C3C"/><circle id="fill" cx="12" cy="12" r="12" fill="#E74C3C"/><g id="check_group" clip-path="url(#clip1_304_958)" transform="translate(4 4)"><rect id="left" transform="matrix(-0.707107 -0.707107 -0.707107 0.707107 14.7886 13)" width="17" height="2.5" rx="2" fill="white"/><rect id="right" transform="translate(1 13) rotate(-45)" width="17" height="2.5" rx="2" fill="white"/></g></g><defs><clipPath id="clip0_304_958"><rect width="24" height="24" fill="white"/></clipPath><clipPath id="clip1_304_958"><rect width="16" height="16" fill="white"/></clipPath></defs></svg>`)}`;
  function normalizeTitle(title) {
    if (!title) return "";
    return title.toLowerCase()
      .replace(/season\s*\d+/ig, '').replace(/part\s*\d+/ig, '')
      .replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  // ✅ SURGICAL FIX 1: Expanded to ignore UI action buttons like 'Play Now', 'Refresh', 'All', 'Sub'
  const IGNORE_UI_WORDS = new Set([
  // Navigation
  'home', 'browse', 'discover', 'explore', 'search', 'filter', 'filters',
  'categories', 'category', 'genres', 'genre', 'tags', 'tag',
  'directory', 'library', 'collection',

  // Sections
  'latest', 'recent', 'recently', 'new', 'newest',
  'popular', 'trending', 'featured', 'recommended',
  'top', 'top rated', 'highest rated', 'most viewed',
  'most popular', 'ongoing', 'completed', 'upcoming',
  'airing', 'finished', 'coming soon',
  'schedule', 'calendar', 'today', 'yesterday',
  'this week', 'this month', 'this season', 'season',
  'winter', 'spring', 'summer', 'fall',

  // Media types
  'tv', 'movie', 'movies', 'ova', 'ona', 'special',
  'music', 'cm', 'pv', 'promo', 'trailer',

  // Episode / Chapter UI
  'episodes', 'episode', 'ep',
  'chapters', 'chapter', 'ch',
  'volumes', 'volume', 'vol',
  'continue', 'continue watching',
  'continue reading',
  'start reading',
  'start watching',
  'watch now',
  'read now',

  // Buttons
  'watch', 'read', 'play', 'play now',
  'details', 'more details',
  'read more', 'show more', 'show less',
  'load more', 'see more', 'view more',
  'view all', 'view', 'open',
  'close', 'expand', 'collapse',
  'next', 'previous', 'prev',
  'back', 'forward',
  'go', 'submit', 'cancel',
  'done', 'finish', 'continue',

  // Authentication
  'login', 'log in',
  'logout', 'log out',
  'sign in', 'sign up',
  'register', 'create account',
  'forgot password',

  // User
  'profile', 'account', 'settings',
  'preferences', 'history',
  'watch history', 'reading history',
  'notifications', 'notification',
  'messages', 'favorites',
  'favourites', 'bookmark',
  'bookmarks', 'add to list',
  'my list', 'list', 'lists',

  // Community
  'comments', 'comment',
  'reviews', 'review',
  'discussion', 'discussions',
  'forum', 'forums',
  'reply', 'replies',
  'share', 'report',
  'follow', 'unfollow',
  'like', 'likes',
  'favorite', 'favourite',
  'vote', 'votes',

  // Streaming
  'sub', 'dub', 'raw',
  'aud', 'softsub', 'hardsub',
  'server', 'servers',
  'stream', 'streaming',
  'download', 'downloads',
  'mirror', 'mirrors',
  'quality', 'resolution',
  'autoplay', 'autonext',
  'skip intro', 'skip outro',
  'fullscreen', 'pip',
  'picture in picture',
  'speed', 'volume',

  // Status
  'online', 'offline',
  'available', 'unavailable',
  'active', 'inactive',
  'loading', 'loaded',
  'error', 'failed',
  'success', 'retry',
  'refresh', 'reload',

  // Search
  'search results',
  'no results',
  'search...',
  'clear',
  'sort',
  'sort by',
  'ascending',
  'descending',

  // Pagination
  'page',
  'pages',
  'first',
  'last',
  'older',
  'newer',

  // Ads / Misc
  'advertisement',
  'advertisements',
  'sponsored',
  'promo',
  'announcement',
  'news',
  'events',

  // Stats UI
  'score distribution',
  'current progress',
  'al stats',
  'mal stats',
  'statistics',
  'stats',
  'rating',
  'ratings',
  'rank',
  'ranking',
  'popularity',
  'favorites',
  'members',
  'users',

  // General
  'general',
  'overview',
  'summary',
  'info',
  'information',
  'description',
  'all',
  'none',
  'other',
  'more',
  'less',
  'yes',
  'no',
  'ok',
  'okay',

  // Days
  'mon', 'monday',
  'tue', 'tuesday',
  'wed', 'wednesday',
  'thu', 'thursday',
  'fri', 'friday',
  'sat', 'saturday',
  'sun', 'sunday'
]);

  function isValidTitle(normText) {
    if (!normText || normText.length < 3) return false;
    return !IGNORE_UI_WORDS.has(normText);
  }

  function isTitleMatch(normRaw, normTarget) {
    if (!normRaw || !normTarget) return false;
    if (normRaw === normTarget) return true;
    if (normRaw.length >= 4 && normTarget.startsWith(normRaw)) return true;
    if (normTarget.length >= 4 && normRaw.startsWith(normTarget)) return true;
    if (normRaw.length > 8 && normTarget.includes(normRaw)) return true;
    if (normTarget.length > 8 && normRaw.includes(normTarget)) return true;
    return false;
  }

  function isPageTitleMatch(pageTitle, targetTitle) {
    if (!pageTitle || !targetTitle) return false;
    if (pageTitle === targetTitle) return true;
    if (pageTitle.length > 7 && pageTitle.includes(targetTitle)) return true;
    if (targetTitle.length > 7 && targetTitle.includes(pageTitle)) return true;
    return false;
  }

  function getPageMainShowTitle() {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
    const h1Text = document.querySelector('h1')?.textContent || '';
    let candidate = h1Text.trim() || ogTitle.trim() || document.title || '';
    
    // ✅ SURGICAL FIX 2: Safe stripping that won't accidentally cut out words like 'Online' in Sword Art Online
    candidate = candidate.replace(/^(?:Watch|Stream|Read)\s+/i, '')
                         .replace(/\s*(?:-?\s*(Watch Free|Online Free|English Sub|Subbed|Dubbed)).*$/i, '')
                         .replace(/\s*\|.*$/g, '')
                         .replace(/\s*-?\s*Anime Nexus.*$/i, '')
                         .replace(/\s*\(\d{4}\).*$/g, '').trim();
    return candidate;
  }

  // ✅ SURGICAL FIX 1: Moved deduplication locks to the BOTTOM to prevent "Poisoning"
  function processAnimeCard(card, watchlist) {
    if (card.hasAttribute('data-shiinah-scanned')) return;

    // 1. STRICT EXCLUSIONS (Do this BEFORE locking the element!)
    if (card.closest('.cast-grid, .characters, .staff, .comments, [class*="cast"], [class*="character"], [class*="staff"], [class*="person"]')) return;
    if (card.className && typeof card.className === 'string' && card.className.match(/cast|character|person|staff|avatar|user/i)) return;
    if (card.closest('button, [role="button"], [role="combobox"], [role="tab"], .btn, .button') && !card.querySelector('img, picture')) return;
    if (card.tagName === 'BUTTON' || card.getAttribute('role') === 'button' || card.getAttribute('role') === 'combobox') {
        if (!card.querySelector('img, picture')) return;
    }
    const href = (card.tagName === 'A' ? card.href : (card.querySelector('a')?.href || '')).toLowerCase();
    if (href.match(/\/(character|person|cast|staff|profile|user|comments)\//i)) return;

    // 2. DEDUPLICATION ABORTS
    if (card.parentElement && card.parentElement.closest('[data-shiinah-scanned="true"]')) return;
    const wrapper = card.closest('li, article, .slider__item, .swiper-slide, .carousel__item');
    if (wrapper && wrapper.hasAttribute('data-shiinah-wrapper-scanned')) return;
    if (card.closest('.shiinah-wrapper-marked') || card.querySelector('.shiinah-inline-badge')) return;

    const isRecommendation = !!card.closest('.recommendations, [class*="recommend"], [class*="related"], [class*="similar"]');

    // 3. TITLE EXTRACTION
    let titleEl = card.querySelector('.line-clamp-1, .line-clamp-2, a.font-semibold, h1, h2, h3, h4, h5, .title, .series-title, .anime-title, .manga-title, .card-title, p');
    if (!titleEl && card.tagName !== 'A' && card.tagName !== 'BUTTON') titleEl = card.querySelector('a[href*="/anime/"], a[href*="/series/"]');
    if (!titleEl && (card.tagName === 'A' || card.tagName === 'BUTTON')) titleEl = card;

    let rawText = titleEl ? (titleEl.textContent || '').trim() : '';
    const imgEl = card.querySelector('img, picture');
    const altText = imgEl ? (imgEl.getAttribute('alt') || '').trim() : '';

    const normRawText = normalizeTitle(rawText);
    const normAltText = normalizeTitle(altText);

    // KILL-SWITCH for generic UI buttons disguised as cards
    if (!imgEl && (normRawText === "" || IGNORE_UI_WORDS.has(normRawText))) return;

    // 4. ADVANCED EPISODE DETECTION
    let isEpisodeCard = false;
    let extractedEp = null;

    if (!isRecommendation) {
      const inEpContainer = !!card.closest('.episodes-container, [class*="episode-list"], [class*="chapter-list"], #episodes, [class*="episodes"]');
      const ariaLabel = card.getAttribute('aria-label') || '';
      
      const ariaEpMatch = ariaLabel.match(/\b(?:episode|ep|chapter|ch)\s*0*(\d+(\.\d+)?)\b/i);
      const urlEpMatch = href.match(/(?:[?&](?:n|ep)=|episode[/-]|ep[/-]|chapter[/-]|ch[/-]|\/episodes\/)0*(\d+(\.\d+)?)(?:[?&/#]|$)/i);
      const textEpMatch = rawText.match(/\b(?:Episode|Ep\.|Ep|Chapter|Ch\.|Ch)\s*0*(\d+(\.\d+)?)\b/i) || altText.match(/\b(?:Episode|Ep\.|Ep|Chapter|Ch\.|Ch)\s*0*(\d+(\.\d+)?)\b/i);

      let isolatedEpMatch = null;
      const spans = card.querySelectorAll('span, div, p');
      for (let span of spans) {
          const t = (span.textContent || '').trim();
          const m = t.match(/^(?:Ep|Episode|Ch|Chapter)\s*0*(\d+(\.\d+)?)$/i);
          if (m) { isolatedEpMatch = parseFloat(m[1]); break; }
      }

      if (ariaEpMatch) { isEpisodeCard = true; extractedEp = parseFloat(ariaEpMatch[1]); }
      else if (isolatedEpMatch !== null) { isEpisodeCard = true; extractedEp = isolatedEpMatch; }
      else if (inEpContainer) {
        isEpisodeCard = true;
        if (textEpMatch) extractedEp = parseFloat(textEpMatch[1]);
        else if (urlEpMatch) extractedEp = parseFloat(urlEpMatch[1]);
      } else if (urlEpMatch && (href.includes('/watch') || href.includes('episode') || href.includes('chapter') || href.includes('?id='))) {
        isEpisodeCard = true; extractedEp = parseFloat(urlEpMatch[1]);
      } else if (textEpMatch && /^Episode\s*\d+$/i.test(rawText.replace(/\s+/g, ' '))) {
        isEpisodeCard = true; extractedEp = parseFloat(textEpMatch[1]);
      }
    }

    if (!isValidTitle(normRawText) && !isValidTitle(normAltText) && extractedEp === null) return;

    // 5. LOCK THE CARD (Safe to lock now because we know it's a valid injection target!)
    card.setAttribute('data-shiinah-scanned', 'true');
    card.classList.add('shiinah-wrapper-marked');
    if (wrapper) wrapper.setAttribute('data-shiinah-wrapper-scanned', 'true');
    
    const style = window.getComputedStyle(card);
    if (style.position === 'static') card.style.position = 'relative';
    card.style.overflow = 'visible'; 

    // 6. MATCHING LOGIC
    let match = null;
    let displayTitle = isValidTitle(normRawText) ? rawText : (altText || document.title);

    match = watchlist.find(entry => {
      const normEng = normalizeTitle(entry.media?.title?.english);
      const normRom = normalizeTitle(entry.media?.title?.romaji);
      let isM = false;
      
      if (isValidTitle(normRawText)) isM = isM || isTitleMatch(normRawText, normEng) || isTitleMatch(normRawText, normRom);
      if (isValidTitle(normAltText)) isM = isM || isTitleMatch(normAltText, normEng) || isTitleMatch(normAltText, normRom);
      
      if (!isM && isEpisodeCard && extractedEp !== null) {
        const pageTitleNorm = normalizeTitle(getPageMainShowTitle());
        if (pageTitleNorm.length > 2) {
          isM = isPageTitleMatch(pageTitleNorm, normEng) || isPageTitleMatch(pageTitleNorm, normRom);
          if (isM) displayTitle = entry.media.title.romaji; 
        }
      }
      return isM;
    });

    if (!match && isEpisodeCard && extractedEp !== null) {
        const pageTitle = getPageMainShowTitle();
        if (pageTitle && pageTitle.length > 2) displayTitle = pageTitle;
    }
    if (!displayTitle) displayTitle = "Unknown Series";

    if (match) {
      injectInteractiveBadge(card, match, true, displayTitle, extractedEp, isEpisodeCard);
    } else {
      injectInteractiveBadge(card, { media: { title: { romaji: displayTitle } } }, false, displayTitle, extractedEp, isEpisodeCard);
    }
  }

  function formatStatusLabel(status) {
    if (!status) return 'UNKNOWN';
    switch(status.toUpperCase()) {
      case 'RELEASING': return 'Releasing';
      case 'FINISHED': return 'Finished';
      case 'HIATUS': return 'On Hiatus';
      case 'CANCELLED': return 'Cancelled';
      case 'NOT_YET_RELEASED': return 'Not Yet Released';
      default: return status;
    }
  }

  function injectInteractiveBadge(targetEl, entry, isWatchlisted, rawText, extractedEp = null, isEpisodeCard = false) {
    const media = entry.media;
    const currentProgress = entry.progress || 0;
    
    // ✅ SURGICAL FIX 6: Properly verify if media is Manga to prevent "CH" label on Anime
    const isManga = media.format === 'MANGA' || media.format === 'NOVEL' || media.format === 'ONE_SHOT';
    const unitLabel = isManga ? 'Ch' : 'Ep';

    let latestCount = media.episodes || media.chapters || '?';
    if (media.nextAiringEpisode) latestCount = media.nextAiringEpisode.episode - 1;
    
    let isUpToDate = false;
    let badgeType = 'UNLISTED';

    if (isWatchlisted) {
      if (extractedEp !== null && isEpisodeCard) isUpToDate = currentProgress >= extractedEp;
      else isUpToDate = latestCount !== '?' && currentProgress >= latestCount;
      badgeType = isUpToDate ? 'YES' : 'NO';
    }

    let activeSvg, themeColor;
    if (badgeType === 'UNLISTED') { activeSvg = SVG_UNLISTED; themeColor = '#FFD345'; } 
    else if (badgeType === 'YES') { activeSvg = SVG_YES; themeColor = '#4cca51'; } 
    else { activeSvg = SVG_NO; themeColor = '#e74c3c'; }

    const badgeWrapper = document.createElement('span');
    badgeWrapper.className = 'shiinah-inline-badge';
    Object.assign(badgeWrapper.style, { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', position: 'absolute', top: '8px', right: '8px', cursor: 'pointer', zIndex: '2147483640', flexShrink: '0' });
    badgeWrapper.innerHTML = `<img src="${activeSvg}" style="width: 22px; height: 22px; pointer-events: none; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));">`;
    targetEl.appendChild(badgeWrapper);

    const tooltip = document.createElement('div');
    tooltip.className = 'shiinah-tooltip-container'; 
    tooltip._linkedBadge = badgeWrapper; 
    Object.assign(tooltip.style, { position: 'fixed', width: '290px', padding: '16px', backgroundColor: '#0b1119', border: `1px solid ${themeColor}`, borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.9)', display: 'none', flexDirection: 'column', gap: '12px', zIndex: '2147483647', pointerEvents: 'auto', fontFamily: 'system-ui, sans-serif', color: '#fff', cursor: 'default' });

    const bridge = document.createElement('div');
    bridge.style.cssText = 'position: absolute; bottom: -15px; left: 0; width: 100%; height: 15px; background: transparent;';
    tooltip.appendChild(bridge);

    badgeWrapper.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });

    let headerHtml = '';
    if (isWatchlisted) {
      if (extractedEp !== null && isEpisodeCard) {
        headerHtml = `
          <div style="font-size: 11px; color: #9fadbd; font-weight: bold; text-align: center; letter-spacing: 0.5px; margin-bottom: 4px; text-transform: uppercase;">${unitLabel} ${extractedEp}</div>
          <div style="font-size: 20px; color: ${themeColor}; font-weight: 900; text-align: center; letter-spacing: 1px; margin-bottom: 4px;">
            ${isUpToDate ? 'Watched ✓' : 'Unwatched'}
          </div>
          <div style="font-size: 11px; color: #677b94; text-align: center; margin-bottom: 8px;">Your progress: ${unitLabel} ${currentProgress}</div>
          <div class="shiinah-media-status" style="font-size: 11px; color: #E5C07B; text-align: center; font-weight: bold; margin-bottom: 10px;"></div>
          <div class="shiinah-view-links" style="display: flex; gap: 8px; width: 100%;"></div>
        `;
      } else {
        headerHtml = `
          <div style="font-size: 11px; color: #9fadbd; font-weight: bold; text-align: center; letter-spacing: 0.5px; margin-bottom: 4px;">PROGRESS (${unitLabel})</div>
          <div style="font-size: 22px; color: #fff; font-weight: 900; text-align: center; letter-spacing: 1px; margin-bottom: 4px;">
            <span style="color: ${themeColor};">${currentProgress}</span> / <span style="color: #677b94;">${latestCount}</span>
          </div>
          <div class="shiinah-media-status" style="font-size: 11px; color: #E5C07B; text-align: center; font-weight: bold; margin-bottom: 10px;"></div>
          <div class="shiinah-view-links" style="display: flex; gap: 8px; width: 100%;"></div>
        `;
      }
    } else {
      let titleStr = (extractedEp !== null && isEpisodeCard) ? `${unitLabel} ${extractedEp}` : 'STATUS';
      headerHtml = `
        <div style="font-size: 11px; color: #9fadbd; font-weight: bold; text-align: center; letter-spacing: 0.5px; text-transform: uppercase;">${titleStr}</div>
        <div style="font-size: 16px; color: #FFD345; font-weight: bold; text-align: center; margin-bottom: 8px;">Not in List</div>
        <div class="shiinah-add-btn-container" style="display: none; gap: 8px; margin-bottom: 8px; width: 100%;"></div>
      `;
    }

    tooltip.innerHTML = `
      <div class="shiinah-status-header">${headerHtml}</div>
      <div class="shiinah-switcher-bar" style="display: flex; gap: 6px; justify-content: center; border-bottom: 1px solid #1a2636; padding-bottom: 8px;">
        <button class="shiinah-stat-tab active-tab" data-platform="al" style="background: #3db4f2; color: #0b1119; border: none; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer;">AL Stats</button>
        <button class="shiinah-stat-tab" data-platform="mal" style="background: #1a2636; color: #9fadbd; border: none; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer;">MAL Stats</button>
      </div>
      <div class="shiinah-stats-body"><div style="text-align: center; color: #677b94; font-size: 12px; padding: 15px;">Loading details...</div></div>
    `;

    document.body.appendChild(tooltip);

    let cachedStats = null;
    let currentPlatform = 'al';

    function renderChart(platformKey) {
      const statsBody = tooltip.querySelector('.shiinah-stats-body');
      const activeData = cachedStats ? cachedStats[platformKey] : null;

      if (cachedStats?.meta?.status) {
        const statusEl = tooltip.querySelector('.shiinah-media-status');
        if (statusEl) statusEl.textContent = `Status: ${formatStatusLabel(cachedStats.meta.status)}`;
      }
      
      if (!activeData || !activeData.scoreDistribution || activeData.scoreDistribution.length === 0) {
        statsBody.innerHTML = `<div style="text-align: center; color: #e74c3c; font-size: 12px; padding: 15px;">No ${platformKey.toUpperCase()} distribution available</div>`;
        return;
      }

      const scores = activeData.scoreDistribution;
      const maxAmount = Math.max(...scores.map(s => s.amount));
      let barsHtml = '';
      const colorScale = ['#e74c3c', '#e67e22', '#f39c12', '#f1c40f', '#E5C07B', '#a8d052', '#86d655', '#64dd57', '#4cca51', '#2ecc71'];

      scores.forEach((scoreObj) => {
        const heightPct = maxAmount > 0 ? Math.max((scoreObj.amount / maxAmount) * 100, 6) : 6;
        const barColor = colorScale[Math.min(Math.floor((scoreObj.score - 10) / 10), 9)] || '#4cca51';
        barsHtml += `
          <div style="display: flex; flex-direction: column; align-items: center; gap: 2px; flex: 1; min-width: 18px;">
            <div style="font-size: 8px; color: #9fadbd; height: 14px; display: flex; align-items: flex-end;">${scoreObj.amount > 999 ? (scoreObj.amount/1000).toFixed(1)+'k' : scoreObj.amount}</div>
            <div style="width: 10px; height: 55px; display: flex; align-items: flex-end; justify-content: center;">
              <div style="width: 100%; height: ${heightPct}%; background-color: ${barColor}; border-radius: 3px;"></div>
            </div>
            <div style="font-size: 9px; color: #677b94; font-weight: bold; margin-top: 2px;">${scoreObj.score}</div>
          </div>
        `;
      });
      statsBody.innerHTML = `<div style="font-size: 11px; color: #9fadbd; font-weight: bold; margin-bottom: 6px; text-transform: uppercase;">SCORE DISTRIBUTION (${platformKey.toUpperCase()})</div><div style="display: flex; align-items: flex-end; justify-content: space-between; height: 80px; border-bottom: 1px solid #2b3a4a; padding-bottom: 2px;">${barsHtml}</div>`;
    }

    tooltip.querySelectorAll('.shiinah-stat-tab').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        tooltip.querySelectorAll('.shiinah-stat-tab').forEach(b => { b.style.background = '#1a2636'; b.style.color = '#9fadbd'; });
        btn.style.background = btn.getAttribute('data-platform') === 'al' ? '#3db4f2' : '#2E51A2'; 
        btn.style.color = '#fff';
        currentPlatform = btn.getAttribute('data-platform');
        renderChart(currentPlatform);
      });
    });

    let hideTimeout;
    let fetchIntentTimeout;

    const showTooltip = () => {
      clearTimeout(hideTimeout);
      tooltip.style.display = 'flex';
      
      const rect = badgeWrapper.getBoundingClientRect();
      let top = rect.top - tooltip.offsetHeight - 15;
      let left = rect.left + (rect.width / 2) - (tooltip.offsetWidth / 2);
      if (left < 10) left = 10;
      if (left + tooltip.offsetWidth > window.innerWidth - 10) left = window.innerWidth - tooltip.offsetWidth - 10;
      if (top < 10) top = rect.bottom + 15; 
      tooltip.style.top = `${top}px`; tooltip.style.left = `${left}px`;

      if (!cachedStats) {
        clearTimeout(fetchIntentTimeout);
        fetchIntentTimeout = setTimeout(async () => {
          try {
            if (!chrome.runtime?.id) return;
            const urlStr = window.location.href.toLowerCase();
            const textStr = rawText.toLowerCase();
            const hrefStr = (targetEl.tagName === 'A' ? targetEl.getAttribute('href') : targetEl.querySelector('a')?.getAttribute('href')) || '';
            const isMangaCard = urlStr.includes('manga') || urlStr.includes('read') || targetEl.closest('.manga-card') || hrefStr.includes('/manga/') || hrefStr.includes('/chapter/') || /\b(chapter|ch\.|vol|manga|webtoon|manhwa)\b/i.test(textStr);
            const isAnimeCard = urlStr.includes('anime') || urlStr.includes('watch') || targetEl.closest('.anime-card') || hrefStr.includes('/anime/') || hrefStr.includes('/episode/') || hrefStr.includes('/series/') || /\b(season|ep|episode|ova|movie)\b/i.test(textStr);
            
            if (isWatchlisted) {
              const mediaType = (entry.media && entry.media.format === 'MANGA') ? 'MANGA' : (isMangaCard ? 'MANGA' : 'ANIME');
              chrome.runtime.sendMessage({ action: "FETCH_MEDIA_STATS", mediaId: media.id, malId: media.idMal, mediaType: mediaType }, (res) => {
                cachedStats = res?.stats || { al: null, mal: null, meta: null };
                renderChart(currentPlatform);
              });
              const linkContainer = tooltip.querySelector('.shiinah-view-links');
              if (linkContainer && !linkContainer.hasChildNodes()) {
                if (media.id > 0 && !media.isMalOnly) {
                  const alLink = document.createElement('a'); alLink.textContent = 'View in AL'; alLink.href = `https://anilist.co/${mediaType.toLowerCase()}/${media.id}`; alLink.target = '_blank';
                  Object.assign(alLink.style, { flex: '1', textAlign: 'center', background: 'transparent', color: '#3db4f2', border: '1px solid #3db4f2', padding: '6px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold', textDecoration: 'none', transition: '0.2s' });
                  alLink.onmouseenter = () => { alLink.style.background = '#3db4f2'; alLink.style.color = '#fff'; }; alLink.onmouseleave = () => { alLink.style.background = 'transparent'; alLink.style.color = '#3db4f2'; };
                  alLink.onclick = (e) => e.stopPropagation();
                  linkContainer.appendChild(alLink);
                }
                if (media.idMal || media.isMalOnly) {
                  const malLink = document.createElement('a'); malLink.textContent = 'View in MAL';
                  malLink.href = `https://myanimelist.net/${mediaType.toLowerCase()}/${media.isMalOnly ? media.idMal : media.idMal}`; malLink.target = '_blank';
                  Object.assign(malLink.style, { flex: '1', textAlign: 'center', background: 'transparent', color: '#5C7CE5', border: '1px solid #2E51A2', padding: '6px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold', textDecoration: 'none', transition: '0.2s' });
                  malLink.onmouseenter = () => { malLink.style.background = '#2E51A2'; malLink.style.color = '#fff'; }; malLink.onmouseleave = () => { malLink.style.background = 'transparent'; malLink.style.color = '#5C7CE5'; };
                  malLink.onclick = (e) => e.stopPropagation();
                  linkContainer.appendChild(malLink);
                }
              }
            } else {
              const fetchMedia = (type) => new Promise(resolve => chrome.runtime.sendMessage({ action: "SEARCH_AND_FETCH_STATS", title: rawText, mediaType: type }, resolve));
              let animeRes = null; let mangaRes = null;
              if (isAnimeCard && !isMangaCard) animeRes = await fetchMedia('ANIME');
              else if (isMangaCard && !isAnimeCard) mangaRes = await fetchMedia('MANGA');
              else [animeRes, mangaRes] = await Promise.all([fetchMedia('ANIME'), fetchMedia('MANGA')]);

              const primaryRes = isMangaCard ? (mangaRes?.media ? mangaRes : animeRes) : (animeRes?.media ? animeRes : mangaRes);
              cachedStats = primaryRes?.stats || { al: null, mal: null, meta: null };
              renderChart(currentPlatform);

              const btnContainer = tooltip.querySelector('.shiinah-add-btn-container');
              if (btnContainer && (animeRes?.media?.id || mangaRes?.media?.id)) {
                btnContainer.innerHTML = ''; btnContainer.style.display = 'flex';
                const createBtnGroup = (mediaData, type) => {
                  if (!mediaData || !mediaData.id) return null;
                  const group = document.createElement('div');
                  Object.assign(group.style, { display: 'flex', flexDirection: 'column', gap: '4px', flex: '1', minWidth: '0' });
                  const platforms = [];
                  if (mediaData.id > 0 && !mediaData.isMalOnly) platforms.push('AL');
                  if (mediaData.idMal || mediaData.isMalOnly) platforms.push('MAL');
                  const platStr = platforms.length > 0 ? ` [${platforms.join('/')}]` : '';

                  const btn = document.createElement('button'); btn.textContent = `+ ${type === 'MANGA' ? 'Manga' : 'Anime'}${platStr}`;
                  Object.assign(btn.style, { width: '100%', background: '#3db4f2', color: '#fff', border: 'none', padding: '8px 4px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer', fontSize: '11px', transition: '0.2s', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
                  btn.addEventListener('mouseenter', () => btn.style.background = '#2c9ad1'); btn.addEventListener('mouseleave', () => btn.style.background = '#3db4f2');
                  btn.addEventListener('click', (e) => {
                    e.preventDefault(); e.stopPropagation(); btn.textContent = 'Adding...';
                    chrome.runtime.sendMessage({ action: "ADD_TO_WATCHLIST", mediaId: mediaData.id, malId: mediaData.idMal, mediaType: type }, (addRes) => {
                      if (addRes?.success) { btn.textContent = 'Added! ✓'; btn.style.background = '#4cca51'; } else { btn.textContent = 'Error'; btn.style.background = '#e74c3c'; }
                    });
                  });
                  group.appendChild(btn);

                  const linksRow = document.createElement('div');
                  Object.assign(linksRow.style, { display: 'flex', gap: '4px', width: '100%' });

                  if (mediaData.id > 0 && !mediaData.isMalOnly) {
                    const alLink = document.createElement('a'); alLink.textContent = 'View in AL'; alLink.href = `https://anilist.co/${type.toLowerCase()}/${mediaData.id}`; alLink.target = '_blank';
                    Object.assign(alLink.style, { flex: '1', textAlign: 'center', background: 'transparent', color: '#3db4f2', border: '1px solid #3db4f2', padding: '4px 0', borderRadius: '4px', fontSize: '9px', fontWeight: 'bold', textDecoration: 'none', transition: '0.2s' });
                    alLink.onmouseenter = () => { alLink.style.background = '#3db4f2'; alLink.style.color = '#fff'; }; alLink.onmouseleave = () => { alLink.style.background = 'transparent'; alLink.style.color = '#3db4f2'; }; alLink.onclick = (e) => e.stopPropagation();
                    linksRow.appendChild(alLink);
                  }

                  if (mediaData.idMal || mediaData.isMalOnly) {
                    const malLink = document.createElement('a'); malLink.textContent = 'View in MAL'; malLink.href = `https://myanimelist.net/${type.toLowerCase()}/${mediaData.isMalOnly ? mediaData.idMal : mediaData.idMal}`; malLink.target = '_blank';
                    Object.assign(malLink.style, { flex: '1', textAlign: 'center', background: 'transparent', color: '#5C7CE5', border: '1px solid #2E51A2', padding: '4px 0', borderRadius: '4px', fontSize: '9px', fontWeight: 'bold', textDecoration: 'none', transition: '0.2s' });
                    malLink.onmouseenter = () => { malLink.style.background = '#2E51A2'; malLink.style.color = '#fff'; }; malLink.onmouseleave = () => { malLink.style.background = 'transparent'; malLink.style.color = '#5C7CE5'; }; malLink.onclick = (e) => e.stopPropagation();
                    linksRow.appendChild(malLink);
                  }

                  group.appendChild(linksRow); return group;
                };

                const animeGroup = createBtnGroup(animeRes?.media, 'ANIME');
                const mangaGroup = createBtnGroup(mangaRes?.media, 'MANGA');
                if (animeGroup) btnContainer.appendChild(animeGroup);
                if (mangaGroup) btnContainer.appendChild(mangaGroup);
              }
            }
          } catch(e) { console.log("[Shiinah] Fetch Intent Error:", e); }
        }, 300); 
      }
    };

    const scheduleHide = () => { clearTimeout(fetchIntentTimeout); hideTimeout = setTimeout(() => { tooltip.style.display = 'none'; }, 250); };
    badgeWrapper.addEventListener('mouseenter', showTooltip);
    badgeWrapper.addEventListener('mouseleave', scheduleHide);
    tooltip.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
    tooltip.addEventListener('mouseleave', scheduleHide);
  }

  let shiinahScannerInterval = null;
  let cachedWatchlist = [];

  // ✅ SURGICAL FIX 2: Reactive UI Sync
  function initSmartTracker() {
    if (!chrome || !chrome.runtime || !chrome.runtime.id) return;
    
    const scanDOM = () => {
      if (!chrome.runtime?.id) { clearInterval(shiinahScannerInterval); return; }
      const cardSelectors = '[data-slot="card"], .anime-card, .series-card, .manga-card, .card, [class*="card"], a[href*="/anime/"], a[href*="/series/"], a[href*="/manga/"], a[href*="/chapter/"], a[href*="/watch/"], button[aria-label*="episode" i], button[aria-label*="chapter" i], li[x-data]';
      
      document.querySelectorAll(cardSelectors).forEach(card => {
         if (card.tagName === 'A' && card.childElementCount === 0) return;
         processAnimeCard(card, cachedWatchlist);
      });
      
      document.querySelectorAll('.shiinah-tooltip-container').forEach(tooltip => {
        if (tooltip._linkedBadge && !document.body.contains(tooltip._linkedBadge)) tooltip.remove();
      });
    };

    const fetchAndBuild = (forceRedraw = false) => {
      chrome.storage.local.get(['full_watchlist_cache', 'cachedList_data'], (res) => {
        let merged = new Map();
        
        if (res.full_watchlist_cache && res.full_watchlist_cache.data) {
          res.full_watchlist_cache.data.forEach(entry => merged.set(entry.media.id, entry));
        }
        
        if (res.cachedList_data) {
          res.cachedList_data.forEach(entry => merged.set(entry.media.id, entry));
        }
        
        cachedWatchlist = Array.from(merged.values());
        if (forceRedraw) scanDOM(); 
      });
    };

    // Initial load
    fetchAndBuild(true);
    
    // When you open the extension, it updates cachedList_data. This listener wipes and redraws the UI.
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.trigger_dom_refresh || changes.cachedList_data || changes.full_watchlist_cache) {
        
        // Dissolve old badges and clear the tracker flags!
        document.querySelectorAll('[data-shiinah-scanned]').forEach(el => el.removeAttribute('data-shiinah-scanned'));
        document.querySelectorAll('[data-shiinah-wrapper-scanned]').forEach(el => el.removeAttribute('data-shiinah-wrapper-scanned'));
        document.querySelectorAll('.shiinah-wrapper-marked').forEach(el => el.classList.remove('shiinah-wrapper-marked'));
        
        document.querySelectorAll('.shiinah-inline-badge').forEach(el => el.remove());
        document.querySelectorAll('.shiinah-tooltip-container').forEach(el => el.remove());
        
        // Fetch the newly synced lists and redraw immediately
        fetchAndBuild(true);
      }
    });

    if (!shiinahScannerInterval) {
      shiinahScannerInterval = setInterval(scanDOM, 2500);
    }
  }
  
  setTimeout(initSmartTracker, 1000);
});