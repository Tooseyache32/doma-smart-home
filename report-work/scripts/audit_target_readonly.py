import sys, re, zipfile, hashlib, collections
from pathlib import Path
sys.path.insert(0, r'C:\Users\admin\.zcode\workspace\default\report-work\python-libs')
from lxml import etree
sys.stdout.reconfigure(encoding='utf-8')
p=Path(sys.argv[1]); base=Path(sys.argv[2])
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships','wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'}
w='{'+ns['w']+'}'
def text(e):return ''.join(e.xpath('.//w:t/text()',namespaces=ns))
with zipfile.ZipFile(p) as z:
 d=etree.fromstring(z.read('word/document.xml')); styles=etree.fromstring(z.read('word/styles.xml'))
 ps=d.xpath('/w:document/w:body/w:p',namespaces=ns)
 print('FILE',p,'bytes',p.stat().st_size)
 print('APP',z.read('docProps/app.xml').decode()[:1200])
 print('FIRST PARAS',[(i,text(e)) for i,e in enumerate(ps[:24])]); print('COVER TABLES', [text(t) for t in d.xpath('/w:document/w:body/w:tbl',namespaces=ns)[:2]])
 print('STYLE FONT DEFAULT',etree.tostring(styles.find('w:docDefaults',ns)).decode()[:1600])
 print('HEADINGS')
 for i,e in enumerate(ps):
  st=e.find('w:pPr/w:pStyle',ns); s=st.get(w+'val') if st is not None else ''
  if 'Heading' in s or re.match(r'^(?:[1-4](?:\.\d+)*\s|ПРИЛОЖ|Прилож)',text(e)):print(i,s,text(e))
 fonts=collections.Counter(); sizes=collections.Counter(); examples={}
 start=next((i for i,e in enumerate(ps) if text(e)=='ВВЕДЕНИЕ'),25)
 for i,e in enumerate(ps[start:]):
  st=e.find('w:pPr/w:pStyle',ns)
  if st is not None and 'Heading' in st.get(w+'val',''):continue
  for r in e.findall('w:r',ns):
   t=text(r)
   if not t:continue
   f=r.find('w:rPr/w:rFonts',ns); sz=r.find('w:rPr/w:sz',ns)
   key=tuple(sorted(f.attrib.items())) if f is not None else 'inherited';fonts[key]+=len(t)
   size=sz.get(w+'val') if sz is not None else 'inherited';sizes[size]+=len(t);examples.setdefault(size,(start+i,t[:140]))
 print('BODY FONTS',fonts); print('BODY SIZES HALFPOINT',sizes,'EXAMPLES',examples)
 print('TABLE CAPTIONS')
 for i,e in enumerate(ps):
  if text(e).startswith('Таблица '):print(i,text(e))
 print('UNRESOLVED/EDITORIAL')
 pat=re.compile(r'\[(?:РИСУНОК|СКРИНШОТ|ТАБЛИЦА|МЕСТО|Иллюстрация)|рекомендуем.{0,18}таблиц|таблиц.{0,18}рекоменду|вставить|место для|заполнить|уточнить|здесь следует|необходимо добавить|рекомендуется|TODO|FIXME',re.I)
 for i,e in enumerate(ps):
  t=text(e)
  if pat.search(t):print(i,t[:1400])
 print('CITATIONS')
 for i,e in enumerate(ps):
  t=text(e)
  if re.search(r'\[\d+(?:[\s,;–—-]+\d+)*\]',t):print(i,t[:900])
 print('BIBLIOGRAPHY')
 bi=next(i for i,e in enumerate(ps) if text(e)=='СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ')
 for i in range(bi,min(len(ps),bi+35)):print(i,text(ps[i]))
 print('FIGURES')
 rel=etree.fromstring(z.read('word/_rels/document.xml.rels')); rels={e.get('Id'):e.get('Target') for e in rel}
 medias=[x for x in z.namelist() if x.startswith('word/media/') and not x.endswith('/')]; print('MEDIA COUNT',len(medias),'DRAWINGS',len(d.xpath('.//w:drawing',namespaces=ns)))
 hashes=collections.defaultdict(list)
 for m in medias:hashes[hashlib.sha256(z.read(m)).hexdigest()].append(m)
 print('DUPLICATE MEDIA', [v for v in hashes.values() if len(v)>1])
 for i,e in enumerate(ps):
  bs=e.xpath('.//a:blip/@r:embed',namespaces=ns)
  if bs: print(i,[rels.get(b) for b in bs], 'NEXT',text(ps[i+1]) if i+1<len(ps) else '')
 print('APPENDIX ALL')
 for i in range(bi+19,len(ps)):print(i,text(ps[i]))
for f in sorted((base/'drafts').glob('*.md')):
 if f.name.startswith('_'):continue
 lines=f.read_text(encoding='utf-8').splitlines(); print('DRAFT',f.name)
 ix=[i for i,s in enumerate(lines) if re.match(r'^#+ .*?(источник|литератур|ПРИЛОЖ)',s,re.I)]
 for i in ix:
  print('\n'.join(f'{j+1}: {lines[j]}' for j in range(i,min(len(lines),i+32))))
for name in ['Содержание УП.docx']:
 t=p.parent/name
 if t.exists():
  with zipfile.ZipFile(t) as z:
   dd=etree.fromstring(z.read('word/document.xml'));print('TEMPLATE',name)
   print('\n'.join(text(e) for e in dd.xpath('.//w:p',namespaces=ns) if text(e)))
