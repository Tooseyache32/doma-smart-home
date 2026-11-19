import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { DEVICE_SELECT, type Row } from './database.js';

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export const fail = (message: string, status=400): never => { throw new HttpError(status,message); };
export const idSchema = z.coerce.number().int().positive();
export const nameSchema = z.string().trim().min(1).max(100);
export const emailSchema = z.string().trim().email().max(254).transform(v=>v.toLowerCase());
export const passwordSchema = z.string().min(10,'Пароль должен содержать минимум 10 символов').max(128);
export const bit = z.number().int().min(0).max(1);
export const roomSchema = z.object({name:nameSchema,icon:z.string().trim().min(1).max(40).default('home'),image:z.string().max(500).refine(v=>/^\/images\/[a-zA-Z0-9._/-]+$/.test(v)||/^https:\/\//.test(v),'Use a local /images path or HTTPS URL').default('/images/living.jpg'),sort_order:z.number().int().min(0).max(10000).default(0)}).strict();
export const roomPatchSchema=z.object({name:nameSchema.optional(),icon:roomSchema.shape.icon.removeDefault().optional(),image:roomSchema.shape.image.removeDefault().optional(),sort_order:roomSchema.shape.sort_order.removeDefault().optional()}).strict();
export const propertySchemas = {
  power:bit, brightness:z.number().int().min(0).max(100), color_temp:z.number().int().min(2000).max(6500),
  target_temp:z.number().min(10).max(35), mode:z.enum(['auto','heat','cool','fan','off'])
};
export const devicePatch = z.object({name:nameSchema.optional(),room_id:z.number().int().positive().optional(),online:bit.optional(),...Object.fromEntries(Object.entries(propertySchemas).map(([k,v])=>[k,v.optional()]))}).strict().refine(v=>Object.keys(v).length>0,'No writable fields supplied');
export const scheduleSchema = z.object({id:z.number().int().positive().optional(),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),days:z.string().regex(/^[0-6](,[0-6])*$/).refine(v=>new Set(v.split(',')).size===v.split(',').length,'Days must not repeat'),enabled:bit}).strict();
export const actionSchema = z.object({id:z.number().int().positive().optional(),device_id:z.number().int().positive(),property:z.enum(['power','brightness','color_temp','target_temp','mode']),value:z.string().min(1).max(30)}).strict();
export const sceneSchema = z.object({name:nameSchema,description:z.string().max(1000).default(''),icon:z.enum(['sun','home','moon','film','coffee','leaf']).default('sun'),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#D99B54'),actions:z.array(actionSchema).min(1).max(100),schedule:scheduleSchema.nullable().default(null)}).strict();
export const scenePatchSchema=z.object({name:nameSchema.optional(),description:sceneSchema.shape.description.removeDefault().optional(),icon:sceneSchema.shape.icon.removeDefault().optional(),color:sceneSchema.shape.color.removeDefault().optional(),actions:sceneSchema.shape.actions.optional(),schedule:sceneSchema.shape.schedule.removeDefault().optional()}).strict();
export function requireRow(db: DatabaseSync, sql: string, ...params: (string|number)[]): Row {
  const row = db.prepare(sql).get(...params) as Row | undefined;
  if (!row) fail('Запись не найдена',404);
  return row!;
}
export const getDevice = (db: DatabaseSync,id: number) => requireRow(db,`${DEVICE_SELECT} WHERE d.id=?`,id);
export function validateProperty(kind: string, property: string, value: unknown) {
  const allowed = kind==='light'?['power','brightness','color_temp']:kind==='climate'?['power','target_temp','mode']:[];
  if (!allowed.includes(property)) fail(`Свойство ${property} недоступно для устройства ${kind}`);
  return propertySchemas[property as keyof typeof propertySchemas].parse(value);
}
export function actionValue(kind: string, property: string, value: string) {
  if (property!=='mode' && (!value.trim() || !/^-?\d+(\.\d+)?$/.test(value))) fail('Некорректное числовое значение действия');
  return validateProperty(kind,property,property==='mode'?value:Number(value));
}
export function sensorValue(metric: string, value: unknown) {
  const ranges: Record<string,[number,number]> = {temp:[-50,70],humidity:[0,100],co2:[250,10000],motion:[0,1],contact:[0,1],leak:[0,1]};
  const range = ranges[metric];
  if (!range) fail('Unknown sensor metric');
  let schema = z.number().min(range[0]).max(range[1]);
  if (['motion','contact','leak'].includes(metric)) schema=schema.int();
  return schema.parse(value);
}
export function setProperty(db: DatabaseSync, device: Row, property: string, value: unknown) {
  const parsed = validateProperty(device.kind,property,value);
  const table = device.kind==='light'?'light_states':'climate_states';
  db.prepare(`UPDATE ${table} SET ${property}=? WHERE device_id=?`).run(parsed,device.id);
}
export function validateSceneActions(db: DatabaseSync, homeId: number, actions: z.infer<typeof actionSchema>[]) {
  const seen = new Set<string>();
  for (const action of actions) {
    const device = getDevice(db,action.device_id);
    if (device.home_id!==homeId) fail('Устройство принадлежит другому дому',403);
    actionValue(device.kind,action.property,action.value);
    const key = `${action.device_id}:${action.property}`;
    if (seen.has(key)) fail('Повторяющееся действие сценария');
    seen.add(key);
  }
}
