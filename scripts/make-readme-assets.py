"""Generate the GitHub README artwork (banner, screenshot cards, social preview).

Run with the bundled Python:
  <python> scripts/make-readme-assets.py
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, "docs", "images")
os.makedirs(IMG, exist_ok=True)

FONT_BD = "C:/Windows/Fonts/msyhbd.ttc"
FONT_RG = "C:/Windows/Fonts/msyh.ttc"
FONT_EN = "C:/Windows/Fonts/segoeuib.ttf"

BLUE = (77, 107, 254)
INK = (10, 16, 36)


def font(path, size):
    return ImageFont.truetype(path, size)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size, top, bottom):
    w, h = size
    img = Image.new("RGB", size, top)
    d = ImageDraw.Draw(img)
    for y in range(h):
        d.line([(0, y), (w, y)], fill=lerp(top, bottom, y / max(1, h - 1)))
    return img


def rounded_mask(size, radius):
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return mask


def card(src, out_name, max_h=980, pad=46, radius=24, scale_bg=((238, 242, 255), (250, 252, 255))):
    img = Image.open(src).convert("RGB")
    scale = min(1.0, (max_h - 2 * pad) / img.height)
    w, h = int(img.width * scale), int(img.height * scale)
    img = img.resize((w, h), Image.LANCZOS)

    canvas = gradient((w + 2 * pad, h + 2 * pad), scale_bg[0], scale_bg[1])
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle([pad, pad + 14, pad + w, pad + h + 14], radius=radius + 2, fill=(16, 24, 40, 60))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), shadow)

    card_img = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    card_img.paste(img, (0, 0))
    card_img.putalpha(rounded_mask((w, h), radius))
    canvas.alpha_composite(card_img, (pad, pad))

    border = ImageDraw.Draw(canvas)
    border.rounded_rectangle([pad, pad, pad + w - 1, pad + h - 1], radius=radius, outline=(210, 218, 240, 255), width=1)
    canvas.convert("RGB").save(os.path.join(IMG, out_name), optimize=True)
    print("wrote", out_name, canvas.size)


def banner(out_name, size=(1280, 420), phone_h=360, title_size=62):
    w, h = size
    img = gradient(size, (7, 11, 26), (18, 32, 74)).convert("RGB")

    # soft blue glow behind the phone
    glow = Image.new("RGB", size, (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([w - 520, h // 2 - 320, w + 120, h // 2 + 320], fill=(34, 58, 140))
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    img = Image.blend(img, glow, 0.55)

    d = ImageDraw.Draw(img)
    # faint grid, composited with alpha so it does not turn into dark lines
    grid = Image.new("RGBA", size, (0, 0, 0, 0))
    gd2 = ImageDraw.Draw(grid)
    for x in range(0, w, 48):
        gd2.line([(x, 0), (x, h)], fill=(130, 158, 255, 22))
    for y in range(0, h, 48):
        gd2.line([(0, y), (w, y)], fill=(130, 158, 255, 22))
    img = Image.alpha_composite(img.convert("RGBA"), grid)
    d = ImageDraw.Draw(img)

    # fish icon
    icon = Image.open(os.path.join(ROOT, "extension", "icons", "icon128.png")).convert("RGBA").resize((58, 58), Image.LANCZOS)
    img.paste(icon, (72, 56), icon)

    d.text((146, 58), "DeepSeek Harness  ×  Microsoft Edge", font=font(FONT_RG, 22), fill=(160, 176, 220))
    d.text((70, 124), "DSH Edge Bridge", font=font(FONT_EN, title_size), fill=(255, 255, 255))
    d.text((72, 210), "让 DeepSeek Harness 驱动你真实的、带登录态的 Edge", font=font(FONT_BD, 26), fill=(206, 216, 246))

    chips = ["Edge MV3 扩展", "CDP 直通", "DSH 插件随启"]
    x = 72
    y = 270
    cf = font(FONT_BD, 18)
    for c in chips:
        tw = d.textlength(c, font=cf)
        d.rounded_rectangle([x, y, x + tw + 30, y + 38], radius=19, fill=(30, 46, 96), outline=(74, 100, 180), width=1)
        d.text((x + 15, y + 8), c, font=cf, fill=(190, 204, 240))
        x += tw + 42

    d.text((72, 338), "无需重启浏览器 · 无需远程调试端口 · 侧边栏就是 DSH 的会话镜像", font=font(FONT_RG, 18), fill=(132, 148, 190))

    # phone card with the sidebar screenshot
    shot = Image.open(os.path.join(IMG, "sidebar.png")).convert("RGB")
    pw = int(shot.width * phone_h / shot.height)
    shot = shot.resize((pw, phone_h), Image.LANCZOS)
    px, py = w - pw - 110, (h - phone_h) // 2

    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([px + 8, py + 18, px + pw + 8, py + phone_h + 18], radius=26, fill=(0, 0, 0, 140))
    shadow = shadow.filter(ImageFilter.GaussianBlur(28))
    img = Image.alpha_composite(img.convert("RGBA"), shadow)

    phone = shot.convert("RGBA")
    phone.putalpha(rounded_mask((pw, phone_h), 22))
    img.alpha_composite(phone, (px, py))
    ImageDraw.Draw(img).rounded_rectangle([px, py, px + pw - 1, py + phone_h - 1], radius=22, outline=(120, 145, 220, 200), width=2)

    img.convert("RGB").save(os.path.join(IMG, out_name), optimize=True)
    print("wrote", out_name, size)


def arch_svg():
    svg = """<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="420" viewBox="0 0 1280 420">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F7F9FF"/><stop offset="1" stop-color="#EDF1FF"/></linearGradient>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#4D6BFE"/></marker>
    <marker id="arrow2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#8A94A8"/></marker>
  </defs>
  <rect width="1280" height="420" rx="24" fill="url(#bg)"/>
  <text x="64" y="64" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="26" font-weight="700" fill="#1B2340">DSH Edge Bridge · 三层架构</text>
  <text x="64" y="94" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="15" fill="#6B7490">扩展只是「手」，桥接只是「服务」，大脑永远在 DSH</text>

  <!-- Edge extension -->
  <rect x="64" y="140" width="280" height="180" rx="18" fill="#FFFFFF" stroke="#D8DFF5"/>
  <rect x="64" y="140" width="280" height="44" rx="18" fill="#4D6BFE"/>
  <rect x="64" y="166" width="280" height="18" fill="#4D6BFE"/>
  <text x="86" y="170" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="18" font-weight="700" fill="#FFFFFF">Edge MV3 扩展</text>
  <text x="86" y="218" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="15" fill="#2A3352">chrome.debugger → CDP</text>
  <text x="86" y="248" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="15" fill="#2A3352">侧边栏 = 会话镜像</text>
  <text x="86" y="278" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="15" fill="#2A3352">带登录态的真实浏览器</text>
  <text x="86" y="306" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="13" fill="#8A94A8">手</text>

  <!-- Bridge -->
  <rect x="500" y="140" width="280" height="180" rx="18" fill="#FFFFFF" stroke="#D8DFF5"/>
  <rect x="500" y="140" width="280" height="44" rx="18" fill="#16224A"/>
  <rect x="500" y="166" width="280" height="18" fill="#16224A"/>
  <text x="522" y="170" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="18" font-weight="700" fill="#FFFFFF">桥接 bridge.mjs</text>
  <text x="522" y="218" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="15" fill="#2A3352">零依赖 HTTP + WS</text>
  <text x="522" y="248" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="15" fill="#2A3352">标签页 / 快照 / 填表 / 截图</text>
  <text x="522" y="278" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="15" fill="#2A3352">会话日志镜像 · 无模型调用</text>
  <text x="522" y="306" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="13" fill="#8A94A8">服务（仅 127.0.0.1）</text>

  <!-- DSH -->
  <rect x="936" y="140" width="280" height="180" rx="18" fill="#FFFFFF" stroke="#D8DFF5"/>
  <rect x="936" y="140" width="280" height="44" rx="18" fill="#4D6BFE"/>
  <rect x="936" y="166" width="280" height="18" fill="#4D6BFE"/>
  <text x="958" y="170" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="18" font-weight="700" fill="#FFFFFF">DeepSeek Harness</text>
  <text x="958" y="218" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="15" fill="#2A3352">dsh --profile headless --json</text>
  <text x="958" y="248" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="15" fill="#2A3352">思考 / 工具 / 回复</text>
  <text x="958" y="278" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="15" fill="#2A3352">真实会话，可与桌面版接力</text>
  <text x="958" y="306" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="13" fill="#8A94A8">大脑</text>

  <!-- arrows -->
  <line x1="344" y1="230" x2="492" y2="230" stroke="#4D6BFE" stroke-width="2.5" marker-end="url(#arrow)"/>
  <text x="356" y="214" font-family="Consolas, monospace" font-size="12" fill="#4D6BFE">WS 出站 :8766</text>
  <line x1="780" y1="230" x2="928" y2="230" stroke="#4D6BFE" stroke-width="2.5" marker-end="url(#arrow)"/>
  <text x="792" y="214" font-family="Consolas, monospace" font-size="12" fill="#4D6BFE">HTTP / JSON</text>

  <!-- plugin -->
  <rect x="936" y="352" width="280" height="44" rx="12" fill="#EEF2FF" stroke="#C9D4FF"/>
  <text x="958" y="380" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="14" fill="#3A4A7A">DSH 插件：启动时自动拉起桥接</text>
  <path d="M1076 352 C1076 330 1076 330 1076 312" stroke="#8A94A8" stroke-width="2" fill="none" stroke-dasharray="5 4" marker-end="url(#arrow2)"/>
</svg>
"""
    path = os.path.join(IMG, "architecture.svg")
    with open(path, "w", encoding="utf-8") as f:
        f.write(svg)
    print("wrote architecture.svg")


if __name__ == "__main__":
    banner("banner.png")
    banner("social-preview.png", size=(1280, 640), phone_h=520, title_size=72)
    card(os.path.join(IMG, "sidebar.png"), "screenshot-chat.png", max_h=960)
    card(os.path.join(IMG, "ui-session-menu.png"), "screenshot-session-menu.png", max_h=960)
    card(os.path.join(IMG, "ui-model-menu.png"), "screenshot-model-menu.png", max_h=960)
    card(os.path.join(IMG, "ui-tabs.png"), "screenshot-tabs.png", max_h=960)
    card(os.path.join(IMG, "quiz-fill.png"), "screenshot-quiz.png", max_h=860, pad=40)
    arch_svg()
