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

// Auth Middleware
app.use((req, res, next) => {
  if (!API_KEY) return next();
  const k = req.header("x-api-key") || req.query.api_key;
  if (k !== API_KEY) return res.status(401).json({ ok: false, error: "unauthorized" });
  next();
});

app.get("/", (_, res) => res.json({ ok: true, mode: "universal-renderer-v2" }));

// ============================================================
// 🧠 HELPER REGISTRATION (ĐĂNG KÝ TẤT CẢ HÀM CHO TEMPLATE)
// ============================================================

// 1. So sánh
Handlebars.registerHelper("eq", (a, b) => a == b);
Handlebars.registerHelper("neq", (a, b) => a != b);
Handlebars.registerHelper("gt", (a, b) => Number(a) > Number(b));
Handlebars.registerHelper("lt", (a, b) => Number(a) < Number(b));
Handlebars.registerHelper("gte", (a, b) => Number(a) >= Number(b));
Handlebars.registerHelper("lte", (a, b) => Number(a) <= Number(b));

// 2. Logic
Handlebars.registerHelper("and", (a, b) => a && b);
Handlebars.registerHelper("or", (a, b) => a || b);
Handlebars.registerHelper("not", (a) => !a);

// 3. Toán học
Handlebars.registerHelper("add", (a, b) => Number(a) + Number(b));
Handlebars.registerHelper("sub", (a, b) => Number(a) - Number(b));

// 4. Utility (Cái đang bị thiếu)
Handlebars.registerHelper("default", (value, defaultValue) => {
    return (value !== null && value !== undefined && value !== "") ? value : defaultValue;
});

// 5. Format hiển thị Marathon

// Format Gram: +500, -200, 0, ?
Handlebars.registerHelper("formatDelta", (value) => {
    if (value === null || value === undefined || value === "") return "?";
    const num = parseFloat(value);
    const gram = Math.round(num * 1000);
    if (gram > 0) return "+" + gram;
    return gram;
});

// Format KG: 65.5, --
Handlebars.registerHelper("formatWeight", (value) => {
    // Nếu giá trị là null/undefined hoặc không phải số -> trả về --
    if (value === null || value === undefined || value === "" || isNaN(value)) return "--";
    return parseFloat(value).toFixed(1).replace('.0', '');
});

// Check màu sắc trạng thái
Handlebars.registerHelper("getStatusClass", (val) => {
    if (val === null || val === undefined || val === "") return "future";
    const num = parseFloat(val);
    if (num < 0) return "loss"; // Giảm -> Xanh
    if (num > 0) return "gain"; // Tăng -> Cam
    return "logged";            // 0 -> Xám đậm
});

// ============================================================

async function renderTemplate(file, data) {
  try {
    const baseUrl = process.env.TEMPLATE_BASE_URL || "https://raw.githubusercontent.com/beanbean/nexme-render-templates/main";
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

// HÀM XỬ LÝ CHUNG (Để tránh lỗi stack overflow)
const handleRenderRequest = async (req, res) => {
  try {
    const { template, data, width = 1080, height = 1444, filename_prefix = "image" } = req.body;
    
    if (!template) throw new Error("Missing 'template' field");

    // 1. Render HTML
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
    if (!res.headersSent) res.status(500).json({ ok: false, error: e.message });
  }
};

// Route Chính
app.post("/render", handleRenderRequest);

// Route Cũ (Tương thích ngược)
app.post("/render/personal", (req, res) => {
    req.body.template = req.body.template_url || "personal_progress.hbs";
    req.body.filename_prefix = "personal";
    return handleRenderRequest(req, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Universal Renderer running on ${PORT}`));
