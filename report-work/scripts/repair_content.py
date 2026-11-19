from pathlib import Path
import re,json
ROOT=Path(r'C:\Users\admin\.zcode\workspace\default');D=ROOT/'report-work/drafts'
full=[D/'01_analysis.md',D/'02_implementation.md',D/'03_quality.md']
short=[D/'01_analysis_short.md',D/'02_implementation_short.md',D/'03_quality_short.md']
refs=[];maps=[];byurl={}
for f in full:
    raw=f.read_text(encoding='utf-8');parts=re.split(r'^#\s+Список использованных источников\s*$',raw,flags=re.M|re.I)
    mapping={}
    for line in parts[-1].splitlines():
        m=re.match(r'^(\d+)\.\s+(.+)',line)
        if not m:continue
        value=m[2].replace('**','');url=re.search(r'URL:\s*(\S+)',value)
        key=url[1].rstrip('/.') if url else value.lower()
        if key not in byurl:byurl[key]=len(refs)+1;refs.append(value)
        mapping[int(m[1])]=byurl[key]
    maps.append(mapping)
for i,f in enumerate(short):
    raw=f.read_text(encoding='utf-8')
    if i==0:
        intro=full[0].read_text(encoding='utf-8').split('# 1 Анализ предметной области')[0]
        intro=intro.replace('Цель работы — разработать концепцию и требования к','Цель работы — спроектировать и реализовать').replace('Структура рассматриваемой части отчёта','Структура отчёта')
        raw=intro+'\n'+raw[raw.index('# 1 Анализ предметной области'):]
        raw=raw.replace('Учитывается `prefers-reduced-motion`,','Предусмотрен ручной переключатель «Плавные эффекты»,')
        raw=raw.replace('## 2.12 Этапы разработки и план-график','## 2.12 Этапы разработки и план-график\n\nПлан-график является рекомендуемым распределением работ, а не протоколом фактических календарных сроков.')
    if i==1:
        raw=raw.replace('React 19.1.1','React 19').replace('React Router DOM 7.8.0','React Router DOM 7').replace('TypeScript 5.9.2','TypeScript 5.9').replace('Vite 6.3.5','Vite 6.4').replace('Express 5.1.0','Express 5').replace('Zod 4.0.17','Zod 4').replace('Motion 12.23.12','Motion 12')
        raw=raw.replace('На 600 px декоративная половина авторизации скрывается.','На узком экране декоративный блок авторизации располагается над формой.')
        raw=raw.replace('Ограничение реализации: системный `prefers-reduced-motion` автоматически не читается; его следует использовать как исходное значение при отсутствии ручного выбора.','По явному требованию пользователя эффекты включены по умолчанию независимо от системной настройки; пользователь может отключить их через меню профиля. Это поведение следует учитывать при доступностной приёмке.')
        raw=re.sub(r'^## (3\.2\.\d+|4\.1\.\d+) ',r'### \1 ',raw,flags=re.M)
        raw=raw.replace('# 3.2 Создание эскизного проекта и макетов интерфейса','## 3.2 Создание эскизного проекта и макетов интерфейса')
        raw=raw.replace('# 4.1 Реализация клиентской и серверной части','# 4 Программная реализация веб-приложения\n\n## 4.1 Реализация клиентской и серверной части')
        raw=raw.replace('Рекомендуемые столбцы таблицы: «Элемент эскиза», «Назначение», «Реализованный экран», «Изменение при детализации».','Развитие компоновок отражено в рабочем интерфейсе.')
    if i==2:
        raw=raw.split('# ПРИЛОЖЕНИЯ')[0]
        raw=raw.replace('# ОХРАНА ТРУДА И ТЕХНИКА БЕЗОПАСНОСТИ','# 6 Охрана труда и техника безопасности')
        raw=raw.replace('reduced motion','ручное отключение анимаций')
    def replace_ref(m):
        values=[]
        for part in re.split(r'[;,]\s*',m[1]):
            r=re.fullmatch(r'(\d+)[–—-](\d+)',part.strip())
            if r: values.extend(range(int(r[1]),int(r[2])+1))
            elif part.strip().isdigit():values.append(int(part))
        if not values or any(v not in maps[i] for v in values):return m[0]
        return '['+'; '.join(str(maps[i][v]) for v in values)+']'
    raw=re.sub(r'\[([\d; ,–—-]+)\]',replace_ref,raw)
    (D/f'ready-{i+1}.md').write_text(raw,encoding='utf-8')
(D/'bibliography.json').write_text(json.dumps(refs,ensure_ascii=False,indent=2),encoding='utf-8')
s=(ROOT/'report-work/generate_report_final.cjs').read_text(encoding='utf-8')
s=s.replace("const OUT='C:/Users/admin/Desktop/очтект/Отчёт_DOMA_умный_дом.docx';","const OUT='C:/Users/admin/.zcode/workspace/default/report-work/final-report.docx';")
s=s.replace('size:18,bold','size:22,bold')
s=s.replace('function titleP(text,level){','function titleP(text,level){')
s=s.replace('keepNext:true,spacing:{before:level===1?200:140','keepNext:true,pageBreakBefore:level===1,spacing:{before:level===1?200:140')
s=s.replace('headingStyleRange:\'1-3\'','headingStyleRange:\'1-2\'')
s=s.replace("['Количество листов','63']","['Количество листов','_____']")
s=s.replace("alignment:AlignmentType.CENTER,spacing:{before:100,after:60},children:[new ImageRun", "alignment:AlignmentType.CENTER,keepNext:true,spacing:{before:100,after:60},children:[new ImageRun")
s=s.replace("function parseMarkdown(file,opt={}){", "function parseMarkdown(file,opt={}){let currentTitle='';let pendingCaption='';")
s=s.replace("h._title='Материалы раздела';", "h._title=pendingCaption||currentTitle.replace(/^\\d+(?:\\.\\d+)*\\s*/, '')||'Данные проекта';pendingCaption='';")
s=s.replace("if(/^\\[ТАБЛИЦА/.test(line)){i++;continue;}", "if(/^\\[ТАБЛИЦА/.test(line)){i++;continue;}")
s=s.replace("if(/^\\*\\*Таблица/.test(line)){i++;continue;}", "if(/^\\*\\*Таблица/.test(line)){pendingCaption=clean(line).replace(/^Таблица\\s+[^—–]+[—–]\\s*/, '');i++;continue;}")
s=s.replace("if(/^#\\s+/.test(line)){out.push", "if(/^#\\s+/.test(line)){currentTitle=clean(line);out.push")
s=s.replace("if(/^##\\s+/.test(line)){out.push", "if(/^##\\s+/.test(line)){currentTitle=clean(line);out.push")
s=s.replace("if(/^###\\s+/.test(line)){out.push", "if(/^###\\s+/.test(line)){currentTitle=clean(line);out.push")
s=s.replace("out.push(p(clean(line)));i++;", "if(!/^Рекомендуем|^В матрице следует/.test(line))out.push(p(clean(line)));i++;")
start=s.index('let body=[];');end=s.index('const styles=',start)
new=r'''let body=[];
body.push(...parseMarkdown(path.join(D,'ready-1.md')));
body.push(...parseMarkdown(path.join(D,'ready-2.md')));
body.push(...parseMarkdown(path.join(D,'ready-3.md')));
body.push(titleP('СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ',1));
const sources=JSON.parse(fs.readFileSync(path.join(D,'bibliography.json'),'utf8'));
sources.forEach((text,i)=>body.push(p(`${i+1}. ${text}`,{noIndent:true,size:22})));
function appendix(letter,title,text){body.push(titleP(`ПРИЛОЖЕНИЕ ${letter}`,1),p('(обязательное)',{alignment:AlignmentType.CENTER,noIndent:true,size:22}),p(title,{alignment:AlignmentType.CENTER,noIndent:true,bold:true,size:26}));if(text)body.push(p(text));}
appendix('А','Листинг ключевых модулей программы','Приведены выдержки из текущих исходников: криптографическая проверка и транзакционная оболочка. Полные исходники находятся в проекте DOMA.');
const authLines=fs.readFileSync(path.join(ROOT,'server/auth.ts'),'utf8').split(/\r?\n/);
for(const line of authLines)body.push(new Paragraph({spacing:{line:240,after:0},children:[new TextRun({text:line,font:'Consolas',size:18,color:'000000'})]}));
const dbSource=fs.readFileSync(path.join(ROOT,'server/database.ts'),'utf8');const tx=dbSource.match(/export function transaction[\s\S]*?\n}/);
if(tx){body.push(p('Транзакционная оболочка', {bold:true,noIndent:true}));for(const line of tx[0].split(/\r?\n/))body.push(new Paragraph({spacing:{line:240,after:0},children:[new TextRun({text:line,font:'Consolas',size:18})]}));}
appendix('Б','Иллюстрация проекта','Основные экраны уже представлены в главе 4. Ниже приведены экран входа и мобильное представление обзора. Скриншот входа сохранён в ходе разработки; он не является результатом нового входа на дату составления отчёта.');
body.push(...image(path.join(ROOT,'gui-test-screenshots/t1-login.png'),'Экран входа DOMA (кадр этапа разработки)',630,460));
body.push(...image(path.join(S,'09-mobile.png'),'Мобильное представление DOMA',245,530));
appendix('В','Информационная модель','ER-модель разбита на три части для читаемости. Связи FK, PK и уникальные ограничения соответствуют схеме из шестнадцати таблиц; повторяющаяся devices показана как ссылка на первую часть.');
for(const name of ['08-er-core.png','09-er-states.png','10-er-automation.png']){body.push(...image(path.join(F,name),'Детальная ER-модель: '+({'08-er-core.png':'учётные записи, дома и устройства','09-er-states.png':'состояния и телеметрия','10-er-automation.png':'автоматизация и журнал'}[name]),650,760));}
appendix('Г','Функциональная модель','Функциональная модель показывает потоки запросов, проверок и данных; физическое оборудование находится вне границы учебного симулятора.');
body.push(...image(path.join(F,'11-functional.png'),'Функциональная модель DOMA',630,650));
appendix('Д','Диаграмма прецедентов','Пользовательские операции разделены на чтение доступного дома и изменения владельца; административные операции требуют серверной роли admin.');
body.push(...image(path.join(F,'03-use-cases.png'),'Диаграмма прецедентов DOMA',630,560));
appendix('Е','Диаграмма деятельности','Показана обработка запуска сценария: проверка, транзакция, успешная фиксация либо отказ без частичных изменений.');
body.push(...image(path.join(F,'12-activity.png'),'Диаграмма деятельности запуска сценария',630,700));
appendix('Ж','Каталоги API, БД и матрица трассируемости','Дополнительные справочные таблицы связывают требования с реализацией и проверками.');
const qualityRaw=fs.readFileSync(path.join(D,'03_quality_short.md'),'utf8');const appRaw=(qualityRaw.split('# ПРИЛОЖЕНИЯ')[1]||'').replace(/^## Приложение А\..*$/m,'## Ж.1 Каталог API').replace(/^## Приложение Б\..*$/m,'## Ж.2 Каталог БД').replace(/^## Приложение В\..*$/m,'## Ж.3 Матрица трассируемости');
const appFile=path.join(D,'ready-apps.md');fs.writeFileSync(appFile,appRaw);body.push(...parseMarkdown(appFile));
'''
s=s[:start]+new+s[end:]
s=s.replace('children:[...summary,pageBreak(),...toc,...body]','children:[...summary,pageBreak(),...toc,...body]')
(ROOT/'report-work/build_repaired.cjs').write_text(s,encoding='utf-8')
print('prepared repaired builder',len(refs),'sources')
