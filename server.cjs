const path = require("path");
const fs = require("fs/promises");
const express = require("express");
const bodyParser = require("body-parser");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer");
const uploadToR2 = require("./upload-r2.cjs");

const app = express();
app.use(bodyParser.json({ limit: "5mb" })); 

const API_KEY = process.env.API_KEY || "";

app.use((req, res, next) => {
  if (!API_KEY) return next();
  const k = req.header("x-api-key") || req.query.api_key;
  if (k !== API_KEY) return res.status(401).json({ ok: false, error: "unauthorized" });
  next();
});

app.get("/", (_, res) => res.json({ ok: true, mode: "universal-renderer" }));

// ============================================================
// 🧠 BỘ NÃO CỦA TEMPLATE (HELPERS)
// Giúp template tự xử lý logic mà không cần server can thiệp
// ============================================================

// 1. So sánh
Handlebars.registerHelper("eq", (a, b) => a == b);
Handlebars.registerHelper("neq", (a, b) => a != b);
Handlebars.registerHelper("gt", (a, b) => Number(a) > Number(b));
Handlebars.registerHelper("lt", (a, b) => Number(a) < Number(b));
Handlebars.registerHelper("gte", (a, b) => Number(a) >= Number(b));
Handlebars.registerHelper("lte", (a, b) => Number(a) <= Number(b));

// 2. Logic (AND, OR, NOT)
Handlebars.registerHelper("and", (a, b) => a && b);
Handlebars.registerHelper("or", (a, b) => a || b);
Handlebars.registerHelper("not", (a) => !a);

// 3. Toán học
Handlebars.registerHelper("add", (a, b) => Number(a) + Number(b));
Handlebars.registerHelper("sub", (a, b) => Number(a) - Number(b));
Handlebars.registerHelper("mul", (a, b) => Number(a) * Number(b));

// 4. Format số liệu (Marathon Specific)
// Sử dụng: {{formatDelta value}} -> Ra "+500" hoặc "-200" hoặc "0"
Handlebars.registerHelper("formatDelta", (value) => {
    if (value === null || value === undefined) return "?";
    const num = parseFloat(value);
    const gram = Math.round(num * 1000);
    if (gram > 0) return "+" + gram;
    return gram;
});

// Sử dụng: {{formatWeight value}} -> Ra "65.5" hoặc "--"
Handlebars.registerHelper("formatWeight", (value) => {
    if (value === null || value === undefined) return "--";
    return parseFloat(value).toFixed(1).replace('.0', '');
});

// 5. Check Null/Undefined
// Sử dụng: {{default value "Chưa có"}}
Handlebars.registerHelper("default", (value, defaultValue) => {
    return (value !== null && value !== undefined) ? value : defaultValue;
});

// ============================================================

async function renderTemplate(file, data) {
  try {
    const baseUrl = process.env.TEMPLATE_BASE_URL || "https://raw.githubusercontent.com/beanbean/nexme-render-templates/main";
    // Tự động thêm đuôi .hbs nếu thiếu
    const fileName = file.endsWith('.hbs') ? file : file + '.hbs';
    const finalUrl = `${baseUrl}/${fileName}?t=${Date.now()}`;
    
    console.log(`[Template] Fetching: ${finalUrl}`);
    const response = await fetch(finalUrl);
    if (!response.ok) throw new Error(`Github 404: ${finalUrl}`);
    const src = await response.text();
    
    const tpl = Handlebars.compile(src);
    return tpl(data);
  } catch (err) { throw err; }
}

// 🔥 API DUY NHẤT CHO MỌI LOẠI ẢNH (GENERIC)
app.post("/render", async (req, res) => {
  try {
    const { template, data, width = 1080, height = 1444, filename_prefix = "image" } = req.body;
    
    if (!template) throw new Error("Missing 'template' field");

    // 1. Render HTML từ Template + Data thô
    const html = await renderTemplate(template, data);
    
    // 2. Chụp ảnh
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: "new"
    });
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.setContent(html, { waitUntil: "networkidle0" });
    const base64 = (await page.screenshot({ type: "png" })).toString("base64");
    await browser.close();

    // 3. Upload
    const timestamp = Date.now();
    const finalName = `${filename_prefix}-${timestamp}`;
    const imageUrl = await uploadToR2(base64, finalName, "reports");
    
    res.json({ ok: true, image_url: imageUrl });

  } catch (e) {
    console.error("Error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Giữ lại route cũ để tương thích ngược (Optional - có thể xóa nếu sửa hết n8n)
app.post("/render/personal", async (req, res) => {
    // Forward sang logic generic
    req.body.template = req.body.template_url || "personal_progress.hbs";
    req.body.filename_prefix = "personal";
    // Data giữ nguyên, vì template sẽ xử lý logic
    return app._router.handle(req, res, () => {});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Universal Renderer running on ${PORT}`));
