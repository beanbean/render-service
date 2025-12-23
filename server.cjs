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

// Helper cộng trừ
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
    
    // Unpack data từ n8n (đã qua node JS Format chuẩn hóa cấu trúc)
    // Lưu ý: Cấu trúc data.player.grid do n8n gửi lên (xem node JS n8n bên dưới)
    const p = data.player || {};
    const s = data.stats || {}; // Lưu ý: stats nằm ngoài hay trong player tùy node n8n
    const g = p.grid || []; 

    // Helper format số
    const fmt = (n) => (n !== null && n !== undefined ? parseFloat(n).toFixed(1).replace('.0', '') : "--");

    // 1. Kiểm tra xem đã hoàn thành ngày 10 chưa?
    // Logic: Nếu ngày 10 có cân nặng (current_weight != null) -> Đã xong
    const day10 = g.find(d => d.day === 10);
    const isFinished = day10 && day10.status !== 'future' && day10.status !== 'missing';

    // 2. Map Grid Ngày (Logic hiển thị từng ô)
    const daysMapped = g.map(d => {
        let valDisplay = "?";
        let statusClass = "future"; // Mặc định xám nhạt (?)

        // Nếu ngày đó đã có dữ liệu delta (tức là đã nhập cân)
        if (d.delta_from_start !== null && d.delta_from_start !== undefined) {
            let delta = parseFloat(d.delta_from_start); // Đây là daily_delta (kg)
            let deltaGram = Math.round(delta * 1000);

            if (deltaGram === 0) {
                // Đứng cân: Màu xám đậm, số 0
                statusClass = "logged"; 
                valDisplay = "0";
            } else if (deltaGram < 0) {
                // Giảm cân: Màu xanh
                statusClass = "loss";
                valDisplay = deltaGram; // Hiện số âm (vd -500)
            } else {
                // Tăng cân: Màu cam
                statusClass = "gain";
                valDisplay = "+" + deltaGram; // Thêm dấu + cho rõ
            }
        } else {
            // Chưa nhập hoặc tương lai
            statusClass = "future"; // Hoặc 'missing' tùy CSS template
            valDisplay = "?";
        }

        return {
            status: statusClass,
            value_g: valDisplay,
            label: `NGÀY ${d.day}`,
            leader: d.is_today ? "HÔM NAY" : null
        };
    });

    const context = {
        player: {
            name: p.name,
            team: p.team,
            avatar: p.avatar,
            round_name: p.round_name,
            info_line: p.info_line || `Ngày ${new Date().getDate()}`
        },
        stats: {
            start: fmt(s.start_weight),
            
            // LOGIC QUAN TRỌNG: Ẩn kết quả nếu chưa xong
            finish: isFinished ? fmt(s.current_weight) : "?", 
            result: isFinished ? fmt(s.delta_weight) : "?",
            
            // Luôn hiện dòng tổng kết dưới cùng
            current_change: fmt(s.delta_weight)
        },
        days: daysMapped
    };

    const filename = `personal-${timestamp}`;
    const base64 = await renderTemplate("personal_progress.hbs", context, { width: 1080, height: 1444 });
    const imageUrl = await uploadToR2(base64, filename, "reports");
    
    res.json({ ok: true, image_url: imageUrl });

  } catch (e) {
    console.error("Error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
