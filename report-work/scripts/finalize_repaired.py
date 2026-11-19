from pathlib import Path
import sys,zipfile,copy,json,re,subprocess
sys.path.insert(0,r'C:\Users\admin\.zcode\workspace\default\report-work\python-libs')
from lxml import etree
sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path(r'C:\Users\admin\.zcode\workspace\default\report-work')
FILE=ROOT/'final-report.docx';W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';N={'w':W}
with zipfile.ZipFile(FILE) as z:parts={i.filename:z.read(i.filename) for i in z.infolist()}
doc=etree.fromstring(parts['word/document.xml']);body=doc.find('w:body',N)
paras=body.findall('w:p',N)
for i,p in enumerate(paras):
    if p.xpath('.//w:br[@w:type="page"]',namespaces=N) and not p.xpath('.//w:t[text()]',namespaces=N):
        following=p.getnext()
        if following is not None and etree.QName(following).localname=='p':
            pp=following.find('w:pPr',N)
            if pp is None:pp=etree.Element('{%s}pPr'%W);following.insert(0,pp)
            el=etree.SubElement(pp,'{%s}pageBreakBefore'%W);el.set('{%s}val'%W,'true');body.remove(p)
for s in doc.xpath('.//w:sectPr',namespaces=N)[1:]:
    mar=s.find('w:pgMar',N)
    mar.set('{%s}top'%W,'1134');mar.set('{%s}right'%W,'850');mar.set('{%s}bottom'%W,'1417');mar.set('{%s}left'%W,'1701');mar.set('{%s}footer'%W,'430')
    old=s.find('w:pgBorders',N)
    if old is not None:s.remove(old)
    b=etree.Element('{%s}pgBorders'%W);b.set('{%s}offsetFrom'%W,'page');b.set('{%s}display'%W,'allPages');b.set('{%s}zOrder'%W,'back')
    for name,space in [('top',14),('left',57),('bottom',14),('right',14)]:
        el=etree.SubElement(b,'{%s}%s'%(W,name));el.set('{%s}val'%W,'single');el.set('{%s}sz'%W,'8');el.set('{%s}space'%W,str(space));el.set('{%s}color'%W,'000000')
    s.append(b)
for part,data in list(parts.items()):
    if part.startswith('word/footer') and part.endswith('.xml'):
        r=etree.fromstring(data)
        for cell in r.xpath('.//w:tc',namespaces=N):
            tcPr=cell.find('w:tcPr',N)
            if tcPr is None:tcPr=etree.Element('{%s}tcPr'%W);cell.insert(0,tcPr)
            mar=tcPr.find('w:tcMar',N)
            if mar is None:mar=etree.SubElement(tcPr,'{%s}tcMar'%W)
            for side in ['top','left','bottom','right']:
                x=etree.SubElement(mar,'{%s}%s'%(W,side));x.set('{%s}w'%W,'70');x.set('{%s}type'%W,'dxa')
        parts[part]=etree.tostring(r,encoding='UTF-8',xml_declaration=True,standalone=True)
parts['word/document.xml']=etree.tostring(doc,encoding='UTF-8',xml_declaration=True,standalone=True)
with zipfile.ZipFile(FILE,'w',zipfile.ZIP_DEFLATED) as z:
    for name,data in parts.items():z.writestr(name,data)
print('Finalized XML',FILE.stat().st_size)
