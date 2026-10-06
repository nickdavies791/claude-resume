"""Frames the raw recording on a dark canvas with step captions underneath."""
import subprocess, sys, tempfile, os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

raw, out = sys.argv[1], sys.argv[2]
W, H = 1440, 820
VW, VH = 1280, 640
X, Y = (W - VW) // 2, 48

STEPS = [
    (0.0, 2.0, 'Run cr from any directory'),
    (2.0, 4.6, 'See every session from every project, newest first'),
    (4.6, 11.2, 'Search titles, prompts and whole conversations'),
    (11.2, 99, 'Press enter. Claude resumes in the right directory'),
]

font = ImageFont.truetype('/System/Library/Fonts/HelveticaNeue.ttc', 26, index=0)
bold = ImageFont.truetype('/System/Library/Fonts/HelveticaNeue.ttc', 26, index=1)
tmp = tempfile.mkdtemp()
inputs = []
for i, (_, _, text) in enumerate(STEPS):
    img = Image.new('RGB', (W, H), '#1c1c1c')
    shadow = Image.new('L', (W, H), 0)
    ImageDraw.Draw(shadow).rounded_rectangle((X, Y + 10, X + VW, Y + VH + 10), 12, fill=150)
    img.paste('#000000', (0, 0), shadow.filter(ImageFilter.GaussianBlur(18)))
    d = ImageDraw.Draw(img)
    num = f'{i + 1}.  '
    tw = d.textlength(num, font=bold) + d.textlength(text, font=font)
    tx, ty = (W - tw) / 2, Y + VH + 48
    d.text((tx, ty), num, font=bold, fill='#d97757')
    d.text((tx + d.textlength(num, font=bold), ty), text, font=font, fill='#e6e6e6')
    p = os.path.join(tmp, f'{i}.png')
    img.save(p)
    inputs += ['-loop', '1', '-i', p]

chain = '[1:v]'
filters = []
for i, (a, b, _) in enumerate(STEPS[1:], start=2):
    filters.append(f"{chain}[{i}:v]overlay=enable='between(t,{a},{b})'[bg{i}]")
    chain = f'[bg{i}]'
filters.append(f'{chain}[0:v]overlay={X}:{Y}:shortest=1,format=yuv420p[v]')
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', raw, *inputs, '-filter_complex', ';'.join(filters),
                '-map', '[v]', '-c:v', 'libx264', '-crf', '20', '-movflags', '+faststart', out], check=True)
