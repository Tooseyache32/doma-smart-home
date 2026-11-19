import { Router, type Request } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { AdminField } from '../shared/types.js';
import { hashPassword } from './auth.js';
import { addEvent, daysToMask, initializeDevice, maskToDays, transaction, type Row } from './database.js';
import { actionValue, bit, emailSchema, fail, getDevice, idSchema, nameSchema, passwordSchema, requireRow, roomSchema, scheduleSchema, sensorValue } from './validation.js';
import { recordSensor } from './automation.js';

interface Resource {key:string; label:string; description:string; fields:AdminField[]; schema:z.ZodObject<any>; create?:boolean; delete?:boolean}
const field = (key:string,label:string,type:AdminField['type']='text',required=true,readonly=false):AdminField => ({key,label,type,required,readonly});
const fk = (key:string,label:string,required=true) => field(key,label,'select',required);
const choice = (key:string,label:string,values:string[]):AdminField => ({...field(key,label,'select'),options:values.map(value=>({value,label:value}))});
const positive = z.number().int().positive();
const datetime = z.string().refine(value=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.test(value)&&Number.isFinite(Date.parse(value)),'Некорректная дата').transform(value=>new Date(value).toISOString());
const optionalText=(max:number)=>z.preprocess(v=>v===null?'':v,z.string().max(max).default(''));
const defaults = {power:bit.default(0),brightness:z.number().int().min(0).max(100).default(70),color_temp:z.number().int().min(2000).max(6500).default(2700)};
const resources:Resource[] = [
  {key:'users',label:'Пользователи',description:'Учётные записи. Хеши паролей никогда не возвращаются.',fields:[field('name','Имя'),field('email','Email'),choice('role','Роль',['user','admin']),field('password','Новый пароль','password',false)],schema:z.object({name:nameSchema,email:emailSchema,role:z.enum(['user','admin']).default('user'),password:passwordSchema.optional()})},
  {key:'homes',label:'Дома',description:'При создании администратор становится владельцем.',fields:[field('name','Название'),field('address','Адрес', 'text',false)],schema:z.object({name:nameSchema,address:optionalText(300)})},
  {key:'home_members',label:'Участники домов',description:'Связь пользователя и дома. Последний владелец защищён.',fields:[fk('home_id','Дом'),fk('user_id','Пользователь'),choice('role','Роль',['owner','member'])],schema:z.object({home_id:positive,user_id:positive,role:z.enum(['owner','member']).default('owner')})},
  {key:'rooms',label:'Комнаты',description:'Комнаты принадлежат одному дому.',fields:[fk('home_id','Дом'),field('name','Название'),field('icon','Иконка'),field('image','Изображение'),field('sort_order','Порядок','number')],schema:roomSchema.extend({home_id:positive})},
  {key:'device_types',label:'Типы устройств',description:'Каталог возможностей и метрик датчиков.',fields:[field('name','Название'),choice('kind','Класс',['light','climate','sensor']),{...choice('sensor_metric','Метрика',['temp','humidity','co2','motion','contact','leak']),required:false},field('unit','Единица','text',false)],schema:z.object({name:nameSchema,kind:z.enum(['light','climate','sensor']),sensor_metric:z.enum(['temp','humidity','co2','motion','contact','leak']).nullable().default(null),unit:z.string().max(20).nullable().default(null)})},
  {key:'devices',label:'Устройства',description:'Состояние нужного класса создаётся автоматически.',fields:[fk('room_id','Комната'),fk('type_id','Тип'),field('name','Название'),field('online','В сети (0/1)','number')],schema:z.object({room_id:positive,type_id:positive,name:nameSchema,online:bit.default(1)})},
  {key:'light_states',label:'Свет',description:'Состояние света, один к одному с устройством.',fields:[{...fk('device_id','Устройство'),readonly:true},field('power','Питание (0/1)','number'),field('brightness','Яркость','number'),field('color_temp','Температура света','number')],schema:z.object({device_id:positive,...defaults}),create:false},
  {key:'climate_states',label:'Климат',description:'Состояние климатического оборудования.',fields:[{...fk('device_id','Устройство'),readonly:true},field('power','Питание (0/1)','number'),field('target_temp','Целевая температура','number'),field('current_temp','Текущая температура','number'),choice('mode','Режим',['auto','heat','cool','fan','off'])],schema:z.object({device_id:positive,power:bit.default(1),target_temp:z.number().min(10).max(35).default(22),current_temp:z.number().min(-50).max(70).default(22),mode:z.enum(['auto','heat','cool','fan','off']).default('auto')}),create:false},
  {key:'sensor_states',label:'Датчики',description:'Виртуальная телеметрия; изменение создаёт показание и событие.',fields:[{...fk('device_id','Устройство'),readonly:true},field('value','Значение','number'),field('updated_at','Обновлено','datetime',false,true)],schema:z.object({device_id:positive,value:z.number(),updated_at:datetime}),create:false},
  {key:'sensor_readings',label:'История датчиков',description:'Исторические измерения виртуальных датчиков.',fields:[fk('device_id','Датчик'),field('value','Значение','number'),field('created_at','Дата','datetime')],schema:z.object({device_id:positive,value:z.number(),created_at:datetime.default(()=>new Date().toISOString())})},
  {key:'scenes',label:'Сценарии',description:'Настройки сценариев. Действия и расписания находятся в отдельных таблицах.',fields:[fk('home_id','Дом'),field('name','Название'),field('description','Описание','text',false),choice('icon','Иконка',['sun','home','moon','film','coffee','leaf']),field('color','Цвет'),field('last_run','Последний запуск','datetime',false,true)],schema:z.object({home_id:positive,name:nameSchema,description:optionalText(1000),icon:z.enum(['sun','home','moon','film','coffee','leaf']).default('sun'),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#D99B54'),last_run:datetime.nullable().default(null)})},
  {key:'scene_actions',label:'Действия сценариев',description:'Допустимое свойство зависит от класса устройства.',fields:[fk('scene_id','Сценарий'),fk('device_id','Устройство'),choice('property','Свойство',['power','brightness','color_temp','target_temp','mode']),field('value','Значение')],schema:z.object({scene_id:positive,device_id:positive,property:z.enum(['power','brightness','color_temp','target_temp','mode']),value:z.string().min(1).max(30)})},
  {key:'scene_schedules',label:'Расписания',description:'Местное время сервера; дни 0–6, воскресенье = 0.',fields:[fk('scene_id','Сценарий'),field('time','Время HH:MM'),field('days','Дни 0–6 через запятую'),field('enabled','Включено (0/1)','number'),field('last_run_minute','Последняя минута','text',false,true)],schema:scheduleSchema.omit({id:true}).extend({scene_id:positive,last_run_minute:z.string().nullable().default(null)})},
  {key:'event_types',label:'Типы событий',description:'Каталог типов и уровней важности.',fields:[field('name','Тип'),choice('severity','Важность',['info','warning','critical'])],schema:z.object({name:nameSchema,severity:z.enum(['info','warning','critical'])})},
  {key:'events',label:'События',description:'Журнал управления и симуляции.',fields:[fk('home_id','Дом'),fk('device_id','Устройство',false),fk('user_id','Пользователь',false),fk('type_id','Тип события'),field('message','Сообщение'),field('created_at','Дата','datetime')],schema:z.object({home_id:positive,device_id:positive.nullable().default(null),user_id:positive.nullable().default(null),type_id:positive,message:z.string().min(1).max(2000),created_at:datetime.default(()=>new Date().toISOString())})},
  {key:'sessions',label:'Сессии',description:'Только безопасные метаданные. Отзыв через карточку пользователя.',fields:[{...fk('user_id','Пользователь'),readonly:true},field('expires_at','Истекает','datetime',true,true),field('created_at','Создана','datetime',true,true)],schema:z.object({}),create:false,delete:false}
];
const stateResources = ['light_states','climate_states','sensor_states'];
function lookup(resource:string) { const item = resources.find(v=>v.key===resource); if (!item) fail('Неизвестный ресурс',404); return item!; }
function rowData(db:DatabaseSync,key:string,id?:number) {
  const cols = key==='users'?'id,name,email,role,created_at':key==='sessions'?'id,user_id,expires_at,created_at':'*';
  const query = `SELECT ${cols} FROM ${key}`;
  const convert=(row:Row)=> {if(key!=='scene_schedules') return row;const {days_mask,...rest}=row;return {...rest,days:maskToDays(days_mask)};};
  return id===undefined?(db.prepare(query+' ORDER BY id').all() as Row[]).map(convert):convert(requireRow(db,query+' WHERE id=?',id));
}
function validateRelations(db:DatabaseSync,key:string,data:Row,old?:Row) {
  const fks:Record<string,string> = {home_id:'homes',user_id:'users',room_id:'rooms',device_id:'devices',scene_id:'scenes',type_id:key==='events'?'event_types':'device_types'};
  for (const [column,target] of Object.entries(fks)) if (data[column]!=null) requireRow(db,`SELECT id FROM ${target} WHERE id=?`,data[column]);
  if (key==='device_types') {
    if (data.kind==='sensor' && data.unit===null && ['motion','contact','leak'].includes(data.sensor_metric)) data.unit='';
    if (data.kind==='sensor' && (!data.sensor_metric || data.unit===null)) fail('Датчику нужны метрика и единица');
    if (data.kind!=='sensor' && (data.sensor_metric!==null || data.unit!==null)) fail('Метрика доступна только датчикам');
    if (old && (old.kind!==data.kind || old.sensor_metric!==data.sensor_metric) && db.prepare('SELECT id FROM devices WHERE type_id=? LIMIT 1').get(old.id)) fail('Используемый тип нельзя менять на другой класс/метрику',409);
  }
  if (key==='rooms' && old && old.home_id!==data.home_id && db.prepare('SELECT id FROM devices WHERE room_id=? LIMIT 1').get(old.id)) fail('Сначала переместите устройства из комнаты',409);
  if (key==='devices' && old) {
    const room = requireRow(db,'SELECT home_id FROM rooms WHERE id=?',data.room_id);
    const prior = requireRow(db,'SELECT home_id FROM rooms WHERE id=?',old.room_id);
    if (room.home_id!==prior.home_id) fail('Перенос устройства в другой дом запрещён',409);
    if (data.type_id!==old.type_id && db.prepare('SELECT id FROM scene_actions WHERE device_id=? LIMIT 1').get(old.id)) fail('Тип устройства используется в сценарии',409);
  }
  if (stateResources.includes(key) || key==='sensor_readings') {
    const device = getDevice(db,data.device_id);
    const expected = key==='light_states'?'light':key==='climate_states'?'climate':'sensor';
    if (device.kind!==expected) fail('Класс устройства не соответствует таблице');
    if (expected==='sensor') sensorValue(device.sensor_metric,data.value);
    if (old && old.device_id!==data.device_id) fail('Устройство состояния неизменяемо');
  }
  if (key==='scenes' && old && old.home_id!==data.home_id && db.prepare('SELECT id FROM scene_actions WHERE scene_id=? LIMIT 1').get(old.id)) fail('Сценарий с действиями нельзя переносить в другой дом',409);
  if (key==='scene_actions') {
    const scene = requireRow(db,'SELECT home_id FROM scenes WHERE id=?',data.scene_id);
    const device = getDevice(db,data.device_id);
    if (scene.home_id!==device.home_id) fail('Сценарий и устройство из разных домов');
    actionValue(device.kind,data.property,data.value);
  }
  if (key==='events' && data.device_id!=null && getDevice(db,data.device_id).home_id!==data.home_id) fail('Событие и устройство из разных домов');
  if (key==='event_types' && old && old.name!==data.name && ['system','device','scene','sensor','simulation','security'].includes(old.name)) fail('Системный тип события нельзя переименовать',409);
}
export function adminRouter(db:DatabaseSync) {
  const active=(req:Request)=> {
    if(!db.prepare("SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>? AND u.role='admin'").get((req as any).session.id,new Date().toISOString())) fail('Сессия администратора отозвана',401);
  };
  const router = Router();
  router.use((req,res,next)=> { if ((req as any).user.role!=='admin') return next(new (class extends Error {status=403})('Только для администратора')); next(); });
  router.get('/',(_req,res)=> {
    const labels:Record<string,{value:number;label:string}[]> = {};
    for (const table of ['users','homes','rooms','device_types','devices','scenes','event_types']) labels[table]=(db.prepare(`SELECT id,${table==='users'?'name || \' · \' || email':'name'} label FROM ${table} ORDER BY id`).all() as Row[]).map(r=>({value:r.id,label:`${r.label} (#${r.id})`}));
    res.json({resources:resources.map(resource=>({...resource,schema:undefined,create:undefined,delete:undefined,canCreate:resource.create!==false,canDelete:resource.delete!==false&&!stateResources.includes(resource.key),fields:[field('id','ID','number',false,true),...resource.fields.map(f=>({...f,options:f.options??(f.type==='select'?labels[({home_id:'homes',user_id:'users',room_id:'rooms',device_id:'devices',scene_id:'scenes',type_id:resource.key==='events'?'event_types':'device_types'} as Record<string,string>)[f.key]]:undefined)}))],rows:rowData(db,resource.key)})),stats:{users:(db.prepare('SELECT count(*) n FROM users').get() as Row).n,homes:(db.prepare('SELECT count(*) n FROM homes').get() as Row).n,devices:(db.prepare('SELECT count(*) n FROM devices').get() as Row).n,events:(db.prepare('SELECT count(*) n FROM events').get() as Row).n}});
  });
  router.post('/users/:id/password',async(req,res)=> {
    const id=idSchema.parse(req.params.id); requireRow(db,'SELECT id FROM users WHERE id=?',id);
    const {password}=z.object({password:passwordSchema}).strict().parse(req.body);
    const hash=await hashPassword(password);
    active(req);
    transaction(db,()=> {db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash,id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);});
    res.json({success:true});
  });
  router.post('/users/:id/revoke',(req,res)=> { const id=idSchema.parse(req.params.id);requireRow(db,'SELECT id FROM users WHERE id=?',id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);res.json({success:true}); });
  router.post('/:resource',async(req,res)=> {
    const resource=lookup(String(req.params.resource));
    if(resource.create===false) fail('Ресурс создаётся автоматически',405);
    const data=resource.schema.strict().parse(req.body) as Row;
    if(resource.key==='users'&&!data.password) fail('Укажите пароль для нового пользователя');
    const hash=data.password?await hashPassword(data.password):undefined;
    active(req);
    const id=transaction(db,()=> {
      validateRelations(db,resource.key,data);
      const insert={...data}; delete insert.password;
      if(resource.key==='scene_schedules') {insert.days_mask=daysToMask(insert.days);delete insert.days;}
      if(hash) insert.password_hash=hash;
      const columns=Object.keys(insert);
      const result=db.prepare(`INSERT INTO ${resource.key}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(c=>insert[c]));
      const id=Number(result.lastInsertRowid);
      if(resource.key==='homes') db.prepare("INSERT INTO home_members(home_id,user_id,role) VALUES(?,?,'owner')").run(id,(req as any).user.id);
      if(resource.key==='devices') {const type=requireRow(db,'SELECT * FROM device_types WHERE id=?',data.type_id);initializeDevice(db,id,type.kind,type.sensor_metric);}
      return id;
    });
    res.status(201).json(rowData(db,resource.key,id));
  });
  router.patch('/:resource/:id',async(req,res)=> {
    const resource=lookup(String(req.params.resource));const id=idSchema.parse(req.params.id);
    if(resource.key==='sessions') fail('Используйте отзыв сессий пользователя',405);
    const old=rowData(db,resource.key,id) as Row;
    const writable=resource.fields.filter(f=>!f.readonly).map(f=>f.key);
    const body=z.record(z.string(),z.unknown()).parse(req.body);
    if(!Object.keys(body).length || Object.keys(body).some(k=>!writable.includes(k))) fail('Неизвестное или неизменяемое поле');
    const merged={...old,...body};delete merged.id;delete merged.created_at;
    if(resource.key!=='users' && old.created_at!==undefined) merged.created_at=body.created_at??old.created_at;
    delete merged.password_hash;
    const data=resource.schema.strict().parse(merged) as Row;
    const hash=body.password?await hashPassword(data.password):undefined;
    active(req);
    transaction(db,()=> {
      validateRelations(db,resource.key,data,old);
      if(resource.key==='sensor_states') {recordSensor(db,data.device_id,data.value,(req as any).user.id);return;}
      const changes:Row=Object.fromEntries(Object.keys(body).filter(k=>k!=='password').map(k=>[k,data[k]]));
      if(hash) changes.password_hash=hash;
      if(resource.key==='scene_schedules'&&changes.days!==undefined) {changes.days_mask=daysToMask(changes.days);delete changes.days;}
      const columns=Object.keys(changes);
      if(columns.length) db.prepare(`UPDATE ${resource.key} SET ${columns.map(c=>`${c}=?`).join(',')} WHERE id=?`).run(...columns.map(c=>changes[c]),id);
      if(resource.key==='users' && (hash||body.role!==undefined)) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      if(resource.key==='devices' && data.type_id!==old.type_id) {
        for (const table of stateResources) db.prepare(`DELETE FROM ${table} WHERE device_id=?`).run(id);
        db.prepare('DELETE FROM sensor_readings WHERE device_id=?').run(id);
        const type=requireRow(db,'SELECT * FROM device_types WHERE id=?',data.type_id);initializeDevice(db,id,type.kind,type.sensor_metric);
      }
    });
    res.json(rowData(db,resource.key,id));
  });
  router.delete('/:resource/:id',(req,res)=> {
    const resource=lookup(String(req.params.resource));const id=idSchema.parse(req.params.id);
    if(resource.delete===false||stateResources.includes(resource.key)) fail('Удалите родительское устройство или отзовите сессию',405);
    const old=rowData(db,resource.key,id) as Row;
    if(resource.key==='event_types' && ['system','device','scene','sensor','simulation','security'].includes(old.name)) fail('Системный тип события защищён',409);
    transaction(db,()=> {db.prepare(`DELETE FROM ${resource.key} WHERE id=?`).run(id);});
    res.json({success:true});
  });
  return router;
}
