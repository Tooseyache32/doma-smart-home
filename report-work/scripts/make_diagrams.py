from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Rectangle, Ellipse, FancyArrowPatch

OUT=Path(r'C:\Users\admin\.zcode\workspace\default\report-work\figures')
OUT.mkdir(parents=True,exist_ok=True)
plt.rcParams.update({'font.family':'Times New Roman','font.size':10,'axes.edgecolor':'black','text.color':'black'})

def save(fig,name):
    fig.savefig(OUT/name,dpi=220,bbox_inches='tight',facecolor='white')
    plt.close(fig)

def box(ax,x,y,w,h,text,fs=10,lw=1.2,rounding=.02):
    p=FancyBboxPatch((x,y),w,h,boxstyle=f'round,pad=0.012,rounding_size={rounding}',fc='white',ec='black',lw=lw)
    ax.add_patch(p); ax.text(x+w/2,y+h/2,text,ha='center',va='center',fontsize=fs,wrap=True)
    return p

def arrow(ax,a,b,label=None,style='-|>'):
    p=FancyArrowPatch(a,b,arrowstyle=style,mutation_scale=12,lw=1.1,color='black')
    ax.add_patch(p)
    if label: ax.text((a[0]+b[0])/2,(a[1]+b[1])/2+.018,label,ha='center',va='bottom',fontsize=8,backgroundcolor='white')

# Context
fig,ax=plt.subplots(figsize=(10,5.8));ax.set_xlim(0,1);ax.set_ylim(0,1);ax.axis('off')
box(ax,.39,.34,.26,.3,'Веб-система DOMA\nсимулятор умного дома',14,1.7)
actors=[(.04,.68,.22,.18,'Пользователь\nуправление домом'),(.04,.14,.22,.18,'Администратор\nуправление данными'),(.75,.68,.21,.18,'Браузер\nадаптивный интерфейс'),(.75,.14,.21,.18,'SQLite\nхранение состояния')]
for x,y,w,h,t in actors:box(ax,x,y,w,h,t,10)
for a,b,l in [((.26,.77),(.39,.57),'команды'),((.26,.23),(.39,.43),'CRUD'),((.65,.57),(.75,.77),'HTML/JSON'),((.65,.43),(.75,.23),'SQL')]:arrow(ax,a,b,l)
ax.set_title('Контекстная схема веб-системы DOMA',fontsize=15,pad=15)
save(fig,'01-context.png')

# Components
fig,ax=plt.subplots(figsize=(11,6.2));ax.set_xlim(0,1);ax.set_ylim(0,1);ax.axis('off')
ax.add_patch(Rectangle((.03,.1),.94,.8,fill=False,ec='black',lw=1.5));ax.text(.05,.87,'DOMA: монолитное full-stack приложение',fontsize=14,weight='bold')
cols=[(.07,'Клиент React 19',['Маршрутизация','Context/API client','5 страниц + admin','Motion + Lenis']),(.38,'Сервер Express 5',['Auth/CSRF/RBAC','REST API','Automation','Admin registry']),(.69,'Хранилище SQLite',['16 таблиц','FK/CHECK/UNIQUE','6 индексов','7 триггеров'])]
for x,title,items in cols:
 box(ax,x,.25,.24,.5,title+'\n\n'+'\n'.join('• '+i for i in items),11)
arrow(ax,(.31,.5),(.38,.5),'HTTPS / JSON');arrow(ax,(.62,.5),(.69,.5),'параметризованный SQL')
box(ax,.31,.12,.38,.08,'Общий контракт TypeScript + проверка Zod',10)
ax.set_title('Компонентная архитектура системы',fontsize=15,pad=10)
save(fig,'02-architecture.png')

# Use cases
fig,ax=plt.subplots(figsize=(11,7));ax.set_xlim(0,1);ax.set_ylim(0,1);ax.axis('off')
ax.add_patch(Rectangle((.22,.07),.73,.86,fill=False,ec='black',lw=1.4));ax.text(.235,.9,'Граница системы DOMA',fontsize=12,weight='bold')
ax.text(.07,.72,'Пользователь',ha='center',fontsize=11);ax.add_patch(Ellipse((.07,.82),.035,.06,fill=False));ax.plot([.07,.07],[.79,.7],c='black');ax.plot([.035,.105],[.75,.75],c='black');ax.plot([.07,.04],[.7,.65],c='black');ax.plot([.07,.1],[.7,.65],c='black')
ax.text(.07,.26,'Администратор',ha='center',fontsize=11);ax.add_patch(Ellipse((.07,.36),.035,.06,fill=False));ax.plot([.07,.07],[.33,.24],c='black');ax.plot([.035,.105],[.29,.29],c='black');ax.plot([.07,.04],[.24,.19],c='black');ax.plot([.07,.1],[.24,.19],c='black')
ucs=[(.3,.74,'Регистрация и вход'),(.55,.76,'Просмотр состояния'),(.78,.75,'Управление светом'),(.33,.54,'Настройка климата'),(.59,.55,'Запуск сценариев'),(.82,.54,'Просмотр журнала'),(.37,.32,'Управление комнатами'),(.65,.32,'Симуляция датчиков'),(.49,.14,'Управление всеми данными'),(.79,.15,'Управление пользователями')]
for x,y,t in ucs:ax.add_patch(Ellipse((x,y),.21,.105,fc='white',ec='black'));ax.text(x,y,t,ha='center',va='center',fontsize=8.5,wrap=True)
for x,y,_ in ucs[:8]:arrow(ax,(.115,.72 if y>.45 else .28),(x-.105,y),style='-')
for x,y,_ in ucs[8:]:arrow(ax,(.115,.28),(x-.105,y),style='-')
ax.set_title('Диаграмма вариантов использования',fontsize=15)
save(fig,'03-use-cases.png')

# Auth sequence
fig,ax=plt.subplots(figsize=(11,7));ax.set_xlim(0,1);ax.set_ylim(0,1);ax.axis('off')
xs=[.12,.37,.63,.87]; names=['Браузер','React SPA','Express API','SQLite']
for x,n in zip(xs,names):box(ax,x-.08,.88,.16,.07,n,10);ax.plot([x,x],[.12,.88],ls='--',c='black',lw=.8)
steps=[(.82,0,1,'email + пароль'),(.73,1,2,'POST /api/auth/login'),(.64,2,3,'SELECT user'),(.55,3,2,'password_hash'),(.46,2,2,'scrypt + сравнение'),(.37,2,3,'INSERT hashed session'),(.28,2,1,'HttpOnly cookie + CSRF'),(.19,1,2,'GET /api/home')]
for y,a,b,l in steps:
 arrow(ax,(xs[a],y),(xs[b],y),l,style='-|>' if a!=b else '-|>')
ax.set_title('Последовательность авторизации и создания сессии',fontsize=15)
save(fig,'04-auth-sequence.png')

# Scene sequence
fig,ax=plt.subplots(figsize=(11,7));ax.set_xlim(0,1);ax.set_ylim(0,1);ax.axis('off')
xs=[.1,.34,.58,.82];names=['Пользователь','React','Express','SQLite']
for x,n in zip(xs,names):box(ax,x-.075,.88,.15,.07,n,10);ax.plot([x,x],[.12,.88],ls='--',c='black',lw=.8)
steps=[(.8,0,1,'Запустить'),(.71,1,2,'POST /scenes/:id/run'),(.62,2,3,'BEGIN IMMEDIATE'),(.53,2,3,'Проверка всех действий'),(.44,2,3,'UPDATE состояний'),(.35,2,3,'INSERT событий'),(.26,2,3,'COMMIT'),(.17,2,1,'Обновлённый snapshot')]
for y,a,b,l in steps:arrow(ax,(xs[a],y),(xs[b],y),l)
ax.set_title('Атомарное выполнение сценария',fontsize=15)
save(fig,'05-scene-sequence.png')

# ER overview split domains
fig,ax=plt.subplots(figsize=(12,8));ax.set_xlim(0,1);ax.set_ylim(0,1);ax.axis('off')
domains=[(.02,.53,.28,.4,'Идентификация',['users','sessions','homes','home_members']),(.36,.53,.28,.4,'Устройства',['rooms','device_types','devices','light_states','climate_states']),(.7,.53,.28,.4,'Телеметрия',['sensor_states','sensor_readings']),(.12,.08,.34,.32,'Автоматизация',['scenes','scene_actions','scene_schedules']),(.57,.08,.31,.32,'Журнал',['event_types','events'])]
for x,y,w,h,title,items in domains:
 ax.add_patch(FancyBboxPatch((x,y),w,h,boxstyle='round,pad=.01',fc='white',ec='black',lw=1.3));ax.text(x+w/2,y+h-.035,title,ha='center',va='top',fontsize=12,weight='bold')
 for i,it in enumerate(items):box(ax,x+.035,y+h-.105-.055*i,w-.07,.04,it,8,.8,.008)
for a,b,l in [((.3,.68),(.36,.68),'дом/комната'),((.64,.65),(.7,.65),'датчик'),((.5,.53),(.33,.4),'действия'),((.55,.53),(.72,.4),'события')]:arrow(ax,a,b,l)
ax.set_title('Логическая модель данных: 16 таблиц по предметным областям',fontsize=15)
save(fig,'06-er-overview.png')

# Deployment
fig,ax=plt.subplots(figsize=(11,6));ax.set_xlim(0,1);ax.set_ylim(0,1);ax.axis('off')
box(ax,.05,.37,.18,.24,'Клиентское\nустройство\nбраузер',12);box(ax,.31,.37,.19,.24,'HTTPS reverse proxy\nNginx / Caddy',11);box(ax,.58,.37,.18,.24,'Node.js 22\nExpress + SPA',11);box(ax,.82,.37,.14,.24,'Постоянный том\nSQLite + WAL',10)
arrow(ax,(.23,.49),(.31,.49),'HTTPS');arrow(ax,(.5,.49),(.58,.49),'HTTP');arrow(ax,(.76,.49),(.82,.49),'файлы БД')
box(ax,.58,.16,.18,.1,'Фоновые задачи\nсценарии и датчики',9);arrow(ax,(.67,.37),(.67,.26),style='<->')
ax.text(.5,.78,'Один экземпляр приложения; резервное копирование с учётом WAL',ha='center',fontsize=11)
ax.set_title('Схема развёртывания DOMA',fontsize=15)
save(fig,'07-deployment.png')
print('generated',len(list(OUT.glob('0*.png'))),'diagrams')
