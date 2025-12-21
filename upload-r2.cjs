// ✅ Dùng thư viện V3 (Khớp với package.json)
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

// ✅ Dùng tên biến môi trường chuẩn AWS (Khớp với Dokploy)
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_DOMAIN = process.env.R2_PUBLIC_DOMAIN || "https://media-render.nexme.vn";

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

async function uploadToR2(base64Image, filename, folder = "reports") {
  const buffer = Buffer.from(base64Image, "base64");
  const key = `${folder}/${filename}.png`;

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: "image/png",
  });

  try {
    await s3.send(command);
    // Trả về link public
    return `${R2_PUBLIC_DOMAIN}/${key}`;
  } catch (error) {
    console.error("R2 Upload Error:", error);
    throw error;
  }
}

module.exports = uploadToR2;
