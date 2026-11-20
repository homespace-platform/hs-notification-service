# Notification Service: Dokploy Application riêng

Luồng triển khai: push `master` → GitHub Actions lint/test → build image → Docker Hub → Docker Hub webhook → Dokploy deploy riêng Notification Service.

## 1. Những file đã chuẩn bị

- `Dockerfile`: Node 24, build NestJS, runtime chỉ có production dependencies, chạy bằng user `node`, port `8085`, healthcheck `/ping`.
- `.dockerignore`: chỉ đưa package manifests, cấu hình TypeScript và `src` vào build; loại `.env*`, key và credential files.
- `.github/workflows/publish-image.yml`: lint, unit tests, Docker build; chỉ push image khi chạy trên `master`, không push từ pull request.
- `.env.dokploy`: file riêng tư đã tạo trên máy, bị Git ignore. Dán vào Dokploy, không đưa vào GitHub hoặc Docker Hub.

## 2. Kiểm tra hạ tầng trước

MongoDB, Kafka, Discovery, Keycloak và Gateway phải đang chạy. Application này dùng chung overlay attachable `hs-network` với hạ tầng và Gateway.

Env đã chuẩn bị:

| Biến | Giá trị production / nguồn |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | `8085` |
| `SERVICE_NAME` | `hs-notification-service`, đúng tên Gateway tìm trong Eureka |
| `MONGODB_URI` | `mongodb:27017`, database riêng `homespace_notification`, authSource `admin`; credential lấy từ infra `.env.dokploy` |
| `EUREKA_CLIENT_SERVICE_URL` | `http://hs-discovery-server:8761/eureka/`, service name Discovery Compose trên `hs-network` |
| `EUREKA_INSTANCE_HOSTNAME` | `localhost`: code tự tìm IPv4 của container để đăng ký Eureka |
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

MongoDB phải có DNS `mongodb`, Kafka có DNS `kafka`, Discovery Compose có service name `hs-discovery-server` trên mạng chung. URL Eureka dùng DNS từ tên service trong YAML, không phụ thuộc tên Swarm/container sinh ngẫu nhiên. Tên hiển thị Application không tự tạo DNS alias.

## 3. Docker Hub và GitHub

1. Docker Hub → Create repository: namespace `nvminh162`, repository **`hs-notification-service`**.
2. GitHub → `homespace-platform/hs-notification-service` → Settings → Secrets and variables → Actions.
3. Thêm hoặc cấp quyền dùng hai org secrets:
   - `DOCKERHUB_USERNAME`: tài khoản có quyền push vào namespace `nvminh162`.
   - `DOCKERHUB_TOKEN`: Docker Hub access token có quyền Read & Write.
4. Review rồi commit/push các file deploy mới lên `master`. Giữ `.env.dokploy` ngoài commit. Không gộp file checklist đang có thay đổi local vào commit deploy nếu chưa review.
5. GitHub → Actions → **Build and publish Notification Service** → chờ thành công. Workflow cũng có nút Run workflow để chạy lại trên `master`.

Image được push với hai tag: `nvminh162/hs-notification-service:latest` và tag Git SHA để rollback. Không cần Firebase/MongoDB/Kafka secrets trong GitHub Actions, và không cần `DOKPLOY_DEPLOY_WEBHOOK` ở GitHub.

## 4. Tạo Application trên Dokploy

1. Projects → **homespace → production → Create Service → Application**.
2. Name: **`homespace-notification`**, chọn cùng server với hạ tầng.
3. General → Provider → **Docker**:

   | Trường | Điền |
   | --- | --- |
   | Docker Image | `nvminh162/hs-notification-service:latest` |
   | Registry URL | Để trống cho image Docker Hub public; nếu private, dùng registry Docker Hub và credential pull |
   | Username / Password | Để trống cho public; nếu private, username và token có quyền Read |

4. Save. Với Docker provider, Dokploy pull image đã build; không cấu hình Nixpacks hay build source trên server.
5. Environment → mở file `.env.dokploy` trên máy, copy toàn bộ, dán vào editor → **Save**.
6. Advanced → Networks → chọn **`hs-network`** → Save. Giữ kết nối `dokploy-network` như Gateway/Core. Nếu UI chưa liệt kê mạng, kiểm tra đúng server và Refresh; không tạo lại hay xóa mạng đang chạy. Nếu có mục Swarm Settings → Network, chọn Target `hs-network` tại đó và Save.
7. Advanced → Replicas: **1**. Realtime hiện chưa có shared Socket.IO adapter, nên không scale nhiều replica.
8. Resources: khởi đầu memory limit **512 MiB** (`536870912` bytes), CPU limit **1** nếu cần. Theo dõi thực tế rồi điều chỉnh.
9. Không cần volume hoặc domain riêng: MongoDB giữ dữ liệu, Gateway đang phục vụ REST và WebSocket. Không publish port `8085` ra host hoặc mở nó trong EC2 Security Group.
10. General → **Deploy**. Chờ container healthy; Logs cần có `Registered ... with Eureka`, không có lỗi MongoDB/Kafka/configuration.

## 5. Bật CD bằng webhook Docker Hub

1. Dokploy Application Notification → General → bật **Autodeploy**.
2. Deployments → copy **Webhook URL của chính Application Notification**.
3. Docker Hub → `nvminh162/hs-notification-service` → Webhooks → **New webhook**.
4. Name: `dokploy-notification`; URL: dán URL vừa copy → Save.
5. Chạy lại workflow trên GitHub để kiểm tra chuỗi tự động. Khi `latest` được push, Docker Hub gọi Dokploy và chỉ cập nhật Application này.

Dokploy chỉ triển khai khi tag webhook khớp image tag đã cấu hình (`latest`); tag SHA không khớp sẽ được bỏ qua. Không dùng webhook infra/Core/Gateway, không dùng URL Compose. Xem [Dokploy Auto Deploy](https://docs.dokploy.com/docs/core/auto-deploy).

## 6. Kiểm tra sau deploy

Chạy trên EC2, từng khối một:

```bash
sudo docker service ls --format '{{.Name}} {{.Replicas}}' | grep -i notification
```

Discovery dashboard phải có **HS-NOTIFICATION-SERVICE — UP**. Chờ Gateway cập nhật registry khoảng 30–60 giây.

```bash
curl --fail --silent --show-error --max-time 10 https://api.homespace.id.vn/api/v1/notifications/ping
```

Kết quả `pong`. Lệnh này chứng minh đường Gateway → Eureka → Notification hoạt động. Healthcheck `/ping` trong image chỉ kiểm tra HTTP process, không chứng minh gửi Firebase thành công hay consumer không bị lag sau startup.

```bash
curl --silent --output /dev/null --write-out 'HTTP %{http_code}\n' --max-time 10 https://api.homespace.id.vn/api/v1/notifications/feed
```

Chưa đăng nhập phải trả `401`. Sau đó đăng nhập frontend, mở chuông thông báo; DevTools → Network kiểm tra `/api/v1/notifications/feed`, `/unread-count` trả 200 và WebSocket `/api/v1/notifications/socket.io/` upgrade 101. Socket dùng namespace `/notifications` và kiểm tra JWT/origin riêng.

Thực hiện một thao tác nghiệp vụ thật có phát notification; kiểm tra Kafka consumer lag, thông báo được lưu, realtime cập nhật và không nhân đôi. Bật quyền push trên trình duyệt để thử Firebase riêng; trạng thái provider `accepted` không có nghĩa trình duyệt đã hiển thị. Khi group lần đầu xuất hiện trên production, consumer đọc backlog từ đầu; không đổi group tùy tiện để tránh replay không cần thiết.

## 7. Xử lý các lỗi thường gặp

- **Image not found**: workflow chưa push thành công hoặc sai image/tag; private image cần registry pull credential.
- **MongoDB UnknownHost / authentication failed**: kiểm tra mạng chung, alias `mongodb`, credential infra và `authSource=admin`; không reset volume.
- **Kafka startup failed / topics missing**: kiểm tra `kafka:19092` và hai topic notification đã có. Service không tự tạo topic.
- **Không xuất hiện trong Eureka**: kiểm tra Discovery service name/URL và DNS từ container, không dùng hostname `localhost` để trỏ đến Discovery.
- **Socket Unauthenticated**: kiểm tra issuer HTTPS, audience trong token, origin web/admin chính xác và giờ hệ thống; không tắt JWT verification.
- **Push lỗi nhưng feed vẫn chạy**: kiểm tra Firebase service account/project/FCM API, browser registration và quyền push; giữ secret ngoài log.

Rollback image: đổi Docker Image sang `nvminh162/hs-notification-service:<SHA-đã-biết-tốt>`, Save rồi Deploy. Tạm tắt Autodeploy trong thời gian pin tag. Không xóa MongoDB, Kafka topic hoặc group để rollback code.
