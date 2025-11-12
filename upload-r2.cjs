const AWS = require("aws-sdk");

const r2 = new AWS.S3({
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  accessKeyId: process.env.R2_ACCESS_KEY,
  secretAccessKey: process.env.R2_SECRET_KEY,
  region: "auto",
  signatureVersion: "v4",
});

async function uploadToR2(base64, filename, folder = "reports") {
  const buffer = Buffer.from(base64, "base64");
  const key = `${folder}/${filename}.png`;

  await r2.putObject({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: "image/png",
  }).promise();

  // Trả về link public CDN
  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

module.exports = uploadToR2;
