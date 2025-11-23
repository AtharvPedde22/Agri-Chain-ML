// backend/upload.js
const multer = require("multer");
const path = require("path");
const os = require("os");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, os.tmpdir()),
  filename: (_req, file, cb) => cb(null, `farmers_${Date.now()}${path.extname(file.originalname)}`)
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.endsWith(".csv")) return cb(new Error("Upload a .csv file only"));
    cb(null, true);
  }
});

module.exports = upload;
