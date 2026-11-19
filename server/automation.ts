import type { DatabaseSync } from 'node:sqlite';
import { addEvent, maskToDays, nowISO, transaction, type Row } from './database.js';
import { actionValue, getDevice, requireRow, setProperty, sensorValue, fail } from './validation.js';

export function getScene(db: DatabaseSync, id: number): Row {
  const scene = requireRow(db,'SELECT * FROM scenes WHERE id=?',id);
  const stored = db.prepare('SELECT id,time,days_mask,enabled FROM scene_schedules WHERE scene_id=?').get(id) as Row|undefined;
  const schedule=stored?{id:stored.id,time:stored.time,days:maskToDays(stored.days_mask),enabled:stored.enabled}:null;
  return {...scene,actions:db.prepare('SELECT id,device_id,property,value FROM scene_actions WHERE scene_id=? ORDER BY id').all(id),schedule};
}
function executeInTransaction(db: DatabaseSync, id: number, userId: number|null, date: string, source: string) {
  const scene = getScene(db,id);
  if (!scene.actions.length) fail('Сценарий не содержит действий');
  const actions = scene.actions.map((action: Row)=> {
    const device = getDevice(db,action.device_id);
    if (device.home_id!==scene.home_id) fail('Устройство сценария перемещено в другой дом');
    if (!device.online) fail(`Устройство «${device.name}» не в сети`,409);
    const value = actionValue(device.kind,action.property,action.value);
    return {action,device,value};
  });
  for (const {action,device,value} of actions) {
    setProperty(db,device,action.property,value);
    addEvent(db,scene.home_id,`${source}: «${scene.name}» — ${device.name}, ${action.property}: ${value}`,'device',device.id,userId,date);
  }
  db.prepare('UPDATE scenes SET last_run=? WHERE id=?').run(date,id);
  addEvent(db,scene.home_id,`${source}: сценарий «${scene.name}» выполнен`,'scene',null,userId,date);
  return getScene(db,id);
}
export function executeScene(db: DatabaseSync, id: number, userId: number|null = null, date=nowISO()) {
  return transaction(db,()=>executeInTransaction(db,id,userId,date,'Запуск'));
}
export function runSchedules(db: DatabaseSync, at = new Date()): {ran:number[]; failed:number[]} {
  const time = `${String(at.getHours()).padStart(2,'0')}:${String(at.getMinutes()).padStart(2,'0')}`;
  const minute = `${at.getFullYear()}-${String(at.getMonth()+1).padStart(2,'0')}-${String(at.getDate()).padStart(2,'0')}T${time}@${at.getTimezoneOffset()}`;
  const schedules = db.prepare('SELECT * FROM scene_schedules WHERE enabled=1 AND time=?').all(time) as Row[];
  const result: {ran:number[]; failed:number[]} = {ran:[],failed:[]};
  for (const schedule of schedules) {
    if (!(schedule.days_mask & (1<<at.getDay())) || schedule.last_run_minute===minute) continue;
    try {
      const ran = transaction(db,()=> {
        const claimed = db.prepare('UPDATE scene_schedules SET last_run_minute=? WHERE id=? AND enabled=1 AND (last_run_minute IS NULL OR last_run_minute!=?)').run(minute,schedule.id,minute);
        if (!claimed.changes) return false;
        executeInTransaction(db,schedule.scene_id,null,at.toISOString(),'По расписанию'); return true;
      });
      if (ran) result.ran.push(schedule.scene_id);
    } catch (error) {
      transaction(db,()=> {
        db.prepare('UPDATE scene_schedules SET last_run_minute=? WHERE id=?').run(minute,schedule.id);
        const scene = requireRow(db,'SELECT * FROM scenes WHERE id=?',schedule.scene_id);
        addEvent(db,scene.home_id,`Расписание «${scene.name}»: ${error instanceof Error?error.message:'ошибка'}`,'system',null,null,at.toISOString());
      });
      result.failed.push(schedule.scene_id);
    }
  }
  return result;
}
export function recordSensor(db: DatabaseSync, deviceId: number, value: unknown, userId:number|null=null, date=nowISO(), manual=true) {
  const device = getDevice(db,deviceId);
  if (device.kind!=='sensor') fail('Устройство не является датчиком');
  if (!device.online) fail('Датчик не в сети',409);
  const parsed = sensorValue(device.sensor_metric,value);
  db.prepare('UPDATE sensor_states SET value=?,updated_at=? WHERE device_id=?').run(parsed,date,deviceId);
  db.prepare('INSERT INTO sensor_readings(device_id,value,created_at) VALUES(?,?,?)').run(deviceId,parsed,date);
  db.prepare('DELETE FROM sensor_readings WHERE device_id=? AND id NOT IN (SELECT id FROM sensor_readings WHERE device_id=? ORDER BY id DESC LIMIT 1000)').run(deviceId,deviceId);
  const alert = ['motion','contact','leak'].includes(device.sensor_metric) ? parsed===1 : device.sensor_metric==='co2'?parsed>1000:device.sensor_metric==='humidity'?parsed>70||parsed<25:parsed<15||parsed>30;
  const wasAlert = ['motion','contact','leak'].includes(device.sensor_metric) ? device.value===1 : device.sensor_metric==='co2'?device.value>1000:device.sensor_metric==='humidity'?device.value>70||device.value<25:device.value<15||device.value>30;
  if (manual || alert!==wasAlert) addEvent(db,device.home_id,`Симуляция${alert?' · предупреждение':''}: ${device.name} — ${parsed}${device.unit||''}`,alert?'sensor':'simulation',deviceId,userId,date);
  return parsed;
}
export function simulateSensors(db: DatabaseSync, at = new Date(), random=Math.random) {
  transaction(db,()=> {
    const sensors = db.prepare(`SELECT d.id,t.sensor_metric,s.value FROM devices d JOIN device_types t ON t.id=d.type_id JOIN sensor_states s ON s.device_id=d.id WHERE d.online=1`).all() as Row[];
    for (const sensor of sensors) {
      const metric = sensor.sensor_metric;
      const baseline = metric==='temp'?22.4:metric==='humidity'?46:metric==='co2'?580:sensor.value;
      const step = metric==='temp'?.08:metric==='humidity'?.4:metric==='co2'?12:0;
      const value = Math.round((sensor.value + (baseline-sensor.value)*.03+(random()-.5)*step)*10)/10;
      recordSensor(db,sensor.id,value,null,at.toISOString(),false);
    }
    db.prepare(`UPDATE climate_states SET current_temp=round(current_temp + (CASE WHEN power=1 AND mode!='off' THEN target_temp ELSE 22 END-current_temp)*0.03,2) WHERE device_id IN (SELECT id FROM devices WHERE online=1)`).run();
  });
}
