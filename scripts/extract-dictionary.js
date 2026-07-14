/**
 * 从 ECDICT SQLite 数据库提取高频词到紧凑 JSON 文件
 * 过滤条件：Collins > 0 或 Oxford > 0 或 BNC > 0 或频率 > 0 或包含 CET/IELTS/TOEFL 标签
 * 使用 sql.js（纯 JS 实现）读取，无需原生模块编译
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'resources', 'ecdict.db');
const OUTPUT_PATH = path.join(__dirname, '..', 'resources', 'dictionary.json');

async function main() {
  console.log('读取 ECDICT 数据库...');
  const buffer = fs.readFileSync(DB_PATH);
  console.log(`数据库文件大小: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);

  const SQL = await initSqlJs();
  const db = new SQL.Database(buffer);

  console.log('查询高频词...');
  // 只提取有频率标记的词：collins星级、牛津标记、BNC词频、frq频率、或考试标签
  const result = db.exec(`
    SELECT word, phonetic, pos, translation, collins, oxford, tag, exchange, definition, bnc, frq
    FROM stardict
    WHERE collins > 0 OR oxford > 0 OR bnc > 0 OR frq > 0
       OR tag LIKE '%cet4%' OR tag LIKE '%cet6%'
       OR tag LIKE '%ielts%' OR tag LIKE '%toefl%'
       OR tag LIKE '%gre%' OR tag LIKE '%考研%'
    ORDER BY collins DESC, bnc ASC, frq ASC
  `);

  if (result.length === 0) {
    console.error('查询结果为空，请检查数据库是否正确');
    process.exit(1);
  }

  const rows = result[0].values;
  const columns = result[0].columns;
  console.log(`提取到 ${rows.length} 个高频词`);

  // 转换为紧凑的 JSON 格式
  // 使用 word 作为 key 的 Map 结构，方便快速查找
  const dictionary = {};
  let skipped = 0;

  for (const row of rows) {
    const entry = {};
    let hasUsefulData = false;

    for (let i = 0; i < columns.length; i++) {
      const value = row[i];
      if (value !== null && value !== '' && value !== 0) {
        entry[columns[i]] = value;
        hasUsefulData = true;
      }
    }

    if (hasUsefulData && entry.word) {
      const word = entry.word.toLowerCase();
      dictionary[word] = entry;
    } else {
      skipped++;
    }
  }

  console.log(`有效词条: ${Object.keys(dictionary).length}, 跳过: ${skipped}`);

  // 写入 JSON 文件
  const jsonStr = JSON.stringify(dictionary);
  fs.writeFileSync(OUTPUT_PATH, jsonStr);
  console.log(`词典 JSON 已写入: ${OUTPUT_PATH}`);
  console.log(`文件大小: ${(jsonStr.length / 1024 / 1024).toFixed(1)} MB`);

  db.close();
}

main().catch(err => {
  console.error('提取失败:', err);
  process.exit(1);
});