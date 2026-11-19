import sys,zipfile,json,collections
from pathlib import Path
sys.path.insert(0,r'C:\Users\admin\.zcode\workspace\default\report-work\python-libs')
from lxml import etree
sys.stdout.reconfigure(encoding='utf-8')
p=Path(r'C:\Users\admin\.zcode\workspace\default\report-work\revision\sources\sample\source.docx')
N={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
with zipfile.ZipFile(p) as z:
    d=etree.fromstring(z.read('word/document.xml'));s=etree.fromstring(z.read('word/styles.xml'))
    styles={x.get('{'+N['w']+'}styleId'):x for x in s.findall('w:style',N)}
    def txt(e):return ''.join(e.xpath('.//w:t/text()',namespaces=N))
    out=[]
    for para in d.xpath('./w:body/w:p',namespaces=N):
        text=txt(para)
        if text and ('Продолжение таблицы' in text or text.startswith(('Введение','Заключение','1 ','1.1','2 ','Содержание','Таблица','Рисунок'))):
            st=para.xpath('./w:pPr/w:pStyle/@w:val',namespaces=N)
            out.append({'text':text[:150],'pPr':etree.tostring(para.find('w:pPr',N),encoding='unicode') if para.find('w:pPr',N) is not None else '', 'font':para.xpath('./w:r/w:rPr/w:rFonts/@w:ascii',namespaces=N),'size':para.xpath('./w:r/w:rPr/w:sz/@w:val',namespaces=N),'style':st})
    result={'examples':out[:45],'sections':[]}
    for sect in d.xpath('.//w:sectPr',namespaces=N):result['sections'].append(etree.tostring(sect,encoding='unicode'))
    result['styles']={k:etree.tostring(v,encoding='unicode') for k,v in styles.items() if k in ('Normal','a','1','2','Heading1','Heading2','3')}
Path(r'C:\Users\admin\.zcode\workspace\default\report-work\revision\sample_details.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print('extracted',len(out),'relevant paragraphs',len(result['sections']),'sections')
