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
const metaCache = new MemoryCache();     // Meta responses
const META_TTL = 30 * 60 * 1000;        // 30 minutes


const PUBLIC_URL = process.env.PUBLIC_URL || 'https://tiger-mask-arabic.onrender.com';
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
const MOVIE_POSTER_MAP = {};

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
  return {
    id: 'cartoon-ar:' + show.prefix,
    type: 'series',
    name: show.name,
    poster: show.poster,
    background: show.poster,
    logo: show.poster,
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
  if (film.totalEpisodes === 1) {
    return {
      id: 'cartoon-ar:' + film.prefix,
      type: 'movie',
      name: film.name,
      poster: film.poster,
      background: film.poster,
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
    poster: film.poster,
    background: film.poster,
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
      CARTOON_FILMS[key] = {
        name: folderName,
        folderId: folder.id,
        poster: DEFAULT_POSTER,
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
      if (item.mimeType !== 'application/vnd.google-apps.folder') continue;
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
      FOREIGN_FILMS[key] = {
        name: folderName,
        folderId: item.id,
        poster: DEFAULT_POSTER,
        prefix: key,
        metaInfo: { description: `فلم ${folderName}`, genres: ['Action', 'Drama'] },
        allEpisodes: sortedParts,
        episodeMap: episodeMap,
        totalEpisodes: sortedParts.length
      };
      foreignFilmKeys.push(key);
      console.log(`  ✅ Key: ${key}, Parts: ${sortedParts.length}`);
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
      FOREIGN_FILMS[key] = {
        name: folderName,
        folderId: folder.id,
        poster: DEFAULT_POSTER,
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
        FOREIGN_FILMS[key] = {
          name: movieName,
          folderId: movieFolder.id,
          poster: DEFAULT_POSTER,
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
    const response = await drive.files.list({
      q: `'${ARABIC_MOVIES_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name, mimeType)',
      orderBy: 'name',
      supportsAllDrives: true,
      pageSize: 200
    });
    const folders = response.data.files || [];
    console.log(`Found ${folders.length} Arabic movie folders`);
    for (const folder of folders) {
      const folderName = folder.name.trim();
      if (!folderName) continue;
      console.log(`\n🎬 Discovering Arabic movie: ${folderName}`);
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
      const key = 'ar-' + createShowKey(folderName);
      ARABIC_FILMS[key] = {
        name: folderName,
        folderId: folder.id,
        poster: DEFAULT_POSTER,
        prefix: key,
        metaInfo: { description: `فلم ${folderName}`, genres: ['Comedy', 'Drama'] },
        allEpisodes: sortedParts,
        episodeMap: episodeMap,
        totalEpisodes: sortedParts.length
      };
      arabicFilmKeys.push(key);
      console.log(`  ✅ Key: ${key}, Parts: ${sortedParts.length}`);
    }
    console.log(`\n=== Arabic movies complete: ${arabicFilmKeys.length} found ===`);
  } catch (err) {
    console.error('Arabic movies discovery error:', err.message);
  }
}

// === BUILD ADDON ===
let addon = null;

function buildAddon() {
  const allPrefixes = ['cartoon-ar', ...showKeys, ...movieKeys, ...cartoonFilmKeys, ...foreignFilmKeys, ...arabicFilmKeys];
  addon = new addonBuilder({
    id: 'local.network.arabic.cartoons',
    name: 'كرتون دريف - Arabic Cartoons & Movies',
    version: '12.0.0',
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


