const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const BASE_URL = 'https://www.ccdko80.com/get_video.php?videos=';
const POSTER = 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/VfLdyQfallyxvWMo.jpg';
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://conan-arabic-dub.onrender.com';
const SEASONS = [
  { num: 1,  arabicName: 'الأول',      epCount: 40  },
  { num: 2,  arabicName: 'الثاني',     epCount: 39  },
  { num: 3,  arabicName: 'الثالث',     epCount: 46  },
  { num: 4,  arabicName: 'الرابع',     epCount: 71  },
  { num: 5,  arabicName: 'الخامس',     epCount: 52  },
  { num: 6,  arabicName: 'السادس',     epCount: 52  },
  { num: 7,  arabicName: 'السابع',     epCount: 52  },
  { num: 8,  arabicName: 'الثامن',     epCount: 52  },
  { num: 9,  arabicName: 'التاسع',     epCount: 54  },
  { num: 10, arabicName: 'العاشر',     epCount: 50  },
  { num: 11, arabicName: 'الحادي عشر', epCount: 66  },
];
// Build catalogs: one per season (movie)
const CATALOGS = SEASONS.map(function(s) {
  return {
    type: 'movie',
    id: 'conan-season-' + s.num,
    name: 'المحقق كونان - الجزء ' + s.arabicName
  };
});
// Build metas for each season's catalog
function buildSeasonMetas(season) {
  var metas = [];
  for (var i = 1; i <= season.epCount; i++) {
    metas.push({
      id: 'conan-' + season.num + '-' + i,
      type: 'movie',
      name: 'المحقق كونان الجزء ' + season.arabicName + ' مدبلج - الحلقة ' + i,
      poster: POSTER
    });
  }
  return metas;
}
const addon = new addonBuilder({
  id: 'local.network.conan.arabic',
  name: 'Conan Arabic Dub',
  version: '4.0.0',
  description: 'Detective Conan Arabic Dubbed - All 11 Seasons (574 Episodes) - مدبلج عربي',
  logo: 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/VfLdyQfallyxvWMo.jpg',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie'],
  catalogs: CATALOGS,
  idPrefixes: ['conan']
});
addon.defineCatalogHandler(function(args) {
  if (args.type === 'movie') {
    var seasonMatch = args.id.match(/^conan-season-(\d+)$/);
    if (seasonMatch) {
      var seasonNum = parseInt(seasonMatch[1], 10);
      var season = SEASONS.find(function(s) { return s.num === seasonNum; });
      if (season) {
        return Promise.resolve({ metas: buildSeasonMetas(season) });
      }
    }
  }
  return Promise.resolve({ metas: [] });
});
addon.defineMetaHandler(function(args) {
  if (args.type === 'movie' && args.id.startsWith('conan-')) {
    var parts = args.id.split('-');
    var seasonNum = parseInt(parts[1], 10);
    var episodeNum = parseInt(parts[2], 10);
    var season = SEASONS.find(function(s) { return s.num === seasonNum; });
    if (!season || episodeNum < 1 || episodeNum > season.epCount) {
      return Promise.resolve({ meta: null });
    }
    var fullName = 'المحقق كونان الجزء ' + season.arabicName + ' مدبلج - الحلقة ' + episodeNum;
    return Promise.resolve({
      meta: {
        id: args.id,
        type: 'movie',
        name: fullName,
        poster: POSTER,
        description: 'المحقق كونان مدبلج - الجزء ' + seasonNum + ' - الحلقة ' + episodeNum
      }
    });
  }
  return Promise.resolve({ meta: null });
});
addon.defineStreamHandler(function(args) {
  if (args.type === 'movie' && args.id.startsWith('conan-')) {
    var parts = args.id.split('-');
    var seasonNum = parseInt(parts[1], 10);
    var episodeNum = parseInt(parts[2], 10);
    var season = SEASONS.find(function(s) { return s.num === seasonNum; });
    if (!season || episodeNum < 1 || episodeNum > season.epCount) {
      return Promise.resolve({ streams: [] });
    }
    var videoUrl = BASE_URL + 'c' + seasonNum + '/EP' + episodeNum + '.mp4';
    var proxyUrl = '/stream-proxy?url=' + encodeURIComponent(videoUrl);
    var fullName = 'المحقق كونان الجزء ' + season.arabicName + ' مدبلج - الحلقة ' + episodeNum;
    return Promise.resolve({
      streams: [
        {
          title: fullName,
          url: PUBLIC_URL + proxyUrl
        }
      ]
    });
  }
  return Promise.resolve({ streams: [] });
});
// Create Express app and mount addon router
const app = express();
// Video proxy with Cloudflare bypass headers
app.get('/stream-proxy', function(req, res) {
  var rawUrl = decodeURIComponent(req.query.url || '');
  // If it's a ccdko80 URL, convert it directly to the /videos/ path
  if (rawUrl.includes('ccdko80.com/get_video.php?videos=')) {
    var videoPath = rawUrl.split('videos=')[1];
    rawUrl = 'https://www.ccdko80.com/videos/' + videoPath;
  }
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
      'Accept': 'video/mp4,video/*,*/*;q=0.8',
      'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
      'Referer': 'https://conanaraby.com/',
      'Origin': 'https://conanaraby.com',
      'Connection': 'keep-alive'
    }
  };
  // Pass Range header for seeking
  if (req.headers.range) {
    options.headers['Range'] = req.headers.range;
  }
  var reqObj = protocol.get(options, function(proxyRes) {
    // Handle redirects
    if (proxyRes.statusCode === 302 || proxyRes.statusCode === 301) {
      var redirectUrl = proxyRes.headers['location'];
      if (redirectUrl) {
        // Follow redirect - resolve relative URL
        if (redirectUrl.startsWith('/')) {
          redirectUrl = targetUrlObj.protocol + '//' + targetUrlObj.hostname + redirectUrl;
        }
        // Re-request with same headers to the redirect URL
        var redirectUrlObj = new URL(redirectUrl);
        var redirectOptions = {
          hostname: redirectUrlObj.hostname,
          port: redirectUrlObj.port || (redirectUrlObj.protocol === 'https:' ? 443 : 80),
          path: redirectUrlObj.pathname + redirectUrlObj.search,
          method: 'GET',
          headers: Object.assign({}, options.headers)
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
  // Add CORS headers for Vidi
  headers['Access-Control-Allow-Origin'] = '*';
  headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Range, Accept, Content-Type';
  headers['Access-Control-Expose-Headers'] = 'Content-Range, Content-Length, Accept-Ranges, Content-Type';
  headers['Accept-Ranges'] = 'bytes';
  res.writeHead(proxyRes.statusCode, headers);
  proxyRes.pipe(res);
}
// Mount the addon SDK router
const addonRouter = getRouter(addon.getInterface());
app.use('/', addonRouter);
const PORT = process.env.PORT || 7000;
app.listen(PORT, function() {
  console.log('Conan Arabic Addon running on port ' + PORT);
  console.log('Manifest: http://localhost:' + PORT + '/manifest.json');
});
