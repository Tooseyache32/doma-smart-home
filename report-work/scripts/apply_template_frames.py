from pathlib import Path
import sys, shutil, zipfile, re
sys.path.insert(0,r'C:\Users\admin\.zcode\workspace\default\report-work\python-libs')
from lxml import etree

work=Path(r'C:\Users\admin\.zcode\workspace\default\report-work\patch')
if work.exists(): shutil.rmtree(work)
work.mkdir(parents=True)
current=Path(r'C:\Users\admin\.zcode\workspace\default\report-work\final-report.docx')
template=Path(r'C:\Users\admin\.zcode\workspace\default\report-work\sources\title\source.docx')
with zipfile.ZipFile(current) as z:z.extractall(work)
tmp=work/'_template';tmp.mkdir()
with zipfile.ZipFile(template) as z:z.extractall(tmp)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';PR='http://schemas.openxmlformats.org/package/2006/relationships';CT='http://schemas.openxmlformats.org/package/2006/content-types'
ns={'w':W,'r':R,'pr':PR,'ct':CT}
# Copy exact template expanded first-sheet header and compact continuation footer
# header3 is the учебная практика expanded stamp; footer3 is compact continuation frame
for src,name in [(tmp/'word/header3.xml','header2.xml'),(tmp/'word/footer3.xml','footer2.xml')]: shutil.copy2(src,work/'word'/name)
# Copy relationships of story parts because VML drawings are self-contained but may have rels
for srcname,dstname in [('header3.xml.rels','header2.xml.rels'),('footer3.xml.rels','footer2.xml.rels')]:
 src=tmp/'word/_rels'/srcname
 if src.exists(): shutil.copy2(src,work/'word/_rels'/dstname)
# Update rels with header2/footer2 unique IDs
relsPath=work/'word/_rels/document.xml.rels'; rels=etree.parse(str(relsPath)); root=rels.getroot(); ids={x.get('Id') for x in root};
def addrel(rid,typ,target):
 el=etree.Element('{%s}Relationship'%PR);el.set('Id',rid);el.set('Type',typ);el.set('Target',target);root.append(el)
addrel('rIdFrameHeader','http://schemas.openxmlformats.org/officeDocument/2006/relationships/header','header2.xml')
addrel('rIdFrameFooter','http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer','footer2.xml')
rels.write(str(relsPath),encoding='UTF-8',xml_declaration=True,standalone=True)
# Add content type overrides
ctPath=work/'[Content_Types].xml';cts=etree.parse(str(ctPath));ctr=cts.getroot()
for part,typ in [('/word/header2.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'),('/word/footer2.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml')]:
 if not ctr.xpath(f'./ct:Override[@PartName="{part}"]',namespaces=ns):
  e=etree.Element('{%s}Override'%CT);e.set('PartName',part);e.set('ContentType',typ);ctr.append(e)
cts.write(str(ctPath),encoding='UTF-8',xml_declaration=True,standalone=True)
# Second section: add first header expanded, default compact footer, keep generated default footer for first page only
xmlPath=work/'word/document.xml';doc=etree.parse(str(xmlPath));sects=doc.xpath('//w:sectPr',namespaces=ns)
if len(sects)<2: raise RuntimeError(f'Expected 2 sections, got {len(sects)}')
s=sects[-1]
# remove existing refs, preserve generated simple footer as first footer
existing=s.xpath('./w:footerReference',namespaces=ns)
for e in existing:
 e.set('{%s}type'%W,'first')
# insert refs before pgSz
pos=0
for i,ch in enumerate(s):
 if etree.QName(ch).localname in ('pgSz','pgMar'):pos=i;break
h=etree.Element('{%s}headerReference'%W);h.set('{%s}type'%W,'first');h.set('{%s}id'%R,'rIdFrameHeader');s.insert(pos,h);pos+=1
f=etree.Element('{%s}footerReference'%W);f.set('{%s}type'%W,'default');f.set('{%s}id'%R,'rIdFrameFooter');s.insert(pos,f)
if s.find('{%s}titlePg'%W) is None:s.append(etree.Element('{%s}titlePg'%W))
# update total leaves 63 and placeholders in copied XML
for fp in [work/'word/header2.xml',work/'word/footer2.xml']:
 txt=fp.read_text(encoding='utf-8')
 txt=txt.replace('Иванова В.И.','________________').replace('гр. 3ВБ2','гр. ______').replace('y246','y263').replace('46','63')
 fp.write_text(txt,encoding='utf-8')
doc.write(str(xmlPath),encoding='UTF-8',xml_declaration=True,standalone=True)
shutil.rmtree(tmp)
out=Path(r'C:\Users\admin\Desktop\очтект\Отчёт_DOMA_умный_дом.docx')
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
 for f in work.rglob('*'):
  if f.is_file():z.write(f,f.relative_to(work).as_posix())
print(out, out.stat().st_size, 'sections',len(sects))
