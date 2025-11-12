// trong phần cấu hình Handlebars ở server.js
const Handlebars = require("handlebars");

Handlebars.registerHelper("eq", (a,b) => a === b);
Handlebars.registerHelper("includes", (arr, val) => Array.isArray(arr) && arr.includes(val));

const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs/promises");
const hbs = require("handlebars");
const puppeteer = require("puppeteer");

const app = express();
app.use(bodyParser.json({ limit: "2mb" }));

// --- API KEY ---
const API_KEY = process.env.API_KEY;
app.use((req, res, next) => {
  if (!API_KEY) return next();
  const k = req.header("x-api-key");
  if (k !== API_KEY) return res.status(401).json({ ok: false, error: "unauthorized" });
  next();
});

// --- health check ---
app.get("/", (_, res) => res.json({ ok: true }));

// helper
hbs.registerHelper("ifEquals", function(a, b, opts) {
  return a == b ? opts.fn(this) : opts.inverse(this);
});

// render function
async function renderTemplate(file, data, opts = {}) {
  const tplPath = path.join(__dirname, "templates", file);
  const src = await fs.readFile(tplPath, "utf8");
  const tpl = hbs.compile(src);

  const html = tpl(data);
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: "new"
  });
  const page = await browser.newPage();
  const width = opts.width || 2160;
  const height = opts.height || 2700;
  await page.setViewport({ width, height });
  await page.setContent(html, { waitUntil: ["domcontentloaded", "networkidle0"] });
  await page.evaluateHandle("document.fonts.ready");

  const buf = await page.screenshot({ type: "png" });
  await browser.close();
  return buf.toString("base64");
}

// endpoints
app.post("/render/leaderboard", async (req, res) => {
  try {
    const base64 = await renderTemplate("daily-leader.hbs", req.body, { width: 2160, height: 2700 });
    res.json({ ok: true, image_base64: base64 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/render/personal", async (req, res) => {
  try {
    const base64 = await renderTemplate("personal-card.hbs", req.body, { width: 1080, height: 1350 });
    res.json({ ok: true, image_base64: base64 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("render-service on", PORT));
