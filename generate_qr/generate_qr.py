from PIL import Image, ImageDraw, ImageFont
from tqdm import tqdm

import qrcode
import pyqrcode
import os

def generateImage(txt, fn):
    fontname = "ariblk.ttf"
    fontsize = 55
    im = Image.open("images/tmp/tmp_qr.png")
    w, h = im.size
    width, height = (w, int(h/2)) #(330, 100)

    fnt = ImageFont.truetype(fontname, fontsize)

    img = Image.new('RGBA', (width, height), (1, 1, 1, 0))
    d = ImageDraw.Draw(img)
    d.text((50, 25), txt, fill=(0, 0, 0), font=fnt)

    text_width, text_height = d.textsize(txt)
    x = int((width - 6.5 * text_width) / 2)
    y = int((height - 6.5 * text_height) / 2)

    img = Image.new('RGBA', (width, height), (1, 1, 1, 0))
    d = ImageDraw.Draw(img)
    d.text((x, y), txt, fill=(0, 0, 0), font=fnt)
    img.save(fn)

def generateQR(txt, fn):
    #img = qrcode.make(txt)
    img = pyqrcode.create(txt)
    img.png(fn, scale=5)
    #img.save(fn)

def append_images(img_list, fn):
    images = map(Image.open, img_list)

    imgs = [i for i in images]
    widths = [i.size[0] for i in imgs]
    heights = [i.size[1] for i in imgs]

    max_width = max(widths)
    total_height = sum(heights)
    #print("Total width, total height:", max_width, total_height)

    new_im = Image.new('RGBA', (max_width, total_height), (1, 1, 1, 0))
    y_offset = 0
    for im in imgs:
        new_im.paste(im, (0, y_offset))
        y_offset += im.size[1]

    new_im.save(fn)


if __name__ == '__main__':
    generateImage("123", "images/tmp/tmp_num.png")
    generateQR("santa_walk_2018_123", "images/tmp/tmp_qr.png")
    append_images(["images/tmp/tmp_qr.png", "images/tmp/tmp_num.png"], "images/santa_walk_combo/santa_walk_123.png")

    for i in tqdm(range(1, 1501)):
        generateQR("santa_walk_2019_"+str(i), "images/tmp/tmp_qr.png")
        generateImage(str(i), "images/tmp/tmp_num.png")
        append_images(["images/tmp/tmp_qr.png", "images/tmp/tmp_num.png"], os.path.join("images/santa_walk_combo", "santa_walk_{}.png".format(str(i))))
