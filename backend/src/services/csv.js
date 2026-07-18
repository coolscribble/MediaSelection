const { parse } = require('csv-parse');
const { Readable } = require('stream');
const { db } = require('../database');

// Columns we never want in metadata (can contain long/malformed content)
const SKIP_METADATA_COLS = new Set(['Progress notes', 'progress notes', 'notes', 'Notes', 'Collection notes']);

function extractTitle(r) {
  return (
    r['Game name'] || r['game name'] ||
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
  if (r['Publisher']) meta.publisher = r['Publisher'];
  if (r['Game release date']) meta.releaseDate = r['Game release date'];
  const issue = r['Issue #'] || r['Issue Number'] || r['issue'];
  if (issue) meta.issue = issue;
  // Never include progress notes or other long-form text columns
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

async function importCSV(buffer, category) {
  const records = await parseCSV(buffer);
  let count = 0;
  for (const r of records) {
    const title = extractTitle(r);
    if (!title) continue;
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
  for (const r of records) {
    const title = extractTitle(r);
    if (!title) continue;
    await db.run(
      'INSERT INTO queue_items (category, position, title, external_id, thumbnail_url, metadata) VALUES (?, ?, ?, ?, ?, ?)',
      [category, pos++, title.trim(), extractExternalId(r) || null, extractThumbnail(r) || null, JSON.stringify(buildMetadata(r))]
    );
    count++;
  }
  return count;
}

module.exports = { importCSV, importQueueCSV };
