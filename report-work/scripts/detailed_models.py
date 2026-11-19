from pathlib import Path
import sys
sys.path.insert(0,r'C:\Users\admin\.zcode\workspace\default\report-work\python-libs')
from PIL import Image, ImageDraw, ImageFont
import textwrap
OUT=Path(r'C:\Users\admin\.zcode\workspace\default\report-work\figures')
FONT=r'C:\Windows\Fonts\arial.ttf'; BOLD=r'C:\Windows\Fonts\arialbd.ttf'

def font(s,b=False): return ImageFont.truetype(BOLD if b else FONT,s)
def canvas(title,subtitle='',size=(1800,2300)):
    im=Image.new('RGB',size,'white');d=ImageDraw.Draw(im)
    d.text((size[0]/2,50),title,font=font(42,True),fill='black',anchor='mt')
    if subtitle:d.text((size[0]/2,120),subtitle,font=font(24),fill='black',anchor='mt')
    return im,d

def node(d,x,y,w,title,lines):
    h=76+len(lines)*43
    d.rectangle((x,y,x+w,y+h),fill='white',outline='black',width=3)
    d.rectangle((x,y,x+w,y+64),fill='#ededed',outline='black',width=3)
    d.text((x+16,y+17),title,font=font(31,True),fill='black')
    for i,s in enumerate(lines):d.text((x+16,y+78+i*43),s,font=font(25),fill='black')
    return (x,y,w,h)

def edge(d,a,b,label,side='h'):
    if side=='h':p=(a[0]+a[2],a[1]+a[3]/2);q=(b[0],b[1]+b[3]/2);mid=(p[0]+q[0])/2;pts=[p,(mid,p[1]),(mid,q[1]),q]
    else:p=(a[0]+a[2]/2,a[1]+a[3]);q=(b[0]+b[2]/2,b[1]);mid=(p[1]+q[1])/2;pts=[p,(p[0],mid),(q[0],mid),q]
    d.line(pts,fill='black',width=3)
    d.ellipse((q[0]-5,q[1]-5,q[0]+5,q[1]+5),fill='black')
    lp=pts[1];box=d.textbbox((0,0),label,font=font(23));tw=box[2];th=box[3]
    d.rectangle((lp[0]-tw/2-7,lp[1]-th/2-8,lp[0]+tw/2+7,lp[1]+th/2+8),fill='white')
    d.text(lp,label,font=font(23),fill='black',anchor='mm')

im,d=canvas('ER-модель: пользователи, дома и устройства','PK — первичный ключ; FK — внешний ключ; UQ — уникальное ограничение')
u=node(d,90,225,590,'users',['PK id','name, email (UQ)','password_hash, role','created_at'])
s=node(d,1090,225,590,'sessions',['PK id; FK user_id → users','token_hash (UQ), csrf_hash','expires_at, created_at'])
h=node(d,90,785,590,'homes',['PK id','name, address'])
m=node(d,1090,785,590,'home_members',['PK id','FK home_id → homes','FK user_id → users','role: owner / member','UQ (home_id, user_id)'])
r=node(d,90,1390,590,'rooms',['PK id; FK home_id → homes','name, icon, image','sort_order'])
t=node(d,1090,1390,590,'device_types',['PK id','name, kind','sensor_metric, unit'])
v=node(d,570,1900,650,'devices',['PK id','FK room_id → rooms','FK type_id → device_types','name, online'])
edge(d,u,s,'1 : N');edge(d,h,m,'1 : N');edge(d,h,r,'1 : N','v');edge(d,u,m,'users 1 : N','v');edge(d,r,v,'rooms 1 : N','v');edge(d,t,v,'type 1 : N','v')
im.save(OUT/'08-er-core.png')

im,d=canvas('ER-модель: состояния и телеметрия','Все четыре связи начинаются в таблице devices из первой части ER-модели')
v=node(d,510,215,770,'devices (ссылка на часть 1)',['PK id; type_id определяет класс'])
l=node(d,80,600,700,'light_states',['PK id; FK device_id → devices (UQ)','power: 0 / 1','brightness: 0…100','color_temp: 2000…6500 K'])
c=node(d,1020,600,700,'climate_states',['PK id; FK device_id → devices (UQ)','power, target_temp: 10…35 °C','current_temp: −50…70 °C','mode: auto / heat / cool / fan / off'])
s=node(d,80,1260,700,'sensor_states',['PK id; FK device_id → devices (UQ)','value','updated_at'])
r=node(d,1020,1260,700,'sensor_readings',['PK id; FK device_id → devices','value','created_at'])
edge(d,v,l,'0..1 / device','v');edge(d,v,c,'0..1 / device','v')
d.line([(510,291),(25,291),(25,1400),(80,1400)],fill='black',width=3)
d.text((65,1200),'devices → sensor_states: 0..1',font=font(24),fill='black')
d.line([(890,385),(890,1770),(1380,1770),(1380,1505)],fill='black',width=3)
d.text((1010,1810),'devices 1 : N sensor_readings',font=font(27),fill='black')
d.text((90,1920),'Триггеры допускают только состояние своего класса.',font=font(30,True),fill='black')
d.text((90,1990),'Текущее показание и история — разные отношения.',font=font(28),fill='black')
d.text((90,2060),'Все состояния и измерения удаляются каскадно с устройством.',font=font(27),fill='black')
d.text((90,2130),'API выдаёт до 240 измерений; хранение — до 1000 на датчик.',font=font(27),fill='black')
im.save(OUT/'09-er-states.png')

im,d=canvas('ER-модель: сценарии и журнал','FK на homes, devices и users связывают эту часть с первой частью модели')
s=node(d,85,230,700,'scenes',['PK id; FK home_id → homes','name, description, icon, color','last_run'])
a=node(d,1015,230,700,'scene_actions',['PK id; FK scene_id → scenes','FK device_id → devices','property, value','UQ (scene_id, device_id, property)'])
r=node(d,85,850,700,'scene_schedules',['PK id; FK scene_id → scenes (UQ)','time: HH:MM; days_mask: 1…127','enabled, last_run_minute'])
t=node(d,1015,850,700,'event_types',['PK id; name (UQ)','severity: info / warning / critical'])
e=node(d,505,1530,790,'events',['PK id; FK home_id → homes','FK device_id → devices (nullable)','FK user_id → users (nullable)','FK type_id → event_types','message, created_at'])
edge(d,s,a,'1 : N');edge(d,s,r,'1 : 0..1','v');edge(d,t,e,'type 1 : N','v')
d.text((85,2100),'Устройство сценария: RESTRICT; источник события: SET NULL.',font=font(27),fill='black')
im.save(OUT/'10-er-automation.png')

im,d=canvas('Функциональная модель DOMA (DFD, уровень 0)','Потоки данных и границы обработки; не схема физических IoT-устройств',(1800,1800))
left=node(d,65,300,500,'Пользователь',['Регистрация, команды','Фильтры и чтение истории'])
right=node(d,1235,300,500,'Администратор',['CRUD, роли и пользователи','Сброс паролей, отзыв сессий'])
center=node(d,650,790,500,'Обработка DOMA',['1. Сессия и права','2. Валидация входных данных','3. Команды и сценарии','4. Журнал и JSON-ответ'])
db=node(d,650,1360,500,'Хранилище SQLite',['Учётные записи и дома','Состояния, история, сценарии'])
edge(d,left,center,'JSON / CSRF','v');edge(d,right,center,'JSON / CSRF','v');edge(d,center,db,'SQL / транзакции','v')
d.text((100,1650),'Выход: состояние, события, история, ошибки, CSV.',font=font(31),fill='black')
im.save(OUT/'11-functional.png')

im,d=canvas('Диаграмма деятельности: запуск сценария','Все проверки выполняются до фиксации изменённых состояний',(1800,2100))
steps=[('Получить запрос запуска',260),('Проверить сессию, CSRF и доступ к дому',470),('Загрузить и проверить все действия',680),('BEGIN IMMEDIATE',890),('Обновить состояния, события и last_run',1100),('COMMIT и вернуть успешный ответ',1310)]
rects=[]
for txt,y in steps:rects.append(node(d,450,y,900,txt,[]))
for a,b in zip(rects,rects[1:]):edge(d,a,b,'','v')
err=node(d,450,1620,900,'Ветка отказа',['При ошибке: ROLLBACK, без частичных изменений','HTTP-ошибка либо запись ошибки расписания'])
d.line([(1350,718),(1550,718),(1550,1660),(1350,1660)],fill='black',width=3)
d.text((1450,1080),'ошибка',font=font(28),fill='black',anchor='mm')
d.text((900,1980),'Для расписания попытка дедуплицируется по локальной минуте.',font=font(28),fill='black',anchor='mm')
im.save(OUT/'12-activity.png')
print('Created 5 detailed monochrome diagrams')
