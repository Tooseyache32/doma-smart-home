import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export type Row = Record<string, any>;
export const nowISO = () => new Date().toISOString();
export const daysToMask = (days:string) => days.split(',').reduce((mask,day)=>mask|(1<<Number(day)),0);
export const maskToDays = (mask:number) => Array.from({length:7},(_,day)=>day).filter(day=>(mask&(1<<day))!==0).join(',');
export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
      email TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(email) BETWEEN 3 AND 254),
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE, csrf_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS homes (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
      address TEXT NOT NULL DEFAULT '' CHECK(length(address) <= 300));
    CREATE TABLE IF NOT EXISTS home_members (
      id INTEGER PRIMARY KEY, home_id INTEGER NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'owner' CHECK(role IN ('owner','member')), UNIQUE(home_id,user_id));
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY, home_id INTEGER NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100), icon TEXT NOT NULL DEFAULT 'home',
      image TEXT NOT NULL DEFAULT '/images/living.jpg', sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0));
    CREATE TABLE IF NOT EXISTS device_types (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
      kind TEXT NOT NULL CHECK(kind IN ('light','climate','sensor')),
      sensor_metric TEXT CHECK(sensor_metric IN ('temp','humidity','co2','motion','contact','leak')),
      unit TEXT, CHECK((kind = 'sensor' AND sensor_metric IS NOT NULL AND unit IS NOT NULL) OR (kind != 'sensor' AND sensor_metric IS NULL AND unit IS NULL)));
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      type_id INTEGER NOT NULL REFERENCES device_types(id) ON DELETE RESTRICT,
      name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100), online INTEGER NOT NULL DEFAULT 1 CHECK(online IN (0,1)));
    CREATE TABLE IF NOT EXISTS light_states (
      id INTEGER PRIMARY KEY, device_id INTEGER NOT NULL UNIQUE REFERENCES devices(id) ON DELETE CASCADE,
      power INTEGER NOT NULL DEFAULT 0 CHECK(power IN (0,1)), brightness INTEGER NOT NULL DEFAULT 70 CHECK(brightness BETWEEN 0 AND 100),
      color_temp INTEGER NOT NULL DEFAULT 2700 CHECK(color_temp BETWEEN 2000 AND 6500));
    CREATE TABLE IF NOT EXISTS climate_states (
      id INTEGER PRIMARY KEY, device_id INTEGER NOT NULL UNIQUE REFERENCES devices(id) ON DELETE CASCADE,
      power INTEGER NOT NULL DEFAULT 1 CHECK(power IN (0,1)), target_temp REAL NOT NULL DEFAULT 22 CHECK(target_temp BETWEEN 10 AND 35),
      current_temp REAL NOT NULL DEFAULT 22 CHECK(current_temp BETWEEN -50 AND 70),
      mode TEXT NOT NULL DEFAULT 'auto' CHECK(mode IN ('auto','heat','cool','fan','off')));
    CREATE TABLE IF NOT EXISTS sensor_states (
      id INTEGER PRIMARY KEY, device_id INTEGER NOT NULL UNIQUE REFERENCES devices(id) ON DELETE CASCADE,
      value REAL NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS sensor_readings (
      id INTEGER PRIMARY KEY, device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      value REAL NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS scenes (
      id INTEGER PRIMARY KEY, home_id INTEGER NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100), description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 1000),
      icon TEXT NOT NULL DEFAULT 'sun' CHECK(icon IN ('sun','home','moon','film','coffee','leaf')),
      color TEXT NOT NULL DEFAULT '#D99B54', last_run TEXT);
    CREATE TABLE IF NOT EXISTS scene_actions (
      id INTEGER PRIMARY KEY, scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
      device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
      property TEXT NOT NULL CHECK(property IN ('power','brightness','color_temp','target_temp','mode')), value TEXT NOT NULL,
      UNIQUE(scene_id,device_id,property));
    CREATE TABLE IF NOT EXISTS scene_schedules (
      id INTEGER PRIMARY KEY, scene_id INTEGER NOT NULL UNIQUE REFERENCES scenes(id) ON DELETE CASCADE,
      time TEXT NOT NULL CHECK(length(time)=5 AND time GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(time,1,2) <= '23'),
      days_mask INTEGER NOT NULL CHECK(days_mask BETWEEN 1 AND 127), enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      last_run_minute TEXT);
    CREATE TABLE IF NOT EXISTS event_types (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE CHECK(length(trim(name)) BETWEEN 1 AND 100),
      severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')));
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY, home_id INTEGER NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
      device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      type_id INTEGER NOT NULL REFERENCES event_types(id) ON DELETE RESTRICT,
      message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 2000), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE INDEX IF NOT EXISTS idx_members_user ON home_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_rooms_home ON rooms(home_id);
    CREATE INDEX IF NOT EXISTS idx_devices_room ON devices(room_id);
    CREATE INDEX IF NOT EXISTS idx_readings_device_time ON sensor_readings(device_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_events_home_time ON events(home_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
    CREATE TRIGGER IF NOT EXISTS protect_last_admin_delete BEFORE DELETE ON users
      WHEN OLD.role='admin' AND (SELECT count(*) FROM users WHERE role='admin')<=1
      BEGIN SELECT RAISE(ABORT,'Cannot delete the last administrator'); END;
    CREATE TRIGGER IF NOT EXISTS protect_last_admin_update BEFORE UPDATE OF role ON users
      WHEN OLD.role='admin' AND NEW.role!='admin' AND (SELECT count(*) FROM users WHERE role='admin')<=1
      BEGIN SELECT RAISE(ABORT,'Cannot demote the last administrator'); END;
    CREATE TRIGGER IF NOT EXISTS protect_last_owner_delete BEFORE DELETE ON home_members
      WHEN OLD.role='owner' AND EXISTS(SELECT 1 FROM homes WHERE id=OLD.home_id) AND
        (SELECT count(*) FROM home_members WHERE home_id=OLD.home_id AND role='owner')<=1
      BEGIN SELECT RAISE(ABORT,'Cannot remove the last home owner'); END;
    CREATE TRIGGER IF NOT EXISTS protect_last_owner_update BEFORE UPDATE ON home_members
      WHEN OLD.role='owner' AND (NEW.role!='owner' OR NEW.home_id!=OLD.home_id) AND
        (SELECT count(*) FROM home_members WHERE home_id=OLD.home_id AND role='owner')<=1
      BEGIN SELECT RAISE(ABORT,'Cannot remove the last home owner'); END;
    CREATE TRIGGER IF NOT EXISTS light_kind_insert BEFORE INSERT ON light_states
      WHEN (SELECT t.kind FROM devices d JOIN device_types t ON t.id=d.type_id WHERE d.id=NEW.device_id) != 'light'
      BEGIN SELECT RAISE(ABORT,'Device is not a light'); END;
    CREATE TRIGGER IF NOT EXISTS climate_kind_insert BEFORE INSERT ON climate_states
      WHEN (SELECT t.kind FROM devices d JOIN device_types t ON t.id=d.type_id WHERE d.id=NEW.device_id) != 'climate'
      BEGIN SELECT RAISE(ABORT,'Device is not climate'); END;
    CREATE TRIGGER IF NOT EXISTS sensor_kind_insert BEFORE INSERT ON sensor_states
      WHEN (SELECT t.kind FROM devices d JOIN device_types t ON t.id=d.type_id WHERE d.id=NEW.device_id) != 'sensor'
      BEGIN SELECT RAISE(ABORT,'Device is not a sensor'); END;
  `);
  const sessionColumns=db.prepare('PRAGMA table_info(sessions)').all() as Row[];
  if(sessionColumns.some(column=>column.name==='csrf_token')&&!sessionColumns.some(column=>column.name==='csrf_hash')) {
    transaction(db,()=> {db.exec('DELETE FROM sessions; ALTER TABLE sessions RENAME COLUMN csrf_token TO csrf_hash;');});
  }
  const scheduleColumns=db.prepare('PRAGMA table_info(scene_schedules)').all() as Row[];
  if(scheduleColumns.some(column=>column.name==='days')) {
    transaction(db,()=> {
      const schedules=db.prepare('SELECT * FROM scene_schedules').all() as Row[];
      db.exec(`ALTER TABLE scene_schedules RENAME TO legacy_schedules;
        CREATE TABLE scene_schedules (
          id INTEGER PRIMARY KEY, scene_id INTEGER NOT NULL UNIQUE REFERENCES scenes(id) ON DELETE CASCADE,
          time TEXT NOT NULL CHECK(length(time)=5 AND time GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(time,1,2) <= '23'),
          days_mask INTEGER NOT NULL CHECK(days_mask BETWEEN 1 AND 127), enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), last_run_minute TEXT);`);
      for(const schedule of schedules) db.prepare('INSERT INTO scene_schedules(id,scene_id,time,days_mask,enabled,last_run_minute) VALUES(?,?,?,?,?,?)').run(schedule.id,schedule.scene_id,schedule.time,daysToMask(schedule.days),schedule.enabled,schedule.last_run_minute);
      db.exec('DROP TABLE legacy_schedules');
    });
  }
  db.exec('PRAGMA user_version = 2');
  return db;
}
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function addEvent(db: DatabaseSync, homeId: number, message: string, type = 'device', deviceId: number | null = null, userId: number | null = null, date = nowISO()) {
  const eventType = db.prepare('SELECT id FROM event_types WHERE name=?').get(type) as Row | undefined;
  if (!eventType) throw new Error(`Unknown event type: ${type}`);
  db.prepare('INSERT INTO events(home_id,device_id,user_id,type_id,message,created_at) VALUES(?,?,?,?,?,?)').run(homeId,deviceId,userId,eventType.id,message,date);
}
export const DEVICE_SELECT = `SELECT d.*,r.name room_name,r.home_id,t.kind,t.name type_name,t.sensor_metric,
  COALESCE(l.power,c.power) power,l.brightness,l.color_temp,c.target_temp,c.current_temp,c.mode,
  s.value,t.unit,s.updated_at FROM devices d JOIN rooms r ON r.id=d.room_id JOIN device_types t ON t.id=d.type_id
  LEFT JOIN light_states l ON l.device_id=d.id LEFT JOIN climate_states c ON c.device_id=d.id LEFT JOIN sensor_states s ON s.device_id=d.id`;
export const EVENT_SELECT = `SELECT e.*,t.name type,t.severity,d.name device_name,r.name room_name,u.name user_name
  FROM events e JOIN event_types t ON t.id=e.type_id LEFT JOIN devices d ON d.id=e.device_id
  LEFT JOIN rooms r ON r.id=d.room_id LEFT JOIN users u ON u.id=e.user_id`;
export function initializeDevice(db: DatabaseSync, id: number, kind: string, metric?: string | null) {
  if (kind === 'light') db.prepare('INSERT INTO light_states(device_id) VALUES(?)').run(id);
  if (kind === 'climate') db.prepare('INSERT INTO climate_states(device_id) VALUES(?)').run(id);
  if (kind === 'sensor') {
    const value = ({temp:22.4,humidity:46,co2:580,motion:0,contact:0,leak:0} as Record<string,number>)[metric ?? 'temp'];
    db.prepare('INSERT INTO sensor_states(device_id,value) VALUES(?,?)').run(id,value);
    db.prepare('INSERT INTO sensor_readings(device_id,value) VALUES(?,?)').run(id,value);
  }
}
export function createDemoHome(db: DatabaseSync, userId: number, name = 'Мой тёплый дом'): number {
  const homeId = Number(db.prepare('INSERT INTO homes(name,address) VALUES(?,?)').run(name,'Москва, ул. Лесная, 12').lastInsertRowid);
  db.prepare('INSERT INTO home_members(home_id,user_id,role) VALUES(?,?,?)').run(homeId,userId,'owner');
  const rooms = [ ['Гостиная','home','living'],['Спальня','moon','bedroom'],['Кухня','coffee','kitchen'],['Кабинет','sun','office'] ];
  const roomIds = rooms.map(([title,icon,image], index) => Number(db.prepare('INSERT INTO rooms(home_id,name,icon,image,sort_order) VALUES(?,?,?,?,?)').run(homeId,title,icon,`/images/${image}.jpg`,index).lastInsertRowid));
  const specs: [number,string,string][] = [
    [0,'Торшер у дивана','light'],[0,'Основной свет','light'],[0,'Климат гостиной','climate'],[0,'Температура воздуха','temp'],
    [0,'Качество воздуха','co2'],[1,'Прикроватный свет','light'],[1,'Климат спальни','climate'],[1,'Влажность воздуха','humidity'],
    [2,'Подсветка кухни','light'],[2,'Датчик протечки','leak'],[2,'Датчик окна','contact'],[3,'Настольная лампа','light'],[3,'Датчик движения','motion']
  ];
  const ids = specs.map(([room,name,kind]) => {
    const chosen = ['light','climate'].includes(kind)
      ? db.prepare('SELECT * FROM device_types WHERE kind=? LIMIT 1').get(kind) as Row|undefined
      : db.prepare('SELECT * FROM device_types WHERE sensor_metric=? LIMIT 1').get(kind) as Row|undefined;
    if (!chosen) throw new Error('Missing device catalog');
    const id = Number(db.prepare('INSERT INTO devices(room_id,type_id,name) VALUES(?,?,?)').run(roomIds[room],chosen.id,name).lastInsertRowid);
    initializeDevice(db,id,chosen.kind,chosen.sensor_metric); return id;
  });
  db.prepare('UPDATE light_states SET power=1,brightness=68 WHERE device_id=?').run(ids[0]);
  db.prepare('UPDATE light_states SET power=1,brightness=85 WHERE device_id=?').run(ids[11]);
  const scenes = [
    {name:'Доброе утро',description:'Мягкий свет и комфортная температура для начала дня',icon:'sun',color:'#E7B56A',actions:[[ids[1],'power','1'],[ids[1],'brightness','80'],[ids[2],'target_temp','22']],time:'07:30'},
    {name:'Уютный вечер',description:'Тёплый свет для отдыха дома',icon:'moon',color:'#D6956D',actions:[[ids[0],'power','1'],[ids[0],'brightness','40'],[ids[1],'power','0']],time:null},
    {name:'Кино',description:'Приглушённый свет и никаких отвлекающих деталей',icon:'film',color:'#9A8AC0',actions:[[ids[0],'brightness','15'],[ids[1],'power','0']],time:null},
    {name:'Ушёл из дома',description:'Выключить свет и экономить энергию',icon:'leaf',color:'#8C9D76',actions:ids.filter((_,i)=>['light'].includes(specs[i][2])).map(id=>[id,'power','0']),time:null}
  ];
  for (const scene of scenes) {
    const id = Number(db.prepare('INSERT INTO scenes(home_id,name,description,icon,color) VALUES(?,?,?,?,?)').run(homeId,scene.name,scene.description,scene.icon,scene.color).lastInsertRowid);
    for (const [device,property,value] of scene.actions) db.prepare('INSERT INTO scene_actions(scene_id,device_id,property,value) VALUES(?,?,?,?)').run(id,device,property,value);
    if (scene.time) db.prepare('INSERT INTO scene_schedules(scene_id,time,days_mask) VALUES(?,?,?)').run(id,scene.time,daysToMask('1,2,3,4,5'));
  }
  addEvent(db,homeId,'Добро пожаловать! Виртуальный дом готов к управлению.','system',null,userId);
  addEvent(db,homeId,'Симуляция: датчики передают комфортные показатели воздуха.','simulation',ids[3],null);
  return homeId;
}
function syncPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password,salt,64).toString('hex')}`;
}
export function seedDatabase(db: DatabaseSync, production: boolean) {
  if(production) {
    for(const [email,password] of [['admin@doma.local','DomaAdmin2026!'],['alex@doma.local','DomaHome2026!']]) {
      const account=db.prepare('SELECT password_hash FROM users WHERE email=?').get(email) as Row|undefined;
      if(!account) continue;
      const [algorithm,salt,key]=String(account.password_hash).split('$');
      if(algorithm==='scrypt'&&salt&&key) {
        const expected=Buffer.from(key,'hex'),actual=scryptSync(password,salt,64);
        if(expected.length===actual.length&&timingSafeEqual(expected,actual)) throw new Error(`Production refuses known development credentials for ${email}. Rotate the password in development or use a separate production DB_PATH. No business records were deleted.`);
      }
    }
  }
  const catalog = [['Умная лампа','light',null,null],['Климат-контроль','climate',null,null],['Температура','sensor','temp','°C'],['Влажность','sensor','humidity','%'],['CO₂','sensor','co2','ppm'],['Движение','sensor','motion',''],['Открытие','sensor','contact',''],['Протечка','sensor','leak','']];
  transaction(db, () => {
    if (!(db.prepare('SELECT count(*) n FROM device_types').get() as Row).n) for (const type of catalog) db.prepare('INSERT INTO device_types(name,kind,sensor_metric,unit) VALUES(?,?,?,?)').run(...type);
    for (const [name,severity] of [['system','info'],['device','info'],['scene','info'],['sensor','warning'],['simulation','info'],['security','warning']]) db.prepare('INSERT OR IGNORE INTO event_types(name,severity) VALUES(?,?)').run(name,severity);
    const makeUser = (name: string,email: string,password: string,role: string) => {
      if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return;
      const id = Number(db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)').run(name,email,syncPassword(password),role).lastInsertRowid);
      createDemoHome(db,id,role==='admin'?'Дом администратора':'Мой тёплый дом');
    };
    if (!production) {
      makeUser('Администратор','admin@doma.local','DomaAdmin2026!','admin');
      makeUser('Александр','alex@doma.local','DomaHome2026!','user');
    } else if (!(db.prepare("SELECT count(*) n FROM users WHERE role='admin'").get() as Row).n) {
      const {ADMIN_EMAIL: email, ADMIN_PASSWORD: password} = process.env;
      if (!email || !password || password.length < 10 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('First production start requires valid ADMIN_EMAIL and ADMIN_PASSWORD (at least 10 characters).');
      makeUser('Администратор',email.trim().toLowerCase(),password,'admin');
    }
  });
}
