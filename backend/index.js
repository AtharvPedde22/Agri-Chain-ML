// backend/index.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');
const upload = require('./upload');
const fs = require('fs');
const csv = require('fast-csv');
const FormData = require('form-data');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const ML_URL = process.env.ML_URL || 'http://127.0.0.1:8001';

/**
 * ==========================================================
 * ✅ DATABASE CONNECTION
 * ==========================================================
 */
async function getDb() {
  return await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });
}

/**
 * ==========================================================
 * 1️⃣ UPLOAD CSV → SAVE TO DB + SEND TO ML
 * ==========================================================
 */
app.post('/api/upload-csv', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });

  const filePath = req.file.path;
  let conn;

  try {
    conn = await getDb();
    await conn.beginTransaction();

    const inserts = [];

    // ✅ Read and insert CSV
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv.parse({ headers: true, trim: true }))
        .on('error', reject)
        .on('data', (row) => {
          const required = [
            'farmer_id',
            'village',
            'latitude',
            'longitude',
            'load_kg',
          ];
          for (const k of required) if (!(k in row)) return;

          inserts.push(
            conn.execute(
              `INSERT INTO farmers (farmer_id, village, latitude, longitude, load_kg)
               VALUES (?,?,?,?,?)
               ON DUPLICATE KEY UPDATE
                 village=VALUES(village),
                 latitude=VALUES(latitude),
                 longitude=VALUES(longitude),
                 load_kg=VALUES(load_kg)`,
              [
                row.farmer_id,
                row.village,
                parseFloat(row.latitude),
                parseFloat(row.longitude),
                parseFloat(row.load_kg),
              ]
            )
          );
        })
        .on('end', resolve);
    });

    await Promise.all(inserts);
    await conn.commit();
    await conn.end();

    // ✅ Forward CSV to ML service
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));

    const mlResp = await axios.post(`${ML_URL}/upload`, form, {
      headers: form.getHeaders(),
    });

    fs.unlink(filePath, () => {});
    res.json({
      message: '✅ CSV uploaded successfully',
      db_rows_upserted: inserts.length,
      ml_upload: mlResp.data,
    });
  } catch (e) {
    console.error('UPLOAD ERROR:', e.message);
    if (conn) {
      try {
        await conn.rollback();
      } catch {}
    }
    res.status(500).json({ error: e.message });
  } finally {
    try {
      if (conn) await conn.end();
    } catch {}
    fs.unlink(filePath, () => {});
  }
});

/**
 * ==========================================================
 * 2️⃣ TRAIN MODEL (K-MEANS)
 * ==========================================================
 */
app.post('/api/train', async (req, res) => {
  try {
    const k = req.body.k || 5;
    const form = new URLSearchParams({ k });
    const r = await axios.post(`${ML_URL}/train`, form);
    res.json(r.data);
  } catch (err) {
    console.error('TRAIN ERROR:', err.message, err.response?.data || '');
    res.status(err.response?.status || 500).json({
      error: err.message,
      details: err.response?.data || null,
    });
  }
});

/**
 * ==========================================================
 * 3️⃣ ASSIGN TRUCKS → UPDATE DB (Fixed for cluster issue)
 * ==========================================================
 */
app.post('/api/assign', async (req, res) => {
  try {
    const capacity = req.body.capacity || 5000;
    const form = new URLSearchParams({ capacity });

    // ✅ Ask ML service to assign trucks
    await axios.post(`${ML_URL}/assign`, form);

    // ✅ Download assignments.csv
    const csvResp = await axios.get(`${ML_URL}/download/assignments`, {
      responseType: 'arraybuffer',
    });

    const csvText = Buffer.from(csvResp.data).toString('utf-8');
    const lines = csvText.trim().split('\n');
    const header = lines.shift().split(',').map(h => h.trim().toLowerCase());

    const idx = (name) => header.indexOf(name.toLowerCase());
    const cIdx = idx('cluster');

    // ✅ Handle multiple possible truck column names
    const truckIdxs = ['assigned_truck', 'assigned_truck_x', 'assigned_truck_y']
      .map(idx)
      .filter(i => i !== -1);

    const conn = await getDb();
    const updates = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      const cols = line.split(',');

      const farmer_id = cols[idx('farmer_id')];
      const clusterVal = (cIdx !== -1 && cols[cIdx] !== '')
        ? parseInt(cols[cIdx], 10)
        : null;
      const assigned_truck = truckIdxs.length ? (cols[truckIdxs[0]] || null) : null;

      if (!farmer_id) continue;

      updates.push(
        conn.execute(
          'UPDATE farmers SET `cluster`=?, assigned_truck=? WHERE farmer_id=?',
          [Number.isFinite(clusterVal) ? clusterVal : null, assigned_truck, farmer_id]
        )
      );
    }

    await Promise.all(updates);
    await conn.end();

    res.json({ message: '✅ Assignments updated in DB', persisted: updates.length });
  } catch (err) {
    console.error('ASSIGN ERROR:', err.message, err.response?.data || '');
    res.status(err.response?.status || 500).json({
      error: err.message,
      details: err.response?.data || null,
    });
  }
});

/**
 * ==========================================================
 * 4️⃣ BASIC READ ROUTES
 * ==========================================================
 */
app.get('/api/farmers', async (_req, res) => {
  const conn = await getDb();
  const [rows] = await conn.execute(
    'SELECT * FROM farmers ORDER BY farmer_id LIMIT 1000'
  );
  await conn.end();
  res.json(rows);
});

app.get('/api/stats', async (_req, res) => {
  const conn = await getDb();
  const [byCluster] = await conn.execute(
    'SELECT cluster, COUNT(*) cnt, SUM(load_kg) total_kg FROM farmers GROUP BY cluster ORDER BY cluster'
  );
  const [byTruck] = await conn.execute(
    'SELECT assigned_truck, COUNT(*) cnt, SUM(load_kg) total_kg FROM farmers GROUP BY assigned_truck ORDER BY assigned_truck'
  );
  await conn.end();
  res.json({ byCluster, byTruck });
});

/**
 * ==========================================================
 * 5️⃣ SERVER START
 * ==========================================================
 */
const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`✅ Backend listening on port ${port}`));
