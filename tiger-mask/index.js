const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const { google } = require('googleapis');
const { URL } = require('url');
const https = require('https');

const POSTER = 'https://m.media-amazon.com/images/M/MV5BNTY5ZjJiMzItNGJiZi00YjJmLWE3NTMtZjY5Mjc0NjY0MzNkXkEyXkFqcGc@._V1_SX300.jpg';
const TOTAL_EPISODES = 33;
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://tiger-mask-arabic.onrender.com';

// Google Drive credentials from environment variable
const GDRIVE_CREDENTIALS = process.env.GDRIVE_CREDENTIALS
  ? JSON.parse(process.env.GDRIVE_CREDENTIALS)
  : null;

// Google Drive folder ID (shared with the service account)
const FOLDER_ID = process.env.GDRIVE_FOLDER_ID || '1iPKIcY0QjKMWOc_wboR45qJZ6RHvMfSN';

const CATALOG = {
  type: 'movie',
  id: 'tiger-mask-season-2',
  name: 'النمر المقنع - الجزء الثاني'
};

// Initialize Google Drive API client
let drive;
let driveAuth;
if (GDRIVE_CREDENTIALS) {
  driveAuth = new google.auth.GoogleAuth({
    credentials: GDRIVE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  drive = google.drive({ version: 'v3', auth: driveAuth });
}

// Episode file mapping - will be populated from Google Drive folder
// Cache: { episodeNum: fileId }
let EPISODES_MAP = {};
let FILES_LOADED = false;
let FILES_LOADING = false;

async function loadFilesFromFolder() {
  if (FILES_LOADED || FILES_LOADING || !drive) return EPISODES_MAP;
  FILES_LOADING = true;

  try {
    console.log('Loading files from Google Drive folder:', FOLDER_ID);
    const response = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType, size)',
      orderBy: 'name',
      supportsAllDrives: true
    });

    const files = response.data.files;
    console.log(`Found ${files.length} files in folder`);

    // Map Arabic episode names to episode numbers
    // Arabic names like "الحلقه 1" or "الحلقه 10"
    const arabicNumerals = {
      '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
      '10': 10, '11': 11, '12': 12, '13': 13, '14': 14, '15': 15,
      '16': 16, '17': 17, '18': 18, '19': 19, '20': 20, '21': 21, '22': 22,
      '23': 23, '24': 24, '25': 25, '26': 26, '27': 27, '28': 28, '29': 29,
      '30': 30, '31': 31, '32': 32, '33': 33
    };

    for (const file of files) {
      if (file.mimeType !== 'video/mp4') continue;
      
      const name = file.name;
      // Try to extract episode number from name
      const match = name.match(/الحلقه\s+(\d+)/);
      if (match) {
        const epNum = parseInt(match[1], 10);
        if (epNum >= 1 && epNum <= TOTAL_EPISODES) {
          EPISODES_MAP[epNum] = file.id;
          console.log(`  Episode ${epNum} -> ${file.id} (${name})`);
        }
      }
    }

    FILES_LOADED = true;
    FILES_LOADING = false;
    console.log(`Loaded ${Object.keys(EPISODES_MAP).length} episodes`);
  } catch (err) {
    FILES_LOADING = false;
    console.error('Error loading files from folder:', err.message);
  }

  return EPISODES_MAP;
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
  version: '1.2.0',
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
      // Load files if not already loaded
      if (!FILES_LOADED && drive) {
        loadFilesFromFolder();
      }

      var fileId = EPISODES_MAP[episodeNum];

      if (fileId && drive) {
        // Use Google Drive API to stream securely
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
app.get('/stream-proxy', async function(req, res) {
  const fileId = req.query.id;
  if (!fileId) return res.status(400).send('Missing file ID');

  if (!drive) {
    return res.status(500).send('Google Drive not configured. Please set GDRIVE_CREDENTIALS and GDRIVE_FOLDER_ID.');
  }

  try {
    // Get an access token using the service account
    const client = await driveAuth.getClient();
    const accessToken = await client.getAccessToken();

    // Use Google Drive API to get a direct download URL
    // For large files, we need to construct the download URL with the auth token
    const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

    const urlObj = new URL(downloadUrl);
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
        // Fallback: try webContentLink approach
        drive.files.get({
          fileId: fileId,
          fields: 'webContentLink',
          supportsAllDrives: true
        }, function(err, fileResult) {
          if (err || !fileResult.data.webContentLink) {
            return res.status(500).send('Unable to access file via Google Drive API');
          }
          
          const fallbackUrl = fileResult.data.webContentLink;
          const fallbackObj = new URL(fallbackUrl);
          
          const fallbackOptions = {
            hostname: fallbackObj.hostname,
            port: fallbackObj.port || 443,
            path: fallbackObj.pathname + fallbackObj.search,
            method: 'GET',
            headers: {
              'Authorization': 'Bearer ' + accessToken.token,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Range': req.headers.range || 'bytes=0-'
            }
          };

          https.get(fallbackOptions, (fallbackRes) => {
            handleStreamResponse(fallbackRes, req, res);
          }).on('error', err => {
            res.status(500).send('Fallback stream error: ' + err.message);
          });
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
    folderId: FOLDER_ID || null,
    episodesLoaded: Object.keys(EPISODES_MAP).length,
    version: '1.2.0'
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
      count: response.data.files.length,
      episodes: EPISODES_MAP
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
  
  // Pre-load files from folder
  if (drive) {
    loadFilesFromFolder();
  }
});
