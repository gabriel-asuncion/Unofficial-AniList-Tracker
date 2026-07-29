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

  function mountSkipButton(activeSkip) {
    if (document.getElementById('aniskip-float-btn')) return;
    
    const btn = document.createElement('button');
    btn.id = 'aniskip-float-btn';
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
        trackedVideo.currentTime = activeSkip.interval.endTime;
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

  function mountCustomSkipButton() {
    if (document.getElementById('shiinah-custom-hotzone')) return;

    const btn = document.createElement('div');
    btn.id = 'shiinah-custom-hotzone';
    
    Object.assign(btn.style, {
      position: 'absolute', top: '10%', right: '5%', width: '160px', height: '100px',
      backgroundColor: 'rgba(255, 255, 255, 0.01)', cursor: 'pointer', zIndex: '2147483647',
      borderRadius: '8px', display: 'none', transition: 'background-color 0.2s ease',
      alignItems: 'center', justifyContent: 'center'
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

    const container = trackedVideo.parentElement;
    if (window.getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.appendChild(btn);
    customSkipBtnMounted = true;
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
              if (trackedVideo.readyState >= 1) executeSeek();
              else {
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
        } else if (response && response.otgTime === null && mangaOtgLoaded === 'fetching') {
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
    if (request.action === "SHOW_SUCCESS_TOAST") showInPageToast('success', 'Update Successful', request.message);
    else if (request.action === "SKIP_TIME" && trackedVideo) trackedVideo.currentTime += request.amount;
    else if (request.action === "SHOW_RATING_MODAL") showRatingModal(request.mediaId, request.animeName);
    else if (request.action === "GET_ACTIVE_SKIP_TIER") sendResponse({ tierText: activeSkipTier });
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

  // ==========================================
  // 🏷️ SMART CARD-BASED DOM SCANNER & TOOLTIP
  // ==========================================
  const SVG_UNLISTED = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><style>svg { overflow: visible; }@keyframes kf_pulse_1_transform_0 {  0% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  20% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }  100% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }}@keyframes kf_pulse_1_stroke_0 {  0% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #FFD345; }  10% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #FFD345; }  20% { stroke: rgba(255, 211, 69, 0); }  100% { stroke: rgba(255, 211, 69, 0); }}#pulse_1 { transform-origin: 0 0; animation: kf_pulse_1_transform_0 2s linear infinite, kf_pulse_1_stroke_0 2s linear infinite;}@keyframes kf_pulse_2_transform_0 {  0% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  10% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  30% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }  100% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }}@keyframes kf_pulse_2_stroke_0 {  0% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #FFD345; }  20% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #FFD345; }  30% { stroke: rgba(255, 211, 69, 0); }  100% { stroke: rgba(255, 211, 69, 0); }}#pulse_2 { transform-origin: 0 0; animation: kf_pulse_2_transform_0 2s linear infinite, kf_pulse_2_stroke_0 2s linear infinite;}@keyframes kf_pulse_3_transform_0 {  0% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  20% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  40% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }  100% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }}@keyframes kf_pulse_3_stroke_0 {  0% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #FFD345; }  10.05% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #4CCA51; }  20% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #FFD345; }  30% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #FFD345; }  40% { stroke: rgba(255, 211, 69, 0); }  100% { stroke: rgba(255, 211, 69, 0); }}#pulse_3 { transform-origin: 0 0; animation: kf_pulse_3_transform_0 2s linear infinite, kf_pulse_3_stroke_0 2s linear infinite;}</style><g id="watchlist_no"><circle id="pulse_1" cx="12" cy="12" r="11.5" stroke="#FFD345"/><circle id="pulse_2" cx="12" cy="12" r="11.5" stroke="#FFD345"/><circle id="pulse_3" cx="12" cy="12" r="11.5" stroke="#FFD345"/><circle id="bg" cx="12" cy="12" r="12" fill="#FFD345"/><path id="i" transform="translate(9 4)" d="M3.648 3.744C2.976 3.744 2.472 3.592 2.136 3.288C1.8 2.968 1.632 2.528 1.632 1.968C1.632 1.408 1.848 0.944 2.28 0.576C2.728 0.192 3.28 0 3.936 0C4.528 0 5.008 0.144 5.376 0.432C5.744 0.72 5.928 1.128 5.928 1.656C5.928 2.296 5.72 2.808 5.304 3.192C4.888 3.56 4.336 3.744 3.648 3.744ZM1.344 16.632C0.832 16.632 0.48 16.528 0.288 16.32C0.096 16.112 0 15.784 0 15.336C0 15.208 0.016 14.984 0.048 14.664C0.304 11.736 0.728 9.072 1.32 6.672C1.448 6.176 1.656 5.832 1.944 5.64C2.248 5.432 2.728 5.328 3.384 5.328C4.072 5.328 4.416 5.608 4.416 6.168C4.416 6.248 4.4 6.4 4.368 6.624C3.648 10.048 3.216 12.92 3.072 15.24C3.04 15.752 2.888 16.112 2.616 16.32C2.344 16.528 1.92 16.632 1.344 16.632Z" fill="white"/></g></svg>`)}`;
  const SVG_YES = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><style>svg { overflow: visible; }@keyframes kf_pulse_1_transform_0 {  0% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  20% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }  100% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }}@keyframes kf_pulse_1_stroke_0 {  0% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #4CCA51; }  10% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #4CCA51; }  10.05% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: rgba(76, 202, 81, 1); }  20% { stroke: rgba(76, 202, 81, 0); }  100% { stroke: rgba(76, 202, 81, 0); }}#pulse_1 { transform-origin: 0 0; animation: kf_pulse_1_transform_0 2s linear infinite, kf_pulse_1_stroke_0 2s linear infinite;}@keyframes kf_pulse_2_transform_0 {  0% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  10% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  30% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }  100% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }}@keyframes kf_pulse_2_stroke_0 {  0% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #24A8DB; }  10.05% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #4CCA51; }  20% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #4CCA51; }  30% { stroke: rgba(76, 202, 81, 0); }  100% { stroke: rgba(76, 202, 81, 0); }}#pulse_2 { transform-origin: 0 0; animation: kf_pulse_2_transform_0 2s linear infinite, kf_pulse_2_stroke_0 2s linear infinite;}@keyframes kf_pulse_3_transform_0 {  0% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  20% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  40% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }  100% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }}@keyframes kf_pulse_3_stroke_0 {  0% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #24A8DB; }  10.05% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #4CCA51; }  30% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #4CCA51; }  40% { stroke: rgba(76, 202, 81, 0); }  100% { stroke: rgba(76, 202, 81, 0); }}#pulse_3 { transform-origin: 0 0; animation: kf_pulse_3_transform_0 2s linear infinite, kf_pulse_3_stroke_0 2s linear infinite;}</style><g id="uptodate_yes"><circle id="pulse_1" cx="12" cy="12" r="11.5" stroke="#4CCA51"/><circle id="pulse_2" cx="12" cy="12" r="11.5" stroke="#24A8DB"/><circle id="pulse_3" cx="12" cy="12" r="11.5" stroke="#24A8DB"/><circle id="bg" cx="12" cy="12" r="12" fill="#4CCA51"/><path id="i" transform="translate(9 4)" d="M3.648 3.744C2.976 3.744 2.472 3.592 2.136 3.288C1.8 2.968 1.632 2.528 1.632 1.968C1.632 1.408 1.848 0.944 2.28 0.576C2.728 0.192 3.28 0 3.936 0C4.528 0 5.008 0.144 5.376 0.432C5.744 0.72 5.928 1.128 5.928 1.656C5.928 2.296 5.72 2.808 5.304 3.192C4.888 3.56 4.336 3.744 3.648 3.744ZM1.344 16.632C0.832 16.632 0.48 16.528 0.288 16.32C0.096 16.112 0 15.784 0 15.336C0 15.208 0.016 14.984 0.048 14.664C0.304 11.736 0.728 9.072 1.32 6.672C1.448 6.176 1.656 5.832 1.944 5.64C2.248 5.432 2.728 5.328 3.384 5.328C4.072 5.328 4.416 5.608 4.416 6.168C4.416 6.248 4.4 6.4 4.368 6.624C3.648 10.048 3.216 12.92 3.072 15.24C3.04 15.752 2.888 16.112 2.616 16.32C2.344 16.528 1.92 16.632 1.344 16.632Z" fill="white"/></g></svg>`)}`;
  const SVG_NO = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><style>svg { overflow: visible; }@keyframes kf_pulse_1_transform_0 {  0% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  20% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }  100% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }}@keyframes kf_pulse_1_stroke_0 {  0% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #E74C3C; }  10% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #E74C3C; }  20% { stroke: rgba(231, 76, 60, 0); }  100% { stroke: rgba(231, 76, 60, 0); }}#pulse_1 { transform-origin: 0 0; animation: kf_pulse_1_transform_0 2s linear infinite, kf_pulse_1_stroke_0 2s linear infinite;}@keyframes kf_pulse_2_transform_0 {  0% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  10% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  30% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }  100% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }}@keyframes kf_pulse_2_stroke_0 {  0% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #24A8DB; }  20% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #E74C3C; }  30% { stroke: rgba(231, 76, 60, 0); }  100% { stroke: rgba(231, 76, 60, 0); }}#pulse_2 { transform-origin: 0 0; animation: kf_pulse_2_transform_0 2s linear infinite, kf_pulse_2_stroke_0 2s linear infinite;}@keyframes kf_pulse_3_transform_0 {  0% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  20% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  40% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }  100% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }}@keyframes kf_pulse_3_stroke_0 {  0% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #24A8DB; }  30% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #E74C3C; }  40% { stroke: rgba(231, 76, 60, 0); }  100% { stroke: rgba(231, 76, 60, 0); }}#pulse_3 { transform-origin: 0 0; animation: kf_pulse_3_transform_0 2s linear infinite, kf_pulse_3_stroke_0 2s linear infinite;}</style><g id="uptodate_no"><circle id="pulse_1" cx="12" cy="12" r="11.5" stroke="#E74C3C"/><circle id="pulse_2" cx="12" cy="12" r="11.5" stroke="#24A8DB"/><circle id="pulse_3" cx="12" cy="12" r="11.5" stroke="#24A8DB"/><circle id="bg" cx="12" cy="12" r="12" fill="#E74C3C"/><path id="i" transform="translate(9 4)" d="M3.648 3.744C2.976 3.744 2.472 3.592 2.136 3.288C1.8 2.968 1.632 2.528 1.632 1.968C1.632 1.408 1.848 0.944 2.28 0.576C2.728 0.192 3.28 0 3.936 0C4.528 0 5.008 0.144 5.376 0.432C5.744 0.72 5.928 1.128 5.928 1.656C5.928 2.296 5.72 2.808 5.304 3.192C4.888 3.56 4.336 3.744 3.648 3.744ZM1.344 16.632C0.832 16.632 0.48 16.528 0.288 16.32C0.096 16.112 0 15.784 0 15.336C0 15.208 0.016 14.984 0.048 14.664C0.304 11.736 0.728 9.072 1.32 6.672C1.448 6.176 1.656 5.832 1.944 5.64C2.248 5.432 2.728 5.328 3.384 5.328C4.072 5.328 4.416 5.608 4.416 6.168C4.416 6.248 4.4 6.4 4.368 6.624C3.648 10.048 3.216 12.92 3.072 15.24C3.04 15.752 2.888 16.112 2.616 16.32C2.344 16.528 1.92 16.632 1.344 16.632Z" fill="white"/></g></svg>`)}`;

  function normalizeTitle(title) {
    if (!title) return "";
    return title.toLowerCase().replace(/\.{2,}/g, '').replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  const IGNORE_UI_WORDS = new Set([
    'schedule', 'latest', 'popular', 'shows', 'trending', 'this season', 'season',
    'ona', 'tv', 'movie', 'episodes', 'recently', 'released', 'home', 'browse',
    'music', 'torrents', 'profile', 'settings', 'account', 'login', 'sub', 'dub',
    'aud', 'read more', 'all', 'view', 'score distribution', 'current progress',
    'al stats', 'mal stats', 'next', 'previous', 'today', 'mon', 'tue', 'wed',
    'thu', 'fri', 'sat', 'sun'
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
    return false;
  }

  function processAnimeCard(card, watchlist) {
    if (card.hasAttribute('data-shiinah-scanned')) return;
    if (card.parentElement && card.parentElement.closest('[data-shiinah-scanned="true"]')) return;

    let titleEl = card.querySelector('.line-clamp-1, .line-clamp-2, a.font-semibold, h1, h2, h3, h4, h5, .title, .series-title, .anime-title, .manga-title');
    if (!titleEl && card.tagName !== 'A') titleEl = card.querySelector('a[href*="/anime/"], a[href*="/series/"], a[href*="/manga/"], a[href*="/chapter/"]');
    if (!titleEl && card.tagName === 'A') titleEl = card;

    let rawText = titleEl ? (titleEl.textContent || '').trim() : '';
    const imgEl = card.querySelector('img');
    const altText = imgEl ? (imgEl.getAttribute('alt') || '').trim() : '';

    const normRawText = normalizeTitle(rawText);
    const normAltText = normalizeTitle(altText);

    if (!isValidTitle(normRawText) && !isValidTitle(normAltText)) return;

    card.setAttribute('data-shiinah-scanned', 'true');
    const displayTitle = isValidTitle(normRawText) ? rawText : altText;

    const match = watchlist.find(entry => {
      const normEng = normalizeTitle(entry.media?.title?.english);
      const normRom = normalizeTitle(entry.media?.title?.romaji);
      let isMatch = false;
      if (isValidTitle(normRawText)) isMatch = isMatch || isTitleMatch(normRawText, normEng) || isTitleMatch(normRawText, normRom);
      if (isValidTitle(normAltText)) isMatch = isMatch || isTitleMatch(normAltText, normEng) || isTitleMatch(normAltText, normRom);
      return isMatch;
    });

    const style = window.getComputedStyle(card);
    if (style.position === 'static') card.style.position = 'relative';

    if (match) injectInteractiveBadge(card, match, true, displayTitle);
    else injectInteractiveBadge(card, { media: { title: { romaji: displayTitle } } }, false, displayTitle);
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

  function injectInteractiveBadge(targetEl, entry, isWatchlisted, rawText) {
    const media = entry.media;
    const currentProgress = entry.progress || 0;
    const isManga = media.chapters !== undefined || media.format === 'MANGA' || media.format === 'NOVEL';
    const unitLabel = isManga ? 'Ch' : 'Ep';

    let latestCount = media.episodes || media.chapters || '?';
    if (media.nextAiringEpisode) latestCount = media.nextAiringEpisode.episode - 1;
    const isUpToDate = latestCount !== '?' && currentProgress >= latestCount;
    
    let activeSvg, themeColor;
    if (!isWatchlisted) { activeSvg = SVG_UNLISTED; themeColor = '#FFD345'; } 
    else if (isUpToDate) { activeSvg = SVG_YES; themeColor = '#4cca51'; } 
    else { activeSvg = SVG_NO; themeColor = '#e74c3c'; }

    const badgeWrapper = document.createElement('span');
    badgeWrapper.className = 'shiinah-inline-badge';
    Object.assign(badgeWrapper.style, { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', position: 'absolute', top: '8px', right: '8px', cursor: 'pointer', zIndex: '2147483640', flexShrink: '0' });
    badgeWrapper.innerHTML = `<img src="${activeSvg}" style="width: 22px; height: 22px; pointer-events: none; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));">`;
    targetEl.appendChild(badgeWrapper);

    const tooltip = document.createElement('div');
    tooltip.className = 'shiinah-tooltip-container'; tooltip._linkedBadge = badgeWrapper; 
    Object.assign(tooltip.style, { position: 'fixed', width: '290px', padding: '16px', backgroundColor: '#0b1119', border: `1px solid ${themeColor}`, borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.9)', display: 'none', flexDirection: 'column', gap: '12px', zIndex: '2147483647', pointerEvents: 'auto', fontFamily: 'system-ui, sans-serif', color: '#fff', cursor: 'default' });

    const bridge = document.createElement('div');
    bridge.style.cssText = 'position: absolute; bottom: -15px; left: 0; width: 100%; height: 15px; background: transparent;';
    tooltip.appendChild(bridge);

    badgeWrapper.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });

    const headerHtml = isWatchlisted 
      ? `
        <div style="font-size: 11px; color: #9fadbd; font-weight: bold; text-align: center; letter-spacing: 0.5px; margin-bottom: 4px;">PROGRESS (${unitLabel})</div>
        <div style="font-size: 22px; color: #fff; font-weight: 900; text-align: center; letter-spacing: 1px; margin-bottom: 4px;">
          <span style="color: ${themeColor};">${currentProgress}</span> / <span style="color: #677b94;">${latestCount}</span>
        </div>
        <div class="shiinah-media-status" style="font-size: 11px; color: #E5C07B; text-align: center; font-weight: bold; margin-bottom: 10px;"></div>
        <div class="shiinah-view-links" style="display: flex; gap: 8px; width: 100%;"></div>
      ` 
      : `
        <div style="font-size: 11px; color: #9fadbd; font-weight: bold; text-align: center; letter-spacing: 0.5px;">STATUS</div>
        <div style="font-size: 16px; color: #FFD345; font-weight: bold; text-align: center; margin-bottom: 8px;">Not in List</div>
        <div class="shiinah-add-btn-container" style="display: none; gap: 8px; margin-bottom: 8px; width: 100%;"></div>
      `;

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

  function initSmartTracker() {
    if (!chrome || !chrome.runtime || !chrome.runtime.id) return;
    chrome.runtime.sendMessage({ action: "GET_USER_WATCHLIST" }, (response) => {
      if (chrome.runtime.lastError || !response || !response.watchlist) return;
      cachedWatchlist = response.watchlist;
      const cardSelectors = '[data-slot="card"], .anime-card, .series-card, .manga-card, .card, [class*="card"], a[href*="/anime/"], a[href*="/series/"], a[href*="/manga/"], a[href*="/chapter/"], a[href*="/watch/"]';
      
      const scanDOM = () => {
        if (!chrome.runtime?.id) { clearInterval(shiinahScannerInterval); return; }
        document.querySelectorAll(cardSelectors).forEach(card => {
           if (card.tagName === 'A' && card.childElementCount === 0) return;
           processAnimeCard(card, cachedWatchlist);
        });
        document.querySelectorAll('.shiinah-tooltip-container').forEach(tooltip => {
          if (tooltip._linkedBadge && !document.body.contains(tooltip._linkedBadge)) tooltip.remove();
        });
      };

      scanDOM();
      if (!shiinahScannerInterval) shiinahScannerInterval = setInterval(scanDOM, 2500);
    });
  }
  
  setTimeout(initSmartTracker, 1000);
});