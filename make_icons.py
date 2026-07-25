"""冷蔵庫コンパス PWA アイコン生成。teal 背景＋白い冷蔵庫＋コンパス針アクセント。"""
from PIL import Image, ImageDraw
import math, os

OUT = os.path.dirname(os.path.abspath(__file__))
ICON_DIR = os.path.join(OUT, "icons")
os.makedirs(ICON_DIR, exist_ok=True)

TEAL = (30, 158, 138)
TEAL_DK = (21, 119, 104)
WHITE = (255, 255, 255)


def rounded(draw, box, r, fill):
    draw.rounded_rectangle(box, radius=r, fill=fill)


def render(size, maskable=False):
    # 高解像度で描いて縮小（アンチエイリアス）
    S = size * 4
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 背景（縦グラデ風：2色を上下で）
    for y in range(S):
        t = y / S
        c = tuple(int(TEAL[i] + (TEAL_DK[i] - TEAL[i]) * t) for i in range(3))
        d.line([(0, y), (S, y)], fill=c + (255,))
    # 角丸（maskable は full-bleed、通常は少し角丸）
    if not maskable:
        mask = Image.new("L", (S, S), 0)
        md = ImageDraw.Draw(mask)
        md.rounded_rectangle([0, 0, S, S], radius=int(S * 0.22), fill=255)
        img.putalpha(mask)

    # 冷蔵庫本体（白い角丸長方形）。maskable はセーフゾーン内に収める
    inset = 0.30 if maskable else 0.26
    fw = S * (1 - inset * 2) * 0.78
    fh = S * (1 - inset * 2)
    fx = (S - fw) / 2
    fy = (S - fh) / 2
    rounded(d, [fx, fy, fx + fw, fy + fh], int(S * 0.06), WHITE)

    # 冷凍室/冷蔵室の仕切り線
    split_y = fy + fh * 0.34
    d.line([(fx + fw * 0.10, split_y), (fx + fw * 0.90, split_y)],
           fill=TEAL, width=int(S * 0.014))

    # 取っ手（縦棒2本、左寄り）
    hw = S * 0.016
    hx = fx + fw * 0.20
    d.rounded_rectangle([hx, fy + fh * 0.10, hx + hw, split_y - fh * 0.06],
                        radius=hw, fill=TEAL)
    d.rounded_rectangle([hx, split_y + fh * 0.06, hx + hw, fy + fh * 0.90],
                        radius=hw, fill=TEAL)

    # コンパス針アクセント（下段中央に小さな菱形の針＋中心円）
    cx = fx + fw * 0.60
    cy = split_y + (fy + fh - split_y) * 0.50
    rad = fw * 0.20
    # 針（上=teal濃, 下=薄）
    d.polygon([(cx, cy - rad), (cx + rad * 0.42, cy), (cx, cy + rad),
               (cx - rad * 0.42, cy)], fill=TEAL_DK)
    d.polygon([(cx, cy - rad), (cx + rad * 0.42, cy),
               (cx - rad * 0.42, cy)], fill=(46, 185, 164))
    d.ellipse([cx - rad * 0.16, cy - rad * 0.16, cx + rad * 0.16, cy + rad * 0.16],
              fill=WHITE, outline=TEAL, width=int(S * 0.006))

    return img.resize((size, size), Image.LANCZOS)


targets = [
    ("icons/icon-192.png", 192, False),
    ("icons/icon-512.png", 512, False),
    ("icons/icon-maskable-512.png", 512, True),
    ("icons/apple-touch-icon.png", 180, True),   # iOS はセーフゾーン広め＆full-bleed が綺麗
    ("favicon-64.png", 64, False),
]
for path, sz, mask in targets:
    render(sz, mask).save(os.path.join(OUT, path))
    print("wrote", path, sz)
print("done")
