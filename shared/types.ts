export type DeviceKind = 'light' | 'climate' | 'sensor';
export type IconName = 'sun' | 'home' | 'moon' | 'film' | 'coffee' | 'leaf';
export interface User { id: number; name: string; email: string; role: 'user' | 'admin' }
export interface Home { id: number; name: string; address: string }
export interface Room { id: number; home_id: number; name: string; icon: string; image: string; sort_order: number }
export interface Device {
  id: number; room_id: number; type_id: number; name: string; online: number;
  room_name: string; kind: DeviceKind; type_name: string; sensor_metric: string | null;
  power: number | null; brightness: number | null; color_temp: number | null;
  target_temp: number | null; current_temp: number | null; mode: string | null;
  value: number | null; unit: string | null; updated_at: string | null;
}
export interface DeviceType { id: number; name: string; kind: DeviceKind; sensor_metric: string | null; unit: string | null }
export interface SceneAction { id?: number; device_id: number; property: 'power' | 'brightness' | 'color_temp' | 'target_temp' | 'mode'; value: string }
export interface SceneSchedule { id?: number; time: string; days: string; enabled: number }
export interface Scene { id: number; home_id: number; name: string; description: string; icon: IconName; color: string; last_run: string | null; actions: SceneAction[]; schedule: SceneSchedule | null }
export interface Event { id: number; home_id: number; device_id: number | null; user_id: number | null; type_id: number; type: string; severity: string; message: string; created_at: string; device_name: string | null; room_name: string | null; user_name: string | null }
export interface Snapshot { user: User; home: Home; homes: Home[]; rooms: Room[]; devices: Device[]; scenes: Scene[]; events: Event[]; types: DeviceType[]; simulation: boolean }
export interface EventPage { items: Event[]; total: number; page: number; pages: number }
export interface Reading { id: number; device_id: number; value: number; created_at: string }
export interface AdminField { key: string; label: string; type: 'text' | 'number' | 'select' | 'password' | 'datetime'; required?: boolean; options?: { value: string | number; label: string }[]; readonly?: boolean }
export interface AdminResource { key: string; label: string; description: string; fields: AdminField[]; rows: Record<string, unknown>[]; canCreate: boolean; canDelete: boolean }
export interface AdminData { resources: AdminResource[]; stats: { users: number; homes: number; devices: number; events: number } }

