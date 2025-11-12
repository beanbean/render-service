# ---- Base image ----
FROM node:20-slim

# ---- Cài đặt Chromium và các dependencies cần thiết cho Puppeteer ----
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libnss3 \
    libx11-6 \
    libxss1 \
    libgtk-3-0 \
    fonts-freefont-ttf \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# ---- Đặt thư mục làm việc ----
WORKDIR /app

# ---- Copy và cài đặt dependencies ----
COPY package*.json ./
RUN npm install --omit=dev

# ---- Copy toàn bộ mã nguồn ----
COPY . .

# ---- Biến môi trường ----
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV PORT=3000

# ---- Mở port cho Dokploy ----
EXPOSE 3000

# ---- Lệnh khởi động trực tiếp ----
CMD ["node", "server.cjs"]
