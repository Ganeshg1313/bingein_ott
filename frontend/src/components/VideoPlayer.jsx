// VideoPlayer.js
import React, { useRef, useEffect } from 'react';
import Hls from 'hls.js';

const VideoPlayer = ({ manifestUrl }) => {
  const videoRef = useRef(null);

  useEffect(() => {
    let hls;
    if (manifestUrl && videoRef.current) {
      // Check if the browser supports HLS via hls.js
      if (Hls.isSupported()) {
        hls = new Hls();
        hls.loadSource(manifestUrl);
        hls.attachMedia(videoRef.current);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          videoRef.current.play();
        });
      } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
        // For Safari
        videoRef.current.src = manifestUrl;
        videoRef.current.addEventListener('loadedmetadata', () => {
          videoRef.current.play();
        });
      }
    }
    // Cleanup hls instance on unmount
    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [manifestUrl]);

  return (
    <div>
      <video
        ref={videoRef}
        controls
        style={{ width: '640px', height: '360px' }}
      />
    </div>
  );
};

export default VideoPlayer;
