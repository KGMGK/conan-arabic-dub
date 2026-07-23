/**
 * كرتون دريف - Stremio Addon v13.0.0
 * Google Drive-based addon with optimized single-query discovery
 * Uses parents field to classify content without N+1 queries
 */

const express = require('express');
const app = express();

// Google Drive API credentials
const CLIENT_ID = process.env.GDRIVE_CLIENT_ID || '138754935320-25jni7qoj5p90oorqcdjmqhfs38c898a.apps.googleusercontent.com';
const CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET || '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';
const REFRESH_TOKEN = process.env.GDRIVE_REFRESH_TOKEN || '1//0gq8LSIWKBNDjCgYIARAAGBASNwF-L9IrHwGZG9ySHE7nHmiMBHEqvGw6iD1g91MgkdvLmCBbHsNipPmxO5krOjvvfUSammvn9G0';

const DRIVE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_FILES_URL = 'https://content.googleapis.com/drive/v3/files';

// Cache state
let cache = {
    shows: {},
    arabicMovies: [],
    foreignMovies: [],
    allMovies: [],
    ready: false,
    building: false,
    lastBuild: 0,
};
const CACHE_TTL = 15 * 60 * 1000;

// Arabic character detection
function isArabic(name) {
    return /[\u0600-\u06FF]/.test(name);
}

function isVideo(mimeType) {
    return mimeType && mimeType.includes('video/');
}

// Get access token
async function getAccessToken() {
    try {
        const params = new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            refresh_token: REFRESH_TOKEN,
            grant_type: 'refresh_token',
        });
        const res = await fetch(DRIVE_TOKEN_URL, {
            method: 'POST',
            body: params,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        if (!res.ok) throw new Error(`Token error: ${res.status}`);
        const data = await res.json();
        return data.access_token;
    } catch (err) {
        console.error('Failed to get access token:', err.message);
        return null;
    }
}

// Fetch all files with pagination
async function fetchAllFiles(token, query, fields) {
    const allFiles = [];
    let nextPageToken = null;

    while (true) {
        const params = new URLSearchParams({
            q: query,
            corpora: 'allDrives',
            includeItemsFromAllDrives: 'true',
            supportsAllDrives: 'true',
            pageSize: '1000',
            fields,
        });
        if (nextPageToken) params.set('pageToken', nextPageToken);

        const res = await fetch(`${DRIVE_FILES_URL}?${params.toString()}`, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
            console.error('Drive API error:', res.status);
            return null;
        }

        const data = await res.json();
        const files = data.files || [];
        allFiles.push(...files);

        nextPageToken = data.nextPageToken;
        if (!nextPageToken || files.length === 0) break;
    }

    return allFiles;
}

// Build the content index (optimized: single query approach)
async function buildIndex() {
    if (cache.building) return;
    cache.building = true;
    console.log('Building content index...');

    const token = await getAccessToken();
    if (!token) {
        console.error('Failed to get access token');
        cache.building = false;
        return;
    }

    try {
        // Step 1: Get all video files WITH parents info (single query)
        console.log('Fetching video files with parents...');
        const allVideos = await fetchAllFiles(token,
            "trashed=false and mimeType contains 'video/'",
            'nextPageToken,files(id,name,mimeType,size,createdTime,parents)'
        );
        if (!allVideos) throw new Error('Failed to fetch files');
        console.log(`Found ${allVideos.length} video files`);

        // Step 2: Get all folders (to know which parent IDs are folders)
        console.log('Fetching folders...');
        const folderList = await fetchAllFiles(token,
            "trashed=false and mimeType = 'application/vnd.google-apps.folder'",
            'nextPageToken,files(id,name)'
        );
        if (!folderList) throw new Error('Failed to fetch folders');
        
        const folderMap = {}; // id -> name
        for (const f of folderList) {
            folderMap[f.id] = f.name;
        }
        console.log(`Found ${Object.keys(folderMap).length} folders`);

        // Step 3: Group videos by parent folder
        console.log('Classifying content...');
        const folderVideos = {}; // folderName -> [files]

        for (const file of allVideos) {
            const parents = file.parents || [];
            let assigned = false;
            for (const parentId of parents) {
                if (folderMap[parentId]) {
                    const folderName = folderMap[parentId];
                    if (!folderVideos[folderName]) folderVideos[folderName] = [];
                    folderVideos[folderName].push(file);
                    assigned = true;
                    break; // Only assign to first matching folder
                }
            }
        }

        // Step 4: Separate shows (2+ videos in folder) from standalone movies
        const shows = {};
        const standaloneFiles = [];
        const filesInShows = new Set();

        for (const [folderName, files] of Object.entries(folderVideos)) {
            if (files.length >= 2) {
                shows[folderName] = {
                    episodes: files.map(f => ({
                        id: f.id,
                        name: f.name,
                        size: f.size,
                        createdTime: f.createdTime,
                    })),
                    episodeCount: files.length,
                };
                files.forEach(f => filesInShows.add(f.id));
            } else {
                // Folder with only 1 video = standalone movie
                standaloneFiles.push(...files);
            }
        }

        // Files not in any known folder are also standalone movies
        for (const file of allVideos) {
            if (!filesInShows.has(file.id)) {
                standaloneFiles.push(file);
            }
        }

        // Step 5: Classify movies by language
        const arabicMovies = standaloneFiles.filter(m => isArabic(m.name));
        const foreignMovies = standaloneFiles.filter(m => !isArabic(m.name));

        const totalEpisodes = Object.values(shows).reduce((sum, s) => sum + s.episodeCount, 0);

        cache.shows = shows;
        cache.arabicMovies = arabicMovies;
        cache.foreignMovies = foreignMovies;
        cache.allMovies = standaloneFiles;
        cache.ready = true;
        cache.building = false;
        cache.lastBuild = Date.now();

        console.log('=== Cache Built ===');
        console.log(`Shows: ${Object.keys(shows).length} (${totalEpisodes} episodes)`);
        console.log(`Arabic movies: ${arabicMovies.length}`);
        console.log(`Foreign movies: ${foreignMovies.length}`);
        console.log(`Total standalone: ${standaloneFiles.length}`);

    } catch (err) {
        console.error('Error building index:', err.message);
        cache.building = false;
    }
}

// Format file size
function formatSize(bytes) {
    if (!bytes) return 'غير معروف';
    const size = parseInt(bytes);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(0)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Encode/decode show name to ID
function showNameToId(name) {
    return Buffer.from(name).toString('base64').replace(/=+$/, '').slice(0, 50);
}

function idToShowName(encoded) {
    try {
        let padded = encoded;
        while (padded.length % 4 !== 0) padded += '=';
        return Buffer.from(padded, 'base64').toString('utf8');
    } catch {
        return null;
    }
}

// Manifest
const manifest = {
    id: 'com.cartoon-drive-addon',
    name: 'كرتون دريف - Arabic Cartoons & Movies',
    version: '13.0.0',
    description: 'كرتون عربي مدبلج - مسلسلات وأفلام',
    logo: 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663826037843/LsuDmIaieeZCDhRi.jpg',
    resources: ['catalog', 'meta', 'stream'],
    types: ['series', 'movie'],
    catalogs: [
        {
            type: 'series',
            id: 'cartoons_all',
            name: 'الكل - المسلسلات',
            extra: [{ name: 'skip', isRequired: false }],
        },
        {
            type: 'series',
            id: 'cartoons_movies',
            name: 'أفلام كرتون (سلاسل)',
            extra: [{ name: 'skip', isRequired: false }],
        },
        {
            type: 'movie',
            id: 'cartoon_films',
            name: 'أفلام كرتون',
            extra: [{ name: 'skip', isRequired: false }],
        },
        {
            type: 'movie',
            id: 'foreign_films',
            name: 'أفلام أجنبية',
            extra: [{ name: 'skip', isRequired: false }],
        },
        {
            type: 'movie',
            id: 'arabic_films',
            name: 'أفلام عربية',
            extra: [{ name: 'skip', isRequired: false }],
        },
    ],
    idPrefixes: ['cartoon-ar'],
};

// Description
function getDescription() {
    if (!cache.ready) return 'جارِ بناء فهرس المحتوى...';
    const showCount = Object.keys(cache.shows).length;
    const totalEpisodes = Object.values(cache.shows).reduce((sum, s) => sum + s.episodeCount, 0);
    const arabicCount = cache.arabicMovies.length;
    const foreignCount = cache.foreignMovies.length;
    return `كرتون عربي مدبلج - ${showCount} مسلسل (${totalEpisodes} حلقة) + ${arabicCount} فيلم عربي + ${foreignCount} فيلم أجنبي`;
}

// Routes
app.get('/manifest.json', (req, res) => {
    res.json({ ...manifest, description: getDescription() });
});
app.get('/', (req, res) => res.redirect('/manifest.json'));

// Catalog: All Shows
app.get('/catalog/series/cartoons_all/:skip?.json', async (req, res) => {
    if (!cache.ready) return res.status(503).json({ error: 'Cache not ready' });
    const skip = parseInt(req.params.skip || '0');
    const showEntries = Object.entries(cache.shows);
    const sliced = showEntries.slice(skip, skip + 50);

    const metas = sliced.map(([name, data]) => ({
        id: `cartoon-ar:show:${showNameToId(name)}`,
        name,
        type: 'series',
        poster: `https://via.placeholder.com/184x275/1a1a2e/ffd700?text=${encodeURIComponent(name.slice(0, 15))}`,
        posterShape: 'portrait',
        description: `${data.episodeCount} حلقة`,
        year: new Date(data.episodes[0]?.createdTime || Date.now()).getFullYear(),
    }));

    res.json({ metas });
});

// Catalog: Cartoon Movie Series (multi-part films)
app.get('/catalog/series/cartoons_movies/:skip?.json', async (req, res) => {
    if (!cache.ready) return res.status(503).json({ error: 'Cache not ready' });
    const skip = parseInt(req.params.skip || '0');

    const seriesGroups = {};
    for (const movie of cache.allMovies) {
        const match = movie.name.match(/^(.+?)\s+\d+[\s(]/);
        if (match && isArabic(match[1].trim()) && match[1].trim().length > 2) {
            const baseName = match[1].trim();
            if (!seriesGroups[baseName]) seriesGroups[baseName] = [];
            seriesGroups[baseName].push(movie);
        }
    }

    const series = Object.entries(seriesGroups)
        .filter(([_, parts]) => parts.length >= 2)
        .slice(skip, skip + 50);

    const metas = series.map(([name, parts]) => ({
        id: `cartoon-ar:series:${showNameToId(name)}`,
        name,
        type: 'series',
        poster: `https://via.placeholder.com/184x275/1a1a2e/ffd700?text=${encodeURIComponent(name.slice(0, 15))}`,
        posterShape: 'portrait',
        description: `${parts.length} أجزاء`,
    }));

    res.json({ metas });
});

// Catalog: Cartoon Films (Arabic movies)
app.get('/catalog/movie/cartoon_films/:skip?.json', async (req, res) => {
    if (!cache.ready) return res.status(503).json({ error: 'Cache not ready' });
    const skip = parseInt(req.params.skip || '0');

    // Arabic movies that are standalone (not part of a series)
    const seriesGroups = {};
    for (const movie of cache.allMovies) {
        const match = movie.name.match(/^(.+?)\s+\d+[\s(]/);
        if (match && isArabic(match[1].trim()) && match[1].trim().length > 2) {
            const baseName = match[1].trim();
            if (!seriesGroups[baseName]) seriesGroups[baseName] = [];
            seriesGroups[baseName].push(movie);
        }
    }

    const seriesBaseNames = new Set(
        Object.entries(seriesGroups)
            .filter(([_, parts]) => parts.length >= 2)
            .map(([name, _]) => name)
    );

    const singleMovies = cache.allMovies.filter(m => {
        if (!isArabic(m.name)) return false;
        const match = m.name.match(/^(.+?)\s+\d+[\s(]/);
        if (match && seriesBaseNames.has(match[1].trim())) return false;
        return true;
    });

    const sliced = singleMovies.slice(skip, skip + 50);
    const metas = sliced.map(m => ({
        id: `cartoon-ar:movie:${m.id}`,
        name: m.name.replace(/\.\w+$/, '').replace(/\s*\(.*?\)/g, ''),
        type: 'movie',
        poster: `https://via.placeholder.com/184x275/1a1a2e/ffd700?text=${encodeURIComponent(m.name.slice(0, 15))}`,
        posterShape: 'portrait',
        description: `حجم: ${formatSize(m.size)}`,
        year: new Date(m.createdTime || Date.now()).getFullYear(),
    }));

    res.json({ metas });
});

// Catalog: Foreign Films
app.get('/catalog/movie/foreign_films/:skip?.json', async (req, res) => {
    if (!cache.ready) return res.status(503).json({ error: 'Cache not ready' });
    const skip = parseInt(req.params.skip || '0');
    const sliced = cache.foreignMovies.slice(skip, skip + 50);

    const metas = sliced.map(m => ({
        id: `cartoon-ar:movie:${m.id}`,
        name: m.name.replace(/\.\w+$/, '').replace(/\s*\(.*?\)/g, ''),
        type: 'movie',
        poster: `https://via.placeholder.com/184x275/1a1a2e/ffd700?text=${encodeURIComponent(m.name.slice(0, 15))}`,
        posterShape: 'portrait',
        description: `Size: ${formatSize(m.size)}`,
        year: new Date(m.createdTime || Date.now()).getFullYear(),
    }));

    res.json({ metas });
});

// Catalog: Arabic Films
app.get('/catalog/movie/arabic_films/:skip?.json', async (req, res) => {
    if (!cache.ready) return res.status(503).json({ error: 'Cache not ready' });
    const skip = parseInt(req.params.skip || '0');
    const sliced = cache.arabicMovies.slice(skip, skip + 50);

    const metas = sliced.map(m => ({
        id: `cartoon-ar:movie:${m.id}`,
        name: m.name.replace(/\.\w+$/, '').replace(/\s*\(.*?\)/g, ''),
        type: 'movie',
        poster: `https://via.placeholder.com/184x275/1a1a2e/ffd700?text=${encodeURIComponent(m.name.slice(0, 15))}`,
        posterShape: 'portrait',
        description: `حجم: ${formatSize(m.size)}`,
        year: new Date(m.createdTime || Date.now()).getFullYear(),
    }));

    res.json({ metas });
});

// Meta: Series
app.get('/meta/series/:id.json', async (req, res) => {
    if (!cache.ready) return res.json({ meta: null });

    const encoded = req.params.id.split(':')[1];
    if (!encoded) return res.json({ meta: null });

    const showName = idToShowName(encoded);
    const show = cache.shows?.[showName];
    if (!show) return res.json({ meta: null });

    res.json({
        meta: {
            id: `cartoon-ar:show:${encoded}`,
            name: showName,
            type: 'series',
            poster: `https://via.placeholder.com/184x275/1a1a2e/ffd700?text=${encodeURIComponent(showName.slice(0, 15))}`,
            posterShape: 'portrait',
            background: `https://via.placeholder.com/1920x1080/1a1a2e/ffd700?text=${encodeURIComponent(showName.slice(0, 20))}`,
            description: `مسلسل كرتون عربي مدبلج - ${show.episodeCount} حلقة`,
            year: new Date(show.episodes[0]?.createdTime || Date.now()).getFullYear(),
            videos: show.episodes.map((ep, idx) => ({
                id: ep.id,
                episode: idx + 1,
                season: 1,
                title: ep.name.replace(/\.\w+$/, ''),
                released: ep.createdTime,
            })),
        },
    });
});

// Meta: Movie
app.get('/meta/movie/:id.json', async (req, res) => {
    if (!cache.ready) return res.json({ meta: null });

    const fileId = req.params.id.split(':')[1];
    const movie = cache.allMovies.find(m => m.id === fileId);
    if (!movie) return res.json({ meta: null });

    res.json({
        meta: {
            id: `cartoon-ar:movie:${fileId}`,
            name: movie.name.replace(/\.\w+$/, '').replace(/\s*\(.*?\)/g, ''),
            type: 'movie',
            poster: `https://via.placeholder.com/184x275/1a1a2e/ffd700?text=${encodeURIComponent(movie.name.slice(0, 15))}`,
            posterShape: 'portrait',
            background: `https://via.placeholder.com/1920x1080/1a1a2e/ffd700?text=${encodeURIComponent(movie.name.slice(0, 20))}`,
            description: `حجم: ${formatSize(movie.size)}`,
            year: new Date(movie.createdTime || Date.now()).getFullYear(),
        },
    });
});

// Stream
app.get('/stream/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;

    if (!cache.ready) {
        return res.json({ streams: [{ name: 'جارِ تحميل المحتوى...' }] });
    }

    // Movie stream
    if (id.startsWith('cartoon-ar:movie:')) {
        const fileId = id.replace('cartoon-ar:movie:', '');
        return res.json({
            streams: [{
                url: `https://drive.google.com/uc?export=download&id=${fileId}`,
                name: 'Google Drive',
            }],
        });
    }

    // Series stream (episode)
    if (id.startsWith('cartoon-ar:show:') || id.startsWith('cartoon-ar:series:')) {
        const fileId = id.split(':').pop();
        return res.json({
            streams: [{
                url: `https://drive.google.com/uc?export=download&id=${fileId}`,
                name: 'Google Drive',
            }],
        });
    }

    res.json({ streams: [] });
});

// Discovery
app.get('/discover', (req, res) => {
    if (!cache.ready) return res.json({ status: 'building', building: cache.building });
    res.json({
        status: 'ok',
        shows: Object.keys(cache.shows).length,
        totalEpisodes: Object.values(cache.shows).reduce((sum, s) => sum + s.episodeCount, 0),
        arabicMovies: cache.arabicMovies.length,
        foreignMovies: cache.foreignMovies.length,
        totalMovies: cache.allMovies.length,
        cacheTime: new Date(cache.lastBuild).toISOString(),
    });
});

// Health
app.get('/health', (req, res) => res.json({
    status: cache.ready ? 'ok' : 'building',
    ready: cache.ready,
    version: '13.0.0',
}));

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`🎬 كرتون دريف v13.0.0 running on port ${PORT}`);
    await buildIndex();
});

module.exports = app;
