import sys,zipfile,json
sys.path.insert(0,r'C:\Users\admin\.zcode\workspace\default\report-work\python-libs')
from lxml import etree
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
N={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
p=r'C:\Users\admin\.zcode\workspace\default\report-work\revision\sources\sample\source.docx'
with zipfile.ZipFile(p) as z:d=etree.fromstring(z.read('word/document.xml'))
for s in d.xpath('.//w:sectPr',namespaces=N):
 print('section',[(etree.QName(c).localname,{etree.QName(k).localname:v for k,v in c.attrib.items()}) for c in s if etree.QName(c).localname in ('pgSz','pgMar','pgBorders','headerReference','footerReference','titlePg','type')])
PY