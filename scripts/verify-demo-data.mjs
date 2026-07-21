import initSqlJs from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';

const wasmDir = path.join(process.cwd(), 'node_modules', 'sql.js', 'dist');
const SQL = await initSqlJs({ locateFile: (f) => path.join(wasmDir, f) });
const db = new SQL.Database(new Uint8Array(fs.readFileSync('resources/demo.db')));

const tables = ['books', 'highlights', 'cards', 'reviews', 'knowledge_cards', 'methodologies', 'daily_stats', 'token_usage', 'conversations', 'chat_messages', 'memories', 'user_profiles', 'articles', 'vocabulary', 'book_architecture', 'book_summaries'];

console.log('=== Table counts ===');
for (const t of tables) {
  const r = db.exec(`SELECT COUNT(*) FROM ${t}`);
  const n = r[0]?.values[0]?.[0] ?? 0;
  console.log(`  ${t.padEnd(20)} : ${n}`);
}

console.log('\n=== FSRS state distribution ===');
const stateRes = db.exec('SELECT state, COUNT(*) FROM cards GROUP BY state ORDER BY state');
for (const row of stateRes[0]?.values ?? []) {
  const names = ['New', 'Learning', 'Review', 'Relearning', 'Mastered'];
  console.log(`  ${names[row[0]] ?? 'Unknown'} (${row[0]}) : ${row[1]}`);
}

console.log('\n=== Knowledge card type distribution ===');
const kcRes = db.exec('SELECT type, COUNT(*) FROM knowledge_cards GROUP BY type ORDER BY type');
for (const row of kcRes[0]?.values ?? []) {
  console.log(`  ${row[0].padEnd(15)} : ${row[1]}`);
}

console.log('\n=== Token usage summary ===');
const t1 = db.exec('SELECT COUNT(*), SUM(total_tokens), SUM(cost_usd*1000)/1000 FROM token_usage');
const [cnt, tot, cost] = t1[0].values[0];
console.log(`  Records    : ${cnt}`);
console.log(`  Total Tok  : ${Number(tot).toLocaleString()}`);
console.log(`  Total Cost : $${Number(cost).toFixed(4)}`);

console.log('\n=== Provider distribution ===');
const provRes = db.exec('SELECT provider, COUNT(*), SUM(total_tokens) FROM token_usage GROUP BY provider ORDER BY SUM(total_tokens) DESC');
const total = Number(tot);
for (const row of provRes[0]?.values ?? []) {
  const pct = (Number(row[2]) / total * 100).toFixed(1);
  console.log(`  ${row[0].padEnd(12)} : ${row[1]} records, ${Number(row[2]).toLocaleString()} tok (${pct}%)`);
}

console.log('\n=== Daily stats (last 7 days) ===');
const dsRes = db.exec('SELECT date, cards_reviewed, reading_time FROM daily_stats ORDER BY date');
for (const row of dsRes[0]?.values ?? []) {
  console.log(`  ${row[0]}  reviewed=${row[1]}  time=${Math.round(row[2]/60)}min`);
}

console.log('\n=== Books with highlight counts ===');
const bookRes = db.exec(`SELECT b.title, b.author, b.reading_progress, b.is_finished,
  (SELECT COUNT(*) FROM highlights WHERE book_id = b.id) AS hl,
  (SELECT COUNT(*) FROM knowledge_cards WHERE book_id = b.id) AS kc
  FROM books b ORDER BY b.id`);
for (const row of bookRes[0]?.values ?? []) {
  console.log(`  ${row[0]} | ${row[1]} | prog=${Math.round(row[2]*100)}% | fin=${row[3]} | hl=${row[4]} | kc=${row[5]}`);
}

db.close();
