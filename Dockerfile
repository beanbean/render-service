# ✅ BƯỚC 1: Dùng Image chính chủ của Puppeteer (Đã có sẵn Chrome chuẩn)
# Chọn version khớp với package.json (v22) để ổn định nhất
FROM ghcr.io/puppeteer/puppeteer:22.7.1

# ✅ BƯỚC 2: Chuyển quyền sang Root để cài đặt thư viện Node
USER root

# Thiết lập thư mục làm việc
WORKDIR /app

# Copy file định nghĩa thư viện trước (Tối ưu cache)
COPY package*.json ./

# Cài đặt thư viện (Bỏ qua devDependencies cho nhẹ)
RUN npm ci --omit=dev

# ✅ BƯỚC 3: Copy toàn bộ code nguồn vào
COPY . .

# ✅ BƯỚC 4: Chuyển lại quyền cho user 'pptruser' (User bảo mật của Puppeteer)
# Bắt buộc phải có dòng này, nếu chạy bằng root Chrome sẽ báo lỗi Sandbox
USER pptruser

# Thiết lập biến môi trường
ENV NODE_ENV=production
ENV PORT=3000
# Lưu ý: Không cần set PUPPETEER_EXECUTABLE_PATH vì Image gốc đã tự set rồi

# Mở cổng
EXPOSE 3000

# Chạy server
CMD ["node", "server.cjs"]
