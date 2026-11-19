from pathlib import Path
import sys,zipfile,shutil
sys.path.insert(0,r'C:\Users\admin\.zcode\workspace\default\report-work\python-libs')
from lxml import etree
src=Path(r'C:\Users\admin\Desktop\очтект\Отчёт_DOMA_умный_дом.docx')
w=Path(r'C:\Users\admin\.zcode\workspace\default\report-work\normalize')
if w.exists():shutil.rmtree(w)
w.mkdir()
with zipfile.ZipFile(src) as z:z.extractall(w)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';ns={'w':W}
styles=w/'word/styles.xml';tree=etree.parse(str(styles));root=tree.getroot()
for sid,lvl in [('Heading1','0'),('Heading2','1'),('Heading3','2')]:
 s=root.xpath(f'//w:style[@w:styleId="{sid}"]',namespaces=ns)
 if not s:continue
 pPr=s[0].find('{%s}pPr'%W)
 if pPr is None:pPr=etree.SubElement(s[0],'{%s}pPr'%W)
 spacing=pPr.find('{%s}spacing'%W)
 if spacing is None:spacing=etree.SubElement(pPr,'{%s}spacing'%W)
 spacing.set('{%s}line'%W,'360');spacing.set('{%s}lineRule'%W,'auto')
tree.write(str(styles),encoding='UTF-8',xml_declaration=True,standalone=True)
# normalize body paragraphs with explicit 1.5 spacing, except tables/captions which intentionally use compact spacing
pdoc=w/'word/document.xml';doc=etree.parse(str(pdoc))
for para in doc.xpath('//w:body/w:p',namespaces=ns):
 style=para.xpath('./w:pPr/w:pStyle/@w:val',namespaces=ns)
 if style and (style[0].startswith('TOC') or style[0] in ('Heading1','Heading2','Heading3')):continue
 pPr=para.find('{%s}pPr'%W)
 if pPr is None:pPr=etree.Element('{%s}pPr'%W);para.insert(0,pPr)
 spacing=pPr.find('{%s}spacing'%W)
 if spacing is None:spacing=etree.SubElement(pPr,'{%s}spacing'%W)
 spacing.set('{%s}line'%W,'360');spacing.set('{%s}lineRule'%W,'auto')
doc.write(str(pdoc),encoding='UTF-8',xml_declaration=True,standalone=True)
with zipfile.ZipFile(src,'w',zipfile.ZIP_DEFLATED) as z:
 for f in w.rglob('*'):
  if f.is_file():z.write(f,f.relative_to(w).as_posix())
print('normalized',src.stat().st_size)
