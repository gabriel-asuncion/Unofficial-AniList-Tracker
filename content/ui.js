// content/ui.js

const SVG_UNLISTED = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><style>svg { overflow: visible; }@keyframes kf_pulse_1_transform_0 {  0% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  20% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }  100% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }}@keyframes kf_pulse_1_stroke_0 {  0% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #FFD345; }  10% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #FFD345; }  20% { stroke: rgba(255, 211, 69, 0); }  100% { stroke: rgba(255, 211, 69, 0); }}#pulse_1 { transform-origin: 0 0; animation: kf_pulse_1_transform_0 2s linear infinite, kf_pulse_1_stroke_0 2s linear infinite;}@keyframes kf_pulse_2_transform_0 {  0% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  10% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  30% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }  100% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }}@keyframes kf_pulse_2_stroke_0 {  0% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #FFD345; }  20% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #FFD345; }  30% { stroke: rgba(255, 211, 69, 0); }  100% { stroke: rgba(255, 211, 69, 0); }}#pulse_2 { transform-origin: 0 0; animation: kf_pulse_2_transform_0 2s linear infinite, kf_pulse_2_stroke_0 2s linear infinite;}@keyframes kf_pulse_3_transform_0 {  0% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  20% { transform: translate(12px, 12px) scaleX(1) scaleY(1) translate(-12px, -12px); }  40% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }  100% { transform: translate(12px, 12px) scaleX(1.5) scaleY(1.5) translate(-12px, -12px); }}@keyframes kf_pulse_3_stroke_0 {  0% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #FFD345; }  10.05% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #4CCA51; }  20% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #FFD345; }  30% { animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1); stroke: #FFD345; }  40% { stroke: rgba(255, 211, 69, 0); }  100% { stroke: rgba(255, 211, 69, 0); }}#pulse_3 { transform-origin: 0 0; animation: kf_pulse_3_transform_0 2s linear infinite, kf_pulse_3_stroke_0 2s linear infinite;}</style><g id="watchlist_no"><circle id="pulse_1" cx="12" cy="12" r="11.5" stroke="#FFD345"/><circle id="pulse_2" cx="12" cy="12" r="11.5" stroke="#FFD345"/><circle id="pulse_3" cx="12" cy="12" r="11.5" stroke="#FFD345"/><circle id="bg" cx="12" cy="12" r="12" fill="#FFD345"/><path id="i" transform="translate(9 4)" d="M3.648 3.744C2.976 3.744 2.472 3.592 2.136 3.288C1.8 2.968 1.632 2.528 1.632 1.968C1.632 1.408 1.848 0.944 2.28 0.576C2.728 0.192 3.28 0 3.936 0C4.528 0 5.008 0.144 5.376 0.432C5.744 0.72 5.928 1.128 5.928 1.656C5.928 2.296 5.72 2.808 5.304 3.192C4.888 3.56 4.336 3.744 3.648 3.744ZM1.344 16.632C0.832 16.632 0.48 16.528 0.288 16.32C0.096 16.112 0 15.784 0 15.336C0 15.208 0.016 14.984 0.048 14.664C0.304 11.736 0.728 9.072 1.32 6.672C1.448 6.176 1.656 5.832 1.944 5.64C2.248 5.432 2.728 5.328 3.384 5.328C4.072 5.328 4.416 5.608 4.416 6.168C4.416 6.248 4.4 6.4 4.368 6.624C3.648 10.048 3.216 12.92 3.072 15.24C3.04 15.752 2.888 16.112 2.616 16.32C2.344 16.528 1.92 16.632 1.344 16.632Z" fill="white"/></g></svg>`)}`;

const SVG_YES = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><style>@keyframes kf_check_group_transform_0 {  0% {    animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);    transform: translateX(4px) translateY(4px) translate(8px, 8px) rotate(0rad) translate(-8px, -8px);  }  10% {    animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);    transform: translateX(4px) translateY(4px) translate(8px, 8px) rotate(-0.262rad) translate(-8px, -8px);  }  20% {    animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);    transform: translateX(4px) translateY(4px) translate(8px, 8px) rotate(0.262rad) translate(-8px, -8px);  }  30% {    animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);    transform: translateX(4px) translateY(4px) translate(8px, 8px) rotate(-0.262rad) translate(-8px, -8px);  }  40% {    transform: translateX(4px) translateY(4px) translate(8px, 8px) rotate(0rad) translate(-8px, -8px);  }  100% {    transform: translateX(4px) translateY(4px) translate(8px, 8px) rotate(0rad) translate(-8px, -8px);  }}#check_group {  transform-origin: 0 0;  animation: kf_check_group_transform_0 2s linear infinite;}</style><g id="new_ok" clip-path="url(#clip0_306_964)"><circle id="outline" cx="12" cy="12" r="11.5" stroke="#4CCA51"/><circle id="fill" cx="12" cy="12" r="12" fill="#4CCA51"/><g id="check_group" transform="translate(4 4)"><rect id="left" transform="matrix(-0.707107 -0.707107 -0.707107 0.707107 7.4248 12.6567)" width="8.72559" height="2.5" rx="2" fill="white"/><rect id="right" transform="translate(4 12.6567) rotate(-45)" width="15.1949" height="2.5" rx="2" fill="white"/></g></g><defs><clipPath id="clip0_306_964"><rect width="24" height="24" fill="white"/></clipPath></defs></svg>`)}`;

const SVG_NO = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><style>@keyframes kf_Vector_transform_0 {  0% {    animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);    transform: translateX(5.518px) translateY(5.497px) translate(6.377px, 6.377px) scaleX(1) scaleY(1) translate(-6.377px, -6.377px);  }  30% {    transform: translateX(5.518px) translateY(5.497px) translate(6.377px, 6.377px) scaleX(1.2) scaleY(1.2) translate(-6.377px, -6.377px);  }  50% {    animation-timing-function: cubic-bezier(0.5, 0, 0.5, 1);    transform: translateX(5.518px) translateY(5.497px) translate(6.377px, 6.377px) scaleX(1.2) scaleY(1.2) translate(-6.377px, -6.377px);  }  60% {    transform: translateX(5.518px) translateY(5.497px) translate(6.377px, 6.377px) scaleX(1) scaleY(1) translate(-6.377px, -6.377px);  }  100% {    transform: translateX(5.518px) translateY(5.497px) translate(6.377px, 6.377px) scaleX(1) scaleY(1) translate(-6.377px, -6.377px);  }}#Vector {  transform-origin: 0 0;  animation: kf_Vector_transform_0 2s linear infinite;}</style><g id="new_nok" clip-path="url(#clip0_306_998)"><circle id="outline" cx="12" cy="12" r="11.5" stroke="#E74C3C"/><circle id="fill" cx="12" cy="12" r="12" fill="#E74C3C"/><g id="Vector" transform="translate(5.51777 5.49695)"><path d="M12.3869 12.3869C12.8751 11.8988 12.8751 11.1073 12.3869 10.6192L2.13388 0.366117C1.64573 -0.122039 0.854272 -0.122039 0.366116 0.366116C-0.122039 0.854272 -0.122039 1.64573 0.366117 2.13388L10.6192 12.3869C11.1073 12.8751 11.8988 12.8751 12.3869 12.3869Z" id="Vector_bg_0" fill="white"></path><path d="M0.366117 12.3869C-0.122039 11.8988 -0.122039 11.1073 0.366117 10.6192L10.6192 0.366117C11.1073 -0.122039 11.8988 -0.122039 12.3869 0.366116C12.8751 0.854272 12.8751 1.64573 12.3869 2.13388L2.13388 12.3869C1.64573 12.8751 0.854272 12.8751 0.366117 12.3869Z" fill="white"/></g></g><defs><clipPath id="clip0_306_998"><rect width="24" height="24" fill="white"/></clipPath></defs></svg>`)}`;

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
    transition: 'opacity 0.5s ease, background-color 0.2s ease', backdropFilter: 'blur(4px)', boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    pointerEvents: 'auto', opacity: '1'
  });

  let fadeTimer;
  const triggerFadeOut = () => {
    btn.style.opacity = '1';
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => { btn.style.opacity = '0.08'; }, 5000);
  };

  btn.addEventListener('mousemove', triggerFadeOut);
  triggerFadeOut(); 

  btn.addEventListener('mouseenter', () => btn.style.backgroundColor = 'rgba(61, 180, 242, 0.9)');
  btn.addEventListener('mouseleave', () => btn.style.backgroundColor = 'rgba(21, 31, 46, 0.85)');
  
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation(); 
    if (trackedVideo && activeSkip && activeSkip.interval.endTime) {
      lastSkipTime = Date.now(); 
      trackedVideo.currentTime = activeSkip.interval.endTime;
      showInPageToast('success', 'Skipped', activeSkip.skipType === 'ed' ? 'Outro skipped successfully!' : 'Intro skipped successfully!');
      unmountSkipButton();
    }
  });

  const container = document.fullscreenElement || document.body;
  container.appendChild(btn);
  skipButtonMounted = true;

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

function mountCustomSkipButton() {
  if (document.getElementById('shiinah-custom-hotzone')) return;

  const btn = document.createElement('button');
  btn.id = 'shiinah-custom-hotzone';
  
  Object.assign(btn.style, {
    position: 'fixed', zIndex: '2147483647', display: 'none',
    backgroundColor: 'rgba(21, 31, 46, 0.85)', color: '#fff', border: '1px solid #3db4f2',
    padding: '12px 20px', borderRadius: '6px', cursor: 'pointer',
    fontFamily: 'system-ui, sans-serif', fontWeight: 'bold', fontSize: '15px',
    transition: 'opacity 0.5s ease, background-color 0.2s ease', backdropFilter: 'blur(4px)', boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    pointerEvents: 'auto', opacity: '1'
  });

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  let fadeTimer;
  const triggerFadeOut = () => {
    btn.style.opacity = '1';
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => { btn.style.opacity = '0.08'; }, 5000);
  };

  btn.addEventListener('mousemove', triggerFadeOut);
  triggerFadeOut();

  btn.addEventListener('mouseenter', () => btn.style.backgroundColor = 'rgba(61, 180, 242, 0.9)');
  btn.addEventListener('mouseleave', () => btn.style.backgroundColor = 'rgba(21, 31, 46, 0.85)');

  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation(); 
    if (!trackedVideo) return;
    lastSkipTime = Date.now(); 
    const isOP = trackedVideo.currentTime < (trackedVideo.duration * 0.5);
    const skipAmount = isOP ? (learnedSkipData.op || 85) : (learnedSkipData.ed || 85);
    
    const oldTime = trackedVideo.currentTime;
    const targetTime = customBtnAppearedAt + skipAmount;
    const finalJumpTime = Math.max(trackedVideo.currentTime + 5, targetTime); 
    
    trackedVideo.currentTime = finalJumpTime;
    
    sessionSkips.push({
      skipType: isOP ? 'op' : 'ed',
      interval: { startTime: oldTime, endTime: trackedVideo.currentTime }
    });

    showInPageToast('info', 'Smart Skip', `Skipped ${skipAmount}s based on your history!`);
    btn.style.display = 'none';
    customSkipBtnMounted = false;
    if (customSkipSyncInterval) clearInterval(customSkipSyncInterval);
  });

  const container = document.fullscreenElement || document.body;
  container.appendChild(btn);
  customSkipBtnMounted = true;

  if (customSkipSyncInterval) clearInterval(customSkipSyncInterval);
  customSkipSyncInterval = setInterval(() => {
    if (!trackedVideo) return;
    const currentContainer = document.fullscreenElement || document.body;
    if (btn.parentElement !== currentContainer) currentContainer.appendChild(btn);
    
    const rect = trackedVideo.getBoundingClientRect();
    btn.style.bottom = (window.innerHeight - rect.bottom + 70) + 'px';
    btn.style.right = (window.innerWidth - rect.right + 30) + 'px';
    
    const isOP = trackedVideo.currentTime < (trackedVideo.duration * 0.5);
    const skipAmount = isOP ? (learnedSkipData.op || 85) : (learnedSkipData.ed || 85);
    btn.innerHTML = isOP ? `▶ Skip Intro (+${formatTime(skipAmount)})` : `▶ Skip Outro (+${formatTime(skipAmount)})`;
  }, 50);
}

function showInPageToast(type, title, description, xpData = null) {
  const existingToast = document.getElementById('anilist-quick-update-toast');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.id = 'anilist-quick-update-toast';
  
  Object.assign(toast.style, {
    position: 'fixed', top: '20px', right: '-400px', backgroundColor: '#1f1f1f', color: '#ffffff',
    border: '1px solid #333', padding: '14px 18px', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
    zIndex: '2147483647', fontFamily: 'system-ui, -apple-system, sans-serif', display: 'flex',
    flexDirection: 'column', width: '340px', transition: 'right 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
    boxSizing: 'border-box'
  });

  const icons = {
    success: `<svg fill="#4cca51" viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="12"/><path fill="#1f1f1f" d="M10 15.5l-3.5-3.5 1.4-1.4 2.1 2.1 5.4-5.4 1.4 1.4z"/></svg>`,
    info: `<svg fill="#777" viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="12"/><path fill="#1f1f1f" d="M11 7h2v2h-2zm0 4h2v6h-2z"/></svg>`,
    warning: `<svg fill="#f39c12" viewBox="0 0 24 24" width="22" height="22"><path d="M12 2L1 21h22L12 2zm-1 14v-4h2v4h-2zm0 4v-2h2v2h-2z"/></svg>`,
    error: `<svg fill="#e74c3c" viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="12"/><path fill="#1f1f1f" d="M15.5 14.1l-1.4 1.4-2.1-2.1-2.1 2.1-1.4-1.4 2.1-2.1-2.1-2.1 1.4-1.4 2.1 2.1 2.1-2.1 1.4 1.4-2.1 2.1z"/></svg>`
  };

  const closeSvg = `<svg style="cursor:pointer; opacity:0.5; transition:opacity 0.2s;" width="18" height="18" fill="none" stroke="#aaa" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

  let xpHtml = ''; let animStyleHtml = '';
  
  if (type === 'success' && xpData) {
    const lvl = xpData.level;
    const currentLevelBaseMins = 500000 * Math.pow((lvl - 1) / 99, 2);
    const nextLevelMins = 500000 * Math.pow(lvl / 99, 2);
    const minsRequiredForNext = nextLevelMins - currentLevelBaseMins;
    const previousTotalMins = xpData.totalMinutes - xpData.gainedMins;
    const prevMinsIntoLevel = previousTotalMins - currentLevelBaseMins;
    const currentMinsIntoLevel = xpData.totalMinutes - currentLevelBaseMins;
    const previousPct = Math.min(100, Math.max(0, (prevMinsIntoLevel / minsRequiredForNext) * 100));
    const currentPct = Math.min(100, Math.max(0, (currentMinsIntoLevel / minsRequiredForNext) * 100));
    const gainedPct = currentPct - previousPct;

    animStyleHtml = `<style>@keyframes shiinah-xp-fill { to { width: ${gainedPct}%; } }</style>`;

    xpHtml = `
      <div style="margin-top: 14px; width: 100%; border-top: 1px solid #2b3a4a; padding-top: 12px;">
        <div style="display: flex; justify-content: space-between; font-size: 11px; color: #fff; margin-bottom: 6px; font-weight: bold;">
          <span>Progress to Lv. ${lvl + 1}</span>
          <span style="color: #E5C07B;">+${xpData.gainedMins} XP</span>
        </div>
        <div style="width: 100%; background: #1a2636; border-radius: 6px; height: 8px; overflow: hidden; position: relative;" title="${Math.floor(xpData.totalMinutes).toLocaleString()} / ${Math.floor(nextLevelMins).toLocaleString()} XP">
          <div style="position: absolute; top: 0; left: 0; height: 100%; width: ${previousPct}%; background: #E5C07B; border-radius: 6px;"></div>
          <div style="position: absolute; top: 0; left: ${previousPct}%; height: 100%; width: 0%; background: #4cca51; animation: shiinah-xp-fill 1.2s cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.4s forwards; border-radius: 0 6px 6px 0;"></div>
        </div>
      </div>
    `;
  }

  toast.innerHTML = `
    ${animStyleHtml}
    <div style="display: flex; gap: 14px; align-items: flex-start;">
      <div style="flex-shrink: 0; margin-top: 1px;">${icons[type] || icons.info}</div>
      <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 4px;">
        <span style="font-size: 15px; font-weight: 600; color: #fff; line-height: 1.2; letter-spacing: 0.3px;">${title}</span>
        <span style="font-size: 13px; font-weight: 400; color: #aaa; line-height: 1.4;">${description}</span>
      </div>
      <div class="toast-close-btn" style="flex-shrink: 0; display: flex; align-items: center; justify-content: center; padding: 2px;">
        ${closeSvg}
      </div>
    </div>
    ${xpHtml}
  `;

  const container = document.fullscreenElement || document.body;
  container.appendChild(toast);

  const closeBtn = toast.querySelector('.toast-close-btn');
  closeBtn.addEventListener('mouseenter', () => closeBtn.firstElementChild.style.opacity = '1');
  closeBtn.addEventListener('mouseleave', () => closeBtn.firstElementChild.style.opacity = '0.5');
  closeBtn.addEventListener('click', () => { toast.style.right = '-400px'; setTimeout(() => toast.remove(), 400); });

  requestAnimationFrame(() => { setTimeout(() => { toast.style.right = '20px'; }, 100); });
  setTimeout(() => { if (container.contains(toast)) { toast.style.right = '-400px'; setTimeout(() => { if (container.contains(toast)) toast.remove(); }, 400); } }, 5000); 
}

function showRatingToast(mediaId, animeName) {
  const existing = document.getElementById('shiinah-rating-toast-container');
  if (existing) existing.remove();

  if (!document.getElementById('shiinah-rating-css')) {
    const style = document.createElement('style'); style.id = 'shiinah-rating-css';
    style.textContent = `
      #shiinah-score-slider { -webkit-appearance: none; width: 100%; height: 6px; background: linear-gradient(to right, #3db4f2 50%, #2b3a4a 50%); border-radius: 3px; outline: none; margin-top: 30px; }
      #shiinah-score-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 20px; height: 20px; border-radius: 50%; background: #2b3a4a; border: 4px solid #fff; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.5); margin-top: -7px; }
      #shiinah-score-slider::-webkit-slider-runnable-track { height: 6px; border-radius: 3px; }
      .shiinah-slider-wrapper { position: relative; width: 100%; display: flex; flex-direction: column; align-items: center; padding: 20px 10px; box-sizing: border-box; }
      .shiinah-tooltip-bubble { position: absolute; top: -5px; background: #2b3a4a; color: #fff; padding: 6px 12px; border-radius: 8px; text-align: center; transform: translateX(-50%); white-space: nowrap; box-shadow: 0 4px 12px rgba(0,0,0,0.5); pointer-events: none; display: flex; flex-direction: column; align-items: center; justify-content: center; }
      .shiinah-tooltip-bubble::after { content: ''; position: absolute; bottom: -5px; left: 50%; transform: translateX(-50%); border-width: 6px 6px 0; border-style: solid; border-color: #2b3a4a transparent transparent transparent; }
      .shiinah-bubble-text { font-size: 11px; color: #9fadbd; font-weight: bold; text-transform: uppercase; margin-bottom: 2px; }
      .shiinah-bubble-num { font-size: 18px; font-weight: 900; color: #fff; line-height: 1; }
    `;
    document.head.appendChild(style);
  }

  const container = document.createElement('div'); container.id = 'shiinah-rating-toast-container';
  Object.assign(container.style, {
    position: 'fixed', bottom: '30px', right: '30px', backgroundColor: '#1f1f1f', border: '1px solid #333',
    padding: '20px', borderRadius: '12px', width: '320px', boxShadow: '0 10px 40px rgba(0,0,0,0.8)', color: '#fff',
    zIndex: '2147483647', fontFamily: 'system-ui, -apple-system, sans-serif', display: 'flex', flexDirection: 'column', gap: '8px',
    animation: 'shiinah-slide-up 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)', transition: 'opacity 0.5s ease', opacity: '1'
  });

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div style="flex-grow: 1;">
            <h3 style="margin: 0 0 4px 0; font-size: 16px; color: #3db4f2;">Series Completed! 🎉</h3>
            <p style="margin: 0; font-size: 12px; color: #aaa; line-height: 1.4; padding-right: 15px;">Rate <b style="color: #fff;">${animeName}</b></p>
        </div>
        <button id="shiinah-rating-close" style="background: transparent; border: none; color: #aaa; cursor: pointer; font-size: 18px; line-height: 1; padding: 0;">✕</button>
    </div>
    <div class="shiinah-slider-wrapper">
        <div id="shiinah-tooltip-bubble" class="shiinah-tooltip-bubble" style="left: 50%;">
            <span id="shiinah-bubble-text" class="shiinah-bubble-text">Fine</span>
            <span id="shiinah-bubble-num" class="shiinah-bubble-num">50</span>
        </div>
        <input type="range" id="shiinah-score-slider" min="0" max="100" value="50">
    </div>
    <button id="shiinah-submit-rating" style="width: 100%; padding: 12px; margin-top: 10px; background: #3db4f2; color: #0b1119; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; transition: 0.2s;">Submit Score</button>
  `;

  document.body.appendChild(container);

  const slider = document.getElementById('shiinah-score-slider'); const bubble = document.getElementById('shiinah-tooltip-bubble');
  const bubbleText = document.getElementById('shiinah-bubble-text'); const bubbleNum = document.getElementById('shiinah-bubble-num');
  const submitBtn = document.getElementById('shiinah-submit-rating'); const closeBtn = document.getElementById('shiinah-rating-close');

  const getRatingText = (val) => {
      if (val >= 95) return "Masterpiece"; if (val >= 85) return "Great"; if (val >= 75) return "Very Good";
      if (val >= 65) return "Good"; if (val >= 50) return "Fine"; if (val >= 40) return "Average";
      if (val >= 30) return "Bad"; if (val >= 20) return "Very Bad"; if (val >= 10) return "Horrible"; return "Appalling";
  };

  slider.addEventListener('input', (e) => {
      const val = e.target.value; slider.style.background = `linear-gradient(to right, #3db4f2 ${val}%, #2b3a4a ${val}%)`;
      bubbleNum.textContent = val; bubbleText.textContent = getRatingText(val);
      const thumbWidth = 20; const percent = val / 100; const pixelOffset = (thumbWidth / 2) - (thumbWidth * percent);
      bubble.style.left = `calc(${val}% + ${pixelOffset}px)`;
  });

  let fadeTimer;
  const triggerFadeOut = () => { container.style.opacity = '1'; clearTimeout(fadeTimer); fadeTimer = setTimeout(() => { container.style.opacity = '0.04'; }, 5000); };
  container.addEventListener('mousemove', triggerFadeOut); container.addEventListener('mouseenter', () => { container.style.opacity = '1'; clearTimeout(fadeTimer); }); container.addEventListener('mouseleave', triggerFadeOut);
  triggerFadeOut();

  closeBtn.addEventListener('click', () => container.remove());
  submitBtn.addEventListener('mouseenter', () => submitBtn.style.opacity = '0.8'); submitBtn.addEventListener('mouseleave', () => submitBtn.style.opacity = '1');
  submitBtn.addEventListener('click', () => {
      submitBtn.textContent = 'Saving...'; submitBtn.disabled = true;
      chrome.runtime.sendMessage({ action: "SAVE_ANIME_SCORE", mediaId, score: parseInt(slider.value, 10) }, () => {
          container.remove(); showInPageToast('success', 'Score Saved', `Your rating for ${animeName} was successfully saved!`);
      });
  });
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
  
  const isManga = (media && (media.format === 'MANGA' || media.format === 'NOVEL' || media.format === 'ONE_SHOT')) || 
                  (typeof getActiveMediaType === 'function' && getActiveMediaType() === 'MANGA');
  
  const unitLabel = isManga ? 'Ch' : 'Ep';

  let latestCount = media ? (media.episodes || media.chapters || '?') : '?';
  if (media && media.nextAiringEpisode) {
    latestCount = media.nextAiringEpisode.episode - 1;
  }
  
  let isUpToDate = false;
  let badgeType = 'UNLISTED';

  if (isWatchlisted) {
    if (extractedEp !== null && isEpisodeCard) {
      isUpToDate = currentProgress >= extractedEp;
    } else {
      isUpToDate = (latestCount !== '?') && (currentProgress >= latestCount);
    }
    
    badgeType = isUpToDate ? 'YES' : 'NO';
  }

  let activeSvg, themeColor;
  if (badgeType === 'UNLISTED') { 
    if (!showUnlistedBadges) return; 
    
    activeSvg = SVG_UNLISTED; 
    themeColor = '#FFD345'; 
  } else if (badgeType === 'YES') { 
    activeSvg = SVG_YES; 
    themeColor = '#4cca51'; 
  } else { 
    activeSvg = SVG_NO; 
    themeColor = '#e74c3c'; 
  }

  const badgeWrapper = document.createElement('span');
  badgeWrapper.className = 'shiinah-inline-badge';
  Object.assign(badgeWrapper.style, { 
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', 
    position: 'absolute', top: '8px', right: '8px', cursor: 'pointer', 
    zIndex: '2147483640', flexShrink: '0' 
  });
  badgeWrapper.innerHTML = `<img src="${activeSvg}" style="width: 22px; height: 22px; pointer-events: none; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));">`;
  targetEl.appendChild(badgeWrapper);

  const tooltip = document.createElement('div');
  tooltip.className = 'shiinah-tooltip-container'; 
  tooltip._linkedBadge = badgeWrapper; 
  Object.assign(tooltip.style, { 
    position: 'fixed', width: '290px', padding: '16px', backgroundColor: '#0b1119', 
    border: `1px solid ${themeColor}`, borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.9)', 
    display: 'none', flexDirection: 'column', gap: '12px', zIndex: '2147483647', 
    pointerEvents: 'auto', fontFamily: 'system-ui, sans-serif', color: '#fff', cursor: 'default' 
  });

  const bridge = document.createElement('div');
  bridge.style.cssText = 'position: absolute; bottom: -15px; left: 0; width: 100%; height: 15px; background: transparent;';
  tooltip.appendChild(bridge);

  badgeWrapper.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });

  let headerHtml = '';
  if (isWatchlisted) {
    if (extractedEp !== null && isEpisodeCard) {
      const statusText = isUpToDate ? (isManga ? 'Read ✓' : 'Watched ✓') : (isManga ? 'Unread' : 'Unwatched');
      
      headerHtml = `
        <div style="font-size: 11px; color: #9fadbd; font-weight: bold; text-align: center; letter-spacing: 0.5px; margin-bottom: 4px; text-transform: uppercase;">${unitLabel} ${extractedEp}</div>
        <div style="font-size: 20px; color: ${themeColor}; font-weight: 900; text-align: center; letter-spacing: 1px; margin-bottom: 4px;">
          ${statusText}
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

  if (!document.getElementById('shiinah-spinner-style')) {
    const style = document.createElement('style');
    style.id = 'shiinah-spinner-style';
    style.textContent = `@keyframes shiinah-spin { 100% { transform: rotate(360deg); } }`;
    document.head.appendChild(style);
  }

  tooltip.innerHTML = `
    <div class="shiinah-status-header">${headerHtml}</div>
    <div class="shiinah-stats-body">
      <div style="display:flex; flex-direction:column; align-items:center; gap:8px; padding: 20px;">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px; height:24px; color:#3db4f2; animation: shiinah-spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
         <span style="color:#9fadbd; font-size:12px; font-weight:bold;">Fetching live data...</span>
      </div>
    </div>
  `;

  document.body.appendChild(tooltip);

  let cachedStats = null;

  function renderCharts() {
    const statsBody = tooltip.querySelector('.shiinah-stats-body');
    if (!statsBody) return;

    if (cachedStats?.meta?.status) {
      const statusEl = tooltip.querySelector('.shiinah-media-status');
      if (statusEl) statusEl.textContent = `Status: ${formatStatusLabel(cachedStats.meta.status)}`;
    }

    const activeData = cachedStats?.al;

    if (!activeData || !activeData.scoreDistribution || activeData.scoreDistribution.length === 0) {
      statsBody.innerHTML = `<div style="text-align: center; color: #e74c3c; font-size: 10px; padding: 8px 0; border-top: 1px solid #1a2636; margin-top: 6px;">No score distribution available</div>`;
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
          <div style="width: 10px; height: 50px; display: flex; align-items: flex-end; justify-content: center;">
            <div style="width: 100%; height: ${heightPct}%; background-color: ${barColor}; border-radius: 3px;"></div>
          </div>
          <div style="font-size: 9px; color: #677b94; font-weight: bold; margin-top: 2px;">${scoreObj.score}</div>
        </div>
      `;
    });
    
    statsBody.innerHTML = `
      <div style="font-size: 10px; color: #9fadbd; font-weight: bold; margin-top: 6px; margin-bottom: 2px; text-transform: uppercase; border-top: 1px solid #1a2636; padding-top: 6px;">SCORE DISTRIBUTION</div>
      <div style="display: flex; align-items: flex-end; justify-content: space-between; height: 75px; padding-bottom: 2px;">${barsHtml}</div>
    `;
  }

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
    tooltip.style.top = `${top}px`; 
    tooltip.style.left = `${left}px`;

    if (!cachedStats) {
      clearTimeout(fetchIntentTimeout);
      fetchIntentTimeout = setTimeout(async () => {
        try {
          if (!chrome.runtime?.id) return;
          const pageMediaType = typeof getActiveMediaType === 'function' ? getActiveMediaType() : (isManga ? 'MANGA' : 'ANIME');
          
          if (isWatchlisted) {
            chrome.runtime.sendMessage({ action: "FETCH_MEDIA_STATS", mediaId: media.id, malId: media.idMal, mediaType: pageMediaType }, (res) => {
              if (chrome.runtime.lastError) console.error("[Shiinah UI] Message Error:", chrome.runtime.lastError.message);
              
              cachedStats = res?.stats || { al: null, meta: null };
              renderCharts();
            });
            
            const linkContainer = tooltip.querySelector('.shiinah-view-links');
            if (linkContainer && !linkContainer.hasChildNodes()) {
              if (media.id > 0 && !media.isMalOnly) {
                const alLink = document.createElement('a'); 
                alLink.textContent = 'View in AL'; 
                alLink.href = `https://anilist.co/${pageMediaType.toLowerCase()}/${media.id}`; 
                alLink.target = '_blank';
                Object.assign(alLink.style, { flex: '1', textAlign: 'center', background: 'transparent', color: '#3db4f2', border: '1px solid #3db4f2', padding: '6px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold', textDecoration: 'none', transition: '0.2s' });
                alLink.onmouseenter = () => { alLink.style.background = '#3db4f2'; alLink.style.color = '#fff'; }; 
                alLink.onmouseleave = () => { alLink.style.background = 'transparent'; alLink.style.color = '#3db4f2'; };
                alLink.onclick = (e) => e.stopPropagation();
                linkContainer.appendChild(alLink);
              }
              if (media.idMal || media.isMalOnly) {
                const malLink = document.createElement('a'); 
                malLink.textContent = 'View in MAL';
                malLink.href = `https://myanimelist.net/${pageMediaType.toLowerCase()}/${media.isMalOnly ? media.idMal : media.idMal}`; 
                malLink.target = '_blank';
                Object.assign(malLink.style, { flex: '1', textAlign: 'center', background: 'transparent', color: '#5C7CE5', border: '1px solid #2E51A2', padding: '6px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold', textDecoration: 'none', transition: '0.2s' });
                malLink.onmouseenter = () => { malLink.style.background = '#2E51A2'; malLink.style.color = '#fff'; }; 
                malLink.onmouseleave = () => { malLink.style.background = 'transparent'; malLink.style.color = '#5C7CE5'; };
                malLink.onclick = (e) => e.stopPropagation();
                linkContainer.appendChild(malLink);
              }
            }
          } else {
            const fetchMedia = (type) => new Promise(resolve => {
                chrome.runtime.sendMessage({ action: "SEARCH_AND_FETCH_STATS", title: rawText, mediaType: type }, (res) => {
                    if (chrome.runtime.lastError) console.error("[Shiinah UI] Message Error:", chrome.runtime.lastError.message);
                    resolve(res);
                });
            });
            
            const primaryRes = await fetchMedia(pageMediaType);
            
            cachedStats = primaryRes?.stats || { al: null, meta: null };
            renderCharts();

            const btnContainer = tooltip.querySelector('.shiinah-add-btn-container');
            if (btnContainer && primaryRes?.media?.id) {
              btnContainer.innerHTML = ''; 
              btnContainer.style.display = 'flex';
              
              const group = document.createElement('div');
              Object.assign(group.style, { display: 'flex', flexDirection: 'column', gap: '4px', flex: '1', minWidth: '0' });
              const platforms = [];
              if (primaryRes.media.id > 0 && !primaryRes.media.isMalOnly) platforms.push('AL');
              if (primaryRes.media.idMal || primaryRes.media.isMalOnly) platforms.push('MAL');
              const platStr = platforms.length > 0 ? ` [${platforms.join('/')}]` : '';

              const btn = document.createElement('button'); 
              btn.textContent = `+ ${pageMediaType === 'MANGA' ? 'Manga' : 'Anime'}${platStr}`;
              Object.assign(btn.style, { width: '100%', background: '#3db4f2', color: '#fff', border: 'none', padding: '8px 4px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer', fontSize: '11px', transition: '0.2s', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
              btn.addEventListener('mouseenter', () => btn.style.background = '#2c9ad1'); 
              btn.addEventListener('mouseleave', () => btn.style.background = '#3db4f2');
              btn.addEventListener('click', (e) => {
                e.preventDefault(); 
                e.stopPropagation(); 
                btn.textContent = 'Adding...';
                chrome.runtime.sendMessage({ action: "ADD_TO_WATCHLIST", mediaId: primaryRes.media.id, malId: primaryRes.media.idMal, mediaType: pageMediaType }, (addRes) => {
                  if (addRes?.success) { 
                    btn.textContent = 'Added! ✓'; 
                    btn.style.background = '#4cca51'; 
                  } else { 
                    btn.textContent = 'Error'; 
                    btn.style.background = '#e74c3c'; 
                  }
                });
              });
              group.appendChild(btn);

              const linksRow = document.createElement('div');
              Object.assign(linksRow.style, { display: 'flex', gap: '4px', width: '100%' });

              if (primaryRes.media.id > 0 && !primaryRes.media.isMalOnly) {
                const alLink = document.createElement('a'); 
                alLink.textContent = 'View in AL'; 
                alLink.href = `https://anilist.co/${pageMediaType.toLowerCase()}/${primaryRes.media.id}`; 
                alLink.target = '_blank';
                Object.assign(alLink.style, { flex: '1', textAlign: 'center', background: 'transparent', color: '#3db4f2', border: '1px solid #3db4f2', padding: '4px 0', borderRadius: '4px', fontSize: '9px', fontWeight: 'bold', textDecoration: 'none', transition: '0.2s' });
                alLink.onmouseenter = () => { alLink.style.background = '#3db4f2'; alLink.style.color = '#fff'; }; 
                alLink.onmouseleave = () => { alLink.style.background = 'transparent'; alLink.style.color = '#3db4f2'; }; 
                alLink.onclick = (e) => e.stopPropagation();
                linksRow.appendChild(alLink);
              }

              if (primaryRes.media.idMal || primaryRes.media.isMalOnly) {
                const malLink = document.createElement('a'); 
                malLink.textContent = 'View in MAL';
                malLink.href = `https://myanimelist.net/${pageMediaType.toLowerCase()}/${primaryRes.media.isMalOnly ? primaryRes.media.idMal : primaryRes.media.idMal}`; 
                malLink.target = '_blank';
                Object.assign(malLink.style, { flex: '1', textAlign: 'center', background: 'transparent', color: '#5C7CE5', border: '1px solid #2E51A2', padding: '4px 0', borderRadius: '4px', fontSize: '9px', fontWeight: 'bold', textDecoration: 'none', transition: '0.2s' });
                malLink.onmouseenter = () => { malLink.style.background = '#2E51A2'; malLink.style.color = '#fff'; }; 
                malLink.onmouseleave = () => { malLink.style.background = 'transparent'; malLink.style.color = '#5C7CE5'; }; 
                malLink.onclick = (e) => e.stopPropagation();
                linksRow.appendChild(malLink);
              }

              group.appendChild(linksRow);
              btnContainer.appendChild(group);
            }
          }
        } catch(e) { console.error("[Shiinah UI] Fetch Intent Error:", e); }
      }, 300); 
    }
  };

  const scheduleHide = () => { 
    clearTimeout(fetchIntentTimeout); 
    hideTimeout = setTimeout(() => { tooltip.style.display = 'none'; }, 250); 
  };

  badgeWrapper.addEventListener('mouseenter', showTooltip);
  badgeWrapper.addEventListener('mouseleave', scheduleHide);
  tooltip.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
  tooltip.addEventListener('mouseleave', scheduleHide);
}

function processAnimeCard(card, watchlist) {
  if (card.hasAttribute('data-shiinah-scanned')) return;

  if (card.closest('.shiinah-wrapper-marked') || card.querySelector('.shiinah-inline-badge')) {
      card.setAttribute('data-shiinah-scanned', 'true');
      return;
  }

  if (card.closest('.cast-grid, .characters, .staff, .comments, [class*="cast"], [class*="character"], [class*="staff"], [class*="person"]')) return;
  if (card.className && typeof card.className === 'string' && card.className.match(/cast|character|person|staff|avatar|user/i)) return;
  
  const ariaLabel = card.getAttribute('aria-label') || '';
  const isEpisodeAria = ariaLabel.toLowerCase().includes('episode') || ariaLabel.toLowerCase().includes('chapter');
  
  if (card.closest('button, [role="button"], [role="combobox"], [role="tab"], .btn, .button') && !card.querySelector('img, picture') && !isEpisodeAria) return;
  if ((card.tagName === 'BUTTON' || card.getAttribute('role') === 'button' || card.getAttribute('role') === 'combobox') && !card.querySelector('img, picture') && !isEpisodeAria) return;

  const href = (card.tagName === 'A' ? card.href : (card.querySelector('a')?.href || '')).toLowerCase();
  if (href.match(/\/(character|person|cast|staff|profile|user|comments)\//i)) return;

  let titleEl = card.querySelector('.line-clamp-1, .line-clamp-2, a.font-semibold, h1, h2, h3, h4, h5, .title, .series-title, .anime-title, .manga-title, .card-title, p');
  if (!titleEl && card.tagName !== 'A' && card.tagName !== 'BUTTON') titleEl = card.querySelector('a[href*="/anime/"], a[href*="/series/"]');
  if (!titleEl && (card.tagName === 'A' || card.tagName === 'BUTTON')) titleEl = card;

  let rawText = titleEl ? (titleEl.textContent || '').trim() : '';
  const imgEl = card.querySelector('img, picture');
  const altText = imgEl ? (imgEl.getAttribute('alt') || '').trim() : '';

  const normRawText = normalizeTitle(rawText);
  const normAltText = normalizeTitle(altText);

  if (!imgEl && !isEpisodeAria && (normRawText === "" || IGNORE_UI_WORDS.has(normRawText))) return;

  const isExplicitSeriesLink = href.includes('/info/') || href.includes('/series/') || href.includes('/category/');
  const isExplicitWatchLink = href.includes('/watch') || href.includes('/episode') || href.includes('?ep=');
  const currentPath = window.location.pathname.toLowerCase();
  const isOnGenericPage = currentPath === '/' || currentPath.includes('/schedule') || currentPath.includes('/home') || currentPath.includes('/latest') || currentPath.includes('/popular');

  let isEpisodeCard = false;
  let extractedEp = null;

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

  if (ariaEpMatch) extractedEp = parseFloat(ariaEpMatch[1]);
  else if (isolatedEpMatch !== null) extractedEp = isolatedEpMatch;
  else if (textEpMatch) extractedEp = parseFloat(textEpMatch[1]);
  else if (urlEpMatch) extractedEp = parseFloat(urlEpMatch[1]);

  if (!isExplicitSeriesLink && extractedEp !== null) {
      const inEpContainer = !!card.closest('.episodes-container, [class*="episode-list"], [class*="chapter-list"], #episodes, [class*="episodes"]');
      if (inEpContainer || isExplicitWatchLink || isEpisodeAria || /^(?:Episode|Ep|Chapter|Ch)\s*\d+(\.\d+)?$/i.test(rawText.replace(/[^\w\s]/g, '').trim())) {
          isEpisodeCard = true;
      }
  }

  if (!isValidTitle(normRawText) && !isValidTitle(normAltText) && extractedEp === null) return;

  card.setAttribute('data-shiinah-scanned', 'true');
  card.classList.add('shiinah-wrapper-marked');
  const wrapper = card.closest('li, article, .slider__item, .swiper-slide, .carousel__item');
  if (wrapper) wrapper.setAttribute('data-shiinah-wrapper-scanned', 'true');
  
  const style = window.getComputedStyle(card);
  if (style.position === 'static') card.style.position = 'relative';
  card.style.overflow = 'visible'; 

  let match = null;
  let displayTitle = isValidTitle(normRawText) ? rawText : (altText || document.title);

  match = watchlist.find(entry => {
    const normEng = normalizeTitle(entry.media?.title?.english);
    const normRom = normalizeTitle(entry.media?.title?.romaji);
    let isM = false;
    
    if (isValidTitle(normRawText)) isM = isM || isTitleMatch(normRawText, normEng) || isTitleMatch(normRawText, normRom);
    if (isValidTitle(normAltText)) isM = isM || isTitleMatch(normAltText, normEng) || isTitleMatch(normAltText, normRom);
    
    if (!isM && isEpisodeCard && extractedEp !== null && !isOnGenericPage) {
      const pageTitleNorm = normalizeTitle(getPageMainShowTitle());
      if (pageTitleNorm.length > 2) {
        isM = isPageTitleMatch(pageTitleNorm, normEng) || isPageTitleMatch(pageTitleNorm, normRom);
        if (isM) displayTitle = entry.media.title.romaji; 
      }
    }
    return isM;
  });

  if (!match && isEpisodeCard && extractedEp !== null && !isOnGenericPage) {
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