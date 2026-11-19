import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { hashPassword, randomToken, tokenHash, verifyPassword } from './auth.js';
import { addEvent, createDemoHome, daysToMask, DEVICE_SELECT, EVENT_SELECT, initializeDevice, nowISO, openDatabase, seedDatabase, transaction, type Row } from './database.js';
import { bit, devicePatch, emailSchema, fail, getDevice, HttpError, idSchema, nameSchema, passwordSchema, requireRow, roomPatchSchema, roomSchema, scenePatchSchema, sceneSchema, setProperty, validateProperty, validateSceneActions } from './validation.js';
import { executeScene, getScene, recordSensor, runSchedules, simulateSensors } from './automation.js';
import { adminRouter } from './admin.js';

export interface AppConfig { dbPath?: string; testing?: boolean }
interface AuthRequest extends Request { user?: Row; session?: Row }
const publicUser = (user:Row) => ({id:user.id,name:user.name,email:user.email,role:user.role});
const SESSION_MS = 7*24*60*60*1000;
const COOKIE='doma_session';
const secureEqual=(a:string,b:string) => {const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
function homeAccess(db:DatabaseSync, req:Request, id:number, write=false) {
  const home=requireRow(db,'SELECT * FROM homes WHERE id=?',id);
  const user=(req as AuthRequest).user!;
  if(user.role==='admin') return home;
  const member=db.prepare('SELECT role FROM home_members WHERE home_id=? AND user_id=?').get(id,user.id) as Row|undefined;
  if(!member || (write&&member.role!=='owner')) fail('Нет доступа к этому дому',403);
  return home;
}
function accessibleHomes(db:DatabaseSync,user:Row) {
  return user.role==='admin'?db.prepare('SELECT * FROM homes ORDER BY id').all():db.prepare('SELECT h.* FROM homes h JOIN home_members m ON m.home_id=h.id WHERE m.user_id=? ORDER BY h.id').all(user.id);
}
function writeScene(db:DatabaseSync,id:number,data:Row) {
  db.prepare('DELETE FROM scene_actions WHERE scene_id=?').run(id);
  for(const action of data.actions) db.prepare('INSERT INTO scene_actions(scene_id,device_id,property,value) VALUES(?,?,?,?)').run(id,action.device_id,action.property,action.value);
  if(data.schedule) db.prepare(`INSERT INTO scene_schedules(scene_id,time,days_mask,enabled) VALUES(?,?,?,?) ON CONFLICT(scene_id) DO UPDATE SET time=excluded.time,days_mask=excluded.days_mask,enabled=excluded.enabled`).run(id,data.schedule.time,daysToMask(data.schedule.days),data.schedule.enabled);
  else db.prepare('DELETE FROM scene_schedules WHERE scene_id=?').run(id);
}
function eventQuery(db:DatabaseSync,req:Request,homeId:number) {
  const parsed=z.object({page:z.coerce.number().int().min(1).max(1000000).default(1),search:z.string().max(200).default(''),type:z.string().max(100).default('all'),from:z.string().max(40).default(''),to:z.string().max(40).default('')}).parse(req.query);
  const params:(string|number)[]=[homeId]; const where=['e.home_id=?'];
  if(parsed.search) {where.push("(e.message LIKE ? ESCAPE '\\' OR d.name LIKE ? ESCAPE '\\' OR r.name LIKE ? ESCAPE '\\')");const pattern=`%${parsed.search.replace(/[\\%_]/g,'\\$&')}%`;params.push(pattern,pattern,pattern);}
  if(parsed.type!=='all') {where.push('t.name=?');params.push(parsed.type);}
  const date=(value:string,end=false)=> {
    if(/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const iso=`${value}T${end?'23:59:59.999':'00:00:00.000'}Z`;
      if(new Date(iso).toISOString().slice(0,10)!==value) fail('Некорректная дата');
      return iso;
    }
    z.string().datetime({offset:true}).parse(value);return new Date(value).toISOString();
  };
  const from=parsed.from?date(parsed.from):null,to=parsed.to?date(parsed.to,true):null;
  if(from&&to&&from>to) fail('Начало периода позже окончания');
  if(from) {where.push('e.created_at>=?');params.push(from);} if(to) {where.push('e.created_at<=?');params.push(to);}
  const sql=`${EVENT_SELECT} WHERE ${where.join(' AND ')}`;
  const count=db.prepare(`SELECT count(*) n FROM (${sql})`).get(...params) as Row;
  return {sql,params,total:count.n as number,page:parsed.page};
}
export function csvCell(value:unknown) {
  let text=value==null?'':String(value);
  if(/^[\s]*[=+\-@\t\r]/.test(text)) text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
export function createApp(config:AppConfig={}) {
  const testing=config.testing??false;
  const production=process.env.NODE_ENV==='production';
  const simulation=process.env.ENABLE_SIMULATION!=='false';
  const db=openDatabase(config.dbPath??process.env.DB_PATH??resolve('data/doma.sqlite'));
  try {seedDatabase(db,production);} catch(error) {db.close();throw error;}
  const app=express();
  app.disable('x-powered-by');
  if(process.env.TRUST_PROXY) {
    const value=process.env.TRUST_PROXY;
    if(value==='true') app.set('trust proxy',1);
    else if(/^\d+$/.test(value)) app.set('trust proxy',Number(value));
    else if(value!=='false') {db.close();throw new Error('TRUST_PROXY must be false, true, or a trusted hop count');}
  }
  let publicOrigin:string|undefined;
  if(process.env.PUBLIC_ORIGIN) {
    try {publicOrigin=new URL(process.env.PUBLIC_ORIGIN).origin;} catch {db.close();throw new Error('PUBLIC_ORIGIN must be a valid URL');}
  }
  app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:','https:'],connectSrc:["'self'"],fontSrc:["'self'"],objectSrc:["'none'"],upgradeInsecureRequests:production?[]:null}}}));
  app.use(express.json({limit:'64kb'}));app.use(cookieParser());
  const limiter=(max:number)=>rateLimit({windowMs:15*60*1000,limit:max,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Слишком много запросов. Попробуйте позже.'}});
  app.use('/api',limiter(testing?10000:1000));
  app.use('/api/auth',limiter(testing?10000:60));
  app.use((req:AuthRequest,_res,next)=> {
    const token=req.cookies?.[COOKIE];
    if(typeof token==='string'&&token.length<=100) {
      const session=db.prepare('SELECT s.*,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(tokenHash(token),nowISO()) as Row|undefined;
      if(session) {req.session=session;req.user={id:session.user_id,name:session.name,email:session.email,role:session.role};}
    }
    next();
  });
  const cookieOptions={httpOnly:true,secure:production,sameSite:'lax' as const,path:'/',maxAge:SESSION_MS};
  const issueSession=(req:AuthRequest,res:Response,user:Row)=> {
    const token=randomToken(),csrf=tokenHash('csrf:'+token);
    transaction(db,()=> {
      db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(nowISO());
      if(req.session) db.prepare('DELETE FROM sessions WHERE id=?').run(req.session.id);
      db.prepare('INSERT INTO sessions(user_id,token_hash,csrf_hash,expires_at) VALUES(?,?,?,?)').run(user.id,tokenHash(token),tokenHash(csrf),new Date(Date.now()+SESSION_MS).toISOString());
    });
    res.cookie(COOKIE,token,cookieOptions);res.json({user:publicUser(user),csrf});
  };
  const originGuard=(req:Request,_res:Response,next:NextFunction)=> {
    if(!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const origin=req.get('origin');
      if(req.get('sec-fetch-site')==='cross-site') return next(new HttpError(403,'Запрос с другого сайта запрещён'));
      if(origin) {
        try {const url=new URL(origin);const expected=publicOrigin??`${req.protocol}://${req.get('host')}`;if(url.origin!==expected || origin!==url.origin) return next(new HttpError(403,'Недопустимый источник запроса'));}
        catch {return next(new HttpError(403,'Недопустимый источник запроса'));}
      }
    }
    next();
  };
  app.use('/api',originGuard);
  app.use('/api/auth',(req:AuthRequest,_res,next)=> {
    if(req.session&&!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const csrf=req.get('X-CSRF-Token');
      if(!csrf||!secureEqual(tokenHash(csrf),req.session.csrf_hash)) return next(new HttpError(403,'Некорректный CSRF-токен'));
    }
    next();
  });
  app.get('/api/health',(_req,res)=>res.json({status:'ok'}));
  app.get('/api/auth/me',(req:AuthRequest,res)=> {res.set('Cache-Control','no-store');res.json({user:req.user?publicUser(req.user):null,csrf:req.session?tokenHash('csrf:'+req.cookies[COOKIE]):null});});
  app.post('/api/auth/login',async(req:AuthRequest,res)=> {
    const {email,password}=z.object({email:emailSchema,password:z.string().min(1).max(128)}).strict().parse(req.body);
    const user=db.prepare('SELECT * FROM users WHERE email=?').get(email) as Row|undefined;
    const dummy='scrypt$00000000000000000000000000000000$'+'00'.repeat(64);
    const valid=await verifyPassword(password,user?.password_hash??dummy);
    if(!user||!valid) fail('Неверный email или пароль',401);
    const current=db.prepare('SELECT * FROM users WHERE id=?').get(user!.id) as Row|undefined;
    if(!current||current.password_hash!==user!.password_hash) fail('Неверный email или пароль',401);
    issueSession(req,res,current!);
  });
  app.post('/api/auth/register',async(req:AuthRequest,res)=> {
    const data=z.object({name:nameSchema,email:emailSchema,password:passwordSchema}).strict().parse(req.body);
    const hash=await hashPassword(data.password);
    const user=transaction(db,()=> {
      const id=Number(db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'user')").run(data.name,data.email,hash).lastInsertRowid);
      createDemoHome(db,id);return requireRow(db,'SELECT * FROM users WHERE id=?',id);
    });
    res.status(201);issueSession(req,res,user);
  });
  app.post('/api/auth/demo',(req:AuthRequest,res)=> {
    z.object({}).strict().parse(req.body);
    if(production) fail('Демо-вход отключён',404);
    const user=requireRow(db,'SELECT * FROM users WHERE email=?','alex@doma.local');issueSession(req,res,user);
  });
  app.use('/api',(req:AuthRequest,res,next)=> {
    res.set('Cache-Control','no-store');
    if(!req.user||!req.session) return next(new HttpError(401,'Войдите в аккаунт'));
    if(!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const csrf=req.get('X-CSRF-Token');if(!csrf||!secureEqual(tokenHash(csrf),req.session.csrf_hash)) return next(new HttpError(403,'Некорректный CSRF-токен'));
    }
    next();
  });
  app.post('/api/auth/logout',(req:AuthRequest,res)=> {db.prepare('DELETE FROM sessions WHERE id=?').run(req.session!.id);res.clearCookie(COOKIE,{...cookieOptions,maxAge:undefined});res.json({success:true});});
  app.get('/api/home',(req:AuthRequest,res)=> {
    const homes=accessibleHomes(db,req.user!) as Row[];
    const id=req.query.homeId!==undefined?idSchema.parse(req.query.homeId):homes[0]?.id;
    if(!id) fail('Нет доступного дома',404);
    const home=homeAccess(db,req,id);
    const rooms=db.prepare('SELECT * FROM rooms WHERE home_id=? ORDER BY sort_order,id').all(id);
    const devices=db.prepare(`${DEVICE_SELECT} WHERE r.home_id=? ORDER BY r.sort_order,d.id`).all(id);
    const scenes=(db.prepare('SELECT id FROM scenes WHERE home_id=? ORDER BY id').all(id) as Row[]).map(row=>getScene(db,row.id));
    const events=db.prepare(`${EVENT_SELECT} WHERE e.home_id=? ORDER BY e.created_at DESC,e.id DESC LIMIT 100`).all(id);
    res.json({user:publicUser(req.user!),home,homes,rooms,devices,scenes,events,types:db.prepare('SELECT * FROM device_types ORDER BY id').all(),simulation});
  });
  app.patch('/api/profile',async(req:AuthRequest,res)=> {
    const data=z.object({name:nameSchema,email:emailSchema,password:passwordSchema.optional()}).strict().parse(req.body);
    const hash=data.password?await hashPassword(data.password):undefined;
    if(!db.prepare('SELECT id FROM sessions WHERE id=? AND expires_at>?').get(req.session!.id,nowISO())) fail('Сессия отозвана. Войдите снова.',401);
    transaction(db,()=> {
      db.prepare('UPDATE users SET name=?,email=? WHERE id=?').run(data.name,data.email,req.user!.id);
      if(hash) {db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash,req.user!.id);db.prepare('DELETE FROM sessions WHERE user_id=? AND id!=?').run(req.user!.id,req.session!.id);}
    });
    res.json(publicUser(requireRow(db,'SELECT * FROM users WHERE id=?',req.user!.id)));
  });
  app.patch('/api/homes/:id',(req,res)=> {
    const id=idSchema.parse(req.params.id);homeAccess(db,req,id,true);
    const {name,address}=z.object({name:nameSchema,address:z.string().max(300)}).strict().parse(req.body);
    db.prepare('UPDATE homes SET name=?,address=? WHERE id=?').run(name,address,id);res.json(requireRow(db,'SELECT * FROM homes WHERE id=?',id));
  });
  app.post('/api/homes/:id/rooms',(req,res)=> {
    const homeId=idSchema.parse(req.params.id);homeAccess(db,req,homeId,true);const data=roomSchema.parse(req.body);
    const id=Number(db.prepare('INSERT INTO rooms(home_id,name,icon,image,sort_order) VALUES(?,?,?,?,?)').run(homeId,data.name,data.icon,data.image,data.sort_order).lastInsertRowid);
    res.status(201).json(requireRow(db,'SELECT * FROM rooms WHERE id=?',id));
  });
  app.patch('/api/rooms/:id',(req,res)=> {
    const id=idSchema.parse(req.params.id),old=requireRow(db,'SELECT * FROM rooms WHERE id=?',id);homeAccess(db,req,old.home_id,true);
    const data=roomPatchSchema.parse(req.body);if(!Object.keys(data).length) fail('Нет изменений');
    const columns=Object.keys(data);db.prepare(`UPDATE rooms SET ${columns.map(c=>`${c}=?`).join(',')} WHERE id=?`).run(...columns.map(c=>(data as Row)[c]),id);
    res.json(requireRow(db,'SELECT * FROM rooms WHERE id=?',id));
  });
  app.delete('/api/rooms/:id',(req:AuthRequest,res)=> {
    const id=idSchema.parse(req.params.id),room=requireRow(db,'SELECT * FROM rooms WHERE id=?',id);homeAccess(db,req,room.home_id,true);
    transaction(db,()=> {db.prepare('DELETE FROM rooms WHERE id=?').run(id);addEvent(db,room.home_id,`Комната «${room.name}» удалена`,'system',null,req.user!.id);});res.json({success:true});
  });
  app.post('/api/homes/:id/devices',(req:AuthRequest,res)=> {
    const homeId=idSchema.parse(req.params.id);homeAccess(db,req,homeId,true);
    const data=z.object({name:nameSchema,room_id:z.number().int().positive(),type_id:z.number().int().positive()}).strict().parse(req.body);
    const room=requireRow(db,'SELECT * FROM rooms WHERE id=?',data.room_id);if(room.home_id!==homeId) fail('Комната принадлежит другому дому',403);
    const type=requireRow(db,'SELECT * FROM device_types WHERE id=?',data.type_id);
    const id=transaction(db,()=> {const id=Number(db.prepare('INSERT INTO devices(room_id,type_id,name) VALUES(?,?,?)').run(data.room_id,data.type_id,data.name).lastInsertRowid);initializeDevice(db,id,type.kind,type.sensor_metric);addEvent(db,homeId,`Добавлено устройство «${data.name}»`,'device',id,req.user!.id);return id;});
    res.status(201).json(getDevice(db,id));
  });
  app.patch('/api/devices/:id',(req:AuthRequest,res)=> {
    const id=idSchema.parse(req.params.id),device=getDevice(db,id);homeAccess(db,req,device.home_id,true);
    const data=devicePatch.parse(req.body) as Row;
    if(data.room_id!==undefined && requireRow(db,'SELECT * FROM rooms WHERE id=?',data.room_id).home_id!==device.home_id) fail('Комната принадлежит другому дому',403);
    const properties=Object.keys(data).filter(k=>!['name','room_id','online'].includes(k));
    for(const property of properties) validateProperty(device.kind,property,data[property]);
    if(properties.length&&!device.online) fail('Устройство не в сети',409);
    transaction(db,()=> {
      for(const column of ['name','room_id','online']) if(data[column]!==undefined) db.prepare(`UPDATE devices SET ${column}=? WHERE id=?`).run(data[column],id);
      for(const property of properties) setProperty(db,device,property,data[property]);
      addEvent(db,device.home_id,`Устройство «${device.name}»: ${Object.entries(data).map(([k,v])=>`${k} = ${v}`).join(', ')}`,'device',id,req.user!.id);
    });res.json(getDevice(db,id));
  });
  app.delete('/api/devices/:id',(req:AuthRequest,res)=> {
    const id=idSchema.parse(req.params.id),device=getDevice(db,id);homeAccess(db,req,device.home_id,true);
    transaction(db,()=> {db.prepare('DELETE FROM devices WHERE id=?').run(id);addEvent(db,device.home_id,`Удалено устройство «${device.name}»`,'device',null,req.user!.id);});res.json({success:true});
  });
  app.get('/api/devices/:id/readings',(req,res)=> {
    const id=idSchema.parse(req.params.id),device=getDevice(db,id);homeAccess(db,req,device.home_id);
    if(device.kind!=='sensor') fail('Устройство не является датчиком');
    res.json(db.prepare('SELECT * FROM (SELECT * FROM sensor_readings WHERE device_id=? ORDER BY id DESC LIMIT 240) ORDER BY created_at,id').all(id));
  });
  app.post('/api/devices/:id/simulate',(req:AuthRequest,res)=> {
    if(!simulation) fail('Симуляция отключена',403);
    const id=idSchema.parse(req.params.id),device=getDevice(db,id);homeAccess(db,req,device.home_id,true);
    const {value}=z.object({value:z.number()}).strict().parse(req.body);
    transaction(db,()=>recordSensor(db,id,value,req.user!.id));res.json({success:true});
  });
  app.post('/api/homes/:id/scenes',(req:AuthRequest,res)=> {
    const homeId=idSchema.parse(req.params.id);homeAccess(db,req,homeId,true);const data=sceneSchema.parse(req.body);validateSceneActions(db,homeId,data.actions);
    const id=transaction(db,()=> {const id=Number(db.prepare('INSERT INTO scenes(home_id,name,description,icon,color) VALUES(?,?,?,?,?)').run(homeId,data.name,data.description,data.icon,data.color).lastInsertRowid);writeScene(db,id,data);addEvent(db,homeId,`Создан сценарий «${data.name}»`,'scene',null,req.user!.id);return id;});res.status(201).json(getScene(db,id));
  });
  app.patch('/api/scenes/:id',(req,res)=> {
    const id=idSchema.parse(req.params.id),old=getScene(db,id);homeAccess(db,req,old.home_id,true);
    const patch=scenePatchSchema.parse(req.body);if(!Object.keys(patch).length) fail('Нет изменений');
    const {id:_id,home_id:_homeId,last_run:_lastRun,...editable}=old;
    const data=sceneSchema.parse({...editable,...patch});
    validateSceneActions(db,old.home_id,data.actions);
    transaction(db,()=> {db.prepare('UPDATE scenes SET name=?,description=?,icon=?,color=? WHERE id=?').run(data.name,data.description,data.icon,data.color,id);writeScene(db,id,data);});res.json(getScene(db,id));
  });
  app.delete('/api/scenes/:id',(req,res)=> {const id=idSchema.parse(req.params.id),scene=getScene(db,id);homeAccess(db,req,scene.home_id,true);db.prepare('DELETE FROM scenes WHERE id=?').run(id);res.json({success:true});});
  app.post('/api/scenes/:id/run',(req:AuthRequest,res)=> {const id=idSchema.parse(req.params.id),scene=getScene(db,id);homeAccess(db,req,scene.home_id,true);z.object({}).strict().parse(req.body);res.json(executeScene(db,id,req.user!.id));});
  app.get('/api/homes/:id/events',(req,res)=> {
    const id=idSchema.parse(req.params.id);homeAccess(db,req,id);const query=eventQuery(db,req,id);const size=20;
    res.json({items:db.prepare(`${query.sql} ORDER BY e.created_at DESC,e.id DESC LIMIT ? OFFSET ?`).all(...query.params,size,(query.page-1)*size),total:query.total,page:query.page,pages:Math.max(1,Math.ceil(query.total/size))});
  });
  app.get('/api/homes/:id/events/export',(req,res)=> {
    const id=idSchema.parse(req.params.id);homeAccess(db,req,id);const query=eventQuery(db,req,id);
    const rows=db.prepare(`${query.sql} ORDER BY e.created_at DESC,e.id DESC`).all(...query.params) as Row[];
    const columns=['created_at','type','severity','room_name','device_name','user_name','message'];
    const csv='\uFEFF'+[columns.map(csvCell).join(','),...rows.map(row=>columns.map(c=>csvCell(row[c])).join(','))].join('\r\n');
    res.type('text/csv').set('Content-Disposition',`attachment; filename="doma-events-${id}.csv"`).send(csv);
  });
  app.use('/api/admin',adminRouter(db));
  app.use('/api',(_req,_res,next)=>next(new HttpError(404,'Маршрут не найден')));
  app.use((error:any,_req:Request,res:Response,_next:NextFunction)=> {
    if(error instanceof z.ZodError) {const fields:Record<string,string>={};for(const issue of error.issues) fields[issue.path.join('.')||'form']=issue.message;res.status(400).json({error:'Проверьте введённые данные',fields});return;}
    if(error instanceof HttpError || (Number.isInteger(error.status)&&error.status>=400&&error.status<500)) {res.status(error.status).json({error:error.message});return;}
    const message=String(error?.message??'');
    if(/UNIQUE constraint failed/.test(message)) {res.status(409).json({error:'Такая запись уже существует'});return;}
    if(/FOREIGN KEY constraint failed/.test(message)) {res.status(409).json({error:'Запись используется в связанных данных. Сначала удалите связи.'});return;}
    if(/CHECK constraint failed|NOT NULL constraint failed/.test(message)) {res.status(400).json({error:'Данные нарушают ограничения базы'});return;}
    if(/Cannot (delete|demote|remove) the last/.test(message)) {res.status(409).json({error:message});return;}
    if(!testing) console.error('API error',error);
    res.status(500).json({error:'Внутренняя ошибка сервера'});
  });
  let timer:ReturnType<typeof setInterval>|undefined;
  if(!testing) {
    const tick=()=> {try {runSchedules(db);if(simulation) simulateSensors(db);db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(nowISO());} catch(error) {console.error('Automation error',error);}};
    timer=setInterval(tick,60_000);timer.unref();
  }
  app.locals.db=db;
  app.locals.runSchedules=(at?:Date)=>runSchedules(db,at);
  app.locals.simulateSensors=(at?:Date)=>simulateSensors(db,at);
  let closed=false;
  app.locals.close=()=> {if(closed)return;closed=true;if(timer)clearInterval(timer);db.close();};
  return app;
}
export default createApp;
