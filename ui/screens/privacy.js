// Màn Quyền riêng tư (#/privacy) — khớp nguyên văn docs/PRIVACY.md theo ngôn ngữ giao diện.
import { h, clear } from "../components/dom.js";
import { t, lang } from "../i18n.js";

function contentVi() {
  return [
    h("p.muted.small", "Cập nhật: 25/11/2026"),
    h("p", h("strong", "Không đăng nhập thì không có gì rời khỏi máy bạn."), " Ứng dụng chạy và lưu tiến độ ngay trên thiết bị (bộ nhớ của trình duyệt). Tài khoản là tùy chọn, chỉ để đồng bộ tiến độ giữa nhiều thiết bị."),
    h("p", h("strong", "Khi bạn đăng nhập, chúng tôi lưu:")),
    h(
      "ul.privacy-list",
      h("li", "Thông tin tài khoản: địa chỉ email; tên và ảnh đại diện Google (nếu đăng nhập bằng Google)."),
      h("li", "Tiến độ học: thẻ ôn tập, điểm kinh nghiệm (XP), chuỗi ngày, lịch học theo ngày, bài đã xong, huy hiệu, cài đặt, từ đã đánh dấu ⭐, lịch sử tìm kiếm trong từ điển (tối đa 8 mục gần nhất)."),
      h("li", "Một mã ngẫu nhiên cho mỗi thiết bị, để cộng điểm đúng khi bạn học trên nhiều máy. Mã này không định danh bạn hay thiết bị của bạn ở nơi nào khác."),
    ),
    h("p", h("strong", "Để làm gì:"), " chỉ để đăng nhập và đồng bộ tiến độ của bạn giữa các thiết bị. Không dùng cho quảng cáo, không bán, không chia sẻ cho bên thứ ba, không theo dõi hành vi. Ứng dụng không ghi âm lên máy chủ: luyện nói dùng tính năng nhận dạng giọng nói của trình duyệt."),
    h("p", h("strong", "Lưu ở đâu:"), " dịch vụ Firebase của Google (Firebase Authentication và Cloud Firestore), máy chủ Google Cloud tại Singapore (", h("code", "asia-southeast1"), "). Google xử lý dữ liệu này với vai trò bên cung cấp hạ tầng, theo điều khoản của Firebase. Chỉ tài khoản của bạn đọc và ghi được dữ liệu của bạn."),
    h("p", h("strong", "Xóa thế nào:")),
    h(
      "ul.privacy-list",
      h("li", "Trong ứng dụng: Hồ sơ / Cài đặt → ", h("strong", "Xóa dữ liệu đám mây"), ". Thao tác này xóa toàn bộ tiến độ đã đồng bộ và tài khoản đăng nhập của bạn trên máy chủ, rồi đăng xuất. Tiến độ trên thiết bị vẫn còn; muốn xóa nốt thì dùng ", h("strong", "Xóa tiến độ"), "."),
      h("li", "Đăng xuất không xóa dữ liệu đám mây. Khi đăng xuất bạn chọn giữ hay xóa tiến độ trên thiết bị đó."),
      h("li", "Bạn có thể xuất tiến độ ra file JSON bất cứ lúc nào (Cài đặt → Xuất dữ liệu)."),
    ),
    h("p", h("strong", "Liên hệ:"), " mở một issue trên trang GitHub của dự án (liên kết ở trang ", h("a.link", { href: "#/about" }, "Giới thiệu"), " trong ứng dụng)."),
  ];
}

function contentEn() {
  return [
    h("p.muted.small", "Last updated: 25/11/2026"),
    h("p", h("strong", "If you do not sign in, nothing leaves your device."), " The app runs and stores your progress on your device (browser storage). An account is optional and exists only to sync progress across devices."),
    h("p", h("strong", "When you sign in, we store:")),
    h(
      "ul.privacy-list",
      h("li", "Account details: your email address; your Google name and profile picture (if you sign in with Google)."),
      h("li", "Learning progress: review cards, experience points (XP), streak, daily study calendar, finished lessons, badges, settings, starred ⭐ words, and dictionary search history (the 8 most recent entries)."),
      h("li", "A random code per device, used to add up points correctly when you study on several devices. It does not identify you or your device anywhere else."),
    ),
    h("p", h("strong", "Why:"), " only to sign you in and sync your progress across your devices. No advertising, no selling, no sharing with third parties, no behavioural tracking. The app does not upload audio: speaking practice uses your browser's speech recognition."),
    h("p", h("strong", "Where:"), " Google's Firebase services (Firebase Authentication and Cloud Firestore), on Google Cloud servers in Singapore (", h("code", "asia-southeast1"), "). Google processes this data as the infrastructure provider under the Firebase terms. Only your account can read or write your data."),
    h("p", h("strong", "How to delete:")),
    h(
      "ul.privacy-list",
      h("li", "In the app: Profile / Settings → ", h("strong", "Delete cloud data"), ". This deletes all synced progress and your sign-in account from the server, then signs you out. Progress on your device stays; use ", h("strong", "Erase progress"), " to remove that too."),
      h("li", "Signing out does not delete cloud data. When signing out you choose whether to keep or erase progress on that device."),
      h("li", "You can export your progress to a JSON file at any time (Settings → Export data)."),
    ),
    h("p", h("strong", "Contact:"), " open an issue on the project's GitHub page (linked from the ", h("a.link", { href: "#/about" }, "About"), " page in the app)."),
  ];
}

export async function viewPrivacy(root) {
  const isEn = lang() === "en";
  clear(root).append(
    h("header.page-head", h("a.back-link", { href: "#/about" }, `← ${t("nav.about")}`), h("h1", t("acc.privacy"))),
    h("article.card.privacy-doc", isEn ? contentEn() : contentVi()),
  );
}
