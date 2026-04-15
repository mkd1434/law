import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: 'gateway05.us-east-1.prod.aws.tidbcloud.com',
  user: '39BFq3QhBxquSCQ.root',
  password: 'lK7QIG6q6Q7u1trD6lRf',
  database: 'fKV8PiCYYEivuB8yDL78Dt',
  port: 4000,
  ssl: {
    rejectUnauthorized: false,
  },
});

const [rows] = await connection.query('SELECT id, announcement_no, comparison_data FROM change_logs LIMIT 3');

console.log(`Found ${rows.length} records`);

if (rows.length > 0) {
  rows.forEach((row, idx) => {
    console.log(`\n=== Record ${idx + 1} ===`);
    console.log('announcementNo:', row.announcement_no);
    console.log('comparisonData type:', typeof row.comparison_data);
    if (row.comparison_data) {
      const data = typeof row.comparison_data === 'string' ? JSON.parse(row.comparison_data) : row.comparison_data;
      console.log('Keys:', Object.keys(data).slice(0, 15));
      console.log('Has oldText?', 'oldText' in data);
      console.log('Has newText?', 'newText' in data);
      console.log('Sample:', JSON.stringify(data, null, 2).substring(0, 600));
    } else {
      console.log('comparisonData is null/empty');
    }
  });
}

await connection.end();
