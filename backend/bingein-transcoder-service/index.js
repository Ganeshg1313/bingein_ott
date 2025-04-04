// transcoder.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { Client, Storage, Databases, InputFile } = require('node-appwrite');

const app = express();
app.use(express.json());

// Initialize Appwrite client
const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)  // e.g., 'https://cloud.appwrite.io/v1'
  .setProject(process.env.APPWRITE_PROJECT)      // Your project ID
  .setKey(process.env.APPWRITE_API_KEY);           // Your API key

const storage = new Storage(client);
const databases = new Databases(client);

// Define bucket and collection IDs (adjust as needed)
const outputBucketId = process.env.APPWRITE_OUTPUT_BUCKET_ID; // Bucket for transcoded HLS files
const databaseId = process.env.APPWRITE_DATABASE_ID;
const collectionId = process.env.APPWRITE_VIDEOS_COLLECTION_ID;

// Function to download file from Appwrite with authentication headers
async function downloadFileFromAppwrite(fileUrl, outputPath) {
  try {
    const headers = {
      'X-Appwrite-Project': process.env.APPWRITE_PROJECT,
      'X-Appwrite-Key': process.env.APPWRITE_API_KEY,
    };

    const response = await axios({
      url: fileUrl,
      method: 'GET',
      responseType: 'stream',
      headers,
    });

    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (error) {
    console.error('Error downloading file:', error);
    throw error;
  }
}

// Endpoint to trigger transcoding for a given video
// Expects a JSON body: { "videoId": "video-document-id", "originalUrl": "..." }
app.post('/transcode', async (req, res) => {
  try {
    const { videoId, originalUrl } = req.body;
    if (!videoId || !originalUrl) {
      return res.status(400).json({ error: 'Missing videoId or originalUrl in request body.' });
    }
    
    // Step 1: Download the raw video file locally
    const localInputPath = path.join(__dirname, 'input.mp4'); // Temporary local file path
    await downloadFileFromAppwrite(originalUrl, localInputPath);
    console.log('File downloaded successfully.');
    
    // Step 2: Transcode the video into HLS format using FFmpeg
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }
    const outputManifest = path.join(outputDir, 'output.m3u8');
    
    // Use an environment variable for FFmpeg path if provided; otherwise, assume it's in PATH.
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    
    // FFmpeg command; adjust parameters as needed
    const ffmpegCommand = `${ffmpegPath} -i "${localInputPath}" -codec: copy -start_number 0 -hls_time 10 -hls_list_size 0 -f hls "${outputManifest}"`;
    console.log('Executing FFmpeg command:', ffmpegCommand);
    
    await new Promise((resolve, reject) => {
      exec(ffmpegCommand, (error, stdout, stderr) => {
        if (error) {
          console.error('FFmpeg error:', error);
          return reject(error);
        }
        console.log('FFmpeg stdout:', stdout);
        console.error('FFmpeg stderr:', stderr);
        resolve();
      });
    });
    
    // Step 3: Upload transcoded TS segment files and update manifest with full URLs
    const files = fs.readdirSync(outputDir);
    const tsMapping = {}; // mapping of TS filename -> file id
    let manifestFileName = null;
    
    // First, upload TS files and identify the manifest file.
    for (const fileName of files) {
      const filePath = path.join(outputDir, fileName);
      if (fileName.endsWith('.ts')) {
        const inputTs = InputFile.fromPath(filePath, fileName);
        const uploadResponse = await storage.createFile(outputBucketId, 'unique()', inputTs);
        tsMapping[fileName] = uploadResponse.$id;
      } else if (fileName.endsWith('.m3u8')) {
        manifestFileName = fileName;
      }
    }
    
    if (!manifestFileName) {
      return res.status(500).json({ error: 'Manifest file not found in output.' });
    }
    
    // Read the original manifest file content
    const manifestPath = path.join(outputDir, manifestFileName);
    let manifestContent = fs.readFileSync(manifestPath, 'utf8');
    
    // Replace relative TS filenames with full URLs using the mapping
    for (const [tsFileName, fileId] of Object.entries(tsMapping)) {
      const fullUrl = `${process.env.APPWRITE_ENDPOINT}/storage/buckets/${outputBucketId}/files/${fileId}/view?project=${process.env.APPWRITE_PROJECT}`;
      // Replace all occurrences of the TS file name in the manifest
      const regex = new RegExp(tsFileName, 'g');
      manifestContent = manifestContent.replace(regex, fullUrl);
    }
    
    // Write the updated manifest to a new file
    const updatedManifestPath = path.join(outputDir, 'updated_manifest.m3u8');
    fs.writeFileSync(updatedManifestPath, manifestContent, 'utf8');
    
    // Upload the updated manifest file
    const inputManifest = InputFile.fromPath(updatedManifestPath, 'updated_manifest.m3u8');
    const manifestUploadResponse = await storage.createFile(outputBucketId, 'unique()', inputManifest);
    const manifestFileId = manifestUploadResponse.$id;
    
    // Construct the URL for the HLS manifest file
    const manifestUrl = `${process.env.APPWRITE_ENDPOINT}/storage/buckets/${outputBucketId}/files/${manifestFileId}/view?project=${process.env.APPWRITE_PROJECT}`;
    
    // Step 4: Update the video document in Appwrite with the new status and streaming URL
    const updatedDocument = await databases.updateDocument(
      databaseId,
      collectionId,
      videoId,
      {
        transcodedUrl: manifestUrl,
        status: 'ready'
      }
    );
    
    // Clean up local files (input and output)
    fs.unlinkSync(localInputPath);
    files.forEach(fileName => fs.unlinkSync(path.join(outputDir, fileName)));
    fs.unlinkSync(updatedManifestPath);
    
    res.status(200).json({
      message: 'Transcoding complete',
      manifestUrl,
      video: updatedDocument
    });
    
  } catch (error) {
    console.error('Error in transcoding:', error);
    res.status(500).json({ error: 'Transcoding failed', details: error.message });
  }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Transcoding service running on port ${PORT}`);
});
