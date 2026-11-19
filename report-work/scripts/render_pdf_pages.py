from pathlib import Path
import sys
sys.path.insert(0,r'C:\Users\admin\.zcode\workspace\default\report-work\python-libs')
import fitz
pdf=Path(r'C:\Users\admin\.zcode\workspace\default\report-work\rendered\template-title\source.pdf')
out=pdf.parent/'pages';out.mkdir(exist_ok=True)
doc=fitz.open(pdf)
print('pages',len(doc))
for i,p in enumerate(doc):
    pix=p.get_pixmap(matrix=fitz.Matrix(1.5,1.5),alpha=False)
    pix.save(out/f'page-{i+1:02d}.png')
