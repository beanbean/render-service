import express from "express";
import fs from "fs";
import handlebars from "handlebars";
import puppeteer from "puppeteer";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/healthz", (_, res) => res.json({ ok: true }));

app.post("/render", async (req, res) => {
  try {
    const { template = "daily-leader", data = {} } = req.body;

    const htmlSrc = fs.readFileSync(`./templates/${template}.hbs`, "utf8");
    const html = handlebars.compile(htmlSrc)(data);

    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    const png = await page.screenshot({ type: "png" });
    await page.close(); await browser.close();

    res.json({ ok: true, image_base64: png.toString("base64") });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.listen(3000, () => console.log("render-service on :3000"));
