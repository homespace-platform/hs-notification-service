# Hợp đồng thuê & Đặt cọc (contract)

`index.ts` export `contractEmails` (eventType -> EmailSpec, tất cả OPT_IN). Mẫu `.hbs` nhóm theo luồng: signing-needed, fully-signed, amendment, renewal, termination, settlement, complaint, digest.
`format.ts`: định dạng ngày (giờ Asia/Ho_Chi_Minh) và tiền vi-VN; chỉ các khóa dữ liệu trong allowlist mới được in ra email.
Email HĐ thuê ký xong (AGREEMENT_FULLY_SIGNED, agreementType LEASE) đính kèm LEASE_BUNDLE; HĐ cọc ký xong không đính kèm.
