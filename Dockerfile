# 1. Dùng Base Image từ Docker Hub (Không bao giờ bị lỗi auth)
FROM node:20-slim

# 2. Cài đặt Chromium và các thư viện cần thiết cho Puppeteer
# (Lệnh này hơi dài nhưng đảm bảo đủ thư viện để vẽ ảnh)
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

# 3. Cấu hình biến môi trường để Puppeteer dùng Chrome đã cài ở trên
# (Không tải thêm Chrome về nữa cho nhẹ)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV PORT=3000

# 4. Thiết lập thư mục làm việc
WORKDIR /app

# 5. Copy file cấu hình và cài thư viện Node
COPY package*.json ./
RUN npm install --omit=dev

# 6. Copy toàn bộ code nguồn
COPY . .

# 7. Mở cổng
EXPOSE 3000

# 8. Chạy server
CMD ["node", "server.cjs"]
