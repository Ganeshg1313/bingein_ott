// App.js
import React, { useState } from 'react';
import VideoPlayer from './components/VideoPlayer.jsx';

function App() {
  // Replace this URL with your actual manifest URL
  const [manifestUrl, setManifestUrl] = useState('https://cloud.appwrite.io/v1/storage/buckets/67ed51890012a802a879/files/67ed6035ebce33113fca/view?project=67ebf0bf000a36a967c1&mode=admin');

  return (
    <div>
      <h1>BingeIn Streaming MVP</h1>
      <VideoPlayer manifestUrl={manifestUrl} />
    </div>
  );
}

export default App;
