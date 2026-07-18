const { parse } = require('csv-parse');
const { Readable } = require('stream');
const { db } = require('../database');

// Columns we never want in metadata (can contain long/malformed content)
const SKIP_METADATA_COLS = new Set(['Progress notes', 'progress notes', 'notes', 'Notes', 'Collection notes']);

function extractTitle(r) {
  return (
    r['Game name'] || r['game name'] ||
    // Comics exports use "Full Title" (individual issue) or "Series Name" as fallback
    r['Full Title'] || r['full title'] ||
    r['Series Name'] || r['series name'] ||
    r['Title'] || r['title'] ||
    r['Name'] || r['name'] ||
    r['Series'] || r['series'] ||
    r['Comic'] || r['comic'] ||
    r['Game'] || r['game'] ||
    null
  );
}

function extractExternalId(r) {
  return r['IGDB ID'] || r['igdb_id'] || r['id'] || r['ID'] || r['external_id'] || null;
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

async function importCSV(buffer, category) {
  const records = await parseCSV(buffer);
  let count = 0;
  // Used for within-batch deduplication when importing comics
  const seenTitles = new Set();

  for (const r of records) {
    // Skip games that are already completed or beaten — they belong in history, not the backlog
    if (category === 'games') {
      const completion = (r['Completion'] || '').trim();
      if (completion === 'Completed' || completion === 'Beaten') continue;
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
      if (!title) continue;
    }

    await db.run(
      'INSERT INTO library_items (category, title, external_id, thumbnail_url, metadata, source) VALUES (?, ?, ?, ?, ?, ?)',
      [category, title.trim(), extractExternalId(r) || null, extractThumbnail(r) || null, JSON.stringify(buildMetadata(r)), 'csv']
    );
    count++;
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
      const completion = (r['Completion'] || '').trim();
      if (completion === 'Completed' || completion === 'Beaten') continue;
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

module.exports = { importCSV, importQueueCSV };
