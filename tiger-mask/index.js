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
  'اسطورة زورو': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/RHnlhRTqksDuSZrQ.jpg',
  'بوكيمون': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/MrCXyBcpoWZQDDGB.jpg',
  'تيمون و بومبا': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/GLdtyEmfYSmdYVLP.jpg',
  'حكايات عالميه': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/tuufXlZKldaVlwzo.jpg',
  'ساسوكي': 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/EXUPPIBVFXRcHnna.jpg',
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
let showKeys = [];
let movieKeys = [];
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
}

// === BUILD ADDON ===
let addon = null;

function buildAddon() {
  const allPrefixes = ['cartoon-ar', ...showKeys, ...movieKeys];
  addon = new addonBuilder({
    id: 'local.network.arabic.cartoons',
    name: 'كرتون دريف - Arabic Cartoons',
    version: '11.1.0',
    description: `كرتون عربي مدبلج - ${showKeys.length} مسلسل + ${movieKeys.length} سلسلة أفلام`,
    logo: POSTER_MAP['النمر المقنع'] || DEFAULT_POSTER,
    resources: ['catalog', 'meta', 'stream'],
    types: ['series'],
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
        name: 'أفلام كرتون',
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
  if (!addon || args.type !== 'series') return Promise.resolve({ meta: null });
  
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
  // Check movies
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
      const epNum = parseInt(args.id.substring(prefix.length));
      if (show.episodeMap[epNum] && drive) {
        const fileId = show.episodeMap[epNum];
        return Promise.resolve({
          streams: [{
            title: show.name + ' - الحلقة ' + epNum + ' (Google Drive)',
            url: PUBLIC_URL + '/stream-proxy?id=' + fileId
          }]
        });
      }
    }
    // Backwards compat: key:episode
    if (args.id && args.id.startsWith(key + ':')) {
      const parts = args.id.split(':');
      if (parts.length >= 2) {
        const epNum = parseInt(parts[1]);
        if (show.episodeMap[epNum] && drive) {
          const fileId = show.episodeMap[epNum];
          return Promise.resolve({
            streams: [{
              title: show.name + ' - الحلقة ' + epNum + ' (Google Drive)',
              url: PUBLIC_URL + '/stream-proxy?id=' + fileId
            }]
          });
        }
      }
    }
  }
  
  // Check movies
  for (const key of movieKeys) {
    const movie = MOVIES[key];
    const prefix = 'cartoon-ar:' + key + ':';
    if (args.id && args.id.startsWith(prefix)) {
      const partNum = parseInt(args.id.substring(prefix.length));
      if (movie.episodeMap[partNum] && drive) {
        const fileId = movie.episodeMap[partNum];
        return Promise.resolve({
          streams: [{
            title: movie.name + ' - الجزء ' + partNum + ' (Google Drive)',
            url: PUBLIC_URL + '/stream-proxy?id=' + fileId
          }]
        });
      }
    }
    if (args.id && args.id.startsWith(key + ':')) {
      const parts = args.id.split(':');
      if (parts.length >= 2) {
        const partNum = parseInt(parts[1]);
        if (movie.episodeMap[partNum] && drive) {
          const fileId = movie.episodeMap[partNum];
          return Promise.resolve({
            streams: [{
              title: movie.name + ' - الجزء ' + partNum + ' (Google Drive)',
              url: PUBLIC_URL + '/stream-proxy?id=' + fileId
            }]
          });
        }
      }
    }
  }
  return Promise.resolve({ streams: [] });
}

// === ROUTES ===
const app = express();

// JSON suffix normalization for Vidi compatibility
app.use(function(req, res, next) {
  const path = req.path;
  if (!path.endsWith('.json') && !path.endsWith('/') &&
      (path.startsWith('/catalog/') || path.startsWith('/meta/') || path.startsWith('/stream/') ||
       path.startsWith('/configure/') || path.startsWith('/manifest'))) {
    req.url = path + '.json' + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '');
  }
  next();
});

app.get('/', function(req, res) {
  res.send(buildLandingPage());
});

function buildLandingPage() {
  let showCards = '';
  for (const key of showKeys) {
    const show = SHOWS[key];
    showCards += `
      <div class="show-card">
        <img src="${show.poster}" alt="${show.name}" loading="lazy">
        <div class="show-info">
          <h3>${show.name}</h3>
          <p>${show.totalEpisodes} حلقة</p>
          <p class="genre">${(show.metaInfo.genres || []).join(' • ')}</p>
        </div>
      </div>`;
  }
  let movieCards = '';
  for (const key of movieKeys) {
    const movie = MOVIES[key];
    movieCards += `
      <div class="show-card">
        <img src="${movie.poster}" alt="${movie.name}" loading="lazy">
        <div class="show-info">
          <h3>${movie.name}</h3>
          <p>${movie.totalEpisodes} أجزاء</p>
          <p class="genre">${(movie.metaInfo.genres || []).join(' • ')}</p>
        </div>
      </div>`;
  }
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>كرتون دريف - مدبلج</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background: #0a0a0a; color: #fff; direction: rtl; }
    .header { background: linear-gradient(135deg, #1a1a2e, #16213e); padding: 40px 20px; text-align: center; border-bottom: 2px solid #e94560; }
    .header h1 { font-size: 2.5em; margin-bottom: 10px; color: #e94560; }
    .header p { font-size: 1.2em; color: #aaa; margin-bottom: 20px; }
    .addon-links { display: flex; gap: 15px; justify-content: center; flex-wrap: wrap; }
    .addon-links a { background: #e94560; color: white; padding: 12px 25px; border-radius: 8px; text-decoration: none; font-weight: bold; transition: background 0.3s; }
    .addon-links a:hover { background: #c73e54; }
    .addon-links a.secondary { background: #16213e; border: 1px solid #e94560; }
    .container { max-width: 1200px; margin: 0 auto; padding: 30px 20px; }
    .section-title { font-size: 1.5em; color: #e94560; margin: 30px 0 15px; border-bottom: 1px solid #333; padding-bottom: 10px; }
    .shows-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 20px; }
    .show-card { background: #1a1a2e; border-radius: 12px; overflow: hidden; transition: transform 0.3s, box-shadow 0.3s; }
    .show-card:hover { transform: translateY(-5px); box-shadow: 0 10px 30px rgba(233,69,96,0.2); }
    .show-card img { width: 100%; aspect-ratio: 2/3; object-fit: cover; }
    .show-info { padding: 12px; }
    .show-info h3 { font-size: 0.95em; margin-bottom: 5px; color: #fff; }
    .show-info p { font-size: 0.85em; color: #aaa; }
    .show-info .genre { font-size: 0.75em; color: #e94560; margin-top: 5px; }
    .stats { text-align: center; padding: 20px; color: #666; font-size: 0.9em; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🎬 كرتون دريف</h1>
    <p>كرتون عربي مدبلج - ${showKeys.length} مسلسل + ${movieKeys.length} سلسلة أفلام</p>
    <div class="addon-links">
      <a href="${PUBLIC_URL}/manifest.json" target="_blank">📺 إضافة لـ Stremio</a>
      <a href="vidi://${PUBLIC_URL.replace('https://', '')}/manifest.json" class="secondary">📱 إضافة لـ Vidi</a>
    </div>
  </div>
  <div class="container">
    <h2 class="section-title">📺 المسلسلات (${showKeys.length})</h2>
    <div class="shows-grid">${showCards}</div>
    <h2 class="section-title">🎬 أفلام كرتون (${movieKeys.length})</h2>
    <div class="shows-grid">${movieCards}</div>
    <div class="stats">الإصدار: v11.1.0 | المسلسلات: ${showKeys.length} | الأفلام: ${movieKeys.length}</div>
  </div>
</body>
</html>`;
}

app.options('/stream-proxy', function(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Range, Accept, Content-Type, Authorization');
  res.set('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Type');
  res.set('Accept-Ranges', 'bytes');
  res.status(204).end();
});

app.options('*', function(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Range, Accept, Content-Type, Authorization');
  res.status(204).end();
});

app.get('/stream-proxy', async function(req, res) {
  const fileId = req.query.id;
  if (!fileId) return res.status(400).send('Missing file ID');
  if (!drive) return res.status(500).send('Google Drive not configured.');

  // Try cached access token first (avoids Google Auth API call)
  const cachedToken = streamCache.get('token');
  if (cachedToken) {
    const options = {
      hostname: 'www.googleapis.com',
      port: 443,
      path: `/drive/v3/files/${fileId}?alt=media`,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + cachedToken,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Range': req.headers.range || 'bytes=0-'
      }
    };
    const proxyReq = https.get(options, (proxyRes) => {
      if (proxyRes.statusCode === 401) {
        // Token expired, clear and retry fresh
        streamCache.store.delete('token');
        handleStreamFresh(fileId, req, res);
        return;
      }
      if (proxyRes.statusCode === 403 || proxyRes.statusCode === 404) {
        // File-level issue, try fallback with same token
        handleStreamFallback(fileId, cachedToken, req, res);
        return;
      }
      handleStreamResponse(proxyRes, req, res);
    });
    proxyReq.on('error', () => {
      streamCache.store.delete('token');
      handleStreamFresh(fileId, req, res);
    });
    return;
  }

  handleStreamFresh(fileId, req, res);
});

async function handleStreamFresh(fileId, req, res) {
  try {
    const client = await driveAuth.getClient();
    const accessToken = await client.getAccessToken();
    // Cache the access token (same token works for all files)
    streamCache.set('token', accessToken.token, STREAM_TTL);

    const options = {
      hostname: 'www.googleapis.com',
      port: 443,
      path: `/drive/v3/files/${fileId}?alt=media`,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + accessToken.token,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Range': req.headers.range || 'bytes=0-'
      }
    };
    const proxyReq = https.get(options, (proxyRes) => {
      if (proxyRes.statusCode === 403 || proxyRes.statusCode === 404) {
        handleStreamFallback(fileId, accessToken.token, req, res);
        return;
      }
      handleStreamResponse(proxyRes, req, res);
    });
    proxyReq.on('error', err => res.status(500).send(err.message));
  } catch (err) { res.status(500).send(err.message); }
}

function handleStreamFallback(fileId, token, req, res) {
  drive.files.get({ fileId, fields: 'webContentLink', supportsAllDrives: true }, function(err, fileResult) {
    if (err || !fileResult.data.webContentLink) return res.status(500).send('Unable to access file');
    const fallbackUrl = new URL(fileResult.data.webContentLink);
    https.get({
      hostname: fallbackUrl.hostname, port: 443,
      path: fallbackUrl.pathname + fallbackUrl.search, method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token, 'User-Agent': 'Mozilla/5.0', 'Range': req.headers.range || 'bytes=0-' }
    }, (fallbackRes) => handleStreamResponse(fallbackRes, req, res)).on('error', err => res.status(500).send(err.message));
  });
}

function handleStreamResponse(proxyRes, req, res) {
  const headers = {};
  for (const key in proxyRes.headers) {
    if (!['transfer-encoding', 'connection', 'set-cookie', 'content-security-policy'].includes(key)) headers[key] = proxyRes.headers[key];
  }
  headers['Access-Control-Allow-Origin'] = '*';
  if (proxyRes.headers['content-range']) { headers['Content-Range'] = proxyRes.headers['content-range']; headers['Accept-Ranges'] = 'bytes'; }
  res.writeHead(proxyRes.statusCode, headers);
  proxyRes.pipe(res);
}


app.get('/health', function(req, res) {
  const healthData = { status: 'ok', driveConfigured: !!drive, parentFolderId: PARENT_FOLDER_ID, moviesFolderId: MOVIES_FOLDER_ID, version: '11.1.0', cache: { streamEntries: streamCache.size, catalogEntries: catalogCache.size, metaEntries: metaCache.size }, shows: {}, movies: {} };
  for (const key of showKeys) {
    const show = SHOWS[key];
    healthData.shows[key] = { name: show.name, folderId: show.folderId, episodesLoaded: show.totalEpisodes };
  }
  for (const key of movieKeys) {
    const movie = MOVIES[key];
    healthData.movies[key] = { name: movie.name, folderId: movie.folderId, partsLoaded: movie.totalEpisodes };
  }
  res.json(healthData);
});

app.get('/discover', async function(req, res) {
  if (!drive) return res.status(500).send('Drive not configured');
  // Clear all caches on re-discovery
  streamCache.clear(); catalogCache.clear(); metaCache.clear();
  discoveryDone = false; showKeys = []; movieKeys = [];
  Object.keys(SHOWS).forEach(k => delete SHOWS[k]);
  Object.keys(MOVIES).forEach(k => delete MOVIES[k]);
  await discoverShows(); buildAddon();
  const result = { shows: {}, movies: {} };
  for (const key of showKeys) { result.shows[key] = { name: SHOWS[key].name, episodes: SHOWS[key].totalEpisodes }; }
  for (const key of movieKeys) { result.movies[key] = { name: MOVIES[key].name, parts: MOVIES[key].totalEpisodes }; }
  res.json(result);
});

app.use('/', function(req, res, next) {
  if (addon) {
    const router = getRouter(addon.getInterface());
    router(req, res, next);
  } else {
    res.json({ error: 'Discovery in progress, please wait' });
  }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, async () => {
  console.log('كرتون دريف Addon v11.1.0 running on port ' + PORT);
  console.log('Public URL: ' + PUBLIC_URL);
  console.log('Shows Folder: ' + PARENT_FOLDER_ID);
  console.log('Movies Folder: ' + MOVIES_FOLDER_ID);
  console.log('Drive configured: ' + !!drive);
  if (drive) {
    await discoverShows();
    buildAddon();
    console.log(`Addon ready! ${showKeys.length} shows + ${movieKeys.length} movies`);
  }
});
