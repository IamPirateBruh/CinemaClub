/**
 * TMDB Media Search - Application Logic
 * Vanilla JavaScript, no frameworks
 */

// ============================================
// STATE
// ============================================
const state = {
    query: '',
    results: [],
    highlightedIndex: -1,
    selectedMedia: null,
    mediaType: null,
    tmdbId: null,
    seasons: [],
    episodes: [],
    selectedSeason: null,
    selectedEpisode: null,
    isSearching: false,
    searchAbortController: null,
    isLoadingSeasons: false,
    isLoadingEpisodes: false,
    seasonAbortController: null,
    episodeAbortController: null,
    // Filter / Discover state
    filterType: 'movie',
    selectedGenres: new Set(),
    discoverResults: [],
    discoverPage: 1,
    discoverTotalPages: 1,
    isLoadingDiscover: false,
    discoverAbortController: null,
    genres: { movie: [], tv: [] },
    isLoadingTrending: false,
    trendingAbortController: null
};

// ============================================
// CACHE
// ============================================
const cache = {
    search: new Map(),
    tvDetails: new Map(),
    seasonEpisodes: new Map(),
    discover: new Map(),
    trending: new Map(),
    genres: null
};

const MAX_CACHE_SIZE = 50;

function trimCache(map) {
    if (map.size > MAX_CACHE_SIZE) {
        const firstKey = map.keys().next().value;
        map.delete(firstKey);
    }
}

// ============================================
// DOM REFERENCES
// ============================================
const $ = (id) => document.getElementById(id);

const els = {
    searchInput: $('searchInput'),
    searchBox: $('searchBox'),
    clearBtn: $('clearBtn'),
    searchLoading: $('searchLoading'),
    suggestionsDropdown: $('suggestionsDropdown'),
    suggestionsList: $('suggestionsList'),
    suggestionsEmpty: $('suggestionsEmpty'),
    suggestionsError: $('suggestionsError'),
    filterToggle: $('filterToggle'),
    filterPanel: $('filterPanel'),
    filterBadge: $('filterBadge'),
    typeToggle: $('typeToggle'),
    genreChips: $('genreChips'),
    genreLoading: $('genreLoading'),
    yearFrom: $('yearFrom'),
    yearTo: $('yearTo'),
    ratingMin: $('ratingMin'),
    ratingMax: $('ratingMax'),
    languageSelect: $('languageSelect'),
    sortSelect: $('sortSelect'),
    adultToggle: $('adultToggle'),
    applyFilters: $('applyFilters'),
    resetFilters: $('resetFilters'),
    resultsSection: $('resultsSection'),
    resultsTitle: $('resultsTitle'),
    resultsLoading: $('resultsLoading'),
    resultsGrid: $('resultsGrid'),
    resultsEmpty: $('resultsEmpty'),
    pagination: $('pagination'),
    prevPage: $('prevPage'),
    nextPage: $('nextPage'),
    paginationInfo: $('paginationInfo'),
    mediaSection: $('mediaSection'),
    mediaCard: $('mediaCard'),
    mediaPoster: $('mediaPoster'),
    mediaPosterPlaceholder: $('mediaPosterPlaceholder'),
    mediaBadge: $('mediaBadge'),
    mediaRating: $('mediaRating'),
    mediaRatingValue: $('mediaRatingValue'),
    mediaTitle: $('mediaTitle'),
    mediaYear: $('mediaYear'),
    mediaOverview: $('mediaOverview'),
    tvControls: $('tvControls'),
    seasonSelect: $('seasonSelect'),
    episodeSelect: $('episodeSelect'),
    seasonLoading: $('seasonLoading'),
    episodeLoading: $('episodeLoading'),
    serversSection: $('serversSection'),
    serversGrid: $('serversGrid'),
    recentSection: $('recentSection'),
    recentGrid: $('recentGrid'),
    toastContainer: $('toastContainer')
};

// ============================================
// CONSTANTS
// ============================================
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
const POSTER_SIZE = 'w92';
const POSTER_SIZE_LARGE = 'w342';
const POSTER_SIZE_GRID = 'w342';
const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;
const MAX_SUGGESTIONS = 8;
const RECENT_KEY = 'tmdb_media_recent';
const MAX_RECENT = 10;
const RESULTS_PER_PAGE = 20;

// ============================================
// UTILITY FUNCTIONS
// ============================================
function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatYear(dateStr) {
    if (!dateStr) return 'N/A';
    const year = new Date(dateStr).getFullYear();
    return isNaN(year) ? 'N/A' : year;
}

function buildServerUrl(template, values) {
    let url = template;
    for (const [key, val] of Object.entries(values)) {
        const placeholder = '{' + key + '}';
        url = url.split(placeholder).join(encodeURIComponent(String(val)));
    }
    return url;
}

function getPosterUrl(path, size = POSTER_SIZE) {
    return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : '';
}

function showToast(message, type = 'error', duration = 4000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    els.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('out');
        toast.addEventListener('animationend', () => toast.remove());
    }, duration);
}

function scrollToElement(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================
// RECENT ITEMS (localStorage)
// ============================================
function getRecent() {
    try {
        const data = localStorage.getItem(RECENT_KEY);
        return data ? JSON.parse(data) : [];
    } catch {
        return [];
    }
}

function saveRecent(item) {
    try {
        let recent = getRecent();
        recent = recent.filter(r => r.tmdbId !== item.tmdbId);
        recent.unshift(item);
        if (recent.length > MAX_RECENT) recent = recent.slice(0, MAX_RECENT);
        localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch {
        // Silently fail if localStorage is unavailable
    }
}

function renderRecent() {
    const recent = getRecent();
    if (recent.length === 0) {
        els.recentSection.classList.remove('visible');
        return;
    }

    els.recentGrid.innerHTML = recent.map(item => `
        <div class="recent-item" data-tmdbid="${escapeHtml(String(item.tmdbId))}" data-type="${escapeHtml(item.mediaType)}" role="button" tabindex="0">
            ${item.posterPath
                ? `<img class="recent-poster" src="${getPosterUrl(item.posterPath, 'w154')}" alt="${escapeHtml(item.title)} poster" loading="lazy">`
                : `<div class="recent-poster-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`
            }
            <div class="recent-info">
                <div class="recent-title">${escapeHtml(item.title)}</div>
                <div class="recent-meta">
                    <span class="recent-type ${escapeHtml(item.mediaType)}">${item.mediaType === 'movie' ? 'Movie' : 'TV'}</span>
                    <span>${escapeHtml(String(item.year))}</span>
                </div>
            </div>
        </div>
    `).join('');

    els.recentSection.classList.add('visible');

    els.recentGrid.querySelectorAll('.recent-item').forEach(el => {
        const handler = () => {
            const tmdbId = parseInt(el.dataset.tmdbid, 10);
            const type = el.dataset.type;
            if (type === 'movie') {
                loadMovieById(tmdbId);
            } else {
                loadTvById(tmdbId);
            }
        };
        el.addEventListener('click', handler);
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handler();
            }
        });
    });
}

// ============================================
// TMDB API
// ============================================
async function tmdbFetch(endpoint, signal) {
    const apiKey = typeof CONFIG !== 'undefined' ? CONFIG.TMDB_API_KEY : '';
    if (!apiKey || apiKey === 'YOUR_TMDB_API_KEY_HERE') {
        throw new Error('TMDB API key not configured. Please add your API key to config.js');
    }
    const url = `${TMDB_BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}api_key=${apiKey}`;
    const res = await fetch(url, { signal });
    if (!res.ok) {
        const err = new Error(`TMDB API error: ${res.status} ${res.statusText}`);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

async function searchMulti(query, signal) {
    const cacheKey = query.toLowerCase().trim();
    if (cache.search.has(cacheKey)) {
        return cache.search.get(cacheKey);
    }
    const data = await tmdbFetch(`/search/multi?query=${encodeURIComponent(query)}&include_adult=false`, signal);
    const results = (data.results || [])
        .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
        .slice(0, MAX_SUGGESTIONS);
    cache.search.set(cacheKey, results);
    trimCache(cache.search);
    return results;
}

async function fetchTvDetails(tvId, signal) {
    const cacheKey = String(tvId);
    if (cache.tvDetails.has(cacheKey)) {
        return cache.tvDetails.get(cacheKey);
    }
    const data = await tmdbFetch(`/tv/${tvId}`, signal);
    cache.tvDetails.set(cacheKey, data);
    trimCache(cache.tvDetails);
    return data;
}

async function fetchSeasonEpisodes(tvId, seasonNumber, signal) {
    const cacheKey = `${tvId}_s${seasonNumber}`;
    if (cache.seasonEpisodes.has(cacheKey)) {
        return cache.seasonEpisodes.get(cacheKey);
    }
    const data = await tmdbFetch(`/tv/${tvId}/season/${seasonNumber}`, signal);
    cache.seasonEpisodes.set(cacheKey, data);
    trimCache(cache.seasonEpisodes);
    return data;
}

async function fetchMovieDetails(movieId, signal) {
    return tmdbFetch(`/movie/${movieId}`, signal);
}

async function fetchGenres(signal) {
    if (cache.genres) {
        return cache.genres;
    }
    const [movieGenres, tvGenres] = await Promise.all([
        tmdbFetch('/genre/movie/list', signal),
        tmdbFetch('/genre/tv/list', signal)
    ]);
    const genres = {
        movie: movieGenres.genres || [],
        tv: tvGenres.genres || []
    };
    cache.genres = genres;
    return genres;
}

async function fetchDiscover(type, params, signal) {
    const queryString = new URLSearchParams(params).toString();
    const cacheKey = `${type}_${queryString}`;
    if (cache.discover.has(cacheKey)) {
        return cache.discover.get(cacheKey);
    }
    const endpoint = type === 'movie' ? '/discover/movie' : '/discover/tv';
    const data = await tmdbFetch(`${endpoint}?${queryString}`, signal);
    cache.discover.set(cacheKey, data);
    trimCache(cache.discover);
    return data;
}

async function fetchTrending(timeWindow, signal) {
    const cacheKey = timeWindow;
    if (cache.trending.has(cacheKey)) {
        return cache.trending.get(cacheKey);
    }
    const data = await tmdbFetch(`/trending/all/${timeWindow}`, signal);
    cache.trending.set(cacheKey, data);
    trimCache(cache.trending);
    return data;
}

// ============================================
// SEARCH UI (Autocomplete)
// ============================================
function renderSuggestions(results) {
    els.suggestionsList.innerHTML = '';
    els.suggestionsEmpty.classList.remove('visible');
    els.suggestionsError.classList.remove('visible');

    if (results.length === 0) {
        els.suggestionsEmpty.classList.add('visible');
        els.suggestionsDropdown.classList.add('visible');
        return;
    }

    results.forEach((item, index) => {
        const isMovie = item.media_type === 'movie';
        const title = isMovie ? item.title : item.name;
        const year = formatYear(isMovie ? item.release_date : item.first_air_date);
        const posterUrl = getPosterUrl(item.poster_path);
        const rating = item.vote_average ? item.vote_average.toFixed(1) : null;

        const li = document.createElement('li');
        li.className = 'suggestion-item';
        li.setAttribute('role', 'option');
        li.setAttribute('data-index', String(index));
        li.setAttribute('tabindex', '-1');

        li.innerHTML = `
            ${posterUrl
                ? `<img class="suggestion-poster" src="${posterUrl}" alt="" loading="lazy">`
                : `<div class="suggestion-poster-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`
            }
            <div class="suggestion-info">
                <div class="suggestion-title">${escapeHtml(title)}</div>
                <div class="suggestion-meta">
                    <span class="suggestion-type ${isMovie ? 'movie' : 'tv'}">${isMovie ? 'Movie' : 'TV'}</span>
                    <span>${year}</span>
                    ${rating ? `<span class="suggestion-rating"><svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>${rating}</span>` : ''}
                </div>
            </div>
        `;

        li.addEventListener('click', () => selectResult(item));
        li.addEventListener('mouseenter', () => highlightSuggestion(index));
        els.suggestionsList.appendChild(li);
    });

    els.suggestionsDropdown.classList.add('visible');
    els.searchInput.setAttribute('aria-expanded', 'true');
}

function highlightSuggestion(index) {
    const items = els.suggestionsList.querySelectorAll('.suggestion-item');
    items.forEach((item, i) => {
        item.classList.toggle('highlighted', i === index);
        item.setAttribute('aria-selected', String(i === index));
    });
    state.highlightedIndex = index;
}

function closeSuggestions() {
    els.suggestionsDropdown.classList.remove('visible');
    els.searchInput.setAttribute('aria-expanded', 'false');
    state.highlightedIndex = -1;
    state.results = [];
}

function showSearchError(msg) {
    els.suggestionsList.innerHTML = '';
    els.suggestionsEmpty.classList.remove('visible');
    els.suggestionsError.querySelector('p').textContent = msg || 'Something went wrong. Please try again.';
    els.suggestionsError.classList.add('visible');
    els.suggestionsDropdown.classList.add('visible');
}

async function performSearch(query) {
    const trimmed = query.trim();

    if (trimmed.length < MIN_QUERY_LENGTH) {
        closeSuggestions();
        return;
    }

    if (state.searchAbortController) {
        state.searchAbortController.abort();
    }
    state.searchAbortController = new AbortController();

    state.isSearching = true;
    els.searchLoading.classList.add('visible');
    els.clearBtn.classList.remove('visible');

    try {
        const results = await searchMulti(trimmed, state.searchAbortController.signal);
        state.results = results;
        renderSuggestions(results);
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Search error:', err);
        showSearchError(err.message);
    } finally {
        state.isSearching = false;
        els.searchLoading.classList.remove('visible');
        if (trimmed.length > 0) {
            els.clearBtn.classList.add('visible');
        }
        state.searchAbortController = null;
    }
}

const debouncedSearch = debounce(performSearch, DEBOUNCE_MS);

// ============================================
// FILTER UI
// ============================================
function renderGenreChips() {
    const genres = state.genres[state.filterType] || [];
    if (genres.length === 0) {
        els.genreChips.innerHTML = '<div class="genre-loading"><span>No genres available</span></div>';
        return;
    }

    els.genreChips.innerHTML = genres.map(g => `
        <button class="genre-chip ${state.selectedGenres.has(String(g.id)) ? 'active' : ''}" data-id="${g.id}" type="button">
            ${escapeHtml(g.name)}
        </button>
    `).join('');

    els.genreChips.querySelectorAll('.genre-chip').forEach(btn => {
        btn.addEventListener('click', () => toggleGenre(btn.dataset.id));
    });
}

function toggleGenre(genreId) {
    const id = String(genreId);
    if (state.selectedGenres.has(id)) {
        state.selectedGenres.delete(id);
    } else {
        state.selectedGenres.add(id);
    }
    renderGenreChips();
    updateFilterBadge();
}

function updateSortOptions() {
    const options = els.sortSelect.querySelectorAll('option');
    options.forEach(opt => {
        const movieOnly = opt.hasAttribute('data-movie');
        const tvOnly = opt.hasAttribute('data-tv');
        if (movieOnly && state.filterType !== 'movie') {
            opt.style.display = 'none';
        } else if (tvOnly && state.filterType !== 'tv') {
            opt.style.display = 'none';
        } else {
            opt.style.display = '';
        }
    });

    // Reset sort if current selection is hidden
    const selected = els.sortSelect.options[els.sortSelect.selectedIndex];
    if (selected && selected.style.display === 'none') {
        els.sortSelect.value = 'popularity.desc';
    }
}

function updateFilterBadge() {
    let count = 0;
    if (state.selectedGenres.size > 0) count++;
    if (els.yearFrom.value) count++;
    if (els.yearTo.value) count++;
    if (els.ratingMin.value) count++;
    if (els.ratingMax.value) count++;
    if (els.languageSelect.value) count++;
    if (els.sortSelect.value !== 'popularity.desc') count++;
    if (els.adultToggle.checked) count++;

    els.filterBadge.textContent = String(count);
    if (count > 0) {
        els.filterToggle.classList.add('active');
    } else {
        els.filterToggle.classList.remove('active');
    }
}

function buildDiscoverParams(page = 1) {
    const params = {};

    // Genres
    if (state.selectedGenres.size > 0) {
        params.with_genres = Array.from(state.selectedGenres).join(',');
    }

    // Year
    const yearFrom = els.yearFrom.value;
    const yearTo = els.yearTo.value;
    if (state.filterType === 'movie') {
        if (yearFrom && yearTo) {
            params['primary_release_date.gte'] = `${yearFrom}-01-01`;
            params['primary_release_date.lte'] = `${yearTo}-12-31`;
        } else if (yearFrom) {
            params['primary_release_date.gte'] = `${yearFrom}-01-01`;
        } else if (yearTo) {
            params['primary_release_date.lte'] = `${yearTo}-12-31`;
        }
    } else {
        if (yearFrom && yearTo) {
            params['first_air_date.gte'] = `${yearFrom}-01-01`;
            params['first_air_date.lte'] = `${yearTo}-12-31`;
        } else if (yearFrom) {
            params['first_air_date.gte'] = `${yearFrom}-01-01`;
        } else if (yearTo) {
            params['first_air_date.lte'] = `${yearTo}-12-31`;
        }
    }

    // Rating
    const ratingMin = els.ratingMin.value;
    const ratingMax = els.ratingMax.value;
    if (ratingMin) params['vote_average.gte'] = ratingMin;
    if (ratingMax) params['vote_average.lte'] = ratingMax;

    // Language
    const lang = els.languageSelect.value;
    if (lang) params.with_original_language = lang;

    // Sort
    params.sort_by = els.sortSelect.value;

    // Adult (movie only)
    if (state.filterType === 'movie') {
        params.include_adult = els.adultToggle.checked ? 'true' : 'false';
    }

    params.page = String(page);

    return params;
}

async function loadDiscover(page = 1) {
    if (state.discoverAbortController) {
        state.discoverAbortController.abort();
    }
    state.discoverAbortController = new AbortController();
    state.isLoadingDiscover = true;
    els.resultsLoading.classList.add('visible');
    els.resultsEmpty.classList.remove('visible');
    els.pagination.classList.remove('visible');

    try {
        const params = buildDiscoverParams(page);
        const data = await fetchDiscover(state.filterType, params, state.discoverAbortController.signal);
        const results = (data.results || []).map(item => ({
            ...item,
            media_type: state.filterType
        }));

        state.discoverResults = results;
        state.discoverPage = data.page || 1;
        state.discoverTotalPages = data.total_pages || 1;

        els.resultsTitle.textContent = 'Discover Results';
        renderResultsGrid(results);
        renderPagination();
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Discover error:', err);
        els.resultsGrid.innerHTML = '';
        els.resultsEmpty.querySelector('p').textContent = err.message || 'Failed to load results.';
        els.resultsEmpty.classList.add('visible');
        showToast('Failed to load discover results.', 'error');
    } finally {
        state.isLoadingDiscover = false;
        els.resultsLoading.classList.remove('visible');
        state.discoverAbortController = null;
    }
}

async function loadTrending() {
    if (state.trendingAbortController) {
        state.trendingAbortController.abort();
    }
    state.trendingAbortController = new AbortController();
    state.isLoadingTrending = true;
    els.resultsLoading.classList.add('visible');
    els.resultsEmpty.classList.remove('visible');
    els.pagination.classList.remove('visible');

    try {
        const data = await fetchTrending('week', state.trendingAbortController.signal);
        const results = (data.results || [])
            .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
            .slice(0, RESULTS_PER_PAGE);

        state.discoverResults = results;
        state.discoverPage = 1;
        state.discoverTotalPages = 1;

        els.resultsTitle.textContent = 'Trending This Week';
        renderResultsGrid(results);
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Trending error:', err);
        els.resultsGrid.innerHTML = '';
        showToast('Failed to load trending content.', 'error');
    } finally {
        state.isLoadingTrending = false;
        els.resultsLoading.classList.remove('visible');
        state.trendingAbortController = null;
    }
}

function renderResultsGrid(results) {
    if (results.length === 0) {
        els.resultsGrid.innerHTML = '';
        els.resultsEmpty.querySelector('p').textContent = 'No results found';
        els.resultsEmpty.classList.add('visible');
        return;
    }

    els.resultsEmpty.classList.remove('visible');

    els.resultsGrid.innerHTML = results.map(item => {
        const isMovie = item.media_type === 'movie';
        const title = isMovie ? item.title : item.name;
        const year = formatYear(isMovie ? item.release_date : item.first_air_date);
        const posterUrl = getPosterUrl(item.poster_path, POSTER_SIZE_GRID);
        const rating = item.vote_average ? item.vote_average.toFixed(1) : null;

        return `
            <div class="result-card" data-id="${item.id}" data-type="${item.media_type}" tabindex="0" role="button" aria-label="${escapeHtml(title)}">
                <div class="result-poster-wrapper">
                    ${posterUrl
                        ? `<img class="result-poster" src="${posterUrl}" alt="${escapeHtml(title)} poster" loading="lazy">`
                        : `<div class="result-poster-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`
                    }
                    <div class="result-overlay">
                        ${rating ? `<span class="result-rating"><svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>${rating}</span>` : ''}
                    </div>
                </div>
                <div class="result-info">
                    <div class="result-title">${escapeHtml(title)}</div>
                    <div class="result-meta">
                        <span class="result-type ${isMovie ? 'movie' : 'tv'}">${isMovie ? 'Movie' : 'TV'}</span>
                        <span>${year}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Attach click handlers
    els.resultsGrid.querySelectorAll('.result-card').forEach(card => {
        const handler = () => {
            const id = parseInt(card.dataset.id, 10);
            const type = card.dataset.type;
            if (type === 'movie') {
                loadMovieById(id);
            } else {
                loadTvById(id);
            }
        };
        card.addEventListener('click', handler);
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handler();
            }
        });
    });
}

function renderPagination() {
    if (state.discoverTotalPages <= 1) {
        els.pagination.classList.remove('visible');
        return;
    }

    els.pagination.classList.add('visible');
    els.prevPage.disabled = state.discoverPage <= 1;
    els.nextPage.disabled = state.discoverPage >= state.discoverTotalPages;
    els.paginationInfo.textContent = `Page ${state.discoverPage} of ${state.discoverTotalPages}`;
}

function resetFilterState() {
    state.selectedGenres.clear();
    els.yearFrom.value = '';
    els.yearTo.value = '';
    els.ratingMin.value = '';
    els.ratingMax.value = '';
    els.languageSelect.value = '';
    els.sortSelect.value = 'popularity.desc';
    els.adultToggle.checked = false;
    updateFilterBadge();
    renderGenreChips();
}

// ============================================
// SELECTION
// ============================================
async function selectResult(item) {
    closeSuggestions();
    els.searchInput.value = item.media_type === 'movie' ? item.title : item.name;
    els.clearBtn.classList.add('visible');

    if (item.media_type === 'movie') {
        await loadMovie(item);
    } else {
        await loadTvSeries(item);
    }
}

async function loadMovie(item) {
    resetState();
    state.selectedMedia = item;
    state.mediaType = 'movie';
    state.tmdbId = item.id;

    try {
        const details = await fetchMovieDetails(item.id);
        Object.assign(item, details);
    } catch (err) {
        console.warn('Could not fetch full movie details:', err);
    }

    renderMediaCard(item, 'movie');
    renderMovieServers();
    els.mediaSection.classList.add('visible');
    els.tvControls.classList.remove('visible');
    els.serversSection.classList.add('visible');
    scrollToElement(els.mediaSection);

    saveRecent({
        tmdbId: item.id,
        title: item.title,
        year: formatYear(item.release_date),
        mediaType: 'movie',
        posterPath: item.poster_path || null
    });
    renderRecent();
}

async function loadMovieById(movieId) {
    try {
        const details = await fetchMovieDetails(movieId);
        details.media_type = 'movie';
        await loadMovie(details);
    } catch (err) {
        showToast('Failed to load movie details.', 'error');
    }
}

async function loadTvSeries(item) {
    resetState();
    state.selectedMedia = item;
    state.mediaType = 'tv';
    state.tmdbId = item.id;

    renderMediaCard(item, 'tv');
    els.mediaSection.classList.add('visible');
    els.tvControls.classList.add('visible');
    els.serversSection.classList.remove('visible');
    scrollToElement(els.mediaSection);

    await loadSeasons(item.id);

    saveRecent({
        tmdbId: item.id,
        title: item.name,
        year: formatYear(item.first_air_date),
        mediaType: 'tv',
        posterPath: item.poster_path || null
    });
    renderRecent();
}

async function loadTvById(tvId) {
    try {
        const details = await fetchTvDetails(tvId);
        details.media_type = 'tv';
        await loadTvSeries(details);
    } catch (err) {
        showToast('Failed to load TV series details.', 'error');
    }
}

// ============================================
// MEDIA CARD RENDERING
// ============================================
function renderMediaCard(item, type) {
    const isMovie = type === 'movie';
    const title = isMovie ? item.title : item.name;
    const year = formatYear(isMovie ? item.release_date : item.first_air_date);
    const rating = item.vote_average ? item.vote_average.toFixed(1) : '--';
    const overview = item.overview || 'No overview available.';
    const posterPath = item.poster_path;

    els.mediaTitle.textContent = title;
    els.mediaYear.textContent = year;
    els.mediaOverview.textContent = overview;
    els.mediaBadge.textContent = isMovie ? 'Movie' : 'TV Series';
    els.mediaBadge.className = `media-badge ${type}`;
    els.mediaRatingValue.textContent = rating;

    if (posterPath) {
        els.mediaPoster.src = getPosterUrl(posterPath, POSTER_SIZE_LARGE);
        els.mediaPoster.alt = `${title} poster`;
        els.mediaPoster.classList.add('visible');
        els.mediaPoster.onerror = () => {
            els.mediaPoster.classList.remove('visible');
        };
    } else {
        els.mediaPoster.src = '';
        els.mediaPoster.alt = '';
        els.mediaPoster.classList.remove('visible');
    }
}

// ============================================
// TV SEASONS & EPISODES
// ============================================
async function loadSeasons(tvId) {
    if (state.seasonAbortController) {
        state.seasonAbortController.abort();
    }
    state.seasonAbortController = new AbortController();
    state.isLoadingSeasons = true;
    els.seasonLoading.classList.add('visible');
    els.seasonSelect.disabled = true;

    try {
        const data = await fetchTvDetails(tvId, state.seasonAbortController.signal);
        const seasons = (data.seasons || []).filter(s => s.season_number > 0);
        state.seasons = seasons;

        els.seasonSelect.innerHTML = '<option value="">Select a season</option>' +
            seasons.map(s => `<option value="${s.season_number}">Season ${s.season_number}${s.name && s.name !== `Season ${s.season_number}` ? ` - ${escapeHtml(s.name)}` : ''}</option>`).join('');

        els.seasonSelect.disabled = false;

        if (seasons.length === 0) {
            showToast('This TV series has no seasons available.', 'warning');
        }
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Season load error:', err);
        showToast('Failed to load seasons.', 'error');
    } finally {
        state.isLoadingSeasons = false;
        els.seasonLoading.classList.remove('visible');
        state.seasonAbortController = null;
    }
}

async function loadEpisodes(tvId, seasonNumber) {
    if (state.episodeAbortController) {
        state.episodeAbortController.abort();
    }
    state.episodeAbortController = new AbortController();
    state.isLoadingEpisodes = true;
    els.episodeLoading.classList.add('visible');
    els.episodeSelect.disabled = true;

    try {
        const data = await fetchSeasonEpisodes(tvId, seasonNumber, state.episodeAbortController.signal);
        const episodes = data.episodes || [];
        state.episodes = episodes;

        els.episodeSelect.innerHTML = '<option value="">Select an episode</option>' +
            episodes.map((ep) => `<option value="${ep.episode_number}">Episode ${ep.episode_number}${ep.name ? ` - ${escapeHtml(ep.name)}` : ''}</option>`).join('');

        els.episodeSelect.disabled = false;

        if (episodes.length === 0) {
            showToast('This season has no episodes available.', 'warning');
        }
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Episode load error:', err);
        showToast('Failed to load episodes.', 'error');
    } finally {
        state.isLoadingEpisodes = false;
        els.episodeLoading.classList.remove('visible');
        state.episodeAbortController = null;
    }
}

// ============================================
// SERVER BUTTONS
// ============================================
function renderMovieServers() {
    if (!SERVERS || !SERVERS.movie) {
        showToast('Server configuration missing.', 'error');
        return;
    }

    const tmdbId = state.tmdbId;
    if (!tmdbId) return;

    els.serversGrid.innerHTML = SERVERS.movie.map(server => {
        const url = buildServerUrl(server.template, { 'tmdb-id': tmdbId });
        return `
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="server-btn" data-server="${escapeHtml(server.id)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                <span>${escapeHtml(server.name)}</span>
            </a>
        `;
    }).join('');
}

function renderTvServers() {
    if (!SERVERS || !SERVERS.tv) {
        showToast('Server configuration missing.', 'error');
        return;
    }

    const tmdbId = state.tmdbId;
    const season = state.selectedSeason;
    const episode = state.selectedEpisode;

    if (!tmdbId || season === null || episode === null) return;

    els.serversGrid.innerHTML = SERVERS.tv.map(server => {
        const url = buildServerUrl(server.template, {
            'tmdb-id': tmdbId,
            'season': season,
            'episode': episode
        });
        return `
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="server-btn" data-server="${escapeHtml(server.id)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                <span>${escapeHtml(server.name)}</span>
            </a>
        `;
    }).join('');
}

// ============================================
// STATE RESET
// ============================================
function resetState() {
    state.selectedMedia = null;
    state.mediaType = null;
    state.tmdbId = null;
    state.seasons = [];
    state.episodes = [];
    state.selectedSeason = null;
    state.selectedEpisode = null;

    els.seasonSelect.innerHTML = '<option value="">Select a season</option>';
    els.seasonSelect.disabled = true;
    els.episodeSelect.innerHTML = '<option value="">Select an episode</option>';
    els.episodeSelect.disabled = true;

    els.mediaSection.classList.remove('visible');
    els.tvControls.classList.remove('visible');
    els.serversSection.classList.remove('visible');
}

// ============================================
// EVENT LISTENERS
// ============================================
function initEventListeners() {
    // Search input
    els.searchInput.addEventListener('input', (e) => {
        state.query = e.target.value;
        if (state.query.trim().length === 0) {
            closeSuggestions();
            els.clearBtn.classList.remove('visible');
        } else {
            els.clearBtn.classList.add('visible');
            debouncedSearch(state.query);
        }
    });

    els.searchInput.addEventListener('keydown', (e) => {
        if (!els.suggestionsDropdown.classList.contains('visible')) return;

        const items = els.suggestionsList.querySelectorAll('.suggestion-item');
        const maxIndex = items.length - 1;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                highlightSuggestion(Math.min(state.highlightedIndex + 1, maxIndex));
                break;
            case 'ArrowUp':
                e.preventDefault();
                highlightSuggestion(Math.max(state.highlightedIndex - 1, 0));
                break;
            case 'Enter':
                e.preventDefault();
                if (state.highlightedIndex >= 0 && state.results[state.highlightedIndex]) {
                    selectResult(state.results[state.highlightedIndex]);
                }
                break;
            case 'Escape':
                e.preventDefault();
                closeSuggestions();
                els.searchInput.blur();
                break;
        }
    });

    els.searchInput.addEventListener('focus', () => {
        if (state.results.length > 0) {
            els.suggestionsDropdown.classList.add('visible');
        }
    });

    // Clear button
    els.clearBtn.addEventListener('click', () => {
        els.searchInput.value = '';
        state.query = '';
        closeSuggestions();
        els.clearBtn.classList.remove('visible');
        els.searchInput.focus();
    });

    // Click outside to close suggestions
    document.addEventListener('click', (e) => {
        if (!els.searchBox.contains(e.target) && !els.suggestionsDropdown.contains(e.target)) {
            closeSuggestions();
        }
    });

    // Filter toggle
    els.filterToggle.addEventListener('click', () => {
        const isOpen = els.filterPanel.classList.toggle('open');
        els.filterToggle.setAttribute('aria-expanded', String(isOpen));
        els.filterPanel.setAttribute('aria-hidden', String(!isOpen));
    });

    // Type toggle
    els.typeToggle.querySelectorAll('.type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            els.typeToggle.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.filterType = btn.dataset.type;
            state.selectedGenres.clear();
            renderGenreChips();
            updateSortOptions();
            updateFilterBadge();
        });
    });

    // Filter inputs change
    [els.yearFrom, els.yearTo, els.ratingMin, els.ratingMax, els.languageSelect, els.sortSelect, els.adultToggle].forEach(el => {
        el.addEventListener('change', updateFilterBadge);
        el.addEventListener('input', updateFilterBadge);
    });

    // Apply filters
    els.applyFilters.addEventListener('click', () => {
        loadDiscover(1);
    });

    // Reset filters
    els.resetFilters.addEventListener('click', () => {
        resetFilterState();
        loadTrending();
    });

    // Pagination
    els.prevPage.addEventListener('click', () => {
        if (state.discoverPage > 1) {
            loadDiscover(state.discoverPage - 1);
            scrollToElement(els.resultsSection);
        }
    });

    els.nextPage.addEventListener('click', () => {
        if (state.discoverPage < state.discoverTotalPages) {
            loadDiscover(state.discoverPage + 1);
            scrollToElement(els.resultsSection);
        }
    });

    // Season select
    els.seasonSelect.addEventListener('change', async (e) => {
        const seasonNum = parseInt(e.target.value, 10);
        if (isNaN(seasonNum)) {
            state.selectedSeason = null;
            state.selectedEpisode = null;
            els.episodeSelect.innerHTML = '<option value="">Select an episode</option>';
            els.episodeSelect.disabled = true;
            els.serversSection.classList.remove('visible');
            return;
        }

        state.selectedSeason = seasonNum;
        state.selectedEpisode = null;
        els.episodeSelect.innerHTML = '<option value="">Select an episode</option>';
        els.episodeSelect.disabled = true;
        els.serversSection.classList.remove('visible');

        await loadEpisodes(state.tmdbId, seasonNum);
    });

    // Episode select
    els.episodeSelect.addEventListener('change', (e) => {
        const episodeNum = parseInt(e.target.value, 10);
        if (isNaN(episodeNum)) {
            state.selectedEpisode = null;
            els.serversSection.classList.remove('visible');
            return;
        }

        state.selectedEpisode = episodeNum;
        renderTvServers();
        els.serversSection.classList.add('visible');
    });
}

// ============================================
// INITIALIZATION
// ============================================
async function init() {
    // Check config
    if (typeof CONFIG === 'undefined' || !CONFIG.TMDB_API_KEY || CONFIG.TMDB_API_KEY === 'YOUR_TMDB_API_KEY_HERE') {
        showToast('Please configure your TMDB API key in config.js', 'warning', 8000);
    }

    // Check servers
    if (typeof SERVERS === 'undefined') {
        showToast('Server configuration not found. Please check servers.js', 'error', 8000);
    }

    initEventListeners();
    renderRecent();

    // Fetch genres
    try {
        const genres = await fetchGenres();
        state.genres = genres;
        renderGenreChips();
    } catch (err) {
        console.error('Genre fetch error:', err);
        els.genreChips.innerHTML = '<div class="genre-loading"><span>Failed to load genres</span></div>';
    }

    // Load trending on init
    await loadTrending();

    // Focus search on load
    els.searchInput.focus();
}

// Run when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
