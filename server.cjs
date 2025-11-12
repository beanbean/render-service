// server.cjs — Render Service (Express + Handlebars + Puppeteer)

const path = require("path");
const fs = require("fs/promises");
const express = require("express");
const bodyParser = require("body-parser");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer");

// --- Setup Express ---
const app = express();
app.use(bodyParser.json({ limit: "2mb" }));

// --- API KEY ---
const API_KEY = process.env.API_KEY || "";
app.use((req, res, next) => {
  if (!API_KEY) return next(); // nếu chưa set API_KEY thì bỏ qua check
  const k = req.header("x-api-key");
  if (k !== API_KEY) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
});

// --- Health Check ---
app.get("/", (_, res) => res.json({ ok: true }));

// --- Handlebars Helpers ---
Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("includes", (arr, val) => Array.isArray(arr) && arr.includes(val));
Handlebars.registerHelper("ifEquals", function (a, b, opts) {
  return a == b ? opts.fn(this) : opts.inverse(this);
});

// --- Render Template Function ---
async function renderTemplate(file, data, opts = {}) {
  try {
    const tplPath = path.join(__dirname, "templates", file);
    const src = await fs.readFile(tplPath, "utf8");
    const tpl = Handlebars.compile(src);
    const html = tpl(data);

    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: "new",
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });

    const page = await browser.newPage();
    const width = opts.width || 1080;
    const height = opts.height || 1350;

    await page.setViewport({ width, height });
    await page.setContent(html, { waitUntil: ["domcontentloaded", "networkidle0"] });
    await page.evaluateHandle("document.fonts.ready");

    const buf = await page.screenshot({ type: "png" });
    await browser.close();

    return buf.toString("base64");
  } catch (err) {
    console.error("Render error:", err);
    throw err;
  }
}

// --- API Endpoints ---
app.post("/render/leaderboard", async (req, res) => {
  try {
    const base64 = await renderTemplate("daily-leader.hbs", req.body, {
      width: 2160,
      height: 2700,
    });
    res.json({ ok: true, image_base64: base64 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/render/personal", async (req, res) => {
  try {
    const base64 = await renderTemplate("personal-card.hbs", req.body, {
      width: 1080,
      height: 1350,
    });
    res.json({ ok: true, image_base64: base64 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`render-service on ${PORT}`));
