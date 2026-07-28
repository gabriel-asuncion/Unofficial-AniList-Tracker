// hls-interceptor.js
// Injected into the page's MAIN world to read .m3u8 response bodies

(function() {
  const originalFetch = window.fetch;

  // Helper function to calculate OP/ED timestamps from a playlist
  function analyzeM3U8(playlistText) {
    const lines = playlistText.split('\n');
    let currentTime = 0;
    let discontinuities = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXTINF:')) {
        // Extract the duration of this specific video chunk
        const durationStr = lines[i].split(':')[1].split(',')[0];
        currentTime += parseFloat(durationStr);
      } else if (lines[i].startsWith('#EXT-X-DISCONTINUITY')) {
        // Mark the exact timestamp where the stream switches sources
        discontinuities.push(currentTime);
      }
    }

    if (discontinuities.length > 0) {
      // Scenario A: The opening is at the very beginning of the video
      if (discontinuities[0] >= 80 && discontinuities[0] <= 100) {
        return { startTime: 0, endTime: discontinuities[0] };
      }
      
      // Scenario B: The opening is sandwiched between two discontinuities
      for (let i = 0; i < discontinuities.length - 1; i++) {
        const gap = discontinuities[i+1] - discontinuities[i];
        if (gap >= 80 && gap <= 100) { // ~90 second OP/ED
          return { startTime: discontinuities[i], endTime: discontinuities[i+1] };
        }
      }
    }
    return null;
  }

  // Intercept the modern Fetch API
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    
    if (url.includes('.m3u8')) {
      // Clone the response so the video player can still read it normally!
      const clone = response.clone();
      clone.text().then(text => {
        const skipInterval = analyzeM3U8(text);
        if (skipInterval) {
          // Send the found timestamps back to our Chrome Extension content script
          window.postMessage({ type: 'HLS_DISCONTINUITY_FOUND', interval: skipInterval }, '*');
        }
      }).catch(() => {});
    }
    return response;
  };
})();