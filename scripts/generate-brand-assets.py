from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
source = Image.open(PUBLIC / "joblite.png").convert("RGB")
navy = (7, 31, 86)

for size, name, inset in [
    (192, "joblite-icon-192.v1.png", 0.08),
    (512, "joblite-icon-512.v1.png", 0.08),
    (180, "apple-touch-icon.png", 0.09),
]:
    canvas = Image.new("RGB", (size, size), navy)
    logo_size = round(size * (1 - inset * 2))
    resampling = getattr(Image, "Resampling", Image)
    logo = source.resize((logo_size, logo_size), resampling.LANCZOS)
    canvas.paste(logo, ((size - logo_size) // 2, (size - logo_size) // 2))
    canvas.save(PUBLIC / name, "PNG", optimize=True)

W, H = 1200, 630
image = Image.new("RGB", (W, H), (7, 31, 86))
draw = ImageDraw.Draw(image)
font_dir = Path("/usr/share/fonts/truetype/dejavu")
regular_path = font_dir / "DejaVuSans.ttf"
bold_path = font_dir / "DejaVuSans-Bold.ttf"
if not regular_path.exists():
    font_dir = Path("/usr/share/fonts/truetype/liberation2")
    regular_path = font_dir / "LiberationSans-Regular.ttf"
    bold_path = font_dir / "LiberationSans-Bold.ttf"

def font(size, bold=False):
    return ImageFont.truetype(str(bold_path if bold else regular_path), size)

draw.rounded_rectangle((48, 48, 1152, 582), radius=34, fill=(8, 124, 255))
draw.rounded_rectangle((64, 64, 1136, 566), radius=28, fill=(7, 31, 86))

mark_size = 78
resampling = getattr(Image, "Resampling", Image)
mark = source.resize((mark_size, mark_size), resampling.LANCZOS)
image.paste(mark, (104, 98))
draw.text((198, 113), "Joblite AHIS", font=font(34, True), fill=(255, 255, 255))

draw.text((104, 230), "Your next opportunity", font=font(48, True), fill=(255, 255, 255))
draw.text((104, 290), "starts here.", font=font(48, True), fill=(255, 255, 255))
draw.text((106, 380), "Discover local jobs and remote", font=font(25), fill=(218, 232, 255))
draw.text((106, 416), "opportunities.", font=font(25), fill=(218, 232, 255))
draw.text((106, 510), "joblite.online", font=font(21, True), fill=(255, 255, 255))

# A non-vacancy UI excerpt: search controls and neutral skill chips only.
draw.rounded_rectangle((688, 122, 1060, 506), radius=24, fill=(255, 255, 255))
draw.text((724, 158), "Find your next role", font=font(23, True), fill=navy)
draw.rounded_rectangle((720, 208, 1028, 267), radius=15, fill=(248, 250, 254), outline=(221, 231, 245), width=2)
draw.ellipse((741, 226, 758, 243), outline=(92, 115, 151), width=3)
draw.line((755, 241, 764, 250), fill=(92, 115, 151), width=3)
draw.text((778, 223), "Jobs, skills, companies", font=font(16), fill=(104, 119, 152))
draw.text((724, 298), "Explore opportunities", font=font(17, True), fill=(7, 31, 86))
for x, label, width in [(724, "Local", 74), (810, "Remote", 96), (918, "All countries", 110)]:
    draw.rounded_rectangle((x, 337, x + width, 377), radius=18, fill=(234, 244, 255), outline=(204, 225, 251), width=1)
    draw.text((x + 12, 347), label, font=font(14, True), fill=(8, 96, 194))
draw.rounded_rectangle((720, 405, 1028, 470), radius=14, fill=(248, 250, 254), outline=(231, 236, 245), width=2)
draw.ellipse((739, 420, 768, 449), fill=(8, 124, 255))
draw.text((781, 416), "Real opportunities", font=font(16, True), fill=navy)
draw.text((781, 440), "From employers and job sources", font=font(12), fill=(104, 119, 152))

image.save(PUBLIC / "share-card.v1.png", "PNG", optimize=True)
