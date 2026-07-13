const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const POSTER = 'https://m.media-amazon.com/images/M/MV5BNTY5ZjJiMzItNGJiZi00YjJmLWE3NTMtZjY5Mjc0NjY0MzNkXkEyXkFqcGc@._V1_SX300.jpg';
const TMDB_ID = '25114';
const SEASON_NUM = 2; // Tiger Mask II (1981) = the Arabic dub
const TOTAL_EPISODES = 33;
const SERVICE_NAME = 'tiger-mask-arabic';
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://tiger-mask-arabic.onrender.com';

// Episode file IDs from Google Drive
// Format: episode number -> { fileId, name }
const EPISODES = {
  1: {
    fileId: '1kKS_hJ-O0GPLpMV2lBPZIWLv1_uuInA7',
    name: 'أغنية البداية'
  }
  // More episodes will be added as file IDs are provided
};

// Build the catalog
const CATALOG = {
  type: 'series',
  id: SERVICE_NAME + '-season-' + SEASON_NUM,
  name: 'النمر المقنع الجزء الثاني',
  extra: []
};

// Build metas for all episodes
function buildEpisodeMetas() {
  var metas = [];
  for (var i = 1; i <= TOTAL_EPISODES; i++) {
    var ep = EPISODES[i];
    var name = 'النمر المقنع مدبلج - الحلقة ' + i;
    if (ep) {
      name = 'النمر المقنع مدبلج - ' + ep.name;
    }
    metas.push({
      id: SERVICE_NAME + '-' + i,
      type: 'series',
      name: name,
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
  types: ['series'],
  catalogs: [CATALOG],
  idPrefixes: ['tiger-mask-arabic-']
});

// Catalog handler - returns all episodes
addon.defineCatalogHandler(function(args) {
  if (args.type === 'series' && args.id === SERVICE_NAME + '-season-' + SEASON_NUM) {
    return Promise.resolve({ metas: buildEpisodeMetas() });
  }
  return Promise.resolve({ metas: [] });
});

// Meta handler - returns info for a specific episode
addon.defineMetaHandler(function(args) {
  if (args.type === 'series' && args.id.startsWith(SERVICE_NAME + '-')) {
    var epNum = parseInt(args.id.split('-').pop(), 10);
    if (epNum >= 1 && epNum <= TOTAL_EPISODES) {
      var ep = EPISODES[epNum];
      var name = 'النمر المقنع مدبلج - الحلقة ' + epNum;
      if (ep) {
        name = 'النمر المقنع مدبلج - ' + ep.name;
      }
      return Promise.resolve({
        meta: {
          id: args.id,
          type: 'series',
          name: name,
          poster: POSTER,
          description: 'النمر المقنع (Tiger Mask II) - الجزء الثاني مدبلج عربي - الحلقة ' + epNum,
          releaseInfo: 'الحلقة ' + epNum,
          year: 1981
        }
      });
    }
  }
  return Promise.resolve({ meta: null });
});

// Stream handler - returns the video stream for an episode
addon.defineStreamHandler(function(args) {
  if (args.type === 'series' && args.id.startsWith(SERVICE_NAME + '-')) {
    var epNum = parseInt(args.id.split('-').pop(), 10);
    var ep = EPISODES[epNum];
    if (epNum >= 1 && epNum <= TOTAL_EPISODES && ep) {
      var driveUrl = 'https://drive.google.com/file/d/' + ep.fileId + '/preview';
      var proxyUrl = '/stream-proxy?url=' + encodeURIComponent(driveUrl);
      var fullName = 'النمر المقنع مدبلج - الحلقة ' + epNum + ' - ' + ep.name;
      return Promise.resolve({
        streams: [
          {
            title: fullName,
            url: PUBLIC_URL + proxyUrl
          }
        ]
      });
    }
    // Episode exists but no file ID yet
    if (epNum >= 1 && epNum <= TOTAL_EPISODES) {
      return Promise.resolve({
        streams: [
          {
            name: 'النمر المقنع - الحلقة ' + epNum,
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

// Video proxy for Google Drive
app.get('/stream-proxy', function(req, res) {
  var rawUrl = decodeURIComponent(req.query.url || '');
  var targetUrl = rawUrl;
  
  if (!targetUrl) {
    res.status(400).send('Missing URL');
    return;
  }
  
  try {
    var targetUrlObj = new URL(targetUrl);
  } catch (e) {
    res.status(400).send('Invalid URL');
    return;
  }
  
  var protocol = targetUrlObj.protocol === 'https:' ? https : http;
  var options = {
    hostname: targetUrlObj.hostname,
    port: targetUrlObj.port || (targetUrlObj.protocol === 'https:' ? 443 : 80),
    path: targetUrlObj.pathname + targetUrlObj.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
      'Accept-Encoding': 'identity',
      'Connection': 'keep-alive'
    }
  };
  
  var reqObj = protocol.get(options, function(proxyRes) {
    if (proxyRes.statusCode === 302 || proxyRes.statusCode === 301) {
      var redirectUrl = proxyRes.headers['location'];
      if (redirectUrl) {
        if (redirectUrl.startsWith('/')) {
          redirectUrl = targetUrlObj.protocol + '//' + targetUrlObj.hostname + redirectUrl;
        }
        var redirectUrlObj = new URL(redirectUrl);
        var redirectOptions = {
          hostname: redirectUrlObj.hostname,
          port: redirectUrlObj.port || (redirectUrlObj.protocol === 'https:' ? 443 : 80),
          path: redirectUrlObj.pathname + redirectUrlObj.search,
          method: 'GET',
          headers: Object.assign({}, options.headers, {
            'Accept': 'video/*,*/*;q=0.8'
          })
        };
        if (req.headers.range) {
          redirectOptions.headers['Range'] = req.headers.range;
        }
        var redirectProtocol = redirectUrlObj.protocol === 'https:' ? https : http;
        redirectProtocol.get(redirectOptions, function(redirectRes) {
          streamVideo(redirectRes, res);
        }).on('error', function(e) {
          console.error('Redirect error:', e.message);
          res.status(502).send('Redirect failed');
        });
        return;
      }
    }
    
    if (proxyRes.statusCode === 200) {
      var body = '';
      proxyRes.setEncoding('utf8');
      proxyRes.on('data', function(chunk) {
        body += chunk;
      });
      proxyRes.on('end', function() {
        // Look for video URL in the preview page
        var videoMatch = body.match(/"contentUrl":"([^"]+)"/);
        if (videoMatch) {
          var videoUrl = videoMatch[1];
          // Proxy the actual video
          var videoUrlObj = new URL(videoUrl);
          var videoOptions = {
            hostname: videoUrlObj.hostname,
            port: videoUrlObj.port || (videoUrlObj.protocol === 'https:' ? 443 : 80),
            path: videoUrlObj.pathname + videoUrlObj.search,
            method: 'GET',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
              'Accept': 'video/*,*/*;q=0.8',
              'Accept-Encoding': 'identity',
              'Connection': 'keep-alive'
            }
          };
          if (req.headers.range) {
            videoOptions.headers['Range'] = req.headers.range;
          }
          var videoProtocol = videoUrlObj.protocol === 'https:' ? https : http;
          videoProtocol.get(videoOptions, function(videoRes) {
            streamVideo(videoRes, res);
          }).on('error', function(e) {
            console.error('Video proxy error:', e.message);
            res.status(502).send('Video proxy failed');
          });
        } else {
          res.status(502).send('Could not find video URL in preview page');
        }
      });
      return;
    }
    
    if (proxyRes.statusCode !== 200 && proxyRes.statusCode !== 206) {
      res.status(proxyRes.statusCode).send('Video unavailable (' + proxyRes.statusCode + ')');
      return;
    }
    streamVideo(proxyRes, res);
  });
  
  reqObj.on('error', function(e) {
    console.error('Proxy error:', e.message);
    res.status(502).send('Bad Gateway: ' + e.message);
  });
  reqObj.setTimeout(60000, function() {
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
