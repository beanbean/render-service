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

app.get("/", (_, res) => res.json({ ok: true, mode: "universal-renderer-v1" }));

// ============================================================
// 🧠 HELPER MẠNH MẼ (Để Template tự xử lý logic)
// ============================================================

// 1. So sánh cơ bản
Handlebars.registerHelper("eq", (a, b) => a == b);
Handlebars.registerHelper("neq", (a, b) => a != b);
Handlebars.registerHelper("gt", (a, b) => Number(a) > Number(b));
Handlebars.registerHelper("lt", (a, b) => Number(a) < Number(b));
Handlebars.registerHelper("gte", (a, b) => Number(a) >= Number(b));
Handlebars.registerHelper("lte", (a, b) => Number(a) <= Number(b));

// 2. Logic
Handlebars.registerHelper("and", (a, b) => a && b);
Handlebars.registerHelper("or", (a, b) => a || b);

// 3. Format hiển thị (Dành riêng cho Marathon)

// Format Gram (+500, -200, 0, ?)
Handlebars.registerHelper("fmtDelta", (val) => {
    if (val === null || val === undefined || val === "") return "?";
    const num = parseFloat(val);
    const gram = Math.round(num * 1000);
    if (gram > 0) return "+" + gram;
    return gram; // 0 hoặc số âm
});

// Format KG (65.5, --)
Handlebars.registerHelper("fmtWeight", (val) => {
    if (val === null || val === undefined || val === "") return "--";
    return parseFloat(val).toFixed(1).replace('.0', '');
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

app.post("/render", async (req, res) => {
  try {
    const { template, data, width = 1080, height = 1444, filename_prefix = "image" } = req.body;
    
    if (!template) throw new Error("Missing 'template' field");

    // 1. Render HTML (Server chỉ ghép data vào template, không sửa data)
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
});

// Route Legacy (Giữ lại để không lỗi workflow cũ chưa kịp sửa)
app.post("/render/personal", (req, res) => {
    req.body.template = req.body.template_url || "personal_progress.hbs";
    req.body.filename_prefix = "personal";
    // Wrap data cũ vào cấu trúc mới nếu cần, hoặc để nguyên nếu n8n đã sửa
    return app._router.handle(req, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Universal Renderer running on ${PORT}`));
