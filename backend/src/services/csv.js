const { parse } = require('csv-parse');
const { Readable } = require('stream');
const { db } = require('../database');
const { checkCachedCover, titleSlug } = require('./imageCache');

// Columns we never want in metadata (can contain long/malformed content)
const SKIP_METADATA_COLS = new Set(['Progress notes', 'progress notes', 'notes', 'Notes', 'Collection notes']);

function extractTitle(r) {
  return (
    // InfiniteBacklog: "Game name" (lowercase n) or "Game Name" (capital N)
    r['Game name'] || r['Game Name'] || r['game name'] || r['GAME NAME'] ||
    // Comics exports use "Full Title" (individual issue) or "Series Name" as fallback
    r['Full Title'] || r['full title'] ||
    r['Series Name'] || r['series name'] ||
    // Album exports typically use "Album", "Release title" (RateYourMusic), or generic "Title"
    r['Album'] || r['album'] ||
    r['Release title'] || r['release title'] ||
    r['Title'] || r['title'] ||
    r['Name'] || r['name'] ||
    r['Series'] || r['series'] ||
    r['Comic'] || r['comic'] ||
    r['Game'] || r['game'] ||
    null
  );
}

function extractExternalId(r) {
  return r['IGDB ID'] || r['igdb_id'] || r['AOTY ID'] || r['aoty_id'] || r['id'] || r['ID'] || r['external_id'] || null;
}

function extractThumbnail(r) {
  return r['thumbnail'] || r['cover'] || r['image'] || r['poster'] || r['cover_url'] || null;
}

function buildMetadata(r) {
  const meta = {};
  if (r['Platform']) meta.platform = r['Platform'];
  if (r['Status']) meta.status = r['Status'];
  if (r['Completion']) meta.completion = r['Completion'];
  // "Publisher" (games) or "Publisher Name" (comics exports)
  if (r['Publisher']) meta.publisher = r['Publisher'];
  if (r['Publisher Name']) meta.publisher = r['Publisher Name'];
  if (r['Game release date']) meta.releaseDate = r['Game release date'];
  // Comics-specific fields from CLZ / ComicBase style exports
  if (r['Series Name']) meta.series = r['Series Name'];
  if (r['Release Date']) meta.releaseDate = r['Release Date'];
  if (r['Media Format']) meta.format = r['Media Format'];
  if (r['In Collection']) meta.inCollection = r['In Collection'];
  if (r['Marked Read']) meta.markedRead = r['Marked Read'];
  const issue = r['Issue #'] || r['Issue Number'] || r['issue'];
  if (issue) meta.issue = issue;
  // Albums — artist name and release year
  const artist = r['Artist'] || r['artist'] || r['Artist Name'] || r['artist name'];
  if (artist) meta.artist = artist;
  const year = r['Year'] || r['year'] || r['Release year'] || r['release year'] || r['Date'] || r['date'];
  if (year) meta.year = year;
  // Acquisition type — detected dynamically; stored for filtering display
  if (r['_acquisition_type']) meta.acquisition_type = r['_acquisition_type'];
  return meta;
}

// Streaming parse — a malformed row mid-file doesn't abort the entire import
function parseCSV(buffer) {
  return new Promise((resolve) => {
    const records = [];
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_quotes: true,
      skip_records_with_error: true,
    });
    parser.on('readable', () => {
      let rec;
      while ((rec = parser.read()) !== null) {
        // Drop progress notes values before storing to avoid keeping huge strings in memory
        for (const col of SKIP_METADATA_COLS) delete rec[col];
        records.push(rec);
      }
    });
    parser.on('error', (err) => {
      console.warn(`CSV warning (skipping rest from row ${records.length}): ${err.message}`);
      resolve(records);
    });
    parser.on('end', () => resolve(records));

    const readable = new Readable({ read() {} });
    readable.push(buffer);
    readable.push(null);
    readable.pipe(parser);
  });
}

// Strip issue numbers (#1, #12, #001 …) and trim — used for comics dedup
function normalizeComicsTitle(t) {
  return t.replace(/\s*#\d+\b.*$/, '').trim();
}

// Generic "digital" labels — never shown as filter options; games with only these values
// are always imported regardless of the service filter (can't be categorised further).
const GENERIC_DIGITAL = new Set(['digital', 'download', 'digital copy', 'downloadable']);

// Known service/format values to identify filterable columns in the CSV
const SERVICE_VALUE_SET = new Set([
  'physical', 'disc', 'cartridge', 'physical copy',
  'psn', 'psn network', 'playstation network', 'playstation store', 'ps store',
  'steam', 'gog', 'gog galaxy', 'epic', 'epic games', 'epic games store',
  'xbox', 'xbox game pass', 'game pass', 'gamepass', 'microsoft store',
  'nintendo', 'nintendo eshop', 'eshop',
  'retro achievements', 'retroachievements',
  'ea app', 'ea', 'origin', 'ubisoft', 'ubisoft connect', 'uplay',
  'amazon', 'amazon games', 'prime gaming',
  'humble', 'humble bundle', 'itch.io',
  'battlenet', 'battle.net', 'blizzard',
  'ps plus', 'ps now', 'playstation plus', 'playstation now',
]);

// Detect ALL columns that contain service/format type values
// Returns array of { column, values } for each matching column
function detectServiceColumns(records) {
  if (!records.length) return [];
  const allColumns = Object.keys(records[0]);
  const results = [];
  for (const col of allColumns) {
    const vals = [...new Set(records.map(r => (r[col] || '').trim()).filter(Boolean))];
    if (vals.length === 0 || vals.length > 20) continue;
    // Use exact set membership only — avoids false positives from broad substrings
    // (e.g. "Nintendo Switch" contains "nintendo" but is a platform, not a service).
    const matchCount = vals.filter(v => SERVICE_VALUE_SET.has(v.toLowerCase())).length;
    if (matchCount > 0) {
      // Only keep values that are in the service set (skip unrelated values from the same column)
      const serviceVals = vals.filter(v => SERVICE_VALUE_SET.has(v.toLowerCase())).sort();
      results.push({ column: col, values: serviceVals });
    }
  }
  return results;
}

async function previewCSV(buffer, category) {
  const records = await parseCSV(buffer);

  if (category !== 'games' || records.length === 0) {
    return { serviceValues: [], filterColumns: [] };
  }

  const filterColumns = detectServiceColumns(records);
  // Flat deduplicated list of all service values across all detected columns
  const serviceValues = [...new Set(filterColumns.flatMap(c => c.values))].sort();

  return { serviceValues, filterColumns };
}

// Game statuses — shared between importCSV and importQueueCSV
const GAME_INCLUDE = new Set(['unfinished', 'playing', 'currently playing', 'in progress', 'started', 'owned']);
const GAME_SKIP    = new Set(['completed', 'beaten', 'mastered', 'abandoned']);

async function importCSV(buffer, category, options = {}) {
  const records = await parseCSV(buffer);
  let count = 0;
  // Used for within-batch deduplication when importing comics
  const seenTitles = new Set();

  // Normalise platform filter to lowercase set for case-insensitive matching
  const platformFilter = options.platforms?.length
    ? new Set(options.platforms.map(p => p.toLowerCase()))
    : null;

  // Detect all service/format columns for multi-column acquisition filter
  const detectedSvcCols = options.acquisitionTypes?.length ? detectServiceColumns(records) : [];
  const serviceFilterCols = detectedSvcCols.map(c => c.column);
  const serviceFilter = options.acquisitionTypes?.length
    ? new Set(options.acquisitionTypes.map(t => t.toLowerCase()))
    : null;

  if (category === 'games') {
    const headerSample = records.length ? Object.keys(records[0]).slice(0, 12).join(' | ') : '(no records)';
    console.log(`[csv] games import: ${records.length} records, headers: ${headerSample}`);
    if (serviceFilter) {
      console.log(`[csv] service filter active: cols=[${serviceFilterCols.join(', ')}] values=[${[...serviceFilter].join(', ')}]`);
    } else {
      console.log('[csv] no service filter — importing all status-matching games');
    }
  }

  for (const r of records) {
    // InfiniteBacklog exports a "Status" column (Playing/Completed/…) and a separate
    // "Completion" column (Unfinished/Beaten/…). Import anything that is explicitly
    // in-progress; skip only what is explicitly finished.
    if (category === 'games') {
      const completion = (r['Completion'] || r['completion'] || '').trim().toLowerCase();
      const status     = (r['Status']     || r['status']     || '').trim().toLowerCase();

      const explicitInclude = GAME_INCLUDE.has(completion) || GAME_INCLUDE.has(status);
      const explicitSkip    = GAME_SKIP.has(completion) && !GAME_INCLUDE.has(status);

      const _gameTitle = r['Game name'] || r['Game Name'] || r['game name'] || r['title'] || '(unknown)';

      if (explicitSkip && !explicitInclude) {
        console.log(`[csv] SKIP (done): "${_gameTitle}" completion="${completion}" status="${status}"`);
        continue;
      }

      // Filter by acquisition type — checks ALL detected service/format columns.
      // Games whose only acquisition value is a generic "digital" label (no specific
      // service or format) are always included — they can't be categorised further.
      if (serviceFilterCols.length > 0 && serviceFilter) {
        const colVals = serviceFilterCols.map(col => `${col}="${(r[col] || '').trim()}"`).join(' ');
        const matchesSpecific = serviceFilterCols.some(col => {
          const val = (r[col] || '').trim().toLowerCase();
          return val && serviceFilter.has(val);
        });
        if (!matchesSpecific) {
          const allGenericOrEmpty = serviceFilterCols.every(col => {
            const val = (r[col] || '').trim().toLowerCase();
            return !val || GENERIC_DIGITAL.has(val);
          });
          if (!allGenericOrEmpty) {
            console.log(`[csv] SKIP (service filter): "${_gameTitle}" ${colVals}`);
            continue;
          }
          console.log(`[csv] PASS (generic/empty): "${_gameTitle}" ${colVals}`);
        }
      }
      // Inject combined service values into record so buildMetadata stores them
      if (serviceFilterCols.length > 0) {
        const vals = serviceFilterCols.map(col => (r[col] || '').trim()).filter(Boolean);
        if (vals.length) r['_acquisition_type'] = vals.join(', ');
      }
    }

    let title;
    if (category === 'comics') {
      // Skip issues the user has already read
      const markedRead = (r['Marked Read'] || '').trim();
      if (markedRead === '1') continue;

      // Prefer Series Name (already de-issued) over Full Title; strip any remaining #N
      const raw = r['Series Name'] || r['series name'] || extractTitle(r);
      if (!raw) continue;
      title = normalizeComicsTitle(raw);
      if (!title) continue;

      // Deduplicate within this batch
      const key = title.toLowerCase();
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);

      // Also skip if this series title already exists in the library (re-import safety)
      const dbDup = await db.get(
        "SELECT id FROM library_items WHERE category = 'comics' AND LOWER(title) = LOWER(?)",
        [title]
      );
      if (dbDup) continue;
    } else {
      title = extractTitle(r);
      if (!title) {
        console.log(`[csv] skip record (no title): keys=${Object.keys(r).slice(0, 5).join(',')}`);
        continue;
      }

      // Deduplicate games by IGDB ID first, then by title (re-import safety)
      if (category === 'games') {
        const extId = extractExternalId(r);
        if (extId) {
          const dbDup = await db.get(
            "SELECT id FROM library_items WHERE category = 'games' AND external_id = ?",
            [extId]
          );
          if (dbDup) {
            console.log(`[csv] SKIP (already in library, extId=${extId}): "${title}"`);
            continue;
          }
        } else {
          const dbDup = await db.get(
            "SELECT id FROM library_items WHERE category = 'games' AND LOWER(title) = LOWER(?)",
            [title]
          );
          if (dbDup) {
            console.log(`[csv] SKIP (already in library, title match): "${title}"`);
            continue;
          }
        }
      }
    }

    // Reuse locally cached cover if it exists (survives library clear + re-import)
    const extId = extractExternalId(r) || null;
    let cachedThumb = extractThumbnail(r) || null;
    if (!cachedThumb) {
      if (category === 'games' && extId) {
        cachedThumb = checkCachedCover('games', `igdb_${extId}`);
      } else if (category === 'comics') {
        cachedThumb = checkCachedCover('comics', titleSlug(title));
      } else if (category === 'anime' && extId) {
        cachedThumb = checkCachedCover('anime', `anilist_${extId}`);
      } else if (category === 'manga' && extId) {
        cachedThumb = checkCachedCover('manga', `anilist_${extId}`);
      }
    }

    try {
      await db.run(
        'INSERT INTO library_items (category, title, external_id, thumbnail_url, metadata, source) VALUES (?, ?, ?, ?, ?, ?)',
        [category, title.trim(), extId, cachedThumb, JSON.stringify(buildMetadata(r)), 'csv']
      );
      count++;
    } catch (e) {
      console.warn(`[csv] DB error inserting "${title}": ${e.message}`);
    }
  }
  return count;
}

async function importQueueCSV(buffer, category) {
  const records = await parseCSV(buffer);
  const maxRow = await db.get('SELECT MAX(position) as m FROM queue_items WHERE category = ?', [category]);
  let pos = (maxRow?.m ?? -1) + 1;
  let count = 0;
  const seenTitles = new Set();

  for (const r of records) {
    if (category === 'games') {
      const completion = (r['Completion'] || r['completion'] || '').trim().toLowerCase();
      const status     = (r['Status']     || r['status']     || '').trim().toLowerCase();
      const explicitInclude = GAME_INCLUDE.has(completion) || GAME_INCLUDE.has(status);
      const explicitSkip    = GAME_SKIP.has(completion) && !GAME_INCLUDE.has(status);
      if (explicitSkip && !explicitInclude) continue;
    }

    let title;
    if (category === 'comics') {
      const markedRead = (r['Marked Read'] || '').trim();
      if (markedRead === '1') continue;

      const raw = r['Series Name'] || r['series name'] || extractTitle(r);
      if (!raw) continue;
      title = normalizeComicsTitle(raw);
      if (!title) continue;

      const key = title.toLowerCase();
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);

      const dbDup = await db.get(
        "SELECT id FROM queue_items WHERE category = 'comics' AND LOWER(title) = LOWER(?)",
        [title]
      );
      if (dbDup) continue;
    } else {
      title = extractTitle(r);
      if (!title) continue;
    }

    await db.run(
      'INSERT INTO queue_items (category, position, title, external_id, thumbnail_url, metadata) VALUES (?, ?, ?, ?, ?, ?)',
      [category, pos++, title.trim(), extractExternalId(r) || null, extractThumbnail(r) || null, JSON.stringify(buildMetadata(r))]
    );
    count++;
  }
  return count;
}

module.exports = { importCSV, importQueueCSV, previewCSV };
