// Màn Quyền riêng tư (#/privacy) — khớp nguyên văn docs/PRIVACY.md theo ngôn ngữ giao diện.
import { h, clear } from "../components/dom.js";
import { t, lang } from "../i18n.js";

function contentVi() {
  return [
    h("p.muted.small", "Cập nhật: 25/11/2026"),
    h("p", h("strong", "Không đăng nhập thì tiến độ học không rời khỏi máy bạn."), " Ứng dụng chạy và lưu tiến độ ngay trên thiết bị (bộ nhớ của trình duyệt). Tài khoản là tùy chọn, chỉ để đồng bộ tiến độ giữa nhiều thiết bị."),
    h("p", h("strong", "Những gì ứng dụng tải từ bên ngoài:"), " phông chữ từ Google Fonts; thư viện và dữ liệu nét chữ Hán từ jsDelivr. Như mọi trang web, hai dịch vụ này nhận địa chỉ IP (địa chỉ mạng) và thông tin trình duyệt của bạn; jsDelivr còn biết chữ Hán nào bạn mở để xem nét. Chúng không nhận tiến độ học của bạn. Giọng đọc và luyện nói dùng tính năng có sẵn của trình duyệt; tùy trình duyệt, chữ cần đọc hoặc tiếng bạn nói có thể được gửi tới máy chủ của hãng trình duyệt để xử lý."),
    h("p", h("strong", "Khi bạn đăng nhập, chúng tôi lưu:")),
    h(
      "ul.privacy-list",
      h("li", "Thông tin tài khoản: địa chỉ email; tên và ảnh đại diện Google (nếu đăng nhập bằng Google)."),
      h("li", "Tiến độ học: thẻ ôn tập, điểm kinh nghiệm (XP), chuỗi ngày, lịch học theo ngày, bài đã xong, huy hiệu, cài đặt, từ đã đánh dấu ⭐, lịch sử tìm kiếm trong từ điển (tối đa 8 mục gần nhất)."),
      h("li", "Một mã ngẫu nhiên cho mỗi thiết bị, để cộng điểm đúng khi bạn học trên nhiều máy. Mã này không định danh bạn hay thiết bị của bạn ở nơi nào khác."),
    ),
    h("p", h("strong", "Để làm gì:"), " chỉ để đăng nhập và đồng bộ tiến độ của bạn giữa các thiết bị. Không dùng cho quảng cáo, không bán, không chia sẻ cho bên thứ ba, không theo dõi hành vi. Ứng dụng không lưu bản ghi âm của bạn lên máy chủ của mình: bản ghi để nghe lại chỉ nằm trên thiết bị."),
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
    h("p", h("strong", "If you do not sign in, your learning progress never leaves your device."), " The app runs and stores your progress on your device (browser storage). An account is optional and exists only to sync progress across devices."),
    h("p", h("strong", "What the app loads from outside:"), " fonts from Google Fonts; the Chinese stroke library and stroke data from jsDelivr. As with any website, these two services receive your IP address and browser information; jsDelivr also sees which characters you open to view strokes. They do not receive your learning progress. Read-aloud and speaking practice use your browser's built-in speech features; depending on the browser, the text to be read or the audio you speak may be sent to the browser vendor's servers for processing."),
    h("p", h("strong", "When you sign in, we store:")),
    h(
      "ul.privacy-list",
      h("li", "Account details: your email address; your Google name and profile picture (if you sign in with Google)."),
      h("li", "Learning progress: review cards, experience points (XP), streak, daily study calendar, finished lessons, badges, settings, starred ⭐ words, and dictionary search history (the 8 most recent entries)."),
      h("li", "A random code per device, used to add up points correctly when you study on several devices. It does not identify you or your device anywhere else."),
    ),
    h("p", h("strong", "Why:"), " only to sign you in and sync your progress across your devices. No advertising, no selling, no sharing with third parties, no behavioural tracking. The app does not store your recordings on its servers: the playback recording stays on your device."),
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
