from pathlib import Path
from lxml import etree
import json

NS={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main','v':'urn:schemas-microsoft-com:vml','wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'}
W='{'+NS['w']+'}'

def text(node):
    return ''.join(node.xpath('.//w:t/text()',namespaces=NS)).strip()

def parse_story(path):
    root=etree.parse(str(path)).getroot()
    out=[]
    body=root.find('.//w:body',NS)
    container=body if body is not None else root
    for child in container:
        tag=etree.QName(child).localname
        if tag=='p':
            t=text(child)
            style=child.xpath('./w:pPr/w:pStyle/@w:val',namespaces=NS)
            if t or child.xpath('.//w:br|.//w:drawing|.//w:pict',namespaces=NS):
                out.append({'type':'p','text':t,'style':style[0] if style else None,'pageBreak':bool(child.xpath('.//w:br[@w:type="page"]|./w:pPr/w:pageBreakBefore',namespaces=NS)),'drawing':len(child.xpath('.//w:drawing|.//w:pict',namespaces=NS))})
        elif tag=='tbl':
            rows=[]
            for tr in child.xpath('./w:tr',namespaces=NS):
                rows.append([text(tc) for tc in tr.xpath('./w:tc',namespaces=NS)])
            out.append({'type':'table','rows':rows})
        elif tag=='sectPr':
            pass
    sections=[]
    for s in root.xpath('.//w:sectPr',namespaces=NS):
        pg=s.find('w:pgSz',NS); mar=s.find('w:pgMar',NS)
        sections.append({'page':dict(pg.attrib) if pg is not None else {},'margins':dict(mar.attrib) if mar is not None else {},'headers':[dict(x.attrib) for x in s.findall('w:headerReference',NS)],'footers':[dict(x.attrib) for x in s.findall('w:footerReference',NS)],'type':dict(s.find('w:type',NS).attrib) if s.find('w:type',NS) is not None else {}})
    return {'blocks':out,'sections':sections,'drawings':len(root.xpath('.//w:drawing|.//w:pict',namespaces=NS))}

base=Path(r'C:\Users\admin\.zcode\workspace\default\report-work\sources')
for folder in ['content','title','sketches']:
    u=base/folder/'unpacked'
    result={'document':parse_story(u/'word'/'document.xml'),'stories':{}}
    for p in sorted((u/'word').glob('header*.xml'))+sorted((u/'word').glob('footer*.xml')):
        result['stories'][p.name]=parse_story(p)
    props=u/'docProps'/'app.xml'
    if props.exists():
        result['appProperties']=etree.tostring(etree.parse(str(props)).getroot(),encoding='unicode')
    (base/folder/'extracted.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(folder, 'blocks',len(result['document']['blocks']),'sections',len(result['document']['sections']),'stories',len(result['stories']))
