import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE || 20 * 1024 * 1024 * 1024);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const SOURCE_ID = process.env.SOURCE_ID || '9ccb1cf';
const uploadDir = path.join(__dirname, 'uploads');
const records = new Map();

await fs.mkdir(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => {
      const safeBase = crypto.randomUUID();
      const ext = path.extname(file.originalname || '');
      cb(null, `${safeBase}${ext}`);
    },
  }),
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname) return cb(new Error('Missing file name'));
    cb(null, true);
  },
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir, { index: false, redirect: false }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'p2p-transfer-cloud', source: SOURCE_ID, publicBaseUrl: PUBLIC_BASE_URL });
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const id = crypto.randomUUID().slice(0, 8);
    const finalFileName = `${id}${path.extname(req.file.originalname)}`;
    const fullFilePath = path.join(uploadDir, finalFileName);
    const oldPath = req.file.path;

    await fs.rename(oldPath, fullFilePath);

    const record = {
      id,
      originalName: req.file.originalname,
      fileName: finalFileName,
      size: req.file.size,
      mimeType: req.file.mimetype || 'application/octet-stream',
      createdAt: new Date().toISOString(),
      downloadUrl: `${PUBLIC_BASE_URL}/download/${id}`,
      shareUrl: `${PUBLIC_BASE_URL}/?file=${id}`,
      code: id.slice(0, 6).toUpperCase(),
    };

    records.set(id, record);

    return res.status(201).json({
      success: true,
      ...record,
    });
  } catch (error) {
    console.error('Upload failed:', error);
    return res.status(500).json({ error: 'Upload failed on the server.' });
  }
});

app.get('/api/file/:id', (req, res) => {
  const record = records.get(req.params.id);
  if (!record) {
    return res.status(404).json({ error: 'File not found.' });
  }

  return res.json({
    success: true,
    ...record,
  });
});

app.get('/download/:id', async (req, res) => {
  const record = records.get(req.params.id);
  if (!record) {
    return res.status(404).send('File not found.');
  }

  const filePath = path.join(uploadDir, record.fileName);
  try {
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    if (!exists) {
      return res.status(404).send('Stored file missing.');
    }

    return res.download(filePath, record.originalName);
  } catch (error) {
    console.error('Download error:', error);
    return res.status(500).send('Download failed.');
  }
});

app.get('/api/files', (_req, res) => {
  const items = Array.from(records.values()).map((item) => ({
    id: item.id,
    name: item.originalName,
    size: item.size,
    createdAt: item.createdAt,
    downloadUrl: item.downloadUrl,
  }));

  res.json({ success: true, items });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`P2P transfer cloud server running on http://localhost:${PORT}`);
  console.log(`Public base URL: ${PUBLIC_BASE_URL}`);
  console.log(`Source ID: ${SOURCE_ID}`);
});
