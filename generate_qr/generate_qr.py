"""Genereer de QR-codes voor de Santa Walk-polsbandjes.

Gebruik:
    pip install qrcode pillow
    python generate_qr.py --year 2026 --start 1 --end 1500

Resultaat in images/santa_walk_<jaar>/:
    santa_walk_<jaar>_<nr>.png   QR + nummer eronder (voor drukker / labelprinter)
    codes_<jaar>.csv             lijst van alle codes (nr;inhoud)

De QR-inhoud is "santa_walk_<jaar>_<nr>" en moet overeenkomen met docs/config.js
(year, idMin, idMax).
"""
import argparse
import csv
import os

import qrcode
from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = ["ariblk.ttf", "arialbd.ttf", "Arial Bold.ttf",
                   "DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]


def load_font(size):
    for name in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def make_label(content, number, box_size, font):
    # Foutcorrectie Q (25%): bandjes zijn gebogen, gekreukt en soms nat → robuuster scannen.
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_Q, box_size=box_size, border=4)
    qr.add_data(content)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="black", back_color="white").convert("RGB")

    w, h = qr_img.size
    text = str(number)
    bbox = ImageDraw.Draw(qr_img).textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    text_h = th + box_size * 4

    out = Image.new("RGB", (w, h + text_h), "white")
    out.paste(qr_img, (0, 0))
    d = ImageDraw.Draw(out)
    d.text(((w - tw) / 2 - bbox[0], h + (text_h - th) / 2 - bbox[1] - box_size), text, fill="black", font=font)
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--year", type=int, required=True)
    p.add_argument("--start", type=int, default=1)
    p.add_argument("--end", type=int, default=1500)
    p.add_argument("--box-size", type=int, default=10, help="pixels per QR-module (10 = ~330 px breed)")
    p.add_argument("--font-size", type=int, default=55)
    p.add_argument("--out", default=None)
    a = p.parse_args()

    out_dir = a.out or os.path.join(os.path.dirname(__file__), "images", f"santa_walk_{a.year}")
    os.makedirs(out_dir, exist_ok=True)
    font = load_font(a.font_size)

    with open(os.path.join(out_dir, f"codes_{a.year}.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["nr", "inhoud"])
        for nr in range(a.start, a.end + 1):
            content = f"santa_walk_{a.year}_{nr}"
            make_label(content, nr, a.box_size, font).save(os.path.join(out_dir, f"{content}.png"))
            w.writerow([nr, content])
            if nr % 100 == 0:
                print(f"{nr}/{a.end}")
    print(f"Klaar: {a.end - a.start + 1} codes in {out_dir}")


if __name__ == "__main__":
    main()
