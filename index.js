const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');

const BASE_URL = 'https://www.ccdko80.com/get_video.php?videos=';
const POSTER = 'https://m.media-amazon.com/images/M/MV5BZjE3NDQ0NzAtYmFkOS00OWEyLWE2NzctMjU4ZTIwOTQ5YTBiXkEyXkFqcGdeQXVyNjc3MjQzNTI@._V1_.jpg';

const SEASONS = [
  { num: 1,  arabicName: 'الأول',            epCount: 40  },
  { num: 2,  arabicName: 'الثاني',           epCount: 39  },
  { num: 3,  arabicName: 'الثالث',           epCount: 46  },
  { num: 4,  arabicName: 'الرابع',           epCount: 71  },
  { num: 5,  arabicName: 'الخامس',           epCount: 52  },
  { num: 6,  arabicName: 'السادس',           epCount: 52  },
  { num: 7,  arabicName: 'السابع',           epCount: 52  },
  { num: 8,  arabicName: 'الثامن',           epCount: 52  },
  { num: 9,  arabicName: 'التاسع',           epCount: 54  },
  { num: 10, arabicName: 'العاشر',           epCount: 50  },
  { num: 11, arabicName: 'الحادي عشر',       epCount: 66  },
];

function buildEpisodes() {
  var episodes = [];
  SEASONS.forEach(function(s) {
    for (var i = 1; i <= s.epCount; i++) {
      episodes.push({
        season: s.num,
        episode: i,
        arabicName: 'المحقق كونان الجزء ' + s.arabicName + ' مدبلج',
        id: 'conan-' + s.num + '-' + i
      });
    }
  });
  return episodes;
}

const ALL_EPISODES = buildEpisodes();

const addon = new addonBuilder({
  id: 'local.network.conan.arabic',
  name: 'Conan Arabic Dub',
  version: '1.0.0',
  description: 'Detective Conan Arabic Dubbed - All 11 Seasons (574 Episodes)',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie'],
  catalogs: [
    {
      type: 'movie',
      id: 'conan_arabic_catalog',
      name: 'Conan (Arabic Dub)'
    }
  ],
  idPrefixes: ['conan']
});

addon.defineCatalogHandler(function(args) {
  if (args.type === 'movie' && args.id === 'conan_arabic_catalog') {
    var metas = ALL_EPISODES.map(function(ep) {
      return {
        id: ep.id,
        type: 'movie',
        name: ep.arabicName + ' - الحلقة ' + ep.episode,
        poster: POSTER
      };
    });
    return Promise.resolve({ metas: metas });
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

    return Promise.resolve({
      meta: {
        id: args.id,
        type: 'movie',
        name: season.arabicName + ' - الحلقة ' + episodeNum,
        poster: POSTER,
        background: POSTER,
        description: 'المحقق كونان مدبلج - الجزء ' + seasonNum + ' - الحلقة ' + episodeNum,
        year: 1996,
        genres: ['Anime', 'Mystery']
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

    return Promise.resolve({
      streams: [
        {
          title: 'المحقق كونان الجزء ' + season.arabicName + ' - الحلقة ' + episodeNum,
          url: videoUrl
        }
      ]
    });
  }
  return Promise.resolve({ streams: [] });
});

const PORT = process.env.PORT || 7000;
serveHTTP(addon.getInterface(), { port: PORT });

console.log('Conan Arabic Addon running on port ' + PORT);
