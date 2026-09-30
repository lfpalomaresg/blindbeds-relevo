export interface Organization {
  id: string;
  name: string;
  status: "active" | "suspended" | "archived";
  created_at: string;
}

export type Department = "recepcion" | "pisos" | "fb" | "mantenimiento" | "otro";
export type ShiftType = "manana" | "tarde" | "noche";
export type HandoverBlock = "pendientes" | "vips" | "incidencias" | "avisos";
export type TicketPriority = "critica" | "alta" | "normal" | "baja";
export type TicketStatus = "abierto" | "en_curso" | "cerrado";
export type OrgRole = "staff" | "supervisor" | "admin";

export interface Membership {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
}

export interface ShiftHandover {
  id: string;
  org_id: string;
  department: Department;
  shift_type: ShiftType;
  created_by: string;
  read_by?: string;
  read_at?: string;
  created_at: string;
}

export interface HandoverItem {
  id: string;
  handover_id: string;
  org_id: string;
  block: HandoverBlock;
  content: string;
  resolved: boolean;
  resolved_by?: string;
  resolved_at?: string;
  created_at: string;
}

export interface TicketAsset {
  id: string;
  org_id: string;
  name: string;
  location?: string;
  qr_code: string;
  created_at: string;
}

export interface MaintenanceTicket {
  id: string;
  org_id: string;
  asset_id?: string;
  title: string;
  description?: string;
  priority: TicketPriority;
  status: TicketStatus;
  photo_path?: string;
  created_by: string;
  assigned_to?: string;
  closed_by?: string;
  closed_at?: string;
  created_at: string;
}

export interface TicketUpdate {
  id: string;
  ticket_id: string;
  status_from?: TicketStatus;
  status_to: TicketStatus;
  comment?: string;
  created_by: string;
  created_at: string;
}

export const DEPARTMENTS: { value: Department; label: string }[] = [
  { value: "recepcion", label: "Recepción" },
  { value: "pisos", label: "Pisos" },
  { value: "fb", label: "F&B / Cocina" },
  { value: "mantenimiento", label: "Mantenimiento" },
  { value: "otro", label: "Otro" },
];

export const SHIFT_TYPES: { value: ShiftType; label: string }[] = [
  { value: "manana", label: "Mañana" },
  { value: "tarde", label: "Tarde" },
  { value: "noche", label: "Noche" },
];

export const HANDOVER_BLOCKS: { value: HandoverBlock; label: string; description: string }[] = [
  { value: "pendientes", label: "Pendientes", description: "Tareas sin terminar del turno anterior" },
  { value: "vips", label: "VIPs", description: "Clientes especiales hoy" },
  { value: "incidencias", label: "Incidencias", description: "Problemas activos" },
  { value: "avisos", label: "Avisos", description: "Información general para el siguiente turno" },
];

export const TICKET_PRIORITIES: { value: TicketPriority; label: string; color: string }[] = [
  { value: "critica", label: "Crítica", color: "red" },
  { value: "alta", label: "Alta", color: "orange" },
  { value: "normal", label: "Normal", color: "blue" },
  { value: "baja", label: "Baja", color: "gray" },
];

export const TICKET_STATUSES: { value: TicketStatus; label: string; color: string }[] = [
  { value: "abierto", label: "Abierto", color: "red" },
  { value: "en_curso", label: "En curso", color: "yellow" },
  { value: "cerrado", label: "Cerrado", color: "green" },
];