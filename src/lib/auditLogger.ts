import type { AuditLogEntry, SessionUser } from '../types';
import { getSupabaseClient } from './supabase';

const LOCAL_AUDIT_KEY = 'saungkebun_audit_logs_v1';

function readLocalAuditLogs(): AuditLogEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_AUDIT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AuditLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalAuditLog(entry: AuditLogEntry) {
  try {
    const current = readLocalAuditLogs();
    const updated = [entry, ...current].slice(0, 200);
    localStorage.setItem(LOCAL_AUDIT_KEY, JSON.stringify(updated));
  } catch {
    // Abaikan kuota storage penuh
  }
}

export async function recordAuditLog(params: {
  session?: SessionUser | null;
  action: string;
  entity: string;
  entity_id?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const entry: AuditLogEntry = {
    id: `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    timestamp: new Date().toISOString(),
    actor_role: params.session?.role || 'system',
    actor_id: params.session?.blok_rumah || 'anonymous',
    actor_name: params.session?.nama_warga || 'Sistem',
    action: params.action,
    entity: params.entity,
    entity_id: params.entity_id,
    summary: params.summary,
    metadata: params.metadata,
  };

  saveLocalAuditLog(entry);

  // 1. Kirim ke endpoint server Express (/api/audit-logs) untuk pencatatan permanen di server
  try {
    await fetch('/api/audit-logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-role': entry.actor_role,
        'x-blok-rumah': entry.actor_id,
      },
      body: JSON.stringify(entry),
    });
  } catch {
    // Fallback aman untuk deployment statis Vercel tanpa Express server
  }

  // 2. Sinkronkan juga ke tabel audit_logs Supabase bila koneksi aktif
  const supabase = getSupabaseClient(params.session);
  if (supabase) {
    try {
      await supabase.from('audit_logs').insert({
        actor_role: entry.actor_role,
        actor_id: entry.actor_id,
        actor_name: entry.actor_name,
        action: entry.action,
        entity: entry.entity,
        entity_id: entry.entity_id || null,
        summary: entry.summary,
        metadata: entry.metadata || {},
      });
    } catch {
      // Jangan gagalkan alur utama jika tabel audit_logs belum dibuat di Supabase
    }
  }
}

export async function fetchAuditLogs(session: SessionUser): Promise<AuditLogEntry[]> {
  if (session.role !== 'admin') return [];

  // Coba ambil dari server Express terlebih dahulu
  try {
    const res = await fetch('/api/audit-logs?limit=150', {
      headers: {
        'x-user-role': session.role,
        'x-blok-rumah': session.blok_rumah,
      },
    });
    if (res.ok) {
      const data = (await res.json()) as { logs?: AuditLogEntry[] };
      if (Array.isArray(data.logs) && data.logs.length > 0) {
        return data.logs;
      }
    }
  } catch {
    // Lanjut ke fallback Supabase / localStorage
  }

  const supabase = getSupabaseClient(session);
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(150);
      if (!error && Array.isArray(data) && data.length > 0) {
        return data as AuditLogEntry[];
      }
    } catch {
      // Lanjut ke fallback lokal
    }
  }

  return readLocalAuditLogs();
}
