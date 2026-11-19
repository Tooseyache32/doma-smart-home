import assert from 'node:assert/strict';
import { test } from 'node:test';
import supertest from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, csvCell } from '../server/app.js';
import { simulateSensors } from '../server/automation.js';
import { daysToMask, maskToDays } from '../server/database.js';
import { hashPassword } from '../server/auth.js';

async function fixture(fn:(app:ReturnType<typeof createApp>,request:ReturnType<typeof supertest>)=>Promise<void>) {
  const app=createApp({dbPath:':memory:',testing:true});
  try {await fn(app,supertest(app));} finally {app.locals.close();}
}
async function login(request:ReturnType<typeof supertest>,admin=false) {
  const result=await request.post('/api/auth/login').send({email:admin?'admin@doma.local':'alex@doma.local',password:admin?'DomaAdmin2026!':'DomaHome2026!'}).expect(200);
  return {cookie:result.headers['set-cookie'][0].split(';')[0],csrf:result.body.csrf,user:result.body.user};
}
function auth(request:ReturnType<typeof supertest>,method:'get'|'post'|'patch'|'delete',path:string,session:{cookie:string;csrf:string}) {
  return request[method](path).set('Cookie',session.cookie).set('X-CSRF-Token',session.csrf);
}

test('health and guest auth do not expose home data',()=>fixture(async(_app,request)=> {
  await request.get('/api/health').expect(200,{status:'ok'});
  await request.get('/api/auth/me').expect(200,{user:null,csrf:null});
  await request.get('/api/home').expect(401);
  await request.get('/api/homes/1/events/export').expect(401);
  await request.post('/api/auth/login').send({email:'alex@doma.local',password:'wrong'}).expect(401);
  await request.post('/api/auth/login').send({email:'none@doma.local',password:'wrong'}).expect(401);
}));

test('scrypt password storage, hashed random sessions, cookies and logout',()=>fixture(async(app,request)=> {
  const a=await login(request),b=await login(request);
  assert.notEqual(a.cookie,b.cookie);assert.notEqual(a.csrf,b.csrf);
  const stored=app.locals.db.prepare('SELECT * FROM sessions ORDER BY id LIMIT 1').get();
  assert.equal(stored.token_hash.length,64);assert.ok(!stored.token_hash.includes(a.cookie.split('=')[1]));
  assert.equal(stored.csrf_hash.length,64);assert.notEqual(stored.csrf_hash,a.csrf);assert.equal(stored.csrf_token,undefined);
  const password=app.locals.db.prepare("SELECT password_hash FROM users WHERE email='alex@doma.local'").get().password_hash;
  assert.match(password,/^scrypt\$/);assert.ok(!password.includes('DomaHome2026!'));
  const me=await auth(request,'get','/api/auth/me',a).expect(200);assert.equal(me.body.user.email,'alex@doma.local');assert.equal(me.body.csrf,a.csrf);
  await request.post('/api/auth/logout').set('Cookie',a.cookie).send({}).expect(403);
  await auth(request,'post','/api/auth/logout',a).send({}).expect(200);
  await auth(request,'get','/api/home',a).expect(401);
  await auth(request,'get','/api/home',b).expect(200);
}));

test('CSRF and cross-site origin are checked on all authenticated writes',()=>fixture(async(_app,request)=> {
  const a=await login(request);const home=(await auth(request,'get','/api/home',a)).body.home;
  await request.patch(`/api/homes/${home.id}`).set('Cookie',a.cookie).send({name:'H',address:''}).expect(403);
  await request.patch(`/api/homes/${home.id}`).set('Cookie',a.cookie).set('X-CSRF-Token','wrong').send({name:'H',address:''}).expect(403);
  await auth(request,'patch',`/api/homes/${home.id}`,a).set('Origin','https://evil.example').send({name:'H',address:''}).expect(403);
  await request.post('/api/auth/demo').set('Origin','https://evil.example').send({}).expect(403);
  await auth(request,'patch',`/api/homes/${home.id}`,a).set('Sec-Fetch-Site','cross-site').send({name:'H',address:''}).expect(403);
}));

test('registration creates a private full home and rejects mass assignment',()=>fixture(async(_app,request)=> {
  await request.post('/api/auth/register').send({name:'N',email:'n@example.com',password:'LongPassword123!',role:'admin'}).expect(400);
  const result=await request.post('/api/auth/register').send({name:'  Анна  ',email:'ANNA@EXAMPLE.COM',password:'LongPassword123!'}).expect(201);
  assert.equal(result.body.user.name,'Анна');assert.equal(result.body.user.role,'user');assert.equal(result.body.user.email,'anna@example.com');
  const a={cookie:result.headers['set-cookie'][0].split(';')[0],csrf:result.body.csrf};
  const home=(await auth(request,'get','/api/home',a)).body;
  assert.equal(home.homes.length,1);assert.equal(home.rooms.length,4);assert.ok(home.devices.length>=12);assert.equal(home.scenes.length,4);
  assert.equal(home.devices.filter((d:any)=>d.kind==='sensor').length,6);
  await auth(request,'get','/api/home?homeId=1',a).expect(403);
  await request.post('/api/auth/register').send({name:'Other',email:'anna@example.com',password:'LongPassword123!'}).expect(409);
  await auth(request,'get','/api/admin',a).expect(403);
}));

test('cross-home reads, writes, nested FKs, scenes, sensors and export are forbidden',()=>fixture(async(_app,request)=> {
  const a=await login(request),admin=await login(request,true);
  const own=(await auth(request,'get','/api/home',a)).body;
  const other=(await auth(request,'get','/api/home?homeId=1',admin)).body;
  await auth(request,'get','/api/home?homeId=1',a).expect(403);
  await auth(request,'patch',`/api/rooms/${other.rooms[0].id}`,a).send({name:'X'}).expect(403);
  await auth(request,'delete',`/api/devices/${other.devices[0].id}`,a).expect(403);
  await auth(request,'post',`/api/scenes/${other.scenes[0].id}/run`,a).send({}).expect(403);
  await auth(request,'get',`/api/devices/${other.devices.find((d:any)=>d.kind==='sensor').id}/readings`,a).expect(403);
  await auth(request,'get','/api/homes/1/events',a).expect(403);
  await auth(request,'get','/api/homes/1/events/export',a).expect(403);
  await auth(request,'post',`/api/homes/${own.home.id}/devices`,a).send({name:'Wrong',room_id:other.rooms[0].id,type_id:own.types[0].id}).expect(403);
  await auth(request,'patch',`/api/devices/${own.devices[0].id}`,a).send({room_id:other.rooms[0].id}).expect(403);
  await auth(request,'post',`/api/homes/${own.home.id}/scenes`,a).send({name:'Wrong',actions:[{device_id:other.devices[0].id,property:'power',value:'1'}],schedule:null}).expect(403);
}));

test('owners have room and device CRUD with ranges and kind enforcement',()=>fixture(async(_app,request)=> {
  const a=await login(request),snapshot=(await auth(request,'get','/api/home',a)).body,id=snapshot.home.id;
  await auth(request,'patch',`/api/homes/${id}`,a).send({name:'Тёплый дом',address:'Новый адрес'}).expect(200);
  const room=(await auth(request,'post',`/api/homes/${id}/rooms`,a).send({name:'Балкон',icon:'leaf',image:'/images/office.jpg',sort_order:6}).expect(201)).body;
  const renamed=(await auth(request,'patch',`/api/rooms/${room.id}`,a).send({name:'Лоджия'}).expect(200)).body;assert.equal(renamed.icon,'leaf');assert.equal(renamed.image,'/images/office.jpg');assert.equal(renamed.sort_order,6);
  await auth(request,'patch',`/api/rooms/${room.id}`,a).send({sort_order:8}).expect(200);
  await auth(request,'patch',`/api/rooms/${room.id}`,a).send({home_id:1}).expect(400);
  const light=(await auth(request,'post',`/api/homes/${id}/devices`,a).send({name:'Свет',room_id:room.id,type_id:snapshot.types.find((t:any)=>t.kind==='light').id}).expect(201)).body;
  assert.equal(light.brightness,70);assert.equal(light.target_temp,null);
  const updated=(await auth(request,'patch',`/api/devices/${light.id}`,a).send({name:'Лампа',power:1,brightness:25,color_temp:3000}).expect(200)).body;
  assert.equal(updated.brightness,25);assert.equal(updated.power,1);
  for(const body of [{brightness:101},{brightness:-1},{color_temp:9000},{target_temp:22},{power:2},{brightness:'50'},{online:7},{unexpected:1}]) await auth(request,'patch',`/api/devices/${light.id}`,a).send(body).expect(400);
  const climate=snapshot.devices.find((d:any)=>d.kind==='climate');
  await auth(request,'patch',`/api/devices/${climate.id}`,a).send({target_temp:24.5,mode:'cool'}).expect(200);
  await auth(request,'patch',`/api/devices/${climate.id}`,a).send({mode:'invalid'}).expect(400);
  await auth(request,'patch',`/api/devices/${climate.id}`,a).send({brightness:50}).expect(400);
  await auth(request,'patch',`/api/devices/${light.id}`,a).send({online:0}).expect(200);
  await auth(request,'patch',`/api/devices/${light.id}`,a).send({power:0}).expect(409);
  await auth(request,'delete',`/api/devices/${light.id}`,a).expect(200);
  await auth(request,'delete',`/api/rooms/${room.id}`,a).expect(200);
  await auth(request,'delete',`/api/rooms/${room.id}`,a).expect(404);
}));

test('scene CRUD validates all actions and schedules; execution is atomic and logged',()=>fixture(async(app,request)=> {
  const a=await login(request),s=(await auth(request,'get','/api/home',a)).body,light=s.devices.find((d:any)=>d.kind==='light'),climate=s.devices.find((d:any)=>d.kind==='climate');
  const body={name:'Тест',description:'Полный сценарий',icon:'film',color:'#ABCDEF',actions:[{device_id:light.id,property:'brightness',value:'34'},{device_id:climate.id,property:'target_temp',value:'24'}],schedule:{time:'23:15',days:'0,1,6',enabled:1}};
  for(const schedule of [{time:'24:00',days:'1',enabled:1},{time:'12:60',days:'1',enabled:1},{time:'12:00',days:'7',enabled:1},{time:'12:00',days:'1,1',enabled:1}]) await auth(request,'post',`/api/homes/${s.home.id}/scenes`,a).send({...body,schedule}).expect(400);
  await auth(request,'post',`/api/homes/${s.home.id}/scenes`,a).send({...body,actions:[{device_id:light.id,property:'brightness',value:'Infinity'}]}).expect(400);
  await auth(request,'post',`/api/homes/${s.home.id}/scenes`,a).send({...body,actions:[{device_id:light.id,property:'mode',value:'auto'}]}).expect(400);
  await auth(request,'post',`/api/homes/${s.home.id}/scenes`,a).send({...body,actions:[body.actions[0],body.actions[0]]}).expect(400);
  const scene=(await auth(request,'post',`/api/homes/${s.home.id}/scenes`,a).send(body).expect(201)).body;
  const edited=(await auth(request,'patch',`/api/scenes/${scene.id}`,a).send({name:'Новое имя'}).expect(200)).body;
  assert.equal(edited.name,'Новое имя');assert.equal(edited.actions.length,2);assert.equal(edited.icon,'film');assert.equal(edited.color,'#ABCDEF');assert.equal(edited.description,'Полный сценарий');assert.equal(edited.schedule.time,'23:15');
  const before=app.locals.db.prepare('SELECT brightness FROM light_states WHERE device_id=?').get(light.id).brightness;
  await auth(request,'patch',`/api/devices/${climate.id}`,a).send({online:0}).expect(200);
  const eventsBefore=app.locals.db.prepare('SELECT count(*) n FROM events').get().n;
  await auth(request,'post',`/api/scenes/${scene.id}/run`,a).send({}).expect(409);
  assert.equal(app.locals.db.prepare('SELECT brightness FROM light_states WHERE device_id=?').get(light.id).brightness,before);
  assert.equal(app.locals.db.prepare('SELECT count(*) n FROM events').get().n,eventsBefore);
  assert.equal(app.locals.db.prepare('SELECT last_run FROM scenes WHERE id=?').get(scene.id).last_run,null);
  await auth(request,'patch',`/api/devices/${climate.id}`,a).send({online:1}).expect(200);
  const run=(await auth(request,'post',`/api/scenes/${scene.id}/run`,a).send({}).expect(200)).body;assert.ok(run.last_run);
  assert.equal(app.locals.db.prepare('SELECT brightness FROM light_states WHERE device_id=?').get(light.id).brightness,34);
  assert.equal(app.locals.db.prepare('SELECT target_temp FROM climate_states WHERE device_id=?').get(climate.id).target_temp,24);
  await auth(request,'delete',`/api/devices/${light.id}`,a).expect(409);
  await auth(request,'delete',`/api/scenes/${scene.id}`,a).expect(200);
}));

test('scheduler follows weekdays, disabled state and persistent once-per-minute dedup',async()=> {
  const dir=mkdtempSync(join(tmpdir(),'doma-schedule-'));const dbPath=join(dir,'test.sqlite');
  let app=createApp({dbPath,testing:true});
  try {
    const request=supertest(app),a=await login(request),s=(await auth(request,'get','/api/home',a)).body;
    const at=new Date(2026,10,16,13,42,10),time='13:42';
    const scene=(await auth(request,'post',`/api/homes/${s.home.id}/scenes`,a).send({name:'По времени',actions:[{device_id:s.devices[0].id,property:'power',value:'1'}],schedule:{time,days:String(at.getDay()),enabled:1}}).expect(201)).body;
    assert.deepEqual(app.locals.runSchedules(at).ran,[scene.id]);
    assert.deepEqual(app.locals.runSchedules(new Date(at.getTime()+20_000)).ran,[]);
    app.locals.close();app=createApp({dbPath,testing:true});
    assert.deepEqual(app.locals.runSchedules(at).ran,[]);
    assert.deepEqual(app.locals.runSchedules(new Date(2026,10,17,13,42)).ran,[]);
    assert.deepEqual(app.locals.runSchedules(new Date(2026,10,23,13,42)).ran,[scene.id]);
    app.locals.db.prepare('UPDATE scene_schedules SET enabled=0 WHERE scene_id=?').run(scene.id);
    assert.deepEqual(app.locals.runSchedules(new Date(2026,10,30,13,42)).ran,[]);
  } finally {app.locals.close();rmSync(dir,{recursive:true,force:true});}
});

test('virtual sensors validate metrics, persist readings and distinguish simulation events',()=>fixture(async(app,request)=> {
  const a=await login(request),s=(await auth(request,'get','/api/home',a)).body;
  for(const metric of ['temp','humidity','co2','motion','contact','leak']) {
    const device=s.devices.find((d:any)=>d.sensor_metric===metric),value=metric==='temp'?24:metric==='humidity'?52:metric==='co2'?1200:1;
    await auth(request,'post',`/api/devices/${device.id}/simulate`,a).send({value}).expect(200);
    const readings=(await auth(request,'get',`/api/devices/${device.id}/readings`,a).expect(200)).body;assert.equal(readings.at(-1).value,value);
    await auth(request,'post',`/api/devices/${device.id}/simulate`,a).send({value:metric==='co2'?10001:metric==='temp'?100:101}).expect(400);
    await auth(request,'patch',`/api/devices/${device.id}`,a).send({power:1}).expect(400);
  }
  const motion=s.devices.find((d:any)=>d.sensor_metric==='motion');
  await auth(request,'post',`/api/devices/${motion.id}/simulate`,a).send({value:.5}).expect(400);
  const initial=app.locals.db.prepare('SELECT value FROM sensor_states WHERE device_id=?').get(s.devices.find((d:any)=>d.sensor_metric==='temp').id).value;
  simulateSensors(app.locals.db,new Date(),()=>.5);
  const next=app.locals.db.prepare('SELECT value FROM sensor_states WHERE device_id=?').get(s.devices.find((d:any)=>d.sensor_metric==='temp').id).value;
  assert.ok(Math.abs(next-initial)<=.1);
  const events=(await auth(request,'get',`/api/homes/${s.home.id}/events?search=${encodeURIComponent('Симуляция')}`,a)).body;assert.ok(events.total>=6);
}));

test('events search/filter/pagination/date/export use bound SQL and escaped CSV',()=>fixture(async(_app,request)=> {
  const a=await login(request),admin=await login(request,true),s=(await auth(request,'get','/api/home',a)).body;
  const types=(await auth(request,'get','/api/admin',admin)).body.resources.find((r:any)=>r.key==='event_types').rows;
  for(let i=0;i<23;i++) await auth(request,'post','/api/admin/events',admin).send({home_id:s.home.id,type_id:types.find((t:any)=>t.name==='system').id,message:i===0?'=HYPERLINK("evil")':'Unique Marker '+i,created_at:'2026-11-16T12:00:00.000Z'}).expect(201);
  const page=(await auth(request,'get',`/api/homes/${s.home.id}/events?search=Unique%20Marker&page=2&type=system&from=2026-11-16&to=2026-11-16`,a).expect(200)).body;
  assert.equal(page.total,22);assert.equal(page.items.length,2);assert.equal(page.pages,2);
  await auth(request,'get',`/api/homes/${s.home.id}/events?page=-1`,a).expect(400);
  await auth(request,'get',`/api/homes/${s.home.id}/events?from=bad`,a).expect(400);
  await auth(request,'get',`/api/homes/${s.home.id}/events?from=2026-11-17&to=2026-11-16`,a).expect(400);
  assert.equal((await auth(request,'get',`/api/homes/${s.home.id}/events?search=%27%20OR%201=1--`,a)).body.total,0);
  const csv=await auth(request,'get',`/api/homes/${s.home.id}/events/export?search=HYPERLINK`,a).expect(200);
  assert.match(csv.headers['content-type'],/text\/csv/);assert.ok(csv.text.includes("' =HYPERLINK".replace("' ","'")));assert.ok(csv.text.includes('""evil""'));
  assert.equal(csvCell('@SUM(1)'), '"\'@SUM(1)"');
  assert.equal(csvCell('  =2+2'),'"\'  =2+2"');
}));

test('all admin resources metadata are available with no hashes or raw session secrets',()=>fixture(async(_app,request)=> {
  const admin=await login(request,true),result=(await auth(request,'get','/api/admin',admin).expect(200)).body;
  assert.equal(result.resources.length,16);assert.ok(result.stats.users>=2);
  const json=JSON.stringify(result);assert.ok(!json.includes('password_hash'));assert.ok(!json.includes('token_hash'));assert.ok(!json.includes('csrf_token'));assert.ok(!json.includes('scrypt$'));
  assert.ok(result.resources.find((r:any)=>r.key==='devices').fields.find((f:any)=>f.key==='room_id').options.length>=8);
  await auth(request,'post','/api/admin/evil_table',admin).send({name:'x'}).expect(404);
  await auth(request,'patch','/api/admin/users/1',admin).send({password_hash:'x'}).expect(400);
  await auth(request,'post','/api/admin/sessions',admin).send({}).expect(405);
  await auth(request,'post','/api/admin/rooms',admin).send({home_id:9999,name:'x'}).expect(404);
}));

test('admin whitelist CRUD, state safety, FK guards, last admin and owner protections',()=>fixture(async(_app,request)=> {
  const admin=await login(request,true);
  const user=(await auth(request,'post','/api/admin/users',admin).send({name:'Иван',email:'ivan@example.com',password:'LongPassword123!',role:'user'}).expect(201)).body;
  const home=(await auth(request,'post','/api/admin/homes',admin).send({name:'Отдельный дом',address:''}).expect(201)).body;
  const data=(await auth(request,'get','/api/admin',admin)).body;
  const owner=data.resources.find((r:any)=>r.key==='home_members').rows.find((m:any)=>m.home_id===home.id);
  await auth(request,'delete',`/api/admin/home_members/${owner.id}`,admin).expect(409);
  await auth(request,'patch',`/api/admin/home_members/${owner.id}`,admin).send({role:'member'}).expect(409);
  await auth(request,'delete','/api/admin/users/1',admin).expect(409);
  await auth(request,'patch','/api/admin/users/1',admin).send({role:'user'}).expect(409);
  const second=(await auth(request,'post','/api/admin/home_members',admin).send({home_id:home.id,user_id:user.id,role:'owner'}).expect(201)).body;
  await auth(request,'delete',`/api/admin/home_members/${owner.id}`,admin).expect(200);
  await auth(request,'delete',`/api/admin/users/${user.id}`,admin).expect(409);
  const room=(await auth(request,'post','/api/admin/rooms',admin).send({name:'Тестовая',home_id:home.id}).expect(201)).body;
  const type=data.resources.find((r:any)=>r.key==='device_types').rows.find((t:any)=>t.kind==='light');
  const device=(await auth(request,'post','/api/admin/devices',admin).send({name:'Тест',room_id:room.id,type_id:type.id}).expect(201)).body;
  await auth(request,'delete',`/api/admin/device_types/${type.id}`,admin).expect(409);
  await auth(request,'patch',`/api/admin/device_types/${type.id}`,admin).send({kind:'sensor',sensor_metric:'temp',unit:'°C'}).expect(409);
  const state=(await auth(request,'get','/api/admin',admin)).body.resources.find((r:any)=>r.key==='light_states').rows.find((l:any)=>l.device_id===device.id);
  await auth(request,'patch',`/api/admin/light_states/${state.id}`,admin).send({brightness:42}).expect(200);
  await auth(request,'patch',`/api/admin/light_states/${state.id}`,admin).send({device_id:1}).expect(400);
  await auth(request,'delete',`/api/admin/light_states/${state.id}`,admin).expect(405);
  await auth(request,'patch',`/api/admin/users/${user.id}`,admin).send({name:'Иван Новый'}).expect(200);
  await auth(request,'delete',`/api/admin/homes/${home.id}`,admin).expect(200);
  await auth(request,'delete',`/api/admin/users/${user.id}`,admin).expect(200);
}));

test('admin password reset and session revoke invalidate sessions; profile reset preserves current only',()=>fixture(async(_app,request)=> {
  const admin=await login(request,true),a=await login(request),b=await login(request);
  await auth(request,'patch','/api/profile',a).send({name:'Александр',email:'alex@doma.local',password:'ChangedPassword2026!'}).expect(200);
  await auth(request,'get','/api/home',b).expect(401);await auth(request,'get','/api/home',a).expect(200);
  await auth(request,'post',`/api/admin/users/${a.user.id}/password`,admin).send({password:'ResetPassword2026!'}).expect(200);
  await auth(request,'get','/api/home',a).expect(401);
  const result=await request.post('/api/auth/login').send({email:'alex@doma.local',password:'ResetPassword2026!'}).expect(200);
  const c={cookie:result.headers['set-cookie'][0].split(';')[0],csrf:result.body.csrf};
  await auth(request,'post',`/api/admin/users/${a.user.id}/revoke`,admin).send({}).expect(200);
  await auth(request,'get','/api/home',c).expect(401);
}));

test('member can read but only owner/admin can mutate; admin sees every home',()=>fixture(async(_app,request)=> {
  const admin=await login(request,true),a=await login(request),s=(await auth(request,'get','/api/home',a)).body;
  const registered=await request.post('/api/auth/register').send({name:'Viewer',email:'viewer@example.com',password:'ViewerPassword2026!'}).expect(201);
  const viewer={cookie:registered.headers['set-cookie'][0].split(';')[0],csrf:registered.body.csrf};
  await auth(request,'post','/api/admin/home_members',admin).send({home_id:s.home.id,user_id:registered.body.user.id,role:'member'}).expect(201);
  await auth(request,'get',`/api/home?homeId=${s.home.id}`,viewer).expect(200);
  await auth(request,'patch',`/api/devices/${s.devices[0].id}`,viewer).send({power:1}).expect(403);
  const snapshot=(await auth(request,'get','/api/home',admin)).body;assert.equal(snapshot.homes.length,3);
}));

test('SQLite schema is 16 normalized FK tables and database constraints protect ranges',()=>fixture(async(app,_request)=> {
  const tables=app.locals.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();assert.equal(tables.length,16);
  assert.equal(app.locals.db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
  assert.deepEqual(app.locals.db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.throws(()=>app.locals.db.prepare('UPDATE light_states SET brightness=999').run());
  assert.throws(()=>app.locals.db.prepare("UPDATE device_types SET kind='unknown'").run());
  assert.throws(()=>app.locals.db.prepare("INSERT INTO devices(room_id,type_id,name) VALUES(999999,1,'Invalid')").run());
}));

test('legacy CSRF schema migration revokes sessions without losing business data',async()=> {
  const dir=mkdtempSync(join(tmpdir(),'doma-migration-')),dbPath=join(dir,'legacy.sqlite');
  let app=createApp({dbPath,testing:true});
  try {
    await login(supertest(app));
    const before=app.locals.db.prepare('SELECT count(*) n FROM devices').get().n;
    app.locals.db.exec('ALTER TABLE sessions RENAME COLUMN csrf_hash TO csrf_token');
    app.locals.close();app=createApp({dbPath,testing:true});
    assert.equal(app.locals.db.prepare('SELECT count(*) n FROM sessions').get().n,0);
    assert.equal(app.locals.db.prepare('SELECT count(*) n FROM devices').get().n,before);
    assert.ok(app.locals.db.prepare('PRAGMA table_info(sessions)').all().some((column:any)=>column.name==='csrf_hash'));
    await login(supertest(app));
  } finally {app.locals.close();rmSync(dir,{recursive:true,force:true});}
});

test('admin accepts form optional nulls and local datetimes, enforces cross-home action safety',()=>fixture(async(_app,request)=> {
  const admin=await login(request,true),s=(await auth(request,'get','/api/home?homeId=2',admin)).body;
  const home=(await auth(request,'post','/api/admin/homes',admin).send({name:'Без адреса',address:null}).expect(201)).body;assert.equal(home.address,'');
  const scene=(await auth(request,'post','/api/admin/scenes',admin).send({home_id:home.id,name:'Пустой',description:null,icon:'sun',color:'#AABBCC'}).expect(201)).body;assert.equal(scene.description,'');
  await auth(request,'post','/api/admin/scene_actions',admin).send({scene_id:scene.id,device_id:s.devices[0].id,property:'power',value:'1'}).expect(400);
  const metadata=(await auth(request,'get','/api/admin',admin)).body;
  const eventType=metadata.resources.find((r:any)=>r.key==='event_types').rows[0].id;
  const event=(await auth(request,'post','/api/admin/events',admin).send({home_id:home.id,device_id:null,user_id:null,type_id:eventType,message:'Local date',created_at:'2026-11-16T14:30'}).expect(201)).body;assert.match(event.created_at,/Z$/);
  await auth(request,'patch',`/api/admin/events/${event.id}`,admin).send({created_at:'2026-11-16T15:30'}).expect(200);
  const sensor=s.devices.find((d:any)=>d.sensor_metric==='humidity'),state=metadata.resources.find((r:any)=>r.key==='sensor_states').rows.find((r:any)=>r.device_id===sensor.id);
  await auth(request,'patch',`/api/admin/sensor_states/${state.id}`,admin).send({value:53}).expect(200);
  await auth(request,'post','/api/admin/sensor_readings',admin).send({device_id:sensor.id,value:54,created_at:'2026-11-16T15:30'}).expect(201);
  await auth(request,'post','/api/admin/sensor_readings',admin).send({device_id:sensor.id,value:101,created_at:'2026-11-16T15:30'}).expect(400);
  await auth(request,'delete',`/api/admin/homes/${home.id}`,admin).expect(200);
}));

test('expired sessions are rejected and authenticated login requires CSRF',()=>fixture(async(app,request)=> {
  const a=await login(request);
  await request.post('/api/auth/demo').set('Cookie',a.cookie).send({}).expect(403);
  await auth(request,'post','/api/auth/demo',a).send({}).expect(200);
  const b=await login(request);
  app.locals.db.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z'").run();
  await auth(request,'get','/api/home',b).expect(401);
  await auth(request,'get','/api/auth/me',b).expect(200,{user:null,csrf:null});
}));

test('failed schedules are atomic, visible and deduplicated',()=>fixture(async(app,request)=> {
  const a=await login(request),s=(await auth(request,'get','/api/home',a)).body,at=new Date(2026,10,16,14,50);
  const scene=(await auth(request,'post',`/api/homes/${s.home.id}/scenes`,a).send({name:'Ошибка',actions:[{device_id:s.devices[0].id,property:'power',value:'0'}],schedule:{time:'14:50',days:String(at.getDay()),enabled:1}}).expect(201)).body;
  await auth(request,'patch',`/api/devices/${s.devices[0].id}`,a).send({online:0}).expect(200);
  assert.deepEqual(app.locals.runSchedules(at).failed,[scene.id]);
  assert.deepEqual(app.locals.runSchedules(at).failed,[]);
  assert.equal(app.locals.db.prepare('SELECT last_run FROM scenes WHERE id=?').get(scene.id).last_run,null);
  const events=(await auth(request,'get',`/api/homes/${s.home.id}/events?search=${encodeURIComponent('Расписание «Ошибка»')}`,a)).body;assert.equal(events.total,1);
}));

test('weekday bitmask migration preserves schedules and API serializes days',async()=> {
  const dir=mkdtempSync(join(tmpdir(),'doma-weekdays-')),dbPath=join(dir,'legacy.sqlite');let app=createApp({dbPath,testing:true});
  try {
    const db=app.locals.db,before=db.prepare('SELECT * FROM scene_schedules ORDER BY id').all();
    db.exec(`ALTER TABLE scene_schedules RENAME TO old_schedules;
      CREATE TABLE scene_schedules(id INTEGER PRIMARY KEY,scene_id INTEGER NOT NULL UNIQUE REFERENCES scenes(id) ON DELETE CASCADE,time TEXT NOT NULL,days TEXT NOT NULL,enabled INTEGER NOT NULL,last_run_minute TEXT);`);
    for(const row of before) db.prepare('INSERT INTO scene_schedules VALUES(?,?,?,?,?,?)').run(row.id,row.scene_id,row.time,maskToDays(row.days_mask),row.enabled,'persisted-minute');
    db.exec('DROP TABLE old_schedules');app.locals.close();app=createApp({dbPath,testing:true});
    const after=app.locals.db.prepare('SELECT * FROM scene_schedules ORDER BY id').all();assert.equal(after.length,before.length);assert.equal(after[0].days_mask,daysToMask('1,2,3,4,5'));assert.equal(after[0].last_run_minute,'persisted-minute');
    const request=supertest(app),a=await login(request),snapshot=(await auth(request,'get','/api/home',a)).body;assert.equal(snapshot.scenes[0].schedule.days,'1,2,3,4,5');
    const admin=await login(request,true),meta=(await auth(request,'get','/api/admin',admin)).body;const row=meta.resources.find((r:any)=>r.key==='scene_schedules').rows[0];assert.equal(row.days,'1,2,3,4,5');assert.equal(row.days_mask,undefined);
    await auth(request,'patch',`/api/admin/scene_schedules/${row.id}`,admin).send({days:'0,6'}).expect(200);
    assert.equal(app.locals.db.prepare('SELECT days_mask FROM scene_schedules WHERE id=?').get(row.id).days_mask,65);
    assert.deepEqual(app.locals.db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {app.locals.close();rmSync(dir,{recursive:true,force:true});}
});

test('production refuses unrotated development database and accepts both rotated passwords',async()=> {
  const previous={...process.env},dir=mkdtempSync(join(tmpdir(),'doma-production-')),dbPath=join(dir,'home.sqlite');let app:ReturnType<typeof createApp>|undefined;
  try {
    process.env.NODE_ENV='development';app=createApp({dbPath,testing:true});const count=app.locals.db.prepare('SELECT count(*) n FROM devices').get().n;app.locals.close();
    process.env.NODE_ENV='production';assert.throws(()=>createApp({dbPath,testing:true}),/known development credentials/);
    process.env.NODE_ENV='development';app=createApp({dbPath,testing:true});app.locals.db.prepare('UPDATE users SET password_hash=? WHERE email=?').run(await hashPassword('RotatedAdmin2026!'),'admin@doma.local');app.locals.close();
    process.env.NODE_ENV='production';assert.throws(()=>createApp({dbPath,testing:true}),/alex@doma.local/);
    process.env.NODE_ENV='development';app=createApp({dbPath,testing:true});app.locals.db.prepare('UPDATE users SET password_hash=? WHERE email=?').run(await hashPassword('RotatedHome2026!'),'alex@doma.local');app.locals.close();
    process.env.NODE_ENV='production';app=createApp({dbPath,testing:true});assert.equal(app.locals.db.prepare('SELECT count(*) n FROM devices').get().n,count);
    await supertest(app).post('/api/auth/login').send({email:'admin@doma.local',password:'RotatedAdmin2026!'}).expect(200);
    await supertest(app).post('/api/auth/demo').send({}).expect(404);
  } finally {app?.locals.close();rmSync(dir,{recursive:true,force:true});for(const key of Object.keys(process.env)) if(!(key in previous)) delete process.env[key];Object.assign(process.env,previous);}
});

test('production has no demo/default credentials and secure cookies; simulation can be disabled',async()=> {
  const previous={...process.env};let app:ReturnType<typeof createApp>|undefined;
  try {
    process.env.NODE_ENV='production';delete process.env.ADMIN_EMAIL;delete process.env.ADMIN_PASSWORD;
    assert.throws(()=>createApp({dbPath:':memory:',testing:true}),/ADMIN_EMAIL/);
    process.env.ADMIN_EMAIL='root@example.com';process.env.ADMIN_PASSWORD='ProductionPassword2026!';process.env.ENABLE_SIMULATION='false';
    app=createApp({dbPath:':memory:',testing:true});const request=supertest(app);
    await request.post('/api/auth/demo').send({}).expect(404);
    await request.post('/api/auth/login').send({email:'admin@doma.local',password:'DomaAdmin2026!'}).expect(401);
    const result=await request.post('/api/auth/login').send({email:'root@example.com',password:'ProductionPassword2026!'}).expect(200);
    assert.match(result.headers['set-cookie'][0],/Secure/);assert.match(result.headers['set-cookie'][0],/HttpOnly/);assert.match(result.headers['set-cookie'][0],/SameSite=Lax/);
    const a={cookie:result.headers['set-cookie'][0].split(';')[0],csrf:result.body.csrf};
    const s=(await auth(request,'get','/api/home',a)).body;assert.equal(s.simulation,false);
    await auth(request,'post',`/api/devices/${s.devices.find((d:any)=>d.kind==='sensor').id}/simulate`,a).send({value:22}).expect(403);
  } finally {app?.locals.close();for(const key of Object.keys(process.env)) if(!(key in previous)) delete process.env[key];Object.assign(process.env,previous);}
});
