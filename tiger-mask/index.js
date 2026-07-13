const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const POSTER = 'https://m.media-amazon.com/images/M/MV5BNTY5ZjJiMzItNGJiZi00YjJmLWE3NTMtZjY5Mjc0NjY0MzNkXkEyXkFqcGc@._V1_SX300.jpg';
const TOTAL_EPISODES = 33;
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://tiger-mask-arabic.onrender.com';

// Episode file IDs from Google Drive
// Format: episode number -> fileId
const EPISODES = {
  1: '1kKS_hJ-O0GPLpMV2lBPZIWLv1_uuInA7'
  // More episodes will be added as file IDs are provided
};

// Build the catalog (matching Conan format - no extra field, type: movie)
const CATALOG = {
  type: 'movie',
  id: 'tiger-mask-season-2',
  name: 'النمر المقنع - الجزء الثاني'
};

// Build metas for all episodes
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

// Catalog handler
addon.defineCatalogHandler(function(args) {
  if (args.type === 'movie' && args.id === 'tiger-mask-season-2') {
    return Promise.resolve({ metas: buildEpisodeMetas() });
  }
  return Promise.resolve({ metas: [] });
});

// Meta handler
addon.defineMetaHandler(function(args) {
  if (args.type === 'movie' && args.id.startsWith('tiger-mask-')) {
    var parts = args.id.split('-');
    var seasonNum = parseInt(parts[1], 10);
    var episodeNum = parseInt(parts[2], 10);
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

// Stream handler - uses Google Drive direct download URL with proxy
addon.defineStreamHandler(function(args) {
  if (args.type === 'movie' && args.id.startsWith('tiger-mask-')) {
    var parts = args.id.split('-');
    var episodeNum = parseInt(parts[2], 10);
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
    // Episode exists but no file ID yet
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

// Create Express app
const app = express();

// Video proxy for Google Drive direct download
app.get('/stream-proxy', function(req, res) {
  var fileId = req.query.id || '';
  if (!fileId) {
    res.status(400).send('Missing file ID');
    return;
  }

  var options = {
    hostname: 'drive.google.com',
    port: 443,
    path: '/uc?export=download&id=' + fileId,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Accept': 'video/*,*/*;q=0.8',
      'Accept-Encoding': 'identity',
      'Connection': 'keep-alive'
    }
  };

  if (req.headers.range) {
    options.headers['Range'] = req.headers.range;
  }

  var reqObj = https.get(options, function(proxyRes) {
    if (proxyRes.statusCode === 302 || proxyRes.statusCode === 301) {
      var redirectUrl = proxyRes.headers['location'];
      if (redirectUrl) {
        var redirectUrlObj = new URL(redirectUrl);
        var redirectOptions = {
          hostname: redirectUrlObj.hostname,
          port: redirectUrlObj.port || 443,
          path: redirectUrlObj.pathname + redirectUrlObj.search,
          method: 'GET',
          headers: {
            'User-Agent': options.headers['User-Agent'],
            'Accept': 'video/*,*/*;q=0.8',
            'Accept-Encoding': 'identity',
            'Connection': 'keep-alive',
            'Range': req.headers.range || 'bytes=0-'
          }
        };
        var redirectProtocol = redirectUrlObj.protocol === 'https:' ? https : http;
        redirectProtocol.get(redirectOptions, function(redirectRes) {
          streamVideo(redirectRes, res);
        }).on('error', function(e) {
          console.error('Redirect error:', e.message);
          res.status(502).send('Redirect failed: ' + e.message);
        });
        return;
      }
    }

    if (proxyRes.statusCode === 200 || proxyRes.statusCode === 206) {
      streamVideo(proxyRes, res);
      return;
    }

    res.status(proxyRes.statusCode || 502).send('Video unavailable (' + proxyRes.statusCode + ')');
  });

  reqObj.on('error', function(e) {
    console.error('Proxy error:', e.message);
    res.status(502).send('Bad Gateway: ' + e.message);
  });
  reqObj.setTimeout(120000, function() {
    reqObj.destroy();
    res.status(504).send('Gateway timeout');
  });
});

function streamVideo(proxyRes, res) {
  var headers = {};
  for (var key in proxyRes.headers) {
    if (key !== 'transfer-encoding' && key !== 'connection' && key !== 'set-cookie') {
      headers[key] = proxyRes.headers[key];
    }
  }
  headers['Access-Control-Allow-Origin'] = '*';
  headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Range, Accept, Content-Type';
  headers['Access-Control-Expose-Headers'] = 'Content-Range, Content-Length, Accept-Ranges, Content-Type';
  headers['Accept-Ranges'] = 'bytes';
  res.writeHead(proxyRes.statusCode, headers);
  proxyRes.pipe(res);
}

// Mount addon router
const addonRouter = getRouter(addon.getInterface());
app.use('/', addonRouter);

const PORT = process.env.PORT || 7000;
app.listen(PORT, function() {
  console.log('Tiger Mask Arabic Addon running on port ' + PORT);
  console.log('Manifest: http://localhost:' + PORT + '/manifest.json');
});
