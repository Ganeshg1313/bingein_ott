// server.js
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');

// Appwrite SDK imports
const { Client, Storage, Databases } = require('node-appwrite');
const { InputFile } = require('node-appwrite/file');

const app = express();
app.use(cors());
app.use(express.json());

// Ensure uploads folder exists
const fs = require('fs');
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Configure Multer storage (storing files on local disk)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // folder to store uploads temporarily
  },
  filename: function (req, file, cb) {
    // Use a unique name (timestamp + original file name)
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// Initialize Appwrite client
const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT) // Your Appwrite endpoint
  .setProject(process.env.APPWRITE_PROJECT)     // Your project ID
  .setKey(process.env.APPWRITE_API_KEY);          // Your secret API key

// Initialize Appwrite services: Storage and Databases
const appwriteStorage = new Storage(client);
const databases = new Databases(client);

// Upload Endpoint: POST /api/upload
app.post('/api/upload', upload.single('video'), async (req, res) => {
  try {
    // Multer stores the file information in req.file
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Upload the file to Appwrite's bucket (replace bucketId with your bucket id)
    const bucketId = process.env.APPWRITE_BUCKET_ID;
    const inputFile = InputFile.fromPath(file.path, file.originalname);
    const response = await appwriteStorage.createFile(bucketId, 'unique()', inputFile);
    const fileId = response.$id;
    const fileUrl = `${process.env.APPWRITE_ENDPOINT}/storage/buckets/${bucketId}/files/${fileId}/view?project=${process.env.APPWRITE_PROJECT}`;

    //Create a new document in Appwrite's "Videos" collection (replace collection and database IDs)
    const collectionId = process.env.APPWRITE_VIDEOS_COLLECTION_ID;
    const databaseId = process.env.APPWRITE_DATABASE_ID;
    const videoDocument = await databases.createDocument(
      databaseId,
      collectionId,
      'unique()', // Document ID auto-generated
      {
        title: req.body.title || file.originalname,
        originalUrl: fileUrl, // URL returned from Appwrite for the uploaded file
        transcodedUrl: '',
        status: 'pending',
      }
    );

    // Respond with the created document's details
    res.status(200).json({
      message: 'File uploaded .',
      res: response,
      videDocument: videoDocument,
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Start the Express server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
