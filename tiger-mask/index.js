const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const { google } = require('googleapis');
const https = require('https');
// === IN-MEMORY CACHE ===
// Simple TTL-based cache to reduce Google Drive API calls and improve speed ~50%
class MemoryCache {
  constructor() {
    this.store = new Map();
  }
  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }
  set(key, value, ttlMs) {
    this.store.set(key, { value, expires: Date.now() + ttlMs });
  }
  clear() {
    this.store.clear();
  }
  get size() {
    return this.store.size;
  }
}

// Cache instances
const streamCache = new MemoryCache();   // Access tokens for stream proxy
const STREAM_TTL = 50 * 60 * 1000;      // 50 minutes (tokens expire ~1hr)
const catalogCache = new MemoryCache();  // Catalog responses
const CATALOG_TTL = 30 * 60 * 1000;     // 30 minutes
const posterCache = new MemoryCache();  // Poster image cache
const metaCache = new MemoryCache();     // Meta responses
const META_TTL = 30 * 60 * 1000;        // 30 minutes


const PUBLIC_URL = process.env.PUBLIC_URL || 'https://tiger-mask-arabic.onrender.com';

// Proxy poster URLs through our server to avoid CORS/hotlink issues
function proxyPosterUrl(url) {
  if (!url) return url;
  // Don't proxy manuscdn URLs (they already work) or default poster
  if (url.includes('manuscdn.com') || url === DEFAULT_POSTER) return url;
  // Encode the URL in base64 and serve through our proxy
  const encoded = Buffer.from(url).toString('base64url');
  return PUBLIC_URL + '/poster/' + encoded;
}
const PARENT_FOLDER_ID = process.env.PARENT_FOLDER_ID || '12GroFa_NyHSsJIqsCWcJEcGdCcZrkfvB';
const MOVIES_FOLDER_ID = process.env.MOVIES_FOLDER_ID || '1BlJ7emrognT9blypmui7oyQL_0BIhsgN';
// New content folders
const CARTOON_MOVIES_FOLDER_ID = '10SIsAnTe54nSNvbCebV_ImlJM1zMzVqy';  // كرتون → افلام (standalone cartoon movies)
const FOREIGN_MOVIES_FOLDER_ID = '1-6ndIShx4qIhnOXNpOdlrygx7kCzhUwY';  // افلام اجنبيه
const ARABIC_MOVIES_FOLDER_ID = '10so56IpNJKYsG3X5s3w_Um_SfUe8vldT';   // افلام عربيه
const FOREIGN_SERIES_FOLDER_ID = '10zdAafbTHz-gBNYypSYZYidLLqUdO1aV';  // افلام اجنبيه → «سلسله»
const ACTORS_FOLDER_ID = '11VUEHosrNLXeuI8j9mL94nZnb-ZHN4Rv';         // افلام اجنبيه → «الممثلين»

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
  'اسطورة زورو': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/NHnRfdidnRBcOgGh.jpg',
  'بوكيمون': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/MrCXyBcpoWZQDDGB.jpg',
  'تيمون و بومبا': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/GLdtyEmfYSmdYVLP.jpg',
  'حكايات عالميه': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/tuufXlZKldaVlwzo.jpg',
  'ساسوكي': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/HNZQFWswRWnDdEdx.jpg',
  'فلونه': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/MlCXSExkONMHiHRU.jpg',
  'في جعبتي حكايه': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/rjYswUdsbNalKneX.png',
  'قصص بطوطية': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/UYUdWpKrUyLVlZij.png',
  'ليلو وستيتش': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/ViHccoocGpHJSasV.jpg',
  'ماروكو': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/pBkyctjkdTschpzj.jpg',
  'ماوكلي': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/vEcWBOqkTDaLKyfZ.jpg',
  'هايدي': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/mBqhKIFPgeEHgatl.jpg',
  'مستر بين': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/PuGDgmrdrmZgnUXJ.jpg'
};

// Movie poster mapping (by key -> poster URL)
const MOVIE_POSTER_MAP_BY_KEY = {
  'dalmatians': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/sQRlrNuXxuBiXNcz.jpg',
  'angrybirds': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/hixMBzqXTQceExFe.jpg',
  'despicablemee': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/VYmWfFGzcttnOkiE.jpg',
  'findingnemodory': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/LcGFzPrSsZUiLSVj.jpg',
  'frozenea': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/pybxCWZohiNxCZMq.jpg',
  'inside-out': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/QNJJjoXlUtnMPxiy.jpg',
  'kungfupandaea': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/qPGfBjRRWLsCkbfZ.jpg',
  'lilo-stitch-movie': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/nUgDSjoVkYPoGnCy.jpg',
  'minions': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/yLqgxOjEZxjGzHRw.jpg',
  'pussinboots': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/MuuiSQkNzFUhcizF.jpg',
  'super-mario': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/SbQwTVCrLVwbmKDQ.jpg',
  'toysstory': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/cfIixtAuFWFDRvaZ.jpg',
  'zootopia': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/JESmtSHlGuYQAPOo.jpg',
  'azlanzs': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/LwwDdXFpfyPuYvZn.jpg',
  'alasdalmlk': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/fWroqombyHBordyd.jpg',
  'incredibles': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/gPRenXmGtrKtHXeD.jpg',
  'smurfs': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/tFlaiyLcKVTZbOwC.jpg',
  'jyahalambsazwsaljdydh': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/QaLIpHCkGklxtuDr.jpg',
  'cinderella': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/TQqYnQsWDjgLKOeW.jpg',
  'sskhalmsabynalmjdwdh': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/yvsGzumBxjvbeczl.jpg',
  'tarzan': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/fnvDcLvPLQuuWRDe.jpg',
  'aladdin': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/xtuVPLbFnuhspeoI.jpg',
  'how-to-train-dragon': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/IuxBMtFHZXNsumyl.jpg',
  'madagascar': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/nNPfsMqjCFeIsHLz.jpg',
  'moana': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/ufmwEjtCJDIovOoP.jpg',
  'mulan': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/dOTwEQPaqovmsMsn.jpg'
};
const MOVIE_POSTER_MAP = {
  '80 Day\'s': 'https://m.media-amazon.com/images/M/MV5BMjIwNDk0NzUtNTZlOC00OGNiLWI0ODgtYWNhYzU4MzEwMjRiXkEyXkFqcGc@._V1_SX300.jpg',
  'Aladdin': 'https://image.tmdb.org/t/p/w500/eLFfl7vS8dkeG1hKp5mwbm37V83.jpg',
  'Analyze': 'https://m.media-amazon.com/images/M/MV5BZDJmZTNmMmQtYWM2MC00YzM5LWI5MGEtODRmZTgzNDAyN2FjXkEyXkFqcGc@._V1_SX300.jpg',
  'Aquaman': 'https://m.media-amazon.com/images/M/MV5BOTk5ODg0OTU5M15BMl5BanBnXkFtZTgwMDQ3MDY3NjM@._V1_QL75_UX380_CR0,0,380,562_.jpg',
  'Avatar': 'https://m.media-amazon.com/images/M/MV5BMDEzMmQwZjctZWU2My00MWNlLWE0NjItMDJlYTRlNGJiZjcyXkEyXkFqcGc@._V1_SX300.jpg',
  'Avengers': 'https://image.tmdb.org/t/p/w500/RYMX2wcKCBAr24UyPD7xwmjaTn.jpg',
  'Bad Boy\'s': 'https://m.media-amazon.com/images/M/MV5BMWNjZWEwNDMtMWE1ZC00MTgwLTk2YzAtYmE0NTkwOWVhMDI0XkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg',
  'Bee (النحله)': 'https://m.media-amazon.com/images/M/MV5BMjE1MDYxOTA4MF5BMl5BanBnXkFtZTcwMDE0MDUzMw@@._V1_SX300.jpg',
  'Bee keeper': 'https://m.media-amazon.com/images/M/MV5BNzg3YjVmZGYtOTc5MC00MDdiLTllOTYtZWQ0ODQ1MmMyNTExXkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg',
  'Big MaMa': 'https://m.media-amazon.com/images/M/MV5BMTg4YWY4MjEtNzQ2NC00MDJjLTg3YWEtZDI1ODkzYjEwNjczXkEyXkFqcGc@._V1_SX300.jpg',
  'Black Knight': 'https://m.media-amazon.com/images/M/MV5BNzU4Y2M0MjgtZTBkOS00Y2RjLTk0YzAtYzEzNmI4NmY3YTI4XkEyXkFqcGc@._V1_SX300.jpg',
  'Blended': 'https://m.media-amazon.com/images/M/MV5BNzc2ODI5NjAyMl5BMl5BanBnXkFtZTgwMzIyOTE4MDE@._V1_SX300.jpg',
  'Blitz': 'https://m.media-amazon.com/images/M/MV5BMTQ2MjAyMDY0NF5BMl5BanBnXkFtZTcwODMwOTY1OQ@@._V1_SX300.jpg',
  'Blue Streak': 'https://m.media-amazon.com/images/M/MV5BY2RmODQxZmQtZjAzYy00MWQxLWFmN2MtMWJiOGIxOGQxOWU4XkEyXkFqcGc@._V1_SX300.jpg',
  'Bourne': 'https://m.media-amazon.com/images/M/MV5BYTk1ZTcyMWMtMWUxYS00MmEzLTlmODYtOTk1MGRjOTg1ZjlmXkEyXkFqcGc@._V1_SX300.jpg',
  'Boyka': 'https://m.media-amazon.com/images/M/MV5BZTUyNjU3N2YtNDc0Ni00NmY0LTlkZjMtZGI4MjUwNmFiZDRjXkEyXkFqcGc@._V1_SX300.jpg',
  'Captain Phillips': 'https://m.media-amazon.com/images/M/MV5BMWYyNjI3ZjEtNGE5ZS00MDgxLWIzNGEtZTgzNDVlZjZjYWU5XkEyXkFqcGc@._V1_SX300.jpg',
  'Cast Away': 'https://m.media-amazon.com/images/M/MV5BOGNjNDI5ZGQtZjRjMy00NzQyLWFiYzQtYjcwNjM3ZDYwNThhXkEyXkFqcGc@._V1_SX300.jpg',
  'Central Intel...': 'https://m.media-amazon.com/images/M/MV5BMjA2NzEzNjIwNl5BMl5BanBnXkFtZTgwNzgwMTEzNzE@._V1_QL75_UX380_CR0,0,380,562_.jpg',
  'Chaos': 'https://m.media-amazon.com/images/M/MV5BMTc3NDU0MTgyN15BMl5BanBnXkFtZTcwNjgwMzY4NA@@._V1_SX300.jpg',
  'CoCo': 'https://m.media-amazon.com/images/M/MV5BMDIyM2E2NTAtMzlhNy00ZGUxLWI1NjgtZDY5MzhiMDc5NGU3XkEyXkFqcGc@._V1_QL75_UY562_CR7,0,380,562_.jpg',
  'Cobbler': 'https://m.media-amazon.com/images/M/MV5BMTgzMjQ2OTQ0NV5BMl5BanBnXkFtZTgwMTc2MTI2NDE@._V1_SX300.jpg',
  'Cop Out': 'https://m.media-amazon.com/images/M/MV5BMTk0NzcxMjYwNF5BMl5BanBnXkFtZTcwMTI4MTIxMw@@._V1_SX300.jpg',
  'Daddy\'s Home': 'https://m.media-amazon.com/images/M/MV5BMTQ0OTE1MTk4N15BMl5BanBnXkFtZTgwMDM5OTk5NjE@._V1_SX300.jpg',
  'Day After Tomorrow': 'https://m.media-amazon.com/images/M/MV5BOGZmNDYyNmMtNDQyNy00OTkzLTg1OGUtYWJiNmQ5Y2Q5ZGU3XkEyXkFqcGc@._V1_SX300.jpg',
  'Death Race': 'https://m.media-amazon.com/images/M/MV5BZjdlNmJjM2ItYjkwOS00NDMxLWFjM2QtNzcyZjJkYzEzYzQ5XkEyXkFqcGc@._V1_QL75_UY562_CR3,0,380,562_.jpg',
  'Dinosaur': 'https://m.media-amazon.com/images/M/MV5BYjFlNjFkNmUtNDRmNi00ZWIwLTg3ZjQtNTIxNmJkMjc1OTlhXkEyXkFqcGc@._V1_SX300.jpg',
  'Due date': 'https://m.media-amazon.com/images/M/MV5BMTU5MTgxODM3Nl5BMl5BanBnXkFtZTcwMjMxNDEwNA@@._V1_SX300.jpg',
  'Elysium': 'https://m.media-amazon.com/images/M/MV5BNDc2NjU0MTcwNV5BMl5BanBnXkFtZTcwMjg4MDg2OQ@@._V1_SX300.jpg',
  'Equalizer': 'https://m.media-amazon.com/images/M/MV5BMTQ2MzE2NTk0NF5BMl5BanBnXkFtZTgwOTM3NTk1MjE@._V1_QL75_UX380_CR0,0,380,562_.jpg',
  'Escape From Pretoria': 'https://m.media-amazon.com/images/M/MV5BYTFmODhiMzMtYjM3MC00MzNjLWEzYjctNzIxZjk2M2JiMDA4XkEyXkFqcGc@._V1_SX300.jpg',
  'Expendables': 'https://m.media-amazon.com/images/M/MV5BNTUwODQyNjM0NF5BMl5BanBnXkFtZTcwNDMwMTU1Mw@@._V1_QL75_UX380_CR0,1,380,562_.jpg',
  'Fantastic Four': 'https://m.media-amazon.com/images/M/MV5BNjY2YmZmMzUtZWY5Mi00MzI3LTljOTgtYTMwMWY1ODI5ZWY5XkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg',
  'Fast & Furious Hobbs & Shaw': 'https://m.media-amazon.com/images/M/MV5BNmU4OTA5NGYtMTFjMS00MzgxLWFjNTMtYjdlMThlYzc4M2M4XkEyXkFqcGc@._V1_SX300.jpg',
  'Ferdinand': 'https://m.media-amazon.com/images/M/MV5BMjI4Mjk0NzQwOF5BMl5BanBnXkFtZTgwNjg3MjI2MjI@._V1_SX300.jpg',
  'Fist Fight': 'https://m.media-amazon.com/images/M/MV5BMTg0NzkyMjE5NF5BMl5BanBnXkFtZTgwMDE5NTg3MDI@._V1_SX300.jpg',
  'Garfield': 'https://m.media-amazon.com/images/M/MV5BMTIzMTc1OTUxOV5BMl5BanBnXkFtZTYwNTMxODc3._V1_SX300.jpg',
  'Gladiator': 'https://image.tmdb.org/t/p/w500/wN2xWp1eIwCKOD0BHTcErTBv1Uq.jpg',
  'Godfather': 'https://m.media-amazon.com/images/M/MV5BNGEwYjgwOGQtYjg5ZS00Njc1LTk2ZGEtM2QwZWQ2NjdhZTE5XkEyXkFqcGc@._V1_QL75_UY562_CR8,0,380,562_.jpg',
  'Guns Akimbo': 'https://m.media-amazon.com/images/M/MV5BYjI2MTRjMmEtYTE1Yy00Zjk2LTk1NTQtYzA4MmI2YmQyYzAyXkEyXkFqcGc@._V1_SX300.jpg',
  'HERO 6': 'https://m.media-amazon.com/images/M/MV5BYjQ3YzUyOGQtNjdlYS00YmRhLWIyOWYtMGQ3YjkwMjJiYzRjXkEyXkFqcGc@._V1_SX300.jpg',
  'Harry Potter': 'https://m.media-amazon.com/images/M/MV5BNTU1MzgyMDMtMzBlZS00YzczLThmYWEtMjU3YmFlOWEyMjE1XkEyXkFqcGc@._V1_SX300.jpg',
  'Has Fallen': 'https://m.media-amazon.com/images/M/MV5BNzg3Mjc0YzItZWQyOS00ODY4LTgwZjUtYWRmYzM1MDg1ZDA5XkEyXkFqcGc@._V1_SX300.jpg',
  'Here Comes the Boom': 'https://m.media-amazon.com/images/M/MV5BMTUxMzEzNDQ0Nl5BMl5BanBnXkFtZTcwMDI2NTY1OA@@._V1_SX300.jpg',
  'Hobbit': 'https://m.media-amazon.com/images/M/MV5BMTcwNTE4MTUxMl5BMl5BanBnXkFtZTcwMDIyODM4OA@@._V1_QL75_UX380_CR0,0,380,562_.jpg',
  'Home Alone': 'https://m.media-amazon.com/images/M/MV5BNzNmNmQ2ZDEtMTc1MS00NjNiLThlMGUtZmQxNTg1Nzg5NWMzXkEyXkFqcGc@._V1_SX300.jpg',
  'Home On The Range': 'https://m.media-amazon.com/images/M/MV5BMzQyMDY4MjQ0Nl5BMl5BanBnXkFtZTYwODk4ODM3._V1_SX300.jpg',
  'Honest Thief': 'https://m.media-amazon.com/images/M/MV5BNmY3Y2E0MzYtY2JjNy00MTNkLTllODYtZDIxY2ZkNWQ5MTRlXkEyXkFqcGc@._V1_SX300.jpg',
  'Hulk': 'https://m.media-amazon.com/images/M/MV5BNTQxMmVlMTItMGFjYi00MTc2LWE5MzMtYjFhZWJmZGY0MTY5XkEyXkFqcGc@._V1_SX300.jpg',
  'Independence Day': 'https://m.media-amazon.com/images/M/MV5BOGMwN2UwZjEtYjFjMi00ZDA1LWJlYTQtMjA1MTYxMzIyNTdiXkEyXkFqcGc@._V1_SX300.jpg',
  'Inside Man': 'https://m.media-amazon.com/images/M/MV5BZWFmMDZkYjktMjYyOS00MTM2LTg2MmQtOTUwMzJjMDlhZDY1XkEyXkFqcGc@._V1_SX300.jpg',
  'Iron Man': 'https://m.media-amazon.com/images/M/MV5BMTczNTI2ODUwOF5BMl5BanBnXkFtZTcwMTU0NTIzMw@@._V1_QL75_UX380_CR0,0,380,562_.jpg',
  'Italian Job': 'https://m.media-amazon.com/images/M/MV5BMjJjNzc5YjAtZjU2Ni00ZjVkLTkzYmItM2E2NDM0NWE1YmJhXkEyXkFqcGc@._V1_SX300.jpg',
  'Jack Reacher': 'https://m.media-amazon.com/images/M/MV5BMTM1NjUxMDI3OV5BMl5BanBnXkFtZTcwNjg1ODM3OA@@._V1_SX300.jpg',
  'John Wick': 'https://m.media-amazon.com/images/M/MV5BMTU2NjA1ODgzMF5BMl5BanBnXkFtZTgwMTM2MTI4MjE@._V1_SX300.jpg',
  'Johnny English': 'https://m.media-amazon.com/images/M/MV5BMTU0MGM4ZjQtNmQ3MC00NDE4LWEwYTItYWZiYzAxMGQwMDkzXkEyXkFqcGc@._V1_SX300.jpg',
  'Journey': 'https://m.media-amazon.com/images/M/MV5BNTMyMGQ4MWYtZmMyYi00M2JhLWFhZmQtNWM5MTVjYjk1MTYxXkEyXkFqcGc@._V1_SX300.jpg',
  'Jumanji': 'https://m.media-amazon.com/images/M/MV5BYTFkMjFmODgtYzRiZi00NmQwLTliZWMtMzRhMWQ5ZmY3ZDExXkEyXkFqcGc@._V1_SX300.jpg',
  'Just Like Heaven': 'https://m.media-amazon.com/images/M/MV5BYjQ5MDc1OWEtOTAzZS00OWE1LWE5MmMtMGRlMDExZTRhZTQyXkEyXkFqcGc@._V1_SX300.jpg',
  'Karate Kid': 'https://m.media-amazon.com/images/M/MV5BMTQ0ODg3ODEyMF5BMl5BanBnXkFtZTcwNjI1MTgxMw@@._V1_SX300.jpg',
  'Killers': 'https://m.media-amazon.com/images/M/MV5BMTU0NDIwOTcwOV5BMl5BanBnXkFtZTcwNjU3NTQ0Mw@@._V1_SX300.jpg',
  'Knight and Day': 'https://m.media-amazon.com/images/M/MV5BMTM0Mzg0MzI3Ml5BMl5BanBnXkFtZTcwNjIyNzk1Mw@@._V1_SX300.jpg',
  'LIFT': 'https://m.media-amazon.com/images/M/MV5BN2FkMDJmNWItYzBlYy00ZDQ0LTgyMzEtZTA2N2U0ZTY5OGMyXkEyXkFqcGc@._V1_SX300.jpg',
  'LUCA (E)(ع)': 'https://m.media-amazon.com/images/M/MV5BMWMyNGNlZTktODVkNS00ZmMyLTk0NmUtNWVjOWU1MWMzZGMzXkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg',
  'Law abiding citizen': 'https://m.media-amazon.com/images/M/MV5BNDFjNzM2NzMtNTkxZi00ZGFmLTkyZGMtZWQ3ZjMwZDc5NDExXkEyXkFqcGc@._V1_SX300.jpg',
  'Let\'s be cops': 'https://m.media-amazon.com/images/M/MV5BMjI3MDY2ODQwNF5BMl5BanBnXkFtZTgwNjUzNjE4MTE@._V1_SX300.jpg',
  'Life as we know it': 'https://m.media-amazon.com/images/M/MV5BMTc1OTQzNzE0Nl5BMl5BanBnXkFtZTcwNDU4NDk3Mw@@._V1_SX300.jpg',
  'Lion King (واقعي)': 'https://m.media-amazon.com/images/M/MV5BNzk4MWJlMzAtMzM4NC00MGFhLTk4ZTItMjQ4N2IyNzYzM2Q3XkEyXkFqcGc@._V1_SX300.jpg',
  'Longest Yard': 'https://m.media-amazon.com/images/M/MV5BMTc1NTQyNDk2NV5BMl5BanBnXkFtZTcwOTE2OTQzMw@@._V1_SX300.jpg',
  'Man on Fire': 'https://m.media-amazon.com/images/M/MV5BMGMzNjg3ZDgtOGNlNy00NTdjLWI2NDEtMjI1MmEwMTBmMjMxXkEyXkFqcGc@._V1_QL75_UY562_CR1,0,380,562_.jpg',
  'Migration (E)(ع)': 'https://m.media-amazon.com/images/M/MV5BYjdlYWJjZTctODViZS00ODVlLTljOTEtOTZhYWZhZTRkZDM1XkEyXkFqcGc@._V1_SX300.jpg',
  'Mr & Mrs Smith': 'https://m.media-amazon.com/images/M/MV5BMTUxMzcxNzQzOF5BMl5BanBnXkFtZTcwMzQxNjUyMw@@._V1_SX300.jpg',
  'Mulan': 'https://m.media-amazon.com/images/M/MV5BYWJiZDg3ZWEtYWZkMC00Zjc1LTkzYTctZWFkODk2MDlmOGNiXkEyXkFqcGc@._V1_SX300.jpg',
  'National Security': 'https://m.media-amazon.com/images/M/MV5BMGFlOWI3MjctMjkwZi00ZGQ5LTgyYzgtNjU1ZjQwNGQ4ZDUzXkEyXkFqcGc@._V1_SX300.jpg',
  'Papper mint': 'https://m.media-amazon.com/images/M/MV5BN2ZmZGZmMzgtMWMwYS00ODEzLThhODgtYmM4YTViNTRlMWVlXkEyXkFqcGc@._V1_SX300.jpg',
  'Pelham 123': 'https://m.media-amazon.com/images/M/MV5BMTU3NzA4MDcwNV5BMl5BanBnXkFtZTcwMDAyNzc1Mg@@._V1_SX300.jpg',
  'Peter Pan': 'https://m.media-amazon.com/images/M/MV5BMGNjYWVkZGItZTNmNS00MGNkLWI2ZjEtMTIzNzAwNmIxMDRhXkEyXkFqcGc@._V1_SX300.jpg',
  'Punisher': 'https://m.media-amazon.com/images/M/MV5BMjI5NjcwMTQxMV5BMl5BanBnXkFtZTcwODg5ODkwNQ@@._V1_SX300.jpg',
  'Rampage': 'https://m.media-amazon.com/images/M/MV5BNDA1NjA3ODU3OV5BMl5BanBnXkFtZTgwOTg3MTIwNTM@._V1_QL75_UX380_CR0,0,380,562_.jpg',
  'Red Notice': 'https://m.media-amazon.com/images/M/MV5BOGNjNGQ3MmItYTM5NS00NjBiLWI0ZTItZDE5ZjQyNjg3ODBjXkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg',
  'Salt': 'https://m.media-amazon.com/images/M/MV5BMjIyODA2NDg4NV5BMl5BanBnXkFtZTcwMjg4NDAwMw@@._V1_SX300.jpg',
  'Shooter': 'https://m.media-amazon.com/images/M/MV5BYmE0NWZiMjktY2U4MC00MDVmLTljMGMtMWZiMThiNjczNzViXkEyXkFqcGc@._V1_SX300.jpg',
  'Small Foot (E)': 'https://m.media-amazon.com/images/M/MV5BZjBjYWQxMTQtMThiZS00NjZkLWE1ZjctMzE2ZTgxZmJmMWQ1XkEyXkFqcGc@._V1_SX300.jpg',
  'Snitch': 'https://m.media-amazon.com/images/M/MV5BNTM4MTYzNjA3Nl5BMl5BanBnXkFtZTcwMzcyNDA5OA@@._V1_SX300.jpg',
  'SnowWhite and the Huntsman': 'https://m.media-amazon.com/images/M/MV5BY2JjYWUyZjUtMDg3OS00MGIyLTgyN2QtYjIyY2VlYzViYThlXkEyXkFqcGc@._V1_SX300.jpg',
  'Spy': 'https://m.media-amazon.com/images/M/MV5BNjI5OTQ0MDQxM15BMl5BanBnXkFtZTgwMzcwNjMyNTE@._V1_SX300.jpg',
  'Tangled': 'https://m.media-amazon.com/images/M/MV5BMTAxNDYxMjg0MjNeQTJeQWpwZ15BbWU3MDcyNTk2OTM@._V1_SX300.jpg',
  'The Bank Job': 'https://m.media-amazon.com/images/M/MV5BZmQ5OTkxZDMtYTAxYS00OWE1LThhMWItYjdlYjJmNWZlNWU5XkEyXkFqcGc@._V1_SX300.jpg',
  'The Departed': 'https://m.media-amazon.com/images/M/MV5BMTI1MTY2OTIxNV5BMl5BanBnXkFtZTYwNjQ4NjY3._V1_QL75_UY562_CR0,0,380,562_.jpg',
  'The Forbidden': 'https://m.media-amazon.com/images/M/MV5BMTUwNTExMTg3NF5BMl5BanBnXkFtZTcwNDYyMTM2MQ@@._V1_SX300.jpg',
  'The Foreigner': 'https://m.media-amazon.com/images/M/MV5BNjBmY2MzYmMtNjdmMi00MWYyLTgwYTgtOTYwMTdmZTUxOGQxXkEyXkFqcGc@._V1_SX300.jpg',
  'The Heat': 'https://m.media-amazon.com/images/M/MV5BMjA2MDQ2ODM3MV5BMl5BanBnXkFtZTcwNDUzMTQ3OQ@@._V1_SX300.jpg',
  'The Incredible Hulk': 'https://m.media-amazon.com/images/M/MV5BMTUyNzk3MjA1OF5BMl5BanBnXkFtZTcwMTE1Njg2MQ@@._V1_QL75_UX380_CR0,0,380,562_.jpg',
  'The Invisible Guest': 'https://m.media-amazon.com/images/M/MV5BYzZmOTc5ZjctMzAyZC00YmM1LThmNWUtM2UxNzFjMDcyYjAzXkEyXkFqcGc@._V1_SX300.jpg',
  'The Loser\'s': 'https://m.media-amazon.com/images/M/MV5BMjU3MTU0NDI4Nl5BMl5BanBnXkFtZTcwMTE0NDMyMw@@._V1_SX300.jpg',
  'The MAN': 'https://m.media-amazon.com/images/M/MV5BODcwMDU0NjU3NF5BMl5BanBnXkFtZTYwOTI3MDc2._V1_SX300.jpg',
  'The Martian': 'https://m.media-amazon.com/images/M/MV5BMTc2MTQ3MDA1Nl5BMl5BanBnXkFtZTgwODA3OTI4NjE@._V1_SX300.jpg',
  'The Mask': 'https://m.media-amazon.com/images/M/MV5BNGNmNjI0ZmMtMzI5MC00ZjUyLWFlZDEtYjUyMGZlN2E3N2E2XkEyXkFqcGc@._V1_SX300.jpg',
  'The Myth': 'https://m.media-amazon.com/images/M/MV5BODU5MDczMWYtYTc5MS00NzZkLWIwMjQtNGI0NDdkYWE4NmI0XkEyXkFqcGc@._V1_SX300.jpg',
  'The Parent Trap': 'https://m.media-amazon.com/images/M/MV5BNTRkYmY3Y2QtMGM2Ny00MTNmLTk4NjYtNjMwNTNmMGY5ZDllXkEyXkFqcGc@._V1_SX300.jpg',
  'The Shawshank': 'https://m.media-amazon.com/images/M/MV5BMDAyY2FhYjctNDc5OS00MDNlLThiMGUtY2UxYWVkNGY2ZjljXkEyXkFqcGc@._V1_QL75_UX380_CR0,4,380,562_.jpg',
  'The Tourist': 'https://m.media-amazon.com/images/M/MV5BMTMyMzc3OTkwMV5BMl5BanBnXkFtZTcwMjc0MTgwNA@@._V1_SX300.jpg',
  'The Town': 'https://m.media-amazon.com/images/M/MV5BMTcyNzcxODg3Nl5BMl5BanBnXkFtZTcwMTUyNjQ3Mw@@._V1_SX300.jpg',
  'The Wild Robot': 'https://m.media-amazon.com/images/M/MV5BZWNiZjVlZTUtNGUwYi00MjJmLTg2MDctNWEzYTJiMzY1ODc4XkEyXkFqcGc@._V1_SX300.jpg',
  'The invention of lying': 'https://m.media-amazon.com/images/M/MV5BMTU2OTQzOTc1Nl5BMl5BanBnXkFtZTcwNDM5MDE4Mg@@._V1_SX300.jpg',
  'The island': 'https://m.media-amazon.com/images/M/MV5BMTAwNjk0NjM1ODReQTJeQWpwZ15BbWU3MDc1NjIxMzM@._V1_SX300.jpg',
  'Tomp Raider': 'https://m.media-amazon.com/images/M/MV5BMTIwNWU2NTEtMDQ0Yi00MjFkLThhN2UtMjJhOGVjN2UyYzFkXkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg',
  'Turbo': 'https://m.media-amazon.com/images/M/MV5BMTA4NTgwMjM5MzheQTJeQWpwZ15BbWU3MDg2ODA1ODk@._V1_SX300.jpg',
  'UP': 'https://m.media-amazon.com/images/M/MV5BNmI1ZTc5MWMtMDYyOS00ZDc2LTkzOTAtNjQ4NWIxNjYyNDgzXkEyXkFqcGc@._V1_SX300.jpg',
  'Uncharted': 'https://m.media-amazon.com/images/M/MV5BYjQxYWNiNzgtOTc2Yi00OGEwLTk5MjAtODdiZTk0ZDJlZGY4XkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg',
  'Van Helsing': 'https://m.media-amazon.com/images/M/MV5BNDk3NTdlYzQtMjhiMy00MWJkLWFjNDctMzE4ZGEwZWExNGViXkEyXkFqcGc@._V1_SX300.jpg',
  'Walking Tall': 'https://m.media-amazon.com/images/M/MV5BMTM0MjYzNzM1N15BMl5BanBnXkFtZTcwMDcwNDc3NA@@._V1_SX300.jpg',
  'Wish Dragon': 'https://m.media-amazon.com/images/M/MV5BMWM1YmJmYWMtMDM1Ni00ZGM2LTkxODYtOTU1ZjA4MTFkMDM1XkEyXkFqcGc@._V1_SX300.jpg',
  'Wolfs': 'https://m.media-amazon.com/images/M/MV5BNWI2MzdiM2ItMTg2Zi00MTYwLThlZmItM2FkNWI4NjE3ZjRhXkEyXkFqcGc@._V1_QL75_UY562_CR35,0,380,562_.jpg',
  'Wrath Of Man': 'https://m.media-amazon.com/images/M/MV5BODE4ZGY4OTktNDBjMy00NGVkLTk5YWUtNjA3NGU3MTA5NzM0XkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg',
  'ZODIAC': 'https://m.media-amazon.com/images/M/MV5BNDFkMTRkZmQtM2I0NC00NjJjLWJlMDctNTNiZWYxYzhjZDZiXkEyXkFqcGc@._V1_QL75_UY562_CR1,0,380,562_.jpg',
  '«افلام كونان»': 'https://m.media-amazon.com/images/M/MV5BNGNjMjVmODYtMGMzZi00MWUyLTk1ZDQtYzI2ZTk2MmYzYTZiXkEyXkFqcGc@._V1_QL75_UX380_CR0,4,380,562_.jpg',
  'الديناصور اللطيف': 'https://m.media-amazon.com/images/M/MV5BMTc5MTg2NjQ4MV5BMl5BanBnXkFtZTgwNzcxOTY5NjE@._V1_SX300.jpg',
  'اليس في بلاد العجائب': 'https://m.media-amazon.com/images/M/MV5BYjgxMTQ3NjMtOTI1Yy00Yzg4LWJlNWQtMjFkNjVlYjU0OWIyXkEyXkFqcGc@._V1_SX300.jpg',
  'بلال': 'https://m.media-amazon.com/images/M/MV5BYTM3YTdmZDgtNTViZi00MmNmLWIyMDUtMmFkNWQ5YzdiZDA5XkEyXkFqcGc@._V1_SX300.jpg',
  'بينوكيو': 'https://m.media-amazon.com/images/M/MV5BYjEyMDJmYTAtOTliMC00MjYzLTljNDEtMjliM2Y0MThjYzBiXkEyXkFqcGc@._V1_SX300.jpg',
  'جميله و الوحش': 'https://m.media-amazon.com/images/M/MV5BMTUwNjUxMTM4NV5BMl5BanBnXkFtZTgwODExMDQzMTI@._V1_SX300.jpg',
  'حياة حشره': 'https://m.media-amazon.com/images/M/MV5BNGI3Mjc1ZjUtYTJhYS00NjBiLTgyYjctODU5NTNlMWJiYjYzXkEyXkFqcGc@._V1_SX300.jpg',
  'رايا و آخر تنين': 'https://m.media-amazon.com/images/M/MV5BN2QzZTQ3MzktN2JiYS00MDEzLTgxMWQtZWFmMDI3NWFkZTY0XkEyXkFqcGc@._V1_SX300.jpg',
  'فلم الفسحه': 'https://m.media-amazon.com/images/M/MV5BZGNiZmFiZGUtODA2Mi00YjY0LWI1OTEtNWQ5NTdhZTkwM2Y1XkEyXkFqcGc@._V1_SX300.jpg',
  // === Arabic Films ===
  'ابو علي': 'https://image.tmdb.org/t/p/w500/libwOyI3CFSUItipEDUwrDy4DYG.jpg',
  'افريكانو': 'https://image.tmdb.org/t/p/w500/nBI7WzoTLX6akMQVVQ9N8llhfKG.jpg',
  'اكس لارج': 'https://m.media-amazon.com/images/M/MV5BMTFiYjFlZTUtZmRiZS00NmRmLWE3YmUtNjkxOTRhMzBmODFiXkEyXkFqcGc@._V1_QL75_UY281_CR4,0,190,281_.jpg',
  'الانس والنمس': 'https://image.tmdb.org/t/p/w500/jMxavCWPFEGXRoXGFwEuTUfLIsm.jpg',
  'البعبع': 'https://m.media-amazon.com/images/M/MV5BNDkzM2U0NzgtMDIyMy00YTkyLWE2MTYtMjgxZjZhODc1NDEzXkEyXkFqcGc@._V1_QL75_UX385_.jpg',
  'اللي بالي بالك': 'https://image.tmdb.org/t/p/w500/txstnOjizjPhtTeVN8pyY8OU8lZ.jpg',
  'بلبل حيران': 'https://image.tmdb.org/t/p/w500/8BvqE3uBGJ0BBzAoUJkFzeq3d7M.jpg',
  'بوحه': 'https://m.media-amazon.com/images/M/MV5BZDkyMWZlMGMtNmJkMS00M2U1LTk5Y2ItODgzZmQ3ODQ2NzZlXkEyXkFqcGc@._V1_FMjpg_UX1000_.jpg',
  'بوشكاش': 'https://image.tmdb.org/t/p/w500/gF12JJf9wU2y1j0bXL4y3m3ZqQS.jpg',
  'تسليم اهالي': 'https://image.tmdb.org/t/p/w500/tVcpdJQjrI1pcWRf4rpiQNHMXQT.jpg',
  'جعلتني مجرماً': 'https://image.tmdb.org/t/p/w500/9InvbMsehKRhHMSbPvAJrK0boCz.jpg',
  'حراميه في تايلاند': 'https://image.tmdb.org/t/p/w500/cAtcJrQB87HMZT5Y73SVAtOJNwr.jpg',
  'حرب اطاليا': 'https://image.tmdb.org/t/p/w500/zbSoyR3f1v7JrdPz09ecaYEXjji.jpg',
  'خارج على القانون': 'https://image.tmdb.org/t/p/w500/i1AmjimmZaAx5vwZBOptl8nJ12y.jpg',
  'زكي شان': 'https://image.tmdb.org/t/p/w500/isk2f0tI9Ie9H7PRVs8vwNShmYh.jpg',
  'ظرف طارق': 'https://m.media-amazon.com/images/M/MV5BNjgwNTE3NzE0OF5BMl5BanBnXkFtZTgwNTgxODYxMzE@._V1_QL75_UX151_.jpg',
  'عبود على الحدود': 'https://image.tmdb.org/t/p/w500/qVS0DrO1VjZ4gMEAizoaAeZLVAh.jpg',
  'عسل اسود': 'https://image.tmdb.org/t/p/w500/4VftuMgC4O9uDJZGA6XzNety5W1.jpg',
  'عوكل': 'https://m.media-amazon.com/images/M/MV5BMzI2YjhkYmMtMTllNy00Njk1LTkzMjktY2ExZDQ3NjI2YWIwXkEyXkFqcGc@._V1_QL75_UY281_CR1,0,190,281_.jpg',
  'غبي منه وفيه': 'https://image.tmdb.org/t/p/w500/9CIiGzSPeCqIFEA51scVvzRxG5o.jpg',
  'فاصل ونعود': 'https://m.media-amazon.com/images/M/MV5BNmU3OWIyMzgtNWExYi00NjhlLWJjOGYtMmJmZDMyMmU5YWQ2XkEyXkFqcGc@._V1_QL75_UX315_.jpg',
  'فول الصين العظيم': 'https://image.tmdb.org/t/p/w500/wU5klVmEAvI55QvH85Qbyz6qhLi.jpg',
  'في محطة مصر': 'https://m.media-amazon.com/images/M/MV5BODczYzY1YjItZWI4YS00NjA2LTk4MGUtYjU0YWRmZDM4OWMzXkEyXkFqcGc@._V1_QL75_UX224_.jpg',
  'كده رضا': 'https://image.tmdb.org/t/p/w500/eNSxF2OgoT3UBp8FQK6EHkPQH4P.jpg',
  'لا تراجع ولا استسلام': 'https://image.tmdb.org/t/p/w500/b7gFI5L2thZy3TzXHRU54wgS8Zu.jpg',
  'ماما حامل': 'https://image.tmdb.org/t/p/w500/avhiL9jbVwku0KvFL5uf8jNYsnJ.jpg',
  'مطب صناعي': 'https://image.tmdb.org/t/p/w500/ra7F9sEmXUX8lhcI9iqlzNd4NvJ.jpg',
  'همام في استردام': 'https://image.tmdb.org/t/p/w500/2dguERfqKOPe8zAyxYDNuma5ECZ.jpg',
  'واحد من الناس': 'https://image.tmdb.org/t/p/w500/aso7BXD0MWVz8XkRsNH2fnUvtRq.jpg',
  'Lord of the Rings': 'https://m.media-amazon.com/images/M/MV5BNzIxMDQ2YTctNDY4MC00ZTRhLTk4ODQtMTVlOWY4NTdiYmMwXkEyXkFqcGc@._V1_QL75_UX380_CR0,1,380,562_.jpg',
  'Maleficent': 'https://m.media-amazon.com/images/M/MV5BMjAwMzAzMzExOF5BMl5BanBnXkFtZTgwOTcwMDA5MTE@._V1_SX300.jpg',
  'Miss Congeniality': 'https://m.media-amazon.com/images/M/MV5BZjMzOWU2MGQtM2Y2Mi00YzgwLTllOGYtNzJlNmU2OTM1MmJjXkEyXkFqcGc@._V1_SX300.jpg',
  'Mission Impossible': 'https://m.media-amazon.com/images/M/MV5BOGZjNDlkMTYtMTJkZi00OTkzLWI4NDEtYTA2ODQyMjcwYTdlXkEyXkFqcGc@._V1_QL75_UX380_CR0,1,380,562_.jpg',
  'Narnia': 'https://m.media-amazon.com/images/M/MV5BMTc0NTUwMTU5OV5BMl5BanBnXkFtZTcwNjAwNzQzMw@@._V1_SX300.jpg',
  'Night At The Museum': 'https://m.media-amazon.com/images/M/MV5BM2E4ZGViZWEtYTNjOS00YmIwLWJmMWQtZGRhMWQwYTU0NWUyXkEyXkFqcGc@._V1_SX300.jpg',
  'Now you see me': 'https://m.media-amazon.com/images/M/MV5BMTY0NDY3MDMxN15BMl5BanBnXkFtZTcwOTM5NzMzOQ@@._V1_SX300.jpg',
  "Ocean's": 'https://m.media-amazon.com/images/M/MV5BYTkxYjE1NzAtNDJiZC00YWRmLWEwMjEtNWQzZWUyNjFiYzI2XkEyXkFqcGc@._V1_SX300.jpg',
  'Pink Panther': 'https://m.media-amazon.com/images/M/MV5BZTE2ODdmMTktNmEwMy00ZDZmLWJmNDAtYTEyN2FjYjcwM2M1XkEyXkFqcGc@._V1_SX300.jpg',
  'Pirates of the Caribbean': 'https://m.media-amazon.com/images/M/MV5BNDhlMzEyNzItMTA5Mi00YWRhLThlNTktYTQyMTA0MDIyNDEyXkEyXkFqcGc@._V1_QL75_UX380_CR0,2,380,562_.jpg',
  'Ride Along': 'https://m.media-amazon.com/images/M/MV5BNjU4NzYzOTY1MF5BMl5BanBnXkFtZTgwMTAyNTc1MDE@._V1_SX300.jpg',
  'Rush Hour': 'https://m.media-amazon.com/images/M/MV5BMGZiMzViNmEtNTNlZi00MzFmLTk5NTEtNDE2OTUzNmNlMTY4XkEyXkFqcGc@._V1_SX300.jpg',
  'Shanghai': 'https://m.media-amazon.com/images/M/MV5BM2YxZTNkMzctMzg5Mi00MzZmLWIyYzMtMjlmM2E3NmE0OGEwXkEyXkFqcGc@._V1_SX300.jpg',
  'Sherlock Holmes': 'https://m.media-amazon.com/images/M/MV5BMTg0NjEwNjUxM15BMl5BanBnXkFtZTcwMzk0MjQ5Mg@@._V1_SX300.jpg',
  'The Apes': 'https://m.media-amazon.com/images/M/MV5BMjllODU1NDItODU1Ni00N2Y2LTg4Y2ItOTJjMTczZDliN2FhXkEyXkFqcGc@._V1_SX300.jpg',
  "The Hitman's": 'https://m.media-amazon.com/images/M/MV5BNmY2ZjExZDMtNjU5Ni00MWFkLWI3M2QtMDAwOGNjMjgyMDY2XkEyXkFqcGdeQXVyMTY2MDU4ODIy._V1_SX300.jpg',
  'The Mechanic': 'https://m.media-amazon.com/images/M/MV5BYzAxZDZjMjktOTExMS00ODc4LTk5ZmEtNzY5NzQ4MTgzMzRhXkEyXkFqcGc@._V1_SX300.jpg',
  'The MEG': 'https://image.tmdb.org/t/p/w500/eyWICPcxOuTcDDDbTMOZawoOn8d.jpg',
  'Thor': 'https://m.media-amazon.com/images/M/MV5BNjRhNGZjZjEtYTQzYS00OWUxLThjNGEtMTIwMTE2ZDFlZTZkXkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg',
  'RED': 'https://m.media-amazon.com/images/M/MV5BMzg2Mjg1OTk0NF5BMl5BanBnXkFtZTcwMjQ4MTA3Mw@@._V1_SX300.jpg',
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
  'ماوكلي': { description: 'ماوكلي هو أنمي مستوحى من كتاب الأدغال عن فتى نشأ بين الحيوانات.', genres: ['Animation', 'Adventure', 'Family'] },
  'فلونه': { description: 'فلونة هو مسلسل أنمي ياباني يحكي قصة عائلة روبنسون السويسرية في جزيرة نائية.', genres: ['Animation', 'Adventure', 'Family'] },
  'هايدي': { description: 'هايدي هو مسلسل أنمي ياباني كلاسيكي يحكي قصة الطفلة هايدي في جبال الألب السويسرية.', genres: ['Animation', 'Drama', 'Family'] },
  'مستر بين': { description: 'مستر بين هو مسلسل كرتوني كوميدي مستوحى من المسلسل البريطاني الشهير.', genres: ['Animation', 'Comedy'] }
};

// Movie meta info
const MOVIE_META = {
  '101 Dalmatians': { description: 'سلسلة أفلام 101 كلب مرقش', genres: ['Animation', 'Family', 'Adventure'] },
  'Angry Birds': { description: 'سلسلة أفلام الطيور الغاضبة', genres: ['Animation', 'Comedy', 'Adventure'] },
  'Despicable Me': { description: 'سلسلة أفلام غرو والمينيونز', genres: ['Animation', 'Comedy', 'Family'] },
  'Finding Nemo': { description: 'سلسلة أفلام نيمو ودوري', genres: ['Animation', 'Adventure', 'Family'] },
  'Frozen': { description: 'سلسلة أفلام فروزن - إلسا وآنا', genres: ['Animation', 'Fantasy', 'Musical'] },
  'Inside Out': { description: 'سلسلة أفلام المشاعر الداخلية', genres: ['Animation', 'Comedy', 'Drama'] },
  'Kung Fu Panda': { description: 'سلسلة أفلام الباندا المحارب بو', genres: ['Animation', 'Action', 'Comedy'] },
  'Lilo & Stitch': { description: 'سلسلة أفلام ليلو وستيتش', genres: ['Animation', 'Comedy', 'Family'] },
  'Minions': { description: 'سلسلة أفلام المينيونز', genres: ['Animation', 'Comedy', 'Adventure'] },
  'Puss In Boots': { description: 'سلسلة أفلام القط المغامر', genres: ['Animation', 'Adventure', 'Comedy'] },
  'Super Mario': { description: 'سلسلة أفلام سوبر ماريو', genres: ['Animation', 'Adventure', 'Comedy'] },
  'Toy Story': { description: 'سلسلة أفلام حكاية لعبة - وودي وباز', genres: ['Animation', 'Adventure', 'Comedy'] },
  'Zootopia': { description: 'سلسلة أفلام مدينة الحيوانات', genres: ['Animation', 'Adventure', 'Comedy'] },
  'أطلانتس': { description: 'سلسلة أفلام أطلانتس المفقودة', genres: ['Animation', 'Adventure', 'Fantasy'] },
  'الأسد الملك': { description: 'سلسلة أفلام الأسد الملك سيمبا', genres: ['Animation', 'Drama', 'Family'] },
  'الخارقين': { description: 'سلسلة أفلام عائلة الأبطال الخارقين', genres: ['Animation', 'Action', 'Family'] },
  'السنافر': { description: 'سلسلة أفلام السنافر', genres: ['Animation', 'Comedy', 'Family'] },
  'حياة الإمبراطور الجديدة': { description: 'سلسلة أفلام حياة الإمبراطور الجديدة', genres: ['Animation', 'Comedy', 'Family'] },
  'سندريلا': { description: 'سلسلة أفلام سندريلا', genres: ['Animation', 'Fantasy', 'Musical'] },
  'شركة المرعبين المحدودة': { description: 'سلسلة أفلام شركة المرعبين المحدودة', genres: ['Animation', 'Comedy', 'Family'] },
  'طرزان': { description: 'سلسلة أفلام طرزان', genres: ['Animation', 'Adventure', 'Family'] },
  'علاء الدين': { description: 'سلسلة أفلام علاء الدين والمصباح السحري', genres: ['Animation', 'Fantasy', 'Musical'] },
  'كيف تدرب التنين': { description: 'سلسلة أفلام كيف تدرب تنينك', genres: ['Animation', 'Adventure', 'Fantasy'] },
  'مدغشقر': { description: 'سلسلة أفلام مدغشقر', genres: ['Animation', 'Comedy', 'Adventure'] },
  'موانا': { description: 'سلسلة أفلام موانا', genres: ['Animation', 'Adventure', 'Musical'] },
  'مولان': { description: 'سلسلة أفلام مولان المحاربة', genres: ['Animation', 'Action', 'Drama'] }
};

// Arabic movie name -> ASCII key mapping
const MOVIE_ARABIC_TO_ASCII = {
  '101 Dalmatians': 'dalmatians',
  'Angry Birds': 'angry-birds',
  'Despicable Me': 'despicable-me',
  'Finding Nemo': 'finding-nemo',
  'Frozen': 'frozen',
  'Inside Out': 'inside-out',
  'Kung Fu Panda': 'kung-fu-panda',
  'Lilo & Stitch': 'lilo-stitch-movie',
  'Minions': 'minions',
  'Puss In Boots': 'puss-in-boots',
  'Super Mario': 'super-mario',
  'Toy Story': 'toy-story',
  'Zootopia': 'zootopia',
  'أطلانتس': 'atlantis',
  'الأسد الملك': 'lion-king',
  'الخارقين': 'incredibles',
  'السنافر': 'smurfs',
  'حياة الإمبراطور الجديدة': 'emperors-groove',
  'سندريلا': 'cinderella',
  'شركة المرعبين المحدودة': 'monsters-inc',
  'طرزان': 'tarzan',
  'علاء الدين': 'aladdin',
  'كيف تدرب التنين': 'how-to-train-dragon',
  'مدغشقر': 'madagascar',
  'موانا': 'moana',
  'مولان': 'mulan'
};

// Arabic display names for movies
const MOVIE_ARABIC_NAMES = {
  '101 Dalmatians': 'مئة مرقش ومرقش',
  'Angry Birds': 'أنجري بيردز',
  'Despicable Me': 'أنا الحقير',
  'Finding Nemo': 'البحث عن نيمو',
  'Frozen': 'ملكة الثلج',
  'Inside Out': 'قلباً وقالباً',
  'Kung Fu Panda': 'كونغ فو باندا',
  'Lilo & Stitch': 'ليلو وستيتش - الأفلام',
  'Minions': 'المينيونز',
  'Puss In Boots': 'القط ذو الحذاء',
  'Super Mario': 'سوبر ماريو',
  'Toy Story': 'حكاية لعبة',
  'Zootopia': 'زوتوبيا',
  'أطلانتس': 'أطلانتس',
  'الأسد الملك': 'الأسد الملك',
  'الخارقين': 'الخارقون',
  'السنافر': 'السنافر',
  'حياة الإمبراطور الجديدة': 'حياة الإمبراطور',
  'سندريلا': 'سندريلا',
  'شركة المرعبين المحدودة': 'شركة المرعبين',
  'طرزان': 'طرزان',
  'علاء الدين': 'علاء الدين',
  'كيف تدرب التنين': 'كيف تروض تنينك',
  'مدغشقر': 'مدغشقر',
  'موانا': 'موانا',
  'مولان': 'مولان'
};

// === HELPERS ===
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function extractEpisodeNumber(name) {
  const arabicMap = {'١':1,'٢':2,'٣':3,'٤':4,'٥':5,'٦':6,'٧':7,'٨':8,'٩':9,'٠':0};
  // Match الحلقه/الحلقة followed by Arabic numerals
  const halqaArabicMatch = name.match(/الحلق[هة]\s*([٠-٩]+)/);
  if (halqaArabicMatch) {
    let num = '';
    for (const ch of halqaArabicMatch[1]) num += arabicMap[ch] || ch;
    return parseInt(num);
  }
  // Match الحلقه/الحلقة followed by Western numerals (e.g. "الحلقه 33")
  const halqaWesternMatch = name.match(/الحلق[هة]\s*(\d+)/);
  if (halqaWesternMatch) return parseInt(halqaWesternMatch[1]);
  // Match "حلقة" or "حلقه" followed by number
  const halqaShortMatch = name.match(/حلق[هة]\s*(\d+)/);
  if (halqaShortMatch) return parseInt(halqaShortMatch[1]);
  // Match number at start like "33 - title" or "33.mp4"
  const prefixMatch = name.match(/^(\d+)[\s\-\.]/);
  if (prefixMatch) return parseInt(prefixMatch[1]);
  // Match pure number (with optional extension)
  const pureMatch = name.match(/^(\d+)(?:\.\w+)?$/);
  if (pureMatch) return parseInt(pureMatch[1]);
  // Match number anywhere in filename as last resort
  const anyNumMatch = name.match(/(\d+)/);
  if (anyNumMatch) return parseInt(anyNumMatch[1]);
  return null;
}

// For movies: extract part number from filename
function extractPartNumber(name) {
  // Match patterns like "Part 1", "الجزء 1", "1.mp4", "فيلم 1", etc.
  const partMatch = name.match(/(?:part|الجزء|جزء)\s*(\d+)/i);
  if (partMatch) return parseInt(partMatch[1]);
  const numMatch = name.match(/(\d+)/);
  if (numMatch) return parseInt(numMatch[1]);
  return 1; // Default to part 1 if only one file
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
  'ماوكلي': 'mowgli',
  'فلونه': 'flona',
  'هايدي': 'haydy',
  'مستر بين': 'mr-bean'
};

function createShowKey(name) {
  if (ARABIC_TO_ASCII[name]) return ARABIC_TO_ASCII[name];
  if (MOVIE_ARABIC_TO_ASCII[name]) return MOVIE_ARABIC_TO_ASCII[name];
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

// === DYNAMIC SHOWS & MOVIES ===
const SHOWS = {};
const MOVIES = {};
const CARTOON_FILMS = {};    // Standalone cartoon movies (Coco, UP, etc.)
const FOREIGN_FILMS = {};    // Foreign movies (standalone + series)
const ARABIC_FILMS = {};     // Arabic movies
let showKeys = [];
let movieKeys = [];
let cartoonFilmKeys = [];
let foreignFilmKeys = [];
let arabicFilmKeys = [];
let discoveryDone = false;

async function getFilesRecursive(folderId) {
  let files = [];
  try {
    // Get direct video files
    const response = await drive.files.list({
      q: `'${folderId}' in parents and mimeType contains 'video/' and trashed = false`,
      fields: 'files(id, name, mimeType, size)',
      orderBy: 'name',
      supportsAllDrives: true,
      pageSize: 500
    });
    files = response.data.files || [];
    
    // Also get shortcuts (which may point to video files)
    const shortcutResponse = await drive.files.list({
      q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.shortcut' and trashed = false`,
      fields: 'files(id, name, shortcutDetails)',
      supportsAllDrives: true,
      pageSize: 500
    });
    const shortcuts = shortcutResponse.data.files || [];
    for (const sc of shortcuts) {
      if (sc.shortcutDetails && sc.shortcutDetails.targetMimeType && sc.shortcutDetails.targetMimeType.startsWith('video/')) {
        files.push({ id: sc.shortcutDetails.targetId, name: sc.name, mimeType: sc.shortcutDetails.targetMimeType });
      }
    }
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

function buildMeta(show, isMovie) {
  const label = isMovie ? 'الجزء' : 'الحلقة';
  const proxiedPoster = proxyPosterUrl(show.poster);
  return {
    id: 'cartoon-ar:' + show.prefix,
    type: 'series',
    name: show.name,
    poster: proxiedPoster,
    background: proxiedPoster,
    logo: proxiedPoster,
    description: show.metaInfo.description,
    genres: show.metaInfo.genres,
    year: 2024,
    videos: show.allEpisodes.map(epNum => ({
      id: 'cartoon-ar:' + show.prefix + ':' + epNum,
      title: label + ' ' + epNum,
      episode: epNum,
      season: 1,
      released: new Date(2024, 0, epNum).toISOString(),
      overview: show.name + ' - ' + label + ' ' + epNum
    }))
  };
}

// Build meta for standalone movies (type: 'movie' for single-file, 'series' for multi-part)
function buildMovieMeta(film) {
  const proxiedPoster = proxyPosterUrl(film.poster);
  if (film.totalEpisodes === 1) {
    return {
      id: 'cartoon-ar:' + film.prefix,
      type: 'movie',
      name: film.name,
      poster: proxiedPoster,
      background: proxiedPoster,
      description: film.metaInfo.description,
      genres: film.metaInfo.genres,
      year: 2024
    };
  }
  // Multi-part movie shown as series
  return {
    id: 'cartoon-ar:' + film.prefix,
    type: 'series',
    name: film.name,
    poster: proxiedPoster,
    background: proxiedPoster,
    description: film.metaInfo.description,
    genres: film.metaInfo.genres,
    year: 2024,
    videos: film.allEpisodes.map(partNum => ({
      id: 'cartoon-ar:' + film.prefix + ':' + partNum,
      title: 'الجزء ' + partNum,
      episode: partNum,
      season: 1,
      released: new Date(2024, 0, partNum).toISOString(),
      overview: film.name + ' - الجزء ' + partNum
    }))
  };
}

async function discoverShows() {
  if (discoveryDone || !drive) return;
  discoveryDone = true;
  try {
  
  // === Discover TV Series ===
  console.log(`=== Auto-discovering shows from parent folder: ${PARENT_FOLDER_ID} ===`);
  try {
    const response = await drive.files.list({
      q: `'${PARENT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name, mimeType)',
      orderBy: 'name',
      supportsAllDrives: true
    });
    const folders = response.data.files || [];
    console.log(`Found ${folders.length} show subfolders`);
    for (const folder of folders) {
      const folderName = folder.name.trim();
      if (!folderName) continue;
      console.log(`\n📁 Discovering show: ${folderName}`);
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
    // Normalize kwnan -> conan
    if ('kwnan' in SHOWS) {
      SHOWS['conan'] = SHOWS['kwnan'];
      delete SHOWS['kwnan'];
      showKeys = showKeys.map(k => k === 'kwnan' ? 'conan' : k);
      console.log('  🔧 Normalized kwnan -> conan');
    }
    console.log(`\n=== Show discovery complete: ${showKeys.length} shows found ===`);
  } catch (err) {
    console.error('Show discovery error:', err.message);
  }

  // === Discover Movies ===
  console.log(`\n=== Auto-discovering movies from folder: ${MOVIES_FOLDER_ID} ===`);
  try {
    const response = await drive.files.list({
      q: `'${MOVIES_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name, mimeType)',
      orderBy: 'name',
      supportsAllDrives: true
    });
    const folders = response.data.files || [];
    console.log(`Found ${folders.length} movie subfolders`);
    for (const folder of folders) {
      const folderName = folder.name.trim();
      if (!folderName) continue;
      console.log(`\n🎬 Discovering movie: ${folderName}`);
      const files = await getFilesRecursive(folder.id);
      console.log(`  Total files found: ${files.length}`);
      if (files.length === 0) {
        console.log(`  Skipping empty folder`);
        continue;
      }
      // For movies, each file is a "part" (جزء)
      const episodeMap = {};
      if (files.length === 1) {
        // Single movie file = part 1
        episodeMap[1] = files[0].id;
      } else {
        // Multiple files = multiple parts, sort by name/number
        for (let i = 0; i < files.length; i++) {
          const partNum = extractPartNumber(files[i].name);
          if (!episodeMap[partNum]) {
            episodeMap[partNum] = files[i].id;
          } else {
            // If duplicate part number, use index+1
            episodeMap[i + 1] = files[i].id;
          }
        }
      }
      const sortedParts = Object.keys(episodeMap).map(Number).sort((a, b) => a - b);
      const key = MOVIE_ARABIC_TO_ASCII[folderName] || createShowKey(folderName);
      const displayName = MOVIE_ARABIC_NAMES[folderName] || folderName;
      const poster = MOVIE_POSTER_MAP_BY_KEY[key] || MOVIE_POSTER_MAP[folderName] || DEFAULT_POSTER;
      const metaInfo = MOVIE_META[folderName] || {
        description: `سلسلة أفلام ${folderName}`,
        genres: ['Animation', 'Family']
      };
      MOVIES[key] = {
        name: displayName,
        folderId: folder.id,
        poster: poster,
        prefix: key,
        metaInfo: metaInfo,
        allEpisodes: sortedParts,
        episodeMap: episodeMap,
        totalEpisodes: sortedParts.length
      };
      movieKeys.push(key);
      console.log(`  ✅ Key: ${key}, Parts: ${sortedParts.length}`);
    }
    console.log(`\n=== Movie discovery complete: ${movieKeys.length} movies found ===`);
  } catch (err) {
    console.error('Movie discovery error:', err.message);
  }

  // === Discover Standalone Cartoon Movies (كرتون → افلام) ===
  console.log(`\n=== Auto-discovering standalone cartoon movies from: ${CARTOON_MOVIES_FOLDER_ID} ===`);
  try {
    const response = await drive.files.list({
      q: `'${CARTOON_MOVIES_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name, mimeType)',
      orderBy: 'name',
      supportsAllDrives: true,
      pageSize: 200
    });
    const folders = response.data.files || [];
    console.log(`Found ${folders.length} cartoon movie folders`);
    for (const folder of folders) {
      const folderName = folder.name.trim();
      if (!folderName) continue;
      // Skip the existing «سلسله» folder (already handled above)
      if (folder.id === MOVIES_FOLDER_ID) continue;
      console.log(`\n🎬 Discovering cartoon movie: ${folderName}`);
      const files = await getFilesRecursive(folder.id);
      if (files.length === 0) { console.log('  Skipping empty'); continue; }
      const episodeMap = {};
      if (files.length === 1) {
        episodeMap[1] = files[0].id;
      } else {
        for (let i = 0; i < files.length; i++) {
          const partNum = extractPartNumber(files[i].name);
          if (!episodeMap[partNum]) episodeMap[partNum] = files[i].id;
          else episodeMap[i + 1] = files[i].id;
        }
      }
      const sortedParts = Object.keys(episodeMap).map(Number).sort((a, b) => a - b);
      const key = 'cf-' + createShowKey(folderName);
      const firstFileId = files[0] ? files[0].id : null;
      const filmPoster = MOVIE_POSTER_MAP[folderName] || DEFAULT_POSTER;
      CARTOON_FILMS[key] = {
        name: folderName,
        folderId: folder.id,
        poster: filmPoster,
        prefix: key,
        metaInfo: { description: `فلم كرتون ${folderName} مدبلج عربي`, genres: ['Animation', 'Family'] },
        allEpisodes: sortedParts,
        episodeMap: episodeMap,
        totalEpisodes: sortedParts.length
      };
      cartoonFilmKeys.push(key);
      console.log(`  ✅ Key: ${key}, Parts: ${sortedParts.length}`);
    }
    console.log(`\n=== Cartoon movies complete: ${cartoonFilmKeys.length} found ===`);
  } catch (err) {
    console.error('Cartoon movies discovery error:', err.message);
  }

  // === Discover Foreign Movies (افلام اجنبيه) ===
  console.log(`\n=== Auto-discovering foreign movies from: ${FOREIGN_MOVIES_FOLDER_ID} ===`);
  try {
    const response = await drive.files.list({
      q: `'${FOREIGN_MOVIES_FOLDER_ID}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType)',
      orderBy: 'name',
      supportsAllDrives: true,
      pageSize: 200
    });
    const items = response.data.files || [];
    console.log(`Found ${items.length} items in foreign movies`);
    for (const item of items) {
      const folderName = item.name.trim();
      if (!folderName) continue;
      // Skip sub-categories (سلسله and الممثلين) - we handle them separately
      if (item.id === FOREIGN_SERIES_FOLDER_ID || item.id === ACTORS_FOLDER_ID) continue;
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        console.log(`\n🎬 Discovering foreign movie: ${folderName}`);
        const files = await getFilesRecursive(item.id);
        if (files.length === 0) { console.log('  Skipping empty'); continue; }
        const episodeMap = {};
        if (files.length === 1) {
          episodeMap[1] = files[0].id;
        } else {
          for (let i = 0; i < files.length; i++) {
            const partNum = extractPartNumber(files[i].name);
            if (!episodeMap[partNum]) episodeMap[partNum] = files[i].id;
            else episodeMap[i + 1] = files[i].id;
          }
        }
        const sortedParts = Object.keys(episodeMap).map(Number).sort((a, b) => a - b);
        const key = 'ff-' + createShowKey(folderName);
        const ffPoster2 = MOVIE_POSTER_MAP[folderName] || DEFAULT_POSTER;
        FOREIGN_FILMS[key] = {
          name: folderName,
          folderId: item.id,
          poster: ffPoster2,
          prefix: key,
          metaInfo: { description: `فلم ${folderName}`, genres: ['Action', 'Drama'] },
          allEpisodes: sortedParts,
          episodeMap: episodeMap,
          totalEpisodes: sortedParts.length
        };
        foreignFilmKeys.push(key);
        console.log(`  ✅ Key: ${key}, Parts: ${sortedParts.length}`);
      } else if (item.mimeType && item.mimeType.startsWith('video/')) {
        // Direct video file - treat as standalone movie
        const movieName = folderName.replace(/\.(mp4|mkv|avi|mov|webm|m4v)$/i, '').trim();
        const key = 'ff-' + createShowKey(movieName);
        if (FOREIGN_FILMS[key]) continue; // Skip duplicates
        const ffPoster2 = MOVIE_POSTER_MAP[movieName] || DEFAULT_POSTER;
        FOREIGN_FILMS[key] = {
          name: movieName,
          folderId: FOREIGN_MOVIES_FOLDER_ID,
          poster: ffPoster2,
          prefix: key,
          metaInfo: { description: `فلم ${movieName}`, genres: ['Action', 'Drama'] },
          allEpisodes: [1],
          episodeMap: { 1: item.id },
          totalEpisodes: 1
        };
        foreignFilmKeys.push(key);
        console.log(`  ✅ Key: ${key} (direct file)`);
      }
    }
    // Also discover foreign movie SERIES (سلسله)
    console.log(`\n=== Discovering foreign movie series ===`);
    const seriesResponse = await drive.files.list({
      q: `'${FOREIGN_SERIES_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name, mimeType)',
      orderBy: 'name',
      supportsAllDrives: true,
      pageSize: 200
    });
    const seriesFolders = seriesResponse.data.files || [];
    console.log(`Found ${seriesFolders.length} foreign movie series`);
    for (const folder of seriesFolders) {
      const folderName = folder.name.trim();
      if (!folderName) continue;
      console.log(`\n🎬 Discovering series: ${folderName}`);
      const files = await getFilesRecursive(folder.id);
      if (files.length === 0) { console.log('  Skipping empty'); continue; }
      const episodeMap = {};
      if (files.length === 1) {
        episodeMap[1] = files[0].id;
      } else {
        for (let i = 0; i < files.length; i++) {
          const partNum = extractPartNumber(files[i].name);
          if (!episodeMap[partNum]) episodeMap[partNum] = files[i].id;
          else episodeMap[i + 1] = files[i].id;
        }
      }
      const sortedParts = Object.keys(episodeMap).map(Number).sort((a, b) => a - b);
      const key = 'fs-' + createShowKey(folderName);
      const fsPoster = MOVIE_POSTER_MAP[folderName] || DEFAULT_POSTER;
      FOREIGN_FILMS[key] = {
        name: folderName,
        folderId: folder.id,
        poster: fsPoster,
        prefix: key,
        metaInfo: { description: `سلسلة أفلام ${folderName}`, genres: ['Action', 'Adventure'] },
        allEpisodes: sortedParts,
        episodeMap: episodeMap,
        totalEpisodes: sortedParts.length
      };
      foreignFilmKeys.push(key);
      console.log(`  ✅ Key: ${key}, Parts: ${sortedParts.length}`);
    }
    // Also discover by actor (الممثلين)
    console.log(`\n=== Discovering actor folders ===`);
    const actorsResponse = await drive.files.list({
      q: `'${ACTORS_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name, mimeType)',
      orderBy: 'name',
      supportsAllDrives: true,
      pageSize: 200
    });
    const actorFolders = actorsResponse.data.files || [];
    console.log(`Found ${actorFolders.length} actor folders`);
    for (const actorFolder of actorFolders) {
      await sleep(200); // Rate limit
      // Each actor folder contains individual movie folders
      const actorMovies = await drive.files.list({
        q: `'${actorFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name, mimeType)',
        orderBy: 'name',
        supportsAllDrives: true,
        pageSize: 100
      });
      const actorMovieFolders = actorMovies.data.files || [];
      for (const movieFolder of actorMovieFolders) {
        const movieName = movieFolder.name.trim();
        if (!movieName) continue;
        const files = await getFilesRecursive(movieFolder.id);
        if (files.length === 0) continue;
        const episodeMap = {};
        if (files.length === 1) {
          episodeMap[1] = files[0].id;
        } else {
          for (let i = 0; i < files.length; i++) {
            const partNum = extractPartNumber(files[i].name);
            if (!episodeMap[partNum]) episodeMap[partNum] = files[i].id;
            else episodeMap[i + 1] = files[i].id;
          }
        }
        const sortedParts = Object.keys(episodeMap).map(Number).sort((a, b) => a - b);
        const key = 'ff-' + createShowKey(movieName);
        // Skip if already added (from standalone or series)
        if (FOREIGN_FILMS[key]) continue;
        const actPoster = MOVIE_POSTER_MAP[movieName] || DEFAULT_POSTER;
        FOREIGN_FILMS[key] = {
          name: movieName,
          folderId: movieFolder.id,
          poster: actPoster,
          prefix: key,
          metaInfo: { description: `فلم ${movieName} (${actorFolder.name})`, genres: ['Action', 'Drama'] },
          allEpisodes: sortedParts,
          episodeMap: episodeMap,
          totalEpisodes: sortedParts.length
        };
        foreignFilmKeys.push(key);
      }
    }
    console.log(`\n=== Foreign movies complete: ${foreignFilmKeys.length} found ===`);
  } catch (err) {
    console.error('Foreign movies discovery error:', err.message);
  }

  // === Discover Arabic Movies (افلام عربيه) ===
  console.log(`\n=== Auto-discovering Arabic movies from: ${ARABIC_MOVIES_FOLDER_ID} ===`);
  try {
    // Query ALL items (folders AND files) - Arabic movies may be stored as direct video files
    const response = await drive.files.list({
      q: `'${ARABIC_MOVIES_FOLDER_ID}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType)',
      orderBy: 'name',
      supportsAllDrives: true,
      pageSize: 200
    });
    const items = response.data.files || [];
    console.log(`Found ${items.length} items in Arabic movies folder`);
    for (const item of items) {
      const itemName = item.name.trim();
      if (!itemName) continue;
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        // It's a folder - discover files inside it
        console.log(`\n🎬 Discovering Arabic movie folder: ${itemName}`);
        const files = await getFilesRecursive(item.id);
        if (files.length === 0) { console.log('  Skipping empty'); continue; }
        const episodeMap = {};
        if (files.length === 1) {
          episodeMap[1] = files[0].id;
        } else {
          for (let i = 0; i < files.length; i++) {
            const partNum = extractPartNumber(files[i].name);
            if (!episodeMap[partNum]) episodeMap[partNum] = files[i].id;
            else episodeMap[i + 1] = files[i].id;
          }
        }
        const sortedParts = Object.keys(episodeMap).map(Number).sort((a, b) => a - b);
        const key = 'ar-' + createShowKey(itemName);
        const arPoster = MOVIE_POSTER_MAP[itemName] || DEFAULT_POSTER;
        ARABIC_FILMS[key] = {
          name: itemName,
          folderId: item.id,
          poster: arPoster,
          prefix: key,
          metaInfo: { description: `فلم ${itemName}`, genres: ['Comedy', 'Drama'] },
          allEpisodes: sortedParts,
          episodeMap: episodeMap,
          totalEpisodes: sortedParts.length
        };
        arabicFilmKeys.push(key);
        console.log(`  ✅ Key: ${key}, Parts: ${sortedParts.length}`);
      } else if (item.mimeType && item.mimeType.startsWith('video/')) {
        // It's a direct video file - treat as standalone movie
        const movieName = itemName.replace(/\.(mp4|mkv|avi|mov|webm|m4v)$/i, '').trim();
        console.log(`\n🎬 Arabic movie file: ${movieName}`);
        const key = 'ar-' + createShowKey(movieName);
        if (ARABIC_FILMS[key]) continue; // Skip duplicates
        const arPoster = MOVIE_POSTER_MAP[movieName] || DEFAULT_POSTER;
        ARABIC_FILMS[key] = {
          name: movieName,
          folderId: ARABIC_MOVIES_FOLDER_ID,
          poster: arPoster,
          prefix: key,
          metaInfo: { description: `فلم ${movieName}`, genres: ['Comedy', 'Drama'] },
          allEpisodes: [1],
          episodeMap: { 1: item.id },
          totalEpisodes: 1
        };
        arabicFilmKeys.push(key);
        console.log(`  ✅ Key: ${key} (direct file)`);
      } else {
        console.log(`  ⏭️ Skipping non-video: ${itemName} (${item.mimeType})`);
      }
    }
    console.log(`\n=== Arabic movies complete: ${arabicFilmKeys.length} found ===`);
  } catch (err) {
    console.error('Arabic movies discovery error:', err.message);
  }
  } catch (globalErr) {
    console.error('Global discovery error:', globalErr.message);
  }
}

// === BUILD ADDON ===
let addon = null;

function buildAddon() {
  const allPrefixes = ['cartoon-ar'];
  addon = new addonBuilder({
    id: 'local.network.arabic.cartoons',
    name: 'كرتون دريف - Arabic Cartoons & Movies',
    version: '12.4.5',
    description: `كرتون عربي مدبلج - ${showKeys.length} مسلسل + ${movieKeys.length + cartoonFilmKeys.length} فلم كرتون + ${foreignFilmKeys.length} فلم أجنبي + ${arabicFilmKeys.length} فلم عربي`,
    logo: POSTER_MAP['النمر المقنع'] || DEFAULT_POSTER,
    resources: ['catalog', 'meta', 'stream'],
    types: ['series', 'movie'],
    catalogs: [
      {
        type: 'series',
        id: 'cartoons_all',
        name: 'الكل - المسلسلات',
        extra: [{ name: 'skip', isRequired: false }]
      },
      {
        type: 'series',
        id: 'cartoons_movies',
        name: 'أفلام كرتون (سلاسل)',
        extra: [{ name: 'skip', isRequired: false }]
      },
      {
        type: 'movie',
        id: 'cartoon_films',
        name: 'أفلام كرتون',
        extra: [{ name: 'skip', isRequired: false }]
      },
      {
        type: 'movie',
        id: 'foreign_films',
        name: 'أفلام أجنبية',
        extra: [{ name: 'skip', isRequired: false }]
      },
      {
        type: 'movie',
        id: 'arabic_films',
        name: 'أفلام عربية',
        extra: [{ name: 'skip', isRequired: false }]
      }
    ],
    idPrefixes: allPrefixes
  });
  addon.defineCatalogHandler(catalogHandler);
  addon.defineMetaHandler(metaHandler);
  addon.defineStreamHandler(streamHandler);
}

// === CATALOG HANDLER ===
function catalogHandler(args) {
  if (!addon) return Promise.resolve({ metas: [] });
  const skip = args.extra && args.extra.skip ? parseInt(args.extra.skip) : 0;
  
  // Check catalog cache first
  const cacheKey = 'catalog:' + args.id + ':' + skip;
  const cached = catalogCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  if (args.id === 'cartoons_all') {
    const metas = showKeys.map(key => buildMeta(SHOWS[key], false));
    const result = { metas: metas.slice(skip, skip + 100) };
    catalogCache.set(cacheKey, result, CATALOG_TTL);
    return Promise.resolve(result);
  }
  if (args.id === 'cartoons_movies') {
    const metas = movieKeys.map(key => buildMeta(MOVIES[key], true));
    const result = { metas: metas.slice(skip, skip + 100) };
    catalogCache.set(cacheKey, result, CATALOG_TTL);
    return Promise.resolve(result);
  }
  if (args.id === 'cartoon_films') {
    const metas = cartoonFilmKeys.map(key => buildMovieMeta(CARTOON_FILMS[key]));
    const result = { metas: metas.slice(skip, skip + 100) };
    catalogCache.set(cacheKey, result, CATALOG_TTL);
    return Promise.resolve(result);
  }
  if (args.id === 'foreign_films') {
    const metas = foreignFilmKeys.map(key => buildMovieMeta(FOREIGN_FILMS[key]));
    const result = { metas: metas.slice(skip, skip + 100) };
    catalogCache.set(cacheKey, result, CATALOG_TTL);
    return Promise.resolve(result);
  }
  if (args.id === 'arabic_films') {
    const metas = arabicFilmKeys.map(key => buildMovieMeta(ARABIC_FILMS[key]));
    const result = { metas: metas.slice(skip, skip + 100) };
    catalogCache.set(cacheKey, result, CATALOG_TTL);
    return Promise.resolve(result);
  }
  // Legacy single catalog
  if (args.id === 'cartoons') {
    const metas = showKeys.map(key => buildMeta(SHOWS[key], false));
    const result = { metas: metas.slice(skip, skip + 100) };
    catalogCache.set(cacheKey, result, CATALOG_TTL);
    return Promise.resolve(result);
  }
  return Promise.resolve({ metas: [] });
}

// === META HANDLER ===
function metaHandler(args) {
  if (!addon) return Promise.resolve({ meta: null });
  
  // Check meta cache first
  const cacheKey = 'meta:' + args.id;
  const cached = metaCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  // Check shows
  for (const key of showKeys) {
    const show = SHOWS[key];
    const plainMatch = args.id === key;
    const prefixedMatch = args.id === 'cartoon-ar:' + key;
    if (plainMatch || prefixedMatch) {
      const result = { meta: buildMeta(show, false) };
      metaCache.set(cacheKey, result, META_TTL);
      return Promise.resolve(result);
    }
  }
  // Check cartoon movie series
  for (const key of movieKeys) {
    const movie = MOVIES[key];
    const plainMatch = args.id === key;
    const prefixedMatch = args.id === 'cartoon-ar:' + key;
    if (plainMatch || prefixedMatch) {
      const result = { meta: buildMeta(movie, true) };
      metaCache.set(cacheKey, result, META_TTL);
      return Promise.resolve(result);
    }
  }
  // Check standalone cartoon films
  for (const key of cartoonFilmKeys) {
    const film = CARTOON_FILMS[key];
    const plainMatch = args.id === key;
    const prefixedMatch = args.id === 'cartoon-ar:' + key;
    if (plainMatch || prefixedMatch) {
      const result = { meta: buildMovieMeta(film) };
      metaCache.set(cacheKey, result, META_TTL);
      return Promise.resolve(result);
    }
  }
  // Check foreign films
  for (const key of foreignFilmKeys) {
    const film = FOREIGN_FILMS[key];
    const plainMatch = args.id === key;
    const prefixedMatch = args.id === 'cartoon-ar:' + key;
    if (plainMatch || prefixedMatch) {
      const result = { meta: buildMovieMeta(film) };
      metaCache.set(cacheKey, result, META_TTL);
      return Promise.resolve(result);
    }
  }
  // Check Arabic films
  for (const key of arabicFilmKeys) {
    const film = ARABIC_FILMS[key];
    const plainMatch = args.id === key;
    const prefixedMatch = args.id === 'cartoon-ar:' + key;
    if (plainMatch || prefixedMatch) {
      const result = { meta: buildMovieMeta(film) };
      metaCache.set(cacheKey, result, META_TTL);
      return Promise.resolve(result);
    }
  }
  return Promise.resolve({ meta: null });
}

// === STREAM HANDLER ===
function streamHandler(args) {
  if (!addon) return Promise.resolve({ streams: [] });
  
  // Check shows
  for (const key of showKeys) {
    const show = SHOWS[key];
    const prefix = 'cartoon-ar:' + key + ':';
    if (args.id && args.id.startsWith(prefix)) {
      const epNum = parseInt(args.id.split(':')[2]);
      const fileId = show.episodeMap[epNum];
      if (fileId) {
        return Promise.resolve({ streams: [{ name: 'كرتون دريف', title: show.name + ' - الحلقة ' + epNum, url: PUBLIC_URL + '/stream/' + fileId + '/play.mp4' }] });
      }
    }
  }
  // Check cartoon movie series
  for (const key of movieKeys) {
    const movie = MOVIES[key];
    const prefix = 'cartoon-ar:' + key + ':';
    if (args.id && args.id.startsWith(prefix)) {
      const partNum = parseInt(args.id.split(':')[2]);
      const fileId = movie.episodeMap[partNum];
      if (fileId) {
        return Promise.resolve({ streams: [{ name: 'كرتون دريف', title: movie.name + ' - الجزء ' + partNum, url: PUBLIC_URL + '/stream/' + fileId + '/play.mp4' }] });
      }
    }
  }
  // Check standalone cartoon films
  for (const key of cartoonFilmKeys) {
    const film = CARTOON_FILMS[key];
    const plainMatch = args.id === key || args.id === 'cartoon-ar:' + key;
    const prefix = 'cartoon-ar:' + key + ':';
    if (plainMatch || (args.id && args.id.startsWith(prefix))) {
      let fileId;
      if (plainMatch) {
        fileId = film.episodeMap[1];
      } else {
        const partNum = parseInt(args.id.split(':')[2]);
        fileId = film.episodeMap[partNum];
      }
      if (fileId) {
        const partLabel = film.totalEpisodes > 1 ? ' - الجزء ' + (args.id.split(':')[2] || '1') : '';
        return Promise.resolve({ streams: [{ name: 'كرتون دريف', title: film.name + partLabel, url: PUBLIC_URL + '/stream/' + fileId + '/play.mp4' }] });
      }
    }
  }
  // Check foreign films
  for (const key of foreignFilmKeys) {
    const film = FOREIGN_FILMS[key];
    const plainMatch = args.id === key || args.id === 'cartoon-ar:' + key;
    const prefix = 'cartoon-ar:' + key + ':';
    if (plainMatch || (args.id && args.id.startsWith(prefix))) {
      let fileId;
      if (plainMatch) {
        fileId = film.episodeMap[1];
      } else {
        const partNum = parseInt(args.id.split(':')[2]);
        fileId = film.episodeMap[partNum];
      }
      if (fileId) {
        const partLabel = film.totalEpisodes > 1 ? ' - الجزء ' + (args.id.split(':')[2] || '1') : '';
        return Promise.resolve({ streams: [{ name: 'كرتون دريف', title: film.name + partLabel, url: PUBLIC_URL + '/stream/' + fileId + '/play.mp4' }] });
      }
    }
  }
  // Check Arabic films
  for (const key of arabicFilmKeys) {
    const film = ARABIC_FILMS[key];
    const plainMatch = args.id === key || args.id === 'cartoon-ar:' + key;
    const prefix = 'cartoon-ar:' + key + ':';
    if (plainMatch || (args.id && args.id.startsWith(prefix))) {
      let fileId;
      if (plainMatch) {
        fileId = film.episodeMap[1];
      } else {
        const partNum = parseInt(args.id.split(':')[2]);
        fileId = film.episodeMap[partNum];
      }
      if (fileId) {
        return Promise.resolve({ streams: [{ name: 'كرتون دريف', title: film.name, url: PUBLIC_URL + '/stream/' + fileId + '/play.mp4' }] });
      }
    }
  }
  return Promise.resolve({ streams: [] });
}



// === SERVER STARTUP ===
const app = express();

// Stream proxy endpoint
app.get('/stream/:fileId/play.mp4', async (req, res) => {
  try {
    const fileId = req.params.fileId;
    
    // Check token cache first
    let accessToken = streamCache.get('access_token');
    if (!accessToken) {
      const authClient = new google.auth.GoogleAuth({
        credentials: JSON.parse(process.env.GDRIVE_CREDENTIALS),
        scopes: ['https://www.googleapis.com/auth/drive.readonly']
      });
      const client = await authClient.getClient();
      const tokenRes = await client.getAccessToken();
      accessToken = tokenRes.token;
      streamCache.set('access_token', accessToken, 50 * 60 * 1000); // 50 min
    }

    const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const range = req.headers.range;
    const headers = { 'Authorization': `Bearer ${accessToken}` };
    if (range) headers['Range'] = range;

    const proxyReq = https.request(driveUrl, { headers }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'video/mp4',
        'Content-Length': proxyRes.headers['content-length'],
        'Content-Range': proxyRes.headers['content-range'],
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      });
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (err) => {
      console.error('Stream proxy error:', err.message);
      if (!res.headersSent) res.status(502).send('Stream error');
    });
    proxyReq.end();
  } catch (err) {
    console.error('Stream error:', err.message);
    if (!res.headersSent) res.status(500).send('Internal error');
  }
});

// Poster image proxy endpoint (avoids CORS/hotlink issues with TMDB/IMDB)
app.get('/poster/:encoded', async (req, res) => {
  try {
    const encoded = req.params.encoded;
    const url = Buffer.from(encoded, 'base64url').toString('utf8');
    if (!url.startsWith('http')) {
      return res.status(400).send('Invalid URL');
    }
    const cached = posterCache.get(encoded);
    if (cached) {
      res.set('Content-Type', cached.contentType);
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('Access-Control-Allow-Origin', '*');
      return res.send(cached.data);
    }
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!response.ok) {
      return res.status(response.status).send('Image fetch failed');
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (buffer.length < 500000) {
      posterCache.set(encoded, { data: buffer, contentType }, 2 * 60 * 60 * 1000);
    }
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Access-Control-Allow-Origin', '*');
    res.send(buffer);
  } catch (err) {
    console.error('Poster proxy error:', err.message);
    if (!res.headersSent) res.status(502).send('Proxy error');
  }
});
// Health endpoint
app.get('/health', (req, res) => {
  const showKeys = Object.keys(SHOWS);
  const movieKeys = Object.keys(MOVIES);
  const cartoonFilmKeys = Object.keys(CARTOON_FILMS);
  const foreignFilmKeys = Object.keys(FOREIGN_FILMS);
  const arabicFilmKeys = Object.keys(ARABIC_FILMS);
  res.json({
    status: 'ok',
    version: '12.4.5',
    shows: showKeys.length,
    movieSeries: movieKeys.length,
    cartoonFilms: cartoonFilmKeys.length,
    foreignFilms: foreignFilmKeys.length,
    arabicFilms: arabicFilmKeys.length,
    totalEpisodes: showKeys.reduce((sum, k) => sum + SHOWS[k].totalEpisodes, 0),
    cache: {
      streamEntries: streamCache.size,
      catalogEntries: catalogCache.size,
      metaEntries: metaCache.size
    }
  });

app.get('/debug', (req, res) => {
  const showKeys = Object.keys(SHOWS);
  const movieKeys = Object.keys(MOVIES);
  const cartoonFilmKeys2 = Object.keys(CARTOON_FILMS);
  const foreignFilmKeys2 = Object.keys(FOREIGN_FILMS);
  const arabicFilmKeys2 = Object.keys(ARABIC_FILMS);
  res.json({
    version: '12.4.5',
    discoveryDone,
    counts: {
      shows: showKeys.length,
      movieSeries: movieKeys.length,
      cartoonFilms: cartoonFilmKeys2.length,
      foreignFilms: foreignFilmKeys2.length,
      arabicFilms: arabicFilmKeys2.length
    },
    arabicFilmNames: arabicFilmKeys2.map(k => ARABIC_FILMS[k]?.name || k),
    foreignFilmSample: foreignFilmKeys2.slice(0, 10).map(k => FOREIGN_FILMS[k]?.name || k)
  });
});
});

// Discover endpoint (manual re-discovery)
app.get('/discover', async (req, res) => {
  try {
    await discoverShows();
    buildAddon();
    res.json({ status: 'ok', shows: Object.keys(SHOWS).length, movies: Object.keys(MOVIES).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mount Stremio addon
async function startServer() {
  console.log('🚀 Starting server...');
  
  // Build addon and mount router IMMEDIATELY so manifest.json is always available
  buildAddon();
  const addonRouter = getRouter(addon.getInterface());
  app.use(addonRouter);
  console.log('📡 Addon router mounted (manifest.json available)');
  
  // Start Express server (so Render sees the port)
  const PORT = process.env.PORT || 7000;
  app.listen(PORT, () => {
    console.log(`✅ Server listening on port ${PORT}`);
  });
  
  // Discover content in background (populates SHOWS, MOVIES, etc.)
  try {
    await discoverShows();
    console.log(`🎬 Discovery complete! ${Object.keys(SHOWS).length} shows + ${Object.keys(MOVIES).length} movie series + ${Object.keys(CARTOON_FILMS).length} cartoon films + ${Object.keys(FOREIGN_FILMS).length} foreign films + ${Object.keys(ARABIC_FILMS).length} Arabic films`);
  } catch (err) {
    console.error('❌ Discovery error:', err.message);
    // Server still runs with addon routes, just no content yet
  }
}
startServer();
