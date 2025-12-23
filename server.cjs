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

app.get("/", (_, res) => res.json({ ok: true, status: "alive" }));

Handlebars.registerHelper("eq", (a, b) => a === b);

async function renderTemplate(file, data, opts = {}) {
  try {
    let src = "";
    const baseUrl = "https://raw.githubusercontent.com/beanbean/nexme-render-templates/main";
    const cleanFile = file.split('/').pop(); 
    const finalUrl = `${baseUrl}/${cleanFile}?t=${Date.now()}`;
    const response = await fetch(finalUrl);
    if (!response.ok) throw new Error(`Github 404: ${finalUrl}`);
    src = await response.text();
    const tpl = Handlebars.compile(src);
    return tpl(data);
  } catch (err) { throw err; }
}

app.post("/render/personal", async (req, res) => {
  try {
    const data = req.body;
    const timestamp = Date.now();
    
    const p = data.player || {};
    const s = data.stats || {};
    const g = p.grid || [];

    // Format: Nếu null thì trả về "?"
    const fmt = (n) => (n !== null && n !== undefined) ? parseFloat(n).toFixed(1).replace('.0', '') : "?";

    // 1. Check Hoàn thành (Chỉ hiện kết quả khi xong Ngày 10)
    const day10 = g.find(d => d.day === 10);
    const isFinished = day10 && day10.status === 'logged'; // Node n8n trả status 'logged' nếu có dữ liệu

    // 2. Map Grid
    const daysMapped = g.map(d => {
        let valDisplay = "?";
        let statusClass = "future";
        
        let delta = d.delta_from_start; // Nhận từ n8n

        if (delta !== null && delta !== undefined) {
            let deltaGram = Math.round(parseFloat(delta) * 1000);
            
            if (deltaGram === 0) {
                statusClass = "logged"; // Màu xám đậm
                valDisplay = "0";
            } else if (deltaGram < 0) {
                statusClass = "loss";   // Màu xanh
                valDisplay = deltaGram; // Hiện số âm (-500)
            } else {
                statusClass = "gain";   // Màu cam
                valDisplay = "+" + deltaGram; // Thêm dấu + (+500)
            }
        } else {
            // Trường hợp chưa báo cáo
            statusClass = "future"; // Template style cho màu xám nhạt
            valDisplay = "?";       // Hiện dấu hỏi
        }

        return {
            status: statusClass,
            value_g: valDisplay,
            label: `NGÀY ${d.day}`,
            leader: d.is_today ? "HÔM NAY" : null
        };
    });

    // 3. Chuẩn bị Context
    const context = {
        player: {
            name: p.name,
            team: p.team,
            avatar: p.avatar,
            round_name: p.round_name,
            info_line: p.info_line
        },
        stats: {
            start: fmt(s.start_weight),
            // Logic: Chưa xong giải -> Hiện ?
            finish: isFinished ? fmt(s.current_weight) : "?",
            result: isFinished ? fmt(s.delta_weight) : "?",
            // Tổng kết dưới cùng: Luôn hiện số thực
            current_change: fmt(s.delta_weight)
        },
        days: daysMapped
    };

    const filename = `personal-${timestamp}`;
    const html = await renderTemplate("personal_progress.hbs", context);
    
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: "new"
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1444 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    const base64 = (await page.screenshot({ type: "png" })).toString("base64");
    await browser.close();

    const imageUrl = await uploadToR2(base64, filename, "reports");
    res.json({ ok: true, image_url: imageUrl });

  } catch (e) {
    console.error("Error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
