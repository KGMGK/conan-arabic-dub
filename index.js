const express = require('express');
const app = express();
const PORT = process.env.PORT || 7000;

const BASE_URL = 'https://www.ccdko80.com/get_video.php?videos=';
const CONAN_BG = 'https://image.tmdb.org/t/p/w1280/hpGM1o8bFsOEkEVCGCBQDHRHnJH.jpg';

const CONAN_SEASONS = [
  { num: 1,  name: 'المحقق كونان الجزء الأول مدبلج',        epCount: 40  },
  { num: 2,  name: 'المحقق كونان الجزء الثاني مدبلج',       epCount: 39  },
  { num: 3,  name: 'المحقق كونان الجزء الثالث مدبلج',       epCount: 46  },
  { num: 4,  name: 'المحقق كونان الجزء الرابع مدبلج',       epCount: 71  },
  { num: 5,  name: 'المحقق كونان الجزء الخامس مدبلج',       epCount: 52  },
  { num: 6,  name: 'المحقق كونان الجزء السادس مدبلج',       epCount: 52  },
  { num: 7,  name: 'المحقق كونان الجزء السابع مدبلج',       epCount: 52  },
  { num: 8,  name: 'المحقق كونان الجزء الثامن مدبلج',       epCount: 52  },
  { num: 9,  name: 'المحقق كونان الجزء التاسع مدبلج',       epCount: 54  },
  { num: 10, name: 'المحقق كونان الجزء العاشر مدبلج',       epCount: 50  },
  { num: 11, name: 'المحقق كونان الجزء الحادي عشر مدبلج',  epCount: 66  },
];

app.use(function(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const manifest = {
  id: 'local.network.conan.arabic',
  version: '1.0.0',
  name: 'Conan Arabic Dub',
  description: 'المحقق كونان مدبلج - الأجزاء 1 إلى 11 من كونان عربي',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie'],
  catalogs: [
    { type: 'movie', id: 'conan_arabic_catalog', name: 'Conan (Arabic Dub)' }
  ],
  idPrefixes: ['conan']
};

app.get('/manifest.json', function(req, res) {
  res.json(manifest);
});

app.get('/catalog/movie/:id.json', function(req, res) {
  var metas = [];
  CONAN_SEASONS.forEach(function(s) {
    for (var i = 1; i <= s.epCount; i++) {
      metas.push({
        id: 'conan-' + s.num + '-' + i,
        type: 'movie',
        name: s.name + ' - الحلقة ' + i,
        poster: 'https://images.metahub.space/poster/medium/tt0806913/img'
      });
    }
  });
  res.json({ metas: metas });
});

app.get('/meta/movie/:id.json', function(req, res) {
  var id = req.params.id;
  var parts = id.split('-');
  if (parts.length !== 3 || parts[0] !== 'conan') {
    return res.json({ meta: null });
  }
  var seasonNum = parseInt(parts[1], 10);
  var episodeNum = parseInt(parts[2], 10);
  var season = CONAN_SEASONS.find(function(s) { return s.num === seasonNum; });
  if (!season || episodeNum < 1 || episodeNum > season.epCount) {
    return res.json({ meta: null });
  }
  res.json({
    meta: {
      id: id,
      type: 'movie',
      name: season.name + ' - الحلقة ' + episodeNum,
      poster: 'https://images.metahub.space/poster/medium/tt0806913/img',
      background: CONAN_BG,
      description: 'المحقق كونان مدبلج - الجزء ' + seasonNum + ' - الحلقة ' + episodeNum,
      year: 1997
    }
  });
});

app.get('/stream/movie/:id.json', function(req, res) {
  var id = req.params.id;
  var parts = id.split('-');
  if (parts.length !== 3 || parts[0] !== 'conan') {
    return res.json({ streams: [] });
  }
  var seasonNum = parseInt(parts[1], 10);
  var episodeNum = parseInt(parts[2], 10);
  var season = CONAN_SEASONS.find(function(s) { return s.num === seasonNum; });
  if (!season || episodeNum < 1 || episodeNum > season.epCount) {
    return res.json({ streams: [] });
  }
  var videoUrl = BASE_URL + 'c' + seasonNum + '/EP' + episodeNum + '.mp4';
  res.json({
    streams: [
      {
        title: 'Konan Arabic Dub (الجزء ' + seasonNum + ' - الحلقة ' + episodeNum + ')',
        url: videoUrl
      }
    ]
  });
});

app.get('/ping', function(req, res) { res.send('ok'); });

app.listen(PORT, function() {
  console.log('Conan Arabic Addon running on port ' + PORT);
});
