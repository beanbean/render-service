# 1. Dùng Base Image từ Docker Hub (An toàn, không cần login)
FROM node:20-slim

# 2. Cài đặt Chromium và các thư viện cần thiết để vẽ ảnh
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
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 3. Cấu hình biến môi trường để Puppeteer nhận diện Chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV PORT=3000

# 4. Thiết lập thư mục
WORKDIR /app

# 5. Copy file cấu hình
COPY package*.json ./

# 6. Cài đặt thư viện (Dùng 'install' để tự tạo lockfile nếu thiếu)
RUN npm install --omit=dev

# 7. Copy toàn bộ code nguồn (server.cjs, upload-r2.cjs)
COPY . .

# 8. Mở cổng
EXPOSE 3000

# 9. Chạy server
CMD ["node", "server.cjs"]
