import initSqlJs from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmDir = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist');
const SQL = await initSqlJs({ locateFile: (f) => path.join(wasmDir, f) });
const db = new SQL.Database(new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'resources', 'demo.db'))));

const r = db.exec('SELECT state, COUNT(*), AVG(mastery_level) FROM cards GROUP BY state ORDER BY state');
console.log('=== state, count, avg_mastery ===');
for (const row of r[0].values) {
  const names = ['New', 'Learning', 'Review', 'Relearning', 'Mastered'];
  const n = names[row[0]] || 'Unknown';
  console.log(`state=${row[0]} (${n})\tcount=${row[1]}\tavg_mastery=${row[2].toFixed(1)}`);
}
const r2 = db.exec('SELECT COUNT(*) FROM cards WHERE mastery_level = 100');
console.log('Cards with mastery_level=100:', r2[0].values[0][0]);
const r3 = db.exec('SELECT COUNT(*) FROM cards WHERE mastery_level >= 85');
console.log('Cards with mastery_level>=85:', r3[0].values[0][0]);

const r4 = db.exec('SELECT state, COUNT(*), MIN(mastery_level), MAX(mastery_level), AVG(mastery_level) FROM cards GROUP BY state ORDER BY state');
console.log('\n=== state stats ===');
for (const row of r4[0].values) {
  console.log(`state=${row[0]} cnt=${row[1]} min=${row[2]} max=${row[3]} avg=${row[4].toFixed(1)}`);
}

db.close();
