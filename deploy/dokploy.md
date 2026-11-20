# Notification Service: Dokploy Compose riêng

Luồng triển khai: push `master` → GitHub Actions lint/test → build image → Docker Hub → Docker Hub webhook → Dokploy deploy riêng Notification Service.

## 1. Những file đã chuẩn bị

- `Dockerfile`: Node 24, build NestJS, runtime chỉ có production dependencies, chạy bằng user `node`, port `8085`, healthcheck `/ping`.
- `.dockerignore`: chỉ đưa package manifests, cấu hình TypeScript và `src` vào build; loại `.env*`, key và credential files.
- `.github/workflows/publish-image.yml`: lint, unit tests, Docker build; chỉ push image khi chạy trên `master`, không push từ pull request.
- `.env.dokploy`: file riêng tư đã tạo trên máy, bị Git ignore. Dán vào Dokploy, không đưa vào GitHub hoặc Docker Hub.
- `compose.production.yml`: service `hs-notification-service`, image từ `${NOTIFICATION_IMAGE:?}`, memory limit 512 MiB, tự tham gia external `hs-network`. Không có fallback, host port hoặc volume; healthcheck kế thừa từ image. Chạy một instance, không cần alias hoặc Advanced → Networks.

## 2. Kiểm tra hạ tầng trước

MongoDB, Kafka, Discovery, Keycloak và Gateway phải đang chạy. Compose này dùng chung overlay attachable `hs-network` do infra quản lý; không tạo lại infra, network hoặc volumes.

Env đã chuẩn bị:

| Biến | Giá trị production / nguồn |
| --- | --- |
| `NOTIFICATION_IMAGE` | `nvminh162/hs-notification-service:latest`, đặt ở dòng đầu `.env.dokploy`; chỉ dùng để chọn image |
| `NODE_ENV` | `production` |
| `PORT` | `8085` |
| `SERVICE_NAME` | `hs-notification-service`, đúng tên Gateway tìm trong Eureka |
| `MONGODB_URI` | `mongodb:27017`, database riêng `homespace_notification`, authSource `admin`; credential lấy từ infra `.env.dokploy` |
| `EUREKA_CLIENT_SERVICE_URL` | `http://hs-discovery-server:8761/eureka/`, service name Discovery Compose trên `hs-network` |
| `EUREKA_INSTANCE_HOSTNAME` | `hs-notification-service`: DNS từ tên service Compose trên mạng chung |
| `GATEWAY_INTERNAL_SECRET` | Giữ giá trị đang dùng ở Gateway production |
| `KAFKA_BROKERS` | `kafka:19092`, listener nội bộ đã deploy |
| `KAFKA_EVENTS_TOPIC` | `homespace.notification.events.v1`, khớp infra/Core |
| `KAFKA_DLT_TOPIC` | `homespace.notification.events.dlt.v1` |
| `KAFKA_GROUP_ID` | Giữ group hiện có; không đổi sau mỗi deployment |
| `KEYCLOAK_ISSUER_URL` | `https://auth.homespace.id.vn/realms/homespace-platform` |
| `KEYCLOAK_AUDIENCE` | `hs-notification-service`, phải có trong access token |
| `NOTIFICATION_REALTIME_ORIGINS` | `https://homespace.id.vn,https://admin.homespace.id.vn` |
| `PUSH_ENABLED`, `FIREBASE_*` | Giữ cấu hình Firebase đang dùng, gồm private key |

Dấu single quote trong `.env.dokploy` là cú pháp dotenv; dán nguyên nội dung vào Dokploy Environment. Private key được lưu trên một dòng với `\n`, provider đã hỗ trợ chuyển thành xuống dòng. Không dùng nguyên file này với `docker run --env-file` vì Docker CLI xử lý dấu quote khác dotenv.

Compose yêu cầu biến image và đủ 30 biến runtime trong `.env.dokploy` bằng `${VARIABLE:?}`: thiếu hoặc rỗng sẽ báo lỗi. Giữ nguyên `.env` và `.env.example` dành cho dev; không thêm biến image vào hai file đó.

MongoDB phải có DNS `mongodb`, Kafka có DNS `kafka`, Discovery Compose có service name `hs-discovery-server` trên mạng chung. URL Eureka dùng DNS từ tên service trong YAML, không phụ thuộc tên container sinh ngẫu nhiên. Tên hiển thị trên Dokploy không thay thế tên service trong YAML.

## 3. Docker Hub và GitHub

1. Docker Hub → Create repository: namespace `nvminh162`, repository **`hs-notification-service`**.
2. GitHub → `homespace-platform/hs-notification-service` → Settings → Secrets and variables → Actions.
3. Thêm hoặc cấp quyền dùng hai org secrets:
   - `DOCKERHUB_USERNAME`: tài khoản có quyền push vào namespace `nvminh162`.
   - `DOCKERHUB_TOKEN`: Docker Hub access token có quyền Read & Write.
4. Review rồi commit/push các file deploy mới lên `master`. Giữ `.env.dokploy` ngoài commit. Không gộp file checklist đang có thay đổi local vào commit deploy nếu chưa review.
5. GitHub → Actions → **Build and publish Notification Service** → chờ thành công. Workflow cũng có nút Run workflow để chạy lại trên `master`.

Image được push với hai tag: `nvminh162/hs-notification-service:latest` và tag Git SHA để rollback. Không cần Firebase/MongoDB/Kafka secrets trong GitHub Actions, và không cần `DOKPLOY_DEPLOY_WEBHOOK` ở GitHub.

## 4. Tạo Compose trên Dokploy

1. Nếu đang có Application Notification cũ, lưu lại cấu hình, domain và webhook rồi Stop trước khi chạy Compose mới; không chạy hai bản song song. Giữ nguyên infra và dữ liệu.
2. Projects → **homespace → production → Create Service → Docker Compose**, tên `hs-notification-service`, cùng server với infra.
3. General → Provider **Raw**, dán toàn bộ [compose.production.yml](../compose.production.yml), chọn Compose Type **Docker Compose**, không chọn Stack → **Save**. Image đã được GitHub Actions build; không cấu hình Nixpacks.
4. **Environment**: dán đầy đủ `.env.dokploy`, có `NOTIFICATION_IMAGE` ở dòng đầu → **Save**. File local không tự cập nhật Dokploy.
5. **Preview Compose** phải có service `hs-notification-service`, đúng image và default network external `hs-network`. Giữ tắt Isolated Deployment và xác nhận Preview vẫn giữ mạng chung; không cần chỉnh Advanced → Networks. Không publish cổng `8085` ra host.
6. **Domains**: web đang dùng `NEXT_PUBLIC_NOTIFICATION_SOCKET_URL=https://notification.homespace.id.vn`. Thêm domain `notification.homespace.id.vn`, **Service Name `hs-notification-service`**, Container Port **8085**, Path `/`, Internal Path `/`, Strip Path **tắt**, HTTPS **bật**, Certificate Provider **Let's Encrypt**. Gỡ route trùng khỏi Application cũ trước khi thêm. DNS origin trỏ về EC2; nếu giữ proxy OneShield thì origin HTTPS phải hoạt động. Admin vẫn dùng WebSocket qua Gateway.
7. **Deploy** sau khi đã Save env/domain. Chờ container healthy; Logs cần có `Registered ... with Eureka`, không có lỗi MongoDB/Kafka/configuration. Mỗi lần sửa domain cần redeploy Compose.
8. Chỉ chạy **một instance**. Realtime hiện chưa có shared Socket.IO adapter; không scale nhiều replica.

## 5. Bật CD bằng webhook Docker Hub

1. Dokploy Compose Notification → General → bật **Autodeploy** sau khi deploy thủ công thành công.
2. Deployments → copy **Webhook URL của chính Compose Notification**, dạng `/api/deploy/compose/TOKEN`.
3. Docker Hub → `nvminh162/hs-notification-service` → Webhooks → **New webhook**.
4. Name: `dokploy-notification`; URL: dán URL vừa copy → Save.
5. Chạy lại workflow trên GitHub để kiểm tra chuỗi tự động. Docker Hub gọi Dokploy; Compose có `pull_policy: always` để pull image trước khi chạy.

Raw Compose trên Dokploy v0.31.4 không lọc tag như Application Docker; workflow push cả SHA và `latest` có thể gây hai delivery/deploy. Kiểm tra lịch sử delivery Docker Hub và Deployments trên Dokploy. Không dùng webhook infra/Core/Gateway hoặc URL Application cũ. Raw không tự lấy YAML từ Git: khi sửa Compose phải dán lại YAML rồi Save. Giữ kín webhook token. Xem [Dokploy Auto Deploy](https://docs.dokploy.com/docs/core/auto-deploy).

## 6. Kiểm tra sau deploy

Chạy trên EC2, từng khối một:

```bash
sudo docker ps --filter label=com.docker.compose.service=hs-notification-service --format '{{.Names}} {{.Status}}'
```

Discovery dashboard phải có **HS-NOTIFICATION-SERVICE — UP**. Chờ Gateway cập nhật registry khoảng 30–60 giây.

```bash
curl --fail --silent --show-error --max-time 10 https://api.homespace.id.vn/api/v1/notifications/ping
```

Kết quả `pong`. Lệnh này chứng minh đường Gateway → Eureka → Notification hoạt động. Healthcheck `/ping` trong image chỉ kiểm tra HTTP process, không chứng minh gửi Firebase thành công hay consumer không bị lag sau startup.

```bash
curl --silent --output /dev/null --write-out 'HTTP %{http_code}\n' --max-time 10 https://api.homespace.id.vn/api/v1/notifications/feed
```

Chưa đăng nhập phải trả `401`. Sau đó đăng nhập frontend, mở chuông thông báo; DevTools → Network kiểm tra `/api/v1/notifications/feed`, `/unread-count` trả 200. Web dùng WebSocket `notification.homespace.id.vn/socket.io/`; admin dùng `api.homespace.id.vn/api/v1/notifications/socket.io/`, upgrade 101. Socket dùng namespace `/notifications` và kiểm tra JWT/origin riêng. Token từ cả hai client Keycloak phải có audience `hs-notification-service`; realm export hiện có scope `notification-access`, cần đối chiếu realm đang chạy.

Thực hiện một thao tác nghiệp vụ thật có phát notification; kiểm tra Kafka consumer lag, thông báo được lưu, realtime cập nhật và không nhân đôi. Bật quyền push trên trình duyệt để thử Firebase riêng; trạng thái provider `accepted` không có nghĩa trình duyệt đã hiển thị. Khi group lần đầu xuất hiện trên production, consumer đọc backlog từ đầu; không đổi group tùy tiện để tránh replay không cần thiết.

## 7. Xử lý các lỗi thường gặp

- **Image not found**: workflow chưa push thành công hoặc sai image/tag; private image cần registry pull credential.
- **MongoDB UnknownHost / authentication failed**: kiểm tra mạng chung, alias `mongodb`, credential infra và `authSource=admin`; không reset volume.
- **Kafka startup failed / topics missing**: kiểm tra `kafka:19092` và hai topic notification đã có. Service không tự tạo topic.
- **Không xuất hiện trong Eureka**: kiểm tra Discovery service name/URL và DNS từ container, không dùng hostname `localhost` để trỏ đến Discovery.
- **Socket Unauthenticated**: kiểm tra issuer HTTPS, audience trong token, origin web/admin chính xác và giờ hệ thống; không tắt JWT verification.
- **Push lỗi nhưng feed vẫn chạy**: kiểm tra Firebase service account/project/FCM API, browser registration và quyền push; giữ secret ngoài log.

Rollback image: đổi `NOTIFICATION_IMAGE` trong Environment sang `nvminh162/hs-notification-service:<SHA-đã-biết-tốt>`, Save rồi Deploy. Tạm tắt Autodeploy trong thời gian pin tag. Không xóa MongoDB, Kafka topic hoặc group để rollback code.
