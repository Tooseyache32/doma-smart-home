import sys,zipfile,re,copy,json
from pathlib import Path
sys.path.insert(0,r'C:\Users\admin\.zcode\workspace\default\report-work\python-libs')
from lxml import etree
import pymupdf
sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path(r'C:\Users\admin\.zcode\workspace\default\report-work');FILE=ROOT/'final-report.docx';PDF=ROOT/'rendered/repaired/final-report.pdf'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';N={'w':W};R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
with zipfile.ZipFile(FILE) as z:parts={i.filename:z.read(i.filename) for i in z.infolist()}
d=etree.fromstring(parts['word/document.xml']);b=d.find('w:body',N)
pdf=pymupdf.open(PDF)
def norm(s):return re.sub(r'\s+','',s).casefold().replace('ё','е')
pageTexts=[norm(p.get_text()) for p in pdf]
heads=[]
for p in b.findall('w:p',N):
 st=p.xpath('./w:pPr/w:pStyle/@w:val',namespaces=N)
 if not st or st[0] not in ('Heading1','Heading2'):continue
 text=''.join(p.xpath('.//w:t/text()',namespaces=N)).strip()
 if text in ('СОДЕРЖАНИЕ',):continue
 bookmark=p.find('w:bookmarkStart',N)
 if bookmark is None:
  bookmark=etree.Element('{%s}bookmarkStart'%W);bookmark.set('{%s}id'%W,str(9000+len(heads)));bookmark.set('{%s}name'%W,'_Report'+str(len(heads)));p.insert(1,bookmark)
  end=etree.SubElement(p,'{%s}bookmarkEnd'%W);end.set('{%s}id'%W,bookmark.get('{%s}id'%W))
 anchor=bookmark.get('{%s}name'%W)
 matches=[i+1 for i,txt in enumerate(pageTexts) if norm(text) in txt]
 physical=2 if text=='РЕФЕРАТ' else (matches[-1] if matches else 0)
 if text=='Вывод':continue
 heads.append((text,st[0],anchor,physical))
sdts=[s for s in d.xpath('.//w:sdt',namespaces=N) if 'TOC' in ''.join(s.xpath('.//w:instrText/text()',namespaces=N))]
if not sdts:raise RuntimeError('no TOC')
content=sdts[0].find('w:sdtContent',N)
for ch in list(content):content.remove(ch)
def run(p,text=None,field=None,char=None):
 r=etree.SubElement(p,'{%s}r'%W)
 if text is not None:
  t=etree.SubElement(r,'{%s}t'%W);t.text=text
 if field:
  x=etree.SubElement(r,'{%s}instrText'%W);x.set('{http://www.w3.org/XML/1998/namespace}space','preserve');x.text=field
 if char:
  x=etree.SubElement(r,'{%s}fldChar'%W);x.set('{%s}fldCharType'%W,char)
 return r
for i,(text,style,anchor,physical) in enumerate(heads):
 p=etree.SubElement(content,'{%s}p'%W);pp=etree.SubElement(p,'{%s}pPr'%W)
 st=etree.SubElement(pp,'{%s}pStyle'%W);st.set('{%s}val'%W,'TOC1' if style=='Heading1' else 'TOC2')
 sp=etree.SubElement(pp,'{%s}spacing'%W);sp.set('{%s}line'%W,'260');sp.set('{%s}after'%W,'40');sp.set('{%s}before'%W,'0')
 tabs=etree.SubElement(pp,'{%s}tabs'%W);tab=etree.SubElement(tabs,'{%s}tab'%W);tab.set('{%s}val'%W,'right');tab.set('{%s}pos'%W,'9355');tab.set('{%s}leader'%W,'dot')
 if style=='Heading2':ind=etree.SubElement(pp,'{%s}ind'%W);ind.set('{%s}left'%W,'240')
 if i==0:run(p,char='begin');run(p,field=' TOC \\h \\o "1-2" ');run(p,char='separate')
 link=etree.SubElement(p,'{%s}hyperlink'%W);link.set('{%s}anchor'%W,anchor);link.set('{%s}history'%W,'1');run(link,text)
 r=etree.SubElement(link,'{%s}r'%W);etree.SubElement(r,'{%s}tab'%W)
 run(link,char='begin');run(link,field=' PAGEREF '+anchor+' \\h ');run(link,char='separate');run(link,str(physical));run(link,char='end')
 if i==len(heads)-1:run(p,char='end')
# update cover count exactly
for tbl in b.findall('w:tbl',N):
 for tr in tbl.findall('w:tr',N):
  cs=tr.findall('w:tc',N)
  if cs and 'Количество листов' in ''.join(cs[0].xpath('.//w:t/text()',namespaces=N)):
   ts=cs[1].xpath('.//w:t',namespaces=N)
   if ts:ts[0].text=str(len(pdf))
parts['word/document.xml']=etree.tostring(d,encoding='UTF-8',xml_declaration=True,standalone=True)
with zipfile.ZipFile(FILE,'w',zipfile.ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(name,data)
(ROOT/'toc-map.json').write_text(json.dumps({'pages':len(pdf),'entries':heads},ensure_ascii=False,indent=2),encoding='utf-8')
print('Updated TOC',len(heads),'entries; physical count',len(pdf),'missing pages',[(x[0]) for x in heads if not x[3]])
