from pathlib import Path
import sys,zipfile,re,json,hashlib
sys.path.insert(0,r'C:\Users\admin\.zcode\workspace\default\report-work\python-libs')
from lxml import etree
import pymupdf
sys.stdout.reconfigure(encoding='utf-8')
BASE=Path(r'C:\Users\admin\.zcode\workspace\default\report-work');DOC=BASE/'final-report.docx';PDF=BASE/'rendered/repaired/final-report.pdf';N={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
with zipfile.ZipFile(DOC) as z:root=etree.fromstring(z.read('word/document.xml'));settings=etree.fromstring(z.read('word/settings.xml'))
pdf=pymupdf.open(PDF);mapping=json.loads((BASE/'toc-map.json').read_text(encoding='utf-8'))
issues=[]
if len(pdf)<30:issues.append('fewer than30 pages')
if mapping['pages']!=len(pdf):issues.append('count mismatch')
text='\n'.join(root.xpath('./w:body/w:p//w:t/text()',namespaces=N))
if re.search(r'\[(?:РИСУНОК|СКРИНШОТ|ТАБЛИЦА|МЕСТО)',text):issues.append('marker residual')
for i,p in enumerate(pdf):
 if not p.get_text().strip():issues.append(f'empty page{i+1}')
# Verify every content number lands at a heading, using line starts rather than substrings in body prose
for title,style,anchor,num in mapping['entries']:
 if not num:issues.append('unresolved '+title);continue
 target=pdf[num-1].get_text().replace('ё','е').casefold()
 needle=title.replace('ё','е').casefold()
 if re.sub(r'\s+','',needle) not in re.sub(r'\s+','',target):issues.append('toc missing '+title)
# figure and caption continuity
caps=[x for x in root.xpath('./w:body/w:p',namespaces=N) if ''.join(x.xpath('.//w:t/text()',namespaces=N)).startswith('Рисунок ')]
nums=[int(re.match(r'Рисунок (\d+)', ''.join(p.xpath('.//w:t/text()',namespaces=N)))[1]) for p in caps]
if nums!=list(range(1,len(nums)+1)):issues.append('figure numbering')
cover_count=None
for tr in root.xpath('./w:body/w:tbl/w:tr',namespaces=N):
 cs=tr.findall('w:tc',N)
 if cs and 'Количество листов' in ''.join(cs[0].xpath('.//w:t/text()',namespaces=N)):cover_count=''.join(cs[1].xpath('.//w:t/text()',namespaces=N))
if cover_count!=str(len(pdf)):issues.append('cover count')
report={'pages':len(pdf),'figures':len(nums),'tables':len(root.xpath('./w:body/w:tbl',namespaces=N))-1,'toc_entries':len(mapping['entries']),'cover_count':cover_count,'issues':issues,'visual_acceptance':'not completed: visual-judge account unavailable and model does not accept images'}
(BASE/'delivery-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2))
if issues:raise SystemExit(1)
