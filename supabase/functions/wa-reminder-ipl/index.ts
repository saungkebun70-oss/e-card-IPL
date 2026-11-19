// Supabase Edge Function: wa-reminder-ipl
// Deploy via Supabase CLI: supabase functions deploy wa-reminder-ipl
// Menjalankan pengiriman pengingat tagihan IPL dengan jeda acak (anti-ban WhatsApp)
// serta pencatatan hasil pengiriman ke tabel bot_wa_logs.

// @ts-expect-error -- Deno runtime import untuk Supabase Edge Functions
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-blok-rumah, x-user-role',
};

const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatRupiah(nominal: number) {
  return `Rp ${Number(nominal || 0).toLocaleString('id-ID')}`;
}

// @ts-expect-error -- Deno global tersedia di runtime Edge Function Supabase
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // @ts-expect-error -- Deno.env di runtime Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    // @ts-expect-error -- Deno.env di runtime Supabase
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    // @ts-expect-error -- Deno.env di runtime Supabase
    const appUrl = Deno.env.get('APP_URL') ?? 'https://e-card-ipl.vercel.app';

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json().catch(() => ({}));
    const isManual = Boolean(body?.manual);

    const { data: config } = await supabase
      .from('bot_wa_config')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (!config || !config.aktif) {
      return new Response(
        JSON.stringify({ ok: false, sent: 0, message: 'Bot WA dalam status nonaktif.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    const now = new Date();
    const tahun = now.getFullYear();
    const bulan = now.getMonth() + 1;
    const tanggal = now.getDate();

    if (!isManual) {
      const shouldRun =
        (tanggal === 1 && config.jadwal_tgl_1) ||
        (tanggal === 6 && config.jadwal_tgl_6) ||
        (tanggal === 7 && config.jadwal_tgl_7) ||
        (tanggal >= 8 && config.jadwal_tgl_8_plus);
      if (!shouldRun) {
        return new Response(
          JSON.stringify({ ok: true, sent: 0, message: 'Tidak ada jadwal aktif untuk tanggal hari ini.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      }
    }

    const [{ data: wargaList }, { data: statusBulanIni }] = await Promise.all([
      supabase
        .from('users_warga')
        .select('blok_rumah, nama_warga, no_wa, nominal_iuran, status_hunian, pin_akses')
        .eq('role', 'warga')
        .eq('aktif', true)
        .neq('status_hunian', 'Kosong'),
      supabase
        .from('status_ecard_bulanan')
        .select('blok_rumah, status')
        .eq('tahun', tahun)
        .eq('bulan', bulan),
    ]);

    const paidOrPendingSet = new Set(
      (statusBulanIni || [])
        .filter((s: { status: string }) => s.status === 'Lunas' || s.status === 'Menunggu Verifikasi')
        .map((s: { blok_rumah: string }) => s.blok_rumah)
    );

    const targets = (wargaList || []).filter(
      (w: { blok_rumah: string }) => !paidOrPendingSet.has(w.blok_rumah)
    );

    const bulanLabel = `${NAMA_BULAN[bulan - 1]} ${tahun}`;
    const jenisPesan = isManual
      ? `Pengingat Manual (${bulanLabel})`
      : tanggal === 1
        ? 'Tagihan Awal Bulan (Tgl 1)'
        : tanggal === 6
          ? 'Pengingat H-1 (Tgl 6)'
          : tanggal === 7
            ? 'Jatuh Tempo Hari H (Tgl 7)'
            : 'Pengingat Keterlambatan (Tgl 8+)';

    let sent = 0;

    for (let i = 0; i < targets.length; i++) {
      const w = targets[i];
      const pesan = String(config.template_pesan || '')
        .replaceAll('{nama_warga}', w.nama_warga)
        .replaceAll('{blok_rumah}', w.blok_rumah)
        .replaceAll('{pin_akses}', w.pin_akses || '')
        .replaceAll('{bulan_tagihan}', bulanLabel)
        .replaceAll('{nominal_tagihan}', formatRupiah(w.nominal_iuran))
        .replaceAll('{link_aplikasi}', appUrl);

      let statusKirim: 'Terkirim' | 'Gagal' = 'Gagal';
      let responGateway = '';

      try {
        const headers: Record<string, string> = {
          Authorization: config.api_token,
          'Content-Type': 'application/json',
        };
        const payload =
          config.provider === 'Wablas'
            ? { phone: w.no_wa, message: pesan }
            : { target: w.no_wa, message: pesan, delay: '2-5' };

        const res = await fetch(config.api_endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        const text = await res.text();
        statusKirim = res.ok ? 'Terkirim' : 'Gagal';
        responGateway = `${res.status} — ${text.slice(0, 140)}`;
        if (res.ok) sent += 1;
      } catch (err) {
        responGateway = err instanceof Error ? err.message : 'Network error';
      }

      await supabase.from('bot_wa_logs').insert({
        blok_rumah: w.blok_rumah,
        nama_warga: w.nama_warga,
        no_wa: w.no_wa,
        jenis_pesan: jenisPesan,
        status_kirim: statusKirim,
        respon_gateway: responGateway,
        pesan,
      });

      // Jeda acak 2–4 detik antar pesan agar aman dari rate-limit/pemblokiran WhatsApp
      if (i < targets.length - 1) {
        const jitterMs = 2000 + Math.floor(Math.random() * 2000);
        await sleep(jitterMs);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, sent, totalTargets: targets.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'Internal error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
