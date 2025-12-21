# Dùng Image chuẩn của Puppeteer (Đã cài sẵn Chrome xịn)
FROM ghcr.io/puppeteer/puppeteer:22.7.1

# Chuyển quyền root để cài app
USER root

WORKDIR /app

# Copy file cấu hình
COPY package*.json ./

# Cài thư viện (Bỏ qua Chromium vì Image đã có sẵn)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN npm ci --omit=dev

# Copy code
COPY . .

# Chuyển lại quyền User Puppeteer (BẮT BUỘC để chạy Chrome an toàn)
USER pptruser

EXPOSE 3000
CMD ["node", "server.cjs"]
