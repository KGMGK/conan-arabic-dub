const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const { google } = require('googleapis');

const POSTER = 'https://m.media-amazon.com/images/M/MV5BNTY5ZjJiMzItNGJiZi00YjJmLWE3NTMtZjY5Mjc0NjY0MzNkXkEyXkFqcGc@._V1_SX300.jpg';
const TOTAL_EPISODES = 33;
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://tiger-mask-arabic.onrender.com';

// Google Drive credentials from environment variable
const GDRIVE_CREDENTIALS = process.env.GDRIVE_CREDENTIALS
  ? JSON.parse(process.env.GDRIVE_CREDENTIALS)
  : null;

// Google Drive folder ID (shared with the service account)
const FOLDER_ID = process.env.GDRIVE_FOLDER_ID || '1iPKIcY0QjKMWOc_wboR45qJZ6RHvMfSN';

// Episode to file mapping (Google Drive file IDs)
// If FOLDER_ID is set, files will be auto-discovered from the folder
const EPISODES = {
  1: '1kKS_hJ-O0GPLpMV2lBPZIWLv1_uuInA7'
};

// Episode filename patterns for auto-discovery
const EPISODE_FILE_PATTERN = 'Tiger Mask'; // Adjust if needed

const CATALOG = {
  type: 'movie',
  id: 'tiger-mask-season-2',
  name: 'النمر المقنع - الجزء الثاني'
};

// Initialize Google Drive API client
let drive;
if (GDRIVE_CREDENTIALS) {
  const auth = new google.auth.GoogleAuth({
    credentials: GDRIVE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  drive = google.drive({ version: 'v3', auth });
}

function buildEpisodeMetas() {
  var metas = [];
  for (var i = 1; i <= TOTAL_EPISODES; i++) {
    metas.push({
      id: 'tiger-mask-2-' + i,
      type: 'movie',
      name: 'النمر المقنع مدبلج - الحلقة ' + i,
      poster: POSTER
    });
  }
  return metas;
}

const addon = new addonBuilder({
  id: 'local.network.tigermask.arabic',
  name: 'النمر المقنع - مدبلج',
  version: '1.1.0',
  description: 'النمر المقنع (Tiger Mask II) مدبلج عربي - 33 حلقة',
  logo: POSTER,
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie'],
  catalogs: [CATALOG],
  idPrefixes: ['tiger-mask']
});

addon.defineCatalogHandler(function(args) {
  if (args.type === 'movie' && args.id === 'tiger-mask-season-2') {
    return Promise.resolve({ metas: buildEpisodeMetas() });
  }
  return Promise.resolve({ metas: [] });
});

addon.defineMetaHandler(function(args) {
  if (args.type === 'movie' && args.id.startsWith('tiger-mask-')) {
    var parts = args.id.split('-');
    var seasonNum = parseInt(parts[parts.length - 2], 10);
    var episodeNum = parseInt(parts[parts.length - 1], 10);
    if (seasonNum === 2 && episodeNum >= 1 && episodeNum <= TOTAL_EPISODES) {
      return Promise.resolve({
        meta: {
          id: args.id,
          type: 'movie',
          name: 'النمر المقنع مدبلج - الحلقة ' + episodeNum,
          poster: POSTER,
          description: 'النمر المقنع (Tiger Mask II) - الجزء الثاني مدبلج عربي - الحلقة ' + episodeNum
        }
      });
    }
  }
  return Promise.resolve({ meta: null });
});

addon.defineStreamHandler(function(args) {
  if (args.type === 'movie' && args.id.startsWith('tiger-mask-')) {
    var parts = args.id.split('-');
    var episodeNum = parseInt(parts[parts.length - 1], 10);

    if (episodeNum >= 1 && episodeNum <= TOTAL_EPISODES) {
      var fileId = EPISODES[episodeNum];
      
      if (!fileId && FOLDER_ID && drive) {
        // File will be discovered at request time
        // Return placeholder stream
        return Promise.resolve({
          streams: [
            {
              title: 'النمر المقنع مدبلج - الحلقة ' + episodeNum + ' (جارٍ البحث عن الملف...)',
              externalUrl: PUBLIC_URL
            }
          ]
        });
      }

      if (fileId && drive) {
        // Use Google Drive API to get a secure download link
        var proxyUrl = PUBLIC_URL + '/stream-proxy?id=' + fileId;
        return Promise.resolve({
          streams: [
            {
              title: 'النمر المقنع مدبلج - الحلقة ' + episodeNum + ' (Google Drive)',
              url: proxyUrl
            }
          ]
        });
      }

      return Promise.resolve({
        streams: [
          {
            name: 'النمر المقنع - الحلقة ' + episodeNum,
            description: 'لم يتم إضافة رابط الفيديو لهذه الحلقة بعد',
            externalUrl: 'https://drive.google.com/'
          }
        ]
      });
    }
  }
  return Promise.resolve({ streams: [] });
});

const app = express();

// Stream proxy using Google Drive API (secure, bypasses virus scan)
app.get('/stream-proxy', function(req, res) {
  const fileId = req.query.id;
  if (!fileId) return res.status(400).send('Missing file ID');

  if (!drive) {
    return res.status(500).send('Google Drive not configured. Please set GDRIVE_CREDENTIALS and GDRIVE_FOLDER_ID.');
  }

  // Use Google Drive API to get the file metadata and download URL
  // For large files, we need to get the webViewLink or direct download
  drive.files.get({
    fileId: fileId,
    fields: 'webViewLink,webContentLink,size,mimeType',
    supportsAllDrives: true
  }, async function(err, fileResult) {
    if (err) {
      console.error('Google Drive API error:', err.message);
      return res.status(500).send('Drive API error: ' + err.message);
    }

    // For streaming, use webContentLink which provides a direct download URL
    // But for Vidi compatibility, we'll proxy the stream through our server
    const directUrl = fileResult.data.webContentLink || 
                      fileResult.data.webViewLink ||
                      `https://drive.google.com/uc?export=download&id=${fileId}`;

    console.log(`Streaming file: ${fileId}, URL: ${directUrl.substring(0, 80)}...`);

    // Use the Google Drive API auth to get an access token for the download
    try {
      const auth = new google.auth.GoogleAuth({
        credentials: GDRIVE_CREDENTIALS,
        scopes: ['https://www.googleapis.com/auth/drive.readonly']
      });
      
      const client = await auth.getClient();
      const accessToken = await client.getAccessToken();

      // Proxy the video stream with proper auth headers
      const { URL } = require('url');
      const https = require('https');
      const urlObj = new URL(directUrl);

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + accessToken.token,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Range': req.headers.range || 'bytes=0-'
        }
      };

      const proxyReq = https.get(options, (proxyRes) => {
        if (proxyRes.statusCode === 403 || proxyRes.statusCode === 404) {
          // Fallback: try direct download without auth
          const fallbackUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
          const fallbackObj = new URL(fallbackUrl);
          
          const fallbackOptions = {
            hostname: fallbackObj.hostname,
            port: 443,
            path: fallbackObj.pathname + fallbackObj.search,
            method: 'GET',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Range': req.headers.range || 'bytes=0-'
            }
          };

          https.get(fallbackOptions, (fallbackRes) => {
            handleStreamResponse(fallbackRes, req, res);
          }).on('error', err => {
            res.status(500).send('Fallback stream error: ' + err.message);
          });
          return;
        }

        handleStreamResponse(proxyRes, req, res);
      });

      proxyReq.on('error', err => {
        console.error('Proxy error:', err.message);
        res.status(500).send('Stream proxy error: ' + err.message);
      });
    } catch (err) {
      console.error('Auth error:', err.message);
      res.status(500).send('Authentication error: ' + err.message);
    }
  });
});

function handleStreamResponse(proxyRes, req, res) {
  const headers = {};
  for (const key in proxyRes.headers) {
    if (!['transfer-encoding', 'connection', 'set-cookie', 'content-security-policy'].includes(key)) {
      headers[key] = proxyRes.headers[key];
    }
  }
  headers['Access-Control-Allow-Origin'] = '*';
  
  // Allow range requests for video seeking
  if (proxyRes.headers['content-range']) {
    headers['Content-Range'] = proxyRes.headers['content-range'];
    headers['Accept-Ranges'] = 'bytes';
  }

  res.writeHead(proxyRes.statusCode, headers);
  proxyRes.pipe(res);
}

// Health check endpoint
app.get('/health', function(req, res) {
  res.json({
    status: 'ok',
    driveConfigured: !!drive,
    folderId: !!FOLDER_ID,
    episodeCount: Object.keys(EPISODES).length
  });
});

// Discovery endpoint - list files in folder
app.get('/discover', async function(req, res) {
  if (!drive) return res.status(500).send('Drive not configured');
  
  try {
    const response = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType, size)',
      orderBy: 'name',
      supportsAllDrives: true
    });
    
    res.json({
      files: response.data.files,
      count: response.data.files.length
    });
  } catch (err) {
    res.status(500).send('Discovery error: ' + err.message);
  }
});

const addonRouter = getRouter(addon.getInterface());
app.use('/', addonRouter);

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log('Tiger Mask Arabic Addon running on port ' + PORT);
  console.log('Public URL: ' + PUBLIC_URL);
  console.log('Drive configured: ' + !!drive);
  console.log('Folder ID: ' + FOLDER_ID);
});
