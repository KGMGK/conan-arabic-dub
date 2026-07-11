const express = require('express');
const app = express();
const PORT = process.env.PORT || 7000;

const BASE_URL = 'https://www.ccdko80.com/get_video.php?videos=';

const CONAN_POSTER = 'https://m.media-amazon.com/images/M/MV5BZjE3NDQ0NzAtYmFkOS00OWEyLWE2NzctMjU4ZTIwOTQ5YTBiXkEyXkFqcGdeQXVyNjc3MjQzNTI@._V1_.jpg';

const CONAN_SEASONS = [
  { num: 1,  name: 'Conan Part 1',             epCount: 40,  arabicName: 'المحقق كونان الجزء الأول' },
  { num: 2,  name: 'Conan Part 2',             epCount: 39,  arabicName: 'المحقق كونان الجزء الثاني' },
  { num: 3,  name: 'Conan Part 3',             epCount: 46,  arabicName: 'المحقق كونان الجزء الثالث' },
  { num: 4,  name: 'Conan Part 4',             epCount: 71,  arabicName: 'المحقق كونان الجزء الرابع' },
  { num: 5,  name: 'Conan Part 5',             epCount: 52,  arabicName: 'المحقق كونان الجزء الخامس' },
  { num: 6,  name: 'Conan Part 6',             epCount: 52,  arabicName: 'المحقق كونان الجزء السادس' },
  { num: 7,  name: 'Conan Part 7',             epCount: 52,  arabicName: 'المحقق كونان الجزء السابع' },
  { num: 8,  name: 'Conan Part 8',             epCount: 52,  arabicName: 'المحقق كونان الجزء الثامن' },
  { num: 9,  name: 'Conan Part 9',             epCount: 54,  arabicName: 'المحقق كونان الجزء التاسع' },
  { num: 10, name: 'Conan Part 10',            epCount: 50,  arabicName: 'المحقق كونان الجزء العاشر' },
  { num: 11, name: 'Conan Part 11',            epCount: 66,  arabicName: 'المحقق كونان الجزء الحادي عشر' },
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
  description: 'Detective Conan Arabic Dubbed - All 11 Seasons (574 Episodes)',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie'],
  catalogs: [
    { type: 'movie', id: 'conan_arabic_catalog', name: 'Conan (Arabic Dub)' }
  ],
  idPrefixes: ['tt'],
  logo: CONAN_POSTER
};

app.get('/manifest.json', function(req, res) {
  res.json(manifest);
});

app.get('/catalog/movie/:id.json', function(req, res) {
  var metas = [];
  var ttBase = 10000000;
  var idCounter = ttBase;

  CONAN_SEASONS.forEach(function(s) {
    for (var i = 1; i <= s.epCount; i++) {
      var ttId = 'tt' + idCounter;
      metas.push({
        id: ttId,
        type: 'movie',
        name: s.name + ' - Episode ' + i + ' (Arabic Dub)',
        poster: CONAN_POSTER
      });
      idCounter++;
    }
  });

  res.json({ metas: metas });
});

app.get('/meta/movie/:id.json', function(req, res) {
  var id = req.params.id;
  var ttBase = 10000000;
  var ttNum = parseInt(id.replace('tt', ''), 10);
  var offset = ttNum - ttBase;

  if (offset < 0) return res.json({ meta: null });

  var remaining = offset;
  var foundSeason = null;
  var foundEpisode = null;

  for (var s = 0; s < CONAN_SEASONS.length; s++) {
    if (remaining < CONAN_SEASONS[s].epCount) {
      foundSeason = CONAN_SEASONS[s];
      foundEpisode = remaining + 1;
      break;
    }
    remaining -= CONAN_SEASONS[s].epCount;
  }

  if (!foundSeason) return res.json({ meta: null });

  res.json({
    meta: {
      id: id,
      type: 'movie',
      name: foundSeason.name + ' - Episode ' + foundEpisode + ' (Arabic Dub)',
      poster: CONAN_POSTER,
      description: foundSeason.arabicName + ' - الحلقة ' + foundEpisode,
      genres: ['Anime', 'Mystery', 'Detective'],
      year: 1996
    }
  });
});

app.get('/stream/movie/:id.json', function(req, res) {
  var id = req.params.id;
  var ttBase = 10000000;
  var ttNum = parseInt(id.replace('tt', ''), 10);
  var offset = ttNum - ttBase;

  if (offset < 0) return res.json({ streams: [] });

  var remaining = offset;
  var foundSeason = null;
  var foundEpisode = null;

  for (var s = 0; s < CONAN_SEASONS.length; s++) {
    if (remaining < CONAN_SEASONS[s].epCount) {
      foundSeason = CONAN_SEASONS[s];
      foundEpisode = remaining + 1;
      break;
    }
    remaining -= CONAN_SEASONS[s].epCount;
  }

  if (!foundSeason) return res.json({ streams: [] });

  var videoUrl = BASE_URL + 'c' + foundSeason.num + '/EP' + foundEpisode + '.mp4';

  res.json({
    streams: [
      {
        title: foundSeason.arabicName + ' - الحلقة ' + foundEpisode,
        url: videoUrl
      }
    ]
  });
});

app.get('/ping', function(req, res) {
  res.send('ok');
});

app.listen(PORT, function() {
  console.log('Conan Arabic Addon running on port ' + PORT);
});
