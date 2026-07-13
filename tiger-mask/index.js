const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const { google } = require('googleapis');
const { URL } = require('url');
const https = require('https');

const PUBLIC_URL = process.env.PUBLIC_URL || 'https://tiger-mask-arabic.onrender.com';
const PARENT_FOLDER_ID = process.env.PARENT_FOLDER_ID || '12GroFa_NyHSsJIqsCWcJEcGdCcZrkfvB';

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

// === POSTER MAPPING ===
// Map cartoon folder names to poster URLs
const POSTER_MAP = {
  'النمر المقنع': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/LsuDmIaieeZCDhRi.jpg',
  'الفسحه': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/qgVOcbhqDJjjzZZl.png',
  'سندباد': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/yVqDPBalfuUdvGxD.jpg',
  'Tom & Jerry': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/GnURlTivfXkzZHtg.jpg',
  '«كونان»': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/euiWIKaqfflmdaJH.png',
  'اسطورة زورو': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/RHnlhRTqksDuSZrQ.jpg',
  'بوكيمون': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/MrCXyBcpoWZQDDGB.jpg',
  'تيمون و بومبا': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/GLdtyEmfYSmdYVLP.jpg',
  'حكايات عالميه': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/tuufXlZKldaVlwzo.jpg',
  'ساسوكي': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/EXUPPIBVFXRcHnna.jpg',
  'في جعبتي حكايه': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/rjYswUdsbNalKneX.png',
  'قصص بطوطية': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/UYUdWpKrUyLVlZij.png',
  'ليلو وستيتش': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/ViHccoocGpHJSasV.jpg',
  'ماروكو': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/pBkyctjkdTschpzj.jpg',
  'ماوكلي': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/vEcWBOqkTDaLKyfZ.jpg'
};

// Default poster for shows without a custom poster
const DEFAULT_POSTER = 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/UMHUCkbXOyARLRTx.jpg';

// === DYNAMIC SHOWS ===
// Shows will be auto-discovered from Google Drive parent folder
const SHOWS = {};
const showCaches = {};
const showLoading = {};
let showKeys = [];
let discoveryDone = false;

async function getFilesRecursive(folderId) {
  // Get files directly in this folder
  let files = [];
  try {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and mimeType = 'video/mp4' and trashed = false`,
      fields: 'files(id, name, mimeType, size)',
      orderBy: 'name',
      supportsAllDrives: true,
      pageSize: 500
    });
    files = response.data.files || [];
  } catch (err) {
    console.error(`  Error getting files from ${folderId}:`, err.message);
  }

  // Also get subfolders and recurse
  try {
    const folderResponse = await drive.files.list({
      q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
      supportsAllDrives: true
    });
    const subfolders = folderResponse.data.files || [];
    for (const sub of subfolders) {
      const subFiles = await getFilesRecursive(sub.id);
      files = files.concat(subFiles);
    }
  } catch (err) {
    console.error(`  Error getting subfolders from ${folderId}:`, err.message);
  }

  return files;
}

function extractEpisodeNumber(name) {
  // Try various Arabic and numeric patterns
  // Pattern 1: Arabic numerals (١, ٢, ٣...)
  const arabicMap = {'١':1,'٢':2,'٣':3,'٤':4,'٥':5,'٦':6,'٧':7,'٨':8,'٩':9,'٠':0};
  
  // Try "الحلقة X" or "الحلقه X" pattern
  const halqaMatch = name.match(/الحلق[هة]\s*([٠-٩]+)/);
  if (halqaMatch) {
    let num = '';
    for (const ch of halqaMatch[1]) {
      num += arabicMap[ch] || ch;
    }
    return parseInt(num);
  }

  // Try "X-" prefix pattern (like "1- title")
  const prefixMatch = name.match(/^(\d+)[\s-]/);
  if (prefixMatch) return parseInt(prefixMatch[1]);

  // Try pure number pattern
  const pureMatch = name.match(/^(\d+)(?:\.mp4)?$/);
  if (pureMatch) return parseInt(pureMatch[1]);

  return null;
}

function createShowKey(name) {
  // Create a URL-safe key from the Arabic folder name
  return name.toLowerCase()
    .replace(/[\s\-«»]/g, '')
    .replace(/[^a-z0-9\u0600-\u06FF]/g, '');
}

function slugify(name) {
  // Create a slug for the catalog ID
  return createShowKey(name).substring(0, 30);
}

async function discoverShows() {
  if (discoveryDone || !drive) return;
  discoveryDone = true;

  console.log(`=== Auto-discovering shows from parent folder: ${PARENT_FOLDER_ID} ===`);

  try {
    // Get all subfolders in the parent folder
    const response = await drive.files.list({
      q: `'${PARENT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name, mimeType)',
      orderBy: 'name',
      supportsAllDrives: true
    });

    const folders = response.data.files || [];
    console.log(`Found ${folders.length} subfolders`);

    for (const folder of folders) {
      const folderName = folder.name.trim();
      if (!folderName) continue;

      console.log(`\n📁 Discovering: ${folderName}`);
      const files = await getFilesRecursive(folder.id);
      console.log(`  Total files found: ${files.length}`);

      if (files.length === 0) {
        console.log(`  Skipping empty folder`);
        continue;
      }

      // Build episode map
      const episodeMap = {};
      for (const file of files) {
        const epNum = extractEpisodeNumber(file.name);
        if (epNum && epNum >= 1) {
          // Keep the largest file if duplicates exist
          if (episodeMap[epNum]) {
            const existing = files.find(f => f.id === episodeMap[epNum]);
            if (existing && existing.size > file.size) continue;
          }
          episodeMap[epNum] = file.id;
        }
      }

      const sortedEps = Object.keys(episodeMap).map(Number).sort((a, b) => a - b);
      const maxEp = sortedEps.length > 0 ? sortedEps[sortedEps.length - 1] : 0;

      const key = createShowKey(folderName);
      const slug = slugify(folderName);
      const poster = POSTER_MAP[folderName] || DEFAULT_POSTER;

      SHOWS[key] = {
        name: folderName,
        description: `كرتون ${folderName} مدبلج عربي - ${sortedEps.length} حلقة`,
        folderId: folder.id,
        poster: poster,
        prefix: slug,
        catalogId: slug + '-season-1',
        catalogName: folderName + ' - مدبلج',
        epNamePrefix: folderName + ' - الحلقة ',
        epMetaNamePrefix: `كرتون ${folderName} مدبلج عربي - الحلقة `,
        maxEpisodes: maxEp,
        allEpisodes: sortedEps,
        episodeMap: episodeMap,
        episodeCount: sortedEps.length
      };

      showCaches[key] = episodeMap;
      showKeys.push(key);

      console.log(`  ✅ Key: ${key}, Episodes: ${sortedEps.length}, Max: ${maxEp}`);
    }

    console.log(`\n=== Discovery complete: ${showKeys.length} shows found ===`);
  } catch (err) {
    console.error('Discovery error:', err.message);
  }
}

// === BUILD ADDON (will be updated after discovery) ===
let addon = null;
let catalogs = [];
let idPrefixes = [];

function buildAddon() {
  catalogs = [];
  idPrefixes = [];
  for (const key of showKeys) {
    const show = SHOWS[key];
    catalogs.push({
      type: 'movie',
      id: show.catalogId,
      name: show.catalogName
    });
    idPrefixes.push(show.prefix);
  }

  addon = new addonBuilder({
    id: 'local.network.arabic.cartoons',
    name: 'كرتون دريف - مدبلج',
    version: '4.0.0',
    description: `كرتون عربي مدبلج من Google Drive - ${showKeys.length} كارتون`,
    logo: POSTER_MAP['النمر المقنع'] || DEFAULT_POSTER,
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie'],
    catalogs: catalogs,
    idPrefixes: idPrefixes
  });

  // Rebind handlers
  addon.defineCatalogHandler(catalogHandler);
  addon.defineMetaHandler(metaHandler);
  addon.defineStreamHandler(streamHandler);
}

// === CATALOG HANDLER ===
function catalogHandler(args) {
  if (!addon) return Promise.resolve({ metas: [] });
  
  for (const key of showKeys) {
    const show = SHOWS[key];
    if (args.type === 'movie' && args.id === show.catalogId) {
      const metas = [];
      for (const epNum of show.allEpisodes) {
        metas.push({
          id: show.prefix + '-' + epNum,
          type: 'movie',
          name: show.epNamePrefix + epNum,
          poster: show.poster
        });
      }
      return Promise.resolve({ metas: metas });
    }
  }
  return Promise.resolve({ metas: [] });
}

// === META HANDLER ===
function metaHandler(args) {
  if (!addon || args.type !== 'movie') return Promise.resolve({ meta: null });

  for (const key of showKeys) {
    const show = SHOWS[key];
    const prefix = show.prefix + '-';
    if (args.id.startsWith(prefix)) {
      const epNum = parseInt(args.id.substring(prefix.length), 10);
      if (show.allEpisodes.includes(epNum)) {
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
}

// === STREAM HANDLER ===
function streamHandler(args) {
  if (!addon || args.type !== 'movie') return Promise.resolve({ streams: [] });

  for (const key of showKeys) {
    const show = SHOWS[key];
    const prefix = show.prefix + '-';
    if (args.id.startsWith(prefix)) {
      const epNum = parseInt(args.id.substring(prefix.length), 10);
      const fileId = show.episodeMap[epNum];

      if (fileId && drive) {
        return Promise.resolve({
          streams: [
            {
              title: show.epNamePrefix + epNum + ' (Google Drive)',
              url: PUBLIC_URL + '/stream-proxy?id=' + fileId
            }
          ]
        });
      }
    }
  }
  return Promise.resolve({ streams: [] });
}

// === ROUTES ===
const app = express();

// Stream proxy using Google Drive API (secure, bypasses virus scan)
app.get('/stream-proxy', async function(req, res) {
  const fileId = req.query.id;
  if (!fileId) return res.status(400).send('Missing file ID');

  if (!drive) {
    return res.status(500).send('Google Drive not configured. Please set GDRIVE_CREDENTIALS.');
  }

  try {
    const client = await driveAuth.getClient();
    const accessToken = await client.getAccessToken();

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
    parentFolderId: PARENT_FOLDER_ID,
    version: '4.0.0',
    shows: {}
  };

  for (const key of showKeys) {
    const show = SHOWS[key];
    healthData.shows[key] = {
      name: show.name,
      folderId: show.folderId,
      episodesLoaded: show.episodeCount,
      catalogName: show.catalogName
    };
  }

  res.json(healthData);
});

// Discovery endpoint
app.get('/discover', async function(req, res) {
  if (!drive) return res.status(500).send('Drive not configured');

  // Trigger fresh discovery
  discoveryDone = false;
  showKeys = [];
  Object.keys(SHOWS).forEach(k => delete SHOWS[k]);
  Object.keys(showCaches).forEach(k => delete showCaches[k]);

  await discoverShows();
  buildAddon();

  const result = {};
  for (const key of showKeys) {
    const show = SHOWS[key];
    result[key] = {
      name: show.name,
      folderId: show.folderId,
      episodes: show.episodeCount,
      catalogName: show.catalogName
    };
  }

  res.json(result);
});

// Mount addon router (placeholder until discovery)
app.use('/', function(req, res, next) {
  if (addon) {
    const router = getRouter(addon.getInterface());
    router(req, res, next);
  } else {
    res.json({ error: 'Discovery in progress, please wait' });
  }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, async () => {
  console.log('Arabic Cartoons Addon v4.0.0 running on port ' + PORT);
  console.log('Public URL: ' + PUBLIC_URL);
  console.log('Parent Folder: ' + PARENT_FOLDER_ID);
  console.log('Drive configured: ' + !!drive);

  // Auto-discover and build addon
  if (drive) {
    await discoverShows();
    buildAddon();
    console.log(`Addon ready with ${showKeys.length} cartoons!`);
  }
});
