from pathlib import Path
import sys,zipfile,shutil,re
sys.path.insert(0,r'C:\Users\admin\.zcode\workspace\default\report-work\python-libs')
from lxml import etree
src=Path(r'C:\Users\admin\Desktop\очтект\Отчёт_DOMA_умный_дом.docx')
w=Path(r'C:\Users\admin\.zcode\workspace\default\report-work\frame-clean')
if w.exists():shutil.rmtree(w)
w.mkdir();zipfile.ZipFile(src).extractall(w)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';ns={'w':W}
docp=w/'word/document.xml';doc=etree.parse(str(docp));sects=doc.xpath('//w:sectPr',namespaces=ns)
if len(sects)<2:raise RuntimeError('missing section')
s=sects[-1]
# remove all existing frame story refs; generated footer replaced by simple positioned frame+page field
for e in list(s.xpath('./w:headerReference|./w:footerReference',namespaces=ns)):s.remove(e)
for e in list(s.xpath('./w:titlePg',namespaces=ns)):s.remove(e)
# Add clean ESKD-inspired perimeter border on all body pages, positioned from page edges, with safe offsets
pg=etree.Element('{%s}pgBorders'%W);pg.set('{%s}offsetFrom'%W,'page');pg.set('{%s}display'%W,'allPages');pg.set('{%s}zOrder'%W,'back')
for side,space in [('top','28'),('left','36'),('bottom','28'),('right','18')]:
 e=etree.SubElement(pg,'{%s}%s'%(W,side));e.set('{%s}val'%W,'single');e.set('{%s}sz'%W,'12');e.set('{%s}space'%W,space);e.set('{%s}color'%W,'000000')
# insert before columns/docGrid
insert=0
for i,ch in enumerate(s):
 if etree.QName(ch).localname in ('cols','docGrid'):insert=i;break
 else:insert=i+1
s.insert(insert,pg)
doc.write(str(docp),encoding='UTF-8',xml_declaration=True,standalone=True)
# Generate clean footer with code and PAGE using OOXML directly
footer='''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:tbl><w:tblPr><w:tblW w:w="100" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="8" w:color="000000"/><w:left w:val="single" w:sz="8" w:color="000000"/><w:bottom w:val="single" w:sz="8" w:color="000000"/><w:right w:val="single" w:sz="8" w:color="000000"/><w:insideV w:val="single" w:sz="8" w:color="000000"/></w:tblBorders></w:tblPr><w:tr><w:tc><w:tcPr><w:tcW w:w="70" w:type="pct"/></w:tcPr><w:p><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b/><w:sz w:val="18"/></w:rPr><w:t>ОКЭИ 09.02.07. 3026. 11 ПЗ</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="15" w:type="pct"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="18"/></w:rPr><w:t>Лист</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="15" w:type="pct"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE \\* arabic \\* MERGEFORMAT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>2</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:tc></w:tr></w:tbl></w:ftr>'''
(w/'word/footer2.xml').write_text(footer,encoding='utf-8')
rels=w/'word/_rels/document.xml.rels';rt=etree.parse(str(rels));rr=rt.getroot();PR='http://schemas.openxmlformats.org/package/2006/relationships'
for e in list(rr):
 if e.get('Id')=='rIdCleanFooter':rr.remove(e)
e=etree.Element('{%s}Relationship'%PR);e.set('Id','rIdCleanFooter');e.set('Type','http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer');e.set('Target','footer2.xml');rr.append(e);rt.write(str(rels),encoding='UTF-8',xml_declaration=True,standalone=True)
f=etree.Element('{%s}footerReference'%W);f.set('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id','rIdCleanFooter');f.set('{%s}type'%W,'default');s.insert(0,f)
doc.write(str(docp),encoding='UTF-8',xml_declaration=True,standalone=True)
# add content type if needed
ctp=w/'[Content_Types].xml';ct=etree.parse(str(ctp));root=ct.getroot();CT='http://schemas.openxmlformats.org/package/2006/content-types'
if not root.xpath('./ct:Override[@PartName="/word/footer2.xml"]',namespaces={'ct':CT}):
 e=etree.Element('{%s}Override'%CT);e.set('PartName','/word/footer2.xml');e.set('ContentType','application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml');root.append(e)
ct.write(str(ctp),encoding='UTF-8',xml_declaration=True,standalone=True)
with zipfile.ZipFile(src,'w',zipfile.ZIP_DEFLATED) as z:
 for fpath in w.rglob('*'):
  if fpath.is_file():z.write(fpath,fpath.relative_to(w).as_posix())
print('clean framed',src.stat().st_size)
