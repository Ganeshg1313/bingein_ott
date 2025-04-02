// transcoder.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { Client, Storage, Databases } = require('node-appwrite');
const { InputFile } = require('node-appwrite/file');

const app = express();
app.use(express.json());

// Initialize Appwrite client
const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)  // e.g., 'https://cloud.appwrite.io/v1'
  .setProject(process.env.APPWRITE_PROJECT)      // Your project ID
  .setKey(process.env.APPWRITE_API_KEY);           // Your API key

const storage = new Storage(client);
const databases = new Databases(client);

// Define bucket and collection IDs
const rawBucketId = process.env.APPWRITE_BUCKET_ID;            // Bucket for raw video uploads
const outputBucketId = process.env.APPWRITE_OUTPUT_BUCKET_ID;    // Bucket for transcoded HLS files
const databaseId = process.env.APPWRITE_DATABASE_ID;
const collectionId = process.env.APPWRITE_VIDEOS_COLLECTION_ID;

// Function to download file from Appwrite with proper headers
async function downloadFileFromAppwrite(fileUrl, outputPath) {
  try {
    // Set authentication headers required by Appwrite
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

// Endpoint to trigger transcoding for a given video document
// Expects a JSON body: { "videoId": "video-document-id" }
app.post('/transcode', async (req, res) => {
  try {
    const { videoId } = req.body;
    if (!videoId) {
      return res.status(400).json({ error: 'Missing videoId in request body.' });
    }
    
    // Step 1: Retrieve the video document from Appwrite
    const videoDocument = await databases.getDocument(databaseId, collectionId, videoId);
    const originalUrl = videoDocument.originalUrl;
    if (!originalUrl) {
      return res.status(400).json({ error: 'No originalUrl found in video document.' });
    }
    
    // Construct the authenticated URL for downloading if not already included
    // (Assuming your URL does not have authentication parameters)
    const downloadUrl = `${originalUrl}&project=${process.env.APPWRITE_PROJECT}`;
    
    // Step 2: Download the raw video file locally
    const localInputPath = path.join(__dirname, 'input.mp4'); // Temporary local file path
    await downloadFileFromAppwrite(downloadUrl, localInputPath);
    console.log('File downloaded successfully.');
    
    // Step 3: Transcode the video into HLS format using FFmpeg
    // Create an output directory if it doesn't exist
    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }
    const outputManifest = path.join(outputDir, 'output.m3u8');
    
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';


    // FFmpeg command: Adjust parameters as needed for your transcoding requirements
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
    
    // Step 4: Upload the transcoded files (manifest and segments) to Appwrite
    const outputFiles = fs.readdirSync(outputDir);
    let manifestFileId = null;
    
    for (const fileName of outputFiles) {
      const filePath = path.join(outputDir, fileName);
      const inputFile = InputFile.fromPath(filePath, fileName);
      const uploadResponse = await storage.createFile(outputBucketId, 'unique()', inputFile);
      
      // Identify the manifest file (.m3u8) for later use
      if (fileName.endsWith('.m3u8')) {
        manifestFileId = uploadResponse.$id;
      }
    }
    
    if (!manifestFileId) {
      return res.status(500).json({ error: 'Failed to upload the HLS manifest.' });
    }
    
    // Construct the URL for the HLS manifest file
    const manifestUrl = `${process.env.APPWRITE_ENDPOINT}/storage/buckets/${outputBucketId}/files/${manifestFileId}/view?project=${process.env.APPWRITE_PROJECT}`;
    
    // Step 5: Update the video document in Appwrite with the streaming URL and new status
    const updatedDocument = await databases.updateDocument(
      databaseId,
      collectionId,
      videoId,
      {
        transcodedUrl: manifestUrl,
        status: 'ready'
      }
    );
    
    // Cleanup local temporary files
    fs.unlinkSync(localInputPath);
    outputFiles.forEach(fileName => fs.unlinkSync(path.join(outputDir, fileName)));
    
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
