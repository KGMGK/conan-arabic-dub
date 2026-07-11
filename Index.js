const express = require('express');
const app = express();
const PORT = process.env.PORT || 7000;

const BASE_URL = 'https://www.ccdko80.com/get_video.php?videos=';
const CONAN_POSTER = 'https://image.tmdb.org/t/p/w500/oNfQZvar68KMhBuCxMJFLxHNfmu.jpg';
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

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const manifest = {
  id: 'org.khalifa.conanarabic',
  version: '1.0.0',
  name: 'كونان بالعربي',
  description: 'المحقق كونان مدبلج — الأجزاء 1 إلى 11 من كونان عربي',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie'],
  catalogs: [
    { type: 'movie', id: 'conan_catalog', name: 'كونان بالعربي' }
  ],
  idPrefixes: ['conan:']
};

app.get('/manifest.json', (req, res) => {
  res.json(manifest);
});

app.get('/catalog/movie/:type/:id.json', (req, res) => {
  const metas = [];
  
  CONAN_SEASONS.forEach(s => {
    for (let i = 1; i <= s.epCount; i++) {
      metas.push({
        id: `conan:s<LaTex>${s.num}e$</LaTex>{i}`,
        type: 'movie',
        name: `<LaTex>${s.name} - الحلقة $</LaTex>{i}`,
        poster: CONAN_POSTER,
        posterShape: 'poster'
      });
    }
  });

  res.json({ metas });
});

app.get('/meta/movie/:id.json', (req, res) => {
  const id = req.params.id;
  const parts = id.split(':');
  
  let seasonNum = 1;
  let episodeNum = 1;
  
  if (parts.length >= 3) {
    const match = parts[1].match(/s(\d+)e(\d+)/);
    if (match) {
      seasonNum = parseInt(match[1], 10);
      episodeNum = parseInt(match[2], 10);
    }
  }

  const season = CONAN_SEASONS.find(s => s.num === seasonNum);
  if (!season || episodeNum < 1 || episodeNum > season.epCount) {
    return res.json({ meta: null });
  }

  res.json({
    meta: {
      id: id,
      type: 'movie',
      name: `<LaTex>${season.name} - الحلقة $</LaTex>{episodeNum}`,
      poster: CONAN_POSTER,
      background: CONAN_BG,
      videos: [{
        id: id + ':1',
        title: 'Konan Arabic Dub',
        season: 1,
        episode: 1
      }]
    }
  });
});

app.get('/stream/movie/:id.json', (req, res) => {
  const id = req.params.id;
  const parts = id.split(':');
  
  let seasonNum = 1;
  let episodeNum = 1;
  
  if (parts.length >= 3) {
    const match = parts[1].match(/s(\d+)e(\d+)/);
    if (match) {
      seasonNum = parseInt(match[1], 10);
      episodeNum = parseInt(match[2], 10);
    }
  }

  const season = CONAN_SEASONS.find(s => s.num === seasonNum);
  if (!season || episodeNum < 1 || episodeNum > season.epCount) {
    return res.json({ streams: [] });
  }

  const videoUrl = `<LaTex>${BASE_URL}c$</LaTex>{seasonNum}/EP<LaTex>${episodeNum}.mp4`;

  res.json({
    streams: [
      {
        title: `🎬 كونان بالعربي (الجزء $</LaTex>{seasonNum} - الحلقة <LaTex>${episodeNum})`,
        url: videoUrl
      }
    ]
  });
});

app.get('/ping', (req, res) => res.send('ok'));

app.listen(PORT, () => {
  console.log(`Conan Arabic Addon running on port $</LaTex>{PORT}`);
});
