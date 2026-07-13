const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const POSTER = 'https://m.media-amazon.com/images/M/MV5BNTY5ZjJiMzItNGJiZi00YjJmLWE3NTMtZjY5Mjc0NjY0MzNkXkEyXkFqcGc@._V1_SX300.jpg';
const TOTAL_EPISODES = 33;
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://tiger-mask-arabic.onrender.com';

const EPISODES = {
  1: '1kKS_hJ-O0GPLpMV2lBPZIWLv1_uuInA7'
};

const CATALOG = {
  type: 'movie',
  id: 'tiger-mask-season-2',
  name: 'النمر المقنع - الجزء الثاني'
};

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
  version: '1.0.0',
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
    var fileId = EPISODES[episodeNum];
    if (episodeNum >= 1 && episodeNum <= TOTAL_EPISODES && fileId) {
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
    if (episodeNum >= 1 && episodeNum <= TOTAL_EPISODES) {
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

app.get('/stream-proxy', function(req, res) {
  const fileId = req.query.id;
  if (!fileId) return res.status(400).send('Missing file ID');

  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  // 1. First request to get cookies and potential confirmation token
  const driveUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  
  https.get(driveUrl, { headers: { 'User-Agent': userAgent } }, (driveRes) => {
    const cookies = driveRes.headers['set-cookie'] || [];
    let body = '';
    driveRes.on('data', chunk => body += chunk);
    driveRes.on('end', () => {
      // Check for confirmation token
      const confirmMatch = body.match(/confirm=([a-zA-Z0-9_]+)/);
      const confirmToken = confirmMatch ? confirmMatch[1] : '';
      
      let finalUrl;
      if (confirmToken) {
        finalUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=${confirmToken}`;
      } else if (driveRes.headers.location) {
        finalUrl = driveRes.headers.location;
      } else {
        finalUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download`;
      }

      handleFinalStream(finalUrl, cookies, req, res, userAgent);
    });
  }).on('error', err => {
    res.status(500).send('Initial proxy error: ' + err.message);
  });
});

function handleFinalStream(url, cookies, req, res, userAgent) {
  const urlObj = new URL(url.startsWith('http') ? url : 'https://drive.google.com' + url);
  const options = {
    hostname: urlObj.hostname,
    port: 443,
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
    headers: {
      'User-Agent': userAgent,
      'Cookie': cookies.join('; '),
      'Range': req.headers.range || 'bytes=0-'
    }
  };

  https.get(options, (proxyRes) => {
    if (proxyRes.statusCode === 302 || proxyRes.statusCode === 301) {
      const newCookies = (proxyRes.headers['set-cookie'] || []).concat(cookies);
      handleFinalStream(proxyRes.headers.location, newCookies, req, res, userAgent);
      return;
    }

    const headers = {};
    for (const key in proxyRes.headers) {
      if (!['transfer-encoding', 'connection', 'set-cookie', 'content-security-policy'].includes(key)) {
        headers[key] = proxyRes.headers[key];
      }
    }
    headers['Access-Control-Allow-Origin'] = '*';
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  }).on('error', err => {
    res.status(500).send('Stream error: ' + err.message);
  });
}

const addonRouter = getRouter(addon.getInterface());
app.use('/', addonRouter);

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log('Tiger Mask Arabic Addon running on port ' + PORT);
});
