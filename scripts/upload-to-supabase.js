#!/usr/bin/env node
// upload-to-supabase.js
// Uploads an image file to Supabase Storage and returns the public URL
//
// Usage: node upload-to-supabase.js --file social-image.png --day 1
// Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY env vars
//
// First run: creates the 'social-images' bucket if it doesn't exist

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://urjeijcncsyuletprydy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'social-images';

function makeRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function ensureBucket() {
  // Check if bucket exists
  const checkUrl = `${SUPABASE_URL}/storage/v1/bucket/${BUCKET}`;
  const check = await makeRequest(checkUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'apikey': SUPABASE_KEY
    }
  });

  if (check.status === 200) {
    console.log(`Bucket '${BUCKET}' exists`);
    return;
  }

  // Create bucket
  console.log(`Creating bucket '${BUCKET}'...`);
  const createUrl = `${SUPABASE_URL}/storage/v1/bucket`;
  const body = JSON.stringify({
    id: BUCKET,
    name: BUCKET,
    public: true,
    file_size_limit: 5242880
  });

  const result = await makeRequest(createUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'apikey': SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);

  if (result.status === 200 || result.status === 201) {
    console.log('Bucket created successfully');
  } else {
    console.log('Bucket creation response:', result.status, JSON.stringify(result.data));
  }
}

async function uploadFile(filePath, day) {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = `day-${day}-${Date.now()}.png`;
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${fileName}`;

  return new Promise((resolve, reject) => {
    const lib = uploadUrl.startsWith('https') ? https : http;
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
        'Content-Type': 'image/png',
        'Content-Length': fileBuffer.length,
        'x-upsert': 'true'
      }
    };

    const req = lib.request(uploadUrl, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${fileName}`;
          console.log(`Uploaded: ${publicUrl}`);
          resolve(publicUrl);
        } else {
          reject(new Error(`Upload failed: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(fileBuffer);
    req.end();
  });
}

async function main() {
  if (!SUPABASE_KEY) {
    console.error('ERROR: SUPABASE_SERVICE_KEY env var required');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  let file = 'social-image.png';
  let day = 1;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) file = args[++i];
    if (args[i] === '--day' && args[i + 1]) day = parseInt(args[++i]);
  }

  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  await ensureBucket();
  const url = await uploadFile(file, day);

  // Output just the URL for the workflow to capture
  console.log(`IMAGE_URL=${url}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
