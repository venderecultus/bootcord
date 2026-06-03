(function () {
  var video = document.getElementById('video');
  var status = document.getElementById('status');
  var statusText = document.getElementById('statusText');

  function setStatus(html) {
    status.style.display = 'flex';
    statusText.innerHTML = html;
  }

  function hideStatus() {
    status.style.display = 'none';
  }

  function getHost() {
    return window.location.host;
  }

  var hlsUrl = (window.location.protocol === 'https:' ? 'https:' : 'http:') + '//' + getHost() + '/hls/stream.m3u8';

  if (Hls.isSupported()) {
    var hls = new Hls({
      enableWorker: false,
      lowLatencyMode: true,
      liveSyncDurationCount: 0.3,
      liveMaxLatencyDurationCount: 2,
      maxBufferLength: 1,
      startPosition: -1,
    });

    var retryCount = 0;
    var maxRetries = 20;

    function loadStream() {
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
    }

    loadStream();

    hls.on(Hls.Events.MANIFEST_PARSED, function () {
      retryCount = 0;
      hideStatus();
      video.play().catch(function () {});
    });

    hls.on(Hls.Events.ERROR, function (event, data) {
      if (data.fatal) {
        console.error('[HLS.js] Fatal error:', data.type, data.reason || data.details);
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            if (retryCount < maxRetries) {
              retryCount++;
              setStatus('Reconnecting... (' + retryCount + '/' + maxRetries + ')');
              setTimeout(loadStream, 2000);
            } else {
              setStatus('Playback error — stream unreachable');
            }
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            setStatus('Recovering...');
            hls.recoverMediaError();
            break;
          default:
            setStatus('Playback error — ' + (data.reason || 'stream may have ended'));
            break;
        }
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = hlsUrl;
    video.addEventListener('loadedmetadata', function () {
      hideStatus();
      video.play().catch(function () {});
    });
  } else {
    setStatus('HLS playback not supported in this browser');
  }

  // Unmute button
  var unmuteBtn = document.getElementById('unmuteBtn');
  if (unmuteBtn) {
    unmuteBtn.addEventListener('click', function () {
      video.muted = !video.muted;
      unmuteBtn.textContent = video.muted ? '🔇' : '🔊';
    });
    video.addEventListener('volumechange', function () {
      unmuteBtn.textContent = video.muted ? '🔇' : '🔊';
    });
  }
})();
