const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const { google } = require('googleapis');
const { URL } = require('url');
const https = require('https');

const PUBLIC_URL = process.env.PUBLIC_URL || 'https://tiger-mask-arabic.onrender.com';

// Google Drive credentials from environment variable
const GDRIVE_CREDENTIALS = process.env.GDRIVE_CREDENTIALS
  ? JSON.parse(process.env.GDRIVE_CREDENTIALS)
  : null;

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

// === SHOW DEFINITIONS ===
// Each show has: name, folderId, poster, prefix, episode name pattern
const SHOWS = {
  'tiger-mask': {
    name: 'النمر المقنع - مدبلج',
    description: 'النمر المقنع (Tiger Mask II) مدبلج عربي - 33 حلقة',
    folderId: process.env.TIGER_MASK_FOLDER_ID || '1iPKIcY0QjKMWOc_wboR45qJZ6RHvMfSN',
    poster: 'https://cdn.myanimelist.net/images/anime/8/71351.jpg',
    prefix: 'tiger-mask',
    catalogId: 'tiger-mask-season-2',
    catalogName: 'النمر المقنع - الجزء الثاني',
    epNamePrefix: 'النمر المقنع مدبلج - الحلقة ',
    epMetaNamePrefix: 'النمر المقنع (Tiger Mask II) - الجزء الثاني مدبلج عربي - الحلقة ',
    maxEpisodes: 33,
    namePattern: /الحلقه\s+(\d+)/
  },
  'fosha': {
    name: 'الفسحة - مدبلج',
    description: 'كرتون الفسحة (Recess) مدبلج عربي - 52 حلقة',
    folderId: process.env.FOSHA_FOLDER_ID || '1NWP7LTEnNEdY5MDE5VGnTos_OsgG8U6Y',
    poster: 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/HtVxgjDfQaZqncBR.jpg',
    prefix: 'fosha',
    catalogId: 'fosha-season-1',
    catalogName: 'الفسحة - مدبلج',
    epNamePrefix: 'الفسحة - الحلقة ',
    epMetaNamePrefix: 'كرتون الفسحة (Recess) مدبلج عربي - الحلقة ',
    maxEpisodes: 52,
    namePattern: /^(\d+)$/
  },
  'sandad': {
    name: 'سنداد - مدبلج',
    description: 'كرتون سنداد (Sinbad) مدبلج عربي - 52 حلقة',
    folderId: process.env.SANDAD_FOLDER_ID || '12wjLgmnu6yu9ZK9uF7pRouDetNTH6AK1',
    poster: 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/HFoIUSVnyKHKLYxY.jpeg',
    prefix: 'sandad',
    catalogId: 'sandad-season-1',
    catalogName: 'سنداد - مدبلج',
    epNamePrefix: 'سنداد - الحلقة ',
    epMetaNamePrefix: 'كرتون سنداد (Sinbad) مدبلج عربي - الحلقة ',
    maxEpisodes: 52,
    namePattern: /^(\d+)(?:\.mp4)?$/
  }
};

// === FILE CACHES ===
// Cache per show: { episodeNum: fileId }
const showCaches = {};
const showLoading = {};

async function loadFilesFromFolder(showKey) {
  const show = SHOWS[showKey];
  if (!show) return {};

  // Already loaded or currently loading
  if (showCaches[showKey] || showLoading[showKey] || !drive) {
    return showCaches[showKey] || {};
  }

  showLoading[showKey] = true;
  showCaches[showKey] = {};

  try {
    console.log(`Loading files for "${show.name}" from folder: ${show.folderId}`);
    const response = await drive.files.list({
      q: `'${show.folderId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType, size)',
      orderBy: 'name',
      supportsAllDrives: true
    });

    const files = response.data.files;
    console.log(`  Found ${files.length} files in folder`);

    for (const file of files) {
      if (file.mimeType !== 'video/mp4') continue;

      const name = file.name;
      const match = name.match(show.namePattern);
      if (match) {
        const epNum = parseInt(match[1], 10);
        if (epNum >= 1 && epNum <= show.maxEpisodes) {
          // If duplicate, keep the larger file
          if (showCaches[showKey][epNum]) {
            const existingId = showCaches[showKey][epNum];
            // Keep existing (already loaded), skip duplicate
            // But prefer .mp4 files if they're larger
            if (name.endsWith('.mp4')) {
              showCaches[showKey][epNum] = file.id;
            }
            console.log(`  Episode ${epNum} -> ${file.id} (${name}) [duplicate kept ${name.endsWith('.mp4') ? 'mp4' : 'existing'}]`);
          } else {
            showCaches[showKey][epNum] = file.id;
            console.log(`  Episode ${epNum} -> ${file.id} (${name})`);
          }
        }
      }
    }

    showLoading[showKey] = false;
    console.log(`  Loaded ${Object.keys(showCaches[showKey]).length} episodes for "${show.name}"`);
  } catch (err) {
    showLoading[showKey] = false;
    console.error(`  Error loading files for "${show.name}":`, err.message);
  }

  return showCaches[showKey];
}

function buildEpisodeMetas(showKey) {
  const show = SHOWS[showKey];
  const episodes = showCaches[showKey] || {};
  var metas = [];
  for (var i = 1; i <= show.maxEpisodes; i++) {
    metas.push({
      id: showKey + '-' + i,
      type: 'movie',
      name: show.epNamePrefix + i,
      poster: show.poster
    });
  }
  return metas;
}

// === BUILD ADDON ===
const catalogs = [];
const idPrefixes = [];
for (const key of Object.keys(SHOWS)) {
  const show = SHOWS[key];
  catalogs.push({
    type: 'movie',
    id: show.catalogId,
    name: show.catalogName
  });
  idPrefixes.push(show.prefix);
}

const addon = new addonBuilder({
  id: 'local.network.arabic.cartoons',
  name: 'كرتون دريف - مدبلج',
  version: '2.0.0',
  description: 'كرتون عربي مدبلج من Google Drive - النمر المقنع، الفسحة، سنداد',
  logo: SHOWS['tiger-mask'].poster,
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie'],
  catalogs: catalogs,
  idPrefixes: idPrefixes
});

// === CATALOG HANDLER ===
addon.defineCatalogHandler(function(args) {
  for (const key of Object.keys(SHOWS)) {
    const show = SHOWS[key];
    if (args.type === 'movie' && args.id === show.catalogId) {
      // Load files if not loaded yet
      if (!showCaches[key] && drive) {
        loadFilesFromFolder(key);
      }
      return Promise.resolve({ metas: buildEpisodeMetas(key) });
    }
  }
  return Promise.resolve({ metas: [] });
});

// === META HANDLER ===
addon.defineMetaHandler(function(args) {
  if (args.type !== 'movie') return Promise.resolve({ meta: null });

  for (const key of Object.keys(SHOWS)) {
    const show = SHOWS[key];
    const prefix = show.prefix + '-';
    if (args.id.startsWith(prefix)) {
      const epNum = parseInt(args.id.substring(prefix.length), 10);
      if (epNum >= 1 && epNum <= show.maxEpisodes) {
        return Promise.resolve({
          meta: {
            id: args.id,
            type: 'movie',
            name: show.epNamePrefix + epNum,
            poster: show.poster,
            description: show.epMetaNamePrefix + epNum
          }
        });
      }
    }
  }
  return Promise.resolve({ meta: null });
});

// === STREAM HANDLER ===
addon.defineStreamHandler(function(args) {
  if (args.type !== 'movie') return Promise.resolve({ streams: [] });

  for (const key of Object.keys(SHOWS)) {
    const show = SHOWS[key];
    const prefix = show.prefix + '-';
    if (args.id.startsWith(prefix)) {
      const epNum = parseInt(args.id.substring(prefix.length), 10);

      if (epNum >= 1 && epNum <= show.maxEpisodes) {
        // Load files if not already loaded
        if (!showCaches[key] && drive) {
          loadFilesFromFolder(key);
        }

        var fileId = (showCaches[key] || {})[epNum];

        if (fileId && drive) {
          var proxyUrl = PUBLIC_URL + '/stream-proxy?id=' + fileId;
          return Promise.resolve({
            streams: [
              {
                title: show.epNamePrefix + epNum + ' (Google Drive)',
                url: proxyUrl
              }
            ]
          });
        }

        return Promise.resolve({
          streams: [
            {
              name: show.epNamePrefix + epNum,
              description: 'لم يتم إضافة رابط الفيديو لهذه الحلقة بعد',
              externalUrl: 'https://drive.google.com/'
            }
          ]
        });
      }
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
    return res.status(500).send('Google Drive not configured. Please set GDRIVE_CREDENTIALS.');
  }

  try {
    // Get an access token using the service account
    const client = await driveAuth.getClient();
    const accessToken = await client.getAccessToken();

    // Use Google Drive API to get a direct download URL
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
  const healthData = {
    status: 'ok',
    driveConfigured: !!drive,
    version: '2.0.0',
    shows: {}
  };

  for (const key of Object.keys(SHOWS)) {
    const show = SHOWS[key];
    healthData.shows[key] = {
      name: show.name,
      folderId: show.folderId,
      episodesLoaded: Object.keys(showCaches[key] || {}).length,
      loading: !!showLoading[key]
    };
  }

  res.json(healthData);
});

// Discovery endpoint - list files in all folders
app.get('/discover', async function(req, res) {
  if (!drive) return res.status(500).send('Drive not configured');

  const result = {};
  for (const key of Object.keys(SHOWS)) {
    const show = SHOWS[key];
    try {
      const response = await drive.files.list({
        q: `'${show.folderId}' in parents and trashed = false`,
        fields: 'files(id, name, mimeType, size)',
        orderBy: 'name',
        supportsAllDrives: true
      });

      result[key] = {
        name: show.name,
        files: response.data.files,
        count: response.data.files.length,
        episodes: showCaches[key] || {}
      };
    } catch (err) {
      result[key] = { error: err.message };
    }
  }

  res.json(result);
});

const addonRouter = getRouter(addon.getInterface());
app.use('/', addonRouter);

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log('Arabic Cartoons Addon v2.0.0 running on port ' + PORT);
  console.log('Public URL: ' + PUBLIC_URL);
  console.log('Drive configured: ' + !!drive);
  console.log('Shows: ' + Object.keys(SHOWS).join(', '));

  // Pre-load files from all folders
  if (drive) {
    for (const key of Object.keys(SHOWS)) {
      loadFilesFromFolder(key);
    }
  }
});
