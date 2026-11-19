from pathlib import Path
import sys
sys.path.insert(0,r'C:\Users\admin\.zcode\workspace\default\report-work\python-libs')
from PIL import Image,ImageDraw,ImageFont
src=Path(r'C:\Users\admin\.zcode\workspace\default\report-work\rendered\delivery\pages')
out=src.parent/'contacts';out.mkdir(exist_ok=True)
files=sorted(src.glob('page-*.png'))
font=ImageFont.truetype(r'C:\Windows\Fonts\arial.ttf',18)
for batch in range(0,len(files),12):
    chosen=files[batch:batch+12]
    sheet=Image.new('RGB',(1400,1760),'#d0d0d0')
    draw=ImageDraw.Draw(sheet)
    for idx,f in enumerate(chosen):
        im=Image.open(f).convert('RGB'); im.thumbnail((330,535))
        col=idx%4;row=idx//4;x=15+col*345;y=35+row*570
        sheet.paste(im,(x+(330-im.width)//2,y))
        draw.rectangle((x,y,x+330,y+535),outline='black',width=2)
        draw.text((x+5,y-27),f.stem.replace('page-','Page '),fill='black',font=font)
    sheet.save(out/f'contact-{batch//12+1:02d}.jpg',quality=90)
print(len(files),'pages',len(list(out.glob('contact-*.jpg'))),'contacts')
