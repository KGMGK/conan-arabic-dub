const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const { google } = require('googleapis');
const { URL } = require('url');
const https = require('https');

const PUBLIC_URL = process.env.PUBLIC_URL || 'https://tiger-mask-arabic.onrender.com';
const PARENT_FOLDER_ID = process.env.PARENT_FOLDER_ID || '12GroFa_NyHSsJIqsCWcJEcGdCcZrkfvB';

const GDRIVE_CREDENTIALS = process.env.GDRIVE_CREDENTIALS
  ? JSON.parse(process.env.GDRIVE_CREDENTIALS)
  : null;

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
const POSTER_MAP = {
  'النمر المقنع': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/LsuDmIaieeZCDhRi.jpg',
  'الفسحه': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/qgVOcbhqDJjjzZZl.png',
  'سندباد': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/yVqDPBalfuUdvGxD.jpg',
  'Tom & Jerry': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/GnURlTivfXkzZHtg.jpg',
  'كونان': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/euiWIKaqfflmdaJH.png',
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

const DEFAULT_POSTER = 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/GnURlTivfXkzZHtg.jpg';

// === SHOW META INFO ===
const SHOW_META = {
  'النمر المقنع': { description: 'النمر المقنع هو مسلسل أنمي ياباني، يروي قصة شقيقين يتصارعان ضد الشر.', genres: ['Animation', 'Action', 'Adventure'] },
  'الفسحه': { description: 'الفسحة هو مسلسل كرتوني كوميدي أمريكي عن مغامرات مجموعة أطفال.', genres: ['Animation', 'Comedy'] },
  'سندباد': { description: 'سندباد هو مسلسل كرتوني مغامرات يروي قصص البحار سندباد.', genres: ['Animation', 'Adventure'] },
  'Tom & Jerry': { description: 'توم وجيري هو مسلسل كرتوني كوميدي كلاسيكي عن القط والفأر.', genres: ['Animation', 'Comedy', 'Family'] },
  'كونان': { description: 'المحقق كونان هو أنمي ياباني يتابع تحقيقات المحقق الصغير.', genres: ['Animation', 'Mystery', 'Thriller'] },
  '«كونان»': { description: 'المحقق كونان هو أنمي ياباني يتابع تحقيقات المحقق الصغير.', genres: ['Animation', 'Mystery', 'Thriller'] },
  'اسطورة زورو': { description: 'اسطورة زورو هو مسلسل يروي مغامرات البطل المقنع زورو.', genres: ['Animation', 'Action', 'Adventure'] },
  'بوكيمون': { description: 'بوكيمون هو أنمي شهير يتابع مغامرات أش وأصدقائه في عالم البوكيمون.', genres: ['Animation', 'Adventure', 'Fantasy'] },
  'تيمون و بومبا': { description: 'تيمون وبومبا هو مسلسل كرتوني ديزني عن مغامرات الثنائي الشهير.', genres: ['Animation', 'Comedy', 'Family'] },
  'حكايات عالميه': { description: 'حكايات عالمية هي سلسلة قصص من الأدب العالمي بشكل كرتوني.', genres: ['Animation', 'Family', 'Fantasy'] },
  'ساسوكي': { description: 'ساسوكي هو مسلسل كرتوني ياباني عن محارب شاب.', genres: ['Animation', 'Action', 'Adventure'] },
  'في جعبتي حكايه': { description: 'في جعبتي حكاية هو مسلسل كرتوني يحكي قصصاً خيالية.', genres: ['Animation', 'Family', 'Fantasy'] },
  'قصص بطوطية': { description: 'قصص بطوطية هي مسلسل ديزني يحكي مغامرات بطوط.', genres: ['Animation', 'Comedy', 'Family'] },
  'ليلو وستيتش': { description: 'ليلو وستيتش هو مسلسل ديزني عن فتاة هاوايية وصديقها ستيتش.', genres: ['Animation', 'Comedy', 'Family'] },
  'ماروكو': { description: 'تشيبى ماروكو-تشان هو أنمي ياباني كوميدي عن حياة الطفلة ماروكو.', genres: ['Animation', 'Comedy'] },
  'ماوكلي': { description: 'ماوكلي هو أنمي مستوحى من كتاب الأدغال عن فتى نشأ بين الحيوانات.', genres: ['Animation', 'Adventure', 'Family'] }
};

// === HELPERS ===
function extractEpisodeNumber(name) {
  const arabicMap = {'١':1,'٢':2,'٣':3,'٤':4,'٥':5,'٦':6,'٧':7,'٨':8,'٩':9,'٠':0};
  const halqaMatch = name.match(/الحلق[هة]\s*([٠-٩]+)/);
  if (halqaMatch) {
    let num = '';
    for (const ch of halqaMatch[1]) num += arabicMap[ch] || ch;
    return parseInt(num);
  }
  const prefixMatch = name.match(/^(\d+)[\s-]/);
  if (prefixMatch) return parseInt(prefixMatch[1]);
  const pureMatch = name.match(/^(\d+)(?:\.mp4)?$/);
  if (pureMatch) return parseInt(pureMatch[1]);
  return null;
}

const ARABIC_TO_ASCII = {
  'النمر المقنع': 'tiger-mask',
  'الفسحه': 'fosha',
  'سندباد': 'sinbad',
  'Tom & Jerry': 'tomjerry',
  'كونان': 'conan',
  '«كونان»': 'conan',
  'اسطورة زورو': 'zorro',
  'بوكيمون': 'pokemon',
  'تيمون و بومبا': 'timon-pumbaa',
  'حكايات عالميه': 'global-tales',
  'ساسوكي': 'sasuke',
  'في جعبتي حكايه': 'my-story',
  'قصص بطوطية': 'duck-tales',
  'ليلو وستيتش': 'lilo-stitch',
  'ماروكو': 'maruko',
  'ماوكلي': 'mowgli'
};

function createShowKey(name) {
  if (ARABIC_TO_ASCII[name]) return ARABIC_TO_ASCII[name];
  return name.toLowerCase()
    .replace(/[\s\-«»]/g, '')
    .replace(/[\u0627]/g, 'a').replace(/[\u0628]/g, 'b').replace(/[\u062a\u062b]/g, 't')
    .replace(/[\u062c\u062d\u062e]/g, 'j').replace(/[\u062f\u0630]/g, 'd')
    .replace(/[\u0631\u0632\u0633\u0634]/g, 's').replace(/[\u0635\u0636\u0637\u0638]/g, 'z')
    .replace(/[\u0639]/g, 'a').replace(/[\u063a\u0641]/g, 'f')
    .replace(/[\u0642\u0643]/g, 'k').replace(/[\u0644]/g, 'l')
    .replace(/[\u0645]/g, 'm').replace(/[\u0646]/g, 'n')
    .replace(/[\u0647\u0629]/g, 'h').replace(/[\u0648]/g, 'w')
    .replace(/[\u064a\u0649]/g, 'y').replace(/[\u0621]/g, 'a')
    .replace(/[^a-z0-9]/g, '');
}

// === DYNAMIC SHOWS ===
const SHOWS = {};
let showKeys = [];
let discoveryDone = false;

async function getFilesRecursive(folderId) {
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

async function discoverShows() {
  if (discoveryDone || !drive) return;
  discoveryDone = true;
  console.log(`=== Auto-discovering shows from parent folder: ${PARENT_FOLDER_ID} ===`);
  try {
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
      const episodeMap = {};
      for (const file of files) {
        const epNum = extractEpisodeNumber(file.name);
        if (epNum && epNum >= 1) {
          if (episodeMap[epNum]) {
            const existing = files.find(f => f.id === episodeMap[epNum]);
            if (existing && existing.size > file.size) continue;
          }
          episodeMap[epNum] = file.id;
        }
      }
      const sortedEps = Object.keys(episodeMap).map(Number).sort((a, b) => a - b);
      const key = createShowKey(folderName);
      const poster = POSTER_MAP[folderName] || DEFAULT_POSTER;
      const metaInfo = SHOW_META[folderName] || {
        description: `كرتون ${folderName} مدبلج عربي`,
        genres: ['Animation']
      };
      SHOWS[key] = {
        name: folderName,
        folderId: folder.id,
        poster: poster,
        prefix: key,
        metaInfo: metaInfo,
        allEpisodes: sortedEps,
        episodeMap: episodeMap,
        totalEpisodes: sortedEps.length
      };
      showKeys.push(key);
      console.log(`  ✅ Key: ${key}, Episodes: ${sortedEps.length}`);
    }
    // Normalize key to conan if it's kwnan (guillemet issue)
    if ('kwnan' in SHOWS) {
      SHOWS['conan'] = SHOWS['kwnan'];
      delete SHOWS['kwnan'];
      showKeys = showKeys.map(k => k === 'kwnan' ? 'conan' : k);
      console.log('  🔧 Normalized kwnan -> conan');
    }
    console.log(`\n=== Discovery complete: ${showKeys.length} shows found ===`);
  } catch (err) {
    console.error('Discovery error:', err.message);
  }
}

// === BUILD ADDON ===
let addon = null;
let catalogs = [];

function buildAddon() {
  // Build 15 separate catalogs (one per show) - this is what v7.0.0 used
  catalogs = [];
  for (const key of showKeys) {
    const show = SHOWS[key];
    catalogs.push({
      type: 'series',
      id: key,
      name: show.name + ' - مدبلج'
    });
  }
  addon = new addonBuilder({
    id: 'local.network.arabic.cartoons',
    name: 'Arabic Cartoons Drive',
    version: '9.0.0',
    description: `Arabic dubbed cartoons from Google Drive - ${showKeys.length} shows`,
    logo: POSTER_MAP['النمر المقنع'] || DEFAULT_POSTER,
    resources: ['catalog', 'meta', 'stream'],
    types: ['series'],
    catalogs: catalogs,
    idPrefixes: showKeys
  });
  addon.defineCatalogHandler(catalogHandler);
  addon.defineMetaHandler(metaHandler);
  addon.defineStreamHandler(streamHandler);
}

// === CATALOG HANDLER ===
// IMPORTANT: Return ONLY lightweight meta (id, type, name, poster) WITHOUT videos
// Vidi will call meta handler separately when user clicks on a show
function catalogHandler(args) {
  if (!addon) return Promise.resolve({ metas: [] });
  for (const key of showKeys) {
    const show = SHOWS[key];
    if (args.type === 'series' && args.id === key) {
      // Return ONE lightweight meta per catalog - NO videos array
      return Promise.resolve({
        metas: [{
          id: key,
          type: 'series',
          name: show.name,
          poster: show.poster,
          description: show.metaInfo.description,
          genres: show.metaInfo.genres,
          year: 2024
        }]
      });
    }
  }
  return Promise.resolve({ metas: [] });
}

// === META HANDLER ===
// Return full series details WITH videos when user clicks on a show
function metaHandler(args) {
  if (!addon || args.type !== 'series') return Promise.resolve({ meta: null });
  for (const key of showKeys) {
    const show = SHOWS[key];
    if (args.id === key) {
      const videos = [];
      for (const epNum of show.allEpisodes) {
        videos.push({
          id: key + ':' + epNum + ':1',
          title: show.name + ' - الحلقة ' + epNum,
          episode: epNum,
          season: 1,
          released: new Date(2024, 0, 1).toISOString()
        });
      }
      return Promise.resolve({
        meta: {
          id: key,
          type: 'series',
          name: show.name,
          poster: show.poster,
          description: show.metaInfo.description,
          genres: show.metaInfo.genres,
          year: 2024,
          videos: videos
        }
      });
    }
  }
  return Promise.resolve({ meta: null });
}

// === STREAM HANDLER ===
// Video ID format: key:episode:1 (matches meta handler video IDs)
function streamHandler(args) {
  if (!addon) return Promise.resolve({ streams: [] });
  // Try matching key:episode:1 format
  for (const key of showKeys) {
    const show = SHOWS[key];
    if (args.id && args.id.startsWith(key + ':')) {
      const parts = args.id.split(':');
      if (parts.length === 3) {
        const epNum = parseInt(parts[1]);
        if (show.episodeMap[epNum] && drive) {
          const fileId = show.episodeMap[epNum];
          return Promise.resolve({
            streams: [{
              title: show.name + ' - الحلقة ' + epNum + ' (Google Drive)',
              url: PUBLIC_URL + '/stream-proxy?id=' + fileId
            }]
          });
        }
      }
    }
  }
  return Promise.resolve({ streams: [] });
}

// === ROUTES ===
const app = express();

app.get('/', function(req, res) {
  res.send(buildLandingPage());
});

function buildLandingPage() {
  let showCards = '';
  for (const key of showKeys) {
    const show = SHOWS[key];
    showCards += `
      <div class="show-card">
        <img src="${show.poster}" alt="${show.name}" loading="lazy">
        <div class="show-info">
          <h3>${show.name}</h3>
          <p>${show.totalEpisodes} حلقة</p>
          <p class="genre">${(show.metaInfo.genres || []).join(' • ')}</p>
        </div>
      </div>`;
  }
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>كرتون دريف - مدبلج</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background: #0a0a0a; color: #fff; direction: rtl; }
    .header { background: linear-gradient(135deg, #1a1a2e, #16213e); padding: 40px 20px; text-align: center; border-bottom: 2px solid #e94560; }
    .header h1 { font-size: 2.5em; margin-bottom: 10px; color: #e94560; }
    .header p { font-size: 1.2em; color: #aaa; margin-bottom: 20px; }
    .addon-links { display: flex; gap: 15px; justify-content: center; flex-wrap: wrap; }
    .addon-links a { background: #e94560; color: white; padding: 12px 25px; border-radius: 8px; text-decoration: none; font-weight: bold; transition: background 0.3s; }
    .addon-links a:hover { background: #c73e54; }
    .addon-links a.secondary { background: #16213e; border: 1px solid #e94560; }
    .container { max-width: 1200px; margin: 0 auto; padding: 30px 20px; }
    .shows-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 20px; }
    .show-card { background: #1a1a2e; border-radius: 12px; overflow: hidden; transition: transform 0.3s, box-shadow 0.3s; }
    .show-card:hover { transform: translateY(-5px); box-shadow: 0 10px 30px rgba(233,69,96,0.2); }
    .show-card img { width: 100%; aspect-ratio: 2/3; object-fit: cover; }
    .show-info { padding: 12px; }
    .show-info h3 { font-size: 0.95em; margin-bottom: 5px; color: #fff; }
    .show-info p { font-size: 0.85em; color: #aaa; }
    .show-info .genre { font-size: 0.75em; color: #e94560; margin-top: 5px; }
    .stats { text-align: center; padding: 20px; color: #666; font-size: 0.9em; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🎬 كرتون دريف - مدبلج</h1>
    <p>كرتون عربي مدبلج من Google Drive - ${showKeys.length} كارتون</p>
    <div class="addon-links">
      <a href="https://tiger-mask-arabic.onrender.com/manifest.json" target="_blank">📺 إضافة لـ Stremio</a>
      <a href="vidi://tiger-mask-arabic.onrender.com/manifest.json" class="secondary">📱 إضافة لـ Vidi</a>
    </div>
  </div>
  <div class="container">
    <div class="shows-grid">${showCards}</div>
    <div class="stats">الإصدار: v9.0.0 | الكارتونات: ${showKeys.length}</div>
  </div>
</body>
</html>`;
}

app.options('/stream-proxy', function(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Range, Accept, Content-Type, Authorization');
  res.set('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Type');
  res.set('Accept-Ranges', 'bytes');
  res.status(204).end();
});

app.options('*', function(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Range, Accept, Content-Type, Authorization');
  res.status(204).end();
});

app.get('/stream-proxy', async function(req, res) {
  const fileId = req.query.id;
  if (!fileId) return res.status(400).send('Missing file ID');
  if (!drive) return res.status(500).send('Google Drive not configured.');
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Range': req.headers.range || 'bytes=0-'
      }
    };
    const proxyReq = https.get(options, (proxyRes) => {
      if (proxyRes.statusCode === 403 || proxyRes.statusCode === 404) {
        drive.files.get({ fileId, fields: 'webContentLink', supportsAllDrives: true }, function(err, fileResult) {
          if (err || !fileResult.data.webContentLink) return res.status(500).send('Unable to access file');
          const fallbackObj = new URL(fileResult.data.webContentLink);
          https.get({
            hostname: fallbackObj.hostname, port: fallbackObj.port || 443,
            path: fallbackObj.pathname + fallbackObj.search, method: 'GET',
            headers: { 'Authorization': 'Bearer ' + accessToken.token, 'User-Agent': 'Mozilla/5.0', 'Range': req.headers.range || 'bytes=0-' }
          }, (fallbackRes) => handleStreamResponse(fallbackRes, req, res)).on('error', err => res.status(500).send(err.message));
        });
        return;
      }
      handleStreamResponse(proxyRes, req, res);
    });
    proxyReq.on('error', err => res.status(500).send(err.message));
  } catch (err) { res.status(500).send(err.message); }
});

function handleStreamResponse(proxyRes, req, res) {
  const headers = {};
  for (const key in proxyRes.headers) {
    if (!['transfer-encoding', 'connection', 'set-cookie', 'content-security-policy'].includes(key)) headers[key] = proxyRes.headers[key];
  }
  headers['Access-Control-Allow-Origin'] = '*';
  if (proxyRes.headers['content-range']) { headers['Content-Range'] = proxyRes.headers['content-range']; headers['Accept-Ranges'] = 'bytes'; }
  res.writeHead(proxyRes.statusCode, headers);
  proxyRes.pipe(res);
}

app.get('/health', function(req, res) {
  const healthData = { status: 'ok', driveConfigured: !!drive, parentFolderId: PARENT_FOLDER_ID, version: '9.0.0', type: 'series', shows: {} };
  for (const key of showKeys) {
    const show = SHOWS[key];
    healthData.shows[key] = { name: show.name, folderId: show.folderId, episodesLoaded: show.totalEpisodes };
  }
  res.json(healthData);
});

app.get('/discover', async function(req, res) {
  if (!drive) return res.status(500).send('Drive not configured');
  discoveryDone = false; showKeys = []; Object.keys(SHOWS).forEach(k => delete SHOWS[k]);
  await discoverShows(); buildAddon();
  const result = {};
  for (const key of showKeys) { const show = SHOWS[key]; result[key] = { name: show.name, episodes: show.totalEpisodes }; }
  res.json(result);
});

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
  console.log('Arabic Cartoons Addon v9.0.0 (Catalog without videos) running on port ' + PORT);
  console.log('Public URL: ' + PUBLIC_URL);
  console.log('Parent Folder: ' + PARENT_FOLDER_ID);
  console.log('Drive configured: ' + !!drive);
  if (drive) {
    await discoverShows();
    buildAddon();
    console.log(`Addon ready with ${showKeys.length} cartoons!`);
  }
});
